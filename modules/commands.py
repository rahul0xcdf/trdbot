"""
Telegram slash-command handling.

The bot is push-only on a cron, so commands need a listener: `listen()`
long-polls getUpdates for a fixed window (run from GitHub Actions during
market hours via RUN_TYPE=listen) and answers slash commands as they arrive.

Security: only messages from TELEGRAM_CHAT_ID are handled — anything else is
ignored silently. Commands older than an hour (sent while no listener was up)
are not executed — instead the listener sends ONE summary listing what it
missed, so a weekend backlog never replays on Monday but the user still
learns the bot was offline.
"""

import html
import json
import time

import requests

from modules import nse_data, market_data, news, ai_engine, premarket, screener, config
from modules import telegram as tg

POLL_TIMEOUT = 50  # Telegram long-poll seconds per getUpdates call
STALE_AFTER = 3600  # ignore commands older than this (listener was down)

# Shown in Telegram's "/" autocomplete menu (registered via setMyCommands).
COMMANDS = [
    ("help", "List all commands"),
    ("premarket", "Full AI pre-market report (cached or fresh)"),
    ("watchlist", "Top call & put opportunities (≥85/100 only)"),
    ("market", "Overall market bias + confidence + plan"),
    ("sectors", "Sector strength rankings (live)"),
    ("alerts", "Today's events, risks and warnings"),
    ("stock", "Deep AI analysis: /stock RELIANCE (~1 min)"),
    ("price", "Quote + technicals: /price RELIANCE or /price NIFTY"),
    ("oi", "Option chain OI summary: /oi or /oi RELIANCE"),
    ("vix", "India VIX + what it means for premiums"),
    ("fii", "Latest FII/DII net flows"),
    ("news", "Top Indian market headlines"),
    ("analyze", "Full AI analysis on demand (takes ~1 min)"),
    ("strategy", "Show the currently active strategy params"),
    ("setstrategy", "Switch strategy: /setstrategy adaptive"),
    ("stats", "Signal win-rate stats from the local DB"),
    ("ping", "Check the listener is alive"),
]


def _api(token: str, method: str) -> str:
    return f"https://api.telegram.org/bot{token}/{method}"


def _reply(ctx: dict, text: str):
    tg.send_telegram(text, ctx["token"], ctx["chat_id"])


def _resolve_symbol(raw: str) -> str:
    """Map user input to a yfinance symbol: NIFTY → ^NSEI, RELIANCE → RELIANCE.NS."""
    s = raw.strip().upper()
    aliases = {"NIFTY": "^NSEI", "BANKNIFTY": "^NSEBANK", "SENSEX": "^BSESN"}
    if s in aliases:
        return aliases[s]
    if s.startswith("^") or "." in s:
        return s
    return f"{s}.NS"


# ── Handlers (each takes (args, ctx) and returns the reply text) ─────────────

def _cmd_help(args, ctx) -> str:
    lines = ["<b>🤖 Commands</b>", ""]
    lines += [f"/{c} — {d}" for c, d in COMMANDS]
    lines.append("")
    lines.append("<i>I answer during market hours while the listener job is up.</i>")
    return "\n".join(lines)


def _cmd_ping(args, ctx) -> str:
    return "🏓 Alive and listening."


def _cmd_price(args, ctx) -> str:
    if not args:
        return "Usage: <code>/price RELIANCE</code> or <code>/price NIFTY</code>"
    symbol = _resolve_symbol(args[0])
    rows = market_data.get_price_data([symbol])
    if not rows:
        return f"Couldn't fetch data for <b>{html.escape(symbol)}</b> — check the symbol."
    d = rows[0]
    vwap = d.get("above_vwap")
    vwap_txt = "✅ above" if vwap else ("❌ below" if vwap is not None else "—")
    return "\n".join([
        f"📈 <b>{html.escape(d['symbol'])}</b>",
        f"Price: <b>{d['price']}</b>  ({d['change_pct']:+.2f}%)",
        f"5d momentum: {d['momentum_5d']:+.2f}%  |  Vol spike: {d['volume_spike']}x",
        f"VWAP: {vwap_txt}",
        f"52w range: {d.get('low_52w', '—')} – {d.get('high_52w', '—')}",
        "",
        "<i>⚠️ Yahoo NSE quotes are ~15 min delayed.</i>",
    ])


def _cmd_oi(args, ctx) -> str:
    symbol = (args[0].strip().upper() if args else "NIFTY")
    if symbol in ("NIFTY", "^NSEI"):
        chain = nse_data.get_nifty_options_chain()
        label = "NIFTY"
    else:
        chain = nse_data.get_stock_options_oi(symbol)
        label = symbol
    if not chain:
        return f"Couldn't fetch the option chain for <b>{html.escape(label)}</b> right now."
    return "\n".join([
        f"🔗 <b>{html.escape(label)} option chain</b> (nearest expiry)",
        f"Spot: <b>{chain.get('spot')}</b>  |  ATM: {chain.get('atm_strike')}",
        f"PCR: <b>{chain.get('pcr')}</b>  |  Max pain: <b>{chain.get('max_pain')}</b>",
        f"Resistance (CALL OI): {chain.get('top_call_oi_strikes')}",
        f"Support (PUT OI): {chain.get('top_put_oi_strikes')}",
    ])


def _cmd_vix(args, ctx) -> str:
    vix = nse_data.get_india_vix()
    if not vix or vix.get("value") is None:
        return "Couldn't fetch India VIX right now."
    v = vix["value"]
    if v < 13:
        read = "Calm — premiums cheap; option buying is viable but moves may be small."
    elif v < 17:
        read = "Normal — no premium edge either way."
    elif v < 20:
        read = "Elevated — premiums rich; consider spreads over naked buys."
    else:
        read = "High — expect sharp swings; cut size, prefer defined-risk spreads."
    return (
        f"🌡 <b>India VIX: {v}</b>  ({vix.get('change_pct', 0):+.2f}%)\n{read}"
    )


def _cmd_fii(args, ctx) -> str:
    d = nse_data.get_fii_dii_data()
    if not d:
        return "Couldn't fetch FII/DII data right now."
    return "\n".join([
        f"💰 <b>FII/DII flows</b> ({d.get('date', '—')})",
        f"FII net: <b>₹{d.get('fii_net_buy_sell', '—')} cr</b>",
        f"DII net: <b>₹{d.get('dii_net_buy_sell', '—')} cr</b>",
    ])


def _cmd_news(args, ctx) -> str:
    items = news.fetch_indian_news()
    if not items:
        return "No fresh headlines in the last 12 hours."
    lines = ["📰 <b>Latest Indian market headlines</b>", ""]
    for it in items[:8]:
        lines.append(f"• {html.escape(it['title'])}  <i>({html.escape(it['source'])})</i>")
    return "\n".join(lines)


def _cmd_strategy(args, ctx) -> str:
    nse = {
        "vix": nse_data.get_india_vix(),
        "nifty_chain": nse_data.get_nifty_options_chain(),
    }
    s = ctx["strategy_resolver"](nse)
    name, source = ctx["strategy_name_resolver"]()
    return "\n".join([
        f"🧭 <b>Active strategy:</b> {html.escape(s['name'])}",
        f"<i>Selected: {html.escape(name)} (via {html.escape(source)})</i>",
        f"Min signal strength: {s['min_signal_strength']}",
        f"Min sentiment score: {s['min_sentiment_score']}",
        f"Risk per trade: {s['risk_per_trade_pct']}%",
        f"DTE range: {s['dte_range'][0]}–{s['dte_range'][1]} days",
        f"Watchlist: {len(s['watchlist'])} symbols",
        "",
        "Switch with /setstrategy &lt;name&gt;",
    ])


def _push_config_to_repo() -> bool:
    """Best-effort commit+push of data/config.json so cron runs pick it up."""
    import subprocess
    steps = [
        ["git", "config", "user.name", "market-bot[actions]"],
        ["git", "config", "user.email", "actions@users.noreply.github.com"],
        ["git", "add", "-f", str(config.CONFIG_PATH)],
        ["git", "commit", "-m", "chore: set strategy via /setstrategy"],
        ["git", "pull", "--rebase", "origin", "main"],
        ["git", "push", "origin", "HEAD:main"],
    ]
    for cmd in steps:
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"[WARN] _push_config_to_repo `{' '.join(cmd)}`: {r.stderr.strip()}")
            return False
    print("[OK] _push_config_to_repo: config pushed")
    return True


def _cmd_setstrategy(args, ctx) -> str:
    valid = ctx.get("valid_strategies") or []
    options = "\n".join(f"  • <code>{v}</code>" for v in valid)
    if not args:
        name, source = ctx["strategy_name_resolver"]()
        return (f"Current: <b>{html.escape(name)}</b> (via {html.escape(source)})\n\n"
                f"Usage: <code>/setstrategy adaptive</code>\nAvailable:\n{options}")
    choice = args[0].strip().lower()
    if choice not in valid:
        return (f"Unknown strategy <b>{html.escape(choice)}</b>. Available:\n{options}")

    config.set_strategy(choice)
    pushed = _push_config_to_repo()
    note = (
        "Saved and pushed — all scheduled runs will use it from now on."
        if pushed else
        "⚠️ Saved for THIS listener session, but pushing to the repo failed — "
        "scheduled runs may not see it. Check the Actions log, or set the "
        "ACTIVE_STRATEGY repo variable as a fallback."
    )
    return f"✅ Strategy switched to <b>{html.escape(choice)}</b>.\n{note}"


def _cmd_analyze(args, ctx) -> str:
    _reply(ctx, "⏳ Running a full analysis — this takes a minute or two…")
    nse = {
        "vix": nse_data.get_india_vix(),
        "nifty_chain": nse_data.get_nifty_options_chain(),
    }
    strategy = ctx["strategy_resolver"](nse)
    md = market_data.get_price_data(market_data.WATCHLIST_STOCKS_TO_SCAN)
    headlines = [h["title"] for h in news.fetch_indian_news()][:12]
    analysis = ai_engine.analyse_with_ai(md, headlines, strategy, nse=nse)
    return tg.format_midday(analysis, md, nse, label="On-Demand Analysis 🤖")


def _cmd_stats(args, ctx) -> str:
    import sqlite3
    from backtest import DB_PATH

    if not DB_PATH.exists():
        return "No signal history yet — the DB is created after the first signal-logging run."
    conn = sqlite3.connect(DB_PATH)
    total, resolved = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(resolved), 0) FROM signals"
    ).fetchone()
    if not total:
        return "Signal DB exists but has no signals logged yet."
    lines = [f"📊 <b>Signal stats</b> — {total} logged, {resolved} resolved", ""]
    rows = conn.execute("""
        SELECT strategy, COUNT(*),
               SUM(CASE WHEN outcome_pct > 0 THEN 1 ELSE 0 END),
               ROUND(AVG(outcome_pct), 2)
        FROM signals WHERE resolved = 1 GROUP BY strategy
    """).fetchall()
    if not rows:
        lines.append("<i>No resolved signals yet — run backtest.py --resolve after ~1 week.</i>")
    for strat, n, wins, avg in rows:
        lines.append(
            f"• <b>{html.escape(strat)}</b>: {wins}/{n} wins "
            f"({wins / n * 100:.0f}%), avg {avg:+.2f}%"
        )
    return "\n".join(lines)


# ── AI report handlers ────────────────────────────────────────────────────────

_NO_REPORT = ("No pre-market report cached for today yet. "
              "Run /premarket to generate one (takes 2–4 min).")


def _cmd_premarket(args, ctx) -> str:
    report = premarket.load_cached()
    if not report:
        _reply(ctx, "⏳ No report cached for today — running the full pipeline "
                    "(screener + options + AI). This takes 2–4 minutes…")
        report, _ = premarket.generate(ctx["strategy_resolver"])
    return tg.format_ai_premarket(report)


def _cmd_watchlist(args, ctx) -> str:
    report = premarket.load_cached()
    return tg.format_watchlist(report) if report else _NO_REPORT


def _cmd_market(args, ctx) -> str:
    report = premarket.load_cached()
    return tg.format_market_outlook(report) if report else _NO_REPORT


def _cmd_alerts(args, ctx) -> str:
    report = premarket.load_cached()
    return tg.format_alerts(report) if report else _NO_REPORT


def _cmd_sectors(args, ctx) -> str:
    live = nse_data.get_sector_indices()
    report = premarket.load_cached()
    if not live and not report:
        return "Couldn't fetch sector data right now."
    return tg.format_sectors(report, live=live)


def _cmd_stock(args, ctx) -> str:
    if not args:
        return "Usage: <code>/stock RELIANCE</code>"
    raw = args[0].strip().upper().removesuffix(".NS")
    if raw in ("NIFTY", "BANKNIFTY"):
        return ("For indices use /oi (chain + levels) and /market (bias) — "
                "/stock is for F&O stocks.")
    _reply(ctx, f"⏳ Analysing {html.escape(raw)} — technicals, option chain, "
                "fundamentals, AI. Takes about a minute…")
    snap = screener.single_stock(f"{raw}.NS")
    if snap is None:
        return f"Couldn't fetch data for <b>{html.escape(raw)}</b> — check the symbol."
    headlines = [h["title"] for h in news.fetch_indian_news()][:10]
    analysis = ai_engine.analyse_stock(snap, headlines)
    return tg.format_stock_analysis(analysis, snap)


_HANDLERS = {
    "start": _cmd_help,
    "help": _cmd_help,
    "ping": _cmd_ping,
    "premarket": _cmd_premarket,
    "watchlist": _cmd_watchlist,
    "market": _cmd_market,
    "sectors": _cmd_sectors,
    "alerts": _cmd_alerts,
    "stock": _cmd_stock,
    "price": _cmd_price,
    "oi": _cmd_oi,
    "vix": _cmd_vix,
    "fii": _cmd_fii,
    "news": _cmd_news,
    "strategy": _cmd_strategy,
    "setstrategy": _cmd_setstrategy,
    "analyze": _cmd_analyze,
    "stats": _cmd_stats,
}


# ── Listener ──────────────────────────────────────────────────────────────────

def _register_commands(token: str):
    """Register the command list so Telegram shows the '/' autocomplete menu."""
    try:
        r = requests.post(
            _api(token, "setMyCommands"),
            json={"commands": [{"command": c, "description": d} for c, d in COMMANDS]},
            timeout=10,
        )
        print(f"[{'OK' if r.ok else 'WARN'}] setMyCommands: {r.status_code}")
    except Exception as e:
        print(f"[WARN] setMyCommands: {e}")


def _handle_update(msg: dict, ctx: dict):
    chat_id = (msg.get("chat") or {}).get("id")
    if str(chat_id) != str(ctx["chat_id"]):
        return  # not the owner — ignore silently
    if msg.get("date") and time.time() - msg["date"] > STALE_AFTER:
        # Don't execute, but don't vanish either — remember it for the
        # one-shot "I was offline" summary sent after this batch.
        print(f"[OK] listener: stale message from {msg.get('date')} — will summarise")
        ctx.setdefault("stale_skipped", []).append(
            ((msg.get("text") or "").strip()[:40], msg["date"])
        )
        return
    text = (msg.get("text") or "").strip()
    if not text:
        return
    if not text.startswith("/"):
        _reply(ctx, "Try /help for the list of commands.")
        return

    parts = text.split()
    cmd = parts[0].lstrip("/").split("@")[0].lower()
    handler = _HANDLERS.get(cmd)
    if handler is None:
        _reply(ctx, f"Unknown command /{html.escape(cmd)} — try /help.")
        return

    print(f"[OK] listener: handling /{cmd} {parts[1:]}")
    try:
        out = handler(parts[1:], ctx)
    except Exception as e:
        print(f"[ERROR] listener /{cmd}: {e}")
        out = f"⚠️ /{html.escape(cmd)} failed: {html.escape(str(e))}"
    if out:
        _reply(ctx, out)


def listen(token: str, chat_id: str, strategy_resolver, minutes: float,
           valid_strategies: list[str] | None = None,
           strategy_name_resolver=None):
    """
    Long-poll getUpdates for `minutes`, answering slash commands.

    Telegram's server-side offset confirmation means updates that arrive
    between listener windows are delivered at the next window's first poll —
    nothing is lost, and the final confirming call below prevents replays.
    """
    deadline = time.time() + minutes * 60
    ctx = {
        "token": token,
        "chat_id": chat_id,
        "strategy_resolver": strategy_resolver,
        "valid_strategies": valid_strategies or [],
        "strategy_name_resolver": strategy_name_resolver or (lambda: ("?", "?")),
    }

    _register_commands(token)
    print(f"[OK] listener: up for {minutes:.0f} min")

    offset = None
    while time.time() < deadline:
        poll = int(max(1, min(POLL_TIMEOUT, deadline - time.time())))
        try:
            r = requests.get(
                _api(token, "getUpdates"),
                params={
                    "timeout": poll,
                    "offset": offset,
                    "allowed_updates": json.dumps(["message"]),
                },
                timeout=poll + 10,
            )
            updates = r.json().get("result", [])
        except Exception as e:
            print(f"[WARN] listener poll: {e}")
            time.sleep(5)
            continue

        for u in updates:
            offset = u["update_id"] + 1
            try:
                _handle_update(u.get("message") or {}, ctx)
            except Exception as e:
                print(f"[ERROR] listener update {u.get('update_id')}: {e}")

        # One courtesy message covering everything sent while no listener
        # was up (instead of silently dropping it).
        stale = ctx.pop("stale_skipped", None)
        if stale:
            from datetime import datetime
            from modules.telegram import IST
            lines = ["😴 <b>I was offline when you sent:</b>"]
            for text, ts in stale[-10:]:
                when = datetime.fromtimestamp(ts, IST).strftime("%d %b %I:%M %p")
                lines.append(f"  • <code>{html.escape(text)}</code>  ({when})")
            lines.append("")
            lines.append("I'm listening now — resend any command you still need.")
            _reply(ctx, "\n".join(lines))

    # Confirm the last processed update so the next window doesn't replay it.
    if offset is not None:
        try:
            requests.get(
                _api(token, "getUpdates"),
                params={"offset": offset, "limit": 1, "timeout": 0},
                timeout=10,
            )
        except Exception:
            pass
    print("[OK] listener: window over, exiting")
