"""
F&O stock screener — the quantitative first pass before the AI ranks.

Pipeline:
  1. screen_universe()  — batch-download 6 months of daily bars for the liquid
     F&O universe, compute a full technical snapshot + bull/bear pre-score.
  2. shortlist()        — top N bullish + top N bearish candidates by pre-score.
  3. deep_dive()        — for shortlisted names only (NSE rate limits): option
     chain with ΔOI/IV, delivery %, and fundamentals from Yahoo.

The pre-score exists to cut ~65 stocks down to ~16 cheaply; the AI does the
final institutional-style ranking with all data layers.
"""

import time

import yfinance as yf

from modules import indicators, nse_data

# Liquid F&O names (options tradable, tight spreads). Curated subset of the
# full ~190-stock F&O segment to fit CI time + NSE rate limits.
FNO_UNIVERSE = [
    # Banks / financials
    "HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS", "AXISBANK.NS", "KOTAKBANK.NS",
    "INDUSINDBK.NS", "BANKBARODA.NS", "PNB.NS", "CANBK.NS", "BAJFINANCE.NS",
    "BAJAJFINSV.NS", "HDFCLIFE.NS", "SBILIFE.NS", "CHOLAFIN.NS", "SHRIRAMFIN.NS",
    # IT  (LTIM.NS delisted from Yahoo — re-add under its new symbol if listed)
    "TCS.NS", "INFY.NS", "WIPRO.NS", "HCLTECH.NS", "TECHM.NS",
    "PERSISTENT.NS", "COFORGE.NS",
    # Auto (TATAMOTORS.NS gone after the CV/PV demerger — re-add the new
    # post-demerger symbols once confirmed on Yahoo)
    "M&M.NS", "MARUTI.NS", "BAJAJ-AUTO.NS", "EICHERMOT.NS",
    "HEROMOTOCO.NS", "TVSMOTOR.NS", "ASHOKLEY.NS",
    # Metals / commodities
    "TATASTEEL.NS", "JSWSTEEL.NS", "HINDALCO.NS", "VEDL.NS", "JINDALSTEL.NS",
    "NMDC.NS", "SAIL.NS",
    # Pharma / healthcare
    "SUNPHARMA.NS", "DRREDDY.NS", "CIPLA.NS", "DIVISLAB.NS", "APOLLOHOSP.NS",
    "LUPIN.NS", "AUROPHARMA.NS",
    # FMCG / consumer
    "HINDUNILVR.NS", "ITC.NS", "NESTLEIND.NS", "BRITANNIA.NS", "TATACONSUM.NS",
    "ASIANPAINT.NS", "TITAN.NS", "TRENT.NS", "DMART.NS",
    # Energy / infra / PSU
    "RELIANCE.NS", "ONGC.NS", "NTPC.NS", "POWERGRID.NS", "TATAPOWER.NS",
    "COALINDIA.NS", "BPCL.NS", "IOC.NS", "GAIL.NS", "ADANIENT.NS",
    "ADANIPORTS.NS", "LT.NS", "ULTRACEMCO.NS", "GRASIM.NS", "AMBUJACEM.NS",
    # Others
    "BHARTIARTL.NS", "DLF.NS", "GODREJPROP.NS", "HAL.NS", "BEL.NS",
    "SIEMENS.NS", "HAVELLS.NS", "PIDILITIND.NS", "INDIGO.NS", "IRCTC.NS",
]


def _nse_symbol(yf_symbol: str) -> str:
    return yf_symbol.removesuffix(".NS")


def prescore(snap: dict) -> dict:
    """
    Cheap quantitative bull/bear score (0–25 each) with the drivers that
    fired. Not the final confidence — just the shortlisting filter.
    """
    bull, bear, drivers = 0, 0, []

    def hit(side, pts, why):
        nonlocal bull, bear
        if side == "bull":
            bull += pts
        else:
            bear += pts
        drivers.append(why)

    if snap.get("ema_aligned_bull"):
        hit("bull", 3, "price > EMA20 > EMA50")
    if snap.get("ema_aligned_bear"):
        hit("bear", 3, "price < EMA20 < EMA50")

    rsi = snap.get("rsi")
    if rsi is not None:
        if 55 <= rsi <= 70:
            hit("bull", 2, f"RSI {rsi} in bullish momentum zone")
        elif 30 <= rsi <= 45:
            hit("bear", 2, f"RSI {rsi} in bearish momentum zone")
        elif rsi > 75:
            hit("bear", 1, f"RSI {rsi} overbought (reversal risk)")
        elif rsi < 25:
            hit("bull", 1, f"RSI {rsi} oversold (bounce risk)")

    if snap.get("macd_state") == "bullish" and (snap.get("macd_hist") or 0) > 0:
        hit("bull", 2, "MACD bullish")
    elif snap.get("macd_state") == "bearish" and (snap.get("macd_hist") or 0) < 0:
        hit("bear", 2, "MACD bearish")

    st = snap.get("supertrend")
    if st == "up":
        hit("bull", 2, "Supertrend up")
    elif st == "down":
        hit("bear", 2, "Supertrend down")

    adx = snap.get("adx")
    trending = adx is not None and adx >= 20
    if trending:
        side = "bull" if snap.get("above_ema20") else "bear"
        hit(side, 2 if adx >= 30 else 1, f"ADX {adx} — trending")

    structure = snap.get("structure") or ""
    if "uptrend" in structure:
        hit("bull", 3, structure)
    elif "downtrend" in structure:
        hit("bear", 3, structure)

    rvol = snap.get("rvol")
    if rvol is not None and rvol >= 1.5:
        side = "bull" if (snap.get("change_pct") or 0) >= 0 else "bear"
        hit(side, 3 if rvol >= 2.5 else 2, f"RVOL {rvol}x")

    mom = snap.get("mom_5d")
    if mom is not None:
        if mom >= 3:
            hit("bull", 2, f"5d momentum +{mom}%")
        elif mom <= -3:
            hit("bear", 2, f"5d momentum {mom}%")

    if (snap.get("dist_52w_high_pct") or 99) < 3:
        hit("bull", 2, "within 3% of 52w high (breakout zone)")
    if (snap.get("dist_52w_low_pct") or 99) < 3:
        hit("bear", 2, "within 3% of 52w low (breakdown zone)")

    if snap.get("broke_prev_high"):
        hit("bull", 1, "closed above previous day's high")
    if snap.get("broke_prev_low"):
        hit("bear", 1, "closed below previous day's low")

    return {"bull_score": bull, "bear_score": bear, "drivers": drivers}


def screen_universe(symbols: list[str] | None = None) -> list[dict]:
    """Technical snapshot + pre-score for every symbol in one batch download."""
    symbols = symbols or FNO_UNIVERSE
    try:
        data = yf.download(
            symbols, period="6mo", interval="1d", auto_adjust=True,
            group_by="ticker", threads=True, progress=False,
        )
    except Exception as e:
        print(f"[ERROR] screen_universe download: {e}")
        return []

    rows = []
    for sym in symbols:
        try:
            df = data[sym] if len(symbols) > 1 else data
            snap = indicators.compute_snapshot(df)
            if snap is None:
                print(f"[WARN] screen_universe {sym}: insufficient data")
                continue
            snap["symbol"] = sym
            snap.update(prescore(snap))
            rows.append(snap)
        except Exception as e:
            print(f"[WARN] screen_universe {sym}: {e}")

    print(f"[OK] screen_universe: {len(rows)}/{len(symbols)} scanned")
    return rows


def shortlist(rows: list[dict], n: int = 8) -> tuple[list[dict], list[dict]]:
    """Top n bullish and top n bearish candidates, minimum score 8."""
    bulls = sorted(
        (r for r in rows if r["bull_score"] >= 8 and r["bull_score"] > r["bear_score"]),
        key=lambda r: r["bull_score"], reverse=True,
    )[:n]
    bears = sorted(
        (r for r in rows if r["bear_score"] >= 8 and r["bear_score"] > r["bull_score"]),
        key=lambda r: r["bear_score"], reverse=True,
    )[:n]
    print(f"[OK] shortlist: {len(bulls)} bullish / {len(bears)} bearish candidates")
    return bulls, bears


def fetch_fundamentals(yf_symbol: str) -> dict:
    """Confidence-filter fundamentals from Yahoo. Best-effort, never raises."""
    try:
        info = yf.Ticker(yf_symbol).info or {}
        pct = lambda v: round(v * 100, 2) if isinstance(v, (int, float)) else None
        out = {
            "pe": round(info["trailingPE"], 1) if isinstance(info.get("trailingPE"), (int, float)) else None,
            "roe_pct": pct(info.get("returnOnEquity")),
            "debt_to_equity": round(info["debtToEquity"], 1) if isinstance(info.get("debtToEquity"), (int, float)) else None,
            "revenue_growth_pct": pct(info.get("revenueGrowth")),
            "earnings_growth_pct": pct(info.get("earningsGrowth")),
            "institutional_holding_pct": pct(info.get("heldPercentInstitutions")),
        }
        return {k: v for k, v in out.items() if v is not None}
    except Exception as e:
        print(f"[WARN] fetch_fundamentals {yf_symbol}: {e}")
        return {}


def deep_dive(candidates: list[dict], pause: float = 1.0,
              delivery_map: dict | None = None) -> list[dict]:
    """
    Enrich shortlisted candidates in place with options chain, delivery %
    and fundamentals. Paced to stay under NSE rate limits. Pass a shared
    delivery_map (from nse_data.get_delivery_map) to avoid refetching.
    """
    if delivery_map is None:
        delivery_map = nse_data.get_delivery_map()
    for c in candidates:
        nse_sym = _nse_symbol(c["symbol"])
        c["options"] = nse_data.get_stock_options_oi(nse_sym)
        c["delivery_pct"] = delivery_map.get(nse_sym)
        c["fundamentals"] = fetch_fundamentals(c["symbol"])
        time.sleep(pause)
    return candidates


def single_stock(yf_symbol: str) -> dict | None:
    """Full snapshot + deep dive for one stock (used by /stock)."""
    try:
        df = yf.Ticker(yf_symbol).history(period="6mo", interval="1d")
        snap = indicators.compute_snapshot(df)
        if snap is None:
            return None
        snap["symbol"] = yf_symbol
        snap.update(prescore(snap))
        deep_dive([snap], pause=0)
        return snap
    except Exception as e:
        print(f"[ERROR] single_stock {yf_symbol}: {e}")
        return None
