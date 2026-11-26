"use client";
import { useState } from "react";
import { crore, dateIST, num, pct, tone } from "@/lib/format";
import type { FiiDii, MetricRow, Movers, Sector, Snapshot } from "@/lib/types";
import { Sheet } from "../Sheet";
import { Chip, Delta, Segmented, clsx } from "../ui";

/* ── Sector heatmap ──────────────────────────────────────────────────────── */

function heat(v: number | null | undefined, scale = 2) {
  if (v === null || v === undefined) return { background: "var(--color-card-2)" };
  const a = Math.min(1, Math.abs(v) / scale);
  const rgb = v >= 0 ? "156,194,154" : "229,140,122";
  return { background: `rgba(${rgb},${(0.08 + a * 0.42).toFixed(3)})` };
}

export function SectorHeatmap({ sectors, momentum, aiBull = [], aiBear = [], cols = 4 }: { sectors: Sector[]; momentum?: { building: Sector[]; fading: Sector[] }; aiBull?: string[]; aiBear?: string[]; cols?: 2 | 3 | 4 }) {
  const [mode, setMode] = useState<"day" | "week">("day");
  const [open, setOpen] = useState<Sector | null>(null);
  const val = (s: Sector) => (mode === "day" ? s.change_pct : s.week_pct ?? null);
  const sorted = [...sectors].sort((a, b) => (val(b) ?? -99) - (val(a) ?? -99));
  const hasWeek = sectors.some((s) => s.week_pct !== undefined && s.week_pct !== null);
  if (!sectors.length) return <p className="px-4 pb-5 text-sm text-dim sm:px-5">No sector data in the latest snapshot.</p>;
  const tag = (s: Sector) =>
    momentum?.building.some((b) => b.sector === s.sector) ? "building" : momentum?.fading.some((b) => b.sector === s.sector) ? "fading" : null;
  return (
    <div className="px-4 pb-4 sm:px-5">
      {hasWeek ? (
        <div className="mb-3">
          <Segmented size="xs" value={mode} onChange={setMode} options={[{ value: "day", label: "Day" }, { value: "week", label: "1 Week" }]} />
        </div>
      ) : null}
      <div className={clsx("grid grid-cols-2 gap-2", cols === 4 ? "sm:grid-cols-3 lg:grid-cols-4" : cols === 3 ? "sm:grid-cols-3" : "")}>
        {sorted.map((s) => (
          <button key={s.sector} onClick={() => setOpen(s)} className="press lift rounded-2xl border border-line p-3 text-left" style={heat(val(s), mode === "day" ? 1.6 : 3.5)}>
            <p className="truncate text-sm font-medium text-ink">{s.sector}</p>
            <p className={clsx("num mt-1 text-[17px] font-semibold", tone(val(s)) === "up" ? "text-up" : tone(val(s)) === "down" ? "text-down" : "text-ink-2")}>{pct(val(s))}</p>
            <p className="mt-0.5 text-2xs text-dim">
              {mode === "day" ? "1W" : "Day"} <span className="num">{pct(mode === "day" ? s.week_pct : s.change_pct)}</span>
              {tag(s) ? <span className={tag(s) === "building" ? "text-up" : "text-down"}> · {tag(s)}</span> : null}
            </p>
          </button>
        ))}
      </div>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title="Sector">
        {open ? (
          <div className="space-y-4">
            <div>
              <p className="text-[22px] font-semibold tracking-[-0.02em]">{open.sector}</p>
              <p className="num text-sm text-ink-2">Index {num(open.last)}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-line p-3" style={heat(open.change_pct)}>
                <p className="text-2xs text-dim">Day</p>
                <Delta pctValue={open.change_pct} showAbs={false} className="text-lg font-semibold" />
              </div>
              <div className="rounded-2xl border border-line p-3" style={heat(open.week_pct, 3.5)}>
                <p className="text-2xs text-dim">1 week</p>
                <Delta pctValue={open.week_pct ?? null} showAbs={false} className="text-lg font-semibold" />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tag(open) === "building" ? <Chip tone="up">Engine: gaining strength</Chip> : null}
              {tag(open) === "fading" ? <Chip tone="down">Engine: losing strength</Chip> : null}
              {aiBull.includes(open.sector) ? <Chip tone="up">AI report: bullish sector</Chip> : null}
              {aiBear.includes(open.sector) ? <Chip tone="down">AI report: bearish sector</Chip> : null}
            </div>
            <p className="text-xs text-dim">Constituent stocks aren&apos;t published by the engine, so there&apos;s no drill-down list yet. Source: NSE allIndices via the engine.</p>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

/* ── Top movers ──────────────────────────────────────────────────────────── */

export function MoversList({ movers, title }: { movers: Movers; title: string }) {
  return (
    <div className="px-4 pb-4 sm:px-5">
      <p className="mb-2 text-xs text-dim">{title}</p>
      <div className="grid grid-cols-2 gap-2">
        {(["gainers", "losers"] as const).map((k) => (
          <div key={k} className="overflow-hidden rounded-2xl border border-line">
            {movers[k].length ? (
              movers[k].map((m, i) => (
                <a key={m.symbol} href={`/markets/${m.symbol}`} className={clsx("flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-hover/50", i && "border-t border-line")}>
                  <span className="truncate text-ink">{m.symbol}</span>
                  <span className={clsx("num", k === "gainers" ? "text-up" : "text-down")}>{pct(m.change_pct)}</span>
                </a>
              ))
            ) : (
              <p className="px-3 py-2 text-xs text-dim">None</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Breadth ─────────────────────────────────────────────────────────────── */

export function BreadthBar({ label, adv, dec, total }: { label: string; adv: number; dec: number; total?: number }) {
  const t = total ?? adv + dec;
  const unch = Math.max(0, t - adv - dec);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="text-ink-2">{label}</span>
        <span className="text-dim">
          A/D <span className="num text-ink">{dec ? num(adv / dec, 2) : "—"}</span>
        </span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-line">
        <div className="bg-up" style={{ width: `${(adv / t) * 100}%` }} />
        <div className="bg-ink-2/40" style={{ width: `${(unch / t) * 100}%` }} />
        <div className="bg-down" style={{ width: `${(dec / t) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-2xs">
        <span className="text-up">
          <span className="num">{adv}</span> advancing
        </span>
        {unch ? <span className="text-dim">{unch} flat</span> : null}
        <span className="text-down">
          <span className="num">{dec}</span> declining
        </span>
      </div>
    </div>
  );
}

export function Breadth({ snaps }: { snaps: (Snapshot | undefined)[] }) {
  const board = snaps.find((s) => s?.data.indices?.["NIFTY 50"]?.advances !== undefined)?.data.indices;
  const bank = board?.["NIFTY BANK"];
  const fno = snaps.find((s) => s?.data.breadth)?.data.breadth;
  const n = board?.["NIFTY 50"];
  if (!n && !fno) return <p className="px-4 pb-5 text-sm text-dim sm:px-5">No breadth data published.</p>;
  return (
    <div className="space-y-4 px-4 pb-5 sm:px-5">
      {n?.advances !== undefined ? <BreadthBar label="Nifty 50" adv={n.advances ?? 0} dec={n.declines ?? 0} total={50} /> : null}
      {bank?.advances ? <BreadthBar label="Bank Nifty" adv={bank.advances ?? 0} dec={bank.declines ?? 0} total={12} /> : null}
      {fno ? <BreadthBar label={`${fno.universe} (${fno.total} stocks)`} adv={fno.advances} dec={fno.declines} total={fno.total} /> : null}
      <p className="text-2xs text-dim">New highs / lows and % above 20/50/200 EMA aren&apos;t in the engine&apos;s output.</p>
    </div>
  );
}

/* ── FII / DII ───────────────────────────────────────────────────────────── */

export function FiiDiiCard({ f, history }: { f: FiiDii | undefined; history: MetricRow[] }) {
  const rows = history.filter((r) => r.fii_net !== null || r.dii_net !== null).slice(-20);
  const max = Math.max(1, ...rows.flatMap((r) => [Math.abs(r.fii_net ?? 0), Math.abs(r.dii_net ?? 0)]));
  return (
    <div className="space-y-4 px-4 pb-5 sm:px-5">
      {f ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Big k="FII" v={f.fii_net_buy_sell} />
            <Big k="DII" v={f.dii_net_buy_sell} />
            <Big k="Net" v={f.fii_net_buy_sell !== null && f.dii_net_buy_sell !== null ? f.fii_net_buy_sell + f.dii_net_buy_sell : null} />
          </div>
          <p className="text-2xs text-dim">Cash market · {f.date ?? "date n/a"} · NSE via engine. Futures/options splits aren&apos;t published.</p>
        </>
      ) : (
        <p className="text-sm text-dim">No FII/DII figure in the latest snapshots.</p>
      )}
      {rows.length > 1 ? (
        <div>
          <div className="mb-2 flex items-center gap-3 text-2xs text-dim">
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-accent" />FII</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-info" />DII</span>
            <span className="ml-auto">last {rows.length} sessions</span>
          </div>
          <div className="flex h-28 items-center gap-[3px]">
            {rows.map((r) => (
              <div key={r.ts} className="relative flex h-full flex-1 flex-col justify-center" title={`${dateIST(r.ts)} · FII ${crore(r.fii_net)} · DII ${crore(r.dii_net)}`}>
                <div className="absolute top-1/2 right-0 left-0 h-px bg-line" />
                <div className="flex h-full gap-[1px]">
                  {[r.fii_net, r.dii_net].map((v, i) => (
                    <div key={i} className="relative flex-1">
                      <div
                        className={clsx("absolute right-0 left-0 rounded-[2px]", i ? "bg-info" : "bg-accent", (v ?? 0) < 0 && "opacity-70")}
                        style={(v ?? 0) >= 0 ? { bottom: "50%", height: `${(Math.abs(v ?? 0) / max) * 50}%` } : { top: "50%", height: `${(Math.abs(v ?? 0) / max) * 50}%` }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Big({ k, v }: { k: string; v: number | null }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-card-2 px-2.5 py-2.5">
      <p className="text-2xs text-dim">{k}</p>
      <p className={clsx("num text-[15px] font-semibold whitespace-nowrap", (v ?? 0) >= 0 ? "text-up" : "text-down")}>{crore(v)}</p>
    </div>
  );
}

/* ── Small line chart for metric history (PCR / VIX / max pain) ──────────── */

export function MetricLine({ rows, field, label, decimals = 2 }: { rows: MetricRow[]; field: "pcr" | "vix" | "max_pain"; label: string; decimals?: number }) {
  const pts = rows.filter((r) => r[field] !== null).map((r) => ({ t: r.ts, v: r[field] as number }));
  if (pts.length < 2) return null;
  const w = 300;
  const h = 64;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const y = (v: number) => h - 4 - ((v - lo) / (hi - lo || 1)) * (h - 8);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * w).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const last = pts.at(-1)!;
  return (
    <div className="rounded-2xl border border-line p-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs text-dim">{label}</p>
        <p className="num text-[15px] font-semibold">{num(last.v, decimals)}</p>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-16 w-full" preserveAspectRatio="none" aria-hidden>
        <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="text-2xs text-dim">
        {dateIST(pts[0].t)} → {dateIST(last.t)} · range <span className="num">{num(lo, decimals)}–{num(hi, decimals)}</span>
      </p>
    </div>
  );
}
