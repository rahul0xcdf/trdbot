"use client";
import { useMemo, useState } from "react";
import { useQuotes } from "@/lib/client";
import { engineLevels, opportunities, setupLevels } from "@/lib/derive";
import { INDIA, resolveInstrument } from "@/lib/instruments";
import { useTerminalState } from "../shell/context";
import { indexValue } from "../market/indices";
import { LevelLadder } from "../market/levels";
import { PriceChart } from "../market/PriceChart";
import { Delta, Live, PageHeader, Panel, PanelHead, Tag, clsx } from "../ui";
import { num } from "@/lib/format";

export function ChartsView() {
  const state = useTerminalState();
  const ai = state.latest.ai_premarket;
  const setups = opportunities(ai);
  const choices = [...INDIA.map((i) => i.key), ...setups.map((s) => s.symbol)];
  const [key, setKey] = useState("NIFTY");
  const inst = resolveInstrument(key);
  const { map } = useQuotes({ keys: [key] });
  const v = indexValue(inst, map.get(key), state);
  const setup = setups.find((s) => s.symbol === key);
  const levels = useMemo(() => (inst.chain ? engineLevels(state, inst.chain, 5) : setup && ai ? setupLevels(setup, ai) : []), [state, inst.chain, setup, ai]);
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
        {choices.map((k) => {
          const isSetup = setups.some((s) => s.symbol === k);
          return (
            <button
              key={k}
              onClick={() => setKey(k)}
              className={clsx(
                "press rounded-full border px-4 py-2 text-sm whitespace-nowrap",
                key === k ? "border-transparent bg-ink text-bg" : "border-line text-ink-2 hover:border-line-strong",
              )}
            >
              {resolveInstrument(k).name}
              {isSetup ? <span className={clsx("ml-1.5 text-2xs", key === k ? "text-bg/70" : "text-accent")}>setup</span> : null}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5">
        <Panel>
          <PriceChart key={key} instrumentKey={key} levels={levels} height={560} />
        </Panel>
        <Panel>
          <PanelHead title="Levels on the chart" right={levels.length ? <Tag kind="engine" /> : null} />
          {levels.length ? <LevelLadder levels={levels} price={v.price} /> : <p className="px-5 pb-5 text-sm text-dim">The engine publishes no levels for {inst.name}.</p>}
        </Panel>
      </div>
      <p className="mt-3 text-xs text-dim">
        Pinch or scroll to zoom, drag to pan. Candles are raw prices (Yahoo Finance, NSE quotes ~15 min delayed); lines are your engine&apos;s published levels — the website
        draws no levels of its own.
      </p>
    </>
  );
}
