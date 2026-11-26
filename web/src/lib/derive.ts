/**
 * Selectors over engine snapshots.
 *
 * Rule for this file: it only SELECTS, MERGES and LABELS values the engine
 * already produced (modules/planner.py via modules/publish.py). It never
 * computes a bias, a level, a target or a recommendation.
 */
import { isoDateIST, parseNseDate, toDate } from "./format";
import type {
  IndexKey,
  IndexReport,
  Plan,
  Scenario,
  Session,
  Side,
  Snapshot,
  SnapshotMeta,
  TerminalState,
  Zone,
} from "./types";
import { INDEX_KEYS } from "./types";

export const SESSION_LABEL: Record<Session, string> = {
  premarket: "Pre-market plan",
  midday: "Midday update",
  evening: "Evening wrap",
  monthly: "Monthly event calendar",
};

export const SESSION_SHORT: Record<Session, string> = {
  premarket: "8:45 AM",
  midday: "11:45 AM",
  evening: "6:00 PM",
  monthly: "Monthly",
};

/** Scheduled IST times (chain.py / bot.py FLOW_WINDOWS). Monthly goes out with the first pre-market of the month. */
export const SESSION_SCHEDULE: Partial<Record<Session, string>> = {
  premarket: "08:45",
  midday: "11:45",
  evening: "18:00",
};

export const SCHEDULED: Session[] = ["premarket", "midday", "evening"];

export const SIDE_LABEL: Record<Side, string> = { bull: "Bullish", bear: "Bearish" };

export const INDEX_LABEL: Record<IndexKey, string> = { NIFTY: "NIFTY 50", BANKNIFTY: "BANK NIFTY" };

/** The engine's own scenario titles, as printed in Telegram. */
export function scenarioTitle(kind: Plan["kind"] | undefined, side: Side, sc?: Scenario | null): string {
  if (kind === "midday") {
    const how = sc?.how === "pullback" ? "VWAP pullback" : side === "bull" ? "breakout" : "breakdown";
    return `${side === "bull" ? "1. Bullish" : "2. Bearish"} (${how})`;
  }
  if (kind === "tomorrow") return `Tomorrow's ${side === "bull" ? "bullish" : "bearish"} plan`;
  return side === "bull" ? "A — Bullish" : "B — Bearish";
}

export function snapshotId(session: string, generatedAt: string): string {
  const d = toDate(generatedAt) ?? new Date();
  const ist = new Date(d.getTime() + 330 * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}${p(ist.getUTCMonth() + 1)}${p(ist.getUTCDate())}-${p(ist.getUTCHours())}${p(
    ist.getUTCMinutes(),
  )}${p(ist.getUTCSeconds())}-${session}`;
}

/** planner._usable(): passed R:R, has a liquid option, and 1 lot fits the 1% risk limit. */
export function usable(sc: Scenario | null | undefined): boolean {
  return !!(sc && sc.rr_ok && sc.option && sc.sizing_ok);
}

/** The engine's verdict on one scenario, in its own words. */
export function verdict(sc: Scenario | null | undefined): { ok: boolean; text: string } {
  if (!sc || sc.entry == null) return { ok: false, text: sc?.reason ?? "no setup" };
  if (!sc.rr_ok) return { ok: false, text: sc.reason ?? "R:R below 1:1.5" };
  if (!sc.option) return { ok: false, text: sc.option_note ?? "no liquid option" };
  if (!sc.sizing_ok) return { ok: false, text: "1 lot risks more than your max risk per trade" };
  return { ok: true, text: "valid — wait for confirmation" };
}

export function indexLast(ix: IndexReport | null | undefined): number | null {
  return ix?.intraday?.last ?? ix?.today?.close ?? ix?.prev?.close ?? null;
}

export function toMeta(s: Snapshot): SnapshotMeta {
  const ix = s.indices ?? {};
  let setups = 0;
  for (const k of INDEX_KEYS) for (const side of ["bull", "bear"] as Side[]) if (usable(ix[k]?.plan?.[side])) setups++;
  return {
    id: s.id,
    session: s.session,
    generated_at: s.generated_at,
    trade_date: s.trade_date,
    plan_for: s.plan_for ?? null,
    bias: s.decision?.market_bias ?? null,
    action: s.decision?.action ?? null,
    best: s.decision?.best?.name ?? null,
    nifty: indexLast(ix.NIFTY) ?? s.data?.board?.["NIFTY 50"]?.last ?? null,
    setups,
    demo: s.demo,
  };
}

function newest(xs: (Snapshot | undefined | null)[]): Snapshot[] {
  return (xs.filter(Boolean) as Snapshot[]).sort((a, b) => +new Date(b.generated_at) - +new Date(a.generated_at));
}

/** The most recent of the three scheduled reports. */
export function latestScheduled(state: TerminalState): Snapshot | null {
  return newest(SCHEDULED.map((k) => state.latest[k]))[0] ?? null;
}

export interface ActivePlan {
  snap: Snapshot;
  day: string; // YYYY-MM-DD the plan is for
  isToday: boolean;
}

/**
 * The plan to show now: the newest scheduled report whose plan is for today
 * or later (midday beats 8:45 beats last evening's "tomorrow" plan simply by
 * being newer — the engine re-plans at each report).
 */
export function activePlan(state: TerminalState, now = new Date()): ActivePlan | null {
  const today = isoDateIST(now);
  const s = newest(SCHEDULED.map((k) => state.latest[k])).find((x) => x.plan_for && x.plan_for >= today);
  return s ? { snap: s, day: s.plan_for!, isToday: s.plan_for === today } : null;
}

/** Newest report carrying a value for `pick` (optionally only some sessions). */
export function latestWith<T>(
  state: TerminalState,
  pick: (s: Snapshot) => T | null | undefined,
  sessions?: Session[],
): { value: T; snap: Snapshot } | null {
  const xs = newest(Object.values(state.latest).filter((s) => s && (!sessions || sessions.includes(s.session))));
  for (const s of xs) {
    const v = pick(s);
    if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) return { value: v, snap: s };
  }
  return null;
}

/* ── Levels: the plan's own zones, labelled by role ─────────────────────── */

export type LevelRole = "trigger" | "stop" | "target" | "zone";

export interface Level {
  price: number;
  role: LevelRole;
  label: string; // "Bull trigger", "Bear T1", or the zone names
  names: string[]; // the engine's names for this price (PDH, VAH, call-OI wall…)
  side?: Side;
}

function zoneAt(zones: Zone[] | undefined, price: number | null | undefined): Zone | undefined {
  if (price == null) return undefined;
  return zones?.find((z) => Math.abs(z.price - price) < 0.01);
}

/**
 * Every level in a plan: the clustered zones the engine built
 * (planner.build_scenarios → levels.cluster) plus each scenario's entry,
 * stop and targets. Prices are copied, never computed.
 */
export function planLevels(plan: Plan | null | undefined): Level[] {
  if (!plan) return [];
  const out: Level[] = [];
  const used = new Set<number>();
  for (const side of ["bull", "bear"] as Side[]) {
    const sc = plan[side];
    if (!sc || sc.entry == null) continue;
    const S = side === "bull" ? "Bull" : "Bear";
    const add = (price: number | null | undefined, role: LevelRole, label: string, names: string[] = []) => {
      if (price == null) return;
      const z = zoneAt(plan.zones, price);
      if (z) used.add(z.price);
      out.push({ price, role, label, names: z?.names ?? names, side });
    };
    add(sc.entry, "trigger", `${S} trigger`, sc.trigger_zone?.names ?? []);
    add(sc.stop, "stop", `${S} stop`);
    add(sc.t1, "target", `${S} T1`);
    add(sc.t2, "target", `${S} T2`);
  }
  for (const z of plan.zones ?? []) {
    if (used.has(z.price)) continue;
    out.push({ price: z.price, role: "zone", label: z.names.slice(0, 3).join(" + "), names: z.names });
  }
  return out.sort((a, b) => b.price - a.price);
}

/* ── Setups ──────────────────────────────────────────────────────────────── */

export interface SetupItem {
  snap: Snapshot;
  key: IndexKey;
  label: string;
  side: Side;
  sc: Scenario;
  plan: Plan;
  usable: boolean;
  best: boolean;
  secondary: boolean;
}

export function setupsOf(snap: Snapshot | null | undefined): SetupItem[] {
  if (!snap) return [];
  const out: SetupItem[] = [];
  const d = snap.decision;
  for (const key of INDEX_KEYS) {
    const ix = snap.indices?.[key];
    const plan = ix?.plan;
    if (!plan) continue;
    for (const side of ["bull", "bear"] as Side[]) {
      const sc = plan[side];
      if (!sc) continue;
      out.push({
        snap,
        key,
        label: ix.label ?? INDEX_LABEL[key],
        side,
        sc,
        plan,
        usable: usable(sc),
        best: d?.best?.index === key && d.best.side === side,
        secondary: d?.secondary?.index === key && d.secondary.side === side,
      });
    }
  }
  return out;
}

/** Days until a date ("dd-Mon-YYYY" or ISO), for expiry chips. */
export function daysUntil(dateStr: string | null | undefined, now = new Date()): number | null {
  const d = parseNseDate(dateStr) ?? toDate(dateStr ?? null);
  if (!d) return null;
  const a = new Date(isoDateIST(now) + "T00:00:00+05:30").getTime();
  const b = new Date(isoDateIST(d) + "T00:00:00+05:30").getTime();
  return Math.round((b - a) / 86_400_000);
}
