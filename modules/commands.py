"""
Telegram slash-command handling.

The bot is push-only on a cron, so commands need a listener: `listen()`
long-polls getUpdates for a fixed window (run from GitHub Actions during
market hours via RUN_TYPE=listen) and answers slash commands as they arrive.

Security: only messages from TELEGRAM_CHAT_ID are handled — anything else is
ignored silently. Commands older than an hour (sent while no listener was up)
are confirmed but skipped, so a weekend backlog never replays on Monday.
"""

import html
import json
import time

import requests

from modules import nse_data, market_data, news, ai_engine
from modules import telegram as tg

POLL_TIMEOUT = 50  # Telegram long-poll seconds per getUpdates call
STALE_AFTER = 3600  # ignore commands older than this (listener was down)

# Shown in Telegram's "/" autocomplete menu (registered via setMyCommands).
COMMANDS = [
    ("help", "List all commands"),
    ("price", "Quote + technicals: /price RELIANCE or /price NIFTY"),
    ("oi", "Option chain OI summary: /oi or /oi RELIANCE"),
    ("vix", "India VIX + what it means for premiums"),
    ("fii", "Latest FII/DII net flows"),
    ("news", "Top Indian market headlines"),
    ("analyze", "Full AI analysis on demand (takes ~1 min)"),
    ("strategy", "Show the currently active strategy params"),
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
    return "\n".join([
        f"🧭 <b>Active strategy:</b> {html.escape(s['name'])}",
        f"Min signal strength: {s['min_signal_strength']}",
        f"Min sentiment score: {s['min_sentiment_score']}",
        f"Risk per trade: {s['risk_per_trade_pct']}%",
        f"DTE range: {s['dte_range'][0]}–{s['dte_range'][1]} days",
        f"Watchlist: {len(s['watchlist'])} symbols",
    ])


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


_HANDLERS = {
    "start": _cmd_help,
    "help": _cmd_help,
    "ping": _cmd_ping,
    "price": _cmd_price,
    "oi": _cmd_oi,
    "vix": _cmd_vix,
    "fii": _cmd_fii,
    "news": _cmd_news,
    "strategy": _cmd_strategy,
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
        print(f"[OK] listener: skipping stale message from {msg.get('date')}")
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


def listen(token: str, chat_id: str, strategy_resolver, minutes: float):
    """
    Long-poll getUpdates for `minutes`, answering slash commands.

    Telegram's server-side offset confirmation means updates that arrive
    between listener windows are delivered at the next window's first poll —
    nothing is lost, and the final confirming call below prevents replays.
    """
    deadline = time.time() + minutes * 60
    ctx = {"token": token, "chat_id": chat_id, "strategy_resolver": strategy_resolver}

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
