"""
Index-option helpers: Black-Scholes greeks, strike comparison (ATM vs ITM),
liquidity checks and premium-based risk per lot.

No network. Chain rows come from nse_data.get_chain():
  {"strike": 25700, "CE": {ltp, bid, ask, oi, chg_oi, volume, iv}, "PE": {...}}

Deliberately biased toward liquid ATM / slightly-ITM strikes: a far-OTM
option is cheap because it rarely pays, and its delta is too small for an
intraday move to help it before theta does.
"""

from __future__ import annotations

import math
import os
from datetime import datetime

RISK_FREE = float(os.environ.get("RISK_FREE_RATE", "") or 0.06)


def _ncdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _npdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)


def years_to_expiry(expiry_date, now: datetime) -> float:
    """Calendar time to 15:30 IST on expiry day, in years (floor: 30 minutes)."""
    exp = datetime(expiry_date.year, expiry_date.month, expiry_date.day, 15, 30, tzinfo=now.tzinfo)
    secs = max((exp - now).total_seconds(), 1800)
    return secs / (365 * 24 * 3600)


def bs(spot: float, strike: float, t: float, iv_pct: float, kind: str, r: float = RISK_FREE) -> dict:
    """Price, delta and theta (₹ per day) for a European option."""
    sigma = max(iv_pct or 0, 1.0) / 100
    t = max(t, 1e-6)
    d1 = (math.log(spot / strike) + (r + sigma * sigma / 2) * t) / (sigma * math.sqrt(t))
    d2 = d1 - sigma * math.sqrt(t)
    disc = math.exp(-r * t)
    decay = -spot * _npdf(d1) * sigma / (2 * math.sqrt(t))
    if kind == "CE":
        price = spot * _ncdf(d1) - strike * disc * _ncdf(d2)
        delta = _ncdf(d1)
        theta = (decay - r * strike * disc * _ncdf(d2)) / 365
    else:
        price = strike * disc * _ncdf(-d2) - spot * _ncdf(-d1)
        delta = _ncdf(d1) - 1
        theta = (decay + r * strike * disc * _ncdf(-d2)) / 365
    return {"price": max(price, 0.05), "delta": delta, "theta": theta}


def strike_step(rows: list[dict], default: float) -> float:
    ks = sorted({r["strike"] for r in rows if r.get("strike") is not None})
    diffs = [b - a for a, b in zip(ks, ks[1:]) if b > a]
    return min(diffs) if diffs else default


def _spread_pct(leg: dict) -> float | None:
    bid, ask = leg.get("bid"), leg.get("ask")
    if not bid or not ask or ask < bid:
        return None
    mid = (bid + ask) / 2
    return round((ask - bid) / mid * 100, 2) if mid else None


def liquidity(leg: dict, max_oi: float) -> dict:
    """Plain-word liquidity verdict for one option leg."""
    sp = _spread_pct(leg)
    oi_share = (leg.get("oi") or 0) / max_oi if max_oi else 0
    vol = leg.get("volume") or 0
    if sp is None:
        spread_word = "spread n/a (pre-open / no quotes)"
    elif sp <= 1.0:
        spread_word = f"tight spread {sp}%"
    elif sp <= 2.5:
        spread_word = f"ok spread {sp}%"
    else:
        spread_word = f"WIDE spread {sp}%"
    ok = (sp is None or sp <= 2.5) and (oi_share >= 0.05 or vol > 0)
    return {"spread_pct": sp, "oi_share": round(oi_share, 2), "ok": bool(ok), "words": spread_word}


def compare_strikes(rows: list[dict], kind: str, level: float, spot: float, t: float,
                    fallback_iv: float | None, step: float) -> list[dict]:
    """
    ATM (at the trigger level) and one / two strikes ITM, each with premium,
    delta at the trigger, IV, theta, OI, ΔOI, volume and liquidity.
    """
    by_k = {r["strike"]: r for r in rows}
    atm = round(level / step) * step
    sign = -1 if kind == "CE" else 1  # ITM call = lower strike, ITM put = higher
    cands = [("ATM", atm), ("1 ITM", atm + sign * step), ("2 ITM", atm + sign * 2 * step)]
    max_oi = max(((r.get(kind) or {}).get("oi") or 0) for r in rows) if rows else 0
    out = []
    for label, k in cands:
        leg = (by_k.get(k) or {}).get(kind) or {}
        iv = leg.get("iv") or fallback_iv
        if not iv:
            continue
        now_g = bs(spot, k, t, iv, kind)
        at_trig = bs(level, k, t, iv, kind)
        out.append({
            "label": label, "strike": k, "kind": kind,
            "ltp": leg.get("ltp"), "iv": round(iv, 1), "iv_source": "chain" if leg.get("iv") else "VIX proxy",
            "delta_now": round(now_g["delta"], 2), "delta_at_trigger": round(at_trig["delta"], 2),
            "theta_day": round(now_g["theta"], 1),
            "premium_at_trigger": round(at_trig["price"], 1),
            "oi": leg.get("oi"), "chg_oi": leg.get("chg_oi"), "volume": leg.get("volume"),
            "liq": liquidity(leg, max_oi) if leg else {"ok": False, "words": "strike not in chain", "spread_pct": None, "oi_share": 0},
        })
    return out


def pick(cands: list[dict]) -> dict | None:
    """
    Prefer 1-ITM when its delta at the trigger is 0.55–0.72 and it is liquid
    (moves closer to the index, decays slower in % terms); else liquid ATM;
    never a far-OTM strike.
    """
    def d(c):
        return abs(c["delta_at_trigger"])
    itm = next((c for c in cands if c["label"] == "1 ITM"), None)
    atm = next((c for c in cands if c["label"] == "ATM"), None)
    if itm and itm["liq"]["ok"] and 0.55 <= d(itm) <= 0.72:
        return itm
    if atm and atm["liq"]["ok"]:
        return atm
    liquid = [c for c in cands if c["liq"]["ok"]]
    return liquid[0] if liquid else None


def trade_premiums(choice: dict, entry: float, stop: float, t1: float, t2: float,
                   t: float, iv: float) -> dict:
    """Estimated option premium at entry / stop / targets (same IV, same day)."""
    k, kind = choice["strike"], choice["kind"]
    f = lambda s: bs(s, k, t, iv, kind)["price"]  # noqa: E731
    e, s, a, b = f(entry), f(stop), f(t1), f(t2)
    return {"entry": round(e, 1), "stop": round(s, 1), "t1": round(a, 1), "t2": round(b, 1),
            "risk_pts": round(max(e - s, 0.5), 1)}


def size_position(risk_pts: float, lot: int, capital: float, risk_pct: float,
                  costs_per_lot: float = 100.0) -> dict:
    """Lots allowed so that one stop-out loses at most risk_pct of capital."""
    budget = capital * min(risk_pct, 1.0) / 100
    per_lot = risk_pts * lot + costs_per_lot
    lots = int(budget // per_lot) if per_lot > 0 else 0
    return {"lots": lots, "risk_per_lot": round(per_lot), "budget": round(budget),
            "capital_for_1_lot": round(per_lot * 100 / min(risk_pct, 1.0)),
            "risk_total": round(per_lot * lots)}


def choose_expiry(expiries: list, today, min_dte: int) -> tuple:
    """(expiry, dte, note): nearest expiry with at least `min_dte` calendar days left."""
    live = [e for e in expiries if e and e >= today]
    if not live:
        return None, None, "no expiry data"
    first = live[0]
    dte = (first - today).days
    if dte >= min_dte or len(live) == 1:
        return first, dte, ("expiry day — theta and gamma are extreme" if dte == 0 else "nearest expiry")
    nxt = live[1]
    return nxt, (nxt - today).days, (f"skipped {first:%d %b} ({dte}d left: theta crush / gamma risk) "
                                     f"for the next expiry")
