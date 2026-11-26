"use client";
import Link from "next/link";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuotes, useWatchlist } from "@/lib/client";
import { SCHEDULED, engineLevels, isAi, latestWith, opportunities } from "@/lib/derive";
import { dayIST, num, timeIST } from "@/lib/format";
import { GLOBAL, GROUP_LABEL, INDIA, resolveInstrument } from "@/lib/instruments";
import { STATUS_ORDER } from "@/lib/track";
import type { AiPremarketAnalysis } from "@/lib/types";
import { useTerminalState } from "../shell/context";
import { Breadth, MoversList, SectorHeatmap } from "../market/breadth";
import { buildEvents, EventsList, FilterPill, MacroNote, NewsList } from "../market/feeds";
import { indexValue } from "../market/indices";
import { QuoteRow } from "../market/quotes";
import { SetupCard, type Setup, StatusChip, useTracking } from "../market/setups";
import { Chip, Delta, Empty, Fresh, Live, PageHeader, Panel, PanelHead, Sparkline, Tag, clsx } from "../ui";

/* ── News & events ───────────────────────────────────────────────────────── */

export function NewsView() {
  const state = useTerminalState();
  const news = latestWith(state, (s) => s.data.news);
  const events = buildEvents([state.latest.evening, state.latest.premarket, state.latest.afternoon]);
  return (
    <>
      <PageHeader kicker="News & events" title="What's moving">
        Headlines exactly as the engine collected them — not rewritten or re-scored.
      </PageHeader>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-5">
        <Panel>
          <PanelHead
            title="Headlines"
            sub={news ? `Collected with the ${dayIST(news.snap.generated_at)} ${timeIST(news.snap.generated_at)} report` : undefined}
            right={<Tag kind="raw">RSS via engine</Tag>}
          />
          <NewsList items={news?.value ?? []} filterable />
          <p className="border-t border-line px-4 py-3 text-2xs text-dim sm:px-5">
            The engine keeps title, source, time and link. Category, sentiment, impact and related instruments aren&apos;t in its output, so they aren&apos;t shown.
          </p>
        </Panel>
        <div className="flex flex-col gap-4 lg:gap-5">
          <Panel id="events">
            <PanelHead title="Calendar" right={<Tag kind="raw">NSE via engine</Tag>} />
            <EventsList events={events} />
          </Panel>
          <Panel>
            <PanelHead title="Macro releases" />
            <MacroNote />
          </Panel>
        </div>
      </div>
    </>
  );
}

/* ── Global ──────────────────────────────────────────────────────────────── */

export function GlobalView() {
  const state = useTerminalState();
  const { map, fetchedAt } = useQuotes({ group: "all" });
  const gift = latestWith(state, (s) => s.data.gift_nifty);
  const groups = ["us", "asia", "commodities", "currencies"] as const;
  return (
    <>
      <PageHeader kicker="Global" title="Global markets" right={<Fresh at={fetchedAt} label="Prices" />}>
        Raw prices from Yahoo Finance; GIFT Nifty as captured by your engine from NSE.
      </PageHeader>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-5">
        <Panel>
          <PanelHead title="India" right={<Tag kind="raw" />} />
          <div className="divide-y divide-line pb-2">
            <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium">GIFT Nifty</p>
                <p className="text-2xs text-dim">{gift ? `NSE IX via engine · as of ${gift.value.as_of ?? timeIST(gift.snap.generated_at)}` : "Not in the latest snapshots"}</p>
              </div>
              <div className="w-[116px] text-right">
                <span className="num block text-[15px] font-medium">{num(gift?.value.last)}</span>
                <Delta pctValue={gift?.value.change_pct ?? null} showAbs={false} className="text-xs" />
              </div>
            </div>
            {INDIA.filter((i) => i.key !== "INDIAVIX").map((i) => (
              <QuoteRow key={i.key} inst={i} q={map.get(i.key)} href={`/markets/${i.key}`} />
            ))}
          </div>
        </Panel>
        {groups.map((g) => (
          <Panel key={g}>
            <PanelHead title={GROUP_LABEL[g]} right={<Tag kind="raw" />} />
            <div className="divide-y divide-line pb-2">
              {GLOBAL.filter((i) => i.group === g).map((i) => (
                <QuoteRow key={i.key} inst={i} q={map.get(i.key)} href={`/markets/${i.key}`} />
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}

/* ── Sectors ─────────────────────────────────────────────────────────────── */

export function SectorsView() {
  const state = useTerminalState();
  const sectors = latestWith(state, (s) => s.data.sectors, SCHEDULED);
  const mom = latestWith(state, (s) => s.data.sector_momentum);
  const movers = latestWith(state, (s) => s.data.movers, SCHEDULED);
  const ai = isAi(state.latest.ai_premarket) ? (state.latest.ai_premarket.analysis as AiPremarketAnalysis) : null;
  return (
    <>
      <PageHeader kicker="Sectors" title="Sector strength" right={sectors ? <Fresh at={sectors.snap.generated_at} label="Captured" seconds={false} staleAfterMin={600} /> : null}>
        NSE sector indices from the engine. &ldquo;Building&rdquo; / &ldquo;fading&rdquo; is the engine&apos;s own up-today-and-this-week split.
      </PageHeader>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <Panel className="lg:col-span-2">
          <PanelHead title="Heatmap" right={<Tag kind="raw">NSE via engine</Tag>} />
          <SectorHeatmap sectors={sectors?.value ?? []} momentum={mom?.value} aiBull={ai?.sector_outlook?.bullish_sectors} aiBear={ai?.sector_outlook?.bearish_sectors} />
        </Panel>
        <div className="flex flex-col gap-4 lg:gap-5">
          {mom ? (
            <Panel>
              <PanelHead title="Engine momentum" right={<Tag kind="engine">evening wrap</Tag>} />
              <div className="space-y-3 px-4 pb-5 sm:px-5">
                <div>
                  <p className="mb-1.5 text-xs text-up">Gaining strength</p>
                  <div className="flex flex-wrap gap-1.5">{mom.value.building.length ? mom.value.building.map((s) => <Chip key={s.sector} tone="up">{s.sector}</Chip>) : <span className="text-sm text-dim">None</span>}</div>
                </div>
                <div>
                  <p className="mb-1.5 text-xs text-down">Losing strength</p>
                  <div className="flex flex-wrap gap-1.5">{mom.value.fading.length ? mom.value.fading.map((s) => <Chip key={s.sector} tone="down">{s.sector}</Chip>) : <span className="text-sm text-dim">None</span>}</div>
                </div>
              </div>
            </Panel>
          ) : null}
          {ai?.sector_outlook ? (
            <Panel>
              <PanelHead title="AI sector outlook" right={<Tag kind="engine" />} />
              <p className="px-4 pb-5 text-sm text-ink-2 sm:px-5">{ai.sector_outlook.comment}</p>
            </Panel>
          ) : null}
          <Panel>
            <PanelHead title="Breadth" right={<Tag kind="raw" />} />
            <Breadth snaps={[state.latest.afternoon, state.latest.premarket, state.latest.evening, state.latest.ai_premarket]} />
          </Panel>
          {movers?.value.NIFTY ? (
            <Panel>
              <PanelHead title="Top movers" right={<Tag kind="raw" />} />
              <MoversList movers={movers.value.NIFTY} title="Nifty 50" />
              {movers.value.BANKNIFTY ? <MoversList movers={movers.value.BANKNIFTY} title="Bank Nifty" /> : null}
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}

/* ── Setups ──────────────────────────────────────────────────────────────── */

type StatusFilter = "all" | (typeof STATUS_ORDER)[number];

export function SetupsView() {
  const state = useTerminalState();
  const ai = state.latest.ai_premarket;
  const setups = opportunities(ai);
  const [side, setSide] = useState<"all" | "CALL" | "PUT">("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  return (
    <>
      <PageHeader kicker="Trade setups" title="Today's setups">
        {ai ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <Tag kind="engine">AI pre-market report</Tag> {timeIST(ai.generated_at)} {dayIST(ai.generated_at)}
            {(ai.analysis as AiPremarketAnalysis).strategy_name ? <span className="text-dim">· {(ai.analysis as AiPremarketAnalysis).strategy_name}</span> : null}
          </span>
        ) : (
          "Setups come from the engine's AI pre-market report."
        )}
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="rail gap-1.5">
          {(["all", "CALL", "PUT"] as const).map((s) => (
            <FilterPill key={s} active={side === s} onClick={() => setSide(s)}>
              {s === "all" ? "Calls & puts" : s === "CALL" ? "Calls" : "Puts"}
            </FilterPill>
          ))}
        </div>
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <div className="rail gap-1.5">
          {(["all", ...STATUS_ORDER] as StatusFilter[]).map((s) => (
            <FilterPill key={s} active={status === s} onClick={() => setStatus(s)}>
              {s === "all" ? "Any status" : s.charAt(0) + s.slice(1).toLowerCase()}
            </FilterPill>
          ))}
        </div>
      </div>
      {ai && setups.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {setups
            .filter((o) => side === "all" || o.side === side)
            .map((o) => (
              <FilteredSetup key={o.symbol + o.side} op={o} status={status} />
            ))}
        </div>
      ) : (
        <Panel>
          <Empty title={ai && (ai.analysis as AiPremarketAnalysis).no_trade ? "The engine called no trade today" : "No setups published"} className="pt-5">
            {(ai?.analysis as AiPremarketAnalysis | undefined)?.no_trade_reason ||
              "The AI pre-market report lists call and put opportunities scoring 85+; none are available right now."}
          </Empty>
        </Panel>
      )}
      <p className="mt-4 text-xs text-dim">
        Status is a mechanical replay of today&apos;s 5-minute prices against the engine&apos;s own entry, stop and targets: Watch = entry not traded · Triggered = entry just
        traded · Active = running · Completed = Target 2 hit · Invalidated = stop hit. The website never creates or changes a setup.
      </p>
    </>
  );
}

function FilteredSetup({ op, status }: { op: Setup; status: StatusFilter }) {
  const state = useTerminalState();
  const ai = state.latest.ai_premarket!;
  const t = useTracking(op, ai);
  if (status !== "all" && t.status !== status) return null;
  return <SetupCard op={op} snap={ai} candidate={ai.data.candidates?.[op.symbol]} />;
}

/* ── Watchlist ───────────────────────────────────────────────────────────── */

export function WatchlistView() {
  const state = useTerminalState();
  const { keys, add, remove, move } = useWatchlist();
  const [input, setInput] = useState("");
  const { map, fetchedAt } = useQuotes({ keys });
  const ai = state.latest.ai_premarket;
  const setups = opportunities(ai);
  const niftyLv = useMemo(() => engineLevels(state, "NIFTY"), [state]);
  const bankLv = useMemo(() => engineLevels(state, "BANKNIFTY"), [state]);
  const submit = () => {
    const k = input.trim().toUpperCase().replace(/[^A-Z0-9&_^=.-]/g, "");
    if (k) add(resolveInstrument(k).key);
    setInput("");
  };
  return (
    <>
      <PageHeader kicker="Watchlist" title="Your watchlist" right={<Fresh at={fetchedAt} label="Prices" />}>
        Saved in this browser. Signals and levels appear only where your engine published them.
      </PageHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="mb-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Add a symbol — RELIANCE, BANKNIFTY, GOLD…"
          className="h-11 flex-1 rounded-full border border-line bg-card px-4 text-[15px] outline-none placeholder:text-faint focus:border-line-strong"
        />
        <button className="press h-11 rounded-full bg-ink px-5 text-sm font-medium text-bg">Add</button>
      </form>
      <Panel>
        {keys.length ? (
          <ul className="divide-y divide-line">
            {keys.map((k, i) => (
              <WatchRow
                key={k}
                k={k}
                state={state}
                quote={map.get(k)}
                setup={setups.find((s) => s.symbol === k)}
                level={k === "NIFTY" ? niftyLv : k === "BANKNIFTY" ? bankLv : []}
                onRemove={() => remove(k)}
                onUp={i ? () => move(k, -1) : undefined}
                onDown={i < keys.length - 1 ? () => move(k, 1) : undefined}
              />
            ))}
          </ul>
        ) : (
          <Empty title="Your watchlist is empty" className="pt-5">
            Add symbols above.
          </Empty>
        )}
      </Panel>
    </>
  );
}

function WatchRow({
  k,
  state,
  quote,
  setup,
  level,
  onRemove,
  onUp,
  onDown,
}: {
  k: string;
  state: ReturnType<typeof useTerminalState>;
  quote: ReturnType<typeof useQuotes>["quotes"][number] | undefined;
  setup?: Setup;
  level: ReturnType<typeof engineLevels>;
  onRemove: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const inst = resolveInstrument(k);
  const v = indexValue(inst, quote, state);
  const price = v.price;
  const above = price !== null ? level.filter((l) => l.price > price && (l.kind === "resistance")).at(-1) : undefined;
  const below = price !== null ? level.find((l) => l.price < price && l.kind === "support") : undefined;
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <div className="hidden flex-col sm:flex">
        <button onClick={onUp} disabled={!onUp} className="text-dim hover:text-ink disabled:opacity-20" aria-label="Move up">
          <ArrowUp className="size-3.5" />
        </button>
        <button onClick={onDown} disabled={!onDown} className="text-dim hover:text-ink disabled:opacity-20" aria-label="Move down">
          <ArrowDown className="size-3.5" />
        </button>
      </div>
      <Link href={`/markets/${inst.key}`} className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[15px] font-medium">
          {inst.name}
          {setup ? <WatchSetupChip op={setup} /> : null}
        </p>
        <p className="mt-0.5 truncate text-2xs text-dim">
          {above || below ? (
            <>
              {below ? <span className="text-up">S {num(below.price, 0)}</span> : null}
              {below && above ? " · " : ""}
              {above ? <span className="text-down">R {num(above.price, 0)}</span> : null} <span>(engine)</span>
            </>
          ) : setup ? (
            <>
              Entry {setup.entry_zone} · SL {num(setup.stop_loss)} <span>(engine)</span>
            </>
          ) : (
            <span>No engine level</span>
          )}
        </p>
      </Link>
      <Sparkline data={v.spark} base={v.prevClose} width={72} height={28} className="hidden sm:block" />
      <div className="w-[104px] text-right">
        <Live value={price} className="num block text-[15px] font-medium">
          {num(price, inst.decimals ?? 2)}
        </Live>
        <Delta pctValue={v.change_pct} showAbs={false} className="text-xs" />
      </div>
      <button onClick={onRemove} className="press rounded-full p-1.5 text-dim hover:bg-hover hover:text-ink" aria-label={`Remove ${inst.name}`}>
        <X className="size-4" />
      </button>
    </li>
  );
}

function WatchSetupChip({ op }: { op: Setup }) {
  const state = useTerminalState();
  const t = useTracking(op, state.latest.ai_premarket!);
  return <StatusChip t={t} />;
}

export { clsx };
