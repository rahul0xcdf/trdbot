"""
Market Intelligence Bot — orchestrator.

Runs on GitHub Actions. A RUN_TYPE env var selects which report to send.
Three NIFTY 50 / BANK NIFTY trading reports a day, Mon–Fri (modules/reports.py):

  RUN_TYPE:
    premarket  → 8:45 AM IST — global & Indian factors, previous-session
                 levels, Scenario A/B/C with exact triggers, option choice,
                 final trade-plan table + TRADE DECISION. On the first trading
                 day of a month it also sends the monthly event calendar.
    midday     → 11:45 AM IST — the morning's actual price action, what the
                 morning plan did, after-12 scenarios, HOLD/BOOK/EXIT/WAIT
                 ("afternoon" is accepted as an old alias)
    evening    → 6:00 PM IST — full daily wrap, tomorrow's levels & plans,
                 one trading lesson, upcoming dates
    monthly    → manual — the month's volatility event calendar
    listen     → manual only — answers Telegram slash commands
                 (long-polls getUpdates for LISTEN_MINUTES minutes)

Modules do the real work; this file just wires them together.
"""

import os
import sys

from modules import nse_data, telegram, signals, commands, config, reports, publish
from modules.market_data import WATCHLIST_INDIA

# ── Config ────────────────────────────────────────────────────────────────────

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TELEGRAM_CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]  # owner: reports + alerts

# Friends who also get the three reports (comma-separated chat IDs, or a
# channel like @mychannel). They never get skip/failure alerts.
SHARE_CHAT_IDS = [c.strip() for c in
                  os.environ.get("TELEGRAM_SHARE_CHAT_IDS", "").split(",") if c.strip()]

RUN_TYPE = os.environ.get("RUN_TYPE", "premarket").strip()
if RUN_TYPE == "afternoon":  # renamed; old timer hops may still send it
    RUN_TYPE = "midday"

# "chain" = started by the timer chain (chain.py). Those runs get the
# weekend / holiday / time-window checks, wait for SEND_AT (the exact target
# minute, epoch seconds) before sending, and book the next report after.
TRIGGER = os.environ.get("TRIGGER", "").strip().lower()
SEND_AT = int(os.environ.get("SEND_AT", "").strip() or 0)

# DRY_RUN=1 prints the report instead of sending it (local testing).
DRY_RUN = os.environ.get("DRY_RUN", "").strip() == "1"

# AUDIENCE=owner sends reports only to TELEGRAM_CHAT_ID (test runs).
OWNER_ONLY = os.environ.get("AUDIENCE", "").strip().lower() == "owner"

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


def _send(message: str, share: bool = True):
    """Send to the owner, and to every shared chat unless share=False."""
    recipients = [TELEGRAM_CHAT_ID] + (SHARE_CHAT_IDS if share and not OWNER_ONLY else [])
    if share and SEND_AT:
        import time
        early = SEND_AT - time.time()
        if 0 < early <= 600:  # built ahead of time — hold for the exact minute
            print(f"[OK] _send: report ready, waiting {early:.0f}s for the target minute")
            time.sleep(early)
    if DRY_RUN:
        print(f"\n----- DRY RUN: not sent (would go to {len(recipients)} chat(s)) -----\n"
              + message + "\n" + "-" * 38)
        return
    for chat_id in dict.fromkeys(recipients):  # de-dupe, keep order
        # send_telegram logs and swallows errors, so one friend who hasn't
        # pressed Start (Telegram 403) never blocks anyone else.
        telegram.send_telegram(message, TELEGRAM_BOT_TOKEN, chat_id)


def _log_snapshot(data: dict):
    """Keep a daily PCR / VIX / max pain / FII-DII history in data/signals.db."""
    chain = data.get("nifty_chain") or {}
    vix = data.get("vix") or {}
    fii = data.get("fii_dii") or {}
    try:
        signals.log_nse_snapshot(
            signals.init_db(),
            timestamp=None,
            pcr=chain.get("pcr"),
            vix=vix.get("last"),
            max_pain=chain.get("max_pain"),
            fii_net=fii.get("fii_net_buy_sell"),
            dii_net=fii.get("dii_net_buy_sell"),
        )
    except Exception as e:
        print(f"[WARN] _log_snapshot: {e}")


# ── Flows ─────────────────────────────────────────────────────────────────────

def _first_trading_day_of_month() -> bool:
    from modules import calendar_events
    today = nse_data._today_ist()
    holidays = {d for h in nse_data.get_trading_holidays() if (d := nse_data._parse_date(h["date"]))}
    return calendar_events.is_first_trading_day(today, holidays)


def flow_premarket():
    """8:45 AM — pre-market trade plan (+ the monthly calendar on day 1)."""
    message, data = reports.build_premarket()
    _send(message)
    publish.publish_report("premarket", message, data)
    try:
        if _first_trading_day_of_month():
            flow_monthly()
    except Exception as e:  # the calendar must never cost us the morning plan
        print(f"[WARN] monthly calendar skipped: {e}")


def flow_midday():
    """11:45 AM — reassess with the morning's real price action."""
    message, data = reports.build_midday()
    _send(message)
    publish.publish_report("midday", message, data)


def flow_monthly():
    """Monthly volatility event calendar."""
    message, data = reports.build_monthly()
    _send(message)
    publish.publish_report("monthly", message, data)


def flow_evening():
    """6:00 PM — full daily wrap + tomorrow's plan."""
    message, data = reports.build_evening()
    _send(message)
    publish.publish_report("evening", message, data)
    if not DRY_RUN:
        _log_snapshot(data)


def flow_listen():
    """Interactive slash-command listener — long-polls Telegram getUpdates."""
    minutes = float(os.environ.get("LISTEN_MINUTES", "").strip() or 15)
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
    "midday": flow_midday,
    "evening": flow_evening,
    "monthly": flow_monthly,
    "listen": flow_listen,
}


# ── Late-run guard ────────────────────────────────────────────────────────────
#
# Reports are started on the minute by the timer chain (chain.py), because
# GitHub's own cron fired this bot 2.5–7 HOURS late (2 Sep 2026: "premarket"
# at 12:44 PM, "eod" at 8:04 PM).
# As a safety net, chain runs still only send inside their IST window,
# Mon–Fri, on NSE trading days — nothing ever goes out before 7 AM or after
# 7 PM. Manual "Run workflow" clicks and local runs are never blocked.

FLOW_WINDOWS = {  # RUN_TYPE: (earliest, latest) as (hour, minute) IST
    "premarket": ((7, 0), (9, 15)),     # must land before the 9:15 open
    "midday":    ((11, 15), (13, 30)),  # mid-session, while it's still useful
    "evening":   ((17, 30), (19, 0)),
}


def _late_run_reason(run_type: str, now) -> str | None:
    """Why a scheduled run at `now` (IST) should be skipped, or None to run."""
    window = FLOW_WINDOWS.get(run_type)
    if window is None:
        return None  # listen etc. — not time-boxed here
    if now.weekday() >= 5:
        return "weekend"
    (h1, m1), (h2, m2) = window
    start = now.replace(hour=h1, minute=m1, second=0, microsecond=0)
    end = now.replace(hour=h2, minute=m2, second=0, microsecond=0)
    if now < start:
        return f"too early (window opens {start:%I:%M %p} IST)"
    if now > end:
        return f"too late (window closed {end:%I:%M %p} IST)"
    return None


def _skip_if_outside_window() -> bool:
    """True if this scheduled run is outside its window and should exit."""
    scheduled = os.environ.get("GITHUB_EVENT_NAME") == "schedule" or TRIGGER == "chain"
    if not scheduled:
        return False  # manual "Run workflow" / local run — always allowed
    from datetime import datetime
    from modules.telegram import IST
    now = datetime.now(IST)
    reason = _late_run_reason(RUN_TYPE, now)
    if reason is None and RUN_TYPE in FLOW_WINDOWS:
        holiday = nse_data.is_trading_holiday(now.date())
        if holiday:
            print(f"[SKIP] {RUN_TYPE}: NSE holiday today ({holiday}).")
            return True
    if reason is None:
        return False
    print(f"[SKIP] {RUN_TYPE} started {now:%I:%M %p} IST — {reason}. "
          "Not sending anything.")
    # Tell the owner (not friends) a report is missing instead of staying
    # silent — but only between 7 AM and 7 PM.
    if reason != "weekend" and 7 <= now.hour < 19:
        try:
            _send(f"⚠️ {RUN_TYPE.title()} report skipped: the job started at "
                  f"{now:%I:%M %p} IST, which is {reason}.", share=False)
        except Exception as e:
            print(f"[WARN] skip notice not sent: {e}")
    return True


def main():
    name, source = config.resolve_strategy_name(VALID_STRATEGIES)
    print(f"\n=== Market Bot — RUN_TYPE={RUN_TYPE} | Strategy={name} (from {source}) ===\n")
    flow = FLOWS.get(RUN_TYPE)
    if flow is None:
        print(f"[ERROR] Unknown RUN_TYPE '{RUN_TYPE}'. Valid: {', '.join(FLOWS)}")
        sys.exit(1)
    failed = True
    try:
        if not _skip_if_outside_window():
            flow()
        failed = False
    finally:
        # Book the next report even if this one failed or was skipped, so
        # one bad run never breaks the chain (the failure step still alerts).
        if TRIGGER == "chain" and not DRY_RUN:
            import chain
            from datetime import datetime
            from modules.telegram import IST
            try:
                chain.continue_after(datetime.fromtimestamp(SEND_AT, IST) if SEND_AT
                                     else datetime.now(IST))
            except Exception as e:
                print(f"[ERROR] chain: could not book the next report: {e}")
                if not failed:
                    raise  # fail the job so you get the Telegram alert
    print("\n=== Done ===\n")


if __name__ == "__main__":
    main()
