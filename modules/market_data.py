"""
Market data via yfinance — prices, technicals, watchlists.

Defensive throughout: a single symbol failing logs a [WARN] and is skipped,
never crashing the batch.
"""

import yfinance as yf

# ── Watchlists ────────────────────────────────────────────────────────────────

# Nifty 50 constituents (.NS) plus the two index symbols yfinance understands:
#   ^NSEI    → Nifty 50 index
#   ^NSEBANK → Nifty Bank (BankNifty) index
WATCHLIST_INDIA = [
    "^NSEI", "^NSEBANK",
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
    "HINDUNILVR.NS", "ITC.NS", "SBIN.NS", "BHARTIARTL.NS", "KOTAKBANK.NS",
    "AXISBANK.NS", "LT.NS", "MARUTI.NS", "ASIANPAINT.NS", "TITAN.NS",
    "BAJFINANCE.NS", "WIPRO.NS", "ULTRACEMCO.NS", "NESTLEIND.NS", "POWERGRID.NS",
    "SUNPHARMA.NS", "TATASTEEL.NS", "HCLTECH.NS", "M&M.NS",
    "NTPC.NS", "ONGC.NS", "COALINDIA.NS", "JSWSTEEL.NS", "GRASIM.NS",
]

# Top 20 most-liquid Nifty 50 names we actively scan for option signals.
WATCHLIST_STOCKS_TO_SCAN = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
    "HINDUNILVR.NS", "ITC.NS", "SBIN.NS", "BHARTIARTL.NS", "KOTAKBANK.NS",
    "AXISBANK.NS", "LT.NS", "MARUTI.NS", "ASIANPAINT.NS", "TITAN.NS",
    "BAJFINANCE.NS", "WIPRO.NS", "ULTRACEMCO.NS", "NESTLEIND.NS", "POWERGRID.NS",
]


def _compute_above_vwap(ticker: yf.Ticker) -> bool | None:
    """
    True if the latest price is above today's intraday VWAP.

    VWAP needs intraday bars, so we pull 1-day / 5-minute data. If that's
    unavailable (pre-market, holiday, network), return None rather than guess.
    """
    try:
        intra = ticker.history(period="1d", interval="5m")
        if intra.empty:
            return None
        typical = (intra["High"] + intra["Low"] + intra["Close"]) / 3
        vol = intra["Volume"]
        denom = vol.sum()
        if denom == 0:
            return None
        vwap = (typical * vol).sum() / denom
        return bool(intra["Close"].iloc[-1] > vwap)
    except Exception:
        return None


def get_price_data(symbols: list[str], period: str = "7d") -> list[dict]:
    """Price + basic technicals for each symbol. Skips symbols that fail."""
    results = []
    for symbol in symbols:
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period=period, interval="1d")
            info = ticker.fast_info

            if hist.empty:
                print(f"[WARN] get_price_data {symbol}: no history")
                continue

            closes = hist["Close"].tolist()
            volumes = hist["Volume"].tolist()
            today = closes[-1]
            prev = closes[-2] if len(closes) >= 2 else today
            pct_chg = ((today - prev) / prev) * 100 if prev else 0.0

            momentum_5d = ((today - closes[-5]) / closes[-5]) * 100 if len(closes) >= 5 else 0.0
            momentum_1w = ((today - closes[0]) / closes[0]) * 100 if len(closes) >= 2 else 0.0

            avg_vol = sum(volumes[-6:-1]) / 5 if len(volumes) >= 6 else (volumes[-1] or 1)
            vol_spike = volumes[-1] / avg_vol if avg_vol else 1.0

            results.append({
                "symbol": symbol,
                "price": round(today, 2),
                "change_pct": round(pct_chg, 2),
                "momentum_5d": round(momentum_5d, 2),
                "momentum_1w": round(momentum_1w, 2),
                "volume_spike": round(vol_spike, 2),
                "high_52w": getattr(info, "year_high", None),
                "low_52w": getattr(info, "year_low", None),
                "above_vwap": _compute_above_vwap(ticker),
            })
        except Exception as e:
            print(f"[WARN] get_price_data {symbol}: {e}")

    print(f"[OK] get_price_data: {len(results)}/{len(symbols)} symbols")
    return results


def get_sensex() -> dict | None:
    """
    BSE Sensex from Yahoo (^BSESN) — BSE's own API blocks non-browser clients.
    {last, change, change_pct, high, low, date}. Before the open this is the
    previous session; during market hours yfinance's last daily bar is live.
    """
    try:
        hist = yf.Ticker("^BSESN").history(period="5d", interval="1d")
        if hist.empty or len(hist) < 2:
            print("[WARN] get_sensex: insufficient history")
            return None
        last, prev = float(hist["Close"].iloc[-1]), float(hist["Close"].iloc[-2])
        result = {
            "last": round(last, 2),
            "change": round(last - prev, 2),
            "change_pct": round((last - prev) / prev * 100, 2) if prev else None,
            "high": round(float(hist["High"].iloc[-1]), 2),
            "low": round(float(hist["Low"].iloc[-1]), 2),
            "date": hist.index[-1].strftime("%d-%b-%Y"),
        }
        print(f"[OK] get_sensex: {result['last']} ({result['change_pct']}%) {result['date']}")
        return result
    except Exception as e:
        print(f"[ERROR] get_sensex: {e}")
        return None


def get_gift_nifty() -> dict | None:
    """
    GIFT Nifty for the /premarket command's AI pipeline.

    Uses the real GIFT Nifty print from NSE (gap_pct = GIFT Nifty's own
    overnight % change). Falls back to ^NSEI spot as a rough proxy only if
    NSE is unreachable.
    """
    from modules import nse_data
    real = nse_data.get_gift_nifty()
    if real:
        return {"proxy_symbol": "GIFT NIFTY (NSE IX)", "value": real["last"],
                "prev_close": None, "gap_pct": real["change_pct"]}
    try:
        ticker = yf.Ticker("^NSEI")
        hist = ticker.history(period="5d", interval="1d")
        if hist.empty or len(hist) < 2:
            print("[WARN] get_gift_nifty: insufficient history")
            return None
        last = hist["Close"].iloc[-1]
        prev = hist["Close"].iloc[-2]
        gap_pct = ((last - prev) / prev) * 100 if prev else 0.0
        result = {
            "proxy_symbol": "^NSEI",
            "value": round(last, 2),
            "prev_close": round(prev, 2),
            "gap_pct": round(gap_pct, 2),
        }
        print(f"[OK] get_gift_nifty (proxy ^NSEI): {result['value']} gap={result['gap_pct']}%")
        return result
    except Exception as e:
        print(f"[ERROR] get_gift_nifty: {e}")
        return None


# ── Global cues + index bars (trade-plan reports) ─────────────────────────────

GLOBAL_TICKERS = [
    # (label, Yahoo symbol, group)
    ("S&P 500", "^GSPC", "US"), ("Nasdaq", "^IXIC", "US"), ("Dow Jones", "^DJI", "US"),
    ("S&P 500 futures", "ES=F", "US"),
    ("Nikkei 225", "^N225", "Asia"), ("Hang Seng", "^HSI", "Asia"), ("KOSPI", "^KS11", "Asia"),
    ("Shanghai", "000001.SS", "Asia"),
    ("USD/INR", "INR=X", "Macro"), ("Dollar index", "DX-Y.NYB", "Macro"),
    ("Brent crude", "BZ=F", "Macro"), ("US 10Y yield", "^TNX", "Macro"), ("Gold", "GC=F", "Macro"),
]


def get_global_cues() -> list[dict]:
    """
    Latest close (or live price) and % change for US / Asian indices, USD/INR,
    DXY, Brent, US 10Y and gold: [{label, symbol, group, last, change_pct, as_of}].
    One batched Yahoo call; a symbol that fails is simply left out.
    """
    syms = [s for _, s, _ in GLOBAL_TICKERS]
    out = []
    try:
        df = yf.download(syms, period="7d", interval="1d", group_by="ticker",
                         progress=False, threads=True, auto_adjust=False)
    except Exception as e:
        print(f"[ERROR] get_global_cues: {e}")
        return out
    for label, sym, group in GLOBAL_TICKERS:
        try:
            closes = df[sym]["Close"].dropna()
            if len(closes) < 2:
                continue
            last, prev = float(closes.iloc[-1]), float(closes.iloc[-2])
            out.append({"label": label, "symbol": sym, "group": group, "last": round(last, 2),
                        "change_pct": round((last - prev) / prev * 100, 2) if prev else None,
                        "as_of": closes.index[-1].strftime("%d %b")})
        except Exception as e:
            print(f"[WARN] get_global_cues {sym}: {e}")
    print(f"[OK] get_global_cues: {len(out)}/{len(GLOBAL_TICKERS)}")
    return out


def get_bars(symbol: str, period: str, interval: str):
    """Yahoo OHLCV bars (IST index for NSE symbols), or None."""
    try:
        df = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=False)
        if df is None or df.empty:
            print(f"[WARN] get_bars {symbol} {interval}: empty")
            return None
        print(f"[OK] get_bars {symbol} {interval}: {len(df)} bars, last {df.index[-1]}")
        return df
    except Exception as e:
        print(f"[ERROR] get_bars {symbol} {interval}: {e}")
        return None


def get_index_bundle(yf_symbol: str, proxy_symbol: str | None) -> dict:
    """1y daily + 5d of 5-min bars for an index, plus 5-min bars of its tracking ETF."""
    return {
        "daily": get_bars(yf_symbol, "1y", "1d"),
        "intra": get_bars(yf_symbol, "5d", "5m"),
        "proxy": get_bars(proxy_symbol, "5d", "5m") if proxy_symbol else None,
    }
