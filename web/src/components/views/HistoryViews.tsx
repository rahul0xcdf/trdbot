"use client";
import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { INDEX_LABEL, SESSION_LABEL, SESSION_SHORT, setupsOf } from "@/lib/derive";
import { dateIST, dayIST, num, timeIST } from "@/lib/format";
import type { ReportResult, Outcome, ScenarioResult } from "@/lib/performance";
import type { Session, Snapshot, SnapshotMeta } from "@/lib/types";
import { INDEX_KEYS } from "@/lib/types";
import { Breadth, FiiDiiCard, MoversList, SectorHeatmap } from "../market/breadth";
import { ActionChip, AiNotes, DecisionCard } from "../market/engine";
import { buildEvents, EventsList, FilterPill, MacroCalendar, NewsList } from "../market/feeds";
import { ChainSummary, OiProfile, chainView } from "../market/options";
import { IndexRead } from "../market/read";
import { NoTradeBand, SetupCard, statusWords } from "../market/setups";
import { BiasChip, Chip, Delta, Empty, PageHeader, Panel, PanelHead, Tag, clsx } from "../ui";

/* ── History list ────────────────────────────────────────────────────────── */

const SESS: (Session | "all")[] = ["all", "premarket", "midday", "evening", "monthly"];

export function HistoryView({ initial }: { initial: SnapshotMeta[] }) {
  const [items, setItems] = useState(initial);
  const [session, setSession] = useState<Session | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [bias, setBias] = useState<"all" | "bullish" | "bearish" | "neutral">("all");
  const [onlySetups, setOnlySetups] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const qs = new URLSearchParams({ limit: "300" });
    if (session !== "all") qs.set("session", session);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    setLoading(true);
    fetch(`/api/snapshots?${qs}`)
      .then((r) => r.json())
      .then((j) => setItems(j.items ?? []))
      .finally(() => setLoading(false));
  }, [session, from, to]);

  const shown = items
    .filter((m) => bias === "all" || (m.bias ?? "").toLowerCase().includes(bias))
    .filter((m) => !onlySetups || m.setups > 0);
  const byDay = useMemo(() => {
    const g = new Map<string, SnapshotMeta[]>();
    shown.forEach((m) => {
      const d = dateIST(m.generated_at);
      g.set(d, [...(g.get(d) ?? []), m]);
    });
    return [...g.entries()];
  }, [shown]);

  return (
    <>
      <PageHeader kicker="History" title="Every report, as published">
        Each report is stored exactly as the engine sent it. Open one to see the plan, the levels and the Telegram message from that moment.
      </PageHeader>
      <div className="mb-4 flex flex-col gap-3">
        <div className="rail gap-1.5">
          {SESS.map((s) => (
            <FilterPill key={s} active={session === s} onClick={() => setSession(s)}>
              {s === "all" ? "All reports" : SESSION_LABEL[s]}
            </FilterPill>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-dim">
            From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-transparent text-ink outline-none [color-scheme:dark]" />
          </label>
          <label className="flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-dim">
            To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-transparent text-ink outline-none [color-scheme:dark]" />
          </label>
          <div className="rail gap-1.5">
            {(["all", "bullish", "bearish", "neutral"] as const).map((b) => (
              <FilterPill key={b} active={bias === b} onClick={() => setBias(b)}>
                {b === "all" ? "Any bias" : b[0].toUpperCase() + b.slice(1)}
              </FilterPill>
            ))}
            <FilterPill active={onlySetups} onClick={() => setOnlySetups((x) => !x)}>
              With a valid setup
            </FilterPill>
          </div>
        </div>
      </div>
      {byDay.length ? (
        <div className={clsx("space-y-5", loading && "opacity-60")}>
          {byDay.map(([d, ms]) => (
            <section key={d}>
              <p className="eyebrow mb-2">
                {dayIST(ms[0].generated_at).split(" ")[0]} · {d}
              </p>
              <div className="panel divide-y divide-line overflow-hidden">
                {ms.map((m) => (
                  <Link key={m.id} href={`/history/${m.id}`} className="grid grid-cols-[72px_1fr_auto] items-center gap-3 px-4 py-3.5 hover:bg-hover/40 sm:grid-cols-[84px_190px_1fr_auto] sm:px-5">
                    <span className="num text-sm text-ink">{timeIST(m.generated_at)}</span>
                    <span className="text-sm text-ink-2">
                      {SESSION_LABEL[m.session]}
                      {m.plan_for && m.trade_date && m.plan_for !== m.trade_date ? (
                        <span className="block text-2xs text-dim">plan for {dayIST(m.plan_for + "T12:00:00+05:30")}</span>
                      ) : null}
                    </span>
                    <span className="col-span-3 col-start-1 row-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dim sm:col-span-1 sm:col-start-auto sm:row-start-auto">
                      {m.bias ? <BiasChip bias={m.bias} /> : null}
                      {m.action ? <ActionChip action={m.action} /> : null}
                      {m.nifty ? (
                        <span>
                          NIFTY <span className="num text-ink-2">{num(m.nifty)}</span>
                        </span>
                      ) : null}
                      {m.best ? <span className="truncate text-ink-2">{m.best}</span> : m.setups ? <span>{m.setups} valid</span> : null}
                      {m.demo ? <Chip tone="accent">demo</Chip> : null}
                    </span>
                    <span className="text-dim">›</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Panel>
          <Empty title={loading ? "Loading…" : "No reports match these filters"} className="pt-5" />
        </Panel>
      )}
    </>
  );
}

/* ── One report, exactly as stored ───────────────────────────────────────── */

function sanitiseTelegram(html: string) {
  const esc = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/&lt;(\/?)(b|i|code|pre)&gt;/g, "<$1$2>").replace(/&amp;(amp|lt|gt|quot|#39);/g, "&$1;");
}

export function SnapshotView({ snap }: { snap: Snapshot }) {
  const [raw, setRaw] = useState(false);
  const d = snap.data ?? {};
  const items = setupsOf(snap);
  const board = Object.entries(d.board ?? {});
  const events = buildEvents([snap]);
  const reads = INDEX_KEYS.filter((k) => snap.indices?.[k]);
  return (
    <>
      <PageHeader
        kicker={<Link href="/history">History</Link>}
        title={SESSION_LABEL[snap.session]}
        right={snap.demo ? <Chip tone="accent">Demo report</Chip> : null}
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            Generated <span className="num text-ink">{timeIST(snap.generated_at, true)}</span> {dateIST(snap.generated_at)}
          </span>
          {snap.trade_date ? <span className="text-dim">· market data for {snap.trade_date}</span> : null}
          {snap.plan_for && snap.plan_for !== snap.trade_date ? <span className="text-dim">· plan for {snap.plan_for}</span> : null}
          {d.board_status ? <span className="text-dim">· NSE: {d.board_status}</span> : null}
          {snap.source?.run_url ? (
            <a href={snap.source.run_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              GitHub run <ExternalLink className="size-3" />
            </a>
          ) : null}
        </span>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        {snap.note ? (
          <Panel className="lg:col-span-3">
            <p className="px-4 py-3 text-sm text-ink-2 sm:px-5">{snap.note} — no assessment, NO TRADE on missing data.</p>
          </Panel>
        ) : null}
        {snap.decision ? (
          <div className="lg:col-span-2">
            <DecisionCard snap={snap} />
          </div>
        ) : null}
        {snap.ai && Object.keys(snap.ai).length ? (
          <div className={snap.decision ? "" : "lg:col-span-3"}>
            <AiNotes snap={snap} />
          </div>
        ) : null}
        {reads.length ? (
          <Panel className="lg:col-span-3">
            <PanelHead title="Engine read" right={<Tag kind="engine" />} />
            <div className="grid grid-cols-1 gap-6 px-4 pb-5 sm:px-5 lg:grid-cols-2">
              {reads.map((k) => (
                <IndexRead key={k} snap={snap} ix={snap.indices[k]!} />
              ))}
            </div>
            {snap.indices?.NIFTY?.eod?.lesson ? (
              <div className="border-t border-line px-4 py-3.5 sm:px-5">
                <p className="eyebrow mb-1">Trading lesson · {snap.indices.NIFTY.eod.lesson.title}</p>
                <p className="text-sm text-ink-2">{snap.ai?.lesson ?? snap.indices.NIFTY.eod.lesson.text}</p>
              </div>
            ) : null}
          </Panel>
        ) : null}
        {items.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:col-span-3 xl:grid-cols-4">
            {items.map((it) => (
              <SetupCard key={`${it.key}-${it.side}`} item={it} />
            ))}
          </div>
        ) : null}
        {reads.some((k) => snap.indices[k]?.plan?.no_trade?.low) ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:col-span-3">
            {reads.map((k) => (snap.indices[k]?.plan ? <NoTradeBand key={k} snap={snap} plan={snap.indices[k]!.plan!} label={INDEX_LABEL[k]} /> : null))}
          </div>
        ) : null}
        {board.length || d.gift_nifty ? (
          <Panel>
            <PanelHead title="Indices at the time" right={<Tag kind="raw">NSE via engine</Tag>} />
            <div className="divide-y divide-line pb-2">
              {d.gift_nifty ? <Row name="GIFT Nifty" last={d.gift_nifty.last} pctv={d.gift_nifty.change_pct} sub={`as of ${d.gift_nifty.as_of ?? "—"}`} /> : null}
              {board.map(([k, v]) => (
                <Row key={k} name={k} last={v.last} pctv={v.change_pct ?? null} sub={v.low != null && v.high != null ? `${num(v.low)} – ${num(v.high)}` : undefined} />
              ))}
            </div>
          </Panel>
        ) : null}
        {reads.map((k) => {
          const c = chainView(snap.indices[k]?.chain);
          return c ? (
            <Panel key={k}>
              <PanelHead title={`${INDEX_LABEL[k]} chain`} right={<Tag kind="raw" />} />
              <div className="space-y-4 px-4 pb-5 sm:px-5">
                <ChainSummary c={c} />
                <OiProfile c={c} width={6} />
              </div>
            </Panel>
          ) : null;
        })}
        {d.fii_dii ? (
          <Panel>
            <PanelHead title="FII / DII" right={<Tag kind="raw" />} />
            <FiiDiiCard f={d.fii_dii} history={[]} />
          </Panel>
        ) : null}
        {d.sectors?.length ? (
          <Panel className="lg:col-span-2">
            <PanelHead title="Sectors" right={<Tag kind="raw" />} />
            <SectorHeatmap sectors={d.sectors} momentum={d.sector_momentum ?? undefined} />
          </Panel>
        ) : null}
        {d.board?.["NIFTY 50"]?.advances !== undefined ? (
          <Panel>
            <PanelHead title="Breadth" right={<Tag kind="raw" />} />
            <Breadth snaps={[snap]} />
          </Panel>
        ) : null}
        {d.movers?.NIFTY ? (
          <Panel>
            <PanelHead title="Top movers" right={<Tag kind="raw" />} />
            <MoversList movers={d.movers.NIFTY} title="Nifty 50" />
            {d.movers.BANKNIFTY ? <MoversList movers={d.movers.BANKNIFTY} title="Bank Nifty" /> : null}
          </Panel>
        ) : null}
        {snap.session === "monthly" && d.calendar?.length ? (
          <Panel className="lg:col-span-3">
            <PanelHead title="Event calendar" right={<Tag kind="engine" />} />
            <MacroCalendar events={d.calendar} showPast />
          </Panel>
        ) : events.length ? (
          <Panel>
            <PanelHead title="Calendar" right={<Tag kind="raw" />} />
            <EventsList events={events} />
          </Panel>
        ) : null}
        {d.news?.length ? (
          <Panel className="lg:col-span-2">
            <PanelHead title="Headlines" right={<Tag kind="raw" />} />
            <NewsList items={d.news} />
          </Panel>
        ) : null}
        {snap.telegram_html ? (
          <Panel className="lg:col-span-3">
            <PanelHead title="Telegram message, as sent" sub="For reference only — nothing on this site is parsed from it" />
            <div className="tg-html px-4 pb-5 sm:px-5" dangerouslySetInnerHTML={{ __html: sanitiseTelegram(snap.telegram_html) }} />
          </Panel>
        ) : null}
        <Panel className="lg:col-span-3">
          <button onClick={() => setRaw((r) => !r)} className="press flex w-full items-center justify-between px-4 py-4 text-sm text-ink-2 sm:px-5">
            Raw JSON from the engine
            <ChevronDown className={clsx("size-4 transition-transform", raw && "rotate-180")} />
          </button>
          {raw ? <pre className="max-h-[60vh] overflow-auto border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ink-2 sm:px-5">{JSON.stringify(snap, null, 2)}</pre> : null}
        </Panel>
      </div>
    </>
  );
}

function Row({ name, last, pctv, sub }: { name: string; last: number | null; pctv: number | null; sub?: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium">{name}</p>
        {sub ? <p className="num text-2xs text-dim">{sub}</p> : null}
      </div>
      <div className="text-right">
        <p className="num text-[15px] font-medium">{num(last)}</p>
        <Delta pctValue={pctv} showAbs={false} className="text-xs" />
      </div>
    </div>
  );
}

/* ── Performance: analysis vs actual ─────────────────────────────────────── */

const OUT: Record<Outcome, { label: string; tone: "up" | "down" | "accent" | "neutral" | "info" }> = {
  T2: { label: "T2 reached", tone: "up" },
  T1: { label: "T1 reached", tone: "up" },
  T1_BE: { label: "T1, rest at entry", tone: "up" },
  STOP: { label: "Stopped", tone: "down" },
  OPEN: { label: "Filled · open at close", tone: "info" },
  NO_FILL: { label: "Triggered · no retest", tone: "neutral" },
  NO_TRIGGER: { label: "Not triggered", tone: "neutral" },
  PENDING: { label: "Session in progress", tone: "accent" },
  NO_DATA: { label: "No price data", tone: "neutral" },
};

const FILLED: Outcome[] = ["T2", "T1", "T1_BE", "STOP", "OPEN"];

export function PerformanceView() {
  const [data, setData] = useState<{ results: ReportResult[]; computed_at: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scope, setScope] = useState<"valid" | "best" | "all">("valid");
  useEffect(() => {
    fetch("/api/performance?n=20")
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);
  const pick = (s: ScenarioResult) => (scope === "all" ? true : scope === "best" ? s.best : s.usable);
  const scored = data?.results.flatMap((r) => r.results.filter((s) => pick(s) && s.outcome !== "PENDING" && s.outcome !== "NO_DATA")) ?? [];
  const count = (o: Outcome[]) => scored.filter((s) => o.includes(s.outcome)).length;
  return (
    <>
      <PageHeader kicker="Performance" title="Plan vs actual">
        Each 8:45 AM plan&apos;s Scenario A and B, replayed on that session&apos;s real 5-minute prices with the engine&apos;s own rule (15-min close beyond the level, then a retest).
        Nothing is scored until that session&apos;s prices exist.
      </PageHeader>
      <div className="mb-4 rail gap-1.5">
        {(
          [
            ["valid", "Setups the engine would take"],
            ["best", "Best setup only"],
            ["all", "Every scenario"],
          ] as const
        ).map(([k, l]) => (
          <FilterPill key={k} active={scope === k} onClick={() => setScope(k)}>
            {l}
          </FilterPill>
        ))}
      </div>
      {scored.length ? (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ["Scored", scored.length, "text-ink"],
            ["Filled", count(FILLED), "text-ink"],
            ["Reached T1+", count(["T1", "T2", "T1_BE"]), "text-up"],
            ["Stopped", count(["STOP"]), "text-down"],
            ["No fill", count(["NO_FILL", "NO_TRIGGER"]), "text-ink-2"],
          ].map(([k, v, c]) => (
            <div key={k as string} className="panel p-4">
              <p className="text-xs text-dim">{k}</p>
              <p className={clsx("num mt-1 text-[28px] font-semibold tracking-[-0.03em]", c as string)}>{v}</p>
            </div>
          ))}
        </div>
      ) : null}
      {err ? <p className="text-sm text-down">{err}</p> : null}
      {!data ? (
        <Panel>
          <Empty title="Replaying plans against prices…" className="pt-5" />
        </Panel>
      ) : data.results.length === 0 ? (
        <Panel>
          <Empty title="No 8:45 AM plans stored yet" className="pt-5">
            Performance appears once the engine has published pre-market plans and the market has traded those sessions.
          </Empty>
        </Panel>
      ) : (
        <div className="space-y-4">
          {data.results.map((r) => (
            <Panel key={r.snapshotId}>
              <PanelHead
                title={
                  <Link href={`/history/${r.snapshotId}`} className="hover:text-accent-hi">
                    {dayIST(r.day + "T12:00:00+05:30")} · 8:45 AM plan
                  </Link>
                }
                sub={r.best ? `Best setup: ${r.best}` : r.action ?? undefined}
                right={
                  <>
                    <BiasChip bias={r.market_bias} />
                    {r.pending ? <Chip tone="accent">In progress</Chip> : null}
                    {r.demo ? <Chip tone="accent">demo</Chip> : null}
                  </>
                }
              />
              <div className="overflow-x-auto border-t border-line">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="text-left text-2xs text-dim">
                      <th className="px-4 py-2 font-medium sm:px-5">Scenario</th>
                      <th className="px-2 py-2 font-medium">Engine said</th>
                      <th className="px-2 py-2 font-medium">Trigger</th>
                      <th className="px-2 py-2 font-medium">Stop</th>
                      <th className="px-2 py-2 font-medium">T1 / T2</th>
                      <th className="px-2 py-2 font-medium">Replay</th>
                      <th className="px-4 py-2 font-medium sm:px-5">Bot at 11:45</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.results.map((s) => (
                      <tr key={s.index + s.side} className={clsx("border-t border-line/60", !pick(s) && "opacity-45")}>
                        <td className="px-4 py-2.5 sm:px-5">
                          <span className="font-medium">{s.label}</span> <span className={s.side === "bull" ? "text-up" : "text-down"}>{s.title}</span>
                          {s.best ? <Chip tone="accent" className="ml-1.5">best</Chip> : null}
                        </td>
                        <td className="px-2 text-xs">{s.usable ? <span className="text-up">Valid</span> : <span className="text-dim" title={s.verdict}>No trade</span>}</td>
                        <td className="num px-2 text-accent">{num(s.entry, 0)}</td>
                        <td className="num px-2 text-down">{num(s.stop, 0)}</td>
                        <td className="num px-2 text-up">
                          {num(s.t1, 0)} / {num(s.t2, 0)}
                        </td>
                        <td className="px-2">
                          <Chip tone={OUT[s.outcome].tone} title={s.note}>
                            {OUT[s.outcome].label}
                          </Chip>
                          {s.replay?.fill_time ? <span className="num ml-1.5 text-2xs text-dim">fill {timeIST(s.replay.fill_time)}</span> : null}
                        </td>
                        <td className="px-4 text-2xs text-dim sm:px-5">{s.engineMidday ? statusWords({ entry: s.entry, stop: s.stop, t1: s.t1, t2: s.t2 }, s.engineMidday).replace(/^[\d,]+: /, "") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ))}
          <p className="text-xs text-dim">
            The replay is planner.evaluate_plan ported line for line (verified against the Python on 72 cases): trigger = first 15-min close beyond the level, fill = the next
            5-min bar that retests it within 25% of the risk and closes on the right side of the stop. Plans older than 25 days use 15-min bars (approximate fills); older than 60
            days can&apos;t be replayed. {data.computed_at ? `Computed ${timeIST(data.computed_at)}.` : ""}
          </p>
        </div>
      )}
    </>
  );
}
