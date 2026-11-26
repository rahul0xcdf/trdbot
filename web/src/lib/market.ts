/**
 * Raw market data for the website (server only): prices, candles and
 * sparklines from Yahoo Finance's public chart endpoint. This is RAW DATA —
 * no indicators, levels or signals are derived here.
 */
import "server-only";
import { isDemo } from "./store";
import { demoFixtureCandles } from "@/demo";
import type { Candle, CandleSeries, Quote } from "./types";
import type { Instrument } from "./instruments";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const SOURCE = "Yahoo Finance";

interface YahooChart {
  chart?: {
    result?: {
      meta: {
        symbol: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketTime?: number;
        currency?: string;
        marketState?: string;
      };
      timestamp?: number[];
      indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] };
    }[];
    error?: { description?: string } | null;
  };
}

type ChartResult = NonNullable<NonNullable<YahooChart["chart"]>["result"]>[number];
type Fetched = { ok: true; res: ChartResult } | { ok: false; error: string };

/** The Python bridge (api/yf.py) used on Vercel, where Yahoo refuses Node. */
function bridge(): { url: string; headers: Record<string, string> } | null {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.INGEST_TOKEN) headers.Authorization = `Bearer ${process.env.INGEST_TOKEN}`;
  if (process.env.YF_BRIDGE_URL) return { url: process.env.YF_BRIDGE_URL, headers };
  if (!process.env.VERCEL) return null;
  const prod = process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const host = prod || process.env.VERCEL_URL;
  if (!host) return null;
  // Preview URLs sit behind Vercel Authentication; this secret lets the
  // server call itself when "Protection Bypass for Automation" is on.
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return { url: `https://${host}/api/yf`, headers };
}

function unpack(j: YahooChart | undefined): Fetched {
  const res = j?.chart?.result?.[0];
  if (res) return { ok: true, res };
  return { ok: false, error: j?.chart?.error?.description ?? "no data" };
}

async function direct(symbol: string, range: string, interval: string, revalidate: number): Promise<Fetched> {
  const qs = `range=${range}&interval=${interval}&includePrePost=false`;
  let last = "no response";
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${qs}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        next: { revalidate },
        signal: AbortSignal.timeout(8000),
      });
      if (r.status === 404) return unpack((await r.json().catch(() => undefined)) as YahooChart | undefined);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return unpack((await r.json()) as YahooChart);
    } catch (e) {
      last = (e as Error).message;
    }
  }
  return { ok: false, error: last };
}

/**
 * Fetch Yahoo charts for several symbols at once. On Vercel this goes through
 * the Python bridge in one request (Yahoo answers Node with HTTP 429 there);
 * locally it calls Yahoo directly. Anything the first route can't get is
 * retried on the other.
 */
async function yahooMany(symbols: string[], range: string, interval: string, revalidate: number): Promise<Map<string, Fetched>> {
  const out = new Map<string, Fetched>();
  const b = bridge();
  const viaBridge = async (syms: string[]) => {
    if (!b || !syms.length) return;
    for (let i = 0; i < syms.length; i += 20) {
      const chunk = syms.slice(i, i + 20);
      const url = `${b.url}?s=${chunk.map(encodeURIComponent).join(",")}&range=${range}&interval=${interval}`;
      try {
        const r = await fetch(url, { headers: b.headers, next: { revalidate }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error(`bridge HTTP ${r.status}`);
        const j = (await r.json()) as { results: Record<string, { status: number; data?: YahooChart; error?: string }> };
        for (const s of chunk) {
          const x = j.results?.[s];
          if (!x) out.set(s, { ok: false, error: "bridge: no result" });
          else if (x.data) out.set(s, unpack(x.data));
          else out.set(s, { ok: false, error: x.error ?? `HTTP ${x.status}` });
        }
      } catch (e) {
        for (const s of chunk) out.set(s, { ok: false, error: (e as Error).message });
      }
    }
  };
  const viaDirect = async (syms: string[]) => {
    const got = await Promise.all(syms.map((s) => direct(s, range, interval, revalidate)));
    syms.forEach((s, i) => {
      const prev = out.get(s);
      // keep the more informative error if both routes fail
      if (got[i].ok || !prev) out.set(s, got[i]);
    });
  };
  const errorOf = (s: string) => { const f = out.get(s); return f && !f.ok ? f.error : null; };
  const failed = () => symbols.filter((s) => !out.get(s)?.ok);
  if (b && process.env.VERCEL) {
    await viaBridge(symbols);
    // "no data" means Yahoo answered (unknown symbol); don't retry those
    const left = failed().filter((s) => errorOf(s) !== "no data");
    if (left.length) await viaDirect(left);
  } else {
    await viaDirect(symbols);
    if (b) await viaBridge(failed());
  }
  return out;
}

function toCandles(res: ChartResult): Candle[] {
  const ts = res.timestamp ?? [];
  const q = res.indicators.quote[0];
  const out: Candle[] = [];
  ts.forEach((t, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null) return;
    out.push({ time: t, open: o, high: h, low: l, close: c, volume: q.volume[i] ?? 0 });
  });
  return out;
}

export async function getQuotes(insts: Instrument[]): Promise<Quote[]> {
  if (isDemo()) return insts.map(demoQuote);
  const got = await yahooMany([...new Set(insts.map((i) => i.yahoo))], "1d", "5m", 30);
  return insts.map((inst) => {
    const f = got.get(inst.yahoo) ?? { ok: false as const, error: "no data" };
    if (!f.ok) {
      return { symbol: inst.key, name: inst.name, price: null, prev_close: null, change: null, change_pct: null, time: null, spark: [], source: SOURCE, error: f.error };
    }
    const m = f.res.meta;
    const price = m.regularMarketPrice ?? null;
    const prev = m.chartPreviousClose ?? m.previousClose ?? null;
    const candles = toCandles(f.res);
    return {
      symbol: inst.key,
      name: inst.name,
      price,
      prev_close: prev,
      change: price !== null && prev !== null ? price - prev : null,
      change_pct: price !== null && prev ? ((price - prev) / prev) * 100 : null,
      time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
      market_state: m.marketState,
      currency: m.currency ?? null,
      spark: candles.map((c) => c.close),
      source: SOURCE,
    };
  });
}

export async function getQuote(inst: Instrument): Promise<Quote> {
  return (await getQuotes([inst]))[0];
}

export async function getCandles(inst: Instrument, range: string, interval: string): Promise<CandleSeries> {
  if (isDemo()) return demoCandles(inst, range, interval);
  const f = (await yahooMany([inst.yahoo], range, interval, interval === "1d" ? 600 : 30)).get(inst.yahoo);
  if (!f?.ok) return { symbol: inst.key, interval, range, candles: [], updated: null, source: SOURCE, error: f?.error ?? "no data" };
  const t = f.res.meta.regularMarketTime;
  return { symbol: inst.key, interval, range, candles: toCandles(f.res), updated: t ? new Date(t * 1000).toISOString() : null, source: SOURCE };
}

/* ── Demo: deterministic synthetic prices (DEMO_MODE=1 only) ─────────────── */

const DEMO_BASE: Record<string, { prev: number; open: number; drift: number; vol: number }> = {
  NIFTY: { prev: 25873.45, open: 25951, drift: 0.0011, vol: 0.0009 },
  BANKNIFTY: { prev: 58912.3, open: 59040, drift: 0.0009, vol: 0.0011 },
  SENSEX: { prev: 84912.6, open: 85170, drift: 0.001, vol: 0.0009 },
  FINNIFTY: { prev: 27410.6, open: 27470, drift: 0.0008, vol: 0.001 },
  INDIAVIX: { prev: 11.42, open: 11.3, drift: -0.012, vol: 0.006 },
  HINDALCO: { prev: 712.2, open: 709.8, drift: 0.018, vol: 0.0022 },
  INFY: { prev: 1921.5, open: 1927.4, drift: -0.002, vol: 0.0014 },
  SUNPHARMA: { prev: 1702.1, open: 1699.0, drift: -0.004, vol: 0.0016 },
  SPX: { prev: 6812.4, open: 6812.4, drift: 0.004, vol: 0.0006 },
  NASDAQ: { prev: 23410.2, open: 23410.2, drift: 0.006, vol: 0.0008 },
  DOW: { prev: 47820.5, open: 47820.5, drift: 0.002, vol: 0.0005 },
  VIX: { prev: 14.8, open: 14.8, drift: -0.03, vol: 0.006 },
  NIKKEI: { prev: 49120.3, open: 49200, drift: 0.007, vol: 0.0008 },
  HANGSENG: { prev: 25980.6, open: 25950, drift: -0.004, vol: 0.0009 },
  SHANGHAI: { prev: 3921.4, open: 3920, drift: 0.002, vol: 0.0006 },
  KOSPI: { prev: 4012.8, open: 4020, drift: 0.009, vol: 0.001 },
  BRENT: { prev: 63.42, open: 63.4, drift: -0.006, vol: 0.0012 },
  WTI: { prev: 59.87, open: 59.9, drift: -0.007, vol: 0.0012 },
  GOLD: { prev: 4128.6, open: 4130, drift: 0.004, vol: 0.0006 },
  SILVER: { prev: 51.312, open: 51.3, drift: 0.009, vol: 0.001 },
  USDINR: { prev: 88.612, open: 88.6, drift: -0.0008, vol: 0.0002 },
  DXY: { prev: 99.214, open: 99.2, drift: -0.0012, vol: 0.0002 },
};

function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h;
}

/** Today's 5-minute bars from 09:15 IST up to now (or the close). */
function demoIntraday(key: string, now = new Date()): Candle[] {
  const b = DEMO_BASE[key] ?? { prev: 1000, open: 1000, drift: 0, vol: 0.001 };
  const ist = new Date(now.getTime() + 330 * 60_000);
  const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const dow = ist.getUTCDay();
  const open = day / 1000 + (9 * 60 + 15) * 60 - 19800;
  const close = day / 1000 + (15 * 60 + 30) * 60 - 19800;
  const nowS = Math.floor(now.getTime() / 1000);
  if (dow === 0 || dow === 6 || nowS < open) return [];
  const end = Math.min(nowS, close);
  const rnd = seeded(hash(key + day));
  const out: Candle[] = [];
  let px = b.open;
  const n = 75; // bars in a full session
  for (let t = open, i = 0; t <= end - 300; t += 300, i++) {
    const o = px;
    const step = (b.drift / n) * o + (rnd() - 0.5) * 2 * b.vol * o;
    const c = o + step;
    const h = Math.max(o, c) + rnd() * b.vol * o * 0.8;
    const l = Math.min(o, c) - rnd() * b.vol * o * 0.8;
    out.push({ time: t, open: o, high: h, low: l, close: c, volume: Math.round(1e5 * (0.6 + rnd()) * (i < 6 || i > 66 ? 1.8 : 1)) });
    px = c;
  }
  return out;
}

function demoDaily(key: string, days: number, now = new Date()): Candle[] {
  const b = DEMO_BASE[key] ?? { prev: 1000, open: 1000, drift: 0, vol: 0.001 };
  const rnd = seeded(hash(key + "daily"));
  const out: Candle[] = [];
  let px = b.prev;
  const ist = new Date(now.getTime() + 330 * 60_000);
  let t = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) / 1000 - 86400;
  while (out.length < days) {
    const dow = new Date(t * 1000).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const c = px;
      const o = c * (1 + (rnd() - 0.52) * b.vol * 9);
      const h = Math.max(o, c) * (1 + rnd() * b.vol * 5);
      const l = Math.min(o, c) * (1 - rnd() * b.vol * 5);
      out.unshift({ time: t + 3.75 * 3600, open: o, high: h, low: l, close: c, volume: Math.round(2e7 * (0.6 + rnd())) });
      px = o;
    }
    t -= 86400;
  }
  return out;
}

const istDay = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(0, 10);

function demoQuote(inst: Instrument): Quote {
  const fx = demoFixtureCandles(inst.key, "5m");
  if (fx?.length) {
    // NIFTY / BANKNIFTY: the synthetic market the demo reports were built on
    const last = istDay(fx.at(-1)!.time);
    const bars = fx.filter((c) => istDay(c.time) === last);
    const prevBars = fx.filter((c) => istDay(c.time) < last);
    const price = bars.at(-1)!.close;
    const prev = prevBars.at(-1)?.close ?? null;
    return {
      symbol: inst.key,
      name: inst.name,
      price,
      prev_close: prev,
      change: prev !== null ? price - prev : null,
      change_pct: prev ? ((price - prev) / prev) * 100 : null,
      time: new Date((bars.at(-1)!.time + 300) * 1000).toISOString(),
      spark: bars.map((c) => c.close),
      source: "Synthetic (demo)",
      demo: true,
    };
  }
  const b = DEMO_BASE[inst.key];
  const bars = demoIntraday(inst.key);
  const price = bars.at(-1)?.close ?? b?.prev ?? null;
  const prev = b?.prev ?? null;
  return {
    symbol: inst.key,
    name: inst.name,
    price,
    prev_close: prev,
    change: price !== null && prev !== null ? price - prev : null,
    change_pct: price !== null && prev ? ((price - prev) / prev) * 100 : null,
    time: bars.length ? new Date((bars.at(-1)!.time + 300) * 1000).toISOString() : null,
    spark: bars.map((c) => c.close),
    source: "Synthetic (demo)",
    demo: true,
  };
}

function demoCandles(inst: Instrument, range: string, interval: string): CandleSeries {
  const fx = demoFixtureCandles(inst.key, interval);
  if (fx) {
    const last = fx.length ? istDay(fx.at(-1)!.time) : null;
    const candles = range === "1d" && interval !== "1d" ? fx.filter((c) => istDay(c.time) === last) : fx;
    return { symbol: inst.key, interval, range, candles, updated: new Date().toISOString(), source: "Synthetic (demo)", demo: true };
  }
  let candles: Candle[];
  if (interval === "1d") candles = demoDaily(inst.key, range === "1y" ? 250 : range === "6mo" ? 125 : 22);
  else if (range === "1d") candles = demoIntraday(inst.key);
  else {
    // 5D: previous days' 15-min bars stitched before today's
    const today = demoIntraday(inst.key);
    const daily = demoDaily(inst.key, 4);
    const prevBars: Candle[] = [];
    daily.forEach((d) => {
      const rnd = seeded(hash(inst.key + d.time));
      let px = d.open;
      const start = d.time; // daily bars are stamped 09:15 IST
      for (let i = 0; i < 25; i++) {
        const target = d.open + ((d.close - d.open) * (i + 1)) / 25;
        const o = px;
        const c = target + (rnd() - 0.5) * (d.high - d.low) * 0.15;
        prevBars.push({ time: start + i * 900, open: o, high: Math.max(o, c) + (d.high - d.low) * 0.05 * rnd(), low: Math.min(o, c) - (d.high - d.low) * 0.05 * rnd(), close: c, volume: Math.round(4e5 * (0.6 + rnd())) });
        px = c;
      }
    });
    const agg: Candle[] = [];
    for (let i = 0; i < today.length; i += 3) {
      const g = today.slice(i, i + 3);
      agg.push({ time: g[0].time, open: g[0].open, high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)), close: g.at(-1)!.close, volume: g.reduce((a, x) => a + x.volume, 0) });
    }
    candles = [...prevBars, ...agg];
  }
  return { symbol: inst.key, interval, range, candles, updated: new Date().toISOString(), source: "Synthetic (demo)", demo: true };
}
