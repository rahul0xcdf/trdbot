"use client";
import { useMemo, useState } from "react";
import { daysUntil } from "@/lib/derive";
import { compact, num } from "@/lib/format";
import type { OptionChain, StrikeRow } from "@/lib/types";
import { Chip, Segmented, clsx } from "../ui";

/* ── Summary tiles ───────────────────────────────────────────────────────── */

export function ChainSummary({ c, label }: { c: OptionChain; label?: string }) {
  const dte = daysUntil(c.expiry);
  const tiles: [string, React.ReactNode, string?][] = [
    ["PCR", num(c.pcr, 2), c.pcr !== null && c.pcr >= 1 ? "text-up" : c.pcr !== null && c.pcr < 0.8 ? "text-down" : "text-ink"],
    ["Max pain", num(c.max_pain, 0)],
    ["ATM", num(c.atm_strike, 0)],
    ["ATM IV", c.atm_iv !== null ? `${num(c.atm_iv, 2)}%` : "—"],
    ["Call OI", compact(c.total_call_oi)],
    ["Put OI", compact(c.total_put_oi)],
    ["Δ Call OI", compact(c.change_call_oi), c.change_call_oi >= 0 ? "text-down" : "text-up"],
    ["Δ Put OI", compact(c.change_put_oi), c.change_put_oi >= 0 ? "text-up" : "text-down"],
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-dim">
        {label ? <span className="text-sm font-medium text-ink">{label}</span> : null}
        <span>
          Expiry <span className="text-ink-2">{c.expiry}</span>
          {dte !== null ? <span> · {dte === 0 ? "today" : `${dte}d`}</span> : null}
        </span>
        <span>
          Spot <span className="num text-ink-2">{num(c.spot)}</span>
        </span>
      </div>
      <div className="grid grid-cols-4 gap-px overflow-hidden rounded-2xl border border-line bg-line">
        {tiles.map(([k, v, cls]) => (
          <div key={k} className="bg-card px-3 py-2.5">
            <p className="text-2xs text-dim">{k}</p>
            <p className={clsx("num text-[15px] font-medium", cls ?? "text-ink")}>{v}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-lg border border-accent-line/60 bg-accent-muted/60 px-2 py-1">
          <span className="text-dim">ΔOI read </span>
          <span className="text-ink">{c.oi_signal}</span>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <StrikeRowChips title="High call OI → resistance" strikes={c.top_call_oi_strikes} tone="down" />
        <StrikeRowChips title="High put OI → support" strikes={c.top_put_oi_strikes} tone="up" />
      </div>
    </div>
  );
}

function StrikeRowChips({ title, strikes, tone }: { title: string; strikes: number[]; tone: "up" | "down" }) {
  return (
    <div className="rounded-2xl border border-line px-3 py-2.5">
      <p className="mb-1.5 text-2xs text-dim">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {strikes.map((s, i) => (
          <Chip key={s} tone={i === 0 ? tone : "neutral"}>
            <span className="num normal-case">{num(s, 0)}</span>
          </Chip>
        ))}
      </div>
    </div>
  );
}

/* ── OI profile: calls left, puts right, per strike ──────────────────────── */

export function OiProfile({ c, width = 10 }: { c: OptionChain; width?: number }) {
  const [metric, setMetric] = useState<"oi" | "chg">("oi");
  const rows = useMemo(() => around(c.strikes ?? [], c.atm_strike, width).slice().reverse(), [c, width]);
  if (!rows.length) return <p className="text-sm text-dim">Per-strike data not in this snapshot.</p>;
  const val = (r: StrikeRow, s: "ce" | "pe") => (metric === "oi" ? (s === "ce" ? r.ce_oi : r.pe_oi) : s === "ce" ? r.ce_chg_oi : r.pe_chg_oi) ?? 0;
  const max = Math.max(1, ...rows.flatMap((r) => [Math.abs(val(r, "ce")), Math.abs(val(r, "pe"))]));
  const topC = new Set(c.top_call_oi_strikes.slice(0, 3));
  const topP = new Set(c.top_put_oi_strikes.slice(0, 3));
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-2xs text-dim">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-down" />Calls</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-up" />Puts</span>
        </div>
        <Segmented size="xs" value={metric} onChange={setMetric} options={[{ value: "oi", label: "Open interest" }, { value: "chg", label: "Change" }]} />
      </div>
      <div className="space-y-[3px]">
        {rows.map((r) => {
          const ce = val(r, "ce");
          const pe = val(r, "pe");
          const atm = r.strike === c.atm_strike;
          const mp = r.strike === c.max_pain;
          return (
            <div key={r.strike} className={clsx("grid grid-cols-[1fr_64px_1fr] items-center gap-2 rounded-md", atm && "bg-accent-muted")}>
              <div className="flex justify-end">
                <div
                  className={clsx("h-3.5 rounded-l-[4px]", ce < 0 ? "bg-down/35" : topC.has(r.strike) ? "bg-down" : "bg-down/55")}
                  style={{ width: `${(Math.abs(ce) / max) * 100}%` }}
                  title={`${num(r.strike, 0)} CE ${metric === "oi" ? "OI" : "ΔOI"} ${compact(ce)}`}
                />
              </div>
              <div className={clsx("num text-center text-xs", atm ? "font-semibold text-accent" : "text-ink-2")}>
                {num(r.strike, 0)}
                {mp ? <span className="ml-0.5 text-[9px] text-info">MP</span> : null}
              </div>
              <div>
                <div
                  className={clsx("h-3.5 rounded-r-[4px]", pe < 0 ? "bg-up/35" : topP.has(r.strike) ? "bg-up" : "bg-up/55")}
                  style={{ width: `${(Math.abs(pe) / max) * 100}%` }}
                  title={`${num(r.strike, 0)} PE ${metric === "oi" ? "OI" : "ΔOI"} ${compact(pe)}`}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-2xs text-dim">Highlighted bar = engine&apos;s top-3 OI strike · MP = max pain · shaded row = ATM. {metric === "chg" ? "Faded bars are OI unwinding." : ""}</p>
    </div>
  );
}

function around(rows: StrikeRow[], atm: number, n: number) {
  const i = rows.findIndex((r) => r.strike === atm);
  if (i < 0) return rows.slice(0, 2 * n + 1);
  return rows.slice(Math.max(0, i - n), i + n + 1);
}

/* ── Option chain table with heatmap shading ─────────────────────────────── */

type Side = "both" | "calls" | "puts";

export function ChainTable({ c }: { c: OptionChain }) {
  const [side, setSide] = useState<Side>("both");
  const [heat, setHeat] = useState(true);
  const [width, setWidth] = useState(12);
  const rows = useMemo(() => around(c.strikes ?? [], c.atm_strike, width), [c, width]);
  if (!rows.length) return <p className="px-5 pb-5 text-sm text-dim">Per-strike rows weren&apos;t in this snapshot.</p>;
  const max = (f: keyof StrikeRow) => Math.max(1, ...rows.map((r) => Math.abs((r[f] as number | null) ?? 0)));
  const mx = {
    ce_oi: max("ce_oi"), pe_oi: max("pe_oi"), ce_chg_oi: max("ce_chg_oi"), pe_chg_oi: max("pe_chg_oi"), ce_volume: max("ce_volume"), pe_volume: max("pe_volume"),
  };
  const rank = (arr: number[], k: number) => arr.indexOf(k);
  const bg = (v: number | null, m: number, color: "up" | "down") => {
    if (!heat || v === null || v === 0) return undefined;
    const a = Math.min(0.55, (Math.abs(v) / m) * 0.55);
    const rgb = v < 0 ? "169,184,201" : color === "up" ? "156,194,154" : "229,140,122";
    return { background: `rgba(${rgb},${a.toFixed(3)})` };
  };
  const ce = side !== "puts";
  const pe = side !== "calls";
  const th = "px-2.5 py-2 text-right text-2xs font-medium text-dim whitespace-nowrap";
  const td = "num px-2.5 py-1.5 text-right text-xs whitespace-nowrap";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:px-5">
        <Segmented size="xs" value={side} onChange={setSide} options={[{ value: "both", label: "Both" }, { value: "calls", label: "Calls" }, { value: "puts", label: "Puts" }]} />
        <Segmented size="xs" value={String(width)} onChange={(v) => setWidth(Number(v))} options={[{ value: "6", label: "±6" }, { value: "12", label: "±12" }, { value: "30", label: "All" }]} />
        <button onClick={() => setHeat((h) => !h)} className={clsx("press rounded-full border px-2.5 py-0.5 text-2xs font-medium", heat ? "border-accent-line bg-accent-muted text-accent" : "border-line text-dim")}>
          Heatmap {heat ? "on" : "off"}
        </button>
      </div>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[560px] border-collapse">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-line">
              {ce ? (
                <>
                  <th className={th}>Call OI</th>
                  <th className={th}>ΔOI</th>
                  <th className={th}>Volume</th>
                  <th className={th}>IV</th>
                  <th className={th}>LTP</th>
                </>
              ) : null}
              <th className="px-3 py-2 text-center text-2xs font-semibold text-ink-2">Strike</th>
              {pe ? (
                <>
                  <th className={clsx(th, "text-left")}>LTP</th>
                  <th className={clsx(th, "text-left")}>IV</th>
                  <th className={clsx(th, "text-left")}>Volume</th>
                  <th className={clsx(th, "text-left")}>ΔOI</th>
                  <th className={clsx(th, "text-left")}>Put OI</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const atm = r.strike === c.atm_strike;
              const itmCall = r.strike < c.spot;
              const rc = rank(c.top_call_oi_strikes, r.strike);
              const rp = rank(c.top_put_oi_strikes, r.strike);
              return (
                <tr key={r.strike} className={clsx("border-b border-line/60", atm && "bg-accent-muted")}>
                  {ce ? (
                    <>
                      <td className={clsx(td, itmCall && "bg-white/[0.02]")} style={bg(r.ce_oi, mx.ce_oi, "down")}>{compact(r.ce_oi)}</td>
                      <td className={clsx(td, (r.ce_chg_oi ?? 0) < 0 ? "text-info" : "")} style={bg(r.ce_chg_oi, mx.ce_chg_oi, "down")}>{compact(r.ce_chg_oi)}</td>
                      <td className={td} style={bg(r.ce_volume, mx.ce_volume, "down")}>{compact(r.ce_volume)}</td>
                      <td className={clsx(td, "text-ink-2")}>{num(r.ce_iv, 1)}</td>
                      <td className={clsx(td, "text-ink")}>{num(r.ce_ltp, 2)}</td>
                    </>
                  ) : null}
                  <td className="px-3 py-1.5 text-center">
                    <span className={clsx("num text-xs font-semibold", atm ? "text-accent" : "text-ink")}>{num(r.strike, 0)}</span>
                    <span className="ml-1 inline-flex gap-0.5 align-middle">
                      {rc >= 0 && rc < 3 ? <span className="rounded bg-down-muted px-1 text-[9px] text-down">R{rc + 1}</span> : null}
                      {rp >= 0 && rp < 3 ? <span className="rounded bg-up-muted px-1 text-[9px] text-up">S{rp + 1}</span> : null}
                      {r.strike === c.max_pain ? <span className="rounded bg-white/5 px-1 text-[9px] text-info">MP</span> : null}
                    </span>
                  </td>
                  {pe ? (
                    <>
                      <td className={clsx(td, "text-left text-ink")}>{num(r.pe_ltp, 2)}</td>
                      <td className={clsx(td, "text-left text-ink-2")}>{num(r.pe_iv, 1)}</td>
                      <td className={clsx(td, "text-left")} style={bg(r.pe_volume, mx.pe_volume, "up")}>{compact(r.pe_volume)}</td>
                      <td className={clsx(td, "text-left", (r.pe_chg_oi ?? 0) < 0 ? "text-info" : "")} style={bg(r.pe_chg_oi, mx.pe_chg_oi, "up")}>{compact(r.pe_chg_oi)}</td>
                      <td className={clsx(td, "text-left", !itmCall && "bg-white/[0.02]")} style={bg(r.pe_oi, mx.pe_oi, "up")}>{compact(r.pe_oi)}</td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-2xs text-dim sm:px-5">
        R1–R3 / S1–S3 = the engine&apos;s top call / put OI strikes · MP = max pain · shading scales with each column · blue = OI unwinding.
      </p>
    </div>
  );
}
