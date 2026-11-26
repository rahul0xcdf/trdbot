/**
 * Analysis vs actual market — the architecture for performance tracking.
 *
 * For each AI pre-market report, replay what the market actually did against
 * the engine's own numbers. Nothing is scored until real candles exist for
 * that session: no candles → "awaiting data", never a guess.
 */
import "server-only";
import { isoDateIST } from "./format";
import { opportunities, parseZone } from "./derive";
import { getCandles } from "./market";
import { resolveInstrument } from "./instruments";
import { trackSetup, type Tracking } from "./track";
import type { AiPremarketAnalysis, Candle, Snapshot } from "./types";

export type Outcome = "T2" | "T1" | "STOP" | "OPEN" | "NO_ENTRY" | "AMBIGUOUS" | "PENDING" | "NO_DATA";

export interface SetupResult {
  symbol: string;
  side: "CALL" | "PUT";
  entry_zone?: string;
  stop_loss?: number;
  target_1?: number;
  target_2?: number;
  outcome: Outcome;
  basis: "15m" | "1d" | "none";
  tracking?: Tracking;
  day?: { high: number; low: number; close: number };
  note: string;
}

export interface LevelResult {
  price: number;
  kind: "support" | "resistance";
  tested: boolean;
}

export interface ReportResult {
  snapshotId: string;
  generated_at: string;
  day: string;
  sentiment: string | null;
  recommendation: string | null;
  confidence: number | null;
  pending: boolean;
  nifty?: { day: { open: number; high: number; low: number; close: number } | null; levels: LevelResult[] };
  setups: SetupResult[];
  demo?: boolean;
}

const istDay = (unix: number) => isoDateIST(unix * 1000);

function sessionDone(day: string, now = new Date()) {
  const today = isoDateIST(now);
  if (day < today) return true;
  const ist = new Date(now.getTime() + 330 * 60_000);
  return day === today && ist.getUTCHours() * 60 + ist.getUTCMinutes() >= 15 * 60 + 30;
}

export async function evaluateReports(snaps: Snapshot[]): Promise<ReportResult[]> {
  const cache = new Map<string, Promise<Candle[]>>();
  const candles = (key: string, tf: "15m" | "1d") => {
    const k = `${key}|${tf}`;
    if (!cache.has(k)) {
      const inst = resolveInstrument(key);
      cache.set(k, getCandles(inst, tf === "15m" ? "1mo" : "6mo", tf).then((s) => s.candles));
    }
    return cache.get(k)!;
  };
  const now = Date.now();

  return Promise.all(
    snaps.map(async (s): Promise<ReportResult> => {
      const a = s.analysis as AiPremarketAnalysis;
      const day = isoDateIST(s.generated_at);
      const done = sessionDone(day);
      const ageDays = (now - new Date(s.generated_at).getTime()) / 86_400_000;
      const since = Math.floor(new Date(s.generated_at).getTime() / 1000);

      const niftyDaily = (await candles("NIFTY", "1d")).find((c) => istDay(c.time) === day) ?? null;
      const lv = a.nifty_levels ?? {};
      const niftyLevels: LevelResult[] = [
        ...(lv.resistances ?? []).map((p) => ({ price: p, kind: "resistance" as const })),
        ...(lv.supports ?? []).map((p) => ({ price: p, kind: "support" as const })),
      ].map((l) => ({ ...l, tested: !!niftyDaily && niftyDaily.low <= l.price && l.price <= niftyDaily.high }));

      const setups = await Promise.all(
        opportunities(s).map(async (op): Promise<SetupResult> => {
          const base = { symbol: op.symbol, side: op.side, entry_zone: op.entry_zone, stop_loss: op.stop_loss, target_1: op.target_1, target_2: op.target_2 };
          if (ageDays <= 25) {
            const bars = (await candles(op.symbol, "15m")).filter((c) => istDay(c.time) === day);
            if (bars.length) {
              const t = trackSetup(op, bars, since);
              const outcome: Outcome =
                t.status === "COMPLETED" ? "T2" : t.status === "INVALIDATED" ? (t.ambiguous ? "AMBIGUOUS" : "STOP") : t.t1At ? "T1" : t.enteredAt ? (done ? "OPEN" : "PENDING") : done ? "NO_ENTRY" : "PENDING";
              return { ...base, outcome, basis: "15m", tracking: t, note: t.note };
            }
          }
          const d = (await candles(op.symbol, "1d")).find((c) => istDay(c.time) === day);
          if (!d) return { ...base, outcome: done ? "NO_DATA" : "PENDING", basis: "none", note: done ? "No price data for that session" : "Session not finished" };
          // Daily bar only: we know what traded, not in which order.
          const long = op.side === "CALL";
          const z = parseZone(op.entry_zone);
          const entered = !!z && d.low <= z[1] && d.high >= z[0];
          const hit = (p?: number) => p !== undefined && (long ? d.high >= p : d.low <= p);
          const stop = op.stop_loss !== undefined && (long ? d.low <= op.stop_loss : d.high >= op.stop_loss);
          const t2 = hit(op.target_2);
          const t1 = hit(op.target_1);
          let outcome: Outcome = !entered ? "NO_ENTRY" : stop && (t1 || t2) ? "AMBIGUOUS" : stop ? "STOP" : t2 ? "T2" : t1 ? "T1" : "OPEN";
          if (!done) outcome = "PENDING";
          return { ...base, outcome, basis: "1d", day: { high: d.high, low: d.low, close: d.close }, note: "Daily bar only — order of moves unknown" };
        }),
      );

      return {
        snapshotId: s.id,
        generated_at: s.generated_at,
        day,
        sentiment: a.market_outlook?.sentiment ?? null,
        recommendation: a.market_outlook?.recommendation ?? null,
        confidence: a.market_outlook?.confidence ?? null,
        pending: !done,
        nifty: { day: niftyDaily ? { open: niftyDaily.open, high: niftyDaily.high, low: niftyDaily.low, close: niftyDaily.close } : null, levels: niftyLevels },
        setups,
        demo: s.demo,
      };
    }),
  );
}
