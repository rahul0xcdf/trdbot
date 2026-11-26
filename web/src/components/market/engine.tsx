"use client";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ExternalLink } from "lucide-react";
import { useState } from "react";
import { type EngineBias, SESSION_LABEL, SESSION_SCHEDULE } from "@/lib/derive";
import { dayIST, isoDateIST, timeIST } from "@/lib/format";
import type { Session, Snapshot, SnapshotMeta, TerminalState } from "@/lib/types";
import { BiasChip, Chip, Empty, Meter, Panel, PanelHead, Tag, clsx } from "../ui";

/* ── Analysis provenance line ────────────────────────────────────────────── */

export function AnalysisStamp({ snap, prefix }: { snap: Snapshot; prefix?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-2xs text-dim">
      <Tag kind="engine">{snap.source?.ai_model && snap.analysis ? snap.source.ai_model : undefined}</Tag>
      <Link href={`/history/${snap.id}`} className="hover:text-ink-2">
        {prefix ?? SESSION_LABEL[snap.session]} · <span className="num text-ink-2">{timeIST(snap.generated_at)}</span> {dayIST(snap.generated_at)}
      </Link>
    </span>
  );
}

/* ── Outlook: the engine's bias + probabilities (AI pre-market report) ───── */

const REC_TONE: Record<string, "up" | "accent" | "down" | "neutral"> = { GO: "up", CAUTION: "accent", WARNING: "down", STAY_OUT: "down" };

export function Outlook({ bias, compact = false }: { bias: EngineBias | null; compact?: boolean }) {
  if (!bias)
    return (
      <Panel>
        <PanelHead title="Engine outlook" right={<Tag kind="engine" />} />
        <Empty title="No AI pre-market report yet">
          Bias, probabilities and trade setups come from the engine&apos;s <code className="num">/premarket</code> report (premarket.generate). The scheduled 8:15 / 2:00 / 6:00 reports
          publish data and an AI note, but no bias.
        </Empty>
      </Panel>
    );
  const { probs } = bias;
  const total = (probs.bullish ?? 0) + (probs.rangebound ?? 0) + (probs.bearish ?? 0) || 1;
  const a = bias.snap.analysis?.kind === "ai_premarket" ? bias.snap.analysis : null;
  return (
    <Panel>
      <PanelHead title="Engine outlook" right={<AnalysisStamp snap={bias.snap} prefix="AI pre-market report" />} />
      {!bias.current ? (
        <div className="flex items-center gap-2 border-b border-line bg-raised px-4 py-2 text-xs text-ink-2">
          <AlertTriangle className="size-3.5 text-accent" />
          From {dayIST(bias.snap.generated_at)} — no AI report for today yet.
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <BiasChip bias={bias.sentiment} size="lg" />
            {bias.recommendation ? <Chip tone={REC_TONE[bias.recommendation] ?? "neutral"}>{bias.recommendation.replace("_", " ")}</Chip> : null}
          </div>
          {bias.confidence !== null ? (
            <div>
              <div className="mb-1 flex justify-between text-2xs text-dim">
                <span>Confidence</span>
                <span className="num text-ink-2">{bias.confidence}/100</span>
              </div>
              <Meter value={bias.confidence} tone="accent" />
            </div>
          ) : null}
          {probs.bullish !== null ? (
            <div>
              <div className="mb-1.5 flex h-2 overflow-hidden rounded-full">
                <div className="bg-up" style={{ width: `${((probs.bullish ?? 0) / total) * 100}%` }} />
                <div className="bg-ink-2/50" style={{ width: `${((probs.rangebound ?? 0) / total) * 100}%` }} />
                <div className="bg-down" style={{ width: `${((probs.bearish ?? 0) / total) * 100}%` }} />
              </div>
              <div className="flex justify-between text-2xs">
                <span className="text-up">Bullish <span className="num">{probs.bullish}%</span></span>
                <span className="text-ink-2">Range <span className="num">{probs.rangebound}%</span></span>
                <span className="text-down">Bearish <span className="num">{probs.bearish}%</span></span>
              </div>
            </div>
          ) : null}
          {bias.plan?.style ? (
            <div className="rounded-lg border border-line bg-bg-sunk px-3 py-2">
              <p className="text-2xs tracking-[0.08em] text-dim uppercase">Trading plan</p>
              <p className="text-sm text-ink">{bias.plan.style}</p>
              {bias.plan.why && !compact ? <p className="mt-0.5 text-xs text-ink-2">{bias.plan.why}</p> : null}
            </div>
          ) : null}
        </div>
        <div className="space-y-3 text-sm">
          {bias.noTrade ? (
            <p className="rounded-lg border border-[#e58c7a40] bg-down-muted px-3 py-2 text-down">No trade — {bias.noTradeReason}</p>
          ) : null}
          {bias.why ? <p className="leading-relaxed text-ink-2">{bias.why}</p> : null}
          {a?.sector_outlook && !compact ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {(a.sector_outlook.bullish_sectors ?? []).map((s) => (
                <Chip key={s} tone="up">{s}</Chip>
              ))}
              {(a.sector_outlook.bearish_sectors ?? []).map((s) => (
                <Chip key={s} tone="down">{s}</Chip>
              ))}
            </div>
          ) : null}
          <p className="text-2xs text-dim">The engine publishes probabilities and levels, not break-above / break-below triggers — the levels it named are on the ladder.</p>
        </div>
      </div>
      {a && !compact && ((a.alerts?.length ?? 0) > 0 || (a.risk_assessment?.length ?? 0) > 0) ? <AlertsRisks alerts={a.alerts ?? []} risks={a.risk_assessment ?? []} /> : null}
    </Panel>
  );
}

function AlertsRisks({ alerts, risks }: { alerts: string[]; risks: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line">
      <button onClick={() => setOpen((o) => !o)} className="press flex w-full items-center justify-between px-4 py-2.5 text-xs text-ink-2 hover:text-ink">
        <span>
          Alerts <span className="num text-dim">{alerts.length}</span> · Risks <span className="num text-dim">{risks.length}</span>
        </span>
        <ChevronDown className={clsx("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="grid grid-cols-1 gap-4 px-4 pb-4 sm:grid-cols-2">
          <List title="Alerts" items={alerts} />
          <List title="Risk assessment" items={risks} />
        </div>
      ) : null}
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="eyebrow mb-1.5">{title}</p>
      <ul className="space-y-1.5 text-sm text-ink-2">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-dim" />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Brief: the AI note of the latest scheduled report + rule-based reads ── */

export function Brief({ snap, title }: { snap: Snapshot | null; title?: string }) {
  if (!snap) return null;
  const a = snap.analysis?.kind === "brief" ? snap.analysis : null;
  const labels = snap.data.labels;
  const chain = snap.data.option_chains?.NIFTY;
  return (
    <Panel>
      <PanelHead title={title ?? a?.title ?? SESSION_LABEL[snap.session]} right={<AnalysisStamp snap={snap} />} />
      <div className="space-y-3 p-4">
        {a?.bullets?.length ? (
          <ul className="space-y-2">
            {a.bullets.map((b, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink">
                <span className="num mt-0.5 text-2xs text-accent">{String(i + 1).padStart(2, "0")}</span>
                {b}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-dim">AI note unavailable for this run — the engine sent the data without it.</p>
        )}
        {labels || chain?.oi_signal ? (
          <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
            {labels?.opening_hint ? <Read k="Opening">{labels.opening_hint}</Read> : null}
            {labels?.nifty_pcr ? <Read k={`Nifty PCR ${chain?.pcr ?? ""}`}>{labels.nifty_pcr}</Read> : null}
            {labels?.banknifty_pcr ? <Read k={`Bank Nifty PCR ${snap.data.option_chains?.BANKNIFTY?.pcr ?? ""}`}>{labels.banknifty_pcr}</Read> : null}
            {labels?.pcr_mix ? <Read k="PCR mix">{labels.pcr_mix}</Read> : null}
            {chain?.oi_signal ? <Read k="Nifty ΔOI">{chain.oi_signal}</Read> : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function Read({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-accent-line/60 bg-accent-muted/60 px-2 py-1 text-xs">
      <span className="text-dim">{k}</span>
      <span className="text-ink">{children}</span>
    </span>
  );
}

/* ── Session timeline: 6 PM → 8:15 AM → 9:15 open → 2 PM → 6 PM ─────────── */

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
  const mins = (() => {
    const d = new Date(now.getTime() + 330 * 60_000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  })();
  const find = (session: Session, day?: string) =>
    state.timeline.find((m) => m.session === session && (!day || isoDateIST(m.generated_at) === day));
  // Most recent evening before today's morning
  const evening = state.timeline.find((m) => m.session === "evening" && isoDateIST(m.generated_at) < today) ?? find("evening");
  const pre = find("premarket", today);
  const ai = find("ai_premarket", today);
  const aft = find("afternoon", today);
  const eveToday = find("evening", today);
  const due = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return mins >= h * 60 + m + 5;
  };
  const st = (meta: SnapshotMeta | undefined, hhmm: string): Step["state"] => (meta ? "done" : due(hhmm) ? "missed" : "pending");
  const steps: Step[] = [
    { key: "eve", time: evening ? timeIST(evening.generated_at) : "06:00 PM", label: "Next-day prep", meta: evening, state: evening ? "done" : "pending" },
    { key: "pre", time: pre ? timeIST(pre.generated_at) : "08:15 AM", label: "Pre-market", meta: pre, state: st(pre, SESSION_SCHEDULE.premarket!) },
    ...(ai ? [{ key: "ai", time: timeIST(ai.generated_at), label: "AI report", meta: ai, state: "done" as const }] : []),
    { key: "open", time: "09:15 AM", label: "Market open", marker: true, state: mins >= 555 && mins < 930 ? "live" : mins >= 930 ? "done" : "pending" },
    { key: "aft", time: aft ? timeIST(aft.generated_at) : "02:00 PM", label: "Intraday update", meta: aft, state: st(aft, SESSION_SCHEDULE.afternoon!) },
    { key: "eve2", time: eveToday ? timeIST(eveToday.generated_at) : "06:00 PM", label: "Evening wrap", meta: eveToday, state: st(eveToday, SESSION_SCHEDULE.evening!) },
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
              <Link href={`/history/${s.meta.id}`} className="block h-full press">
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
      Open full snapshot <ExternalLink className="size-3" />
    </Link>
  );
}

export function latestAnalysisList(state: TerminalState, n = 5) {
  return state.timeline.slice(0, n);
}

