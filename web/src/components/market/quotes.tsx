"use client";
import Link from "next/link";
import { num } from "@/lib/format";
import type { Instrument } from "@/lib/instruments";
import type { Quote } from "@/lib/types";
import { Delta, Fresh, Live, Sparkline, clsx } from "../ui";
import { TrendIcon } from "./indices";

export function QuoteRow({ inst, q, href, right }: { inst: Instrument; q: Quote | undefined; href?: string; right?: React.ReactNode }) {
  const d = inst.decimals ?? 2;
  const body = (
    <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[15px] font-medium text-ink">
          {inst.name}
          <TrendIcon v={q?.change_pct} />
        </p>
        <p className="mt-0.5 text-2xs text-dim">
          {q?.error ? <span className="text-down/80">Unavailable · {q.error}</span> : <Fresh at={q?.time} label={q?.source ?? "—"} seconds={false} staleAfterMin={60 * 24} />}
        </p>
      </div>
      <Sparkline data={q?.spark ?? []} base={q?.prev_close} width={64} height={28} className="hidden sm:block" />
      <div className="w-[116px] text-right">
        <Live value={q?.price} className="num block text-[15px] font-medium">
          {num(q?.price, d)}
        </Live>
        <Delta value={q?.change} pctValue={q?.change_pct} d={d} className="text-xs" showAbs={false} />
      </div>
      {right}
    </div>
  );
  return href ? (
    <Link href={href} className={clsx("block hover:bg-hover/40")}>
      {body}
    </Link>
  ) : (
    body
  );
}
