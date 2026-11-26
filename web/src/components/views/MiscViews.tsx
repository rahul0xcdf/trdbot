"use client";
import Link from "next/link";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuotes, useWatchlist } from "@/lib/client";
import { INDEX_LABEL, SCHEDULED, type SetupItem, activePlan, latestWith, planLevels, setupsOf } from "@/lib/derive";
import { dayIST, num, pct, timeIST } from "@/lib/format";
import { GLOBAL, GROUP_LABEL, INDIA, resolveInstrument } from "@/lib/instruments";
import { STATUS_ORDER } from "@/lib/track";
import type { IndexKey } from "@/lib/types";
import { INDEX_KEYS } from "@/lib/types";
import { useTerminalState } from "../shell/context";
import { Breadth, MoversList, SectorHeatmap } from "../market/breadth";
import { AnalysisStamp, DecisionCard } from "../market/engine";
import { buildEvents, EventsList, FilterPill, MacroCalendar, NewsList } from "../market/feeds";
import { indexValue } from "../market/indices";
import { QuoteRow } from "../market/quotes";
import { NoTradeBand, SetupCard, StatusChip, useTracking } from "../market/setups";
import { Chip, Delta, Empty, Fresh, Live, PageHeader, Panel, PanelHead, Sparkline, Tag, clsx } from "../ui";

/* ── News & events ───────────────────────────────────────────────────────── */

export function NewsView() {
  const state = useTerminalState();
  const news = latestWith(state, (s) => s.data?.news);
  const events = buildEvents([state.latest.monthly, state.latest.evening, state.latest.premarket]);
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
            The engine keeps title, source, time and link. Category, sentiment and impact aren&apos;t in its output, so they aren&apos;t shown.
          </p>
        </Panel>
        <Panel id="events">
          <PanelHead title="Coming up" href="/calendar" right={<Tag kind="engine">calendar</Tag>} />
          <EventsList events={events} limit={14} />
        </Panel>
      </div>
    </>
  );
}

/* ── Macro / volatility calendar ─────────────────────────────────────────── */

export function CalendarView() {
  const state = useTerminalState();
  const m = state.latest.monthly;
  const upcoming = buildEvents([state.latest.evening]);
  const month = m?.data?.month ? new Date(m.data.month + "-01T12:00:00+05:30").toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }) : null;
  return (
    <>
      <PageHeader kicker="Calendar" title={month ? `${month} event calendar` : "Event calendar"} right={m ? <AnalysisStamp snap={m} prefix="Monthly calendar" /> : null}>
        The engine&apos;s volatility calendar — RBI, Fed, US &amp; India data, expiries, results and holidays, rated HIGH / MEDIUM / LOW impact.
      </PageHeader>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-5">
        <Panel>
          <PanelHead title="This month" right={<Tag kind="engine" />} />
          {m?.ai?.month_note ? <p className="px-4 pb-3 text-sm text-ink-2 sm:px-5">{m.ai.month_note}</p> : null}
          <MacroCalendar events={m?.data?.calendar ?? []} />
        </Panel>
        <Panel>
          <PanelHead title="Next 7 days (NSE)" sub="From the 6 PM wrap" right={<Tag kind="raw">NSE via engine</Tag>} />
          <EventsList events={upcoming} />
        </Panel>
      </div>
    </>
  );
}

/* ── Global ──────────────────────────────────────────────────────────────── */

export function GlobalView() {
  const state = useTerminalState();
  const { map, fetchedAt } = useQuotes({ group: "all" });
  const gift = latestWith(state, (s) => s.data?.gift_nifty);
  const cues = latestWith(state, (s) => s.data?.global);
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
        {cues ? (
          <Panel>
            <PanelHead title="As the engine saw it" sub={`${SESSION_NOTE(cues.snap.session)} · ${timeIST(cues.snap.generated_at)} ${dayIST(cues.snap.generated_at)}`} right={<Tag kind="raw">Yahoo via engine</Tag>} />
            <ul className="divide-y divide-line pb-2">
              {cues.value.map((c) => (
                <li key={c.symbol} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">{c.label}</span>
                    <span className="text-2xs text-dim">{c.group}{c.as_of ? ` · as of ${c.as_of}` : ""}</span>
                  </span>
                  <span className="text-right">
                    <span className="num block text-sm text-ink">{num(c.last)}</span>
                    <Delta pctValue={c.change_pct} showAbs={false} className="text-xs" />
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
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
  const sectors = latestWith(state, (s) => s.data?.sectors, SCHEDULED);
  const mom = latestWith(state, (s) => s.data?.sector_momentum);
  const movers = latestWith(state, (s) => s.data?.movers, SCHEDULED);
  return (
    <>
      <PageHeader kicker="Sectors" title="Sector strength" right={sectors ? <Fresh at={sectors.snap.generated_at} label="Captured" seconds={false} staleAfterMin={600} /> : null}>
        NSE sector indices from the engine. &ldquo;Gaining&rdquo; / &ldquo;losing strength&rdquo; is the engine&apos;s own up-today-and-this-week split.
      </PageHeader>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        <Panel className="lg:col-span-2">
          <PanelHead title="Heatmap" right={<Tag kind="raw">NSE via engine</Tag>} />
          <SectorHeatmap sectors={sectors?.value ?? []} momentum={mom?.value ?? undefined} />
        </Panel>
        <div className="flex flex-col gap-4 lg:gap-5">
          {mom ? (
            <Panel>
              <PanelHead title="Engine momentum" right={<Tag kind="engine">evening wrap</Tag>} />
              <div className="space-y-3 px-4 pb-5 sm:px-5">
                <div>
                  <p className="mb-1.5 text-xs text-up">Gaining strength (up today &amp; this week)</p>
                  <div className="flex flex-wrap gap-1.5">{mom.value.building.length ? mom.value.building.map((s) => <Chip key={s.sector} tone="up">{s.sector}</Chip>) : <span className="text-sm text-dim">None</span>}</div>
                </div>
                <div>
                  <p className="mb-1.5 text-xs text-down">Losing strength (down today &amp; this week)</p>
                  <div className="flex flex-wrap gap-1.5">{mom.value.fading.length ? mom.value.fading.map((s) => <Chip key={s.sector} tone="down">{s.sector}</Chip>) : <span className="text-sm text-dim">None</span>}</div>
                </div>
              </div>
            </Panel>
          ) : null}
          <Panel>
            <PanelHead title="Breadth" right={<Tag kind="raw" />} />
            <Breadth snaps={[state.latest.midday, state.latest.premarket, state.latest.evening]} />
          </Panel>
          {movers?.value.NIFTY ? (
            <Panel>
              <PanelHead title="Top movers" sub={`${dayIST(movers.snap.generated_at)} close`} right={<Tag kind="raw" />} />
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

function SESSION_NOTE(session: string) {
  return session === "premarket" ? "8:45 AM pre-market" : session === "midday" ? "11:45 AM midday" : session === "evening" ? "6:00 PM wrap" : session;
}

export function SetupsView() {
  const state = useTerminalState();
  const ap = activePlan(state, new Date(state.server_time));
  const items = setupsOf(ap?.snap);
  const [idx, setIdx] = useState<"all" | IndexKey>("all");
  const [valid, setValid] = useState<"all" | "valid" | "no">("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const shown = items.filter((i) => (idx === "all" || i.key === idx) && (valid === "all" || (valid === "valid" ? i.usable : !i.usable)));
  return (
    <>
      <PageHeader kicker="Trade setups" title={ap ? (ap.isToday ? "Today's plan" : `Plan for ${dayIST(ap.day + "T12:00:00+05:30")}`) : "Trade setups"}>
        {ap ? <AnalysisStamp snap={ap.snap} /> : "Setups come from the engine's 8:45 AM, 11:45 AM and 6:00 PM reports."}
      </PageHeader>
      <div className="mb-4">
        <DecisionCard snap={ap?.snap ?? null} planDay={ap} compact />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="rail gap-1.5">
          {(["all", ...INDEX_KEYS] as const).map((s) => (
            <FilterPill key={s} active={idx === s} onClick={() => setIdx(s)}>
              {s === "all" ? "Both indices" : INDEX_LABEL[s]}
            </FilterPill>
          ))}
        </div>
        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
        <div className="rail gap-1.5">
          {(["all", "valid", "no"] as const).map((s) => (
            <FilterPill key={s} active={valid === s} onClick={() => setValid(s)}>
              {s === "all" ? "All scenarios" : s === "valid" ? "Valid" : "No trade"}
            </FilterPill>
          ))}
        </div>
        {ap?.isToday ? (
          <>
            <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
            <div className="rail gap-1.5">
              {(["all", ...STATUS_ORDER] as StatusFilter[]).map((s) => (
                <FilterPill key={s} active={status === s} onClick={() => setStatus(s)}>
                  {s === "all" ? "Any status" : s.charAt(0) + s.slice(1).toLowerCase()}
                </FilterPill>
              ))}
            </div>
          </>
        ) : null}
      </div>
      {shown.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {shown.map((it) => (
            <FilteredSetup key={`${it.key}-${it.side}`} item={it} status={status} />
          ))}
        </div>
      ) : (
        <Panel>
          <Empty title={items.length ? "Nothing matches these filters" : "No plan published yet"} className="pt-5">
            {items.length ? "Try another filter." : "The engine sends Scenario A / B / C for NIFTY 50 and BANK NIFTY at 8:45 AM, re-plans at 11:45 AM and sets tomorrow's plan at 6:00 PM."}
          </Empty>
        </Panel>
      )}
      {ap ? (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {INDEX_KEYS.map((k) => {
            const plan = ap.snap.indices?.[k]?.plan;
            return plan && (idx === "all" || idx === k) ? <NoTradeBand key={k} snap={ap.snap} plan={plan} label={INDEX_LABEL[k]} /> : null;
          })}
        </div>
      ) : null}
      <p className="mt-4 text-xs text-dim">
        Status replays today&apos;s 5-minute prices through the engine&apos;s own rule (planner.evaluate_plan): Watch = no 15-min close beyond the level · Triggered = closed
        beyond it, waiting for the retest · Active = retest filled · Completed = T2, or T1 then stopped at entry · Stopped = stop hit. The website never creates or changes a
        setup.
      </p>
    </>
  );
}

function FilteredSetup({ item, status }: { item: SetupItem; status: StatusFilter }) {
  const t = useTracking(item);
  if (status !== "all" && t.status !== status) return null;
  return <SetupCard item={item} />;
}

/* ── Watchlist ───────────────────────────────────────────────────────────── */

export function WatchlistView() {
  const state = useTerminalState();
  const { keys, add, remove, move } = useWatchlist();
  const [input, setInput] = useState("");
  const { map, fetchedAt } = useQuotes({ keys });
  const ap = activePlan(state, new Date(state.server_time));
  const submit = () => {
    const k = input.trim().toUpperCase().replace(/[^A-Z0-9&_^=.-]/g, "");
    if (k) add(resolveInstrument(k).key);
    setInput("");
  };
  return (
    <>
      <PageHeader kicker="Watchlist" title="Your watchlist" right={<Fresh at={fetchedAt} label="Prices" />}>
        Saved in this browser. Plan levels appear for NIFTY 50 and BANK NIFTY — the indices your engine plans.
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
                items={setupsOf(ap?.snap).filter((x) => x.key === resolveInstrument(k).chain)}
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
  items,
  onRemove,
  onUp,
  onDown,
}: {
  k: string;
  state: ReturnType<typeof useTerminalState>;
  quote: ReturnType<typeof useQuotes>["quotes"][number] | undefined;
  items: SetupItem[];
  onRemove: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const inst = resolveInstrument(k);
  const v = indexValue(inst, quote, state);
  const bull = items.find((i) => i.side === "bull")?.sc;
  const bear = items.find((i) => i.side === "bear")?.sc;
  const best = items.find((i) => i.best);
  const lv = useMemo(() => planLevels(items[0]?.plan), [items]);
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
          {best ? <WatchSetupChip item={best} /> : null}
        </p>
        <p className="mt-0.5 truncate text-2xs text-dim">
          {bull?.entry != null || bear?.entry != null ? (
            <>
              {bull?.entry != null ? <span className="text-up">Bull above {num(bull.entry, 0)}</span> : null}
              {bull?.entry != null && bear?.entry != null ? " · " : ""}
              {bear?.entry != null ? <span className="text-down">Bear below {num(bear.entry, 0)}</span> : null} <span>(engine · {lv.length} levels)</span>
            </>
          ) : (
            <span>{inst.chain ? "No plan yet" : "Not planned by the engine"}</span>
          )}
        </p>
      </Link>
      <Sparkline data={v.spark} base={v.prevClose} width={72} height={28} className="hidden sm:block" />
      <div className="w-[104px] text-right">
        <Live value={v.price} className="num block text-[15px] font-medium">
          {num(v.price, inst.decimals ?? 2)}
        </Live>
        <Delta pctValue={v.change_pct} showAbs={false} className="text-xs" />
      </div>
      <button onClick={onRemove} className="press rounded-full p-1.5 text-dim hover:bg-hover hover:text-ink" aria-label={`Remove ${inst.name}`}>
        <X className="size-4" />
      </button>
    </li>
  );
}

function WatchSetupChip({ item }: { item: SetupItem }) {
  const t = useTracking(item);
  return t.live ? <StatusChip t={t} /> : <Chip tone="accent">best setup</Chip>;
}

export { clsx, pct };
