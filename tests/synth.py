"""Synthetic NSE-like bars for offline tests (no network)."""
import numpy as np
import pandas as pd

TZ = "Asia/Kolkata"


def daily(n=260, start=24000.0, seed=1, end="2026-11-24"):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(end=end, periods=n, tz=TZ)
    c = start * np.exp(np.cumsum(rng.normal(0.0004, 0.009, n)))
    o = c * (1 + rng.normal(0, 0.003, n))
    h = np.maximum(o, c) * (1 + np.abs(rng.normal(0, 0.004, n)))
    l = np.minimum(o, c) * (1 - np.abs(rng.normal(0, 0.004, n)))
    return pd.DataFrame({"Open": o, "High": h, "Low": l, "Close": c, "Volume": 0.0}, index=idx)


def intraday(days, start=25000.0, seed=2, drift=0.0, upto="15:25", vol=True):
    """5-min bars for the given dates (list of 'YYYY-MM-DD'); last day cut at `upto`."""
    rng = np.random.default_rng(seed)
    frames, px = [], start
    for j, d in enumerate(days):
        end = upto if j == len(days) - 1 else "15:25"
        idx = pd.date_range(f"{d} 09:15", f"{d} {end}", freq="5min", tz=TZ)
        steps = rng.normal(drift, 0.0012, len(idx))
        c = px * np.exp(np.cumsum(steps))
        o = np.concatenate([[px], c[:-1]])
        h = np.maximum(o, c) * (1 + np.abs(rng.normal(0, 0.0005, len(idx))))
        l = np.minimum(o, c) * (1 - np.abs(rng.normal(0, 0.0005, len(idx))))
        v = rng.integers(1000, 5000, len(idx)).astype(float) if vol else np.zeros(len(idx))
        frames.append(pd.DataFrame({"Open": o, "High": h, "Low": l, "Close": c, "Volume": v}, index=idx))
        px = c[-1]
    return pd.concat(frames)


def chain(spot, step=50, expiry=None, n=20, iv=13.0):
    from datetime import date
    expiry = expiry or date(2026, 12, 1)
    atm = round(spot / step) * step
    rows = []
    for k in range(-n, n + 1):
        s = atm + k * step
        ce_ltp = max(spot - s, 0) + max(5, 120 - abs(k) * 12)
        pe_ltp = max(s - spot, 0) + max(5, 120 - abs(k) * 12)
        rows.append({"strike": s,
                     "CE": {"ltp": ce_ltp, "bid": ce_ltp - 0.5, "ask": ce_ltp + 0.5, "oi": 100000 - abs(k - 4) * 4000,
                            "chg_oi": 5000, "volume": 200000, "iv": iv},
                     "PE": {"ltp": pe_ltp, "bid": pe_ltp - 0.5, "ask": pe_ltp + 0.5, "oi": 100000 - abs(k + 4) * 4000,
                            "chg_oi": 7000, "volume": 200000, "iv": iv}})
    summary = {"pcr": 1.1, "top_call_oi_strikes": [atm + 4 * step], "top_put_oi_strikes": [atm - 4 * step],
               "max_pain": atm, "change_call_oi": 1, "change_put_oi": 2, "oi_signal": "balanced", "spot": spot}
    return {"expiry": expiry, "expiries": [expiry], "dte": (expiry - date(2026, 11, 25)).days,
            "expiry_note": "nearest expiry", "spot": spot, "rows": rows, "summary": summary}


def market(days, start=25300.0, seed=3, drift=0.0, upto="15:25", hist=250, vol=True, last_drift=None):
    """Consistent (daily, intraday): 5-min sessions for `days`, daily = history + those sessions."""
    rng = np.random.default_rng(seed)
    frames, px = [], start
    for j, d in enumerate(days):
        end = upto if j == len(days) - 1 else "15:25"
        idx = pd.date_range(f"{d} 09:15", f"{d} {end}", freq="5min", tz=TZ)
        dr = last_drift if (last_drift is not None and j == len(days) - 1) else drift
        gap = rng.normal(0, 0.002)
        steps = rng.normal(dr, 0.0011, len(idx))
        c = px * (1 + gap) * np.exp(np.cumsum(steps))
        o = np.concatenate([[px * (1 + gap)], c[:-1]])
        h = np.maximum(o, c) * (1 + np.abs(rng.normal(0, 0.0004, len(idx))))
        l = np.minimum(o, c) * (1 - np.abs(rng.normal(0, 0.0004, len(idx))))
        v = rng.integers(1000, 5000, len(idx)).astype(float) if vol else np.zeros(len(idx))
        frames.append(pd.DataFrame({"Open": o, "High": h, "Low": l, "Close": c, "Volume": v}, index=idx))
        px = c[-1]
    intra = pd.concat(frames)
    sess = intra.groupby(intra.index.date).agg({"Open": "first", "High": "max", "Low": "min", "Close": "last"})
    sess.index = pd.DatetimeIndex([pd.Timestamp(d, tz=TZ) for d in sess.index])
    first_open = float(sess["Open"].iloc[0])
    h = daily(n=hist, start=first_open * 0.9, seed=seed + 7, end=str(sess.index[0].date() - pd.Timedelta(days=1)))
    h = h * (first_open / float(h["Close"].iloc[-1]))
    h["Volume"] = 0.0
    sess["Volume"] = 0.0
    return pd.concat([h, sess]), intra
