"use client";
import { ArrowUpRight } from "lucide-react";
import { useMemo, useState } from "react";
import { daysUntil } from "@/lib/derive";
import { parseNseDate, timeIST } from "@/lib/format";
import type { CalEvent, CorpEvent, Holiday, NewsItem, Snapshot } from "@/lib/types";
import { Ago, Chip, clsx } from "../ui";

export function NewsList({ items, limit, filterable = false }: { items: NewsItem[]; limit?: number; filterable?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const sources = useMemo(() => [...new Set(items.map((i) => i.source))], [items]);
  const shown = items
    .filter((i) => !src || i.source === src)
    .filter((i) => !q || i.title.toLowerCase().includes(q.toLowerCase()))
    .slice(0, limit ?? items.length);
  if (!items.length) return <p className="px-4 pb-5 text-sm text-dim sm:px-5">No headlines in the latest snapshot.</p>;
  return (
    <div>
      {filterable ? (
        <div className="flex min-w-0 flex-col gap-3 px-4 pb-3 sm:flex-row sm:items-center sm:px-5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter headlines"
            className="h-10 rounded-full border border-line bg-bg-sunk px-4 text-sm text-ink outline-none placeholder:text-faint focus:border-line-strong sm:w-72"
          />
          <div className="rail gap-1.5">
            <FilterPill active={!src} onClick={() => setSrc(null)}>All</FilterPill>
            {sources.map((s) => (
              <FilterPill key={s} active={src === s} onClick={() => setSrc(src === s ? null : s)}>
                {s}
              </FilterPill>
            ))}
          </div>
        </div>
      ) : null}
      <ul>
        {shown.map((n, i) => {
          const inner = (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] leading-snug text-ink">{n.title}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-dim">
                  <span className="text-ink-2">{n.source}</span>·{n.published ? <Ago at={n.published} /> : "time not given"}
                  {n.published ? <span className="num">· {timeIST(n.published)}</span> : null}
                </p>
              </div>
              {n.link ? <ArrowUpRight className="mt-1 size-4 shrink-0 text-dim" /> : null}
            </>
          );
          return (
            <li key={i} className="border-t border-line first:border-t-0">
              {n.link ? (
                <a href={n.link} target="_blank" rel="noopener noreferrer" className="flex gap-3 px-4 py-3.5 hover:bg-hover/50 sm:px-5">
                  {inner}
                </a>
              ) : (
                <div className="flex gap-3 px-4 py-3.5 sm:px-5">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "press rounded-full border px-3 py-1.5 text-xs whitespace-nowrap",
        active ? "border-transparent bg-ink text-bg" : "border-line text-ink-2 hover:border-line-strong",
      )}
    >
      {children}
    </button>
  );
}

interface Ev {
  date: string;
  title: string;
  sub?: string;
  kind: "result" | "action" | "expiry" | "holiday" | "macro";
  impact?: CalEvent["impact"];
}

const KIND: Record<Ev["kind"], { label: string; tone: "accent" | "info" | "up" | "down" | "neutral" }> = {
  macro: { label: "Event", tone: "neutral" },
  result: { label: "Results", tone: "info" },
  action: { label: "Ex-date", tone: "neutral" },
  expiry: { label: "Expiry", tone: "accent" },
  holiday: { label: "Holiday", tone: "down" },
};

const IMPACT_TONE: Record<CalEvent["impact"], "down" | "accent" | "up"> = { HIGH: "down", MEDIUM: "accent", LOW: "up" };

/** Upcoming dates from the engine: its event calendar, NSE results / ex-dates, expiries and holidays. */
export function buildEvents(snaps: (Snapshot | undefined)[]): Ev[] {
  const out: Ev[] = [];
  const seen = new Set<string>();
  const push = (e: Ev) => {
    const k = `${parseNseDate(e.date)?.getTime()}|${e.title}`;
    if (!seen.has(k)) (seen.add(k), out.push(e));
  };
  for (const s of snaps) {
    if (!s) continue;
    const d = s.data ?? {};
    [...(d.calendar ?? []), ...(d.events_today ?? [])].forEach((e: CalEvent) =>
      push({
        date: e.date,
        title: e.event,
        sub: [e.time, e.market].filter(Boolean).join(" · ") + (e.est ? " · verify" : ""),
        kind: e.type === "holiday" ? "holiday" : e.type?.startsWith("expiry") ? "expiry" : e.type?.startsWith("results") ? "result" : "macro",
        impact: e.impact,
      }),
    );
    (d.upcoming?.results ?? []).forEach((e: CorpEvent) => push({ date: e.date, title: `${e.symbol}: ${e.what}`, sub: (e.indices ?? []).join(", "), kind: "result" }));
    (d.upcoming?.actions ?? []).forEach((e: CorpEvent) => push({ date: e.date, title: `${e.symbol}: ${e.what}`, sub: (e.indices ?? []).join(", "), kind: "action" }));
    Object.entries(d.expiries ?? {}).forEach(([k, v]) => v?.[0] && push({ date: v[0], title: `${k === "NIFTY" ? "NIFTY" : "BANK NIFTY"} expiry`, kind: "expiry" }));
    (d.holidays ?? []).forEach((h: Holiday) => {
      const dd = daysUntil(h.date);
      if (dd !== null && dd >= 0 && dd <= 30) push({ date: h.date, title: h.name, sub: h.day, kind: "holiday" });
    });
  }
  return out
    .filter((e) => (daysUntil(e.date) ?? 0) >= 0)
    .sort((a, b) => (parseNseDate(a.date)?.getTime() ?? 0) - (parseNseDate(b.date)?.getTime() ?? 0));
}

export function EventsList({ events, limit }: { events: Ev[]; limit?: number }) {
  if (!events.length)
    return <p className="px-4 pb-5 text-sm text-dim sm:px-5">No upcoming events, results, expiries or holidays in the engine&apos;s data.</p>;
  return (
    <ul>
      {events.slice(0, limit ?? events.length).map((e, i) => {
        const d = parseNseDate(e.date);
        const dd = daysUntil(e.date);
        return (
          <li key={i} className="flex items-center gap-3 border-t border-line px-4 py-3 first:border-t-0 sm:px-5">
            <DateTile d={d} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">{e.title}</p>
              <p className="text-xs text-dim">
                {dd === 0 ? "Today" : dd === 1 ? "Tomorrow" : dd !== null ? `In ${dd} days` : ""}
                {e.sub ? ` · ${e.sub}` : ""}
              </p>
            </div>
            {e.impact ? <Chip tone={IMPACT_TONE[e.impact]}>{e.impact}</Chip> : <Chip tone={KIND[e.kind].tone}>{KIND[e.kind].label}</Chip>}
          </li>
        );
      })}
    </ul>
  );
}

function DateTile({ d }: { d: Date | null }) {
  return (
    <div className="flex w-11 shrink-0 flex-col items-center rounded-xl bg-card-2 py-1.5">
      <span className="text-[10px] tracking-[0.08em] text-dim uppercase">{d ? d.toLocaleString("en-IN", { month: "short", timeZone: "Asia/Kolkata" }) : "—"}</span>
      <span className="num text-[17px] leading-5 font-semibold">{d ? d.toLocaleString("en-IN", { day: "numeric", timeZone: "Asia/Kolkata" }) : "?"}</span>
    </div>
  );
}

/** The engine's monthly volatility calendar (calendar_events.month_calendar). */
export function MacroCalendar({ events, showPast = false }: { events: CalEvent[]; showPast?: boolean }) {
  const [impact, setImpact] = useState<CalEvent["impact"] | null>(null);
  const shown = events.filter((e) => (!impact || e.impact === impact) && (showPast || (daysUntil(e.date) ?? 0) >= 0));
  if (!events.length) return <p className="px-4 pb-5 text-sm text-dim sm:px-5">No calendar published yet — it is sent with the first pre-market report of each month.</p>;
  const byDay = new Map<string, CalEvent[]>();
  shown.forEach((e) => byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]));
  return (
    <div>
      <div className="rail gap-1.5 px-4 pb-3 sm:px-5">
        <FilterPill active={!impact} onClick={() => setImpact(null)}>All</FilterPill>
        {(["HIGH", "MEDIUM", "LOW"] as const).map((k) => (
          <FilterPill key={k} active={impact === k} onClick={() => setImpact(impact === k ? null : k)}>
            {k[0] + k.slice(1).toLowerCase()} impact
          </FilterPill>
        ))}
      </div>
      {!shown.length ? <p className="px-4 pb-5 text-sm text-dim sm:px-5">Nothing left this month for that filter.</p> : null}
      <ul>
        {[...byDay.entries()].map(([day, evs]) => (
          <li key={day} className="flex gap-3 border-t border-line px-4 py-3 sm:px-5">
            <DateTile d={parseNseDate(day)} />
            <ul className="min-w-0 flex-1 space-y-2.5">
              {evs.map((e, i) => (
                <li key={i}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-ink">
                      {e.event}
                      {e.est ? <span className="ml-1.5 text-2xs text-dim">(verify)</span> : null}
                    </p>
                    <Chip tone={IMPACT_TONE[e.impact]}>{e.impact}</Chip>
                  </div>
                  <p className="text-xs text-dim">{[e.time, e.market].filter(Boolean).join(" · ")}</p>
                  {e.impact !== "LOW" && e.why ? <p className="mt-1 text-xs text-ink-2">{e.why}</p> : null}
                  {e.impact !== "LOW" && e.caution ? <p className="mt-0.5 text-xs text-accent">{e.caution}</p> : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-3 text-2xs text-dim sm:px-5">
        From the engine&apos;s calendar: NSE (expiries, holidays, results), data/macro_calendar.json (RBI, Fed, BLS, MoSPI) and usual release-day rules. &quot;(verify)&quot; =
        estimated date or secondary source — check the official calendar the day before.
      </p>
    </div>
  );
}
