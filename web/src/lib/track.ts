/**
 * Setup tracking = the engine's own rule, replayed on real candles.
 *
 * `evaluatePlan` is a line-for-line port of planner.evaluate_plan() — the
 * function the bot itself uses at 11:45 to say what happened to the 8:45
 * plan: trigger = a 15-min CLOSE beyond the entry (15-min bars anchored at
 * 09:15 IST), fill = the first 5-min bar after that which retests the entry
 * (within 25% of the risk) and closes on the right side of the stop, then
 * stop / T1 / T2 in bar order. Entry, stop and targets come from the engine
 * untouched; with no candles there is no status beyond WATCH.
 */
import type { Candle, PlanStatus, Scenario } from "./types";

export type SetupStatus = "WATCH" | "TRIGGERED" | "ACTIVE" | "COMPLETED" | "INVALIDATED";
export const STATUS_ORDER: SetupStatus[] = ["TRIGGERED", "ACTIVE", "WATCH", "COMPLETED", "INVALIDATED"];

export interface Tracking {
  status: SetupStatus;
  engine: PlanStatus; // the evaluate_plan() result itself
  tracked: boolean; // false = no candles to replay
  note: string;
}

const IST_OFFSET = 330 * 60; // seconds
const ANCHOR = 9 * 3600 + 15 * 60; // 09:15 IST, seconds after midnight

interface Bar15 {
  start: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** levels.resample(day, 15): 15-min bars anchored at 09:15, label/closed left. */
export function resample15(day: Candle[]): Bar15[] {
  const out = new Map<number, Bar15>();
  for (const c of day) {
    const local = c.time + IST_OFFSET;
    const midnight = local - (local % 86400);
    const start = midnight + ANCHOR + Math.floor((local - midnight - ANCHOR) / 900) * 900 - IST_OFFSET;
    const b = out.get(start);
    if (!b) out.set(start, { start, open: c.open, high: c.high, low: c.low, close: c.close });
    else {
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      b.close = c.close;
    }
  }
  return [...out.values()].sort((a, b) => a.start - b.start);
}

const iso = (t: number) => new Date(t * 1000).toISOString();
const r2 = (x: number) => Math.round(x * 100) / 100;

/** planner.evaluate_plan(sc, day) — `day` = one session's 5-min bars, oldest first. */
export function evaluatePlan(sc: Pick<Scenario, "side" | "entry" | "stop" | "t1" | "t2"> | null | undefined, day: Candle[]): PlanStatus {
  if (!sc || sc.entry == null || sc.stop == null || sc.t1 == null || sc.t2 == null || !day.length) return { status: "n/a" };
  const up = sc.side === "bull";
  const e = sc.entry, s = sc.stop, t1 = sc.t1, t2 = sc.t2;
  const b15 = resample15(day);
  const trig = b15.find((b) => (up ? b.close > e : b.close < e));
  if (!trig) return { status: "not triggered" };
  const tTrig = trig.start + 15 * 60;
  const after = day.filter((c) => c.time >= tTrig);
  const tol = Math.abs(e - s) * 0.25;
  const fill = after.find((c) => (up ? c.low <= e + tol && c.close > s : c.high >= e - tol && c.close < s));
  if (!fill) {
    const last = day.at(-1)!.close;
    return {
      status: "triggered, no retest",
      trigger_time: iso(trig.start),
      last: r2(last),
      away_pts: r2(Math.abs(last - e)),
      gapped: trig.start === b15[0].start && (up ? day[0].open > e : day[0].open < e),
    };
  }
  const post = day.filter((c) => c.time >= fill.time);
  let t1Hit: number | null = null;
  for (const c of post) {
    const hitStop = up ? c.low <= s : c.high >= s;
    if (t1Hit === null && hitStop) return { status: "stopped out", fill_time: iso(fill.time), exit_time: iso(c.time) };
    if (t1Hit !== null && (up ? c.low <= e : c.high >= e))
      return { status: "T1 hit, rest stopped at entry", fill_time: iso(fill.time), t1_time: iso(t1Hit) };
    if (t1Hit === null && (up ? c.high >= t1 : c.low <= t1)) t1Hit = c.time;
    if (t1Hit !== null && (up ? c.high >= t2 : c.low <= t2))
      return { status: "T2 hit", fill_time: iso(fill.time), t1_time: iso(t1Hit), t2_time: iso(c.time) };
  }
  const last = day.at(-1)!.close;
  return {
    status: t1Hit !== null ? "T1 hit" : "open",
    fill_time: iso(fill.time),
    t1_time: t1Hit !== null ? iso(t1Hit) : null,
    pnl_pts: r2(up ? last - e : e - last),
    last: r2(last),
  };
}

/** Map the engine's status words onto the site's five tracking states. */
export function toTracking(st: PlanStatus, tracked: boolean): Tracking {
  const m: Record<string, [SetupStatus, string]> = {
    "n/a": ["WATCH", tracked ? "Waiting for the trigger" : "No live prices yet"],
    "not triggered": ["WATCH", "No 15-min close beyond the level yet"],
    "triggered, no retest": ["TRIGGERED", st.gapped ? "Gapped through the level — no retest yet, don't chase" : "Closed beyond the level — waiting for the retest"],
    open: ["ACTIVE", "Retest filled — trade open"],
    "T1 hit": ["ACTIVE", "T1 reached — book half, stop to entry"],
    "T1 hit, rest stopped at entry": ["COMPLETED", "T1 hit, remainder closed at entry"],
    "T2 hit": ["COMPLETED", "T2 reached — trade done"],
    "stopped out": ["INVALIDATED", "Stopped out"],
  };
  const [status, note] = m[st.status] ?? ["WATCH", st.status];
  return { status, engine: st, tracked, note };
}

/** Bars of one IST session (YYYY-MM-DD), optionally only from a time on (unix s). */
export function sessionBars(candles: Candle[], day: string, since?: number): Candle[] {
  return candles.filter((c) => {
    const d = new Date((c.time + IST_OFFSET) * 1000).toISOString().slice(0, 10);
    return d === day && (since === undefined || c.time >= since);
  });
}
