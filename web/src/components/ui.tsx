"use client";
import clsx from "clsx";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ago, pct, signed, timeIST, tone } from "@/lib/format";
import { useNow } from "@/lib/client";

export { clsx };

/* ── Provenance: RAW data · ENGINE analysis · VIEW (visualisation) ───────── */

export type Prov = "raw" | "engine" | "view";

const PROV: Record<Prov, { label: string; cls: string; title: string }> = {
  raw: { label: "Raw", cls: "text-ink-2 border-line-strong", title: "Raw market data, shown as received" },
  engine: { label: "Engine", cls: "text-accent border-accent-line bg-accent-muted", title: "Produced by your market engine — shown verbatim" },
  view: { label: "View", cls: "text-info border-[#a9b8c933]", title: "Visualisation of the data above — no new analysis" },
};

export function Tag({ kind, children }: { kind: Prov; children?: ReactNode }) {
  const p = PROV[kind];
  return (
    <span
      title={p.title}
      className={clsx("inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-2xs leading-4 font-medium whitespace-nowrap", p.cls)}
    >
      <span className={clsx("size-1 rounded-full", kind === "engine" ? "bg-accent" : kind === "raw" ? "bg-ink-2" : "bg-info")} />
      {p.label}
      {children ? <span className="text-dim font-normal">· {children}</span> : null}
    </span>
  );
}

/* ── Time ────────────────────────────────────────────────────────────────── */

export function Ago({ at, className }: { at: string | number | Date | null | undefined; className?: string }) {
  const now = useNow(15_000);
  return (
    <span className={className} suppressHydrationWarning>
      {ago(at, now)}
    </span>
  );
}

/** "Updated 08:47:12 AM" with a dot coloured by age. */
export function Fresh({ at, label = "Updated", seconds = true, staleAfterMin = 30 }: { at: string | null | undefined; label?: string; seconds?: boolean; staleAfterMin?: number }) {
  const now = useNow(15_000);
  const age = at ? (now - new Date(at).getTime()) / 60_000 : Infinity;
  const dot = age < 3 ? "bg-up live-dot" : age < staleAfterMin ? "bg-ink-2" : "bg-accent";
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs text-dim whitespace-nowrap" suppressHydrationWarning title={at ? new Date(at).toISOString() : "never"}>
      <span className={clsx("size-1.5 rounded-full", at ? dot : "bg-faint")} suppressHydrationWarning />
      {label} <span className="num text-ink-2" suppressHydrationWarning>{at ? timeIST(at, seconds) : "—"}</span>
    </span>
  );
}

/* ── Panels ──────────────────────────────────────────────────────────────── */

export function Panel({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={clsx("panel min-w-0", className)}>
      {children}
    </section>
  );
}

export function PanelHead({ title, right, sub, href }: { title: ReactNode; right?: ReactNode; sub?: ReactNode; href?: string }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4 pb-3 sm:px-5">
      <div className="flex min-w-0 flex-col gap-0.5">
        {href ? (
          <Link href={href} className="title inline-flex items-center gap-1 hover:text-accent-hi">
            {title}
            <span className="text-dim">›</span>
          </Link>
        ) : (
          <h2 className="title">{title}</h2>
        )}
        {sub ? <div className="text-xs text-dim">{sub}</div> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </header>
  );
}

/** Large native-style page title with a kicker line. */
export function PageHeader({ kicker, title, right, children }: { kicker?: ReactNode; title: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
      <div className="min-w-0">
        {kicker ? <p className="eyebrow mb-1.5">{kicker}</p> : null}
        <h1 className="text-[30px] leading-[1.1] font-semibold tracking-[-0.035em] sm:text-[38px]">{title}</h1>
        {children ? <div className="mt-2 text-sm text-ink-2">{children}</div> : null}
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}

export function Empty({ title, children, className }: { title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col items-start gap-1 px-4 pb-5 text-sm sm:px-5", className)}>
      <p className="text-ink-2">{title}</p>
      {children ? <div className="text-xs text-dim max-w-prose">{children}</div> : null}
    </div>
  );
}

/* ── Numbers ─────────────────────────────────────────────────────────────── */

export function Delta({ value, pctValue, d = 2, className, showAbs = true }: { value?: number | null; pctValue?: number | null; d?: number; className?: string; showAbs?: boolean }) {
  const t = tone(pctValue ?? value);
  return (
    <span className={clsx("num whitespace-nowrap", t === "up" ? "text-up" : t === "down" ? "text-down" : "text-dim", className)}>
      {showAbs && value !== undefined ? signed(value, d) : null}
      {showAbs && value !== undefined && pctValue !== undefined ? " " : null}
      {pctValue !== undefined ? (showAbs && value !== undefined ? `(${pct(pctValue)})` : pct(pctValue)) : null}
    </span>
  );
}

/** Briefly tints a number green/red when it changes. */
export function Live({ value, children, className }: { value: number | null | undefined; children: ReactNode; className?: string }) {
  const prev = useRef(value);
  const [cls, setCls] = useState("");
  useEffect(() => {
    if (prev.current != null && value != null && value !== prev.current) {
      setCls(value > prev.current ? "flash-up" : "flash-down");
      const t = setTimeout(() => setCls(""), 1200);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return <span className={clsx(cls, className)}>{children}</span>;
}

/* ── Chips / segmented ───────────────────────────────────────────────────── */

export function Chip({ children, tone: t = "neutral", className, title }: { children: ReactNode; tone?: "neutral" | "up" | "down" | "accent" | "info" | "solid"; className?: string; title?: string }) {
  const map = {
    neutral: "border-line-strong text-ink-2",
    up: "border-[#9cc29a40] text-up bg-up-muted",
    down: "border-[#e58c7a40] text-down bg-down-muted",
    accent: "border-accent-line text-accent bg-accent-muted",
    info: "border-[#a9b8c933] text-info",
    solid: "border-transparent bg-ink text-bg",
  } as const;
  return (
    <span title={title} className={clsx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium uppercase tracking-[0.06em] whitespace-nowrap", map[t], className)}>
      {children}
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "sm" }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: "sm" | "xs" }) {
  return (
    <div role="tablist" className="inline-flex rounded-full border border-line bg-bg-sunk p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "press rounded-full font-medium transition-colors",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-2xs",
            o.value === value ? "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-dim hover:text-ink-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Sparkline (SVG) ─────────────────────────────────────────────────────── */

export function Sparkline({ data, base, width = 96, height = 28, className }: { data: number[]; base?: number | null; width?: number; height?: number; className?: string }) {
  if (data.length < 2)
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={className} aria-hidden>
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="var(--color-line-strong)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
      </svg>
    );
  const lo = Math.min(...data, base ?? Infinity);
  const hi = Math.max(...data, base ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (data.length - 1)) * width;
  const y = (v: number) => height - 2 - ((v - lo) / span) * (height - 4);
  const d = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const up = data.at(-1)! >= (base ?? data[0]);
  const stroke = up ? "var(--color-up)" : "var(--color-down)";
  const gid = `g${Math.round(lo * 100)}${data.length}${up ? 1 : 0}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.18" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {base != null && base >= lo && base <= hi ? (
        <line x1="0" x2={width} y1={y(base)} y2={y(base)} stroke="var(--color-line-strong)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      ) : null}
      <path d={`${d}L${width},${height}L0,${height}Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ── Meter ───────────────────────────────────────────────────────────────── */

export function Meter({ value, tone: t = "neutral", className }: { value: number; tone?: "up" | "down" | "accent" | "neutral"; className?: string }) {
  const c = { up: "bg-up", down: "bg-down", accent: "bg-accent", neutral: "bg-ink-2" }[t];
  return (
    <div className={clsx("h-1 w-full overflow-hidden rounded-full bg-line", className)}>
      <div className={clsx("h-full rounded-full", c)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Kv({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex items-baseline justify-between gap-3 py-1", className)}>
      <dt className="text-xs text-dim">{k}</dt>
      <dd className="num text-sm text-ink text-right">{v}</dd>
    </div>
  );
}

export function BiasChip({ bias, size = "md" }: { bias: string | null | undefined; size?: "md" | "lg" }) {
  if (!bias) return <Chip>No bias published</Chip>;
  const b = bias.toLowerCase();
  const t = b.includes("bull") ? "up" : b.includes("bear") ? "down" : "neutral";
  return (
    <Chip tone={t} className={size === "lg" ? "px-3 py-1 text-xs" : undefined}>
      {bias.toUpperCase()}
    </Chip>
  );
}
