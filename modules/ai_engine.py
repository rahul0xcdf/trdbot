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

TIMEOUT = 90


def _call_gemini(prompt: str, max_tokens: int = 4096) -> dict:
    """POST a prompt, demand JSON back, parse defensively. Raises on failure."""
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            # Budget must cover the whole JSON. Gemini 2.5 is a thinking model,
            # so give headroom and disable thinking to avoid truncation.
            "maxOutputTokens": max_tokens,
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
        print(f"[ERROR] _call_gemini request: {e}")
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
    return json.loads(raw)


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

    analysis = _call_gemini(prompt, max_tokens=4096)
    print(
        f"[OK] analyse_with_ai: mood={analysis.get('market_mood')} "
        f"nifty={analysis.get('nifty_bias')} signals={len(analysis.get('top_signals', []))}"
    )
    return analysis


# ── Pre-market report + per-stock analysis ────────────────────────────────────

_RECOMMENDATION_SCHEMA = """{
      "symbol": "TICKER (no .NS)",
      "current_price": 0.0,
      "bias": "bullish | bearish",
      "confidence_score": 0-100,
      "score_breakdown": {"technical": "x/40", "options": "x/20", "volume": "x/10",
                          "news": "x/10", "fundamentals": "x/20", "risk_deduction": -0},
      "technical_summary": "one sentence",
      "fundamental_summary": "one sentence (or 'n/a')",
      "news_summary": "one sentence (or 'no specific news')",
      "entry_zone": "e.g. 2950-2960",
      "stop_loss": 0.0,
      "target_1": 0.0,
      "target_2": 0.0,
      "risk_reward": "e.g. 1:2.5",
      "option_type": "CALL | PUT",
      "suggested_strike": "e.g. 3000 CE",
      "suggested_expiry": "nearest weekly/monthly expiry date",
      "scalping_suitability": "high | medium | low",
      "expected_holding_time": "e.g. 15-60 min",
      "key_risks": ["risk 1", "risk 2"],
      "why_selected": "2 sentences max"
    }"""


def premarket_report(
    scan: dict,
    sectors: list | None,
    nse: dict,
    headlines: list[str],
    strategy: dict,
) -> dict:
    """
    The big one: full pre-market analysis from the screener output + NSE
    derivatives context + sectors + news. Returns the report JSON.
    """
    def fmt_candidates(cands: list[dict]) -> str:
        blocks = []
        for c in cands:
            blocks.append(json.dumps({k: v for k, v in c.items() if v is not None},
                                     default=str))
        return "\n".join(blocks) or "(none)"

    chain = nse.get("nifty_chain") or {}
    bn_chain = nse.get("banknifty_chain") or {}
    vix = nse.get("vix") or {}
    fii = nse.get("fii_dii") or {}
    advances = scan.get("advances")
    declines = scan.get("declines")

    prompt = f"""You are a senior Indian equity derivatives analyst preparing an institutional pre-market briefing for an intraday options scalper. Analyse ALL layers below and return ONLY a JSON object.

## Strategy context
{strategy['name']} | min signal strength {strategy['min_signal_strength']} | risk/trade {strategy['risk_per_trade_pct']}%

## Index derivatives
NIFTY chain: {json.dumps(chain, default=str)}
BANKNIFTY chain: {json.dumps(bn_chain, default=str)}
India VIX: {vix.get('value')} ({vix.get('change_pct')}% change)
FII/DII (₹cr): FII {fii.get('fii_net_buy_sell')} | DII {fii.get('dii_net_buy_sell')} ({fii.get('date')})

## Sector performance (yesterday, strongest first)
{json.dumps(sectors or [], default=str)}

## Universe breadth
{advances} advancing / {declines} declining of {scan.get('total')} liquid F&O stocks scanned.

## Bullish candidates (quantitative screen — technicals, then options chain with ΔOI/IV, delivery %, fundamentals)
{fmt_candidates(scan.get('bulls', []))}

## Bearish candidates
{fmt_candidates(scan.get('bears', []))}

## Headlines (last 12h, Indian + global)
{chr(10).join('- ' + h for h in headlines[:15]) or '(none)'}

## Scoring rules — apply strictly
Score each candidate /100: technical /40, options-chain confirmation /20, volume confirmation /10, news sentiment /10, fundamentals /20, then subtract a risk deduction (earnings due, extreme IV, illiquid strikes, contradicting layers).
- Options layer: fresh put writing + rising OI support = bullish confirmation; call writing overhead = bearish. Use pcr, oi_signal, change_call_oi/change_put_oi, atm_iv.
- Volume: rvol >= 1.5 with delivery_pct >= 40 suggests institutional participation.
- ONLY include stocks scoring >= 85 in the final lists — max 5 per side, fewer is fine, zero is fine.
- Entry/SL/targets must be consistent with the stock's supports/resistances and ATR; risk:reward must be at least 1:1.5.
- Strikes must be realistic: nearest liquid strike to entry (round numbers), nearest expiry from the chain data.

## Report rules
- overall recommendation: GO (clean setup day) | CAUTION (tradeable, reduced size) | WARNING (only A+ setups) | STAY_OUT (event risk / chop) — justify it.
- Key levels must come from the OI strikes + max pain given above, not invented.
- If nothing scores >= 85, return empty opportunity arrays and set no_trade true with reason "No high-probability opportunities found today. Capital preservation is recommended."
- Be specific and honest; never pad weak candidates to fill 5 slots.

Return ONLY valid JSON with EXACTLY this schema:

{{
  "market_outlook": {{
    "sentiment": "bullish | bearish | neutral | mixed",
    "recommendation": "GO | CAUTION | WARNING | STAY_OUT",
    "confidence": 0-100,
    "bullish_prob": 0-100, "bearish_prob": 0-100, "rangebound_prob": 0-100,
    "why": "2-3 sentences"
  }},
  "overnight_summary": "US/Europe/Asia/GIFT/crude/USDINR read — 2-3 sentences from available data, say what's unknown",
  "domestic_summary": "yesterday's structure, breadth, FII/DII, VIX — 2-3 sentences",
  "sector_outlook": {{
    "bullish_sectors": ["top 3"], "bearish_sectors": ["bottom 3"],
    "comment": "1-2 sentences on rotation"
  }},
  "nifty_levels": {{"supports": [..], "resistances": [..]}},
  "banknifty_levels": {{"supports": [..], "resistances": [..]}},
  "call_opportunities": [ up to 5 of {_RECOMMENDATION_SCHEMA} ],
  "put_opportunities": [ up to 5, same schema ],
  "alerts": ["today's known events, expiry proximity, earnings, macro risks — from data given"],
  "risk_assessment": ["2-4 specific risk warnings"],
  "trading_plan": {{
    "style": "Scalping | Momentum | Breakout | Pullback | Mean Reversion | Defensive / No Trade",
    "why": "1-2 sentences"
  }},
  "no_trade": false,
  "no_trade_reason": ""
}}"""

    report = _call_gemini(prompt, max_tokens=16384)
    print(
        f"[OK] premarket_report: {report.get('market_outlook', {}).get('recommendation')} "
        f"| {len(report.get('call_opportunities', []))} calls "
        f"| {len(report.get('put_opportunities', []))} puts"
    )
    return report


def analyse_stock(snapshot: dict, headlines: list[str]) -> dict:
    """On-demand single-stock deep analysis for the /stock command."""
    prompt = f"""You are an Indian equity derivatives analyst. Give a full intraday-options-focused analysis of ONE stock from the data below. Return ONLY a JSON object.

## Stock data (technicals, options chain with ΔOI/IV, delivery %, fundamentals)
{json.dumps({k: v for k, v in snapshot.items() if v is not None}, default=str)}

## Recent headlines (may or may not be relevant to this stock)
{chr(10).join('- ' + h for h in headlines[:10]) or '(none)'}

Rules: be honest — if the picture is mixed, say so and set bias neutral with low confidence. Entry/SL/targets must respect the given supports/resistances and ATR. Strike = nearest liquid round strike; expiry = the chain's expiry. Note that price data is ~15 min delayed.

Return ONLY valid JSON with EXACTLY this schema:
{{
  "symbol": "TICKER",
  "bias": "bullish | bearish | neutral",
  "confidence_score": 0-100,
  "technical_summary": "2 sentences",
  "options_summary": "1-2 sentences on OI positioning / IV",
  "fundamental_summary": "1 sentence (or 'n/a')",
  "sentiment_summary": "1 sentence",
  "entry_zone": "range or 'no trade'",
  "stop_loss": 0.0,
  "target_1": 0.0,
  "target_2": 0.0,
  "risk_reward": "1:x",
  "option_suggestion": "e.g. 3000 CE, <expiry>' or 'none'",
  "scalping_suitability": "high | medium | low",
  "expected_holding_time": "e.g. 15-60 min",
  "key_risks": ["..."],
  "verdict": "one plain-English closing line"
}}"""

    result = _call_gemini(prompt, max_tokens=4096)
    print(f"[OK] analyse_stock: {result.get('symbol')} {result.get('bias')} "
          f"({result.get('confidence_score')})")
    return result
