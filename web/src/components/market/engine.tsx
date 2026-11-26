"use client";
import Link from "next/link";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { INDEX_LABEL, SESSION_LABEL, SESSION_SCHEDULE, SESSION_SHORT } from "@/lib/derive";
import { dayIST, isoDateIST, num, timeIST } from "@/lib/format";
import type { Bias, IndexKey, Session, Snapshot, SnapshotMeta, TerminalState } from "@/lib/types";
import { INDEX_KEYS } from "@/lib/types";
import { BiasChip, Chip, Empty, Panel, PanelHead, Tag, clsx } from "../ui";

/* ── Provenance line ─────────────────────────────────────────────────────── */

export function AnalysisStamp({ snap, prefix }: { snap: Snapshot; prefix?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-2xs text-dim">
      <Tag kind="engine">rules</Tag>
      <Link href={`/history/${snap.id}`} className="hover:text-ink-2">
        {prefix ?? SESSION_LABEL[snap.session]} · <span className="num text-ink-2">{timeIST(snap.generated_at)}</span> {dayIST(snap.generated_at)}
      </Link>
    </span>
  );
}

const rupees = (x: number | null | undefined) => (x == null ? "—" : `₹${Math.round(x).toLocaleString("en-IN")}`);

function actionTone(a: string | null | undefined): "up" | "down" | "accent" | "neutral" {
  const s = (a ?? "").toUpperCase();
  if (s.startsWith("NO TRADE") || s.startsWith("EXIT")) return "down";
  if (s.startsWith("ENTER") || s.startsWith("HOLD") || s.startsWith("BOOK")) return "up";
  if (s.startsWith("WAIT")) return "accent";
  return "neutral";
}

export function ActionChip({ action, size = "md" }: { action: string | null | undefined; size?: "md" | "lg" }) {
  if (!action) return <Chip>—</Chip>;
  return (
    <Chip tone={actionTone(action)} className={size === "lg" ? "px-3 py-1 text-xs" : undefined}>
      {action}
    </Chip>
  );
}

/* ── TRADE DECISION (planner.decide → reports._decision_block) ──────────── */

export function DecisionCard({ snap, planDay, compact = false }: { snap: Snapshot | null; planDay?: { day: string; isToday: boolean } | null; compact?: boolean }) {
  if (!snap?.decision)
    return (
      <Panel>
        <PanelHead title="Trade decision" right={<Tag kind="engine" />} />
        <Empty title="No plan published yet">
          The engine sends its plan at 8:45 AM, re-plans at 11:45 AM and sets tomorrow&apos;s plan at 6:00 PM. It appears here the moment a report lands.
        </Empty>
      </Panel>
    );
  const d = snap.decision;
  const best = d.best ? snap.indices?.[d.best.index]?.plan?.[d.best.side] : null;
  const o = best?.option;
  const forDay = snap.plan_for ? dayIST(snap.plan_for + "T12:00:00+05:30") : null;
  const title =
    snap.session !== "evening"
      ? "Trade decision"
      : planDay
        ? planDay.isToday
          ? "Trade decision · for today (set last evening)"
          : "Trade decision · for tomorrow"
        : `Trade decision · for ${forDay ?? "the next session"}`;
  return (
    <Panel>
      <PanelHead title={title} right={<AnalysisStamp snap={snap} />} />
      {planDay && !planDay.isToday ? (
        <div className="flex items-center gap-2 border-b border-line bg-raised px-4 py-2 text-xs text-ink-2">
          <AlertTriangle className="size-3.5 text-accent" />
          Plan for {dayIST(planDay.day + "T12:00:00+05:30")} — the next session, not today.
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <ActionChip action={d.action} size="lg" />
            <Chip tone={d.confidence === "High" ? "up" : d.confidence === "Medium" ? "accent" : "neutral"}>Confidence {d.confidence}</Chip>
          </div>
          <dl className="divide-y divide-line">
            <Row k="Market bias" v={<BiasChip bias={d.market_bias} />} />
            <Row k="Best index" v={d.best ? INDEX_LABEL[d.best.index] : "—"} />
            <Row k="Best setup" v={d.best?.name ?? "none"} wrap />
            {d.secondary ? <Row k="Secondary" v={d.secondary.name ?? "—"} wrap /> : null}
          </dl>
        </div>
        <div className="space-y-3">
          {best && o ? (
            <dl className="divide-y divide-line rounded-xl border border-line px-3">
              <Row k="Option" v={`${o.name} (${o.label}, Δ≈${Math.abs(o.delta_at_trigger).toFixed(2)})`} wrap />
              <Row k="Stop loss" v={`${num(best.stop, 0)} on the index (≈ ₹${o.premiums.stop})`} />
              <Row k="Target" v={`T1 ${num(best.t1, 0)} / T2 ${num(best.t2, 0)} (≈ ₹${o.premiums.t1} / ₹${o.premiums.t2})`} wrap />
              <Row k="Risk / reward" v={`1:${best.rr1} (T1) · 1:${best.rr2} (T2)`} />
              <Row k="Position size" v={`${o.size.lots} lot (${o.size.lots * o.lot} qty) · risk ≈ ${rupees(o.size.risk_total)}`} wrap />
            </dl>
          ) : (
            <p className="rounded-xl border border-line bg-bg-sunk px-3 py-2.5 text-sm text-ink-2">No setup passes every filter — position size 0.</p>
          )}
          {best?.confirm && !compact ? (
            <p className="text-xs leading-relaxed text-ink-2">
              <span className="text-dim">Entry confirmation: </span>
              {best.confirm}
            </p>
          ) : null}
          {d.reason ? (
            <p className={clsx("rounded-lg px-3 py-2 text-xs", d.conflict ? "border border-[#e58c7a40] bg-down-muted text-down" : "bg-raised text-ink-2")}>
              <span className="text-dim">Why: </span>
              {d.reason}
            </p>
          ) : null}
          {!compact
            ? d.size_blocked.map((b, i) => (
                <p key={i} className="text-2xs text-dim">
                  The {INDEX_LABEL[b.index]} {b.side === "bull" ? "bullish" : "bearish"} setup is otherwise valid, but 1 lot risks ≈ {rupees(b.size.risk_per_lot)} — above your
                  per-trade limit ({rupees(b.size.budget)}).
                </p>
              ))
            : null}
          {snap.account?.capital_is_default && !compact ? (
            <p className="text-2xs text-dim">Sizing assumes ₹1,00,000 capital — set the TRADING_CAPITAL repo variable to yours.</p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function Row({ k, v, wrap }: { k: string; v: React.ReactNode; wrap?: boolean }) {
  return (
    <div className={clsx("flex justify-between gap-3 py-2 text-sm", wrap ? "items-start" : "items-center")}>
      <dt className="shrink-0 text-dim">{k}</dt>
      <dd className={clsx("text-right text-ink", !wrap && "num")}>{v}</dd>
    </div>
  );
}

/* ── Per-index bias (planner.score_bias) ─────────────────────────────────── */

export function BiasList({ snap }: { snap: Snapshot }) {
  const rows = INDEX_KEYS.map((k) => [k, snap.indices?.[k]?.plan?.bias] as [IndexKey, Bias | null | undefined]).filter(([, b]) => b);
  if (!rows.length) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map(([k, b]) => (
        <div key={k} className="rounded-xl border border-line bg-bg-sunk px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-ink-2">{INDEX_LABEL[k]}</span>
            <span className="flex items-center gap-1.5">
              <span className="num text-2xs text-dim">score {b!.score > 0 ? "+" : ""}{b!.score}</span>
              <BiasChip bias={b!.bias} />
            </span>
          </div>
          {b!.why.length ? (
            <ul className="mt-1.5 space-y-0.5">
              {b!.why.map((w, i) => (
                <li key={i} className="num text-2xs text-dim">{w}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-2xs text-dim">no strong factor</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── AI narration (ai_engine.narrate) ────────────────────────────────────── */

const AI_TITLES: Record<string, string> = {
  global_read: "Global & Indian factors",
  nifty_read: "NIFTY 50",
  banknifty_read: "BANK NIFTY",
  beginner_tip: "Tip for today",
  what_is_happening: "What is happening now?",
  after_12: "What is likely after 12 PM?",
  nifty_story: "NIFTY 50 today",
  banknifty_story: "BANK NIFTY today",
  tomorrow: "What today tells us about tomorrow",
  lesson: "Trading lesson",
  month_note: "This month",
};

export function AiNotes({ snap, keys, title = "In plain words" }: { snap: Snapshot; keys?: string[]; title?: string }) {
  const ai = snap.ai ?? {};
  const items = (keys ?? Object.keys(ai)).filter((k) => ai[k]);
  if (!items.length) return null;
  return (
    <Panel>
      <PanelHead title={title} right={<Tag kind="engine">{snap.source?.ai_model ?? "AI narration"}</Tag>} />
      <div className="space-y-3 p-4">
        {items.map((k) => (
          <div key={k}>
            <p className="eyebrow mb-1">{AI_TITLES[k] ?? k}</p>
            <p className="text-sm leading-relaxed text-ink">{ai[k]}</p>
          </div>
        ))}
        <p className="border-t border-line pt-3 text-2xs text-dim">
          Gemini only explains the engine&apos;s numbers in words. Every level, trigger, stop, target and size above comes from the fixed rules in planner.py.
        </p>
      </div>
    </Panel>
  );
}

/* ── Session timeline: 6 PM → 8:45 → 9:15 open → 11:45 → 3:30 close → 6 PM ── */

interface Step {
  key: string;
  time: string;
  label: string;
  meta?: SnapshotMeta;
  marker?: boolean;
  state: "done" | "live" | "pending" | "missed";
}

export function SessionTimeline({ state }: { state: TerminalState }) {
  const now = new Date(state.server_time);
  const today = isoDateIST(now);
  const ist = new Date(now.getTime() + 330 * 60_000);
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const weekday = ist.getUTCDay() !== 0 && ist.getUTCDay() !== 6;
  const find = (session: Session, day?: string) => state.timeline.find((m) => m.session === session && (!day || isoDateIST(m.generated_at) === day));
  const evening = state.timeline.find((m) => m.session === "evening" && isoDateIST(m.generated_at) < today);
  const pre = find("premarket", today);
  const mid = find("midday", today);
  const eveToday = find("evening", today);
  const due = (s: Session) => {
    const [h, m] = (SESSION_SCHEDULE[s] ?? "23:59").split(":").map(Number);
    return weekday && mins >= h * 60 + m + 10;
  };
  const st = (meta: SnapshotMeta | undefined, s: Session): Step["state"] => (meta ? "done" : due(s) ? "missed" : "pending");
  const live = weekday && mins >= 555 && mins < 930;
  const steps: Step[] = [
    { key: "eve", time: evening ? timeIST(evening.generated_at) : "06:00 PM", label: "Tomorrow's plan", meta: evening, state: evening ? "done" : "pending" },
    { key: "pre", time: pre ? timeIST(pre.generated_at) : "08:45 AM", label: "Pre-market plan", meta: pre, state: st(pre, "premarket") },
    { key: "open", time: "09:15 AM", label: "Market open", marker: true, state: live ? "live" : weekday && mins >= 930 ? "done" : "pending" },
    { key: "mid", time: mid ? timeIST(mid.generated_at) : "11:45 AM", label: "Midday re-plan", meta: mid, state: st(mid, "midday") },
    { key: "close", time: "03:30 PM", label: "Market close", marker: true, state: weekday && mins >= 930 ? "done" : "pending" },
    { key: "eve2", time: eveToday ? timeIST(eveToday.generated_at) : "06:00 PM", label: "Evening wrap", meta: eveToday, state: st(eveToday, "evening") },
  ];
  return (
    <div className="rail -mx-1 gap-1 px-1">
      {steps.map((s, i) => {
        const inner = (
          <div
            className={clsx(
              "flex h-full min-w-[124px] flex-col gap-0.5 rounded-lg border px-2.5 py-2",
              s.state === "done" && s.meta ? "border-line bg-surface hover:border-line-strong" : "",
              s.state === "live" ? "border-[#9cc29a40] bg-up-muted" : "",
              s.state === "pending" ? "border-dashed border-line" : "",
              s.state === "missed" ? "border-dashed border-[#e58c7a40]" : "",
              s.marker && s.state !== "live" ? "border-line bg-transparent" : "",
            )}
          >
            <span className="flex items-center gap-1.5">
              <span
                className={clsx(
                  "size-1.5 rounded-full",
                  s.state === "done" ? (s.marker ? "bg-ink-2" : "bg-accent") : s.state === "live" ? "bg-up live-dot" : s.state === "missed" ? "bg-down" : "bg-faint",
                )}
              />
              <span className="num text-xs text-ink">{s.time}</span>
              {s.key === "eve" && evening ? <span className="text-2xs text-dim">{dayIST(evening.generated_at).split(" ")[0]}</span> : null}
            </span>
            <span className="text-2xs text-dim">
              {s.label}
              {s.state === "missed" ? " · not received" : s.state === "pending" && !s.marker ? " · scheduled" : ""}
            </span>
          </div>
        );
        return (
          <div key={s.key} className="flex items-center gap-1">
            {s.meta ? (
              <Link href={`/history/${s.meta.id}`} className="press block h-full">
                {inner}
              </Link>
            ) : (
              inner
            )}
            {i < steps.length - 1 ? <span className="h-px w-3 bg-line-strong" aria-hidden /> : null}
          </div>
        );
      })}
    </div>
  );
}

export function SnapshotLink({ snap }: { snap: Snapshot }) {
  return (
    <Link href={`/history/${snap.id}`} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
      Open the full {SESSION_SHORT[snap.session]} report <ExternalLink className="size-3" />
    </Link>
  );
}
