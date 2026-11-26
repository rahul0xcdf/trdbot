/**
 * DEMO MODE ONLY (DEMO_MODE=1).
 *
 * Sample snapshots so the terminal can be previewed before the engine is
 * connected. The three scheduled payloads were produced by the real engine
 * code (reports.py → publish.py) fed with sample inputs; the AI pre-market
 * analysis below is hand-written sample text in the engine's exact schema.
 * Every snapshot is flagged demo:true and the UI shows a DEMO banner.
 */
import { isoDateIST } from "@/lib/format";
import { snapshotId } from "@/lib/derive";
import type { AiPremarketAnalysis, Candidate, MetricRow, Snapshot } from "@/lib/types";
import premarketJson from "./premarket.json";
import afternoonJson from "./afternoon.json";
import eveningJson from "./evening.json";
import aiJson from "./ai_premarket.json";

const FIXTURE_PREV = "2026-11-25"; // the session the fixtures' market data belongs to

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isWeekday(iso: string) {
  const w = new Date(iso + "T00:00:00Z").getUTCDay();
  return w !== 0 && w !== 6;
}
export function prevTradingDay(iso: string) {
  let d = addDays(iso, -1);
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}
function nextTradingDay(iso: string) {
  let d = addDays(iso, 1);
  while (!isWeekday(d)) d = addDays(d, 1);
  return d;
}
function lastTradingDayOnOrBefore(iso: string) {
  let d = iso;
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}
function dayDelta(a: string, b: string) {
  return Math.round((+new Date(b + "T00:00:00Z") - +new Date(a + "T00:00:00Z")) / 86_400_000);
}

/** Shift every "dd-Mon-YYYY" and ISO date inside a fixture by `delta` days. */
function shiftDates<T>(obj: T, delta: number): T {
  if (!delta) return obj;
  const raw = JSON.stringify(obj)
    .replace(/(\d{2})-([A-Z][a-z]{2})-(\d{4})/g, (_, d, m, y) => {
      const mi = MONTHS.indexOf(m);
      if (mi < 0) return `${d}-${m}-${y}`;
      const t = new Date(Date.UTC(+y, mi, +d + delta));
      return `${String(t.getUTCDate()).padStart(2, "0")}-${MONTHS[t.getUTCMonth()]}-${t.getUTCFullYear()}`;
    })
    .replace(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/g, (_, d, t) => `${addDays(d, delta)}T${t}`);
  return JSON.parse(raw);
}

function at(day: string, hhmmss: string) {
  return `${day}T${hhmmss}+05:30`;
}

const SAMPLE_BULLETS: Record<string, string[]> = {
  premarket: [
    "[Sample text] GIFT Nifty +0.32% points to a positive open; first resistance is the 25,950–26,100 call-OI band.",
    "[Sample text] Put writing at 25,700 is the support to watch; a slip below it would undo yesterday's breakout.",
    "[Sample text] FII selling for a third day is the main risk in the first hour — watch Bank Nifty for confirmation.",
  ],
  afternoon: [
    "[Sample text] Metals and IT carry the index; Tata Steel and Infosys are the top Nifty contributors.",
    "[Sample text] Softer US CPI has lifted IT names, in line with the morning headline.",
    "[Sample text] Realty and media remain the weak pockets, matching yesterday's sector trend.",
  ],
  evening: [
    "[Sample text] Nifty closed near the day's high with breadth 33:17 — strength in metals and IT could carry into tomorrow.",
    "[Sample text] Pharma and realty are weakening on both day and week; avoid longs there.",
    "[Sample text] Weekly expiry on 2 Dec and HDFCLIFE results are the dates that could move the index.",
  ],
};

function make(json: unknown, day: string, time: string, tradeDate: string | null, delta: number): Snapshot {
  const p = shiftDates(json as Snapshot, delta);
  const generated_at = at(day, time);
  if (p.analysis?.kind === "brief" && SAMPLE_BULLETS[p.session]) p.analysis = { ...p.analysis, bullets: SAMPLE_BULLETS[p.session] };
  return {
    ...p,
    id: snapshotId(p.session, generated_at),
    generated_at,
    trade_date: tradeDate,
    source: { engine: "trdbot (demo fixture)", ai_model: "sample text" },
    demo: true,
  };
}

const DEMO_CANDIDATES: Record<string, Candidate> = {
  HINDALCO: { symbol: "HINDALCO", side: "bulls", price: 712.2, rsi: 64.8, macd_state: "bullish", ema20: 698.4, ema50: 684.1, ema200: 652.3, adx: 28.6, supertrend: "up", rvol: 1.7, delivery_pct: 46.2, supports: [701.5, 694.0], resistances: [724.0, 733.5], structure: "higher highs / higher lows" },
  INFY: { symbol: "INFY", side: "bulls", price: 1921.5, rsi: 61.2, macd_state: "bullish", ema20: 1888.0, ema50: 1861.7, ema200: 1774.9, adx: 24.1, supertrend: "up", rvol: 1.4, delivery_pct: 52.8, supports: [1896.0, 1874.5], resistances: [1950.0, 1976.0], structure: "breakout from range" },
  SUNPHARMA: { symbol: "SUNPHARMA", side: "bears", price: 1702.1, rsi: 38.4, macd_state: "bearish", ema20: 1731.2, ema50: 1748.9, ema200: 1712.6, adx: 26.9, supertrend: "down", rvol: 1.6, delivery_pct: 41.0, supports: [1680.0, 1662.0], resistances: [1722.0, 1740.0], structure: "lower highs / lower lows" },
};

const DEMO_AI: AiPremarketAnalysis = {
  kind: "ai_premarket",
  market_outlook: {
    sentiment: "bullish",
    recommendation: "CAUTION",
    confidence: 68,
    bullish_prob: 55,
    bearish_prob: 20,
    rangebound_prob: 25,
    why: "[Sample text] Put writing dominates the Nifty chain and GIFT Nifty points higher, but FIIs sold for a third session and Bank Nifty PCR is only neutral, so size down until 26,000 is taken out.",
  },
  overnight_summary: "[Sample text] GIFT Nifty indicates a positive start; US CPI cooled and Treasury yields slipped. Crude and USDINR were not in the data.",
  domestic_summary: "[Sample text] Nifty closed +0.56% with 33 advances / 17 declines. FII −₹1,240 Cr vs DII +₹860 Cr. India VIX eased to 11.42.",
  sector_outlook: { bullish_sectors: ["Metal", "IT", "PSU Bank"], bearish_sectors: ["Realty", "Media", "Pharma"], comment: "[Sample text] Metals and IT lead on both day and week; realty and media fading." },
  nifty_levels: { supports: [25750, 25700, 25650], resistances: [25950, 26050, 26100] },
  banknifty_levels: { supports: [58700, 58500, 58300], resistances: [59200, 59500, 60000] },
  call_opportunities: [
    {
      symbol: "HINDALCO", current_price: 712.2, bias: "bullish", confidence_score: 88,
      score_breakdown: { technical: "36/40", options: "17/20", volume: "8/10", news: "8/10", fundamentals: "16/20", risk_deduction: -3 },
      technical_summary: "[Sample text] Above all key EMAs, supertrend up, ADX 28 confirms trend.",
      fundamental_summary: "[Sample text] Healthy ROE, reasonable PE for the cycle.",
      news_summary: "[Sample text] Metal stocks extend rally on China stimulus hopes.",
      entry_zone: "710-714", stop_loss: 701, target_1: 724, target_2: 733, risk_reward: "1:1.9",
      option_type: "CALL", suggested_strike: "720 CE", suggested_expiry: "30-Dec-2026",
      scalping_suitability: "high", expected_holding_time: "30-90 min",
      key_risks: ["Commodity reversal intraday", "FII selling in metals"],
      why_selected: "[Sample text] Strongest metal on day and week with fresh put writing at 700.",
    },
    {
      symbol: "INFY", current_price: 1921.5, bias: "bullish", confidence_score: 86,
      score_breakdown: { technical: "34/40", options: "16/20", volume: "7/10", news: "7/10", fundamentals: "18/20", risk_deduction: -2 },
      technical_summary: "[Sample text] Breakout from a 3-week range on above-average volume.",
      fundamental_summary: "[Sample text] Steady growth, high institutional holding.",
      news_summary: "[Sample text] Softer US CPI supportive for IT.",
      entry_zone: "1915-1925", stop_loss: 1896, target_1: 1950, target_2: 1976, risk_reward: "1:2.1",
      option_type: "CALL", suggested_strike: "1940 CE", suggested_expiry: "30-Dec-2026",
      scalping_suitability: "medium", expected_holding_time: "45-120 min",
      key_risks: ["Gap fill below 1915"],
      why_selected: "[Sample text] Range breakout with call unwinding above 1900.",
    },
  ],
  put_opportunities: [
    {
      symbol: "SUNPHARMA", current_price: 1702.1, bias: "bearish", confidence_score: 85,
      score_breakdown: { technical: "33/40", options: "17/20", volume: "8/10", news: "6/10", fundamentals: "15/20", risk_deduction: -2 },
      technical_summary: "[Sample text] Below EMA20/50, supertrend down, lower highs.",
      fundamental_summary: "[Sample text] n/a",
      news_summary: "[Sample text] No specific news.",
      entry_zone: "1708-1715", stop_loss: 1722, target_1: 1690, target_2: 1680, risk_reward: "1:2.3",
      option_type: "PUT", suggested_strike: "1700 PE", suggested_expiry: "30-Dec-2026",
      scalping_suitability: "medium", expected_holding_time: "30-60 min",
      key_risks: ["Defensive bid if market turns"],
      why_selected: "[Sample text] Weakest pharma name with call writing overhead at 1720.",
    },
  ],
  alerts: ["[Sample text] Nifty weekly expiry on 02-Dec-2026.", "[Sample text] HDFCLIFE results today."],
  risk_assessment: ["[Sample text] FII selling for three sessions could cap the upside.", "[Sample text] VIX near 11 — cheap premiums but sharp reversals possible."],
  trading_plan: { style: "Momentum", why: "[Sample text] Trend days in metals/IT; trade breakouts with tight stops." },
  no_trade: false,
  no_trade_reason: "",
  strategy_name: "Adaptive: calm tape (VIX 11.42) — premiums cheap, momentum longs viable",
};

export function demoSnapshots(now = new Date()): Snapshot[] {
  const today = isoDateIST(now);
  const istMins = (() => {
    const d = new Date(now.getTime() + 330 * 60_000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  })();
  // The "current" trading day for the morning reports.
  const day = isWeekday(today) && istMins >= 8 * 60 + 15 ? today : lastTradingDayOnOrBefore(isWeekday(today) ? prevTradingDay(today) : today);
  const prev = prevTradingDay(day);
  const delta = dayDelta(FIXTURE_PREV, prev);
  const out: Snapshot[] = [];

  out.push(make(eveningJson, prev, "18:00:11", prev, delta));
  out.push(make(premarketJson, day, "08:15:03", prev, delta));
  const ai = make(aiJson, day, "08:41:27", day, delta);
  ai.analysis = { ...shiftDates(DEMO_AI, delta), generated_date: day };
  // keep the demo internally consistent: same sector table as the 8:15 report
  ai.data = { ...ai.data, sectors: (premarketJson as unknown as Snapshot).data.sectors, candidates: DEMO_CANDIDATES };
  out.push(ai);
  if (day < today || istMins >= 14 * 60) out.push(make(afternoonJson, day, "14:00:06", day, delta));

  // A few earlier sessions for the History page (same shape, earlier dates).
  let d = prev;
  for (let i = 1; i <= 4; i++) {
    d = prevTradingDay(d);
    const k = 1 - i * 0.0042;
    for (const [json, time] of [[eveningJson, "18:00:09"], [premarketJson, "08:15:02"]] as const) {
      const s = make(json, time === "18:00:09" ? d : nextTradingDay(d), time, d, dayDelta(FIXTURE_PREV, d));
      const n = s.data.indices?.["NIFTY 50"];
      if (n?.last) n.last = Math.round(n.last * k * 100) / 100;
      out.push(s);
    }
  }
  return out;
}

export function demoMetrics(now = new Date()): MetricRow[] {
  const rows: MetricRow[] = [];
  let d = prevTradingDay(isoDateIST(now));
  const days: string[] = [];
  while (days.length < 30) {
    days.unshift(d);
    d = prevTradingDay(d);
  }
  days.forEach((day, i) => {
    const t = i / 29;
    const w = Math.sin(i * 1.7) * 0.5 + Math.cos(i * 0.9) * 0.5;
    rows.push({
      ts: `${day}T12:30:00.000Z`,
      pcr: Math.round((0.92 + 0.22 * t + 0.12 * w) * 100) / 100,
      vix: Math.round((13.6 - 2.2 * t + 0.6 * w) * 100) / 100,
      max_pain: Math.round((25350 + 550 * t + 80 * w) / 50) * 50,
      fii_net: Math.round(-900 + 1600 * Math.sin(i * 1.3) + 400 * w),
      dii_net: Math.round(700 + 1100 * Math.cos(i * 1.1) - 300 * w),
      source: "demo",
    });
  });
  return rows;
}
