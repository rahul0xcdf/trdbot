"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useQuotes, useWatchlist } from "@/lib/client";
import { SCHEDULED, activePlan, latestWith, planLevels, setupsOf } from "@/lib/derive";
import { dayIST, num, timeIST } from "@/lib/format";
import { INDIA, resolveInstrument } from "@/lib/instruments";
import { useTerminalState } from "../shell/context";
import { Breadth, FiiDiiCard, MetricLine, MoversList } from "../market/breadth";
import { indexValue, SourceLine } from "../market/indices";
import { LevelLadder } from "../market/levels";
import { ChainSummary, chainView } from "../market/options";
import { PriceChart } from "../market/PriceChart";
import { QuoteRow } from "../market/quotes";
import { SetupCard } from "../market/setups";
import { AnalysisStamp } from "../market/engine";
import { IndexRead } from "../market/read";
import { Chip, Delta, Empty, Fresh, Kv, Live, PageHeader, Panel, PanelHead, Tag } from "../ui";

export function MarketsView() {
  const state = useTerminalState();
  const india = useQuotes({ group: "india" });
  const fii = latestWith(state, (s) => s.data?.fii_dii, SCHEDULED);
  const movers = latestWith(state, (s) => s.data?.movers, SCHEDULED);
  const snaps = [state.latest.midday, state.latest.premarket, state.latest.evening];
  return (
    <>
      <PageHeader kicker="Markets" title="Indian markets" right={<Fresh at={india.fetchedAt} label="Prices" />}>
        Live index prices, institutional flows and breadth.
      </PageHeader>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <Panel className="lg:col-span-2">
          <PanelHead title="Indices" right={<Tag kind="raw">{india.quotes[0]?.source ?? "Yahoo Finance"}</Tag>} />
          <div className="divide-y divide-line pb-2">
            {INDIA.map((i) => {
              const v = indexValue(i, india.map.get(i.key), state);
              return (
                <Link key={i.key} href={`/markets/${i.key}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-hover/40 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">{i.name}</p>
                    <p className="text-2xs text-dim">
                      {v.source} · {v.time ? timeIST(v.time, !v.viaEngine) : "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <Live value={v.price} className="num block text-[17px] font-semibold">
                      {num(v.price)}
                    </Live>
                    <Delta value={v.change} pctValue={v.change_pct} className="text-xs" />
                  </div>
                </Link>
              );
            })}
          </div>
        </Panel>
        <Panel id="flows">
          <PanelHead title="FII / DII" right={<Tag kind="raw">NSE via engine</Tag>} />
          <FiiDiiCard f={fii?.value ?? undefined} history={state.metrics} />
        </Panel>
        <Panel>
          <PanelHead title="Breadth" right={<Tag kind="raw">NSE via engine</Tag>} />
          <Breadth snaps={snaps} />
        </Panel>
        <Panel>
          <PanelHead title="Top movers" sub={movers ? `${dayIST(movers.snap.generated_at)} · ${timeIST(movers.snap.generated_at)}` : undefined} right={<Tag kind="raw">NSE via engine</Tag>} />
          {movers?.value.NIFTY ? <MoversList movers={movers.value.NIFTY} title="Nifty 50" /> : <Empty title="No movers in the latest snapshots." />}
          {movers?.value.BANKNIFTY ? <MoversList movers={movers.value.BANKNIFTY} title="Bank Nifty" /> : null}
        </Panel>
        <Panel>
          <PanelHead title="Derivatives history" sub="Daily, from the engine's evening reports" right={<Tag kind="raw" />} />
          <div className="grid gap-2 px-4 pb-4 sm:px-5">
            <MetricLine rows={state.metrics} field="pcr" label="Nifty PCR" />
            <MetricLine rows={state.metrics} field="vix" label="India VIX" />
            <MetricLine rows={state.metrics} field="max_pain" label="Nifty max pain" decimals={0} />
            {state.metrics.length < 2 ? <p className="text-sm text-dim">Builds up one point per evening report.</p> : null}
          </div>
        </Panel>
      </div>
    </>
  );
}

/* ── One instrument ──────────────────────────────────────────────────────── */

export function InstrumentView({ symbol }: { symbol: string }) {
  const state = useTerminalState();
  const inst = resolveInstrument(symbol);
  const { map } = useQuotes({ keys: [inst.key] });
  const { keys, add, remove } = useWatchlist();
  const v = indexValue(inst, map.get(inst.key), state);
  const ap = activePlan(state, new Date(state.server_time));
  const plan = inst.chain ? ap?.snap.indices?.[inst.chain]?.plan : null;
  const levels = useMemo(() => planLevels(plan), [plan]);
  const items = setupsOf(ap?.snap).filter((x) => x.key === inst.chain);
  const chain = inst.chain ? latestWith(state, (s) => (s.indices?.[inst.chain!]?.chain?.strikes?.length ? s.indices[inst.chain!]!.chain : null)) : null;
  const read = inst.chain ? latestWith(state, (s) => s.indices?.[inst.chain!], SCHEDULED) : null;
  const watching = keys.includes(inst.key);
  return (
    <>
      <PageHeader
        kicker={<Link href="/markets">Markets</Link>}
        title={inst.name}
        right={
          <button onClick={() => (watching ? remove(inst.key) : add(inst.key))} className="press rounded-full border border-line px-4 py-2 text-sm text-ink-2 hover:border-line-strong">
            {watching ? "★ In watchlist" : "☆ Add to watchlist"}
          </button>
        }
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Live value={v.price} className="num text-[28px] font-semibold tracking-[-0.03em] text-ink">
            {num(v.price, inst.decimals ?? 2)}
          </Live>
          <Delta value={v.change} pctValue={v.change_pct} className="text-[15px]" />
          <SourceLine v={v} />
          <Fresh at={v.time} />
        </div>
      </PageHeader>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <Panel className="lg:col-span-2">
          <PriceChart instrumentKey={inst.key} levels={levels} height={440} />
        </Panel>
        <Panel>
          <PanelHead title="Plan levels" right={ap && levels.length ? <AnalysisStamp snap={ap.snap} /> : null} />
          {levels.length ? (
            <LevelLadder levels={levels} price={v.price} source={ap ? { id: ap.snap.id, session: ap.snap.session, time: ap.snap.generated_at } : null} />
          ) : (
            <Empty title={inst.chain ? "No plan published yet." : "Your engine doesn't plan this instrument."}>
              The engine builds levels and scenarios for NIFTY 50 and BANK NIFTY only.
            </Empty>
          )}
        </Panel>
        {items.map((it) => (
          <div key={it.side} className="lg:col-span-1">
            <SetupCard item={it} />
          </div>
        ))}
        {read ? (
          <Panel className="lg:col-span-2">
            <PanelHead title="Engine read" right={<AnalysisStamp snap={read.snap} />} />
            <div className="px-4 pb-5 sm:px-5">
              <IndexRead snap={read.snap} ix={read.value} />
            </div>
          </Panel>
        ) : null}
        {chain && chainView(chain.value) ? (
          <Panel className="lg:col-span-2">
            <PanelHead title="Option chain" href="/options" right={<Tag kind="raw">NSE via engine · {timeIST(chain.snap.generated_at)}</Tag>} />
            <div className="px-4 pb-5 sm:px-5">
              <ChainSummary c={chainView(chain.value)!} />
            </div>
          </Panel>
        ) : null}
        {inst.group === "stock" ? (
          <Panel className="lg:col-span-3">
            <Empty title={`No engine analysis for ${inst.key}`} className="pt-5">
              <Chip>Prices only</Chip> The engine plans NIFTY 50 and BANK NIFTY; other instruments show live prices only.
            </Empty>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
