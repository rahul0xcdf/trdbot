"""
AI analysis via the Gemini API.

(Migrated off OpenRouter earlier — its free tier rate-limited us with 429s.
Calls generativelanguage.googleapis.com directly.)

Upgraded for Indian intraday: the prompt now carries NSE OI / PCR / max-pain,
India VIX, FII/DII flows and asks for Nifty & BankNifty directional bias plus
specific option-contract hints in rupees.
"""

import os
import json
import requests

GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

TIMEOUT = 30


def _nse_context_block(nse: dict | None) -> str:
    """Render the optional NSE/VIX/FII context into prompt text."""
    if not nse:
        return "## NSE / Derivatives Context\n(None available for this run.)\n"

    lines = ["## NSE / Derivatives Context"]

    chain = nse.get("nifty_chain")
    if chain:
        lines += [
            f"- NIFTY spot: {chain.get('spot')}  | ATM strike: {chain.get('atm_strike')}",
            f"- PCR (Put/Call OI): {chain.get('pcr')}  | Max pain: {chain.get('max_pain')}",
            f"- Top CALL OI strikes (resistance): {chain.get('top_call_oi_strikes')}",
            f"- Top PUT OI strikes (support): {chain.get('top_put_oi_strikes')}",
        ]

    vix = nse.get("vix")
    if vix:
        lines.append(f"- INDIA VIX: {vix.get('value')} ({vix.get('change_pct')}% today)")

    fii_dii = nse.get("fii_dii")
    if fii_dii:
        lines.append(
            f"- FII net (crores): {fii_dii.get('fii_net_buy_sell')} | "
            f"DII net (crores): {fii_dii.get('dii_net_buy_sell')} "
            f"({fii_dii.get('date')})"
        )

    gift = nse.get("gift_nifty")
    if gift:
        lines.append(
            f"- Gift Nifty proxy ({gift.get('proxy_symbol')}): {gift.get('value')} "
            f"| implied gap: {gift.get('gap_pct')}%"
        )

    return "\n".join(lines) + "\n"


def analyse_with_ai(
    market_data: list[dict],
    headlines: list[str],
    strategy: dict,
    nse: dict | None = None,
) -> dict:
    """
    Send market data + headlines + NSE context to Gemini.
    Returns the parsed JSON analysis (schema described in the prompt).
    """
    market_summary = "\n".join([
        f"- {d['symbol']}: {d['price']} ({'+' if d['change_pct'] >= 0 else ''}{d['change_pct']}%) "
        f"| 5d mom: {d.get('momentum_5d')}% | 1w mom: {d.get('momentum_1w')}% "
        f"| vol spike: {d.get('volume_spike')}x | above VWAP: {d.get('above_vwap')}"
        for d in market_data
    ]) or "(no price data)"

    news_summary = "\n".join([f"- {h}" for h in headlines[:10]]) or "(no headlines)"

    prompt = f"""You are an Indian markets (NSE) intraday options analyst. Analyse the data and return ONLY a JSON object.

## Active Strategy: {strategy['name']}
- Min sentiment score to trigger signal: {strategy['min_sentiment_score']}
- Min signal strength: {strategy['min_signal_strength']}
- Preferred DTE: {strategy['dte_range'][0]}-{strategy['dte_range'][1]} days (weekly options if 0-7)
- Risk per trade: {strategy['risk_per_trade_pct']}%

{_nse_context_block(nse)}
## Today's Price Data
{market_summary}

## Recent Headlines
{news_summary}

## Instructions
Use PCR (>1 = bearish sentiment / possible support; <0.7 = bullish/overbought),
max pain (price often gravitates there near expiry), India VIX (higher = richer
option premium, favour spreads / caution), and FII/DII flows (FII selling = pressure).
Give Nifty and BankNifty a directional bias relative to key OI strike levels.
For stock picks, suggest a specific option contract with a rupee strike hint
(e.g. "NIFTY 24500 CE weekly" or "RELIANCE 3000 CE").

Return ONLY valid JSON with EXACTLY this schema:

{{
  "market_mood": "bullish | bearish | neutral | mixed",
  "mood_confidence": 0.0-1.0,
  "summary": "2-3 sentence intraday summary for an options trader",
  "nifty_bias": "bullish | bearish | neutral",
  "banknifty_bias": "bullish | bearish | neutral",
  "india_vix_comment": "what current VIX means for option premium today",
  "fii_dii_comment": "what FII/DII flows imply",
  "top_signals": [
    {{
      "symbol": "TICKER",
      "direction": "CALL | PUT | HOLD",
      "signal_strength": 0.0-1.0,
      "sentiment_score": 0.0-1.0,
      "reasoning": "one clear sentence",
      "suggested_action": "Buy CALL | Buy PUT | Sell CALL | Hold | Avoid",
      "suggested_strike_hint": "e.g. NIFTY 24500 CE weekly",
      "suggested_dte": 7
    }}
  ],
  "top_stock_picks": [
    {{
      "symbol": "TICKER",
      "action": "Buy CALL | Buy PUT | Avoid",
      "strike_hint": "rupee strike + CE/PE + expiry",
      "reasoning": "one sentence"
    }}
  ],
  "key_risks": ["risk 1", "risk 2", "risk 3"],
  "sector_rotation": "where money seems to be moving",
  "avoid_trading": false,
  "avoid_reason": ""
}}

Only include signals where signal_strength >= {strategy['min_signal_strength']} and sentiment_score >= {strategy['min_sentiment_score']}.
If nothing qualifies, return empty arrays and set avoid_trading to true with a reason.
"""

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            # Budget must cover the whole JSON. Gemini 2.5 is a thinking model,
            # so give headroom and disable thinking to avoid truncation.
            "maxOutputTokens": 4096,
            "responseMimeType": "application/json",
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }

    try:
        r = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
            headers={"Content-Type": "application/json"},
            params={"key": GEMINI_API_KEY},
            json=payload,
            timeout=TIMEOUT,
        )
        r.raise_for_status()
    except Exception as e:
        print(f"[ERROR] analyse_with_ai request: {e}")
        raise

    candidate = r.json()["candidates"][0]

    finish = candidate.get("finishReason")
    if finish not in (None, "STOP"):
        raise RuntimeError(f"Gemini did not finish cleanly (finishReason={finish})")

    raw = candidate["content"]["parts"][0]["text"].strip()

    # Strip accidental markdown fences (harmless with responseMimeType set).
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip().rstrip("```").strip()

    analysis = json.loads(raw)
    print(
        f"[OK] analyse_with_ai: mood={analysis.get('market_mood')} "
        f"nifty={analysis.get('nifty_bias')} signals={len(analysis.get('top_signals', []))}"
    )
    return analysis
