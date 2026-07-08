"""
Telegram message formatting + sending.

One formatter per run slot (premarket / opening / midday / eod / vix alert),
each reading analysis + market/NSE data defensively so a missing field never
raises. send_telegram is unchanged from the original bot.
"""

from datetime import datetime
import pytz
import requests

IST = pytz.timezone("Asia/Kolkata")
TIMEOUT = 10

_MOOD_EMOJI = {"bullish": "🟢", "bearish": "🔴", "neutral": "🟡", "mixed": "🟠"}
_BIAS_EMOJI = {"bullish": "🟢", "bearish": "🔴", "neutral": "🟡"}


def _now() -> str:
    return datetime.now(IST).strftime("%d %b %Y  %I:%M %p IST")


def _bias_line(label: str, bias: str | None) -> str:
    bias = (bias or "neutral").lower()
    return f"{_BIAS_EMOJI.get(bias, '⚪')} <b>{label}:</b> {bias.upper()}"


def _snapshot_lines(market_data: list[dict], limit: int = 6) -> list[str]:
    lines = []
    for d in market_data[:limit]:
        arrow = "▲" if d.get("change_pct", 0) >= 0 else "▼"
        lines.append(
            f"  {arrow} <code>{d['symbol']:<12}</code> "
            f"{d.get('price')}  ({d.get('change_pct', 0):+.2f}%)"
        )
    return lines


def _chain_lines(nse_data: dict | None) -> list[str]:
    chain = (nse_data or {}).get("nifty_chain")
    if not chain:
        return []
    return [
        f"  PCR: <b>{chain.get('pcr')}</b>  |  Max pain: <b>{chain.get('max_pain')}</b>",
        f"  ATM: {chain.get('atm_strike')}",
        f"  Resistance (CALL OI): {chain.get('top_call_oi_strikes')}",
        f"  Support (PUT OI): {chain.get('top_put_oi_strikes')}",
    ]


def _signal_lines(analysis: dict) -> list[str]:
    signals = analysis.get("top_signals", [])
    if analysis.get("avoid_trading") or not signals:
        out = ["⚠️ <b>No qualifying signals</b>"]
        if analysis.get("avoid_reason"):
            out.append(f"Reason: {analysis['avoid_reason']}")
        return out
    out = [f"<b>🎯 Signals ({len(signals)})</b>"]
    for s in signals:
        emoji = {"CALL": "🟢 CALL", "PUT": "🔴 PUT", "HOLD": "🟡 HOLD"}.get(s.get("direction"), "⚪")
        strength = int(s.get("signal_strength", 0) * 100)
        out += [
            "",
            f"<b>{s.get('symbol')}</b>  {emoji}  ({strength}%)",
            f"  Action: {s.get('suggested_action', '—')}",
            f"  Contract: {s.get('suggested_strike_hint', '—')}",
            f"  Why: {s.get('reasoning', '—')}",
        ]
    return out


def _stock_pick_lines(analysis: dict) -> list[str]:
    picks = analysis.get("top_stock_picks", [])
    if not picks:
        return []
    out = ["<b>📌 Stock Picks</b>"]
    for p in picks[:5]:
        out.append(
            f"  • <b>{p.get('symbol')}</b> — {p.get('action', '—')} "
            f"({p.get('strike_hint', '—')}): {p.get('reasoning', '—')}"
        )
    return out


def _footer(strategy: dict | None = None) -> list[str]:
    tail = ["", "<i>⚠️ Not financial advice. Do your own research.</i>"]
    if strategy:
        tail.insert(0, f"<i>Risk/trade: {strategy.get('risk_per_trade_pct')}% | {strategy.get('name')}</i>")
    return tail


# ── Run-slot formatters ───────────────────────────────────────────────────────

def format_premarket(analysis, market_data, nse_data, strategy) -> str:
    """8:15 AM — gap, VIX, PCR/max pain, top stocks to watch."""
    gift = (nse_data or {}).get("gift_nifty") or {}
    vix = (nse_data or {}).get("vix") or {}
    lines = [
        f"<b>🌅 Pre-Market — {_now()}</b>",
        f"<b>Strategy:</b> {strategy['name']}",
        "",
        f"<b>Gift Nifty (proxy):</b> {gift.get('value', '—')}  "
        f"(gap {gift.get('gap_pct', '—')}%)",
        f"<b>India VIX:</b> {vix.get('value', '—')} ({vix.get('change_pct', '—')}%)",
        "",
        _bias_line("Nifty bias", analysis.get("nifty_bias")),
        _bias_line("BankNifty bias", analysis.get("banknifty_bias")),
        "",
        f"{_MOOD_EMOJI.get(analysis.get('market_mood'), '⚪')} <b>Mood:</b> "
        f"{str(analysis.get('market_mood', '—')).upper()} "
        f"({int(analysis.get('mood_confidence', 0) * 100)}%)",
        "",
        analysis.get("summary", "—"),
    ]
    chain = _chain_lines(nse_data)
    if chain:
        lines += ["", "<b>🔗 NIFTY Options</b>", *chain]
    lines += ["", "<b>💬 VIX:</b> " + analysis.get("india_vix_comment", "—")]
    picks = _stock_pick_lines(analysis)
    if picks:
        lines += ["", *picks]
    lines += _footer(strategy)
    return "\n".join(lines)


def format_opening_range(analysis, market_data, nse_data) -> str:
    """9:30 AM — short & actionable: actual open, signal, top OI strikes."""
    lines = [
        f"<b>🔔 Opening Range — {_now()}</b>",
        "",
        _bias_line("Nifty", analysis.get("nifty_bias")),
        _bias_line("BankNifty", analysis.get("banknifty_bias")),
        "",
        *_snapshot_lines(market_data, limit=4),
    ]
    chain = _chain_lines(nse_data)
    if chain:
        lines += ["", "<b>Key OI levels</b>", *chain]
    lines += ["", *_signal_lines(analysis)]
    lines += _footer()
    return "\n".join(lines)


def format_midday(analysis, market_data, nse_data, label: str = "Midday Check") -> str:
    """11 AM / 12:30 PM / exit reminder — trend check + OI."""
    lines = [
        f"<b>📊 {label} — {_now()}</b>",
        "",
        f"{_MOOD_EMOJI.get(analysis.get('market_mood'), '⚪')} "
        f"{str(analysis.get('market_mood', '—')).upper()}  ·  "
        f"Nifty {str(analysis.get('nifty_bias', '—')).upper()}",
        "",
        analysis.get("summary", "—"),
        "",
        *_snapshot_lines(market_data, limit=5),
    ]
    chain = _chain_lines(nse_data)
    if chain:
        lines += ["", "<b>OI update</b>", *chain]
    lines += ["", *_signal_lines(analysis)]
    lines += _footer()
    return "\n".join(lines)


def format_eod(analysis, market_data, nse_data, fii_dii) -> str:
    """4 PM — FII/DII, OI for tomorrow, next-day prep."""
    fii_dii = fii_dii or {}
    lines = [
        f"<b>🌆 End of Day — {_now()}</b>",
        "",
        f"<b>FII net:</b> ₹{fii_dii.get('fii_net_buy_sell', '—')} cr  |  "
        f"<b>DII net:</b> ₹{fii_dii.get('dii_net_buy_sell', '—')} cr",
        f"<i>{analysis.get('fii_dii_comment', '')}</i>",
        "",
        analysis.get("summary", "—"),
        "",
        _bias_line("Tomorrow's Nifty lean", analysis.get("nifty_bias")),
        _bias_line("Tomorrow's BankNifty lean", analysis.get("banknifty_bias")),
    ]
    chain = _chain_lines(nse_data)
    if chain:
        lines += ["", "<b>🔗 OI for tomorrow</b>", *chain]
    risks = analysis.get("key_risks", [])[:3]
    if risks:
        lines += ["", "<b>⚠️ Key Risks</b>", *[f"  • {r}" for r in risks]]
    lines += _footer()
    return "\n".join(lines)


def format_vix_alert(vix_value, vix_change, context: str = "") -> str:
    """Instant, urgent VIX-spike alert."""
    return "\n".join([
        "⚠️ <b>VIX SPIKE</b> ⚠️",
        f"<b>India VIX: {vix_value}</b>  ({vix_change:+.1f}%)",
        "",
        "Volatility is rising — <b>tighten stops or square off</b>.",
        "Option premiums are inflating; avoid fresh naked longs.",
        f"\n{context}" if context else "",
    ]).strip()


# ── AI pre-market report formatters ───────────────────────────────────────────

_RECO_EMOJI = {"GO": "🟢 GO", "CAUTION": "🟡 CAUTION",
               "WARNING": "🟠 WARNING", "STAY_OUT": "🔴 STAY OUT"}


def _opportunity_block(o: dict) -> list[str]:
    icon = "🟢" if o.get("bias") == "bullish" else "🔴"
    return [
        "",
        f"{icon} <b>{o.get('symbol')}</b> — <b>{o.get('confidence_score')}/100</b> "
        f"@ {o.get('current_price')}",
        f"  Entry: {o.get('entry_zone')}  |  SL: {o.get('stop_loss')}",
        f"  T1: {o.get('target_1')}  |  T2: {o.get('target_2')}  |  RR {o.get('risk_reward')}",
        f"  ⚡ {o.get('suggested_strike')} ({o.get('suggested_expiry')})",
        f"  Scalp: {o.get('scalping_suitability')}  |  Hold: {o.get('expected_holding_time')}",
        f"  Why: {o.get('why_selected')}",
        f"  ⚠️ {'; '.join(o.get('key_risks', [])[:2])}",
    ]


def format_watchlist(report: dict) -> str:
    calls = report.get("call_opportunities") or []
    puts = report.get("put_opportunities") or []
    if report.get("no_trade") or (not calls and not puts):
        return ("🛑 <b>No high-probability opportunities found today.</b>\n"
                f"{report.get('no_trade_reason', 'Capital preservation is recommended.')}")
    lines = [f"<b>🎯 AI Watchlist — {report.get('generated_at', _now())}</b>"]
    if calls:
        lines += ["", f"<b>📈 Call opportunities ({len(calls)})</b>"]
        for o in calls[:5]:
            lines += _opportunity_block(o)
    if puts:
        lines += ["", f"<b>📉 Put opportunities ({len(puts)})</b>"]
        for o in puts[:5]:
            lines += _opportunity_block(o)
    lines += ["", "<i>Only setups scoring ≥85/100 are listed.</i>", *_footer()]
    return "\n".join(lines)


def format_market_outlook(report: dict) -> str:
    mo = report.get("market_outlook") or {}
    return "\n".join([
        f"<b>🧭 Market Outlook — {report.get('generated_at', _now())}</b>",
        "",
        f"<b>{_RECO_EMOJI.get(mo.get('recommendation'), '⚪ —')}</b>  "
        f"(confidence {mo.get('confidence', '—')}%)",
        f"Bull {mo.get('bullish_prob', '—')}%  ·  Bear {mo.get('bearish_prob', '—')}%  "
        f"·  Range {mo.get('rangebound_prob', '—')}%",
        "",
        mo.get("why", "—"),
        "",
        f"<b>Plan:</b> {(report.get('trading_plan') or {}).get('style', '—')} — "
        f"{(report.get('trading_plan') or {}).get('why', '')}",
    ])


def format_sectors(report: dict | None, live: list | None = None) -> str:
    lines = [f"<b>🏭 Sector Rotation — {_now()}</b>", ""]
    sectors = live or (report or {}).get("sectors_raw") or []
    if sectors:
        for s in sectors:
            arrow = "▲" if s["change_pct"] >= 0 else "▼"
            lines.append(f"  {arrow} {s['sector']:<20} {s['change_pct']:+.2f}%")
    so = (report or {}).get("sector_outlook") or {}
    if so:
        lines += [
            "",
            f"<b>Strong:</b> {', '.join(so.get('bullish_sectors', []) or ['—'])}",
            f"<b>Weak:</b> {', '.join(so.get('bearish_sectors', []) or ['—'])}",
            f"<i>{so.get('comment', '')}</i>",
        ]
    return "\n".join(lines)


def format_alerts(report: dict) -> str:
    lines = [f"<b>🚨 Today's Alerts — {report.get('generated_at', _now())}</b>", ""]
    alerts = report.get("alerts") or []
    risks = report.get("risk_assessment") or []
    if not alerts and not risks:
        return lines[0] + "\n\nNo notable events flagged for today."
    lines += [f"  • {a}" for a in alerts]
    if risks:
        lines += ["", "<b>⚠️ Risk assessment</b>", *[f"  • {r}" for r in risks]]
    return "\n".join(lines)


def format_ai_premarket(report: dict) -> str:
    """The full 8:15 AM report (auto-chunked by send_telegram if long)."""
    mo = report.get("market_outlook") or {}
    nl = report.get("nifty_levels") or {}
    bl = report.get("banknifty_levels") or {}
    lines = [
        f"<b>🧠 AI Pre-Market Report — {report.get('generated_at', _now())}</b>",
        "",
        f"<b>{_RECO_EMOJI.get(mo.get('recommendation'), '⚪ —')}</b>  "
        f"(confidence {mo.get('confidence', '—')}%)",
        f"Bull {mo.get('bullish_prob', '—')}%  ·  Bear {mo.get('bearish_prob', '—')}%  "
        f"·  Range {mo.get('rangebound_prob', '—')}%",
        mo.get("why", ""),
        "",
        f"<b>🌍 Overnight:</b> {report.get('overnight_summary', '—')}",
        "",
        f"<b>🇮🇳 Domestic:</b> {report.get('domestic_summary', '—')}",
        "",
        "<b>📏 Key levels</b>",
        f"  NIFTY  S: {nl.get('supports', '—')}  R: {nl.get('resistances', '—')}",
        f"  BANKNIFTY  S: {bl.get('supports', '—')}  R: {bl.get('resistances', '—')}",
        "",
        format_sectors(report).split("\n", 2)[-1],  # sector body without its header
        "",
        f"<b>🧭 Trading plan:</b> {(report.get('trading_plan') or {}).get('style', '—')} — "
        f"{(report.get('trading_plan') or {}).get('why', '')}",
        "",
        format_watchlist(report),
    ]
    alerts = report.get("alerts") or []
    if alerts:
        lines += ["", "<b>🚨 Alerts</b>", *[f"  • {a}" for a in alerts[:6]]]
    return "\n".join(lines)


def format_stock_analysis(a: dict, snapshot: dict | None = None) -> str:
    bias = (a.get("bias") or "neutral").lower()
    icon = {"bullish": "🟢", "bearish": "🔴"}.get(bias, "🟡")
    lines = [
        f"{icon} <b>{a.get('symbol')} — {bias.upper()}</b>  "
        f"({a.get('confidence_score', '—')}/100)",
        "",
        f"<b>Technicals:</b> {a.get('technical_summary', '—')}",
        f"<b>Options:</b> {a.get('options_summary', '—')}",
        f"<b>Fundamentals:</b> {a.get('fundamental_summary', '—')}",
        f"<b>Sentiment:</b> {a.get('sentiment_summary', '—')}",
        "",
        f"<b>Entry:</b> {a.get('entry_zone', '—')}  |  <b>SL:</b> {a.get('stop_loss', '—')}",
        f"<b>T1:</b> {a.get('target_1', '—')}  |  <b>T2:</b> {a.get('target_2', '—')}  "
        f"|  RR {a.get('risk_reward', '—')}",
        f"<b>⚡ Option:</b> {a.get('option_suggestion', '—')}",
        f"<b>Scalp:</b> {a.get('scalping_suitability', '—')}  |  "
        f"<b>Hold:</b> {a.get('expected_holding_time', '—')}",
    ]
    risks = a.get("key_risks") or []
    if risks:
        lines += ["", "<b>⚠️ Risks:</b> " + "; ".join(risks[:3])]
    lines += ["", f"<i>{a.get('verdict', '')}</i>", *_footer()]
    return "\n".join(lines)


# ── Sender ────────────────────────────────────────────────────────────────────

_TELEGRAM_MAX = 4000  # actual limit 4096; margin for safety


def _chunks(message: str) -> list[str]:
    """Split long messages on line boundaries (tags are per-line, so safe)."""
    if len(message) <= _TELEGRAM_MAX:
        return [message]
    chunks, current = [], ""
    for line in message.split("\n"):
        if len(current) + len(line) + 1 > _TELEGRAM_MAX:
            chunks.append(current.rstrip("\n"))
            current = ""
        current += line + "\n"
    if current.strip():
        chunks.append(current.rstrip("\n"))
    return chunks


def send_telegram(message: str, token: str, chat_id: str):
    """Send a message to Telegram, auto-splitting past the 4096-char limit."""
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    for chunk in _chunks(message):
        payload = {
            "chat_id": chat_id,
            "text": chunk,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        try:
            r = requests.post(url, json=payload, timeout=TIMEOUT)
            if r.status_code != 200:
                print(f"[ERROR] send_telegram: {r.text}")
            else:
                print("[OK] send_telegram: message sent")
        except Exception as e:
            print(f"[ERROR] send_telegram: {e}")
