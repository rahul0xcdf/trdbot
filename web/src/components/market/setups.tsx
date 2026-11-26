"use client";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useCandles, useNow } from "@/lib/client";
import { type SetupItem, scenarioTitle, verdict } from "@/lib/derive";
import { compact, dayIST, isoDateIST, num, timeIST } from "@/lib/format";
import { type SetupStatus, type Tracking, evaluatePlan, sessionBars, toTracking } from "@/lib/track";
import type { OptionCand, Plan, PlanStatus, Scenario, Snapshot } from "@/lib/types";
import { Chip, Tag, clsx } from "../ui";

const STATUS: Record<SetupStatus, { tone: "accent" | "up" | "down" | "neutral" | "info"; text: string }> = {
  WATCH: { tone: "neutral", text: "Watch" },
  TRIGGERED: { tone: "accent", text: "Triggered" },
  ACTIVE: { tone: "info", text: "Active" },
  COMPLETED: { tone: "up", text: "Completed" },
  INVALIDATED: { tone: "down", text: "Stopped" },
};

export function StatusChip({ t }: { t: Tracking }) {
  const s = STATUS[t.status];
  const t1 = t.engine.status === "T1 hit";
  return (
    <Chip tone={s.tone} title={t.note}>
      {t.status === "TRIGGERED" || (t.status === "ACTIVE" && !t1) ? <span className="live-dot size-1.5 rounded-full bg-current" /> : null}
      {s.text}
      {t1 ? " · T1 ✓" : ""}
    </Chip>
  );
}

/**
 * Live status of one scenario: today's 5-min bars replayed through the
 * engine's own evaluate_plan rule. Only for a plan whose day is today.
 */
export function useTracking(item: SetupItem): Tracking & { live: boolean; last: number | null } {
  const now = useNow(60_000);
  const today = isoDateIST(now);
  const live = item.snap.plan_for === today && item.sc.entry != null;
  const { data } = useCandles(live ? item.key : null, "1D");
  return useMemo(() => {
    const since = item.plan.kind === "midday" ? Math.floor(new Date(item.snap.generated_at).getTime() / 1000) : undefined;
    const bars = sessionBars(data?.candles ?? [], today, since);
    const last = bars.at(-1)?.close ?? null;
    if (!live) {
      const t = toTracking({ status: "n/a" }, false);
      const day = item.snap.plan_for;
      return { ...t, live, last, note: day && day > today ? `Plan for ${dayIST(day + "T12:00:00+05:30")} — tracking starts at 9:15 AM` : "Past session — see Performance" };
    }
    return { ...toTracking(evaluatePlan(item.sc, bars), bars.length > 0), live, last };
  }, [data, item, live, today]);
}

/**
 * A horizontal price track: stop … trigger … T1 … T2. The scale is the
 * scenario's own levels; a live price outside it is pinned to the edge.
 */
export function SetupTrack({ sc, last }: { sc: Scenario; last: number | null }) {
  const pts = [sc.stop, sc.entry, sc.t1, sc.t2].filter((x): x is number => typeof x === "number");
  if (pts.length < 3 || sc.entry == null) return null;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const pad = (hi - lo) * 0.1 || 1;
  const x = (v: number) => Math.min(100, Math.max(0, ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100));
  const up = sc.side === "bull";
  const marks = [
    { v: sc.stop, label: "SL", cls: "bg-down" },
    { v: sc.entry, label: sc.how === "pullback" ? "Entry" : "Trigger", cls: "bg-accent w-[3px]" },
    { v: sc.t1, label: "T1", cls: "bg-up" },
    { v: sc.t2, label: "T2", cls: "bg-up" },
  ]
    .filter((m): m is { v: number; label: string; cls: string } => m.v != null)
    .sort((a, b) => a.v - b.v);
  const outside = last !== null && (last < lo - pad || last > hi + pad);
  return (
    <div className="relative mt-1 mb-1 h-[58px]">
      <div className="absolute top-1.5 right-0 left-0 h-px bg-line-strong" />
      {marks.map((m, i) => (
        <div key={m.label} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${x(m.v)}%` }}>
          <span className={clsx("h-3 w-px", m.cls)} />
          {/* alternate rows so close levels don't collide */}
          <span className={clsx("flex flex-col items-center", i % 2 ? "mt-[19px]" : "mt-1")}>
            <span className="text-[10px] leading-none whitespace-nowrap text-dim">{m.label}</span>
            <span className="num mt-0.5 text-[11px] leading-none text-ink-2">{num(m.v, 0)}</span>
          </span>
        </div>
      ))}
      {last !== null ? (
        <div className="absolute -top-1 -translate-x-1/2" style={{ left: `${x(last)}%` }} title={`Last ${num(last)}${outside ? " (off this scale)" : ""}`}>
          <span
            className={clsx(
              "block size-[9px] rotate-45 rounded-[2px] border-2 border-bg",
              up ? (last >= sc.entry ? "bg-up" : "bg-ink") : last <= sc.entry ? "bg-down" : "bg-ink",
              outside && "opacity-60",
            )}
          />
        </div>
      ) : null}
    </div>
  );
}

export function SetupCard({ item, expanded = false }: { item: SetupItem; expanded?: boolean }) {
  const { sc, snap, plan } = item;
  const t = useTracking(item);
  const [open, setOpen] = useState(expanded);
  const v = verdict(sc);
  const o = sc.option;
  const up = item.side === "bull";
  return (
    <article id={`${item.key}-${item.side}`} className={clsx("panel flex h-full flex-col overflow-hidden", item.best && "ring-1 ring-accent-line")}>
      <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-semibold tracking-[-0.02em]">{item.label}</span>
            {item.best ? <Chip tone="accent">Best setup</Chip> : item.secondary ? <Chip>Secondary</Chip> : null}
          </div>
          <p className={clsx("mt-0.5 text-sm", up ? "text-up" : "text-down")}>{scenarioTitle(plan.kind, item.side, sc)}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {v.ok ? <Chip tone="up">Valid</Chip> : <Chip tone="down" title={v.text}>No trade</Chip>}
          {t.live && sc.entry != null ? <StatusChip t={t} /> : null}
        </div>
      </div>

      {sc.entry == null ? (
        <p className="mx-4 mt-3 rounded-xl border border-line bg-bg-sunk px-3 py-2.5 text-sm text-ink-2 sm:mx-5">{sc.reason ?? "No setup"}</p>
      ) : (
        <>
          {sc.trigger_zone ? (
            <p className="px-4 pt-2 text-xs text-dim sm:px-5">
              Key level <span className="num text-ink">{num(sc.trigger_zone.price, 0)}</span> · {sc.trigger_zone.names.join(" + ")}
            </p>
          ) : null}
          <dl className="mx-4 mt-3 grid grid-cols-4 overflow-hidden rounded-2xl border border-line bg-bg-sunk/60 sm:mx-5">
            <Cell k={sc.how === "pullback" ? "Entry" : "Trigger"} v={num(sc.entry, 0)} cls="text-accent" />
            <Cell k="Stop" v={num(sc.stop, 0)} cls="text-down" />
            <Cell k="T1" v={num(sc.t1, 0)} cls="text-up" />
            <Cell k="T2" v={num(sc.t2, 0)} cls="text-up" />
          </dl>
          <div className="px-4 pt-3 sm:px-5">
            <SetupTrack sc={sc} last={t.last} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-1 text-xs text-dim sm:px-5">
            <span>
              R:R <span className={clsx("num", sc.rr_ok ? "text-ink-2" : "text-down")}>1:{sc.rr1}</span> / <span className="num text-ink-2">1:{sc.rr2}</span>
            </span>
            <span>
              Risk <span className="num text-ink-2">{num(sc.risk_pts, 0)} pts</span>
            </span>
            {sc.target_note ? <span className="truncate">{sc.target_note}</span> : null}
          </div>
          {!v.ok ? <p className="mx-4 mt-2 rounded-lg bg-down-muted px-3 py-1.5 text-xs text-down sm:mx-5">{v.text}</p> : null}
          {t.live ? (
            <p className="px-4 pt-2 text-xs text-ink-2 sm:px-5">
              {t.note}
              {t.engine.fill_time ? ` · filled ${timeIST(t.engine.fill_time)}` : t.engine.trigger_time ? ` · triggered ${timeIST(t.engine.trigger_time)}` : ""}
            </p>
          ) : (
            <p className="px-4 pt-2 text-xs text-dim sm:px-5">{t.note}</p>
          )}

          <OptionBlock sc={sc} />

          <button onClick={() => setOpen((x) => !x)} className="press mt-3 flex items-center justify-between border-t border-line px-4 py-3 text-sm text-ink-2 hover:text-ink sm:px-5">
            Confirmation, exit and invalidation
            <ChevronDown className={clsx("size-4 transition-transform", open && "rotate-180")} />
          </button>
          {open ? <ScenarioRules sc={sc} /> : null}
        </>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-2xs text-dim sm:px-5">
        <Tag kind="engine">
          {plan.kind === "midday" ? "11:45 re-plan" : plan.kind === "tomorrow" ? "6 PM plan" : "8:45 plan"} · {timeIST(snap.generated_at)}
        </Tag>
        <span className="whitespace-nowrap" title="Status = the engine's evaluate_plan rule on live 5-min bars">{t.live ? (t.tracked ? "Live" : "Waiting for bars") : "Not tracked"}</span>
      </div>
    </article>
  );
}

function Cell({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-l border-line px-2.5 py-2.5 first:border-l-0">
      <dt className="text-2xs text-dim">{k}</dt>
      <dd className={clsx("num text-[13.5px] font-medium whitespace-nowrap", cls)}>{v}</dd>
    </div>
  );
}

const rupees = (x: number | null | undefined) => (x == null ? "—" : `₹${Math.round(x).toLocaleString("en-IN")}`);

/** The option the engine picked for this scenario (planner.attach_option). */
export function OptionBlock({ sc }: { sc: Scenario }) {
  const o = sc.option;
  if (!o) return sc.option_note ? <p className="mx-4 mt-3 text-xs text-dim sm:mx-5">Option: {sc.option_note}</p> : null;
  const p = o.premiums;
  const z = o.size;
  return (
    <div className="mx-4 mt-3 rounded-2xl border border-line px-3 py-2.5 sm:mx-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="num text-sm font-medium text-ink">{o.name}</span>
        <span className="text-2xs text-dim">
          {o.label} · Δ≈{Math.abs(o.delta_at_trigger).toFixed(2)} at trigger{o.dte != null ? ` · ${o.dte}d to expiry` : ""}
        </span>
      </div>
      <p className="num mt-1 text-xs text-ink-2">
        Premium (est.) ₹{p.entry} → SL ₹{p.stop} · T1 ₹{p.t1} · T2 ₹{p.t2}
      </p>
      <p className="mt-1 text-xs">
        {z.lots >= 1 ? (
          <span className="text-ink-2">
            Size <span className="num text-ink">{z.lots} lot</span> ({z.lots * o.lot} qty) · risk ≈ <span className="num">{rupees(z.risk_total)}</span>{" "}
            <span className="text-dim">(≤ {rupees(z.budget)} max)</span>
          </span>
        ) : (
          <span className="text-down">
            1 lot risks ≈ {rupees(z.risk_per_lot)} &gt; your max {rupees(z.budget)} → no trade at this capital (needs ≥ {rupees(z.capital_for_1_lot)})
          </span>
        )}
      </p>
      {o.expiry_note && o.expiry_note !== "nearest expiry" ? <p className="mt-1 text-2xs text-dim">{o.expiry_note}</p> : null}
    </div>
  );
}

/** Confirmation / exit / invalidation text + the ATM vs ITM comparison. */
export function ScenarioRules({ sc }: { sc: Scenario }) {
  return (
    <div className="space-y-3 px-4 pb-4 text-sm sm:px-5">
      {sc.confirm ? <Rule k="Confirm before entering">{sc.confirm}</Rule> : null}
      {sc.exit_rule ? <Rule k="Exit">{sc.exit_rule}</Rule> : null}
      {sc.invalidation ? <Rule k="Invalid if">{sc.invalidation}</Rule> : null}
      {sc.option_cands?.length ? <StrikeCompare cands={sc.option_cands} pick={sc.option?.strike} /> : null}
    </div>
  );
}

function Rule({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-1">{k}</p>
      <p className="leading-relaxed text-ink-2">{children}</p>
    </div>
  );
}

/** options.compare_strikes(): ATM vs 1-ITM vs 2-ITM at the trigger. */
export function StrikeCompare({ cands, pick }: { cands: OptionCand[]; pick?: number }) {
  return (
    <div>
      <p className="eyebrow mb-1.5">ATM vs ITM at the trigger</p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[520px] text-xs">
          <thead className="text-2xs text-dim">
            <tr className="border-b border-line">
              {["Strike", "LTP", "Δ @trigger", "IV", "θ/day", "OI (Δ)", "Volume", "Liquidity"].map((h) => (
                <th key={h} className="px-2.5 py-1.5 text-left font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="num">
            {cands.map((c) => (
              <tr key={c.label} className={clsx("border-b border-line last:border-0", c.strike === pick && "bg-accent-muted")}>
                <td className="px-2.5 py-1.5 text-ink">
                  {c.label} {num(c.strike, 0)}
                  {c.kind}
                  {c.strike === pick ? <span className="ml-1 text-accent">✓</span> : null}
                </td>
                <td className="px-2.5 py-1.5">₹{num(c.ltp, 1)}</td>
                <td className="px-2.5 py-1.5">{Math.abs(c.delta_at_trigger).toFixed(2)}</td>
                <td className="px-2.5 py-1.5">
                  {c.iv}%{c.iv_source !== "chain" ? "*" : ""}
                </td>
                <td className="px-2.5 py-1.5">{c.theta_day > 0 ? "+" : ""}{c.theta_day.toFixed(1)}</td>
                <td className="px-2.5 py-1.5">
                  {compact(c.oi)} ({compact(c.chg_oi)})
                </td>
                <td className="px-2.5 py-1.5">{compact(c.volume)}</td>
                <td className={clsx("px-2.5 py-1.5 font-sans", c.liq.ok ? "text-ink-2" : "text-down")}>{c.liq.words}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-2xs text-dim">The engine prefers 1-ITM when its delta at the trigger is 0.55–0.72 and it is liquid; else liquid ATM; never far-OTM. * IV from India VIX.</p>
    </div>
  );
}

/* ── No-trade band (reports._no_trade_block) ─────────────────────────────── */

export function NoTradeBand({ snap, plan, label }: { snap: Snapshot; plan: Plan; label: string }) {
  const nt = plan.no_trade;
  if (!nt?.low || !nt?.high) return null;
  const gap = plan.gap_pct;
  const vix = snap.data?.vix?.last;
  const rules = [
    ...(plan.kind === "premarket" && gap != null && Math.abs(gap) >= 0.6 ? [`a ${gap > 0 ? "+" : ""}${gap.toFixed(1)}% gap — wait 30 minutes for the gap to hold or fade`] : []),
    "the first 15 minutes (9:15–9:30) — never enter on the opening candles",
    "price keeps crossing VWAP (3+ times) — that's chop",
    "NIFTY and BANK NIFTY move in opposite directions",
    ...(vix != null && vix >= 18 ? [`India VIX (${vix}) rising further — stops get hunted`] : []),
    ...(snap.data?.events_today ?? []).filter((e) => e.impact === "HIGH").map((e) => `${e.event}${e.time ? ` at ${e.time}` : ""} — no trade until it's out`),
  ];
  return (
    <div className="rounded-2xl border border-dashed border-line-strong px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-ink">
          {plan.kind === "midday" ? "3. Range-bound" : "C — No-trade / sideways"} · {label}
        </p>
        <p className="num text-sm text-ink">
          {num(nt.low, 0)} – {num(nt.high, 0)}
        </p>
      </div>
      <p className="mt-1 text-xs text-ink-2">Inside this band there is no edge, only noise. Wait for a 15-min candle closing outside it with rising volume, then a retest that holds.</p>
      {plan.kind !== "midday" ? (
        <ul className="mt-2 space-y-0.5 text-2xs text-dim">
          {rules.map((r, i) => (
            <li key={i}>· Setup invalid during {r}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ── What happened to the 8:45 plan, as judged by the bot at 11:45 ───────── */

export function statusWords(sc: Partial<Scenario> | undefined, st: PlanStatus | undefined): string {
  const s = st?.status ?? "n/a";
  const lvl = num(sc?.entry, 0);
  switch (s) {
    case "not triggered":
      return `${lvl}: not triggered`;
    case "triggered, no retest":
      return `${lvl}: ${st?.gapped ? "gapped through it at the open" : `triggered at ${timeIST(st?.trigger_time)}`}, no retest yet — ${num(st?.away_pts, 0)} pts away, do NOT chase`;
    case "open":
      return `${lvl}: entered ~${timeIST(st?.fill_time)}, open (${(st?.pnl_pts ?? 0) >= 0 ? "+" : ""}${num(st?.pnl_pts, 0)} pts) — SL ${num(sc?.stop, 0)}`;
    case "T1 hit":
      return `${lvl}: entered, T1 ${num(sc?.t1, 0)} hit — book half, stop to entry`;
    case "T1 hit, rest stopped at entry":
      return `${lvl}: T1 hit, remainder closed at entry`;
    case "T2 hit":
      return `${lvl}: T2 ${num(sc?.t2, 0)} hit — trade done`;
    case "stopped out":
      return `${lvl}: entered then stopped out at ${timeIST(st?.exit_time)} — done, no revenge trade`;
    default:
      return `${lvl}: ${s}`;
  }
}
