"use client";
/**
 * The engine's read of a session, laid out like the Telegram report
 * (reports._prev_session_lines / _live_lines / _eod_index_lines). Every value
 * is copied from the payload; word labels mirror the ones reports.py prints.
 */
import { compact, num, pct, timeIST } from "@/lib/format";
import type { IndexReport, LevelTest, Snapshot } from "@/lib/types";
import { BiasChip, Chip, clsx } from "../ui";
import { statusWords } from "./setups";
import { ActionChip } from "./engine";

function Line({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[108px_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-xs text-dim">{k}</dt>
      <dd className="min-w-0 text-ink-2">{children}</dd>
    </div>
  );
}

const N = ({ v, d = 0 }: { v: number | null | undefined; d?: number }) => <span className="num text-ink">{num(v, d)}</span>;

/** reports._tests_words(): one phrase per level, latest outcome. */
export function testsWords(tests: LevelTest[], onlyFailed = false): string {
  const by = new Map<string, LevelTest[]>();
  for (const e of tests) {
    if (onlyFailed && !e.failed) continue;
    const k = `${e.level}|${e.direction}`;
    by.set(k, [...(by.get(k) ?? []), e]);
  }
  return [...by.values()]
    .map((evs) => {
      const last = evs.at(-1)!;
      const kind = last.direction === "up" ? "breakout" : "breakdown";
      const fails = evs.filter((e) => e.failed).length;
      const word = last.failed ? `❌ false ${kind}${fails > 1 ? ` ×${fails}` : ""}` : `✅ ${kind} held${fails ? ` (after ${fails} failed tries)` : ""}`;
      return `${last.level} ${num(last.price, 0)} at ${timeIST(last.time)}: ${word}`;
    })
    .join(" · ");
}

function cprWords(w: number | null | undefined) {
  if (w == null) return "";
  return w < 0.1 ? "narrow → trend day more likely" : w > 0.25 ? "wide → range day more likely" : "normal";
}

/** Previous session + daily context (8:45 AM report). */
export function PrevSessionRead({ ix }: { ix: IndexReport }) {
  const p = ix.prev;
  const t = ix.tech ?? {};
  if (!p) return <p className="text-sm text-dim">Previous-session data unavailable.</p>;
  const pv = p.pivots_next;
  const tl = t.trendlines ?? {};
  return (
    <dl className="divide-y divide-line">
      <Line k="Prev. session">
        O <N v={p.open} /> · H <N v={p.high} /> · L <N v={p.low} /> · C <N v={p.close} d={2} /> <span className={clsx("num", (p.change_pct ?? 0) >= 0 ? "text-up" : "text-down")}>({pct(p.change_pct)})</span>
      </Line>
      <Line k="Candle">
        {p.pattern?.name} — {p.pattern?.meaning}; close location <span className="num">{p.clv}</span>
      </Line>
      {p.vs_prior ? <Line k="Range">{p.vs_prior}</Line> : null}
      <Line k="Daily trend">
        {t.structure?.label ?? "n/a"} · {t.ema_words ?? "EMAs n/a"} (20 EMA <N v={t.ema20} />, 50 EMA <N v={t.ema50} />) · RSI <span className="num">{t.rsi ?? "—"}</span>
      </Line>
      <Line k="VWAP">
        Closed {p.close > (p.vwap_close ?? 0) ? "ABOVE" : "BELOW"} VWAP <N v={p.vwap_close} />
      </Line>
      <Line k="Value area">
        VAL <N v={p.va?.val} /> · POC <N v={p.va?.poc} /> · VAH <N v={p.va?.vah} />
      </Line>
      <Line k="Pivots">
        S2 <N v={pv?.S2} /> · S1 <N v={pv?.S1} /> · P <N v={pv?.P} /> · R1 <N v={pv?.R1} /> · R2 <N v={pv?.R2} />
        {pv?.cpr_width_pct != null ? (
          <span className="text-dim">
            {" "}
            · CPR <span className="num">{pv.cpr_width_pct}%</span> ({cprWords(pv.cpr_width_pct)})
          </span>
        ) : null}
      </Line>
      {t.swing_res?.length || t.swing_sup?.length ? (
        <Line k="Swing levels">
          resistance <span className="num text-ink">{(t.swing_res ?? []).map((x) => num(x, 0)).join(", ") || "none near"}</span> · support{" "}
          <span className="num text-ink">{(t.swing_sup ?? []).map((x) => num(x, 0)).join(", ") || "none near"}</span> · 20-day range <N v={t.low_20d} />–<N v={t.high_20d} />
        </Line>
      ) : null}
      <Line k="Trendlines">
        {tl.support || tl.resistance
          ? [tl.support ? `rising support ≈ ${num(tl.support.today, 0)} today` : null, tl.resistance ? `falling resistance ≈ ${num(tl.resistance.today, 0)} today` : null]
              .filter(Boolean)
              .join(" · ")
          : "no clean rising-support / falling-resistance line"}
      </Line>
      <ChainLine ix={ix} />
      {ix.plan?.bias ? (
        <Line k="Bias score">
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="num">{ix.plan.bias.score > 0 ? "+" : ""}{ix.plan.bias.score}</span> <BiasChip bias={ix.plan.bias.bias} />
            <span className="text-xs text-dim">{ix.plan.bias.why.join("; ") || "no strong factor"}</span>
          </span>
        </Line>
      ) : null}
      {ix.plan?.expected_open != null ? (
        <Line k="Expected open">
          ≈ <N v={ix.plan.expected_open} /> → {ix.plan.gap_words}
        </Line>
      ) : null}
    </dl>
  );
}

function ChainLine({ ix }: { ix: IndexReport }) {
  const s = ix.chain?.summary;
  if (!s) return <Line k="Option OI">n/a (NSE chain unavailable)</Line>;
  return (
    <Line k="Option OI">
      PCR <span className="num text-ink">{s.pcr ?? "—"}</span> · put wall <N v={s.top_put_oi_strikes?.[0]} /> · call wall <N v={s.top_call_oi_strikes?.[0]} /> · max pain{" "}
      <N v={s.max_pain} /> · ΔOI: {s.oi_signal ?? "n/a"}
    </Line>
  );
}

/** What the session has done so far (11:45 AM report; also the 6 PM wrap). */
export function IntradayRead({ ix }: { ix: IndexReport }) {
  const i = ix.intraday;
  const t = ix.today;
  const p = ix.prev;
  if (!i) return <p className="text-sm text-dim">Today&apos;s intraday data is not available.</p>;
  const diff = i.last - i.vwap;
  const f = ix.futures;
  return (
    <dl className="divide-y divide-line">
      <Line k="Open → now">
        Open <N v={i.open} /> (gap {pct(t?.gap_pct)}) · Now <N v={i.last} d={2} />{" "}
        {p?.close ? <span className={clsx("num", i.last >= p.close ? "text-up" : "text-down")}>({pct(((i.last - p.close) / p.close) * 100)})</span> : null}
      </Line>
      <Line k="Day range">
        High <N v={i.high} /> ({timeIST(i.hod_time)}) · Low <N v={i.low} /> ({timeIST(i.lod_time)})
      </Line>
      <Line k="Opening range">
        15-min <N v={i.or15?.low} />–<N v={i.or15?.high} /> · 30-min <N v={i.or30?.low} />–<N v={i.or30?.high} />
      </Line>
      <Line k="VWAP">
        <N v={i.vwap} /> → price {diff > 0 ? "ABOVE" : "BELOW"} by <span className="num">{num(Math.abs(diff), 0)}</span> pts (<span className="num">{i.ext_vwap_atr}</span>× ATR) ·{" "}
        {i.vwap_behaviour?.label} ({i.vwap_behaviour?.crosses} crosses, {i.vwap_behaviour?.pct_above}% of bars above)
      </Line>
      {f?.vwap ? (
        <Line k="Futures">
          <N v={f.last} d={2} /> · fut VWAP <N v={f.vwap} d={2} /> · OI {compact(f.oi)} ({compact(f.chg_oi)})
        </Line>
      ) : null}
      <Line k="Volume">
        {i.rvol ? `${i.rvol}× normal for this time` : "n/a"} <span className="text-dim">({ix.weight_source})</span>
      </Line>
      <Line k="Structure">
        5-min {i.struct_5m?.label} · 15-min {i.struct_15m?.label}
      </Line>
      <Line k="Breakouts">{i.tests?.length ? testsWords(i.tests) : "none of the opening-range / prior-day levels has been tested"}</Line>
      <ChainLine ix={ix} />
      <Line k="Day type">
        <span className="text-ink">{i.day_type}</span> · {i.extended ? <span className="text-accent">⚠️ EXTENDED — do not chase</span> : "not extended"}
      </Line>
    </dl>
  );
}

/** Evening wrap: where buyers / sellers acted, levels created, the lesson. */
export function EodRead({ ix }: { ix: IndexReport }) {
  const t = ix.today;
  const i = ix.intraday;
  const e = ix.eod;
  if (!t || !i || !e) return <p className="text-sm text-dim">Today&apos;s intraday data unavailable.</p>;
  return (
    <dl className="divide-y divide-line">
      <Line k="Buyers at">
        <span className="num text-up">{e.buyers.map((x) => num(x, 0)).join(", ")}</span> (day low <N v={i.low} /> at {timeIST(i.lod_time)})
      </Line>
      <Line k="Sellers at">
        <span className="num text-down">{e.sellers.map((x) => num(x, 0)).join(", ")}</span> (day high <N v={i.high} /> at {timeIST(i.hod_time)})
      </Line>
      <Line k="VWAP">
        {i.vwap_behaviour?.label} ({i.vwap_behaviour?.crosses} crosses) · closed {t.close > (t.vwap_close ?? 0) ? "ABOVE" : "BELOW"} VWAP <N v={t.vwap_close} />
      </Line>
      <Line k="False breakouts">{testsWords(i.failed ?? [], true) || "none — breakouts that happened held"}</Line>
      <Line k="Levels created">
        high <N v={t.high} /> · low <N v={t.low} /> · VWAP <N v={t.vwap_close} /> · POC <N v={t.va?.poc} /> · VAH <N v={t.va?.vah} /> · VAL <N v={t.va?.val} />
      </Line>
      <Line k="Candle">
        <span className="text-ink">{t.pattern?.name}</span> — {t.pattern?.meaning} (close location <span className="num">{t.clv}</span>)
      </Line>
      <Line k="Structure">
        daily {ix.tech?.structure?.label ?? "n/a"} · 15-min {i.struct_15m?.label} · day type {i.day_type}
      </Line>
      {e.gap_fill ? <Line k="Gap">{e.gap_fill}</Line> : null}
    </dl>
  );
}

/** Midday: the bot's own verdict on the 8:45 plan + what to do now. */
export function MiddayVerdict({ ix }: { ix: IndexReport }) {
  const plan = ix.plan;
  if (!plan || plan.kind !== "midday") return null;
  const m = plan.morning;
  return (
    <div className="space-y-2.5">
      {m?.ok && m.status ? (
        <div>
          <p className="eyebrow mb-1">Morning plan ({m.source ?? "8:45 AM plan"})</p>
          <ul className="space-y-0.5 text-sm text-ink-2">
            {(["bull", "bear"] as const).map((s) => (
              <li key={s}>
                <span className={s === "bull" ? "text-up" : "text-down"}>{s === "bull" ? "Bull" : "Bear"}</span> {statusWords(m[s], m.status?.[s])}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <ActionChip action={plan.action} />
        <span className="text-sm text-ink-2">{plan.action_why}</span>
      </div>
      {ix.intraday?.extended ? (
        <p className="text-xs text-accent">The morning move is already extended — do not chase it; a late entry here has a far stop and a near target.</p>
      ) : null}
    </div>
  );
}

/** One index block for a report: header + the right read for its session. */
export function IndexRead({ snap, ix }: { snap: Snapshot; ix: IndexReport }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold">{ix.label}</span>
        {ix.plan?.bias ? <BiasChip bias={ix.plan.bias.bias} /> : null}
        {ix.chain?.expiry ? (
          <Chip>
            Expiry {new Date(ix.chain.expiry + "T12:00:00+05:30").toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "Asia/Kolkata" })} ·{" "}
            {ix.chain.dte}d
          </Chip>
        ) : null}
      </div>
      {snap.session === "premarket" ? <PrevSessionRead ix={ix} /> : null}
      {snap.session === "midday" ? (
        <>
          <IntradayRead ix={ix} />
          <MiddayVerdict ix={ix} />
        </>
      ) : null}
      {snap.session === "evening" ? <EodRead ix={ix} /> : null}
    </div>
  );
}
