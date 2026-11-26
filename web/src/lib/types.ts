/**
 * Types for the JSON the Python engine publishes (modules/publish.py,
 * schema_version 2 — the rules-based NIFTY / BANK NIFTY trade-plan engine).
 *
 * Field names are kept exactly as the engine produces them (snake_case) so a
 * value can be traced back to the Python code that made it (planner.py,
 * levels.py, options.py, reports.py). Nothing here is computed by the
 * website; most fields are optional because every engine data source is
 * best-effort ("n/a" in Telegram).
 */

export type Session = "premarket" | "midday" | "evening" | "monthly";
export const SESSIONS: Session[] = ["evening", "premarket", "midday", "monthly"];
export type IndexKey = "NIFTY" | "BANKNIFTY";
export const INDEX_KEYS: IndexKey[] = ["NIFTY", "BANKNIFTY"];
export type Side = "bull" | "bear";

/** nse_data.get_index_board() row */
export interface IndexRow {
  last: number | null;
  change?: number | null;
  change_pct?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  prev_close?: number | null;
  advances?: number;
  declines?: number;
  week_pct?: number | null;
}

/** nse_data.get_gift_nifty() */
export interface GiftNifty {
  last: number;
  change: number | null;
  change_pct: number | null;
  as_of: string | null; // "26-Nov-2026 08:10"
  expiry?: string | null;
}

/** market_data.get_global_cues() */
export interface Cue {
  label: string;
  symbol: string;
  group: "US" | "Asia" | "Macro" | string;
  last: number;
  change_pct: number | null;
  as_of: string | null;
}

/** nse_data.get_fii_dii_data() */
export interface FiiDii {
  fii_net_buy_sell: number | null;
  dii_net_buy_sell: number | null;
  date: string | null;
}

/** nse_data.get_sector_indices() */
export interface Sector {
  sector: string;
  last: number;
  change_pct: number;
  week_pct?: number | null;
}

export interface Mover {
  symbol: string;
  ltp?: number | null;
  change_pct: number;
}
export interface Movers {
  gainers: Mover[];
  losers: Mover[];
}

/** nse_data.get_upcoming_events() item */
export interface CorpEvent {
  date: string; // "dd-Mon-YYYY"
  symbol: string;
  indices?: string[];
  what: string;
}

export interface Holiday {
  date: string;
  day?: string;
  name: string;
}

/** news.fetch_indian_news() */
export interface NewsItem {
  title: string;
  source: string;
  published: string | null; // ISO
  link?: string | null;
}

/** calendar_events.month_calendar() item */
export interface CalEvent {
  date: string; // YYYY-MM-DD
  event: string;
  time: string | null;
  impact: "HIGH" | "MEDIUM" | "LOW";
  market: string;
  why: string;
  caution: string;
  est: boolean; // estimated date / secondary source → "(verify)"
  source: string | null;
  type: string;
}

/* ── Per-index engine read (planner.snapshot) ──────────────────────────── */

/** planner._session_summary() — one session's OHLC + derived references */
export interface SessionSummary {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  vwap_close: number | null;
  va: { poc: number | null; vah: number | null; val: number | null };
  pivots_next: { P: number; TC?: number; BC?: number; R1: number; S1: number; R2: number; S2: number; cpr_width_pct?: number | null };
  clv: number | null; // close location 0..1
  pattern: { name: string; meaning: string };
  gap_pct: number | null;
  vs_prior: string | null;
}

export interface Structure {
  label: string;
  trend: number;
  last_high?: number | null;
  last_low?: number | null;
  prev_high?: number | null;
  prev_low?: number | null;
}

export interface Trendline {
  today: number;
  next: number;
  from: [string, number];
  to: [string, number];
  slope_per_day: number;
}

/** planner._daily_tech() */
export interface DailyTech {
  ema20?: number;
  ema50?: number;
  ema_words?: string;
  ema_score?: number;
  rsi?: number;
  atr?: number;
  structure?: Structure;
  swing_sup?: number[];
  swing_res?: number[];
  high_20d?: number;
  low_20d?: number;
  high_52w?: number;
  trendlines?: { support?: Trendline; resistance?: Trendline };
}

/** levels.level_tests() event */
export interface LevelTest {
  level: string;
  price: number;
  direction: "up" | "down";
  time: string;
  failed: boolean;
  extreme?: number;
}

export interface OpeningRange {
  high: number | null;
  low: number | null;
  complete: boolean;
}

/** planner._intraday() */
export interface Intraday {
  open: number;
  last: number;
  high: number;
  low: number;
  hod_time: string;
  lod_time: string;
  or15: OpeningRange;
  or30: OpeningRange;
  vwap: number;
  above_vwap: boolean;
  vwap_behaviour: { crosses: number | null; pct_above: number | null; label: string; holds?: number };
  struct_5m: Structure;
  struct_15m: Structure;
  tests: LevelTest[];
  failed: LevelTest[];
  day_type: string;
  extended: boolean;
  ext_vwap_atr: number | null;
  range_atr: number | null;
  atr: number;
  rvol: number | null;
  va: { poc: number | null; vah: number | null; val: number | null };
}

/** nse_data.get_index_futures() */
export interface Futures {
  expiry: string | null;
  last: number | null;
  vwap: number | null;
  oi: number | null;
  chg_oi: number | null;
  volume: number | null;
  underlying: number | null;
}

/** publish._strikes(): chain row near spot */
export interface StrikeRow {
  strike: number;
  ce_oi: number | null;
  ce_chg_oi: number | null;
  ce_volume: number | null;
  ce_iv: number | null;
  ce_ltp: number | null;
  ce_bid?: number | null;
  ce_ask?: number | null;
  pe_oi: number | null;
  pe_chg_oi: number | null;
  pe_volume: number | null;
  pe_iv: number | null;
  pe_ltp: number | null;
  pe_bid?: number | null;
  pe_ask?: number | null;
}

/** nse_data._summarise_chain() */
export interface ChainSummary {
  spot?: number;
  pcr: number | null;
  max_pain: number | null;
  atm_strike?: number;
  atm_iv?: number | null;
  total_call_oi?: number;
  total_put_oi?: number;
  change_call_oi?: number;
  change_put_oi?: number;
  oi_signal?: string;
  top_call_oi_strikes?: number[];
  top_put_oi_strikes?: number[];
}

/** reports._chain_for() → publish._chain() */
export interface IndexChain {
  symbol?: string | null;
  expiry: string | null; // the expiry the plan trades
  dte?: number | null;
  expiry_note?: string | null;
  summary_expiry?: string | null; // nearest expiry, used for PCR / OI walls
  spot: number | null;
  summary: ChainSummary | null;
  expiries?: string[];
  strikes?: StrikeRow[];
}

/* ── Plan: zones, scenarios, options (planner.build_scenarios etc.) ────── */

export interface Zone {
  price: number;
  names: string[];
}

/** options.compare_strikes() candidate */
export interface OptionCand {
  label: "ATM" | "1 ITM" | "2 ITM" | string;
  strike: number;
  kind: "CE" | "PE";
  ltp: number | null;
  iv: number;
  iv_source: string;
  delta_now: number;
  delta_at_trigger: number;
  theta_day: number;
  premium_at_trigger: number;
  oi: number | null;
  chg_oi: number | null;
  volume: number | null;
  liq: { spread_pct: number | null; oi_share: number; ok: boolean; words: string };
}

/** planner.attach_option() pick */
export interface OptionPick extends OptionCand {
  expiry: string;
  dte: number | null;
  expiry_note: string | null;
  premiums: { entry: number; stop: number; t1: number; t2: number; risk_pts: number };
  size: PositionSize;
  lot: number;
  name: string; // "NIFTY 26300 CE 01 Dec"
}

/** options.size_position() */
export interface PositionSize {
  lots: number;
  risk_per_lot: number;
  budget: number;
  capital_for_1_lot: number;
  risk_total: number;
}

/** One directional scenario (planner._side / pullback_variant + _texts + attach_option) */
export interface Scenario {
  side: Side;
  how?: "breakout" | "pullback";
  trigger_zone?: Zone;
  entry?: number | null;
  stop?: number | null;
  t1?: number | null;
  t2?: number | null;
  risk_pts?: number;
  rr1?: number;
  rr2?: number;
  target_note?: string;
  cleared?: number[];
  valid?: boolean;
  rr_ok?: boolean;
  reason?: string | null;
  confirm?: string;
  invalidation?: string;
  exit_rule?: string;
  option?: OptionPick | null;
  option_cands?: OptionCand[];
  option_note?: string;
  sizing_ok?: boolean;
}

/** planner.evaluate_plan() — what today's bars did to the 8:45 plan */
export interface PlanStatus {
  status:
    | "n/a"
    | "not triggered"
    | "triggered, no retest"
    | "open"
    | "T1 hit"
    | "T1 hit, rest stopped at entry"
    | "T2 hit"
    | "stopped out"
    | string;
  trigger_time?: string;
  fill_time?: string;
  exit_time?: string;
  t1_time?: string | null;
  t2_time?: string;
  last?: number;
  away_pts?: number;
  gapped?: boolean;
  pnl_pts?: number;
}

/** planner.score_bias() */
export interface Bias {
  score: number;
  bias: "Bullish" | "Bearish" | "Neutral" | string;
  why: string[];
}

export interface Plan {
  kind: "premarket" | "midday" | "tomorrow";
  ok: boolean;
  reason?: string | null;
  bias?: Bias | null;
  expected_open?: number | null;
  gap_pct?: number | null;
  gap_words?: string | null;
  atr?: number | null;
  ref?: number | null;
  sl_buf?: number | null;
  zones?: Zone[];
  no_trade?: { low: number | null; high: number | null };
  bull?: Scenario;
  bear?: Scenario;
  // midday only
  action?: string;
  action_why?: string;
  late?: boolean;
  morning?: {
    source?: string | null;
    ok: boolean;
    bull?: Partial<Scenario>;
    bear?: Partial<Scenario>;
    status?: Partial<Record<Side, PlanStatus>>;
  } | null;
}

/** planner.eod_analysis() (minus tomorrow's plan, which is in `plan`) */
export interface EodRead {
  buyers: number[];
  sellers: number[];
  gap_fill: string | null;
  lesson: { title: string; text: string } | null;
}

export interface IndexReport {
  key: IndexKey;
  label: string;
  mode: "pre" | "live" | "eod";
  lot?: number;
  step?: number;
  expiry_kind?: string;
  yahoo?: string;
  weight_source?: string;
  prev: SessionSummary | null;
  today: SessionSummary | null;
  tech: DailyTech | null;
  intraday: Intraday | null;
  futures: Futures | null;
  chain: IndexChain | null;
  plan: Plan | null;
  eod: EodRead | null;
}

export interface SetupRef {
  index: IndexKey;
  side: Side;
  rank: number;
  name: string | null;
}

/** planner.decide() — the TRADE DECISION block */
export interface Decision {
  market_bias: string;
  conflict: boolean;
  confidence: "High" | "Medium" | "Low" | string;
  action: string;
  reason: string | null;
  biases?: Partial<Record<IndexKey, string>>;
  best: SetupRef | null;
  secondary: SetupRef | null;
  size_blocked: { index: IndexKey; side: Side; size: PositionSize }[];
}

export interface SnapshotData {
  board?: Record<string, IndexRow>; // "NIFTY 50" | "NIFTY BANK" | "INDIA VIX"
  board_date?: string | null;
  board_status?: string | null;
  vix?: IndexRow | null;
  fii_dii?: FiiDii | null;
  sectors?: Sector[] | null;
  gift_nifty?: GiftNifty | null;
  global?: Cue[] | null;
  news?: NewsItem[] | null;
  events_today?: CalEvent[] | null;
  movers?: Partial<Record<IndexKey, Movers>> | null;
  sector_momentum?: { building: Sector[]; fading: Sector[] } | null;
  upcoming?: { results: CorpEvent[]; actions: CorpEvent[] } | null;
  upcoming_days?: number | null;
  expiries?: Partial<Record<IndexKey, string[]>> | null;
  holidays?: Holiday[] | null;
  calendar?: CalEvent[] | null; // monthly
  month?: string | null; // monthly, "YYYY-MM"
}

export interface Snapshot {
  id: string;
  schema_version: number;
  session: Session;
  generated_at: string; // ISO with +05:30
  trade_date: string | null; // the session the market data belongs to
  plan_for: string | null; // the session the plan is for (evening → next trading day)
  market_status: string | null;
  source?: { engine?: string; ai_model?: string | null; commit?: string | null; run_url?: string | null; trigger?: string | null };
  data: SnapshotData;
  indices: Partial<Record<IndexKey, IndexReport>>;
  decision: Decision | null;
  account?: { risk_pct?: number; capital_is_default?: boolean; costs_per_lot?: number } | null;
  ai?: Record<string, string> | null;
  note?: string | null;
  telegram_html?: string | null;
  received_at?: string;
  demo?: boolean;
}

export interface SnapshotMeta {
  id: string;
  session: Session;
  generated_at: string;
  trade_date: string | null;
  plan_for: string | null;
  bias: string | null; // decision.market_bias
  action: string | null; // decision.action
  best: string | null; // decision.best.name
  nifty: number | null;
  setups: number; // scenarios that passed every engine filter
  demo?: boolean;
}

/** nse_snapshots table (signals.db) — PCR / VIX / max pain / FII-DII history */
export interface MetricRow {
  ts: string;
  pcr: number | null;
  vix: number | null;
  max_pain: number | null;
  fii_net: number | null;
  dii_net: number | null;
  source?: string;
}

export interface TerminalState {
  server_time: string;
  version: string; // changes whenever a new snapshot lands
  demo: boolean;
  storage: { kind: "postgres" | "file" | "memory" | "demo"; ok: boolean; note?: string };
  latest: Partial<Record<Session, Snapshot>>;
  timeline: SnapshotMeta[];
  metrics: MetricRow[];
}

/* ── Raw market data fetched by the website (Yahoo Finance) ─────────────── */

export interface Quote {
  symbol: string;
  name: string;
  price: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  time: string | null; // ISO
  market_state?: string;
  currency?: string | null;
  spark: number[];
  source: string;
  demo?: boolean;
  error?: string;
}

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleSeries {
  symbol: string;
  interval: string;
  range: string;
  candles: Candle[];
  updated: string | null;
  source: string;
  demo?: boolean;
  error?: string;
}
