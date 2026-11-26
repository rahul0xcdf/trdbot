/**
 * Selectors over engine snapshots.
 *
 * Rule for this file: it only SELECTS, MERGES and LABELS values the engine
 * already produced. It never computes a bias, a level or a recommendation.
 */
import { isoDateIST, parseNseDate, toDate } from "./format";
import type {
  AiPremarketAnalysis,
  Opportunity,
  OptionChain,
  Session,
  Snapshot,
  SnapshotMeta,
  TerminalState,
} from "./types";

export const SESSION_LABEL: Record<Session, string> = {
  evening: "Evening wrap",
  premarket: "Pre-market brief",
  afternoon: "Afternoon update",
  ai_premarket: "AI pre-market report",
};

export const SESSION_SHORT: Record<Session, string> = {
  evening: "Evening",
  premarket: "Pre-market",
  afternoon: "Afternoon",
  ai_premarket: "AI report",
};

/** Scheduled time per the engine's chain.py (8:15 / 14:00 / 18:00 IST). */
export const SESSION_SCHEDULE: Partial<Record<Session, string>> = {
  premarket: "08:15",
  afternoon: "14:00",
  evening: "18:00",
};

export function snapshotId(session: string, generatedAt: string): string {
  const d = toDate(generatedAt) ?? new Date();
  const ist = new Date(d.getTime() + 330 * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}${p(ist.getUTCMonth() + 1)}${p(ist.getUTCDate())}-${p(ist.getUTCHours())}${p(
    ist.getUTCMinutes(),
  )}${p(ist.getUTCSeconds())}-${session}`;
}

export function isAi(s: Snapshot | null | undefined): s is Snapshot & { analysis: AiPremarketAnalysis } {
  return !!s && s.analysis?.kind === "ai_premarket";
}

export function opportunities(s: Snapshot | null | undefined): (Opportunity & { side: "CALL" | "PUT" })[] {
  if (!isAi(s)) return [];
  const a = s.analysis;
  return [
    ...(a.call_opportunities ?? []).map((o) => ({ ...o, side: "CALL" as const })),
    ...(a.put_opportunities ?? []).map((o) => ({ ...o, side: "PUT" as const })),
  ];
}

export function toMeta(s: Snapshot): SnapshotMeta {
  const nifty = s.data.option_chains?.NIFTY;
  const ops = opportunities(s);
  const symbols = new Set<string>();
  if (s.data.option_chains?.NIFTY || s.data.indices?.["NIFTY 50"]) symbols.add("NIFTY");
  if (s.data.option_chains?.BANKNIFTY || s.data.indices?.["NIFTY BANK"]) symbols.add("BANKNIFTY");
  ops.forEach((o) => symbols.add(o.symbol));
  return {
    id: s.id,
    session: s.session,
    generated_at: s.generated_at,
    trade_date: s.trade_date,
    bias: isAi(s) ? s.analysis.market_outlook?.sentiment ?? null : null,
    nifty: s.data.indices?.["NIFTY 50"]?.last ?? nifty?.spot ?? null,
    support: nifty?.top_put_oi_strikes?.[0] ?? (isAi(s) ? s.analysis.nifty_levels?.supports?.[0] ?? null : null),
    resistance:
      nifty?.top_call_oi_strikes?.[0] ?? (isAi(s) ? s.analysis.nifty_levels?.resistances?.[0] ?? null : null),
    setups: ops.length,
    symbols: [...symbols],
    demo: s.demo,
  };
}

/** The most recent of the three scheduled reports. */
export function latestScheduled(state: TerminalState): Snapshot | null {
  const xs = (["premarket", "afternoon", "evening"] as Session[])
    .map((k) => state.latest[k])
    .filter(Boolean) as Snapshot[];
  xs.sort((a, b) => +new Date(b.generated_at) - +new Date(a.generated_at));
  return xs[0] ?? null;
}

export const SCHEDULED: Session[] = ["premarket", "afternoon", "evening"];

/** Latest snapshot carrying a value for `pick`, newest first (optionally only some sessions). */
export function latestWith<T>(state: TerminalState, pick: (s: Snapshot) => T | null | undefined, sessions?: Session[]): { value: T; snap: Snapshot } | null {
  const xs = (Object.values(state.latest).filter((s) => s && (!sessions || sessions.includes(s.session))) as Snapshot[]).sort(
    (a, b) => +new Date(b.generated_at) - +new Date(a.generated_at),
  );
  for (const s of xs) {
    const v = pick(s);
    if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) return { value: v, snap: s };
  }
  return null;
}

/** Is this AI report for the session that is trading today (IST)? */
export function isForToday(s: Snapshot | null | undefined, now = new Date()): boolean {
  if (!s) return false;
  return isoDateIST(s.generated_at) === isoDateIST(now);
}

export interface EngineBias {
  sentiment: string | null;
  recommendation: string | null;
  confidence: number | null;
  probs: { bullish: number | null; rangebound: number | null; bearish: number | null };
  why: string | null;
  plan: { style?: string; why?: string } | null;
  noTrade: boolean;
  noTradeReason: string | null;
  snap: Snapshot;
  current: boolean;
}

/** The engine's own bias — only the AI pre-market report publishes one. */
export function engineBias(state: TerminalState, now = new Date()): EngineBias | null {
  const s = state.latest.ai_premarket;
  if (!isAi(s)) return null;
  const mo = s.analysis.market_outlook ?? {};
  return {
    sentiment: mo.sentiment ?? null,
    recommendation: mo.recommendation ?? null,
    confidence: mo.confidence ?? null,
    probs: { bullish: mo.bullish_prob ?? null, rangebound: mo.rangebound_prob ?? null, bearish: mo.bearish_prob ?? null },
    why: mo.why ?? null,
    plan: s.analysis.trading_plan ?? null,
    noTrade: !!s.analysis.no_trade,
    noTradeReason: s.analysis.no_trade_reason || null,
    snap: s,
    current: isForToday(s, now),
  };
}

/* ── Levels ──────────────────────────────────────────────────────────────── */

export type LevelKind = "resistance" | "support" | "max_pain" | "entry" | "stop" | "target";

export interface LevelSource {
  name: string; // e.g. "Call OI #1 (NSE chain)"
  snapshotId: string;
  session: Session;
  time: string;
}

export interface Level {
  price: number;
  kind: LevelKind;
  label: string;
  sources: LevelSource[];
  /** OI at the strike relative to the largest OI in the published chain (0–100). Raw-data visualisation. */
  oiStrength?: number;
  oi?: number;
  rank?: number;
}

function chainOi(chain: OptionChain, strike: number, side: "ce" | "pe"): number | undefined {
  const row = chain.strikes?.find((r) => r.strike === strike);
  const v = row ? (side === "ce" ? row.ce_oi : row.pe_oi) : undefined;
  return v ?? undefined;
}

function maxOi(chain: OptionChain, side: "ce" | "pe"): number {
  return Math.max(0, ...(chain.strikes ?? []).map((r) => (side === "ce" ? r.ce_oi : r.pe_oi) ?? 0));
}

/**
 * Engine levels for NIFTY / BANKNIFTY, merged across:
 *  - the latest option chain the engine published (top call-OI strikes = resistance,
 *    top put-OI strikes = support, max pain — exactly as reports.py labels them)
 *  - the AI pre-market report's nifty_levels / banknifty_levels
 */
export function engineLevels(state: TerminalState, chainKey: "NIFTY" | "BANKNIFTY", topN = 3): Level[] {
  const out = new Map<string, Level>();
  const add = (price: number, kind: LevelKind, label: string, src: LevelSource, extra: Partial<Level> = {}) => {
    const k = `${kind === "max_pain" ? "mp" : kind}:${price}`;
    const hit = out.get(k);
    if (hit) {
      hit.sources.push(src);
      const h = hit as unknown as Record<string, unknown>;
      for (const [f, v] of Object.entries(extra)) if (h[f] === undefined) h[f] = v;
    } else out.set(k, { price, kind, label, sources: [src], ...extra });
  };

  const chainHit = latestWith(state, (s) => s.data.option_chains?.[chainKey]);
  if (chainHit) {
    const { value: c, snap } = chainHit;
    const src = (name: string): LevelSource => ({ name, snapshotId: snap.id, session: snap.session, time: snap.generated_at });
    const ceMax = maxOi(c, "ce");
    const peMax = maxOi(c, "pe");
    c.top_call_oi_strikes.slice(0, topN).forEach((k, i) => {
      const oi = chainOi(c, k, "ce");
      add(k, "resistance", "Resistance", src(`Call OI #${i + 1}`), {
        rank: i + 1,
        oi,
        oiStrength: oi !== undefined && ceMax ? Math.round((oi / ceMax) * 100) : undefined,
      });
    });
    c.top_put_oi_strikes.slice(0, topN).forEach((k, i) => {
      const oi = chainOi(c, k, "pe");
      add(k, "support", "Support", src(`Put OI #${i + 1}`), {
        rank: i + 1,
        oi,
        oiStrength: oi !== undefined && peMax ? Math.round((oi / peMax) * 100) : undefined,
      });
    });
    if (c.max_pain !== null) add(c.max_pain, "max_pain", "Max pain", src("Max pain"));
  }

  // AI levels only while that report is for today's session — never mix in a stale report.
  const ai = state.latest.ai_premarket;
  if (isAi(ai) && isForToday(ai, new Date(state.server_time))) {
    const lv = chainKey === "NIFTY" ? ai.analysis.nifty_levels : ai.analysis.banknifty_levels;
    const src = (name: string): LevelSource => ({ name, snapshotId: ai.id, session: ai.session, time: ai.generated_at });
    (lv?.resistances ?? []).forEach((p) => add(p, "resistance", "Resistance", src("AI report")));
    (lv?.supports ?? []).forEach((p) => add(p, "support", "Support", src("AI report")));
  }

  return [...out.values()].sort((a, b) => b.price - a.price);
}

/* ── Trade setups ────────────────────────────────────────────────────────── */

/** "1975-1985" / "1975–1985" / "1980" → [lo, hi]. Parsing the engine's text, not judging it. */
export function parseZone(z: string | null | undefined): [number, number] | null {
  if (!z) return null;
  const nums = (z.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (!nums.length) return null;
  const lo = Math.min(...nums.slice(0, 2));
  const hi = Math.max(...nums.slice(0, 2));
  return [lo, hi];
}

export function setupLevels(op: Opportunity, snap: Snapshot): Level[] {
  const src: LevelSource = { name: "AI report", snapshotId: snap.id, session: snap.session, time: snap.generated_at };
  const out: Level[] = [];
  const z = parseZone(op.entry_zone);
  if (z) {
    out.push({ price: z[1], kind: "entry", label: z[0] === z[1] ? "Entry" : "Entry (high)", sources: [src] });
    if (z[0] !== z[1]) out.push({ price: z[0], kind: "entry", label: "Entry (low)", sources: [src] });
  }
  if (op.stop_loss) out.push({ price: op.stop_loss, kind: "stop", label: "Stop loss", sources: [src] });
  if (op.target_1) out.push({ price: op.target_1, kind: "target", label: "Target 1", sources: [src] });
  if (op.target_2) out.push({ price: op.target_2, kind: "target", label: "Target 2", sources: [src] });
  return out.sort((a, b) => b.price - a.price);
}

/** Days until an NSE "dd-Mon-YYYY" date, for expiry chips. */
export function daysUntil(nseDate: string | null | undefined, now = new Date()): number | null {
  const d = parseNseDate(nseDate);
  if (!d) return null;
  const a = new Date(isoDateIST(now) + "T00:00:00+05:30").getTime();
  const b = new Date(isoDateIST(d) + "T00:00:00+05:30").getTime();
  return Math.round((b - a) / 86_400_000);
}
