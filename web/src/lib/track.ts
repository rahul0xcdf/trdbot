/**
 * Mechanical tracking of an engine trade setup against actual prices.
 *
 * The setup (entry zone, stop, targets, direction) comes from the engine
 * untouched. This only replays real candles to say what price has done
 * relative to those numbers — the same check a trader does by eye. With no
 * candles there is no status beyond WATCH, and nothing is guessed.
 */
import { parseZone } from "./derive";
import type { Candle, Opportunity } from "./types";

export type SetupStatus = "WATCH" | "TRIGGERED" | "ACTIVE" | "INVALIDATED" | "COMPLETED";

export interface Tracking {
  status: SetupStatus;
  tracked: boolean; // false = no market data to compare against
  enteredAt: number | null;
  t1At: number | null;
  resolvedAt: number | null;
  last: number | null;
  high: number | null;
  low: number | null;
  note: string;
  ambiguous?: boolean;
}

const RECENT_SEC = 15 * 60;

export function trackSetup(op: Opportunity & { side?: "CALL" | "PUT" }, candles: Candle[], since: number): Tracking {
  const zone = parseZone(op.entry_zone);
  const long = (op.side ?? op.option_type) !== "PUT" && op.bias !== "bearish";
  const sl = op.stop_loss ?? null;
  const t1 = op.target_1 ?? null;
  const t2 = op.target_2 ?? null;
  const bars = candles.filter((c) => c.time >= since);
  const base: Tracking = {
    status: "WATCH",
    tracked: bars.length > 0,
    enteredAt: null,
    t1At: null,
    resolvedAt: null,
    last: bars.at(-1)?.close ?? null,
    high: bars.length ? Math.max(...bars.map((b) => b.high)) : null,
    low: bars.length ? Math.min(...bars.map((b) => b.low)) : null,
    note: bars.length ? "Waiting for the entry zone" : "No live prices yet",
  };
  if (!zone || !bars.length) return base;
  const [lo, hi] = zone;

  const hitStop = (c: Candle) => sl !== null && (long ? c.low <= sl : c.high >= sl);
  const hitT1 = (c: Candle) => t1 !== null && (long ? c.high >= t1 : c.low <= t1);
  const hitT2 = (c: Candle) => t2 !== null && (long ? c.high >= t2 : c.low <= t2);
  const inZone = (c: Candle) => c.low <= hi && c.high >= lo;

  for (const c of bars) {
    if (base.enteredAt === null) {
      if (hitStop(c) && !inZone(c)) {
        return { ...base, status: "INVALIDATED", resolvedAt: c.time, note: "Stop level traded before entry" };
      }
      if (inZone(c)) {
        base.enteredAt = c.time;
        // Same candle also reached the stop/target: order inside the bar is unknown.
        if (hitStop(c)) return { ...base, status: "INVALIDATED", resolvedAt: c.time, ambiguous: true, note: "Entry and stop in the same bar" };
      }
      continue;
    }
    const s = hitStop(c);
    const t = hitT2(c);
    if (s && (t || hitT1(c))) {
      return { ...base, status: "INVALIDATED", resolvedAt: c.time, ambiguous: true, note: "Stop and target in the same bar — counted as stop" };
    }
    if (s) return { ...base, status: "INVALIDATED", resolvedAt: c.time, note: base.t1At ? "Stopped after Target 1" : "Stop loss hit" };
    if (base.t1At === null && hitT1(c)) base.t1At = c.time;
    if (t) return { ...base, status: "COMPLETED", resolvedAt: c.time, t1At: base.t1At ?? c.time, note: "Target 2 reached" };
  }

  if (base.enteredAt === null) return base;
  const lastT = bars.at(-1)!.time;
  if (base.t1At !== null) return { ...base, status: "ACTIVE", note: "Target 1 reached, running" };
  if (lastT - base.enteredAt <= RECENT_SEC) return { ...base, status: "TRIGGERED", note: "Entry zone just traded" };
  return { ...base, status: "ACTIVE", note: "In the entry zone's trade, no stop or target yet" };
}

export const STATUS_ORDER: SetupStatus[] = ["TRIGGERED", "ACTIVE", "WATCH", "COMPLETED", "INVALIDATED"];
