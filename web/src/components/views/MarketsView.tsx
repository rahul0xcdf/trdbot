"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useQuotes, useWatchlist } from "@/lib/client";
import { SCHEDULED, engineLevels, latestWith, opportunities, setupLevels } from "@/lib/derive";
import { dayIST, num, timeIST } from "@/lib/format";
import { INDIA, resolveInstrument } from "@/lib/instruments";
import { useTerminalState } from "../shell/context";
import { Breadth, FiiDiiCard, MetricLine, MoversList } from "../market/breadth";
import { indexValue, SourceLine } from "../market/indices";
import { LevelLadder } from "../market/levels";
import { ChainSummary } from "../market/options";
import { PriceChart } from "../market/PriceChart";
import { QuoteRow } from "../market/quotes";
import { CandidateIndicators, SetupCard } from "../market/setups";
import { Chip, Delta, Empty, Fresh, Kv, Live, PageHeader, Panel, PanelHead, Tag } from "../ui";

export function MarketsView() {
  const state = useTerminalState();
  const india = useQuotes({ group: "india" });
  const fii = latestWith(state, (s) => s.data.fii_dii, SCHEDULED);
  const movers = latestWith(state, (s) => s.data.movers, SCHEDULED);
  const snaps = [state.latest.afternoon, state.latest.premarket, state.latest.evening, state.latest.ai_premarket];
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
          <FiiDiiCard f={fii?.value} history={state.metrics} />
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
          <PanelHead title="Derivatives history" sub="Daily, as logged by the engine (signals.db + evening reports)" right={<Tag kind="raw" />} />
          <div className="grid gap-2 px-4 pb-4 sm:px-5">
            <MetricLine rows={state.metrics} field="pcr" label="Nifty PCR" />
            <MetricLine rows={state.metrics} field="vix" label="India VIX" />
            <MetricLine rows={state.metrics} field="max_pain" label="Nifty max pain" decimals={0} />
            {state.metrics.length < 2 ? <p className="text-sm text-dim">Not enough history yet — run tools/backfill_web.py once.</p> : null}
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
  const ai = state.latest.ai_premarket;
  const setup = opportunities(ai).find((o) => o.symbol === inst.key);
  const candidate = ai?.data.candidates?.[inst.key];
  const levels = useMemo(
    () => (inst.chain ? engineLevels(state, inst.chain) : setup && ai ? setupLevels(setup, ai) : []),
    [state, inst.chain, setup, ai],
  );
  const chain = inst.chain ? latestWith(state, (s) => s.data.option_chains?.[inst.chain!]) : null;
  const engRow = inst.engineIndex ? latestWith(state, (s) => s.data.indices?.[inst.engineIndex!], SCHEDULED) : null;
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
          <PanelHead title={inst.chain ? "Engine levels" : setup ? "Setup levels" : "Levels"} right={levels.length ? <Tag kind="engine" /> : null} />
          {levels.length ? (
            <LevelLadder levels={levels} price={v.price} />
          ) : (
            <Empty title="Your engine hasn't published levels for this instrument.">
              Levels exist for Nifty and Bank Nifty (option chain + AI report) and for stocks with a setup in today&apos;s AI report.
            </Empty>
          )}
        </Panel>
        {setup && ai ? (
          <div className="lg:col-span-2">
            <SetupCard op={setup} snap={ai} candidate={candidate} expanded />
          </div>
        ) : null}
        {candidate && !setup ? (
          <Panel>
            <PanelHead title="Screener snapshot" />
            <div className="px-4 pb-4 sm:px-5">
              <CandidateIndicators c={candidate} />
            </div>
          </Panel>
        ) : null}
        {chain ? (
          <Panel className="lg:col-span-2">
            <PanelHead title="Option chain" href="/options" right={<Tag kind="raw">NSE via engine · {timeIST(chain.snap.generated_at)}</Tag>} />
            <div className="px-4 pb-5 sm:px-5">
              <ChainSummary c={chain.value} />
            </div>
          </Panel>
        ) : null}
        {engRow ? (
          <Panel>
            <PanelHead title="Last session" sub={`${engRow.snap.trade_date ?? "—"} · captured ${dayIST(engRow.snap.generated_at)} ${timeIST(engRow.snap.generated_at)}`} right={<Tag kind="raw">NSE via engine</Tag>} />
            <dl className="divide-y divide-line px-4 pb-3 sm:px-5">
              <Kv k="Open" v={num(engRow.value.open)} />
              <Kv k="High" v={num(engRow.value.high)} />
              <Kv k="Low" v={num(engRow.value.low)} />
              <Kv k="Close / last" v={num(engRow.value.last)} />
              <Kv k="Prev close" v={num(engRow.value.prev_close)} />
              <Kv k="1-week" v={<Delta pctValue={engRow.value.week_pct ?? null} showAbs={false} />} />
              {engRow.value.advances ? <Kv k="Advances / declines" v={`${engRow.value.advances} / ${engRow.value.declines}`} /> : null}
            </dl>
          </Panel>
        ) : null}
        {inst.group === "stock" && !setup && !candidate ? (
          <Panel className="lg:col-span-3">
            <Empty title={`No engine analysis for ${inst.key} today`} className="pt-5">
              <Chip>Prices only</Chip> The engine analyses stocks it shortlists in the AI pre-market report.
            </Empty>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
