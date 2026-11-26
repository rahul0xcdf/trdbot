"use client";
import { useState } from "react";
import { compact, num, pct, timeIST } from "@/lib/format";
import type { Level } from "@/lib/derive";
import { SESSION_SHORT } from "@/lib/derive";
import { Meter, clsx } from "../ui";
import { Sheet } from "../Sheet";

const KIND: Record<Level["kind"], { name: string; cls: string; tone: "up" | "down" | "accent" | "neutral" }> = {
  resistance: { name: "Resistance", cls: "text-down", tone: "down" },
  support: { name: "Support", cls: "text-up", tone: "up" },
  max_pain: { name: "Max pain", cls: "text-info", tone: "neutral" },
  entry: { name: "Entry", cls: "text-accent", tone: "accent" },
  stop: { name: "Stop", cls: "text-down", tone: "down" },
  target: { name: "Target", cls: "text-up", tone: "up" },
};

/**
 * Vertical level map: the engine's levels above and below the current price.
 * Distances are plain arithmetic for reading the map; nothing is inferred.
 */
export function LevelLadder({ levels, price, priceLabel = "Current price", dense = false, decimals = 2 }: { levels: Level[]; price: number | null; priceLabel?: string; dense?: boolean; decimals?: number }) {
  const [open, setOpen] = useState<Level | null>(null);
  const rows: (Level | "price")[] = [];
  const sorted = [...levels].sort((a, b) => b.price - a.price);
  let placed = price === null;
  for (const l of sorted) {
    if (!placed && price !== null && l.price < price) {
      rows.push("price");
      placed = true;
    }
    rows.push(l);
  }
  if (!placed) rows.push("price");

  if (!levels.length)
    return <p className="px-4 py-5 text-sm text-dim">No levels published yet. They appear when the engine sends an option chain or an AI pre-market report.</p>;

  return (
    <>
      <ol className="relative flex flex-col">
        {rows.map((r, i) =>
          r === "price" ? (
            <li key="price" className="relative my-1 flex items-center gap-3 border-y border-accent-line bg-accent-muted px-3.5 py-2 sm:px-4">
              <span className="num w-[84px] shrink-0 text-[15px] font-medium text-accent">{num(price, decimals)}</span>
              <span className="h-px flex-1 bg-accent-line" />
              <span className="text-2xs font-medium tracking-[0.1em] text-accent uppercase">{priceLabel}</span>
            </li>
          ) : (
            <li key={`${r.kind}${r.price}${i}`}>
              <button
                onClick={() => setOpen(r)}
                className={clsx("press group grid w-full grid-cols-[84px_1fr_auto] items-center gap-3 px-3.5 text-left hover:bg-raised sm:px-4", dense ? "py-1.5" : "py-2")}
              >
                <span className={clsx("num text-sm", KIND[r.kind].cls)}>{num(r.price, decimals)}</span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span className="h-px w-3 shrink-0" style={{ background: "currentColor" }} />
                    <span className="truncate text-xs text-ink-2">{r.label}</span>
                  </span>
                  {r.oiStrength !== undefined && !dense ? <Meter value={r.oiStrength} tone={KIND[r.kind].tone} className="max-w-[140px]" /> : null}
                </span>
                <span className="text-right text-2xs text-dim">
                  {price !== null ? (
                    <span className="num block text-ink-2">
                      {r.price > price ? "+" : "−"}
                      {num(Math.abs(r.price - price), 0)}
                    </span>
                  ) : null}
                  <span className="block">{r.sources.map((s) => s.name).join(" · ")}</span>
                </span>
              </button>
            </li>
          ),
        )}
      </ol>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title="Level">
        {open ? (
          <div className="space-y-3">
            <div className="flex items-baseline gap-3">
              <span className={clsx("num text-2xl font-medium", KIND[open.kind].cls)}>{num(open.price, decimals)}</span>
              <span className="text-sm text-ink-2">{open.label}</span>
            </div>
            <dl className="divide-y divide-line rounded-xl border border-line px-3">
              <Row k="Type" v={KIND[open.kind].name} />
              {price !== null ? <Row k="Distance from price" v={`${num(open.price - price, 0)} pts (${pct(((open.price - price) / price) * 100)})`} /> : null}
              {open.oi !== undefined ? <Row k="Open interest at strike" v={compact(open.oi)} /> : null}
              {open.oiStrength !== undefined ? <Row k="OI vs largest strike" v={`${open.oiStrength}%`} /> : null}
              {open.rank ? <Row k="OI rank" v={`#${open.rank}`} /> : null}
            </dl>
            <div>
              <p className="eyebrow mb-2">Sources</p>
              <ul className="space-y-1.5">
                {open.sources.map((s, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink-2">{s.name}</span>
                    <a href={`/history/${s.snapshotId}`} className="text-xs text-accent hover:underline">
                      {SESSION_SHORT[s.session]} · {timeIST(s.time)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-dim">
              Published by your engine. Option-chain levels are the top call/put open-interest strikes the engine labels resistance/support; strength bars show
              that strike&apos;s OI against the largest one in the chain.
            </p>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <dt className="text-dim">{k}</dt>
      <dd className="num text-ink">{v}</dd>
    </div>
  );
}
