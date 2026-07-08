"""
Market Intelligence Bot
GitHub Actions + Gemini API + Telegram
Supports: NSE (India) and US Markets
"""

import os
import json
import requests
import yfinance as yf
from datetime import datetime, timedelta
import pytz

# ── Config ────────────────────────────────────────────────────────────────────

GEMINI_API_KEY      = os.environ["GEMINI_API_KEY"]
TELEGRAM_BOT_TOKEN  = os.environ["TELEGRAM_BOT_TOKEN"]
TELEGRAM_CHAT_ID    = os.environ["TELEGRAM_CHAT_ID"]

# Load active strategy from env (default: balanced)
STRATEGY = os.environ.get("STRATEGY", "balanced")

# Gemini model — swap anytime without changing logic
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

# ── Strategy Configs ──────────────────────────────────────────────────────────

STRATEGIES = {
    "balanced": {
        "name": "Balanced",
        "description": "Equal weight on sentiment and technicals",
        "min_sentiment_score": 0.55,
        "min_signal_strength": 0.6,
        "max_iv_rank": 70,
        "delta_range": [0.30, 0.50],
        "dte_range": [21, 45],
        "risk_per_trade_pct": 2.0,
        "watchlist": ["RELIANCE.NS", "NIFTY50=F", "TCS.NS", "INFY.NS", "HDFCBANK.NS",
                      "AAPL", "NVDA", "SPY", "QQQ", "TSLA"],
    },
    "momentum": {
        "name": "Momentum",
        "description": "Follows strong price trends + bullish sentiment",
        "min_sentiment_score": 0.65,
        "min_signal_strength": 0.7,
        "max_iv_rank": 50,
        "delta_range": [0.40, 0.60],
        "dte_range": [14, 30],
        "risk_per_trade_pct": 3.0,
        "watchlist": ["RELIANCE.NS", "TATAMOTORS.NS", "BAJFINANCE.NS",
                      "NVDA", "META", "AMZN", "QQQ"],
    },
    "conservative": {
        "name": "Conservative",
        "description": "Low risk, high conviction only",
        "min_sentiment_score": 0.75,
        "min_signal_strength": 0.80,
        "max_iv_rank": 40,
        "delta_range": [0.20, 0.35],
        "dte_range": [30, 60],
        "risk_per_trade_pct": 1.0,
        "watchlist": ["NIFTY50=F", "SPY", "TCS.NS", "HDFCBANK.NS"],
    },
    "sentiment_first": {
        "name": "Sentiment-First",
        "description": "AI sentiment drives everything",
        "min_sentiment_score": 0.80,
        "min_signal_strength": 0.5,
        "max_iv_rank": 80,
        "delta_range": [0.25, 0.55],
        "dte_range": [7, 21],
        "risk_per_trade_pct": 2.5,
        "watchlist": ["RELIANCE.NS", "ZOMATO.NS", "PAYTM.NS",
                      "TSLA", "NVDA", "COIN", "MSTR"],
    },
}

# ── Market Data ───────────────────────────────────────────────────────────────

def fetch_market_data(symbols: list[str]) -> list[dict]:
    """Fetch price, volume, and basic technicals for each symbol."""
    results = []
    for symbol in symbols:
        try:
            ticker = yf.Ticker(symbol)
            hist   = ticker.history(period="10d", interval="1d")
            info   = ticker.fast_info

            if hist.empty:
                continue

            closes   = hist["Close"].tolist()
            volumes  = hist["Volume"].tolist()
            today    = closes[-1]
            prev     = closes[-2] if len(closes) >= 2 else today
            pct_chg  = ((today - prev) / prev) * 100

            # Simple 5-day momentum
            momentum = ((today - closes[0]) / closes[0]) * 100 if len(closes) >= 5 else 0.0

            # Volume spike vs 5-day avg
            avg_vol    = sum(volumes[-6:-1]) / 5 if len(volumes) >= 6 else volumes[-1]
            vol_spike  = volumes[-1] / avg_vol if avg_vol > 0 else 1.0

            results.append({
                "symbol":    symbol,
                "price":     round(today, 2),
                "change_pct": round(pct_chg, 2),
                "momentum_5d": round(momentum, 2),
                "volume_spike": round(vol_spike, 2),
                "high_52w":  getattr(info, "year_high", None),
                "low_52w":   getattr(info, "year_low", None),
            })
        except Exception as e:
            print(f"  [WARN] {symbol}: {e}")

    return results


def fetch_news_headlines() -> list[str]:
    """
    Fetch recent finance headlines.
    Uses GNews free API (no key needed for basic use).
    Add GNEWS_API_KEY secret for higher limits.
    """
    api_key = os.environ.get("GNEWS_API_KEY", "")
    headlines = []

    topics = ["stock market", "options trading", "NSE India", "Federal Reserve"]
    for topic in topics:
        try:
            url = (
                f"https://gnews.io/api/v4/search?q={requests.utils.quote(topic)}"
                f"&lang=en&max=3&token={api_key}"
            ) if api_key else (
                f"https://gnews.io/api/v4/top-headlines?topic=business&lang=en&max=5"
                f"&token=demo"
            )
            r = requests.get(url, timeout=8)
            if r.status_code == 200:
                articles = r.json().get("articles", [])
                for a in articles:
                    headlines.append(a.get("title", ""))
        except Exception as e:
            print(f"  [WARN] News fetch: {e}")

    # Fallback — always have something even if API fails
    if not headlines:
        headlines = [
            "Markets open with mixed signals amid global uncertainty",
            "Options activity surges ahead of Fed meeting",
            "Nifty consolidates near key support levels",
        ]

    return list(set(h for h in headlines if h))[:12]


# ── AI Analysis (Gemini) ──────────────────────────────────────────────────────

def analyse_with_ai(market_data: list[dict], headlines: list[str], strategy: dict) -> dict:
    """
    Send market data + headlines to Gemini.
    Returns structured analysis with signals.
    """

    market_summary = "\n".join([
        f"- {d['symbol']}: ${d['price']} ({'+' if d['change_pct'] >= 0 else ''}{d['change_pct']}%) "
        f"| 5d momentum: {d['momentum_5d']}% | vol spike: {d['volume_spike']:.1f}x"
        for d in market_data
    ])

    news_summary = "\n".join([f"- {h}" for h in headlines[:8]])

    prompt = f"""You are a market intelligence analyst. Analyse the data below and return a JSON object.

## Active Strategy: {strategy['name']}
- Min sentiment score to trigger signal: {strategy['min_sentiment_score']}
- Preferred delta range: {strategy['delta_range']}
- Preferred DTE: {strategy['dte_range'][0]}–{strategy['dte_range'][1]} days
- Risk per trade: {strategy['risk_per_trade_pct']}%

## Today's Market Data
{market_summary}

## Recent Headlines
{news_summary}

## Instructions
Return ONLY valid JSON — no markdown, no explanation. Use this exact schema:

{{
  "market_mood": "bullish | bearish | neutral | mixed",
  "mood_confidence": 0.0-1.0,
  "summary": "2-3 sentence market summary for a trader",
  "top_signals": [
    {{
      "symbol": "TICKER",
      "direction": "CALL | PUT | HOLD",
      "signal_strength": 0.0-1.0,
      "sentiment_score": 0.0-1.0,
      "reasoning": "One clear sentence why",
      "suggested_action": "Buy CALL | Buy PUT | Sell covered CALL | Hold | Avoid",
      "suggested_strike_hint": "ATM | 5% OTM | 2% ITM",
      "suggested_dte": 21
    }}
  ],
  "key_risks": ["risk 1", "risk 2", "risk 3"],
  "sector_rotation": "Where money seems to be moving",
  "vix_comment": "Comment on volatility environment",
  "skip_trading_today": false,
  "skip_reason": ""
}}

Only include signals where signal_strength >= {strategy['min_signal_strength']} and sentiment_score >= {strategy['min_sentiment_score']}.
If no signals qualify, return empty top_signals array and set skip_trading_today to true.
"""

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 1500,
        },
    }

    r = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
        headers={"Content-Type": "application/json"},
        params={"key": GEMINI_API_KEY},
        json=payload,
        timeout=30,
    )
    r.raise_for_status()

    raw = r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()

    # Strip any accidental markdown fences
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip().rstrip("```").strip()

    return json.loads(raw)


# ── Telegram Messenger ────────────────────────────────────────────────────────

def send_telegram(message: str):
    """Send a message to Telegram."""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    r = requests.post(url, json=payload, timeout=10)
    if r.status_code != 200:
        print(f"  [ERROR] Telegram: {r.text}")
    else:
        print("  [OK] Message sent to Telegram")


def format_message(analysis: dict, market_data: list[dict], strategy: dict) -> str:
    """Format the analysis into a clean Telegram message."""

    ist = pytz.timezone("Asia/Kolkata")
    now = datetime.now(ist).strftime("%d %b %Y  %I:%M %p IST")

    mood_emoji = {
        "bullish": "🟢", "bearish": "🔴",
        "neutral": "🟡", "mixed": "🟠",
    }.get(analysis.get("market_mood", "neutral"), "⚪")

    lines = [
        f"<b>📊 Market Digest — {now}</b>",
        f"<b>Strategy:</b> {strategy['name']}",
        "",
        f"{mood_emoji} <b>Market Mood:</b> {analysis.get('market_mood','—').upper()} "
        f"({int(analysis.get('mood_confidence', 0) * 100)}% confidence)",
        "",
        f"<b>Summary</b>",
        analysis.get("summary", "—"),
        "",
    ]

    # Market snapshot
    lines.append("<b>📈 Watchlist Snapshot</b>")
    for d in market_data[:6]:
        arrow = "▲" if d["change_pct"] >= 0 else "▼"
        lines.append(
            f"  {arrow} <code>{d['symbol']:<14}</code> "
            f"${d['price']}  ({d['change_pct']:+.2f}%)"
        )

    lines.append("")

    # Signals
    signals = analysis.get("top_signals", [])
    if analysis.get("skip_trading_today") or not signals:
        lines.append("⚠️ <b>No qualifying signals today</b>")
        if analysis.get("skip_reason"):
            lines.append(f"Reason: {analysis['skip_reason']}")
    else:
        lines.append(f"<b>🎯 Signals ({len(signals)} found)</b>")
        for s in signals:
            direction_emoji = {"CALL": "🟢 CALL", "PUT": "🔴 PUT", "HOLD": "🟡 HOLD"}.get(
                s.get("direction", "HOLD"), "⚪"
            )
            strength_bar = "█" * int(s.get("signal_strength", 0) * 5) + "░" * (5 - int(s.get("signal_strength", 0) * 5))
            lines += [
                "",
                f"<b>{s.get('symbol')}</b>  {direction_emoji}",
                f"  Strength: [{strength_bar}] {int(s.get('signal_strength',0)*100)}%",
                f"  Action: {s.get('suggested_action','—')}",
                f"  Strike hint: {s.get('suggested_strike_hint','ATM')}  |  DTE: ~{s.get('suggested_dte', 21)}d",
                f"  Why: {s.get('reasoning','—')}",
            ]

    lines += [
        "",
        "<b>⚠️ Key Risks</b>",
        *[f"  • {r}" for r in analysis.get("key_risks", [])[:3]],
        "",
        f"<b>🔄 Sector flow:</b> {analysis.get('sector_rotation','—')}",
        f"<b>📉 Volatility:</b> {analysis.get('vix_comment','—')}",
        "",
        f"<i>Risk per trade: {strategy['risk_per_trade_pct']}% | Model: {GEMINI_MODEL}</i>",
        "<i>⚠️ Not financial advice. Always do your own research.</i>",
    ]

    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    strategy = STRATEGIES.get(STRATEGY, STRATEGIES["balanced"])
    print(f"\n=== Market Bot — Strategy: {strategy['name']} ===")
    print(f"    Model: {GEMINI_MODEL}")
    print(f"    Symbols: {strategy['watchlist']}\n")

    print("[1/4] Fetching market data...")
    market_data = fetch_market_data(strategy["watchlist"])
    print(f"      Got data for {len(market_data)} symbols")

    print("[2/4] Fetching news headlines...")
    headlines = fetch_news_headlines()
    print(f"      Got {len(headlines)} headlines")

    print("[3/4] Analysing with AI...")
    analysis = analyse_with_ai(market_data, headlines, strategy)
    print(f"      Mood: {analysis.get('market_mood')} | Signals: {len(analysis.get('top_signals', []))}")

    print("[4/4] Sending to Telegram...")
    message = format_message(analysis, market_data, strategy)
    send_telegram(message)

    print("\n=== Done ===\n")


if __name__ == "__main__":
    main()
