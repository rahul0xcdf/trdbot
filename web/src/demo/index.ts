/**
 * DEMO MODE ONLY (DEMO_MODE=1).
 *
 * Sample snapshots so the site can be previewed before the engine is
 * connected. All four payloads were produced by the real engine code
 * (planner.py → reports.py → publish.py) run on ONE synthetic market (the
 * bot's own tests/synth.py), cut at 8:45, 11:45 and the close, so the
 * plans, the midday status and the evening wrap agree with each other and
 * with the demo charts. The AI narration is labelled "[Sample text]".
 * Every snapshot is flagged demo:true and the UI shows a DEMO banner.
 */
import { isoDateIST } from "@/lib/format";
import { snapshotId } from "@/lib/derive";
import type { Candle, MetricRow, Snapshot } from "@/lib/types";
import premarketJson from "./premarket.json";
import middayJson from "./midday.json";
import eveningJson from "./evening.json";
import monthlyJson from "./monthly.json";
import barsJson from "./bars.json";

const FIXTURE_DAY = "2026-11-25"; // the session the fixtures' market data belongs to
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isWeekday = (iso: string) => {
  const w = new Date(iso + "T00:00:00Z").getUTCDay();
  return w !== 0 && w !== 6;
};
export function prevTradingDay(iso: string) {
  let d = addDays(iso, -1);
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}
export function nextTradingDay(iso: string) {
  let d = addDays(iso, 1);
  while (!isWeekday(d)) d = addDays(d, 1);
  return d;
}
const dayDelta = (a: string, b: string) => Math.round((+new Date(b + "T00:00:00Z") - +new Date(a + "T00:00:00Z")) / 86_400_000);

/** Shift every "dd-Mon-YYYY" and ISO date inside a fixture by `delta` days. */
function shiftDates<T>(obj: T, delta: number): T {
  if (!delta) return structuredClone(obj);
  const raw = JSON.stringify(obj)
    .replace(/(\d{2})-([A-Z][a-z]{2})-(\d{4})/g, (_, d, m, y) => {
      const mi = MONTHS.indexOf(m);
      if (mi < 0) return `${d}-${m}-${y}`;
      const t = new Date(Date.UTC(+y, mi, +d + delta));
      return `${String(t.getUTCDate()).padStart(2, "0")}-${MONTHS[t.getUTCMonth()]}-${t.getUTCFullYear()}`;
    })
    .replace(/(\d{4}-\d{2}-\d{2})(?=T\d{2}:\d{2}|")/g, (d) => addDays(d, delta));
  return JSON.parse(raw);
}

/** IST minutes since midnight and the demo's trading day. */
function clock(now: Date) {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const today = isoDateIST(now);
  const day = isWeekday(today) ? today : prevTradingDay(today);
  return { today, day, mins: isWeekday(today) ? mins : 24 * 60 };
}

function make(json: unknown, sessionDay: string, planFor: string | null, time: string): Snapshot {
  const p = shiftDates(json as Snapshot, dayDelta(FIXTURE_DAY, sessionDay));
  const generated_at = `${sessionDay}T${time}+05:30`;
  return { ...p, id: snapshotId(p.session, generated_at), generated_at, trade_date: sessionDay, plan_for: planFor, demo: true };
}

export function demoSnapshots(now = new Date()): Snapshot[] {
  const { day, today, mins } = clock(now);
  const past = day < today;
  const out: Snapshot[] = [];
  // Last evening's wrap, with its plan for `day`
  const prev = prevTradingDay(day);
  out.push(make(eveningJson, prev, day, "18:00:07"));
  if (past || mins >= 8 * 60 + 45) out.push(make(premarketJson, day, day, "08:45:02"));
  if (past || mins >= 11 * 60 + 45) out.push(make(middayJson, day, day, "11:45:04"));
  if (past || mins >= 18 * 60) out.push(make(eveningJson, day, nextTradingDay(day), "18:00:05"));
  // Monthly calendar for the current month (its events are shifted with the rest).
  const m = make(monthlyJson, day, null, "08:45:30");
  m.data = { ...m.data, month: day.slice(0, 7) };
  out.push(m);
  // Earlier sessions for History / Performance (same plans, earlier dates).
  let d = prev;
  for (let i = 0; i < 3; i++) {
    out.push(make(premarketJson, d, d, "08:45:01"));
    d = prevTradingDay(d);
    out.push(make(eveningJson, d, nextTradingDay(d), "18:00:03"));
  }
  return out;
}

/* ── Demo candles: the same synthetic market the fixtures were built on ── */

type Row = [number, number, number, number, number];
const BARS = barsJson as unknown as Record<string, Row[]>;
const YAHOO: Record<string, string> = { NIFTY: "^NSEI", BANKNIFTY: "^NSEBANK" };

const istDay = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(0, 10);

/** Map the fixture's sessions onto the last N trading days ending at the demo day. */
function remap(rows: Row[], lastDay: string): Candle[] {
  const days = [...new Set(rows.map((r) => istDay(r[0])))].sort();
  const target = new Map<string, string>();
  let d = lastDay;
  for (let i = days.length - 1; i >= 0; i--) {
    target.set(days[i], d);
    d = prevTradingDay(d);
  }
  return rows.map(([t, o, h, l, c]) => {
    const shift = dayDelta(istDay(t), target.get(istDay(t))!) * 86400;
    return { time: t + shift, open: o, high: h, low: l, close: c, volume: 0 };
  });
}

/** Fixture bars for NIFTY / BANKNIFTY up to `now` (null for other instruments). */
export function demoFixtureCandles(key: string, interval: string, now = new Date()): Candle[] | null {
  const y = YAHOO[key];
  if (!y) return null;
  const { day } = clock(now);
  const limit = Math.floor(now.getTime() / 1000);
  if (interval === "1d") return remap(BARS[`${y}_daily`], day).filter((c) => c.time <= limit);
  const five = remap(BARS[y], day).filter((c) => c.time + 300 <= limit);
  if (interval === "5m") return five;
  const step = interval === "15m" ? 900 : interval === "1h" || interval === "60m" ? 3600 : 300;
  const out: Candle[] = [];
  for (const c of five) {
    const local = c.time + 19800;
    const mid = local - (local % 86400);
    const start = mid + 33300 + Math.floor((local - mid - 33300) / step) * step - 19800;
    const b = out.at(-1);
    if (b && b.time === start) {
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      b.close = c.close;
    } else out.push({ ...c, time: start });
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
      max_pain: Math.round((25150 + 300 * t + 80 * w) / 50) * 50,
      fii_net: Math.round(-900 + 1600 * Math.sin(i * 1.3) + 400 * w),
      dii_net: Math.round(700 + 1100 * Math.cos(i * 1.1) - 300 * w),
      source: "demo",
    });
  });
  return rows;
}
