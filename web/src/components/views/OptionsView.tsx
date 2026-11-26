"use client";
import { useState } from "react";
import { latestWith } from "@/lib/derive";
import { compact, dayIST, num, timeIST } from "@/lib/format";
import type { IndexKey } from "@/lib/types";
import { useTerminalState } from "../shell/context";
import { MetricLine } from "../market/breadth";
import { ChainSummary, ChainTable, OiProfile, chainView } from "../market/options";
import { Empty, PageHeader, Panel, PanelHead, Segmented, Tag } from "../ui";

export function OptionsView() {
  const state = useTerminalState();
  const [sym, setSym] = useState<IndexKey>("NIFTY");
  const hit = latestWith(state, (s) => (s.indices?.[sym]?.chain?.strikes?.length ? s.indices[sym]!.chain : null));
  const c = chainView(hit?.value);
  const fut = latestWith(state, (s) => s.indices?.[sym]?.futures);
  return (
    <>
      <PageHeader
        kicker="Options"
        title="Option chain"
        right={<Segmented value={sym} onChange={setSym} options={[{ value: "NIFTY", label: "Nifty" }, { value: "BANKNIFTY", label: "Bank Nifty" }]} />}
      >
        {hit ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <Tag kind="raw">NSE via engine</Tag> captured {timeIST(hit.snap.generated_at)} {dayIST(hit.snap.generated_at)}
          </span>
        ) : null}
      </PageHeader>
      {!hit || !c ? (
        <Panel>
          <Empty title="No option chain published yet" className="pt-5">
            The engine sends the chain for the expiry it would trade with every 8:45 AM, 11:45 AM and 6:00 PM report.
          </Empty>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:gap-5">
          <div className="flex flex-col gap-4 lg:gap-5">
            <Panel>
              <PanelHead title="Positioning" right={<Tag kind="raw" />} />
              <div className="px-4 pb-5 sm:px-5">
                <ChainSummary c={c} />
                {c.expiryNote ? <p className="mt-3 text-xs text-dim">Expiry the plan uses: {c.expiryNote}. Prefer ATM / 1-ITM — far-OTM decays to zero.</p> : null}
              </div>
            </Panel>
            {fut ? (
              <Panel>
                <PanelHead title="Index futures" sub={`Near month · ${fut.value.expiry ?? ""}`} right={<Tag kind="raw">NSE via engine</Tag>} />
                <dl className="grid grid-cols-2 gap-px overflow-hidden border-t border-line bg-line sm:grid-cols-4">
                  {[
                    ["Last", num(fut.value.last)],
                    ["Futures VWAP", num(fut.value.vwap)],
                    ["OI", compact(fut.value.oi)],
                    ["Δ OI", compact(fut.value.chg_oi)],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-card px-4 py-2.5">
                      <dt className="text-2xs text-dim">{k}</dt>
                      <dd className="num text-[15px] text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="px-4 py-2.5 text-2xs text-dim sm:px-5">
                  Captured {timeIST(fut.snap.generated_at)} {dayIST(fut.snap.generated_at)} — the futures VWAP is the one most index traders watch.
                </p>
              </Panel>
            ) : null}
            <Panel>
              <PanelHead title="Open interest by strike" right={<Tag kind="view" />} />
              <div className="px-4 pb-5 sm:px-5">
                <OiProfile c={c} width={12} />
              </div>
            </Panel>
            {sym === "NIFTY" ? (
              <Panel>
                <PanelHead title="History" sub="Daily, from the engine's evening reports" />
                <div className="grid gap-2 px-4 pb-5 sm:grid-cols-2 sm:px-5">
                  <MetricLine rows={state.metrics} field="pcr" label="PCR" />
                  <MetricLine rows={state.metrics} field="max_pain" label="Max pain" decimals={0} />
                </div>
              </Panel>
            ) : null}
          </div>
          <Panel className="self-start">
            <PanelHead title="Chain & heatmap" sub={`${c.strikes.length} strikes around spot`} right={<Tag kind="raw" />} />
            <ChainTable c={c} />
          </Panel>
        </div>
      )}
    </>
  );
}
