"use client";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineStyle,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCandles } from "@/lib/client";
import { num, pct } from "@/lib/format";
import type { Level } from "@/lib/derive";
import { Fresh, Segmented, Tag, clsx } from "../ui";

const IST = 19800; // lightweight-charts renders UTC; shift so the axis reads IST

const LINE: Record<Level["role"], { color: string; style: LineStyle; width: 1 | 2 }> = {
  trigger: { color: "#e0a95b", style: LineStyle.Solid, width: 2 },
  stop: { color: "#e58c7a", style: LineStyle.Solid, width: 1 },
  target: { color: "#9cc29a", style: LineStyle.Solid, width: 1 },
  zone: { color: "#8b8b8866", style: LineStyle.Dashed, width: 1 },
};

/** Short axis label: "Bull ▲", "Bear SL", "PDH"… (the engine's own names). */
function short(l: Level): string {
  if (l.role === "zone") return l.names[0] ?? "";
  const s = l.side === "bull" ? "Bull" : "Bear";
  if (l.role === "trigger") return `${s} trigger`;
  if (l.role === "stop") return `${s} SL`;
  return l.label.replace(/^(Bull|Bear) /, `${s} `);
}

export const TFS = ["1D", "5D", "1M", "6M", "1Y"] as const;
export type TF = (typeof TFS)[number];

export function PriceChart({
  instrumentKey,
  levels = [],
  height = 380,
  defaultTf = "1D",
  showToolbar = true,
  className,
}: {
  instrumentKey: string;
  levels?: Level[];
  height?: number;
  defaultTf?: TF;
  showToolbar?: boolean;
  className?: string;
}) {
  const [tf, setTf] = useState<TF>(defaultTf);
  const [showLevels, setShowLevels] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const [hover, setHover] = useState<{ o: number; h: number; l: number; c: number } | null>(null);
  const { data, loading, error } = useCandles(instrumentKey, tf);
  const decimals = useMemo(() => {
    const p = data?.candles.at(-1)?.close ?? 100;
    return p < 50 ? 2 : p < 2000 ? 2 : 2;
  }, [data]);

  // Create once
  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b8b88",
        fontFamily: "IBM Plex Mono, ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: "#efefeb0a" }, horzLines: { color: "#efefeb0a" } },
      rightPriceScale: { borderColor: "#efefeb14", scaleMargins: { top: 0.08, bottom: 0.2 } },
      timeScale: { borderColor: "#efefeb14", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#efefeb40", labelBackgroundColor: "#141413" },
        horzLine: { color: "#efefeb40", labelBackgroundColor: "#141413" },
      },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      handleScroll: { horzTouchDrag: true, vertTouchDrag: false, mouseWheel: true, pressedMouseMove: true },
    });
    candles.current = c.addSeries(CandlestickSeries, {
      upColor: "#9cc29a",
      downColor: "#e58c7a",
      borderUpColor: "#9cc29a",
      borderDownColor: "#e58c7a",
      wickUpColor: "#9cc29a99",
      wickDownColor: "#e58c7a99",
      priceLineColor: "#e0a95b",
      priceLineStyle: LineStyle.Solid,
    });
    volume.current = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    c.subscribeCrosshairMove((p) => {
      const d = p.seriesData.get(candles.current!) as { open: number; high: number; low: number; close: number } | undefined;
      setHover(d ? { o: d.open, h: d.high, l: d.low, c: d.close } : null);
    });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
    };
  }, []);

  // Data
  useEffect(() => {
    if (!candles.current || !volume.current) return;
    const cs = data?.candles ?? [];
    candles.current.setData(cs.map((k) => ({ time: (k.time + IST) as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })));
    volume.current.setData(
      cs.map((k) => ({ time: (k.time + IST) as UTCTimestamp, value: k.volume, color: k.close >= k.open ? "#9cc29a33" : "#e58c7a33" })),
    );
    chart.current?.timeScale().fitContent();
  }, [data]);

  // Engine levels as price lines
  useEffect(() => {
    const s = candles.current;
    if (!s) return;
    lines.current.forEach((l) => s.removePriceLine(l));
    lines.current = [];
    if (!showLevels) return;
    levels.forEach((l) => {
      const st = LINE[l.role];
      lines.current.push(
        s.createPriceLine({ price: l.price, color: st.color, lineWidth: st.width, lineStyle: st.style, axisLabelVisible: l.role !== "zone", title: short(l) }),
      );
    });
  }, [levels, showLevels, data]);

  const last = data?.candles.at(-1);
  const first = data?.candles[0];
  const shown = hover ?? (last ? { o: last.open, h: last.high, l: last.low, c: last.close } : null);
  const chg = last && first ? ((last.close - first.open) / first.open) * 100 : null;

  return (
    <div className={clsx("flex flex-col", className)}>
      {showToolbar ? (
        <div className="flex flex-wrap items-center gap-2 px-3.5 pt-2.5 sm:px-4">
          <Segmented size="xs" value={tf} onChange={setTf} options={TFS.map((t) => ({ value: t, label: t }))} />
          {levels.length ? (
            <button
              onClick={() => setShowLevels((v) => !v)}
              className={clsx(
                "press rounded-full border px-2 py-0.5 text-2xs font-medium",
                showLevels ? "border-accent-line bg-accent-muted text-accent" : "border-line text-dim",
              )}
            >
              Engine levels {showLevels ? "on" : "off"}
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <Tag kind="raw">{data?.source ?? "Yahoo Finance"}</Tag>
            <Fresh at={data?.updated} />
          </div>
        </div>
      ) : null}
      <div className="relative" style={{ height }}>
        <div ref={box} className="absolute inset-0" />
        {shown ? (
          <div className="pointer-events-none absolute top-2 left-3.5 z-10 flex flex-wrap gap-x-3 text-2xs text-dim sm:left-4">
            <span className="hidden sm:inline">O <span className="num text-ink-2">{num(shown.o, decimals)}</span></span>
            <span className="hidden sm:inline">H <span className="num text-ink-2">{num(shown.h, decimals)}</span></span>
            <span className="hidden sm:inline">L <span className="num text-ink-2">{num(shown.l, decimals)}</span></span>
            <span>C <span className="num text-ink">{num(shown.c, decimals)}</span></span>
            {!hover && chg !== null ? <span className={chg >= 0 ? "text-up" : "text-down"}>{tf} {pct(chg)}</span> : null}
          </div>
        ) : null}
        {!loading && (!data || data.candles.length === 0) ? (
          <div className="absolute inset-0 z-20 grid place-items-center bg-card/70 px-6 text-center">
            <div className="max-w-sm">
              <p className="text-sm text-ink-2">{error || data?.error ? "Live candles unavailable" : "No candles for this range yet"}</p>
              <p className="mt-1 text-xs text-dim">
                {data?.error ? `Yahoo Finance: ${data.error}. ` : ""}
                {tf === "1D" ? "Intraday bars appear once the market opens (9:15 AM IST). " : ""}
                The plan's levels are still listed in the ladder.
              </p>
            </div>
          </div>
        ) : null}
      </div>
      {levels.length && showLevels ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-3.5 py-2 text-2xs text-dim sm:px-4">
          <Legend color="#e0a95b">Trigger (15-min close + retest)</Legend>
          <Legend color="#e58c7a">Stop</Legend>
          <Legend color="#9cc29a">Targets</Legend>
          {levels.some((l) => l.role === "zone") ? <Legend color="#8b8b88" dash>Other engine levels</Legend> : null}
          <span className="ml-auto"><Tag kind="engine">plan levels</Tag></span>
        </div>
      ) : null}
    </div>
  );
}

function Legend({ color, dash, dot, children }: { color: string; dash?: boolean; dot?: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="16" height="4" aria-hidden>
        <line x1="0" x2="16" y1="2" y2="2" stroke={color} strokeWidth="1.5" strokeDasharray={dash ? "4 3" : dot ? "1 3" : undefined} />
      </svg>
      {children}
    </span>
  );
}
