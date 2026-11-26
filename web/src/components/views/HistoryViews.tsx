"use client";
import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SESSION_LABEL, SESSION_SHORT, engineBias, isAi, opportunities } from "@/lib/derive";
import { dateIST, dayIST, num, timeIST } from "@/lib/format";
import type { ReportResult, Outcome } from "@/lib/performance";
import type { AiPremarketAnalysis, Session, Snapshot, SnapshotMeta, TerminalState } from "@/lib/types";
import { Breadth, FiiDiiCard, MoversList, SectorHeatmap } from "../market/breadth";
import { Brief, Outlook } from "../market/engine";
import { buildEvents, EventsList, FilterPill, NewsList } from "../market/feeds";
import { ChainSummary, OiProfile } from "../market/options";
import { SetupCard } from "../market/setups";
import { BiasChip, Chip, Delta, Empty, PageHeader, Panel, PanelHead, Tag, clsx } from "../ui";

/* ── History list ────────────────────────────────────────────────────────── */

const SESS: (Session | "all")[] = ["all", "evening", "premarket", "ai_premarket", "afternoon"];

export function HistoryView({ initial }: { initial: SnapshotMeta[] }) {
  const [items, setItems] = useState(initial);
  const [session, setSession] = useState<Session | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [bias, setBias] = useState<"all" | "bullish" | "bearish" | "neutral">("all");
  const [inst, setInst] = useState("");
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
    .filter((m) => !inst || m.symbols.some((s) => s.includes(inst.trim().toUpperCase())));
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
      <PageHeader kicker="History" title="Every analysis, as published">
        Each snapshot is stored exactly as the engine sent it. Open one to see the full picture at that moment.
      </PageHeader>
      <div className="mb-4 flex flex-col gap-3">
        <div className="rail gap-1.5">
          {SESS.map((s) => (
            <FilterPill key={s} active={session === s} onClick={() => setSession(s)}>
              {s === "all" ? "All reports" : SESSION_SHORT[s]}
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
          <input
            value={inst}
            onChange={(e) => setInst(e.target.value)}
            placeholder="Instrument (NIFTY, INFY…)"
            className="h-8 w-48 rounded-full border border-line bg-card px-3 text-xs text-ink outline-none placeholder:text-faint"
          />
          <div className="rail gap-1.5">
            {(["all", "bullish", "bearish", "neutral"] as const).map((b) => (
              <FilterPill key={b} active={bias === b} onClick={() => setBias(b)}>
                {b === "all" ? "Any bias" : b[0].toUpperCase() + b.slice(1)}
              </FilterPill>
            ))}
          </div>
        </div>
        {bias !== "all" ? <p className="text-2xs text-dim">Only AI pre-market reports carry a bias, so the bias filter shows those.</p> : null}
      </div>
      {byDay.length ? (
        <div className={clsx("space-y-5", loading && "opacity-60")}>
          {byDay.map(([d, ms]) => (
            <section key={d}>
              <p className="eyebrow mb-2">{dayIST(ms[0].generated_at).split(" ")[0]} · {d}</p>
              <div className="panel divide-y divide-line overflow-hidden">
                {ms.map((m) => (
                  <Link key={m.id} href={`/history/${m.id}`} className="grid grid-cols-[72px_1fr_auto] items-center gap-3 px-4 py-3.5 hover:bg-hover/40 sm:grid-cols-[84px_170px_1fr_auto] sm:px-5">
                    <span className="num text-sm text-ink">{timeIST(m.generated_at)}</span>
                    <span className="text-sm text-ink-2">{SESSION_LABEL[m.session]}</span>
                    <span className="col-span-3 col-start-1 row-start-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-dim sm:col-span-1 sm:col-start-auto sm:row-start-auto">
                      {m.bias ? <BiasChip bias={m.bias} /> : null}
                      <span>
                        NIFTY <span className="num text-ink-2">{num(m.nifty)}</span>
                      </span>
                      {m.support ? (
                        <span>
                          S <span className="num text-up">{num(m.support, 0)}</span>
                        </span>
                      ) : null}
                      {m.resistance ? (
                        <span>
                          R <span className="num text-down">{num(m.resistance, 0)}</span>
                        </span>
                      ) : null}
                      {m.setups ? <span>{m.setups} setups</span> : null}
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
          <Empty title={loading ? "Loading…" : "No snapshots match these filters"} className="pt-5" />
        </Panel>
      )}
    </>
  );
}

/* ── One snapshot, exactly as stored ─────────────────────────────────────── */

function sanitiseTelegram(html: string) {
  const esc = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/&lt;(\/?)(b|i|code)&gt;/g, "<$1$2>").replace(/&amp;(amp|lt|gt|quot|#39);/g, "&$1;");
}

export function SnapshotView({ snap }: { snap: Snapshot }) {
  const [raw, setRaw] = useState(false);
  const d = snap.data;
  const ai = isAi(snap) ? (snap.analysis as AiPremarketAnalysis) : null;
  const fakeState: TerminalState = {
    server_time: snap.generated_at,
    version: "",
    demo: !!snap.demo,
    storage: { kind: "memory", ok: true },
    latest: { [snap.session]: snap },
    timeline: [],
    metrics: [],
  };
  const bias = ai ? engineBias(fakeState, new Date(snap.generated_at)) : null;
  const setups = opportunities(snap);
  const indices = Object.entries(d.indices ?? {});
  const events = buildEvents([snap]);
  return (
    <>
      <PageHeader
        kicker={<Link href="/history">History</Link>}
        title={SESSION_LABEL[snap.session]}
        right={snap.demo ? <Chip tone="accent">Demo snapshot</Chip> : null}
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            Generated <span className="num text-ink">{timeIST(snap.generated_at, true)}</span> {dateIST(snap.generated_at)}
          </span>
          {snap.trade_date ? <span className="text-dim">· market data for session {snap.trade_date}</span> : null}
          {snap.market_status ? <span className="text-dim">· NSE: {snap.market_status}</span> : null}
          {snap.source?.run_url ? (
            <a href={snap.source.run_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              GitHub run <ExternalLink className="size-3" />
            </a>
          ) : null}
        </span>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5">
        {snap.analysis?.kind === "brief" ? (
          <div className="lg:col-span-2">
            <Brief snap={snap} />
          </div>
        ) : null}
        {ai ? (
          <div className="lg:col-span-3">
            <Outlook bias={bias} />
          </div>
        ) : null}
        {ai && (ai.overnight_summary || ai.domestic_summary) ? (
          <Panel className="lg:col-span-3">
            <PanelHead title="Summaries" right={<Tag kind="engine" />} />
            <div className="grid grid-cols-1 gap-4 px-4 pb-5 text-sm text-ink-2 sm:grid-cols-2 sm:px-5">
              {ai.overnight_summary ? (
                <div>
                  <p className="mb-1 text-2xs text-dim">Overnight</p>
                  {ai.overnight_summary}
                </div>
              ) : null}
              {ai.domestic_summary ? (
                <div>
                  <p className="mb-1 text-2xs text-dim">Domestic</p>
                  {ai.domestic_summary}
                </div>
              ) : null}
            </div>
          </Panel>
        ) : null}
        {ai?.nifty_levels || ai?.banknifty_levels ? (
          <Panel>
            <PanelHead title="AI levels" right={<Tag kind="engine" />} />
            <div className="space-y-3 px-4 pb-5 text-sm sm:px-5">
              {(["nifty_levels", "banknifty_levels"] as const).map((k) =>
                ai[k] ? (
                  <div key={k}>
                    <p className="mb-1 text-2xs text-dim">{k === "nifty_levels" ? "Nifty" : "Bank Nifty"}</p>
                    <p>
                      R <span className="num text-down">{(ai[k]!.resistances ?? []).map((x) => num(x, 0)).join(" · ")}</span>
                    </p>
                    <p>
                      S <span className="num text-up">{(ai[k]!.supports ?? []).map((x) => num(x, 0)).join(" · ")}</span>
                    </p>
                  </div>
                ) : null,
              )}
            </div>
          </Panel>
        ) : null}
        {setups.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:col-span-3 xl:grid-cols-3">
            {setups.map((o) => (
              <SetupCard key={o.symbol + o.side} op={o} snap={snap} candidate={d.candidates?.[o.symbol]} />
            ))}
          </div>
        ) : null}
        {indices.length ? (
          <Panel>
            <PanelHead title="Indices at the time" right={<Tag kind="raw">NSE via engine</Tag>} />
            <div className="divide-y divide-line pb-2">
              {d.gift_nifty ? (
                <Row name="GIFT Nifty" last={d.gift_nifty.last} pctv={d.gift_nifty.change_pct} sub={`as of ${d.gift_nifty.as_of ?? "—"}`} />
              ) : null}
              {indices.map(([k, v]) => (
                <Row key={k} name={k} last={v.last} pctv={v.change_pct ?? null} sub={v.low != null && v.high != null ? `${num(v.low)} – ${num(v.high)}` : undefined} />
              ))}
            </div>
          </Panel>
        ) : null}
        {(["NIFTY", "BANKNIFTY"] as const).map((k) =>
          d.option_chains?.[k] ? (
            <Panel key={k}>
              <PanelHead title={`${k === "NIFTY" ? "Nifty" : "Bank Nifty"} chain`} right={<Tag kind="raw" />} />
              <div className="space-y-4 px-4 pb-5 sm:px-5">
                <ChainSummary c={d.option_chains[k]!} />
                <OiProfile c={d.option_chains[k]!} width={6} />
              </div>
            </Panel>
          ) : null,
        )}
        {d.fii_dii ? (
          <Panel>
            <PanelHead title="FII / DII" right={<Tag kind="raw" />} />
            <FiiDiiCard f={d.fii_dii} history={[]} />
          </Panel>
        ) : null}
        {d.sectors?.length ? (
          <Panel className="lg:col-span-2">
            <PanelHead title="Sectors" right={<Tag kind="raw" />} />
            <SectorHeatmap sectors={d.sectors} momentum={d.sector_momentum} />
          </Panel>
        ) : null}
        {d.indices?.["NIFTY 50"]?.advances !== undefined || d.breadth ? (
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
        {events.length ? (
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
  T2: { label: "Target 2 reached", tone: "up" },
  T1: { label: "Target 1 reached", tone: "up" },
  STOP: { label: "Stopped", tone: "down" },
  OPEN: { label: "Entered · no exit level by close", tone: "info" },
  NO_ENTRY: { label: "Entry never traded", tone: "neutral" },
  AMBIGUOUS: { label: "Stop & target same bar", tone: "accent" },
  PENDING: { label: "Session in progress", tone: "accent" },
  NO_DATA: { label: "No price data", tone: "neutral" },
};

export function PerformanceView() {
  const [data, setData] = useState<{ results: ReportResult[]; computed_at: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/performance?n=20")
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);
  const all = data?.results.flatMap((r) => r.setups.filter((s) => s.outcome !== "PENDING" && s.outcome !== "NO_DATA")) ?? [];
  const count = (o: Outcome[]) => all.filter((s) => o.includes(s.outcome)).length;
  return (
    <>
      <PageHeader kicker="Performance" title="Analysis vs actual">
        Each AI report&apos;s setups and Nifty levels, replayed against what prices actually did. Nothing is scored until that session&apos;s prices exist.
      </PageHeader>
      {all.length ? (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Setups scored", all.length, "text-ink"],
            ["Reached a target", count(["T1", "T2"]), "text-up"],
            ["Stopped", count(["STOP"]), "text-down"],
            ["Never entered", count(["NO_ENTRY"]), "text-ink-2"],
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
          <Empty title="Replaying reports against prices…" className="pt-5" />
        </Panel>
      ) : data.results.length === 0 ? (
        <Panel>
          <Empty title="No AI pre-market reports stored yet" className="pt-5">
            Performance appears once the engine has published AI reports and the market has traded those sessions.
          </Empty>
        </Panel>
      ) : (
        <div className="space-y-4">
          {data.results.map((r) => (
            <Panel key={r.snapshotId}>
              <PanelHead
                title={
                  <Link href={`/history/${r.snapshotId}`} className="hover:text-accent-hi">
                    {dayIST(r.generated_at)} · AI report {timeIST(r.generated_at)}
                  </Link>
                }
                right={
                  <>
                    <BiasChip bias={r.sentiment} />
                    {r.recommendation ? <Chip>{r.recommendation.replace("_", " ")}</Chip> : null}
                    {r.pending ? <Chip tone="accent">In progress</Chip> : null}
                    {r.demo ? <Chip tone="accent">demo</Chip> : null}
                  </>
                }
              />
              {r.nifty?.levels.length ? (
                <div className="px-4 pb-4 sm:px-5">
                  <p className="mb-2 text-xs text-dim">
                    Nifty levels ·{" "}
                    {r.nifty.day ? (
                      <>
                        actual range <span className="num text-ink-2">{num(r.nifty.day.low)} – {num(r.nifty.day.high)}</span>, close{" "}
                        <span className="num text-ink-2">{num(r.nifty.day.close)}</span>
                      </>
                    ) : (
                      "awaiting that session's prices"
                    )}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {r.nifty.levels
                      .sort((a, b) => b.price - a.price)
                      .map((l) => (
                        <span
                          key={l.kind + l.price}
                          className={clsx(
                            "num rounded-lg border px-2 py-1 text-xs",
                            !r.nifty?.day ? "border-line text-dim" : l.tested ? (l.kind === "resistance" ? "border-[#e58c7a55] text-down" : "border-[#9cc29a55] text-up") : "border-line text-dim",
                          )}
                          title={r.nifty?.day ? (l.tested ? "Traded at during the session" : "Not reached") : "No data yet"}
                        >
                          {l.kind === "resistance" ? "R" : "S"} {num(l.price, 0)} {r.nifty?.day ? (l.tested ? "· tested" : "· not reached") : ""}
                        </span>
                      ))}
                  </div>
                </div>
              ) : null}
              {r.setups.length ? (
                <div className="overflow-x-auto border-t border-line">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="text-left text-2xs text-dim">
                        <th className="px-4 py-2 font-medium sm:px-5">Setup</th>
                        <th className="px-2 py-2 font-medium">Entry</th>
                        <th className="px-2 py-2 font-medium">Stop</th>
                        <th className="px-2 py-2 font-medium">T1 / T2</th>
                        <th className="px-2 py-2 font-medium">Outcome</th>
                        <th className="px-4 py-2 font-medium sm:px-5">Basis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.setups.map((s) => (
                        <tr key={s.symbol + s.side} className="border-t border-line/60">
                          <td className="px-4 py-2.5 sm:px-5">
                            <span className="font-medium">{s.symbol}</span> <span className={s.side === "CALL" ? "text-up" : "text-down"}>{s.side}</span>
                          </td>
                          <td className="num px-2 text-accent">{s.entry_zone}</td>
                          <td className="num px-2 text-down">{num(s.stop_loss)}</td>
                          <td className="num px-2 text-up">
                            {num(s.target_1)} / {num(s.target_2)}
                          </td>
                          <td className="px-2">
                            <Chip tone={OUT[s.outcome].tone}>{OUT[s.outcome].label}</Chip>
                          </td>
                          <td className="px-4 text-2xs text-dim sm:px-5">
                            {s.basis === "15m" ? "15-min bars" : s.basis === "1d" ? "Daily bar" : "—"}
                            {s.day ? <span className="num"> · {num(s.day.low)}–{num(s.day.high)}</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="border-t border-line px-4 py-3 text-sm text-dim sm:px-5">No setups in this report.</p>
              )}
            </Panel>
          ))}
          <p className="text-xs text-dim">
            Replays use the engine&apos;s numbers untouched. With 15-minute bars the order of moves is known; with a daily bar only (older than ~25 days) a session where both
            stop and target traded is marked as ambiguous rather than guessed. {data.computed_at ? `Computed ${timeIST(data.computed_at)}.` : ""}
          </p>
        </div>
      )}
    </>
  );
}
