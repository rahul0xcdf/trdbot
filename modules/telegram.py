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


# ── Sender (unchanged) ────────────────────────────────────────────────────────

def send_telegram(message: str, token: str, chat_id: str):
    """Send a message to Telegram."""
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": message,
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
