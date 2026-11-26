"use client";
import { useEffect, useRef, useState } from "react";
import { num, pct, timeIST } from "@/lib/format";
import type { Level } from "@/lib/derive";
import { SESSION_SHORT } from "@/lib/derive";
import type { Session } from "@/lib/types";
import { clsx } from "../ui";
import { Sheet } from "../Sheet";

const ROLE: Record<Level["role"], { name: string; cls: string }> = {
  trigger: { name: "Trigger level", cls: "text-accent" },
  stop: { name: "Stop loss", cls: "text-down" },
  target: { name: "Target", cls: "text-up" },
  zone: { name: "Level", cls: "text-ink-2" },
};

/** What each of the engine's level names means (levels.py / planner.py). */
const GLOSSARY: Record<string, string> = {
  PDH: "Previous day's high",
  PDL: "Previous day's low",
  PDC: "Previous day's close",
  "yday VWAP": "Previous session's closing VWAP",
  VAH: "Value-area high (70% of volume traded below)",
  VAL: "Value-area low",
  POC: "Point of control — price with the most volume",
  Pivot: "Floor pivot from the session's high, low, close",
  "call-OI wall": "Strike with the most call open interest (nearest expiry)",
  "put-OI wall": "Strike with the most put open interest (nearest expiry)",
  "30-min OR high": "High of the first 30 minutes",
  "30-min OR low": "Low of the first 30 minutes",
  "20 EMA": "20-day exponential moving average",
  "50 EMA": "50-day exponential moving average",
};

export interface LevelSourceInfo {
  id: string;
  session: Session;
  time: string;
}

/**
 * Vertical level map: the plan's levels above and below the current price.
 * Every price is the engine's; distances are plain arithmetic for reading
 * the map.
 */
export function LevelLadder({
  levels,
  price,
  priceLabel = "Last price",
  dense = false,
  decimals = 0,
  source,
  maxHeight,
}: {
  levels: Level[];
  price: number | null;
  priceLabel?: string;
  dense?: boolean;
  decimals?: number;
  source?: LevelSourceInfo | null;
  /** cap the height on desktop and keep the price row centred */
  maxHeight?: number;
}) {
  const [open, setOpen] = useState<Level | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const priceRow = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const b = box.current;
    const r = priceRow.current;
    if (!maxHeight || !b || !r || b.scrollHeight <= b.clientHeight) return;
    b.scrollTop = r.offsetTop - b.clientHeight / 2;
  }, [maxHeight, levels.length, price === null]);
  const rows: (Level | "price")[] = [];
  let placed = price === null;
  for (const l of [...levels].sort((a, b) => b.price - a.price)) {
    if (!placed && price !== null && l.price < price) {
      rows.push("price");
      placed = true;
    }
    rows.push(l);
  }
  if (!placed) rows.push("price");

  if (!levels.length)
    return <p className="px-4 py-5 text-sm text-dim">No plan published yet. Levels appear with the 8:45 AM, 11:45 AM or 6:00 PM report.</p>;

  return (
    <>
      <div ref={box} className={maxHeight ? "relative overflow-y-auto lg:max-h-[var(--ladder-max)]" : undefined} style={maxHeight ? ({ "--ladder-max": `${maxHeight}px` } as React.CSSProperties) : undefined}>
      <ol className="relative flex flex-col">
        {rows.map((r, i) =>
          r === "price" ? (
            <li key="price" ref={priceRow} className="relative my-1 flex items-center gap-3 border-y border-accent-line bg-accent-muted px-3.5 py-2 sm:px-4">
              <span className="num w-[76px] shrink-0 text-[15px] font-medium text-accent">{num(price, decimals)}</span>
              <span className="h-px flex-1 bg-accent-line" />
              <span className="text-2xs font-medium tracking-[0.1em] text-accent uppercase">{priceLabel}</span>
            </li>
          ) : (
            <li key={`${r.role}${r.price}${i}`}>
              <button
                onClick={() => setOpen(r)}
                className={clsx(
                  "press group grid w-full grid-cols-[76px_1fr_auto] items-center gap-3 px-3.5 text-left hover:bg-raised sm:px-4",
                  dense ? "py-1.5" : "py-2",
                  r.role === "zone" && "opacity-80",
                )}
              >
                <span className={clsx("num text-sm", ROLE[r.role].cls, r.role === "trigger" && "font-medium")}>{num(r.price, decimals)}</span>
                <span className="flex min-w-0 flex-col">
                  <span className={clsx("truncate text-xs", r.role === "zone" ? "text-dim" : "text-ink")}>
                    {r.role === "zone" ? r.label : r.label}
                  </span>
                  {r.role !== "zone" && r.names.length ? <span className="truncate text-2xs text-dim">{r.names.slice(0, 3).join(" + ")}</span> : null}
                </span>
                <span className="num text-right text-2xs text-ink-2">
                  {price !== null ? `${r.price > price ? "+" : "−"}${num(Math.abs(r.price - price), 0)}` : null}
                </span>
              </button>
            </li>
          ),
        )}
      </ol>
      </div>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title="Level">
        {open ? (
          <div className="space-y-3">
            <div className="flex items-baseline gap-3">
              <span className={clsx("num text-2xl font-medium", ROLE[open.role].cls)}>{num(open.price, 2)}</span>
              <span className="text-sm text-ink-2">{open.role === "zone" ? ROLE.zone.name : open.label}</span>
            </div>
            <dl className="divide-y divide-line rounded-xl border border-line px-3">
              <Row k="Role in the plan" v={open.role === "zone" ? "Reference level (not a trigger, stop or target)" : ROLE[open.role].name} />
              {price !== null ? <Row k="Distance from price" v={`${num(open.price - price, 0)} pts (${pct(((open.price - price) / price) * 100)})`} /> : null}
            </dl>
            {open.names.length ? (
              <div>
                <p className="eyebrow mb-2">What the engine calls this price</p>
                <ul className="space-y-1.5">
                  {open.names.map((n) => (
                    <li key={n} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-ink">{n}</span>
                      <span className="text-right text-xs text-dim">{GLOSSARY[n] ?? ""}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-2xs text-dim">Levels within ~0.1% of each other are merged into one zone (levels.cluster).</p>
              </div>
            ) : null}
            {source ? (
              <a href={`/history/${source.id}`} className="block text-xs text-accent hover:underline">
                From the {SESSION_SHORT[source.session]} report · {timeIST(source.time)} →
              </a>
            ) : null}
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
      <dd className="num text-right text-ink">{v}</dd>
    </div>
  );
}
