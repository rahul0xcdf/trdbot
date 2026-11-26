"use client";
import { useState } from "react";
import { latestWith } from "@/lib/derive";
import { dayIST, timeIST } from "@/lib/format";
import { useTerminalState } from "../shell/context";
import { MetricLine } from "../market/breadth";
import { ChainSummary, ChainTable, OiProfile } from "../market/options";
import { Empty, PageHeader, Panel, PanelHead, Segmented, Tag } from "../ui";

export function OptionsView() {
  const state = useTerminalState();
  const [sym, setSym] = useState<"NIFTY" | "BANKNIFTY">("NIFTY");
  const hit = latestWith(state, (s) => s.data.option_chains?.[sym]);
  const labels = latestWith(state, (s) => s.data.labels);
  const label = sym === "NIFTY" ? labels?.value.nifty_pcr : labels?.value.banknifty_pcr;
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
      {!hit ? (
        <Panel>
          <Empty title="No option chain published yet" className="pt-5">
            The engine sends the nearest-expiry chain with its 8:15 AM and 6:00 PM reports.
          </Empty>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:gap-5">
          <div className="flex flex-col gap-4 lg:gap-5">
            <Panel>
              <PanelHead title="Positioning" right={<Tag kind="raw" />} />
              <div className="px-4 pb-5 sm:px-5">
                <ChainSummary c={hit.value} />
                {label ? (
                  <p className="mt-3 rounded-xl border border-accent-line/60 bg-accent-muted/60 px-3 py-2 text-sm">
                    <span className="text-dim">Engine&apos;s PCR read: </span>
                    <span className="text-ink">{label}</span>
                  </p>
                ) : null}
              </div>
            </Panel>
            <Panel>
              <PanelHead title="Open interest by strike" right={<Tag kind="view" />} />
              <div className="px-4 pb-5 sm:px-5">
                <OiProfile c={hit.value} width={12} />
              </div>
            </Panel>
            {sym === "NIFTY" ? (
              <Panel>
                <PanelHead title="History" sub="Daily, logged by the engine" />
                <div className="grid gap-2 px-4 pb-5 sm:grid-cols-2 sm:px-5">
                  <MetricLine rows={state.metrics} field="pcr" label="PCR" />
                  <MetricLine rows={state.metrics} field="max_pain" label="Max pain" decimals={0} />
                </div>
              </Panel>
            ) : null}
          </div>
          <Panel className="self-start">
            <PanelHead title="Chain & heatmap" sub={`${hit.value.expiry} · ${hit.value.strikes?.length ?? 0} strikes around ATM`} right={<Tag kind="raw" />} />
            <ChainTable c={hit.value} />
          </Panel>
        </div>
      )}
    </>
  );
}
