"use client";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useCandles } from "@/lib/client";
import { isForToday, parseZone } from "@/lib/derive";
import { dayIST, num, pct, timeIST, titleCase } from "@/lib/format";
import { type SetupStatus, type Tracking, trackSetup } from "@/lib/track";
import type { Candidate, Opportunity, Snapshot } from "@/lib/types";
import { Chip, Meter, Tag, clsx } from "../ui";

export type Setup = Opportunity & { side: "CALL" | "PUT" };

const STATUS: Record<SetupStatus, { tone: "accent" | "up" | "down" | "neutral" | "info"; text: string }> = {
  WATCH: { tone: "neutral", text: "Watch" },
  TRIGGERED: { tone: "accent", text: "Triggered" },
  ACTIVE: { tone: "info", text: "Active" },
  COMPLETED: { tone: "up", text: "Completed" },
  INVALIDATED: { tone: "down", text: "Invalidated" },
};

export function StatusChip({ t }: { t: Tracking }) {
  const s = STATUS[t.status];
  return (
    <Chip tone={s.tone} title={t.note}>
      {t.status === "TRIGGERED" || (t.status === "ACTIVE" && !t.t1At) ? <span className="size-1.5 rounded-full bg-current live-dot" /> : null}
      {s.text}
      {t.t1At && t.status === "ACTIVE" ? " · T1 ✓" : ""}
    </Chip>
  );
}

/** Live status of one setup from today's 5-minute bars (mechanical replay). */
export function useTracking(op: Setup, snap: Snapshot): Tracking {
  const today = isForToday(snap);
  const { data } = useCandles(today ? op.symbol : null, "1D");
  return useMemo(() => {
    const since = Math.floor(new Date(snap.generated_at).getTime() / 1000);
    const t = trackSetup(op, data?.candles ?? [], since);
    if (!today) return { ...t, tracked: false, note: `Setup from ${dayIST(snap.generated_at)} — see Performance` };
    return t;
  }, [data, op, snap, today]);
}

/** A horizontal price track: stop … entry zone … T1 … T2, with the live price. */
export function SetupTrack({ op, last }: { op: Setup; last: number | null }) {
  const zone = parseZone(op.entry_zone);
  const pts = [op.stop_loss, op.target_1, op.target_2, zone?.[0], zone?.[1], last].filter((x): x is number => typeof x === "number");
  if (pts.length < 3 || !zone) return null;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const pad = (hi - lo) * 0.06 || 1;
  const x = (v: number) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100;
  const long = op.side === "CALL";
  const mark = (v: number | undefined, label: string, cls: string) =>
    v === undefined ? null : (
      <div className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${x(v)}%` }}>
        <span className={clsx("h-3 w-px", cls)} />
        <span className="mt-1.5 text-[10px] leading-none whitespace-nowrap text-dim">{label}</span>
        <span className="num mt-0.5 text-[11px] leading-none text-ink-2">{num(v, v < 100 ? 2 : 0)}</span>
      </div>
    );
  return (
    <div className="relative mt-1 mb-1 h-12">
      <div className="absolute top-1.5 right-0 left-0 h-px bg-line-strong" />
      <div
        className="absolute top-0 h-3 rounded-sm bg-accent-muted ring-1 ring-accent-line"
        style={{ left: `${x(zone[0])}%`, width: `${Math.max(1.5, x(zone[1]) - x(zone[0]))}%` }}
        title={`Entry zone ${op.entry_zone}`}
      />
      {mark(op.stop_loss, "SL", "bg-down")}
      {mark(op.target_1, "T1", "bg-up")}
      {mark(op.target_2, "T2", "bg-up")}
      {last !== null ? (
        <div className="absolute -top-1 -translate-x-1/2" style={{ left: `${x(last)}%` }} title={`Last ${num(last)}`}>
          <span className={clsx("block size-[9px] rotate-45 rounded-[2px] border-2 border-bg", long ? (last >= zone[0] ? "bg-up" : "bg-ink") : last <= zone[1] ? "bg-down" : "bg-ink")} />
        </div>
      ) : null}
    </div>
  );
}

export function SetupCard({ op, snap, candidate, expanded = false }: { op: Setup; snap: Snapshot; candidate?: Candidate; expanded?: boolean }) {
  const t = useTracking(op, snap);
  const past = !isForToday(snap);
  const [open, setOpen] = useState(expanded);
  const chg = t.last !== null && op.current_price ? ((t.last - op.current_price) / op.current_price) * 100 : null;
  const call = op.side === "CALL";
  return (
    <article id={op.symbol} className="panel flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link href={`/markets/${op.symbol}`} className="text-[19px] font-semibold tracking-[-0.025em] hover:text-accent-hi">
              {op.symbol}
            </Link>
            <Chip tone={call ? "up" : "down"}>{op.side}</Chip>
          </div>
          <p className="mt-0.5 text-sm text-ink-2">
            {op.symbol} {op.suggested_strike} {op.suggested_expiry ? <span className="text-dim">· {op.suggested_expiry}</span> : null}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {past ? <Chip title="Live status is only tracked on the report's own session — see Performance">Past session</Chip> : <StatusChip t={t} />}
          {op.confidence_score !== undefined ? (
            <span className="text-2xs text-dim">
              Score <span className="num text-ink-2">{op.confidence_score}</span>/100
            </span>
          ) : null}
        </div>
      </div>

      <dl className="mx-4 mt-4 grid grid-cols-[1.35fr_1fr_1fr_1fr] overflow-hidden rounded-2xl border border-line bg-bg-sunk/60 sm:mx-5">
        <Cell k="Entry" v={op.entry_zone ?? "—"} cls="text-accent" />
        <Cell k="Stop" v={num(op.stop_loss, 2)} cls="text-down" />
        <Cell k="Target 1" v={num(op.target_1, 2)} cls="text-up" />
        <Cell k="Target 2" v={num(op.target_2, 2)} cls="text-up" />
      </dl>

      <div className="px-4 pt-3 sm:px-5">
        <SetupTrack op={op} last={t.last} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-1 text-xs text-dim sm:px-5">
        <span>
          R:R <span className="num text-ink-2">{op.risk_reward ?? "—"}</span>
        </span>
        <span>
          Hold <span className="text-ink-2">{op.expected_holding_time ?? "—"}</span>
        </span>
        <span>
          Last{" "}
          <span className="num text-ink">{t.last !== null ? num(t.last) : "—"}</span>
          {chg !== null ? <span className={clsx("num ml-1", chg >= 0 ? "text-up" : "text-down")}>{pct(chg)}</span> : null}
          {chg !== null ? <span className="ml-1">vs report</span> : null}
        </span>
      </div>
      <p className="px-4 pt-2 text-xs text-dim sm:px-5">
        {t.note}
        {t.enteredAt ? ` · entry traded ${timeIST(t.enteredAt * 1000)}` : ""}
        {t.ambiguous ? " · same-bar ambiguity" : ""}
      </p>
      <p className="px-4 pt-1 text-2xs text-faint sm:px-5">Entry, stop and targets are underlying prices from the engine; the contract is its strike suggestion.</p>

      <button onClick={() => setOpen((o) => !o)} className="press mt-3 flex items-center justify-between border-t border-line px-4 py-3 text-sm text-ink-2 hover:text-ink sm:px-5">
        Why the engine picked it
        <ChevronDown className={clsx("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open ? <SetupDetail op={op} candidate={candidate} /> : null}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-2xs text-dim sm:px-5">
        <Tag kind="engine">AI report · {timeIST(snap.generated_at)}</Tag>
        <span>{t.tracked ? "Status from live 5-min prices" : "Not tracked"}</span>
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

const SCORE_MAX: Record<string, number> = { technical: 40, options: 20, volume: 10, news: 10, fundamentals: 20 };

export function SetupDetail({ op, candidate }: { op: Setup; candidate?: Candidate }) {
  const scores = Object.entries(op.score_breakdown ?? {}).filter(([k]) => k !== "risk_deduction");
  const ded = op.score_breakdown?.risk_deduction;
  return (
    <div className="space-y-4 px-4 pb-4 text-sm sm:px-5">
      {op.why_selected ? <p className="leading-relaxed text-ink">{op.why_selected}</p> : null}
      {scores.length ? (
        <div className="space-y-2">
          {scores.map(([k, v]) => {
            const n = Number(String(v).split("/")[0]);
            const max = Number(String(v).split("/")[1]) || SCORE_MAX[k] || 10;
            return (
              <div key={k} className="grid grid-cols-[96px_1fr_44px] items-center gap-3">
                <span className="text-xs text-dim">{titleCase(k)}</span>
                <Meter value={(n / max) * 100} tone="accent" />
                <span className="num text-right text-xs text-ink-2">{String(v)}</span>
              </div>
            );
          })}
          {ded !== undefined && Number(ded) !== 0 ? <p className="text-xs text-dim">Risk deduction <span className="num text-down">{String(ded)}</span></p> : null}
        </div>
      ) : null}
      <dl className="space-y-2">
        {[
          ["Technical", op.technical_summary],
          ["Fundamentals", op.fundamental_summary],
          ["News", op.news_summary],
        ]
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt className="text-2xs text-dim">{k}</dt>
              <dd className="text-ink-2">{v}</dd>
            </div>
          ))}
      </dl>
      {op.key_risks?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {op.key_risks.map((r) => (
            <span key={r} className="rounded-lg border border-[#e58c7a33] bg-down-muted px-2 py-1 text-xs text-down">
              {r}
            </span>
          ))}
        </div>
      ) : null}
      {candidate ? <CandidateIndicators c={candidate} /> : null}
    </div>
  );
}

/** Indicators the engine's screener computed for this stock (indicators.compute_snapshot). */
export function CandidateIndicators({ c }: { c: Candidate }) {
  const items: [string, string | null][] = [
    ["RSI", c.rsi != null ? num(c.rsi, 1) : null],
    ["MACD", c.macd_state ?? null],
    ["EMA 20", c.ema20 != null ? num(c.ema20) : null],
    ["EMA 50", c.ema50 != null ? num(c.ema50) : null],
    ["EMA 200", c.ema200 != null ? num(c.ema200) : null],
    ["ADX", c.adx != null ? num(c.adx, 1) : null],
    ["Supertrend", c.supertrend ?? null],
    ["Rel. volume", c.rvol != null ? `${num(c.rvol, 2)}×` : null],
    ["Delivery", c.delivery_pct != null ? `${num(c.delivery_pct, 1)}%` : null],
  ];
  const shown = items.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-2xs text-dim">Indicators from the engine&apos;s screener</p>
        <Tag kind="engine" />
      </div>
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
        {shown.map(([k, v]) => (
          <div key={k} className="bg-card px-3 py-2">
            <p className="text-2xs text-dim">{k}</p>
            <p className="num text-sm text-ink capitalize">{v}</p>
          </div>
        ))}
      </div>
      {c.supports?.length || c.resistances?.length ? (
        <p className="mt-2 text-xs text-dim">
          Screener levels · S <span className="num text-up">{(c.supports ?? []).map((x) => num(x)).join(", ") || "—"}</span> · R{" "}
          <span className="num text-down">{(c.resistances ?? []).map((x) => num(x)).join(", ") || "—"}</span>
        </p>
      ) : null}
    </div>
  );
}
