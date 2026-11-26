/**
 * Types for the JSON the Python engine publishes (modules/publish.py).
 *
 * Field names are kept exactly as the engine produces them (snake_case) so a
 * value can be traced back to the Python code that made it. Nothing here is
 * computed by the website; every field is optional because every data layer
 * in the engine is best-effort.
 */

export type Session = "premarket" | "afternoon" | "evening" | "ai_premarket";
export const SESSIONS: Session[] = ["evening", "premarket", "afternoon", "ai_premarket"];

/** nse_data.get_index_board() row / market_data.get_sensex() */
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
  date?: string; // sensex only, "dd-Mon-YYYY"
}

/** nse_data.get_gift_nifty() */
export interface GiftNifty {
  last: number;
  change: number | null;
  change_pct: number | null;
  as_of: string | null; // "26-Nov-2026 08:10"
  expiry: string | null;
}

/** market_data.get_gift_nifty() — used by the /premarket pipeline */
export interface GiftNiftyProxy {
  proxy_symbol: string;
  value: number;
  prev_close: number | null;
  gap_pct: number | null;
}

/** nse_data._compact_rows() */
export interface StrikeRow {
  strike: number;
  ce_oi: number | null;
  ce_chg_oi: number | null;
  ce_volume: number | null;
  ce_iv: number | null;
  ce_ltp: number | null;
  pe_oi: number | null;
  pe_chg_oi: number | null;
  pe_volume: number | null;
  pe_iv: number | null;
  pe_ltp: number | null;
}

/** nse_data._summarise_chain() + symbol/expiry + strikes */
export interface OptionChain {
  symbol: string;
  expiry: string;
  spot: number;
  pcr: number | null;
  max_pain: number | null;
  atm_strike: number;
  atm_iv: number | null;
  total_call_oi: number;
  total_put_oi: number;
  change_call_oi: number;
  change_put_oi: number;
  oi_signal: string;
  top_call_oi_strikes: number[];
  top_put_oi_strikes: number[];
  strikes?: StrikeRow[];
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
  ltp: number | null;
  change_pct: number;
}
export interface Movers {
  gainers: Mover[];
  losers: Mover[];
}

export interface CorpEvent {
  date: string; // "dd-Mon-YYYY"
  symbol: string;
  indices: string[];
  what: string;
}

export interface Holiday {
  date: string;
  day: string;
  name: string;
}

/** news.fetch_indian_news() */
export interface NewsItem {
  title: string;
  source: string;
  published: string | null; // ISO, UTC
  link?: string | null;
}

/** reports._labels() — the rule-based reads printed in the Telegram report */
export interface EngineLabels {
  nifty_pcr?: string;
  banknifty_pcr?: string;
  pcr_mix?: string;
  opening_hint?: string;
}

/** screener / indicators.compute_snapshot() for a shortlisted stock */
export interface Candidate {
  symbol: string;
  side?: "bulls" | "bears";
  price?: number;
  change_pct?: number;
  rsi?: number | null;
  macd_state?: string;
  macd_hist?: number | null;
  ema20?: number | null;
  ema50?: number | null;
  ema200?: number | null;
  adx?: number | null;
  atr_pct?: number | null;
  supertrend?: string;
  rvol?: number | null;
  bb_pctb?: number | null;
  structure?: string;
  supports?: number[];
  resistances?: number[];
  delivery_pct?: number | null;
  bull_score?: number;
  bear_score?: number;
  drivers?: string[];
  [k: string]: unknown;
}

export interface SnapshotData {
  indices?: Record<string, IndexRow>; // "NIFTY 50" | "NIFTY BANK" | "INDIA VIX" | "SENSEX"
  gift_nifty?: GiftNifty;
  gift_nifty_proxy?: GiftNiftyProxy;
  vix?: { value: number | null; change_pct: number | null };
  option_chains?: Partial<Record<"NIFTY" | "BANKNIFTY", OptionChain>>;
  fii_dii?: FiiDii;
  sectors?: Sector[];
  sector_momentum?: { building: Sector[]; fading: Sector[] };
  movers?: Partial<Record<"NIFTY" | "BANKNIFTY", Movers>>;
  events_today?: CorpEvent[];
  events?: { results: CorpEvent[]; actions: CorpEvent[] };
  expiries?: Partial<Record<"NIFTY" | "BANKNIFTY", string[]>>;
  holidays?: Holiday[];
  news?: NewsItem[];
  labels?: EngineLabels;
  breadth?: { universe: string; total: number; advances: number; declines: number };
  candidates?: Record<string, Candidate>;
}

/** ai_engine.brief_bullets() wrapped by reports.py */
export interface BriefAnalysis {
  kind: "brief";
  title: string | null;
  bullets: string[] | null;
}

/** ai_engine._RECOMMENDATION_SCHEMA */
export interface Opportunity {
  symbol: string;
  current_price?: number;
  bias?: "bullish" | "bearish";
  confidence_score?: number;
  score_breakdown?: Record<string, string | number>;
  technical_summary?: string;
  fundamental_summary?: string;
  news_summary?: string;
  entry_zone?: string;
  stop_loss?: number;
  target_1?: number;
  target_2?: number;
  risk_reward?: string;
  option_type?: "CALL" | "PUT";
  suggested_strike?: string;
  suggested_expiry?: string;
  scalping_suitability?: string;
  expected_holding_time?: string;
  key_risks?: string[];
  why_selected?: string;
}

/** ai_engine.premarket_report() output (+ fields premarket.generate adds) */
export interface AiPremarketAnalysis {
  kind: "ai_premarket";
  market_outlook?: {
    sentiment?: string;
    recommendation?: "GO" | "CAUTION" | "WARNING" | "STAY_OUT" | string;
    confidence?: number;
    bullish_prob?: number;
    bearish_prob?: number;
    rangebound_prob?: number;
    why?: string;
  };
  overnight_summary?: string;
  domestic_summary?: string;
  sector_outlook?: { bullish_sectors?: string[]; bearish_sectors?: string[]; comment?: string };
  nifty_levels?: { supports?: number[]; resistances?: number[] };
  banknifty_levels?: { supports?: number[]; resistances?: number[] };
  call_opportunities?: Opportunity[];
  put_opportunities?: Opportunity[];
  alerts?: string[];
  risk_assessment?: string[];
  trading_plan?: { style?: string; why?: string };
  no_trade?: boolean;
  no_trade_reason?: string;
  generated_date?: string;
  generated_at?: string;
  strategy_name?: string;
}

export type Analysis = BriefAnalysis | AiPremarketAnalysis;

export interface Snapshot {
  id: string;
  schema_version: number;
  session: Session;
  generated_at: string; // ISO with +05:30
  trade_date: string | null; // YYYY-MM-DD of the session the market data belongs to
  market_status: string | null;
  source?: { engine?: string; ai_model?: string; commit?: string; run_url?: string; trigger?: string; backfill?: string };
  data: SnapshotData;
  analysis: Analysis | null;
  telegram_html?: string | null;
  received_at?: string;
  demo?: boolean;
}

export interface SnapshotMeta {
  id: string;
  session: Session;
  generated_at: string;
  trade_date: string | null;
  bias: string | null; // ai_premarket market_outlook.sentiment only
  nifty: number | null;
  support: number | null; // top put-OI strike (engine-labelled support)
  resistance: number | null; // top call-OI strike (engine-labelled resistance)
  setups: number;
  symbols: string[];
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
