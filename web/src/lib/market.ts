/**
 * Raw market data for the website (server only): prices, candles and
 * sparklines from Yahoo Finance's public chart endpoint. This is RAW DATA —
 * no indicators, levels or signals are derived here.
 */
import "server-only";
import { isDemo } from "./store";
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

async function yahoo(symbol: string, range: string, interval: string, revalidate: number): Promise<YahooChart> {
  const qs = `range=${range}&interval=${interval}&includePrePost=false`;
  let last: unknown;
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${qs}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        next: { revalidate },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as YahooChart;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function toCandles(res: NonNullable<NonNullable<YahooChart["chart"]>["result"]>[number]): Candle[] {
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

export async function getQuote(inst: Instrument): Promise<Quote> {
  if (isDemo()) return demoQuote(inst);
  try {
    const j = await yahoo(inst.yahoo, "1d", "5m", 30);
    const res = j.chart?.result?.[0];
    if (!res) throw new Error(j.chart?.error?.description ?? "no data");
    const m = res.meta;
    const price = m.regularMarketPrice ?? null;
    const prev = m.chartPreviousClose ?? m.previousClose ?? null;
    const candles = toCandles(res);
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
  } catch (e) {
    return { symbol: inst.key, name: inst.name, price: null, prev_close: null, change: null, change_pct: null, time: null, spark: [], source: SOURCE, error: (e as Error).message };
  }
}

export async function getCandles(inst: Instrument, range: string, interval: string): Promise<CandleSeries> {
  if (isDemo()) return demoCandles(inst, range, interval);
  try {
    const j = await yahoo(inst.yahoo, range, interval, interval === "1d" ? 600 : 30);
    const res = j.chart?.result?.[0];
    if (!res) throw new Error(j.chart?.error?.description ?? "no data");
    const candles = toCandles(res);
    const t = res.meta.regularMarketTime;
    return { symbol: inst.key, interval, range, candles, updated: t ? new Date(t * 1000).toISOString() : null, source: SOURCE };
  } catch (e) {
    return { symbol: inst.key, interval, range, candles: [], updated: null, source: SOURCE, error: (e as Error).message };
  }
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

function demoQuote(inst: Instrument): Quote {
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
