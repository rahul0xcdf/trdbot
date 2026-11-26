"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuotes } from "@/lib/client";
import { INDEX_LABEL, SCHEDULED, activePlan, latestScheduled, latestWith, planLevels, setupsOf } from "@/lib/derive";
import { dayIST, isoDateIST, num, timeIST } from "@/lib/format";
import { GLOBAL, INDIA, resolveInstrument } from "@/lib/instruments";
import type { IndexKey } from "@/lib/types";
import { INDEX_KEYS } from "@/lib/types";
import { useTerminalState } from "../shell/context";
import { ActionChip, AiNotes, DecisionCard, SessionTimeline } from "../market/engine";
import { buildEvents, EventsList, NewsList } from "../market/feeds";
import { FiiDiiCard, SectorHeatmap } from "../market/breadth";
import { IndexCard, indexValue } from "../market/indices";
import { LevelLadder } from "../market/levels";
import { OiProfile, chainView } from "../market/options";
import { PriceChart } from "../market/PriceChart";
import { QuoteRow } from "../market/quotes";
import { IndexRead } from "../market/read";
import { NoTradeBand, SetupCard } from "../market/setups";
import { BiasChip, Delta, Empty, Fresh, Live, Panel, PanelHead, Segmented, Tag, clsx } from "../ui";

const AI_KEYS: Record<string, string[]> = {
  premarket: ["global_read", "nifty_read", "banknifty_read", "beginner_tip"],
  midday: ["what_is_happening", "after_12"],
  evening: ["nifty_story", "banknifty_story", "tomorrow"],
};

export function TodayView() {
  const state = useTerminalState();
  const now = new Date(state.server_time);
  const india = useQuotes({ group: "india" });
  const glob = useQuotes({ keys: ["SPX", "NASDAQ", "NIKKEI", "BRENT", "GOLD", "USDINR"] });
  const [key, setKey] = useState<IndexKey>("NIFTY");
  const inst = resolveInstrument(key);
  const v = indexValue(inst, india.map.get(key), state);
  const ap = activePlan(state, now);
  const snap = ap?.snap ?? null;
  const latest = latestScheduled(state);
  const levels = useMemo(() => planLevels(snap?.indices?.[key]?.plan), [snap, key]);
  const items = setupsOf(snap).sort((a, b) => Number(b.best) - Number(a.best) || Number(b.usable) - Number(a.usable));
  const chain = latestWith(state, (s) => (s.indices?.[key]?.chain?.strikes?.length ? s.indices[key]!.chain : null));
  const news = latestWith(state, (s) => s.data?.news);
  const sectors = latestWith(state, (s) => s.data?.sectors, SCHEDULED);
  const fii = latestWith(state, (s) => s.data?.fii_dii, SCHEDULED);
  const gift = state.latest.premarket?.plan_for === isoDateIST(now) ? state.latest.premarket.data?.gift_nifty : null;
  const events = buildEvents([state.latest.monthly, state.latest.evening, state.latest.premarket]);
  const wrapToday = state.latest.evening && isoDateIST(state.latest.evening.generated_at) === isoDateIST(now) ? state.latest.evening : null;
  const readSnap = latest && isoDateIST(latest.generated_at) === isoDateIST(now) ? latest : null;
  const d = snap?.decision;

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-3 lg:gap-5">
      {/* ── Status ───────────────────────────────────────── */}
      <section className="order-1 lg:order-none lg:col-span-3">
        <p className="eyebrow mb-2">Today · {dayIST(state.server_time)}</p>
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-1 gap-5 p-5 sm:p-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                <Segmented size="xs" value={key} onChange={setKey} options={INDEX_KEYS.map((k) => ({ value: k, label: INDEX_LABEL[k] }))} />
                <Tag kind="raw">{v.source}</Tag>
              </div>
              <Live value={v.price} className="num mt-2 block text-[44px] leading-[1.05] font-semibold tracking-[-0.04em] sm:text-[56px]">
                {num(v.price)}
              </Live>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
                <Delta value={v.change} pctValue={v.change_pct} />
                {gift ? (
                  <span className="text-xs text-dim">
                    GIFT Nifty <span className="num text-ink-2">{num(gift.last)}</span> <Delta pctValue={gift.change_pct} showAbs={false} className="text-xs" /> ·{" "}
                    {gift.as_of?.slice(-5)}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col justify-between gap-4 rounded-2xl border border-line bg-card-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {d ? (
                  <>
                    <ActionChip action={d.action} size="lg" />
                    <BiasChip bias={d.market_bias} />
                    <span className="text-xs text-dim">
                      confidence <span className="text-ink-2">{d.confidence}</span>
                    </span>
                  </>
                ) : (
                  <BiasChip bias={null} size="lg" />
                )}
              </div>
              {d ? (
                <p className="text-sm text-ink-2">
                  {d.best?.name ? (
                    <>
                      <span className="text-dim">Best setup: </span>
                      {d.best.name}
                      {snap?.session !== "midday" ? " — only after confirmation" : ""}
                    </>
                  ) : (
                    d.reason ?? "No setup passes every filter."
                  )}
                </p>
              ) : null}
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-dim">Analysis updated</dt>
                  <dd className="num mt-0.5 text-[15px] text-ink">{latest ? timeIST(latest.generated_at) : "—"}</dd>
                  <dd className="mt-0.5">
                    <Tag kind="engine">{latest ? dayIST(latest.generated_at) : "none yet"}</Tag>
                  </dd>
                </div>
                <div>
                  <dt className="text-dim">Data updated</dt>
                  <dd className="num mt-0.5 text-[15px] text-ink" suppressHydrationWarning>
                    {v.time ? timeIST(v.time, true) : "—"}
                  </dd>
                  <dd className="mt-0.5">
                    <Tag kind="raw">{v.viaEngine ? "engine capture" : "live feed"}</Tag>
                  </dd>
                </div>
              </dl>
              {!snap ? <p className="text-2xs text-dim">No plan yet — the engine publishes at 8:45 AM, 11:45 AM and 6:00 PM IST.</p> : null}
              {ap && !ap.isToday ? <p className="text-2xs text-dim">Showing the plan for {dayIST(ap.day + "T12:00:00+05:30")} (set at 6:00 PM).</p> : null}
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
        <PanelHead title={inst.name} href="/charts" sub="Candles from the live feed, levels from your engine's plan" />
        <PriceChart key={key} instrumentKey={key} levels={levels} height={360} />
      </Panel>
      <Panel className="order-4 lg:order-none lg:self-start">
        <PanelHead
          title="Plan levels"
          sub={snap ? `${INDEX_LABEL[key]} · ${timeIST(snap.generated_at)} ${dayIST(snap.generated_at)}` : undefined}
          right={<Tag kind="engine" />}
        />
        <LevelLadder levels={levels} price={v.price} dense maxHeight={392} source={snap ? { id: snap.id, session: snap.session, time: snap.generated_at } : null} />
      </Panel>

      {/* ── Decision ─────────────────────────────────────── */}
      <div className="order-3 lg:order-none lg:col-span-2">
        <DecisionCard snap={snap} planDay={ap} />
      </div>
      <div className="order-9 lg:order-none">
        {readSnap ? (
          <AiNotes snap={readSnap} keys={AI_KEYS[readSnap.session]} />
        ) : snap ? (
          <AiNotes snap={snap} keys={AI_KEYS[snap.session]} />
        ) : (
          <Panel>
            <PanelHead title="In plain words" right={<Tag kind="engine" />} />
            <Empty title="No narration yet">Gemini&apos;s plain-words read arrives with each report.</Empty>
          </Panel>
        )}
      </div>

      {/* ── Setups ───────────────────────────────────────── */}
      <section className="order-4 lg:order-none lg:col-span-3">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="title">{ap && !ap.isToday ? "Tomorrow's scenarios" : "Scenarios"}</h2>
            <p className="text-xs text-dim">
              {snap ? `${snap.session === "midday" ? "11:45 AM re-plan" : snap.session === "evening" ? "6:00 PM plan" : "8:45 AM plan"} · ${timeIST(snap.generated_at)} ${dayIST(snap.generated_at)}` : "No plan yet"}
            </p>
          </div>
          <Link href="/setups" className="text-sm text-accent hover:underline">
            Full plan ›
          </Link>
        </div>
        {items.length ? (
          <div className="rail -mx-4 gap-3 px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:px-0 lg:grid-cols-4">
            {items.map((it) => (
              <div key={`${it.key}-${it.side}`} className="w-[88vw] max-w-[400px] sm:w-auto sm:max-w-none">
                <SetupCard item={it} />
              </div>
            ))}
          </div>
        ) : (
          <Panel>
            <Empty title="No scenarios published" className="pt-5">
              Scenario A (bullish), B (bearish) and C (no-trade band) for NIFTY 50 and BANK NIFTY arrive with the 8:45 AM report.
            </Empty>
          </Panel>
        )}
        {snap ? (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {INDEX_KEYS.map((k) => {
              const plan = snap.indices?.[k]?.plan;
              return plan ? <NoTradeBand key={k} snap={snap} plan={plan} label={INDEX_LABEL[k]} /> : null;
            })}
          </div>
        ) : null}
      </section>

      {/* ── The engine's read of the latest session ─────── */}
      {readSnap && readSnap.indices && Object.keys(readSnap.indices).length ? (
        <Panel className="order-6 lg:order-none lg:col-span-3">
          <PanelHead
            title={readSnap.session === "midday" ? "What the morning did" : readSnap.session === "evening" ? "Today's price action" : "Yesterday's price action"}
            right={<Tag kind="engine">{timeIST(readSnap.generated_at)} report</Tag>}
          />
          <div className="grid grid-cols-1 gap-6 px-4 pb-5 sm:px-5 lg:grid-cols-2">
            {INDEX_KEYS.map((k) => (readSnap.indices[k] ? <IndexRead key={k} snap={readSnap} ix={readSnap.indices[k]!} /> : null))}
          </div>
          {wrapToday?.indices?.NIFTY?.eod?.lesson ? (
            <div className="border-t border-line px-4 py-3.5 sm:px-5">
              <p className="eyebrow mb-1">Trading lesson · {wrapToday.indices.NIFTY.eod.lesson.title}</p>
              <p className="text-sm text-ink-2">{wrapToday.ai?.lesson ?? wrapToday.indices.NIFTY.eod.lesson.text}</p>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {/* ── Options / news / events ──────────────────────── */}
      <Panel className="order-7 lg:order-none">
        <PanelHead
          title={`${INDEX_LABEL[key]} options`}
          href="/options"
          sub={chain?.value.summary ? `PCR ${num(chain.value.summary.pcr)} · max pain ${num(chain.value.summary.max_pain, 0)}` : undefined}
          right={<Tag kind="raw">NSE via engine</Tag>}
        />
        <div className="px-4 pb-4 sm:px-5">{chainView(chain?.value) ? <OiProfile c={chainView(chain?.value)!} width={7} /> : <p className="text-sm text-dim">No option chain yet.</p>}</div>
      </Panel>
      <Panel className="order-8 lg:order-none">
        <PanelHead title="News" href="/news" right={news ? <Fresh at={news.snap.generated_at} label="Fetched" seconds={false} staleAfterMin={600} /> : null} />
        <NewsList items={news?.value ?? []} limit={5} />
      </Panel>
      <Panel className="order-10 lg:order-none">
        <PanelHead title="Coming up" href="/calendar" right={<Tag kind="engine">calendar</Tag>} />
        <EventsList events={events} limit={6} />
      </Panel>

      {/* ── Global / sectors / flows ─────────────────────── */}
      <Panel className="order-11 lg:order-none">
        <PanelHead title="Global" href="/global" right={<Tag kind="raw">Yahoo Finance</Tag>} />
        <div className={clsx("divide-y divide-line pb-2")}>
          {GLOBAL.filter((g) => ["SPX", "NASDAQ", "NIKKEI", "BRENT", "GOLD", "USDINR"].includes(g.key)).map((g) => (
            <QuoteRow key={g.key} inst={g} q={glob.map.get(g.key)} href={`/markets/${g.key}`} />
          ))}
        </div>
      </Panel>
      <Panel className="order-12 lg:order-none">
        <PanelHead title="Sectors" href="/sectors" right={sectors ? <Fresh at={sectors.snap.generated_at} label="" seconds={false} staleAfterMin={600} /> : null} />
        <SectorHeatmap sectors={(sectors?.value ?? []).slice(0, 8)} momentum={state.latest.evening?.data?.sector_momentum ?? undefined} cols={2} />
      </Panel>
      <Panel className="order-13 lg:order-none">
        <PanelHead title="FII / DII" href="/markets#flows" right={<Tag kind="raw">NSE via engine</Tag>} />
        <FiiDiiCard f={fii?.value ?? undefined} history={state.metrics} />
      </Panel>
    </div>
  );
}
