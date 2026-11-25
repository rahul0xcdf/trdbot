"""
Price-action building blocks for the Nifty / Bank Nifty reports.

Pure pandas, no network. Everything takes OHLCV DataFrames indexed by an
IST DatetimeIndex (yfinance's NSE bars already are) and returns plain
floats / dicts so the result can go straight into a report or a prompt.

Conventions
  * intraday frames have columns Open, High, Low, Close and a weight column
    "W" (traded volume used for VWAP / value area — see add_weights()).
  * a "session" is one NSE trading day, 09:15–15:30 IST.
"""

from __future__ import annotations

import math

import pandas as pd

SESSION_OPEN = (9, 15)
SESSION_CLOSE = (15, 30)


def _r(x, nd: int = 2):
    try:
        if x is None or (isinstance(x, float) and math.isnan(x)) or pd.isna(x):
            return None
        return round(float(x), nd)
    except Exception:
        return None


# ── Frames and sessions ───────────────────────────────────────────────────────

def clean(df: pd.DataFrame | None) -> pd.DataFrame:
    """OHLCV frame with numeric columns and no empty rows (never raises)."""
    if df is None or len(df) == 0:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    if isinstance(df.columns, pd.MultiIndex):  # yf.download with one ticker
        df = df.droplevel(-1, axis=1) if df.columns.nlevels > 1 else df
    cols = [c for c in ("Open", "High", "Low", "Close", "Volume") if c in df.columns]
    out = df[cols].apply(pd.to_numeric, errors="coerce").dropna(subset=["Close"])
    if "Volume" not in out.columns:
        out["Volume"] = 0.0
    out["Volume"] = out["Volume"].fillna(0.0)
    return out[~out.index.duplicated(keep="last")].sort_index()


def add_weights(index_bars: pd.DataFrame, proxy_bars: pd.DataFrame | None = None) -> tuple[pd.DataFrame, str]:
    """
    Attach a "W" (volume weight) column used for VWAP and the value area.

    An index has no traded volume of its own (Yahoo reports 0), so we weight
    each index bar by the volume of a tracking ETF in the same 5-min bar
    (NIFTYBEES for Nifty, BANKBEES for Bank Nifty). If neither has volume
    we fall back to equal weights (a TWAP) and say so.
    Returns (frame, source) where source is "index volume" | "ETF proxy volume" | "equal weights".
    """
    df = index_bars.copy()
    if len(df) and df["Volume"].sum() > 0:
        df["W"] = df["Volume"].astype(float)
        return df, "index volume"
    if proxy_bars is not None and len(proxy_bars) and proxy_bars["Volume"].sum() > 0:
        w = proxy_bars["Volume"].reindex(df.index).fillna(0.0)
        if w.sum() > 0:
            # A bar where the ETF printed nothing still deserves some weight.
            floor = max(float(w[w > 0].median()) * 0.05, 1.0)
            df["W"] = w.clip(lower=floor)
            return df, "ETF proxy volume"
    df["W"] = 1.0
    return df, "equal weights"


def sessions(df: pd.DataFrame) -> dict:
    """{date: frame} of regular-session bars, oldest first."""
    if len(df) == 0:
        return {}
    t = df.index
    mins = t.hour * 60 + t.minute
    o = SESSION_OPEN[0] * 60 + SESSION_OPEN[1]
    c = SESSION_CLOSE[0] * 60 + SESSION_CLOSE[1]
    reg = df[(mins >= o) & (mins < c)]
    return {d: g for d, g in reg.groupby(reg.index.date)}


def resample(day: pd.DataFrame, minutes: int) -> pd.DataFrame:
    """Aggregate a session's bars into `minutes` bars anchored at 09:15."""
    if len(day) == 0:
        return day
    agg = {"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum"}
    if "W" in day.columns:
        agg["W"] = "sum"
    anchor = day.index[0].normalize() + pd.Timedelta(hours=SESSION_OPEN[0], minutes=SESSION_OPEN[1])
    out = day.resample(f"{minutes}min", origin=anchor, label="left", closed="left").agg(agg)
    return out.dropna(subset=["Close"])


# ── Daily references ──────────────────────────────────────────────────────────

def floor_pivots(high: float, low: float, close: float) -> dict:
    """Classic floor pivots + CPR from one session's H/L/C."""
    p = (high + low + close) / 3
    bc = (high + low) / 2
    tc = 2 * p - bc
    rng = high - low
    return {
        "P": _r(p), "TC": _r(max(tc, bc)), "BC": _r(min(tc, bc)),
        "R1": _r(2 * p - low), "S1": _r(2 * p - high),
        "R2": _r(p + rng), "S2": _r(p - rng),
        "cpr_width_pct": _r(abs(tc - bc) / p * 100, 3) if p else None,
    }


def close_location(high: float, low: float, close: float) -> float | None:
    """Where the close sits in the day's range: 0 = at the low, 1 = at the high."""
    if high is None or low is None or high <= low:
        return None
    return round((close - low) / (high - low), 2)


def candle_pattern(o: float, h: float, l: float, c: float,
                   po: float | None = None, ph: float | None = None,
                   pl: float | None = None, pc: float | None = None) -> dict:
    """
    Name the session's candle in plain words.
    Returns {"name": ..., "meaning": ...}. Uses the prior candle (po/ph/pl/pc)
    for two-candle patterns when given.
    """
    rng = h - l
    if rng <= 0:
        return {"name": "flat", "meaning": "no range — no information"}
    body = abs(c - o)
    upper = h - max(o, c)
    lower = min(o, c) - l
    bull = c > o

    if po is not None and ph is not None and pl is not None and pc is not None:
        prev_body = abs(pc - po)
        if bull and pc < po and c >= po and o <= pc and body > prev_body:
            return {"name": "bullish engulfing",
                    "meaning": "buyers overwhelmed the previous day's sellers"}
        if (not bull) and pc > po and c <= po and o >= pc and body > prev_body:
            return {"name": "bearish engulfing",
                    "meaning": "sellers overwhelmed the previous day's buyers"}
        if h <= ph and l >= pl:
            return {"name": "inside bar",
                    "meaning": "range contraction inside yesterday's range — a breakout is pending, direction unknown"}
        if h > ph and l < pl:
            return {"name": "outside bar",
                    "meaning": "took out both yesterday's high and low — volatile, two-sided session"}

    if body <= 0.1 * rng:
        if upper > 2 * max(lower, 1e-9) and upper > 0.6 * rng:
            return {"name": "gravestone doji", "meaning": "rally rejected — sellers defended the highs"}
        if lower > 2 * max(upper, 1e-9) and lower > 0.6 * rng:
            return {"name": "dragonfly doji", "meaning": "sell-off rejected — buyers defended the lows"}
        return {"name": "doji", "meaning": "indecision — buyers and sellers balanced"}
    if lower >= 2 * body and upper <= 0.25 * rng:
        return {"name": "hammer" if bull else "hanging man",
                "meaning": "long lower wick — dips were bought"}
    if upper >= 2 * body and lower <= 0.25 * rng:
        return {"name": "inverted hammer" if bull else "shooting star",
                "meaning": "long upper wick — rallies were sold"}
    if body >= 0.8 * rng:
        return {"name": "bullish marubozu" if bull else "bearish marubozu",
                "meaning": ("buyers in control from open to close" if bull
                            else "sellers in control from open to close")}
    if body >= 0.5 * rng:
        return {"name": "strong bullish candle" if bull else "strong bearish candle",
                "meaning": "clear directional session" }
    return {"name": "small-bodied candle", "meaning": "mixed session, no strong conviction"}


# ── Intraday references ───────────────────────────────────────────────────────

def vwap_series(day: pd.DataFrame) -> pd.Series:
    """Running session VWAP from typical price × weight."""
    tp = (day["High"] + day["Low"] + day["Close"]) / 3
    w = day["W"] if "W" in day.columns else pd.Series(1.0, index=day.index)
    cw = w.cumsum().replace(0, float("nan"))
    return (tp * w).cumsum() / cw


def value_area(day: pd.DataFrame, step: float, pct: float = 0.70) -> dict:
    """
    Volume profile of one session: POC (most traded price), VAH / VAL (the
    band holding `pct` of the weight). Each bar's weight is spread evenly
    over the price bins it covered.
    """
    if len(day) == 0 or step <= 0:
        return {"poc": None, "vah": None, "val": None}
    w = day["W"] if "W" in day.columns else pd.Series(1.0, index=day.index)
    profile: dict[float, float] = {}
    for (lo, hi, wt) in zip(day["Low"], day["High"], w):
        # bin k covers [k*step, (k+1)*step); a high exactly on an edge stays in the bin below
        a = math.floor(lo / step)
        b = max(a, math.ceil(hi / step) - 1)
        n = b - a + 1
        for k in range(a, b + 1):
            profile[k] = profile.get(k, 0.0) + wt / n
    if not profile:
        return {"poc": None, "vah": None, "val": None}
    keys = sorted(profile)
    total = sum(profile.values())
    tp = (day["High"] + day["Low"] + day["Close"]) / 3
    centre = float((tp * w).sum() / w.sum()) / step if float(w.sum()) else keys[len(keys) // 2]
    # ties → the bin nearest the session's volume-weighted average price
    poc_k = max(keys, key=lambda k: (round(profile[k], 9), -abs(k + 0.5 - centre)))
    lo_i = hi_i = keys.index(poc_k)
    acc = profile[poc_k]
    while acc < pct * total and (lo_i > 0 or hi_i < len(keys) - 1):
        up = profile[keys[hi_i + 1]] if hi_i < len(keys) - 1 else -1
        dn = profile[keys[lo_i - 1]] if lo_i > 0 else -1
        if up >= dn:
            hi_i += 1
            acc += profile[keys[hi_i]]
        else:
            lo_i -= 1
            acc += profile[keys[lo_i]]
    mid = lambda k: (k + 0.5) * step  # noqa: E731
    return {"poc": _r(mid(poc_k)), "vah": _r((keys[hi_i] + 1) * step), "val": _r(keys[lo_i] * step)}


def opening_range(day: pd.DataFrame, minutes: int) -> dict:
    """High / low of the first `minutes` of the session (needs those bars to exist)."""
    if len(day) == 0:
        return {"high": None, "low": None, "complete": False}
    start = day.index[0].normalize() + pd.Timedelta(hours=SESSION_OPEN[0], minutes=SESSION_OPEN[1])
    end = start + pd.Timedelta(minutes=minutes)
    first = day[day.index < end]
    if len(first) == 0:
        return {"high": None, "low": None, "complete": False}
    return {"high": _r(first["High"].max()), "low": _r(first["Low"].min()),
            "complete": bool((day.index >= end).any())}


def swings(df: pd.DataFrame, k: int = 2) -> list[dict]:
    """Swing highs/lows: a bar whose high (low) is the extreme of ±k bars."""
    out = []
    hi, lo = df["High"].tolist(), df["Low"].tolist()
    for i in range(k, len(df) - k):
        if hi[i] == max(hi[i - k:i + k + 1]):
            out.append({"t": df.index[i], "price": _r(hi[i]), "kind": "H"})
        if lo[i] == min(lo[i - k:i + k + 1]):
            out.append({"t": df.index[i], "price": _r(lo[i]), "kind": "L"})
    return out


def structure(df: pd.DataFrame, k: int = 2) -> dict:
    """
    Market structure from the last two swing highs and lows.
    label: "higher highs / higher lows" | "lower highs / lower lows" | "mixed (range)".
    """
    sw = swings(df, k)
    highs = [s["price"] for s in sw if s["kind"] == "H"]
    lows = [s["price"] for s in sw if s["kind"] == "L"]
    if len(highs) < 2 or len(lows) < 2:
        return {"label": "not enough swings yet", "trend": 0, "last_high": highs[-1] if highs else None,
                "last_low": lows[-1] if lows else None}
    hh, hl = highs[-1] > highs[-2], lows[-1] > lows[-2]
    if hh and hl:
        label, trend = "higher highs / higher lows", 1
    elif not hh and not hl:
        label, trend = "lower highs / lower lows", -1
    else:
        label, trend = "mixed (range)", 0
    return {"label": label, "trend": trend, "last_high": highs[-1], "last_low": lows[-1],
            "prev_high": highs[-2], "prev_low": lows[-2]}


def vwap_behaviour(day: pd.DataFrame, vwap: pd.Series, tol: float) -> dict:
    """
    How price treated VWAP during a session.
      crosses      — times the bar close flipped sides
      pct_above    — share of closes above VWAP
      holds        — bars that tagged VWAP (within tol) and closed back on the trend side
      label        — "respected as support" | "respected as resistance" |
                     "rejected / chopped around" | "mostly above" | "mostly below"
    """
    if len(day) == 0 or vwap.isna().all():
        return {"crosses": None, "pct_above": None, "label": "unknown", "holds": 0}
    close = day["Close"]
    side = (close > vwap).astype(int).replace(0, -1)
    crosses = int((side.diff().abs() > 0).sum())
    pct_above = round(float((side > 0).mean()) * 100)
    sup_holds = int(((day["Low"] <= vwap + tol) & (close > vwap)).sum())
    res_holds = int(((day["High"] >= vwap - tol) & (close < vwap)).sum())
    if crosses <= 2 and pct_above >= 75:
        label = "respected as support" if sup_holds >= 1 else "mostly above"
    elif crosses <= 2 and pct_above <= 25:
        label = "respected as resistance" if res_holds >= 1 else "mostly below"
    elif crosses >= 5:
        label = "rejected / chopped around"
    else:
        label = "mostly above" if pct_above >= 50 else "mostly below"
    return {"crosses": crosses, "pct_above": pct_above, "label": label,
            "holds": sup_holds if pct_above >= 50 else res_holds}


def level_tests(day: pd.DataFrame, level: float, name: str, confirm: int = 2) -> list[dict]:
    """
    Breakout / breakdown attempts at `level` on a session's bars.

    An attempt starts when a bar trades through the level. It "held" if the
    next `confirm` closes stayed beyond it, and "failed" (a false breakout)
    if price closed back on the original side within those bars.
    """
    if level is None or len(day) < 2:
        return []
    events, i = [], 1
    closes, highs, lows = day["Close"].tolist(), day["High"].tolist(), day["Low"].tolist()
    while i < len(day):
        prev_c = closes[i - 1]
        for direction in ("up", "down"):
            if direction == "up" and prev_c <= level < highs[i]:
                after = closes[i:i + confirm + 1]
                failed = any(c <= level for c in after[1:]) or after[0] <= level
                events.append({"level": name, "price": _r(level), "direction": "up",
                               "time": day.index[i], "failed": bool(failed),
                               "extreme": _r(max(highs[i:i + confirm + 1]))})
                i += confirm
                break
            if direction == "down" and prev_c >= level > lows[i]:
                after = closes[i:i + confirm + 1]
                failed = any(c >= level for c in after[1:]) or after[0] >= level
                events.append({"level": name, "price": _r(level), "direction": "down",
                               "time": day.index[i], "failed": bool(failed),
                               "extreme": _r(min(lows[i:i + confirm + 1]))})
                i += confirm
                break
        i += 1
    return events


def rel_volume(sess: dict, today, upto=None) -> float | None:
    """Today's weight so far vs the average of prior sessions over the same clock window."""
    if today not in sess:
        return None
    day = sess[today]
    if "W" not in day.columns or day["W"].nunique() <= 1:
        return None
    cut = upto or day.index[-1]
    t_cut = cut.hour * 60 + cut.minute
    now_w = float(day[(day.index.hour * 60 + day.index.minute) <= t_cut]["W"].sum())
    prior = []
    for d, g in sess.items():
        if d >= today:
            continue
        mins = g.index.hour * 60 + g.index.minute
        prior.append(float(g[mins <= t_cut]["W"].sum()))
    prior = [p for p in prior[-5:] if p > 0]
    if not prior or now_w <= 0:
        return None
    return round(now_w / (sum(prior) / len(prior)), 2)


def trendlines(df: pd.DataFrame, k: int = 3) -> dict:
    """
    Simple swing trendlines on daily bars:
      support    — line through the last two swing LOWS if the second is higher (rising)
      resistance — line through the last two swing HIGHS if the second is lower (falling)
    Each: {"today": value projected to the bar after the last one, "next": one bar further,
           "from": (date, price), "to": (date, price)}. Missing when there is no such trend.
    """
    out: dict = {}
    if len(df) < 2 * k + 3:
        return out
    pos = {t: n for n, t in enumerate(df.index)}
    sw = swings(df, k)
    last_i = len(df) - 1
    for kind, key, ok in (("L", "support", lambda a, b: b > a), ("H", "resistance", lambda a, b: b < a)):
        pts = [s for s in sw if s["kind"] == kind][-2:]
        if len(pts) < 2:
            continue
        (t1, p1), (t2, p2) = (pts[0]["t"], pts[0]["price"]), (pts[1]["t"], pts[1]["price"])
        i1, i2 = pos[t1], pos[t2]
        if i2 <= i1 or not ok(p1, p2):
            continue
        slope = (p2 - p1) / (i2 - i1)
        close = float(df["Close"].iloc[-1])
        today = p2 + slope * (last_i + 1 - i2)
        # A line price has already decisively crossed is broken, not a level.
        if (key == "support" and close < today * 0.995) or (key == "resistance" and close > today * 1.005):
            continue
        out[key] = {"today": _r(today), "next": _r(today + slope), "from": (t1.date(), p1), "to": (t2.date(), p2),
                    "slope_per_day": _r(slope)}
    return out


# ── Level maths ───────────────────────────────────────────────────────────────

def cluster(levels: list[tuple[str, float]], tol: float) -> list[dict]:
    """
    Merge levels closer than `tol` into zones: [{price, names}], sorted by price.
    The zone price is the mean of its members.
    """
    pts = sorted(((n, float(p)) for n, p in levels if p is not None), key=lambda x: x[1])
    zones: list[dict] = []
    for name, p in pts:
        if zones and p - zones[-1]["_hi"] <= tol:
            z = zones[-1]
            z["names"].append(name)
            z["_vals"].append(p)
            z["_hi"] = p
        else:
            zones.append({"names": [name], "_vals": [p], "_hi": p})
    out = []
    for z in zones:
        out.append({"price": _r(sum(z["_vals"]) / len(z["_vals"])),
                    "names": list(dict.fromkeys(z["names"]))})
    return out


def zone_label(z: dict) -> str:
    return f"{z['price']:,.0f} ({' + '.join(z['names'][:3])})"
