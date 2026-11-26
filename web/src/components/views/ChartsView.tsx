"use client";
import { useMemo, useState } from "react";
import { useQuotes } from "@/lib/client";
import { activePlan, planLevels } from "@/lib/derive";
import { INDIA, resolveInstrument } from "@/lib/instruments";
import { num } from "@/lib/format";
import { useTerminalState } from "../shell/context";
import { indexValue } from "../market/indices";
import { LevelLadder } from "../market/levels";
import { PriceChart } from "../market/PriceChart";
import { AnalysisStamp } from "../market/engine";
import { Delta, Live, PageHeader, Panel, PanelHead, clsx } from "../ui";

export function ChartsView() {
  const state = useTerminalState();
  const [key, setKey] = useState("NIFTY");
  const inst = resolveInstrument(key);
  const { map } = useQuotes({ keys: [key] });
  const v = indexValue(inst, map.get(key), state);
  const ap = activePlan(state, new Date(state.server_time));
  const plan = inst.chain ? ap?.snap.indices?.[inst.chain]?.plan : null;
  const levels = useMemo(() => planLevels(plan), [plan]);
  return (
    <>
      <PageHeader kicker="Charts" title={inst.name}>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <Live value={v.price} className="num text-[24px] font-semibold text-ink">
            {num(v.price, inst.decimals ?? 2)}
          </Live>
          <Delta value={v.change} pctValue={v.change_pct} />
        </div>
      </PageHeader>
      <div className="rail -mx-4 mb-4 gap-2 px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {INDIA.map((i) => (
          <button
            key={i.key}
            onClick={() => setKey(i.key)}
            className={clsx(
              "press rounded-full border px-4 py-2 text-sm whitespace-nowrap",
              key === i.key ? "border-transparent bg-ink text-bg" : "border-line text-ink-2 hover:border-line-strong",
            )}
          >
            {i.name}
            {i.chain ? <span className={clsx("ml-1.5 text-2xs", key === i.key ? "text-bg/70" : "text-accent")}>plan</span> : null}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5">
        <Panel>
          <PriceChart key={key} instrumentKey={key} levels={levels} height={560} />
        </Panel>
        <Panel>
          <PanelHead title="Plan levels" right={ap && levels.length ? <AnalysisStamp snap={ap.snap} /> : null} />
          {levels.length ? (
            <LevelLadder levels={levels} price={v.price} source={ap ? { id: ap.snap.id, session: ap.snap.session, time: ap.snap.generated_at } : null} />
          ) : (
            <p className="px-5 pb-5 text-sm text-dim">{inst.chain ? "No plan published yet." : `The engine plans NIFTY 50 and BANK NIFTY only — no levels for ${inst.name}.`}</p>
          )}
        </Panel>
      </div>
      <p className="mt-3 text-xs text-dim">
        Pinch or scroll to zoom, drag to pan. Candles are raw prices (Yahoo Finance, NSE quotes ~15 min delayed); lines are your engine&apos;s plan levels — the website
        draws no levels of its own.
      </p>
    </>
  );
}
