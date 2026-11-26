"use client";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { latestWith } from "@/lib/derive";
import { num, pct, tone } from "@/lib/format";
import type { Instrument } from "@/lib/instruments";
import type { Quote, TerminalState } from "@/lib/types";
import { Delta, Fresh, Live, Sparkline, Tag, clsx } from "../ui";

export interface IndexValue {
  price: number | null;
  change: number | null;
  change_pct: number | null;
  week_pct: number | null;
  time: string | null;
  source: string;
  spark: number[];
  prevClose: number | null;
  viaEngine: boolean;
  high?: number | null;
  low?: number | null;
}

/**
 * Live price from Yahoo when available; otherwise the last price the engine
 * captured from NSE in its latest snapshot (clearly labelled as such).
 */
export function indexValue(inst: Instrument, quote: Quote | undefined, state: TerminalState): IndexValue {
  const eng = inst.engineIndex
    ? latestWith(state, (s) => s.data.indices?.[inst.engineIndex!])
    : inst.engineSector
      ? latestWith(state, (s) => s.data.sectors?.find((x) => x.sector === inst.engineSector))
      : null;
  const engRow = eng?.value as { last?: number | null; change?: number | null; change_pct?: number | null; week_pct?: number | null; high?: number | null; low?: number | null } | undefined;
  if (quote && quote.price !== null) {
    return {
      price: quote.price,
      change: quote.change,
      change_pct: quote.change_pct,
      week_pct: engRow?.week_pct ?? null,
      time: quote.time,
      source: quote.source,
      spark: quote.spark,
      prevClose: quote.prev_close,
      viaEngine: false,
    };
  }
  return {
    price: engRow?.last ?? null,
    change: engRow?.change ?? null,
    change_pct: engRow?.change_pct ?? null,
    week_pct: engRow?.week_pct ?? null,
    time: eng?.snap.generated_at ?? null,
    source: "NSE via engine",
    spark: [],
    prevClose: null,
    viaEngine: true,
    high: engRow?.high,
    low: engRow?.low,
  };
}

export function TrendIcon({ v, className }: { v: number | null | undefined; className?: string }) {
  const t = tone(v);
  const I = t === "up" ? ArrowUpRight : t === "down" ? ArrowDownRight : Minus;
  return <I className={clsx("size-3.5", t === "up" ? "text-up" : t === "down" ? "text-down" : "text-dim", className)} strokeWidth={2} />;
}

export function IndexCard({ inst, v, href, compact = false }: { inst: Instrument; v: IndexValue; href?: string; compact?: boolean }) {
  const d = inst.decimals ?? 2;
  const body = (
    <div className={clsx("panel lift flex h-full flex-col gap-2 p-3.5", compact ? "w-[168px]" : "")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-[0.02em] text-ink-2">{inst.name}</span>
        <TrendIcon v={v.change_pct} />
      </div>
      <div className="min-w-0">
        <Live value={v.price} className="num block text-[20px] leading-6 font-semibold tracking-[-0.025em] text-ink">
          {num(v.price, d)}
        </Live>
        <Delta value={v.change} pctValue={v.change_pct} d={d} className="text-xs" />
      </div>
      <Sparkline data={v.spark} base={v.prevClose} width={compact ? 140 : 180} height={30} className="w-full" />
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-2 text-2xs text-dim">
        <span title="1-week change (NSE allIndices, via engine)">
          1W <span className={clsx("num", tone(v.week_pct) === "up" ? "text-up" : tone(v.week_pct) === "down" ? "text-down" : "")}>{pct(v.week_pct)}</span>
        </span>
        <Fresh at={v.time} label="" seconds={!v.viaEngine} staleAfterMin={v.viaEngine ? 24 * 60 : 30} />
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

export function SourceLine({ v }: { v: IndexValue }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Tag kind="raw">{v.source}</Tag>
      {v.viaEngine ? <span className="text-2xs text-dim">live feed unavailable — last engine capture</span> : null}
    </span>
  );
}
