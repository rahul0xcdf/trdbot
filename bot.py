"""
Market Intelligence Bot — orchestrator.

Runs on GitHub Actions. A RUN_TYPE env var (set per cron schedule) selects
which intraday flow to run. Each flow fetches ONLY what it needs so we don't,
say, scrape the option chain at the EOD run.

  RUN_TYPE:
    premarket      → 8:15 AM IST  — gap, VIX, PCR/max pain, stocks to watch
    opening        → 9:30 AM IST  — short, actionable open read
    midmorning     → 11:00 AM IST — trend check + OI
    european_open  → 12:30 PM IST — trend check + OI
    london_us      → 1:30 PM IST  — trend check + OI
    exit_reminder  → 2:45 PM IST  — light: square-off nudge
    eod            → 4:00 PM IST  — FII/DII + OI for tomorrow
    vix_check      → every 30 min — SILENT unless VIX > 18 or |change| > 10%
    listen         → market hours — answers Telegram slash commands
                     (long-polls getUpdates for LISTEN_MINUTES minutes)

Modules do the real work; this file just wires them together.
"""

import os
import sys

from modules import (nse_data, market_data, news, ai_engine, telegram, signals,
                     commands, premarket, config)
from modules.market_data import WATCHLIST_INDIA, WATCHLIST_STOCKS_TO_SCAN

# ── Config ────────────────────────────────────────────────────────────────────

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TELEGRAM_CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]

RUN_TYPE = os.environ.get("RUN_TYPE", "premarket").strip()

VIX_ALERT_LEVEL = 18.0
VIX_ALERT_CHANGE_PCT = 10.0

# ── Strategy Configs ──────────────────────────────────────────────────────────

STRATEGIES = {
    "balanced": {
        "name": "Balanced",
        "min_sentiment_score": 0.55,
        "min_signal_strength": 0.6,
        "risk_per_trade_pct": 2.0,
        "dte_range": [21, 45],
        "watchlist": ["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS",
                      "AAPL", "NVDA", "SPY", "QQQ", "TSLA"],
    },
    "momentum": {
        "name": "Momentum",
        "min_sentiment_score": 0.65,
        "min_signal_strength": 0.7,
        "risk_per_trade_pct": 3.0,
        "dte_range": [14, 30],
        "watchlist": ["RELIANCE.NS", "M&M.NS", "BAJFINANCE.NS",
                      "NVDA", "META", "AMZN", "QQQ"],
    },
    "conservative": {
        "name": "Conservative",
        "min_sentiment_score": 0.75,
        "min_signal_strength": 0.80,
        "risk_per_trade_pct": 1.0,
        "dte_range": [30, 60],
        "watchlist": ["SPY", "TCS.NS", "HDFCBANK.NS"],
    },
    "sentiment_first": {
        "name": "Sentiment-First",
        "min_sentiment_score": 0.80,
        "min_signal_strength": 0.5,
        "risk_per_trade_pct": 2.5,
        "dte_range": [7, 21],
        "watchlist": ["RELIANCE.NS", "ETERNAL.NS", "PAYTM.NS",
                      "TSLA", "NVDA", "COIN", "MSTR"],
    },
    "nifty_intraday": {
        "name": "Nifty Intraday",
        "min_sentiment_score": 0.65,
        "min_signal_strength": 0.70,
        "risk_per_trade_pct": 1.5,
        "dte_range": [0, 7],  # weekly options
        "watchlist": WATCHLIST_INDIA,
    },
}


# ── Shared helpers ────────────────────────────────────────────────────────────

def _adaptive_strategy(nse: dict | None) -> dict:
    """
    Derive strategy params from the live regime instead of a fixed config.

    Reads VIX (volatility regime → signal bar + position size), PCR extremes
    (crowded positioning → demand extra confirmation) and the opening gap.
    The regime description is folded into the strategy name, which flows into
    the AI prompt — so Gemini also sees and reasons with the regime.
    """
    base = dict(STRATEGIES["nifty_intraday"])
    vix = ((nse or {}).get("vix") or {}).get("value")
    pcr = ((nse or {}).get("nifty_chain") or {}).get("pcr")
    gap = ((nse or {}).get("gift_nifty") or {}).get("gap_pct")

    regime = []
    if vix is None:
        regime.append("VIX unavailable, using defaults")
    elif vix >= 20:
        base.update(min_signal_strength=0.80, min_sentiment_score=0.70,
                    risk_per_trade_pct=0.75)
        regime.append(f"high volatility (VIX {vix}) — take only the strongest "
                      "setups, prefer defined-risk spreads over naked buys")
    elif vix >= 15:
        base.update(min_signal_strength=0.75, risk_per_trade_pct=1.0)
        regime.append(f"elevated volatility (VIX {vix}) — premiums rich, be selective")
    else:
        base.update(min_signal_strength=0.65, risk_per_trade_pct=1.5)
        regime.append(f"calm tape (VIX {vix}) — premiums cheap, momentum longs viable")

    if pcr is not None and (pcr >= 1.3 or pcr <= 0.7):
        base["min_signal_strength"] = round(min(base["min_signal_strength"] + 0.05, 0.9), 2)
        regime.append(f"PCR {pcr} at an extreme — positioning crowded, "
                      "demand extra confirmation")

    if gap is not None and abs(gap) >= 0.7:
        regime.append(f"large opening gap ({gap:+.2f}%) — watch for a gap-fade "
                      "trap in the first 30 minutes")

    base["name"] = "Adaptive: " + "; ".join(regime)
    return base


VALID_STRATEGIES = set(STRATEGIES) | {"adaptive"}


def _strategy_name() -> str:
    """Resolved fresh each call so /setstrategy takes effect immediately."""
    name, _ = config.resolve_strategy_name(VALID_STRATEGIES)
    return name


def _strategy(nse: dict | None = None) -> dict:
    name = _strategy_name()
    if name == "adaptive":
        return _adaptive_strategy(nse)
    return STRATEGIES.get(name, STRATEGIES["nifty_intraday"])


def _send(message: str):
    telegram.send_telegram(message, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)


def _collect_headlines() -> list[str]:
    """Indian RSS headlines first, then global — as plain title strings."""
    indian = [h["title"] for h in news.fetch_indian_news()]
    if len(indian) >= 8:
        return indian[:12]
    return (indian + news.fetch_global_news())[:12]


def _persist_signals(conn, analysis: dict, market_data_rows: list[dict]):
    """Log qualifying AI signals to SQLite for later backtesting."""
    price_by_symbol = {d["symbol"]: d["price"] for d in market_data_rows}
    for s in analysis.get("top_signals", []):
        symbol = s.get("symbol")
        entry = price_by_symbol.get(symbol)
        if entry is None:
            continue
        try:
            signals.save_signal(
                conn,
                strategy=_strategy_name(),
                symbol=symbol,
                direction=s.get("direction", "HOLD"),
                strength=s.get("signal_strength"),
                sentiment=s.get("sentiment_score"),
                price_entry=entry,
            )
        except Exception as e:
            print(f"[WARN] _persist_signals {symbol}: {e}")


def _log_snapshot(conn, nse: dict, fii_dii: dict | None = None):
    chain = nse.get("nifty_chain") or {}
    vix = nse.get("vix") or {}
    fii = (fii_dii or nse.get("fii_dii") or {})
    signals.log_nse_snapshot(
        conn,
        timestamp=None,
        pcr=chain.get("pcr"),
        vix=vix.get("value"),
        max_pain=chain.get("max_pain"),
        fii_net=fii.get("fii_net_buy_sell"),
        dii_net=fii.get("dii_net_buy_sell"),
    )


# ── Flows ─────────────────────────────────────────────────────────────────────

def flow_premarket():
    """
    8:15 AM — full AI pre-market pipeline: F&O screener → shortlist deep dive
    (options ΔOI/IV, delivery %, fundamentals) → sector rotation → Gemini
    report with ≥85/100 watchlist. Cached to data/premarket_report.json so
    the command listener can serve /premarket, /watchlist etc. instantly.
    """
    report, nse = premarket.generate(_strategy)

    conn = signals.init_db()
    _log_snapshot(conn, nse)
    for o in ((report.get("call_opportunities") or [])
              + (report.get("put_opportunities") or [])):
        try:
            signals.save_signal(
                conn,
                strategy=_strategy_name(),
                symbol=o.get("symbol"),
                direction="CALL" if o.get("bias") == "bullish" else "PUT",
                strength=(o.get("confidence_score") or 0) / 100.0,
                sentiment=None,
                price_entry=o.get("current_price"),
            )
        except Exception as e:
            print(f"[WARN] flow_premarket persist {o.get('symbol')}: {e}")

    _send(telegram.format_ai_premarket(report))


def flow_opening():
    nse = {
        "vix": nse_data.get_india_vix(),
        "nifty_chain": nse_data.get_nifty_options_chain(),
    }
    strategy = _strategy(nse)
    md = market_data.get_price_data(WATCHLIST_STOCKS_TO_SCAN)
    headlines = _collect_headlines()
    analysis = ai_engine.analyse_with_ai(md, headlines, strategy, nse=nse)
    _send(telegram.format_opening_range(analysis, md, nse))


def flow_midday(label: str):
    nse = {
        "vix": nse_data.get_india_vix(),
        "nifty_chain": nse_data.get_nifty_options_chain(),
    }
    strategy = _strategy(nse)
    md = market_data.get_price_data(WATCHLIST_STOCKS_TO_SCAN)
    headlines = _collect_headlines()
    analysis = ai_engine.analyse_with_ai(md, headlines, strategy, nse=nse)
    _send(telegram.format_midday(analysis, md, nse, label=label))


def flow_exit_reminder():
    """Light run — no OI scrape; just a square-off nudge with a VIX read."""
    nse = {"vix": nse_data.get_india_vix()}
    strategy = _strategy(nse)
    md = market_data.get_price_data(WATCHLIST_STOCKS_TO_SCAN)
    headlines = _collect_headlines()
    analysis = ai_engine.analyse_with_ai(md, headlines, strategy, nse=nse)
    _send(telegram.format_midday(analysis, md, nse, label="Exit Reminder ⏰"))


def flow_eod():
    fii_dii = nse_data.get_fii_dii_data()
    nse = {
        "vix": nse_data.get_india_vix(),
        "nifty_chain": nse_data.get_nifty_options_chain(),  # OI setup for tomorrow
        "fii_dii": fii_dii,
    }
    strategy = _strategy(nse)
    md = market_data.get_price_data(WATCHLIST_STOCKS_TO_SCAN)
    headlines = _collect_headlines()
    analysis = ai_engine.analyse_with_ai(md, headlines, strategy, nse=nse)

    conn = signals.init_db()
    _persist_signals(conn, analysis, md)
    _log_snapshot(conn, nse, fii_dii=fii_dii)

    _send(telegram.format_eod(analysis, md, nse, fii_dii))


def flow_vix_check():
    """Silent unless VIX is elevated. Never sends a message otherwise."""
    vix = nse_data.get_india_vix()
    if not vix or vix.get("value") is None:
        print("[WARN] flow_vix_check: no VIX data — nothing to do")
        return
    value = vix["value"]
    change = vix.get("change_pct") or 0.0
    if value > VIX_ALERT_LEVEL or abs(change) > VIX_ALERT_CHANGE_PCT:
        context = "Elevated VIX — manage risk on open intraday positions."
        _send(telegram.format_vix_alert(value, change, context))
        print(f"[OK] flow_vix_check: alert sent (VIX={value}, {change}%)")
    else:
        print(f"[OK] flow_vix_check: VIX calm ({value}, {change}%) — staying silent")


def flow_listen():
    """Interactive slash-command listener — long-polls Telegram getUpdates."""
    minutes_env = os.environ.get("LISTEN_MINUTES", "").strip()
    if minutes_env:
        minutes = float(minutes_env)  # explicit window (manual dispatch/test)
    else:
        # Scheduled run: listen until just past market close (15:35 IST) so a
        # single successful cron fire covers the whole day even when GitHub
        # skips or delays later fires. Capped under the 6-hour job limit — a
        # queued backup run picks up the tail.
        from datetime import datetime
        from modules.telegram import IST
        now = datetime.now(IST)
        close = now.replace(hour=15, minute=35, second=0, microsecond=0)
        minutes = min((close - now).total_seconds() / 60, 345)
        if minutes <= 1:
            print("[OK] flow_listen: market closed — nothing to listen for")
            return
    commands.listen(
        token=TELEGRAM_BOT_TOKEN,
        chat_id=TELEGRAM_CHAT_ID,
        strategy_resolver=_strategy,
        minutes=minutes,
        valid_strategies=sorted(VALID_STRATEGIES),
        strategy_name_resolver=lambda: config.resolve_strategy_name(VALID_STRATEGIES),
    )


# ── Dispatch ──────────────────────────────────────────────────────────────────

FLOWS = {
    "premarket": flow_premarket,
    "opening": flow_opening,
    "midmorning": lambda: flow_midday("Mid-Morning Check"),
    "european_open": lambda: flow_midday("European Open Check"),
    "london_us": lambda: flow_midday("London/US Check"),
    "exit_reminder": flow_exit_reminder,
    "eod": flow_eod,
    "vix_check": flow_vix_check,
    "listen": flow_listen,
}


def main():
    name, source = config.resolve_strategy_name(VALID_STRATEGIES)
    print(f"\n=== Market Bot — RUN_TYPE={RUN_TYPE} | Strategy={name} (from {source}) ===\n")
    flow = FLOWS.get(RUN_TYPE)
    if flow is None:
        print(f"[ERROR] Unknown RUN_TYPE '{RUN_TYPE}'. Valid: {', '.join(FLOWS)}")
        sys.exit(1)
    flow()
    print("\n=== Done ===\n")


if __name__ == "__main__":
    main()
