"use client";
import Link from "next/link";
import { useMemo } from "react";
import { useQuotes } from "@/lib/client";
import { SCHEDULED, engineBias, engineLevels, latestScheduled, latestWith, opportunities } from "@/lib/derive";
import { dayIST, num, timeIST } from "@/lib/format";
import { GLOBAL, INDIA } from "@/lib/instruments";
import { useTerminalState } from "../shell/context";
import { Brief, Outlook, SessionTimeline } from "../market/engine";
import { buildEvents, EventsList, NewsList } from "../market/feeds";
import { FiiDiiCard, SectorHeatmap } from "../market/breadth";
import { IndexCard, indexValue } from "../market/indices";
import { LevelLadder } from "../market/levels";
import { OiProfile } from "../market/options";
import { PriceChart } from "../market/PriceChart";
import { QuoteRow } from "../market/quotes";
import { SetupCard } from "../market/setups";
import { BiasChip, Chip, Delta, Empty, Fresh, Live, Panel, PanelHead, Tag, clsx } from "../ui";

const REC_TONE: Record<string, "up" | "accent" | "down"> = { GO: "up", CAUTION: "accent", WARNING: "down", STAY_OUT: "down" };

export function TodayView() {
  const state = useTerminalState();
  const india = useQuotes({ group: "india" });
  const glob = useQuotes({ keys: ["SPX", "NASDAQ", "NIKKEI", "BRENT", "GOLD", "USDINR"] });
  const nifty = INDIA[0];
  const nv = indexValue(nifty, india.map.get("NIFTY"), state);
  const bias = engineBias(state);
  const levels = useMemo(() => engineLevels(state, "NIFTY"), [state]);
  const sched = latestScheduled(state);
  const ai = state.latest.ai_premarket;
  const setups = opportunities(ai);
  const chain = latestWith(state, (s) => s.data.option_chains?.NIFTY);
  const news = latestWith(state, (s) => s.data.news);
  const sectors = latestWith(state, (s) => s.data.sectors, SCHEDULED);
  const fii = latestWith(state, (s) => s.data.fii_dii, SCHEDULED);
  const gift = latestWith(state, (s) => s.data.gift_nifty);
  const events = buildEvents([state.latest.evening, state.latest.premarket, state.latest.afternoon]);
  const lastAnalysis = state.timeline[0];

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-3 lg:gap-5">
      {/* ── Status ───────────────────────────────────────── */}
      <section className="order-1 lg:order-none lg:col-span-3">
        <p className="eyebrow mb-2">Today · {dayIST(state.server_time)}</p>
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-1 gap-5 p-5 sm:p-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div>
              <div className="flex items-center gap-2 text-sm text-ink-2">
                NIFTY 50 <Tag kind="raw">{nv.source}</Tag>
              </div>
              <Live value={nv.price} className="num mt-1 block text-[44px] leading-[1.05] font-semibold tracking-[-0.04em] sm:text-[56px]">
                {num(nv.price)}
              </Live>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
                <Delta value={nv.change} pctValue={nv.change_pct} />
                {gift ? (
                  <span className="text-xs text-dim">
                    GIFT Nifty <span className="num text-ink-2">{num(gift.value.last)}</span>{" "}
                    <Delta pctValue={gift.value.change_pct} showAbs={false} className="text-xs" /> · {gift.value.as_of?.slice(-5)}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col justify-between gap-4 rounded-2xl border border-line bg-card-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <BiasChip bias={bias?.current ? bias.sentiment : null} size="lg" />
                {bias?.current && bias.recommendation ? <Chip tone={REC_TONE[bias.recommendation] ?? "neutral"}>{bias.recommendation.replace("_", " ")}</Chip> : null}
                {bias?.current && bias.confidence !== null ? (
                  <span className="text-xs text-dim">
                    confidence <span className="num text-ink-2">{bias.confidence}</span>
                  </span>
                ) : null}
              </div>
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-dim">Analysis updated</dt>
                  <dd className="num mt-0.5 text-[15px] text-ink">{lastAnalysis ? timeIST(lastAnalysis.generated_at) : "—"}</dd>
                  <dd className="mt-0.5">
                    <Tag kind="engine">{lastAnalysis ? dayIST(lastAnalysis.generated_at) : "none yet"}</Tag>
                  </dd>
                </div>
                <div>
                  <dt className="text-dim">Data updated</dt>
                  <dd className="num mt-0.5 text-[15px] text-ink" suppressHydrationWarning>
                    {nv.time ? timeIST(nv.time, true) : "—"}
                  </dd>
                  <dd className="mt-0.5">
                    <Tag kind="raw">{nv.viaEngine ? "engine capture" : "live feed"}</Tag>
                  </dd>
                </div>
              </dl>
              {!bias?.current ? <p className="text-2xs text-dim">The engine hasn&apos;t published a bias for today. Only the AI pre-market report carries one.</p> : null}
            </div>
          </div>
          <div className="border-t border-line px-4 py-3 sm:px-5">
            <SessionTimeline state={state} />
          </div>
        </div>
      </section>

      {/* ── Index cards ──────────────────────────────────── */}
      <section className="order-2 lg:order-none lg:col-span-3">
        <div className="rail -mx-4 gap-3 px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-5">
          {INDIA.map((i) => (
            <div key={i.key} className="w-[172px] sm:w-auto">
              <IndexCard inst={i} v={indexValue(i, india.map.get(i.key), state)} href={`/markets/${i.key}`} />
            </div>
          ))}
        </div>
      </section>

      {/* ── Chart + levels ───────────────────────────────── */}
      <Panel className="order-5 lg:order-none lg:col-span-2">
        <PanelHead title="Nifty 50" href="/charts" sub="Candles from the live feed, levels from your engine" />
        <PriceChart instrumentKey="NIFTY" levels={levels} height={360} />
      </Panel>
      <Panel className="order-3 lg:order-none">
        <PanelHead title="Key levels" sub={chain ? `Nifty · option chain ${timeIST(chain.snap.generated_at)}${ai ? " + AI report" : ""}` : undefined} right={<Tag kind="engine" />} />
        <LevelLadder levels={levels} price={nv.price} dense />
      </Panel>

      {/* ── Outlook + brief ──────────────────────────────── */}
      <div className="order-4 lg:order-none lg:col-span-2">
        <Outlook bias={bias} />
      </div>
      <div className="order-9 lg:order-none">
        <Brief snap={sched} />
      </div>

      {/* ── Setups ───────────────────────────────────────── */}
      <section className="order-4 lg:order-none lg:col-span-3">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="title">Trade setups</h2>
            <p className="text-xs text-dim">{ai ? `From the AI pre-market report · ${timeIST(ai.generated_at)} ${dayIST(ai.generated_at)}` : "No AI report yet"}</p>
          </div>
          <Link href="/setups" className="text-sm text-accent hover:underline">
            All setups ›
          </Link>
        </div>
        {setups.length && ai ? (
          <div className="rail -mx-4 gap-3 px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 lg:grid-cols-3">
            {setups.map((o) => (
              <div key={o.symbol + o.side} className="w-[88vw] max-w-[400px] sm:w-auto sm:max-w-none">
                <SetupCard op={o} snap={ai} candidate={ai.data.candidates?.[o.symbol]} />
              </div>
            ))}
          </div>
        ) : (
          <Panel>
            <Empty title={ai && (ai.analysis as { no_trade?: boolean })?.no_trade ? "The engine called no trade" : "No setups published"} className="pt-5">
              {ai && (ai.analysis as { no_trade_reason?: string })?.no_trade_reason
                ? (ai.analysis as { no_trade_reason?: string }).no_trade_reason
                : "Setups appear when the engine's AI pre-market report lists call or put opportunities."}
            </Empty>
          </Panel>
        )}
      </section>

      {/* ── Options / news / events ──────────────────────── */}
      <Panel className="order-6 lg:order-none">
        <PanelHead title="Nifty options" href="/options" sub={chain ? `PCR ${num(chain.value.pcr)} · max pain ${num(chain.value.max_pain, 0)} · ${chain.value.expiry}` : undefined} right={<Tag kind="raw">NSE via engine</Tag>} />
        <div className="px-4 pb-4 sm:px-5">{chain ? <OiProfile c={chain.value} width={7} /> : <p className="text-sm text-dim">No option chain yet.</p>}</div>
      </Panel>
      <Panel className="order-7 lg:order-none">
        <PanelHead title="News" href="/news" right={news ? <Fresh at={news.snap.generated_at} label="Fetched" seconds={false} staleAfterMin={600} /> : null} />
        <NewsList items={news?.value ?? []} limit={5} />
      </Panel>
      <Panel className="order-10 lg:order-none">
        <PanelHead title="Coming up" href="/news#events" right={<Tag kind="raw">NSE via engine</Tag>} />
        <EventsList events={events} limit={6} />
      </Panel>

      {/* ── Global / sectors / flows ─────────────────────── */}
      <Panel className="order-8 lg:order-none">
        <PanelHead title="Global" href="/global" right={<Tag kind="raw">Yahoo Finance</Tag>} />
        <div className={clsx("divide-y divide-line pb-2")}>
          {GLOBAL.filter((g) => ["SPX", "NASDAQ", "NIKKEI", "BRENT", "GOLD", "USDINR"].includes(g.key)).map((g) => (
            <QuoteRow key={g.key} inst={g} q={glob.map.get(g.key)} href={`/markets/${g.key}`} />
          ))}
        </div>
      </Panel>
      <Panel className="order-11 lg:order-none">
        <PanelHead title="Sectors" href="/sectors" right={sectors ? <Fresh at={sectors.snap.generated_at} label="" seconds={false} staleAfterMin={600} /> : null} />
        <SectorHeatmap sectors={(sectors?.value ?? []).slice(0, 8)} momentum={state.latest.evening?.data.sector_momentum} cols={2} />
      </Panel>
      <Panel className="order-12 lg:order-none">
        <PanelHead title="FII / DII" href="/markets#flows" right={<Tag kind="raw">NSE via engine</Tag>} />
        <FiiDiiCard f={fii?.value} history={state.metrics} />
      </Panel>
    </div>
  );
}
