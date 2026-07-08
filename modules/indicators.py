"""
Technical indicators — pure pandas, no TA-lib dependency.

Everything operates on a yfinance OHLCV daily DataFrame and is defensive:
compute_snapshot() returns whatever it can and never raises. Values are
rounded and NaNs become None so the output can go straight into a prompt
or JSON.
"""

import pandas as pd


def _f(x, nd: int = 2):
    """Round to nd digits; NaN/None → None."""
    try:
        if x is None or pd.isna(x):
            return None
        return round(float(x), nd)
    except Exception:
        return None


def ema(close: pd.Series, span: int) -> pd.Series:
    return close.ewm(span=span, adjust=False).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = gain / loss.replace(0, pd.NA)
    return 100 - (100 / (1 + rs))


def macd(close: pd.Series) -> tuple[pd.Series, pd.Series, pd.Series]:
    line = ema(close, 12) - ema(close, 26)
    signal = line.ewm(span=9, adjust=False).mean()
    return line, signal, line - signal


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["Close"].shift(1)
    return pd.concat([
        df["High"] - df["Low"],
        (df["High"] - prev_close).abs(),
        (df["Low"] - prev_close).abs(),
    ], axis=1).max(axis=1)


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    return true_range(df).ewm(alpha=1 / n, adjust=False).mean()


def adx(df: pd.DataFrame, n: int = 14) -> pd.Series:
    up = df["High"].diff()
    down = -df["Low"].diff()
    plus_dm = ((up > down) & (up > 0)) * up
    minus_dm = ((down > up) & (down > 0)) * down
    _atr = atr(df, n)
    plus_di = 100 * plus_dm.ewm(alpha=1 / n, adjust=False).mean() / _atr
    minus_di = 100 * minus_dm.ewm(alpha=1 / n, adjust=False).mean() / _atr
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, pd.NA)
    return dx.ewm(alpha=1 / n, adjust=False).mean()


def bollinger(close: pd.Series, n: int = 20, k: float = 2.0):
    mid = close.rolling(n).mean()
    sd = close.rolling(n).std()
    upper, lower = mid + k * sd, mid - k * sd
    pct_b = (close - lower) / (upper - lower)
    return upper, lower, pct_b


def supertrend_direction(df: pd.DataFrame, n: int = 10, mult: float = 3.0) -> str | None:
    """Return 'up' or 'down' for the latest bar (classic Supertrend flip logic)."""
    if len(df) < n + 2:
        return None
    hl2 = (df["High"] + df["Low"]) / 2
    _atr = atr(df, n)
    upper = (hl2 + mult * _atr).tolist()
    lower = (hl2 - mult * _atr).tolist()
    close = df["Close"].tolist()

    direction = 1
    final_upper, final_lower = upper[0], lower[0]
    for i in range(1, len(close)):
        final_upper = upper[i] if upper[i] < final_upper or close[i - 1] > final_upper else final_upper
        final_lower = lower[i] if lower[i] > final_lower or close[i - 1] < final_lower else final_lower
        if direction == 1 and close[i] < final_lower:
            direction, final_upper = -1, upper[i]
        elif direction == -1 and close[i] > final_upper:
            direction, final_lower = 1, lower[i]
    return "up" if direction == 1 else "down"


def swing_levels(df: pd.DataFrame, k: int = 3, max_levels: int = 3) -> tuple[list, list]:
    """
    Recent swing highs (resistance) and lows (support) via ±k pivot bars,
    nearest-to-price first.
    """
    highs, lows = df["High"], df["Low"]
    piv_high, piv_low = [], []
    for i in range(k, len(df) - k):
        window_h = highs.iloc[i - k:i + k + 1]
        window_l = lows.iloc[i - k:i + k + 1]
        if highs.iloc[i] == window_h.max():
            piv_high.append(float(highs.iloc[i]))
        if lows.iloc[i] == window_l.min():
            piv_low.append(float(lows.iloc[i]))
    price = float(df["Close"].iloc[-1])
    res = sorted({round(p, 2) for p in piv_high if p > price})[:max_levels]
    sup = sorted({round(p, 2) for p in piv_low if p < price}, reverse=True)[:max_levels]
    return sup, res


def market_structure(df: pd.DataFrame, k: int = 3) -> str:
    """'uptrend (HH/HL)' | 'downtrend (LH/LL)' | 'range' from the last two swings."""
    highs, lows = df["High"], df["Low"]
    piv_high, piv_low = [], []
    for i in range(k, len(df) - k):
        if highs.iloc[i] == highs.iloc[i - k:i + k + 1].max():
            piv_high.append(float(highs.iloc[i]))
        if lows.iloc[i] == lows.iloc[i - k:i + k + 1].min():
            piv_low.append(float(lows.iloc[i]))
    if len(piv_high) < 2 or len(piv_low) < 2:
        return "range"
    hh = piv_high[-1] > piv_high[-2]
    hl = piv_low[-1] > piv_low[-2]
    if hh and hl:
        return "uptrend (HH/HL)"
    if not hh and not hl:
        return "downtrend (LH/LL)"
    return "range"


def compute_snapshot(df: pd.DataFrame) -> dict | None:
    """
    Full technical snapshot from ~6 months of daily OHLCV.
    Returns None if there isn't enough data to say anything useful.
    """
    try:
        df = df.dropna(subset=["Close"])
        if len(df) < 30:
            return None
        close = df["Close"]
        price = float(close.iloc[-1])
        prev = float(close.iloc[-2])

        e20, e50 = ema(close, 20), ema(close, 50)
        e200 = ema(close, 200) if len(df) >= 60 else None
        macd_line, macd_sig, macd_hist = macd(close)
        _, _, bb_pctb = bollinger(close)
        atr_series = atr(df)
        sup, res = swing_levels(df.tail(90))

        vol = df["Volume"]
        rvol = None
        if len(vol) >= 21 and vol.iloc[-21:-1].mean() > 0:
            rvol = vol.iloc[-1] / vol.iloc[-21:-1].mean()

        hi_52w, lo_52w = float(df["High"].max()), float(df["Low"].min())

        return {
            "price": _f(price),
            "change_pct": _f((price - prev) / prev * 100),
            "mom_5d": _f((price / float(close.iloc[-6]) - 1) * 100) if len(close) > 6 else None,
            "mom_20d": _f((price / float(close.iloc[-21]) - 1) * 100) if len(close) > 21 else None,
            "rsi": _f(rsi(close).iloc[-1], 1),
            "macd_hist": _f(macd_hist.iloc[-1], 3),
            "macd_state": "bullish" if macd_line.iloc[-1] > macd_sig.iloc[-1] else "bearish",
            "ema20": _f(e20.iloc[-1]),
            "ema50": _f(e50.iloc[-1]),
            "ema200": _f(e200.iloc[-1]) if e200 is not None else None,
            "above_ema20": bool(price > e20.iloc[-1]),
            "ema_aligned_bull": bool(price > e20.iloc[-1] > e50.iloc[-1]),
            "ema_aligned_bear": bool(price < e20.iloc[-1] < e50.iloc[-1]),
            "supertrend": supertrend_direction(df),
            "adx": _f(adx(df).iloc[-1], 1),
            "atr_pct": _f(atr_series.iloc[-1] / price * 100),
            "bb_pctb": _f(bb_pctb.iloc[-1]),
            "rvol": _f(rvol),
            "structure": market_structure(df.tail(90)),
            "supports": sup,
            "resistances": res,
            "dist_52w_high_pct": _f((hi_52w - price) / price * 100),
            "dist_52w_low_pct": _f((price - lo_52w) / price * 100),
            "broke_prev_high": bool(price > float(df["High"].iloc[-2])),
            "broke_prev_low": bool(price < float(df["Low"].iloc[-2])),
        }
    except Exception as e:
        print(f"[WARN] compute_snapshot: {e}")
        return None
