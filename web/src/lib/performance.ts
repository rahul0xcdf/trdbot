/**
 * Analysis vs actual market.
 *
 * For each 8:45 AM plan, replay that session's real 5-minute candles through
 * the engine's own rule (planner.evaluate_plan, ported in track.ts) to see
 * what happened to Scenario A and B. Nothing is scored until real candles
 * exist for that session: no candles → "awaiting data", never a guess.
 * When the bot's 11:45 report also judged the morning plan, that verdict is
 * shown alongside as a cross-check.
 */
import "server-only";
import { isoDateIST } from "./format";
import { INDEX_LABEL, scenarioTitle, usable, verdict } from "./derive";
import { getCandles } from "./market";
import { resolveInstrument } from "./instruments";
import { evaluatePlan, sessionBars } from "./track";
import type { Candle, IndexKey, PlanStatus, Side, Snapshot } from "./types";
import { INDEX_KEYS } from "./types";

export type Outcome = "T2" | "T1" | "T1_BE" | "STOP" | "OPEN" | "NO_FILL" | "NO_TRIGGER" | "PENDING" | "NO_DATA";

export interface ScenarioResult {
  index: IndexKey;
  label: string;
  side: Side;
  title: string;
  entry: number | null;
  stop: number | null;
  t1: number | null;
  t2: number | null;
  rr1: number | null;
  usable: boolean; // passed every engine filter (the engine would take it)
  verdict: string;
  best: boolean;
  outcome: Outcome;
  basis: "5m" | "15m" | "none";
  replay: PlanStatus | null;
  engineMidday: PlanStatus | null; // the bot's own 11:45 assessment, if published
  note: string;
}

export interface ReportResult {
  snapshotId: string;
  generated_at: string;
  day: string;
  market_bias: string | null;
  action: string | null;
  confidence: string | null;
  best: string | null;
  pending: boolean;
  results: ScenarioResult[];
  demo?: boolean;
}

function sessionDone(day: string, now = new Date()) {
  const today = isoDateIST(now);
  if (day < today) return true;
  const ist = new Date(now.getTime() + 330 * 60_000);
  return day === today && ist.getUTCHours() * 60 + ist.getUTCMinutes() >= 15 * 60 + 30;
}

function outcomeOf(st: PlanStatus, done: boolean): Outcome {
  switch (st.status) {
    case "T2 hit":
      return "T2";
    case "T1 hit, rest stopped at entry":
      return "T1_BE";
    case "stopped out":
      return "STOP";
    case "T1 hit":
      return "T1";
    case "open":
      return done ? "OPEN" : "PENDING";
    case "triggered, no retest":
      return done ? "NO_FILL" : "PENDING";
    case "not triggered":
      return done ? "NO_TRIGGER" : "PENDING";
    default:
      return done ? "NO_DATA" : "PENDING";
  }
}

export async function evaluateReports(premarkets: Snapshot[], middays: Snapshot[] = []): Promise<ReportResult[]> {
  const cache = new Map<string, Promise<Candle[]>>();
  const candles = (key: IndexKey, tf: "5m" | "15m") => {
    const k = `${key}|${tf}`;
    if (!cache.has(k)) {
      cache.set(k, getCandles(resolveInstrument(key), tf === "5m" ? "1mo" : "60d", tf).then((s) => s.candles));
    }
    return cache.get(k)!;
  };
  const now = Date.now();

  return Promise.all(
    premarkets.map(async (s): Promise<ReportResult> => {
      const day = s.plan_for ?? s.trade_date ?? isoDateIST(s.generated_at);
      const done = sessionDone(day);
      const ageDays = (now - new Date(day + "T09:15:00+05:30").getTime()) / 86_400_000;
      const tf: "5m" | "15m" | null = ageDays <= 25 ? "5m" : ageDays <= 55 ? "15m" : null;
      const mid = middays.find((m) => (m.plan_for ?? m.trade_date) === day);
      const results: ScenarioResult[] = [];
      for (const key of INDEX_KEYS) {
        const plan = s.indices?.[key]?.plan;
        if (!plan) continue;
        const bars = tf ? sessionBars(await candles(key, tf), day) : [];
        for (const side of ["bull", "bear"] as Side[]) {
          const sc = plan[side];
          if (!sc || sc.entry == null) continue;
          const v = verdict(sc);
          const base = {
            index: key,
            label: s.indices[key]?.label ?? INDEX_LABEL[key],
            side,
            title: scenarioTitle(plan.kind, side, sc),
            entry: sc.entry ?? null,
            stop: sc.stop ?? null,
            t1: sc.t1 ?? null,
            t2: sc.t2 ?? null,
            rr1: sc.rr1 ?? null,
            usable: usable(sc),
            verdict: v.text,
            best: s.decision?.best?.index === key && s.decision.best.side === side,
            engineMidday: mid?.indices?.[key]?.plan?.morning?.status?.[side] ?? null,
          };
          if (!bars.length) {
            results.push({
              ...base,
              outcome: done ? "NO_DATA" : "PENDING",
              basis: "none",
              replay: null,
              note: !tf ? "Older than Yahoo's intraday history (60 days)" : done ? "No price data for that session" : "Session not started",
            });
            continue;
          }
          const st = evaluatePlan(sc, bars);
          results.push({
            ...base,
            outcome: outcomeOf(st, done),
            basis: tf!,
            replay: st,
            note: tf === "15m" ? "Replayed on 15-min bars (5-min no longer available) — fills are approximate" : "Replayed on 5-min bars",
          });
        }
      }
      return {
        snapshotId: s.id,
        generated_at: s.generated_at,
        day,
        market_bias: s.decision?.market_bias ?? null,
        action: s.decision?.action ?? null,
        confidence: s.decision?.confidence ?? null,
        best: s.decision?.best?.name ?? null,
        pending: !done,
        results,
        demo: s.demo,
      };
    }),
  );
}
