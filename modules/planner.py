"""
Trade-plan engine for NIFTY 50 and BANK NIFTY.

Turns raw bars + option chain into the numbers the reports print: key
levels, the bullish / bearish / no-trade scenarios, the option to use, the
risk per lot and the final TRADE DECISION.

Everything numeric is decided HERE, by fixed rules, never by the AI:
  * an entry is always "confirmation first": a 15-min CLOSE beyond a level,
    then a retest that holds (or, intraday, a pullback to VWAP that holds);
  * stop-loss = just beyond the level that should hold (ATR-based buffer);
  * targets = the next real levels (prior-day H/L/C, VWAP, value area,
    pivots, swing points, option-OI walls); no level → measured R-multiples;
  * a setup whose first target pays less than 1.5× the risk is NO TRADE;
  * size so a stop-out loses ≤ RISK_PCT (max 1%) of TRADING_CAPITAL; if even
    one lot breaks that, the answer is NO TRADE at this capital.
The AI only explains these numbers in plain words.
"""

from __future__ import annotations

import os
from datetime import datetime

import pandas as pd

from modules import indicators, levels as lv, options as opt

MIN_RR = 1.5
NO_NEW_TRADES_AFTER = (14, 45)
SQUARE_OFF_BY = "3:15 PM"


def _env_num(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


INDICES = {
    "NIFTY": {"label": "NIFTY 50", "yf": "^NSEI", "proxy": "NIFTYBEES.NS", "nse": "NIFTY",
              "board": "NIFTY 50", "step": 50, "va_step": 10, "min_dte": 1,
              "lot": int(_env_num("NIFTY_LOT", 65)), "expiry_kind": "weekly"},
    "BANKNIFTY": {"label": "BANK NIFTY", "yf": "^NSEBANK", "proxy": "BANKBEES.NS", "nse": "BANKNIFTY",
                  "board": "NIFTY BANK", "step": 100, "va_step": 25, "min_dte": 2,
                  "lot": int(_env_num("BANKNIFTY_LOT", 30)), "expiry_kind": "monthly"},
}


def account() -> dict:
    capital = _env_num("TRADING_CAPITAL", 100000)
    risk_pct = min(max(_env_num("RISK_PCT", 1.0), 0.1), 1.0)  # hard cap: 1% per trade
    return {"capital": capital, "risk_pct": risk_pct,
            "capital_is_default": not os.environ.get("TRADING_CAPITAL", "").strip(),
            "costs_per_lot": _env_num("COSTS_PER_LOT", 100)}


def _r(x, nd=2):
    return lv._r(x, nd)


# ── Snapshot: everything known about one index right now ──────────────────────

def _session_summary(daily: pd.DataFrame, sess: dict, d, cfg: dict) -> dict | None:
    if d is None:
        return None
    day = sess.get(d)
    rows = daily[daily.index.date == d] if len(daily) else daily
    prior = daily[daily.index.date < d] if len(daily) else daily
    if day is not None and len(day):
        o, h, l, c = (float(day["Open"].iloc[0]), float(day["High"].max()),
                      float(day["Low"].min()), float(day["Close"].iloc[-1]))
    elif len(rows):
        r = rows.iloc[-1]
        o, h, l, c = float(r["Open"]), float(r["High"]), float(r["Low"]), float(r["Close"])
    else:
        return None
    pc = float(prior["Close"].iloc[-1]) if len(prior) else None
    p = prior.iloc[-1] if len(prior) else None
    vw = lv.vwap_series(day) if day is not None and len(day) else None
    return {
        "date": d, "open": _r(o), "high": _r(h), "low": _r(l), "close": _r(c),
        "prev_close": _r(pc), "change": _r(c - pc) if pc else None,
        "change_pct": _r((c - pc) / pc * 100) if pc else None,
        "vwap_close": _r(vw.iloc[-1]) if vw is not None else None,
        "va": lv.value_area(day, cfg["va_step"]) if day is not None else {"poc": None, "vah": None, "val": None},
        "pivots_next": lv.floor_pivots(h, l, c),
        "clv": lv.close_location(h, l, c),
        "pattern": lv.candle_pattern(o, h, l, c, *( (float(p["Open"]), float(p["High"]),
                                                     float(p["Low"]), float(p["Close"])) if p is not None else ())),
        "gap_pct": _r((o - pc) / pc * 100) if pc else None,
        "vs_prior": _vs_prior(h, l, c, p),
    }


def _vs_prior(h, l, c, p) -> str | None:
    """Breakout / breakdown of the prior session's range, in words."""
    if p is None:
        return None
    ph, pl = float(p["High"]), float(p["Low"])
    if c > ph:
        return f"breakout: closed above the prior day's high {ph:,.0f}"
    if c < pl:
        return f"breakdown: closed below the prior day's low {pl:,.0f}"
    if h > ph and l < pl:
        return f"took out both the prior high {ph:,.0f} and low {pl:,.0f}, closed inside — two-sided"
    if h > ph:
        return f"failed breakout: traded above the prior high {ph:,.0f} but closed back below it"
    if l < pl:
        return f"failed breakdown: traded below the prior low {pl:,.0f} but closed back above it"
    return "inside day: stayed within the prior day's range"



def _daily_tech(daily: pd.DataFrame) -> dict:
    if len(daily) < 30:
        return {}
    close = daily["Close"]
    price = float(close.iloc[-1])
    e20, e50 = float(indicators.ema(close, 20).iloc[-1]), float(indicators.ema(close, 50).iloc[-1])
    st = lv.structure(daily.tail(60), k=3)
    sup, res = indicators.swing_levels(daily.tail(90), k=3, max_levels=2)
    if price > e20 > e50:
        ema_words, ema_score = "above rising 20 & 50 EMA (bullish alignment)", 1
    elif price < e20 < e50:
        ema_words, ema_score = "below 20 & 50 EMA (bearish alignment)", -1
    else:
        ema_words, ema_score = "between / tangled with the 20 & 50 EMA (no clean trend)", 0
    return {
        "ema20": _r(e20), "ema50": _r(e50), "ema_words": ema_words, "ema_score": ema_score,
        "rsi": _r(indicators.rsi(close).iloc[-1], 1),
        "atr": _r(indicators.atr(daily).iloc[-1]),
        "structure": st, "swing_sup": sup, "swing_res": res,
        "high_20d": _r(daily["High"].tail(20).max()), "low_20d": _r(daily["Low"].tail(20).min()),
        "high_52w": _r(daily["High"].tail(250).max()),
        "trendlines": lv.trendlines(daily.tail(120), k=3),
    }


def snapshot(key: str, daily_raw, intra_raw, proxy_raw, now: datetime, mode: str,
             chain: dict | None = None, futures: dict | None = None,
             vix: float | None = None) -> dict:
    """
    mode: "pre"  (before the open: reference = previous session)
          "live" (during the session: today so far + previous session)
          "eod"  (after the close: today's full session; plan for tomorrow)
    """
    cfg = INDICES[key]
    daily = lv.clean(daily_raw)
    intra, wsrc = lv.add_weights(lv.clean(intra_raw), lv.clean(proxy_raw) if proxy_raw is not None else None)
    sess = lv.sessions(intra)
    today = now.date()
    sdates = sorted(sess)
    ddates = sorted(set(daily.index.date)) if len(daily) else []
    if mode == "eod":
        live_d = today if today in sess else (sdates[-1] if sdates else None)
    elif mode == "live":
        live_d = today if today in sess else None
    else:
        live_d = None
    cutoff = live_d or today
    ref_d = max([d for d in set(sdates) | set(ddates) if d < cutoff], default=None)

    daily_upto = daily[daily.index.date <= (live_d if mode == "eod" and live_d else ref_d)] \
        if ref_d or live_d else daily
    snap = {
        "key": key, "cfg": cfg, "label": cfg["label"], "mode": mode, "now": now,
        "weight_source": wsrc, "sessions": sess,
        "prev": _session_summary(daily, sess, ref_d, cfg),
        "today": _session_summary(daily, sess, live_d, cfg) if live_d else None,
        "today_bars": sess.get(live_d) if live_d else None,
        "prev_bars": sess.get(ref_d) if ref_d else None,
        "tech": _daily_tech(daily_upto),
        "chain": chain or {}, "futures": futures, "vix": vix,
    }
    if snap["today_bars"] is not None:
        snap["intraday"] = _intraday(snap)
    return snap


# ── Intraday read (midday / EOD) ──────────────────────────────────────────────

def _intraday(snap: dict) -> dict:
    day = snap["today_bars"]
    prev = snap["prev"] or {}
    atr = (snap["tech"] or {}).get("atr") or float(day["High"].max() - day["Low"].min()) or 1.0
    vw = lv.vwap_series(day)
    last = float(day["Close"].iloc[-1])
    or15, or30 = lv.opening_range(day, 15), lv.opening_range(day, 30)
    hod_t = day["High"].idxmax()
    lod_t = day["Low"].idxmin()
    tol = max(atr * 0.05, last * 0.0005)
    b15 = lv.resample(day, 15)
    tests = []
    after_or = day[day.index >= day.index[0].normalize() + pd.Timedelta(hours=9, minutes=45)]
    for name, lvl in (("30-min OR high", or30["high"]), ("30-min OR low", or30["low"]),
                      ("PDH", prev.get("high")), ("PDL", prev.get("low"))):
        if lvl is not None:
            want = "up" if ("high" in name or name == "PDH") else "down"
            tests += [e for e in lv.level_tests(after_or if "OR" in name else day, lvl, name)
                      if e["direction"] == want]
    tests.sort(key=lambda e: e["time"])
    vb = lv.vwap_behaviour(day, vw, tol)
    vwap_now = float(vw.iloc[-1])
    hi, lo = float(day["High"].max()), float(day["Low"].min())
    open_ = float(day["Open"].iloc[0])

    if or30["complete"] and last > vwap_now and or30["high"] and last > or30["high"] and vb["crosses"] <= 3:
        day_type = "trending up"
    elif or30["complete"] and last < vwap_now and or30["low"] and last < or30["low"] and vb["crosses"] <= 3:
        day_type = "trending down"
    elif vb["crosses"] >= 5:
        day_type = "choppy range (VWAP crossed many times)"
    elif or30["complete"] and or30["low"] <= last <= or30["high"]:
        day_type = "range inside the opening range"
    else:
        day_type = "drifting " + ("up" if last > vwap_now else "down") + " without clean structure"

    ext_vwap = abs(last - vwap_now) / atr
    extended = ext_vwap >= 0.35 or abs(last - open_) / atr >= 0.8
    return {
        "open": _r(open_), "last": _r(last), "high": _r(hi), "low": _r(lo),
        "hod_time": hod_t, "lod_time": lod_t,
        "or15": or15, "or30": or30, "vwap": _r(vwap_now), "vwap_series": vw,
        "above_vwap": last > vwap_now, "vwap_behaviour": vb,
        "struct_5m": lv.structure(day, k=2), "struct_15m": lv.structure(b15, k=1),
        "tests": tests, "failed": [t for t in tests if t["failed"]],
        "day_type": day_type, "extended": bool(extended), "ext_vwap_atr": _r(ext_vwap),
        "range_atr": _r((hi - lo) / atr), "atr": atr,
        "rvol": lv.rel_volume(snap["sessions"], day.index[0].date()),
        "bars15": b15,
        "va": lv.value_area(day, snap["cfg"]["va_step"]),
    }


# ── Levels → zones ────────────────────────────────────────────────────────────

def _chain_walls(chain: dict) -> list[tuple[str, float]]:
    s = (chain or {}).get("summary") or {}
    out = []
    if s.get("top_call_oi_strikes"):
        out.append(("call-OI wall", s["top_call_oi_strikes"][0]))
    if s.get("top_put_oi_strikes"):
        out.append(("put-OI wall", s["top_put_oi_strikes"][0]))
    return out


def reference_levels(snap: dict, for_tomorrow: bool = False) -> list[tuple[str, float]]:
    """Named levels for a pre-market plan (or, at EOD, tomorrow's plan)."""
    s = snap["today"] if for_tomorrow else snap["prev"]
    t = snap["tech"] or {}
    if not s:
        return []
    names = (("Day high", "Day low", "Close", "VWAP") if for_tomorrow
             else ("PDH", "PDL", "PDC", "yday VWAP"))
    pv, va = s["pivots_next"], s["va"]
    pts = [(names[0], s["high"]), (names[1], s["low"]), (names[2], s["close"]), (names[3], s["vwap_close"]),
           ("VAH", va.get("vah")), ("VAL", va.get("val")), ("POC", va.get("poc")),
           ("Pivot", pv["P"]), ("R1", pv["R1"]), ("S1", pv["S1"]), ("R2", pv["R2"]), ("S2", pv["S2"]),
           ("20 EMA", t.get("ema20")), ("50 EMA", t.get("ema50"))]
    pts += [("swing high", x) for x in t.get("swing_res") or []]
    pts += [("swing low", x) for x in t.get("swing_sup") or []]
    tl = t.get("trendlines") or {}
    for name, key in (("rising trendline", "support"), ("falling trendline", "resistance")):
        if tl.get(key):
            pts.append((name, tl[key]["next"] if for_tomorrow else tl[key]["today"]))
    pts += _chain_walls(snap["chain"])
    return [(n, p) for n, p in pts if p]


def intraday_levels(snap: dict) -> list[tuple[str, float]]:
    i, p = snap["intraday"], snap["prev"] or {}
    pts = [("VWAP", i["vwap"]), ("30-min OR high", i["or30"]["high"]), ("30-min OR low", i["or30"]["low"]),
           ("day high", i["high"]), ("day low", i["low"]),
           ("PDH", p.get("high")), ("PDL", p.get("low")), ("PDC", p.get("close"))]
    if p.get("pivots_next"):
        pts += [("R1", p["pivots_next"]["R1"]), ("S1", p["pivots_next"]["S1"])]
    pts += _chain_walls(snap["chain"])
    return [(n, v) for n, v in pts if v]


# ── Scenario construction ─────────────────────────────────────────────────────

def _fmt(x) -> str:
    return "—" if x is None else f"{x:,.0f}"


def _side(side: str, ref: float, zones: list[dict], atr: float, min_gap: float,
          sl_buf: float, max_reach: float) -> dict:
    """One directional breakout-retest scenario from sorted zones."""
    up = side == "bull"
    seq = ([z for z in zones if z["price"] >= ref + min_gap] if up
           else sorted([z for z in zones if z["price"] <= ref - min_gap], key=lambda z: -z["price"]))
    sgn = 1 if up else -1
    if not seq:
        # Nothing beyond the opening noise (e.g. closed at the day's high, or
        # all-time-high territory): use the nearest level even if close, else
        # the opening-range edge — with measured targets.
        near = ([z for z in zones if z["price"] > ref] if up
                else sorted([z for z in zones if z["price"] < ref], key=lambda z: -z["price"]))
        seq = near[:1] or [{"price": _r(ref + sgn * min_gap),
                            "names": ["opening-range " + ("high" if up else "low") + " (no level beyond)"]}]
    best = None
    for i in range(min(2, len(seq))):
        trig = seq[i]
        if abs(trig["price"] - ref) > max_reach:
            break
        entry = trig["price"]
        stop = entry - sgn * sl_buf
        risk = abs(entry - stop)
        nxt = seq[i + 1:]
        if nxt:
            t1 = nxt[0]["price"]
            t2 = nxt[1]["price"] if len(nxt) > 1 else t1 + sgn * risk
            tgt_note = f"T1 = {lv.zone_label(nxt[0])}"
        else:
            t1, t2 = entry + sgn * 2 * risk, entry + sgn * 3 * risk
            tgt_note = "no level beyond — measured 2R / 3R targets"
        rr1 = abs(t1 - entry) / risk
        cand = {"trigger_zone": trig, "entry": _r(entry), "stop": _r(stop), "t1": _r(t1), "t2": _r(t2),
                "risk_pts": _r(risk), "rr1": round(rr1, 2), "rr2": round(abs(t2 - entry) / risk, 2),
                "target_note": tgt_note, "cleared": [z["price"] for z in seq[:i]]}
        if best is None or (best["rr1"] < MIN_RR and rr1 > best["rr1"]):
            best = cand
        if rr1 >= MIN_RR:
            best = cand
            break
    if best is None:
        return {"side": side, "valid": False, "rr_ok": False,
                "reason": f"no usable {'resistance' if up else 'support'} within reach "
                          f"(±{max_reach:,.0f} pts) — wait for the opening range to form"}
    best.update({"side": side, "valid": best["rr1"] >= MIN_RR, "rr_ok": best["rr1"] >= MIN_RR})
    if not best["rr_ok"]:
        best["reason"] = (f"next level is only {abs(best['t1'] - best['entry']):,.0f} pts away → "
                          f"R:R 1:{best['rr1']} is below 1:{MIN_RR}")
    return best


def _texts(sc: dict, how: str = "breakout") -> dict:
    """Confirmation / invalidation / exit wording for a scenario."""
    up = sc["side"] == "bull"
    e, s = _fmt(sc.get("entry")), _fmt(sc.get("stop"))
    if sc.get("entry") is None:
        return {}
    word = "above" if up else "below"
    other = "below" if up else "above"
    if how == "pullback":
        confirm = (f"Price is already {word} VWAP. Wait for a pullback into {e} that HOLDS: a "
                   f"{'bullish' if up else 'bearish'} 5-min candle closing back {'up' if up else 'down'} "
                   f"from that zone. Enter on that candle's close, not before.")
    else:
        confirm = (f"A 15-min candle must CLOSE {word} {e} with price {word} VWAP. Then wait for a "
                   f"retest: a {'pullback' if up else 'bounce'} to {e} that holds (5-min "
                   f"{'low' if up else 'high'} stays {word} {s}) and a {'bullish' if up else 'bearish'} "
                   f"5-min close. Enter there — never on the big {'breakout' if up else 'breakdown'} "
                   f"candle itself.")
    return {
        "confirm": confirm,
        "invalidation": (f"A 15-min close back {other} {e} (failed {'breakout' if up else 'breakdown'}), "
                         f"or price slipping {other} VWAP — stay out / exit."),
        "exit_rule": (f"Book half at T1 {_fmt(sc.get('t1'))} and move the stop to entry; exit the rest at "
                      f"T2 {_fmt(sc.get('t2'))}, on a 15-min close {other} VWAP, or by {SQUARE_OFF_BY}."),
    }


def build_scenarios(ref: float, named: list[tuple[str, float]], atr: float,
                    intraday: bool = False) -> dict:
    """Bullish + bearish breakout-retest scenarios and the no-trade band around `ref`."""
    atr = atr or ref * 0.01
    tol = ref * 0.001
    zones = lv.cluster(named, tol)
    min_gap = max(ref * (0.001 if intraday else 0.0015), atr * (0.05 if intraday else 0.08))
    sl_buf = max(atr * (0.12 if intraday else 0.15), ref * 0.001)
    reach = atr * (0.6 if intraday else 0.8)
    bull = _side("bull", ref, zones, atr, min_gap, sl_buf, reach)
    bear = _side("bear", ref, zones, atr, min_gap, sl_buf, reach)
    bull.update(_texts(bull))
    bear.update(_texts(bear))
    lo = bear.get("entry")
    hi = bull.get("entry")
    return {"bull": bull, "bear": bear, "zones": zones, "ref": _r(ref), "sl_buf": _r(sl_buf),
            "no_trade": {"low": lo, "high": hi}}


def pullback_variant(snap: dict, side: str) -> dict | None:
    """Intraday trend-side entry: buy a VWAP pullback in an up-day (mirror for down)."""
    i = snap["intraday"]
    up = side == "bull"
    if up != i["above_vwap"]:
        return None
    atr = i["atr"]
    sl_buf = max(atr * 0.12, i["last"] * 0.001)
    entry = i["vwap"]
    # The opening-range edge on the trend side is support/resistance too —
    # use whichever of it and VWAP is nearer to price.
    edge = i["or30"]["high"] if up else i["or30"]["low"]
    if edge and ((up and entry < edge < i["last"]) or (not up and i["last"] < edge < entry)):
        entry = edge
    stop = entry - sl_buf if up else entry + sl_buf
    t1 = i["high"] if up else i["low"]
    risk = abs(entry - stop)
    if risk <= 0 or abs(t1 - entry) < risk * 0.5:
        return None
    beyond = [p for n, p in intraday_levels(snap) if (p > t1 + risk * 0.3 if up else p < t1 - risk * 0.3)]
    t2 = (min(beyond) if up else max(beyond)) if beyond else (t1 + risk if up else t1 - risk)
    sc = {"side": side, "how": "pullback", "entry": _r(entry), "stop": _r(stop), "t1": _r(t1), "t2": _r(t2),
          "risk_pts": _r(risk), "rr1": round(abs(t1 - entry) / risk, 2), "rr2": round(abs(t2 - entry) / risk, 2),
          "trigger_zone": {"price": _r(entry), "names": ["VWAP pullback" if entry == i["vwap"] else "OR edge pullback"]},
          "target_note": "T1 = day " + ("high" if up else "low")}
    sc["rr_ok"] = sc["valid"] = sc["rr1"] >= MIN_RR
    if not sc["rr_ok"]:
        sc["reason"] = f"day {'high' if up else 'low'} is too close to VWAP → R:R 1:{sc['rr1']}"
    sc.update(_texts(sc, "pullback"))
    return sc


# ── Options + sizing attached to a scenario ───────────────────────────────────

def attach_option(sc: dict, snap: dict, now: datetime, acct: dict) -> dict:
    """Pick the CE/PE for a scenario, estimate premiums and size the position."""
    ch = snap["chain"] or {}
    rows, expiry = ch.get("rows") or [], ch.get("expiry")
    sc["option"] = None
    if sc.get("entry") is None:
        return sc
    kind = "CE" if sc["side"] == "bull" else "PE"
    if not rows or not expiry:
        sc["option_note"] = "option chain unavailable — choose the ATM/1-ITM strike at the trigger on your broker"
        return sc
    t = opt.years_to_expiry(expiry, now)
    step = opt.strike_step(rows, snap["cfg"]["step"])
    cands = opt.compare_strikes(rows, kind, sc["entry"], ch.get("spot") or sc["entry"], t, snap.get("vix"), step)
    choice = opt.pick(cands)
    sc["option_cands"] = cands
    if not choice:
        sc["option_note"] = "no liquid ATM/ITM strike near the trigger — skip (illiquid options eat the edge)"
        sc["valid"] = False
        return sc
    prem = opt.trade_premiums(choice, sc["entry"], sc["stop"], sc["t1"], sc["t2"], t, choice["iv"])
    size = opt.size_position(prem["risk_pts"], snap["cfg"]["lot"], acct["capital"], acct["risk_pct"],
                             acct["costs_per_lot"])
    sc["option"] = {**choice, "expiry": expiry, "dte": ch.get("dte"), "expiry_note": ch.get("expiry_note"),
                    "premiums": prem, "size": size, "lot": snap["cfg"]["lot"],
                    "name": f"{snap['cfg']['nse']} {choice['strike']:.0f} {kind} {expiry:%d %b}"}
    sc["sizing_ok"] = size["lots"] >= 1
    return sc


# ── Bias / confluence scoring ─────────────────────────────────────────────────

def score_bias(snap: dict, gift_pct: float | None = None, spx_pct: float | None = None,
               fii_net: float | None = None, use_today: bool = False) -> dict:
    """Additive confluence score; ≥ +1.5 bullish, ≤ -1.5 bearish, else neutral."""
    t = snap["tech"] or {}
    s = (snap["today"] if use_today else snap["prev"]) or {}
    pts, why = 0.0, []

    def add(v, text):
        nonlocal pts
        if v:
            pts += v
            why.append(f"{'+' if v > 0 else '−'}{abs(v):g} {text}")

    st = (t.get("structure") or {}).get("trend", 0)
    add(st, "daily structure " + (t.get("structure") or {}).get("label", ""))
    add(t.get("ema_score", 0), t.get("ema_words", ""))
    clv = s.get("clv")
    if clv is not None:
        add(0.5 if clv >= 0.7 else -0.5 if clv <= 0.3 else 0,
            f"last session closed {'near its high' if clv >= 0.7 else 'near its low' if clv <= 0.3 else ''}")
    if gift_pct is not None:
        add(1 if gift_pct >= 0.3 else -1 if gift_pct <= -0.3 else 0, f"GIFT Nifty {gift_pct:+.2f}%")
    if spx_pct is not None:
        add(0.5 if spx_pct >= 0.5 else -0.5 if spx_pct <= -0.5 else 0, f"S&P 500 {spx_pct:+.2f}%")
    if fii_net is not None:
        add(0.5 if fii_net >= 1000 else -0.5 if fii_net <= -1000 else 0, f"FII cash {fii_net:+,.0f} cr")
    pcr = ((snap["chain"] or {}).get("summary") or {}).get("pcr")
    if pcr is not None:
        add(0.5 if pcr >= 1.2 else -0.5 if pcr <= 0.7 else 0, f"PCR {pcr}")
    if snap.get("intraday"):
        i = snap["intraday"]
        add(1 if i["above_vwap"] else -1, "price " + ("above" if i["above_vwap"] else "below") + " VWAP")
        add(i["struct_15m"]["trend"], "15-min " + i["struct_15m"]["label"])
    bias = "Bullish" if pts >= 1.5 else "Bearish" if pts <= -1.5 else "Neutral"
    return {"score": round(pts, 1), "bias": bias, "why": why}


# ── Pre-market plan ───────────────────────────────────────────────────────────

def premarket_plan(snap: dict, gift_pct: float | None, now: datetime, acct: dict,
                   spx_pct=None, fii_net=None) -> dict:
    prev = snap["prev"] or {}
    pdc = prev.get("close")
    atr = (snap["tech"] or {}).get("atr")
    if not pdc:
        return {"ok": False, "reason": "previous session data unavailable"}
    exp_open = pdc * (1 + (gift_pct or 0) / 100)
    sc = build_scenarios(exp_open, reference_levels(snap), atr)
    for side in ("bull", "bear"):
        attach_option(sc[side], snap, now, acct)
    bias = score_bias(snap, gift_pct, spx_pct, fii_net)
    gap = gift_pct
    gap_words = ("gift unavailable — gap unknown" if gap is None else
                 "flat open likely" if abs(gap) < 0.2 else
                 f"mild gap-{'up' if gap > 0 else 'down'} likely" if abs(gap) < 0.6 else
                 f"LARGE gap-{'up' if gap > 0 else 'down'} likely — gap-fade traps are common; "
                 "wait 15–30 min before any entry")
    return {"ok": True, "expected_open": _r(exp_open), "gap_pct": gap, "gap_words": gap_words,
            "scenarios": sc, "bias": bias, "atr": atr}


# ── Midday: what happened to the morning plan, and what next ──────────────────

def evaluate_plan(sc: dict, day: pd.DataFrame) -> dict:
    """
    Replay a breakout-retest plan on today's 5-min bars.
    status: not triggered | triggered, no retest | open | T1 hit | T2 hit | stopped out
    """
    if not sc or sc.get("entry") is None or day is None or len(day) == 0:
        return {"status": "n/a"}
    up = sc["side"] == "bull"
    e, s, t1, t2 = sc["entry"], sc["stop"], sc["t1"], sc["t2"]
    b15 = lv.resample(day, 15)
    trig = b15[(b15["Close"] > e) if up else (b15["Close"] < e)]
    if len(trig) == 0:
        return {"status": "not triggered"}
    t_trig = trig.index[0] + pd.Timedelta(minutes=15)
    after = day[day.index >= t_trig]
    tol = abs(e - s) * 0.25
    fill_i = None
    for idx, row in after.iterrows():
        if (up and row["Low"] <= e + tol and row["Close"] > s) or \
           (not up and row["High"] >= e - tol and row["Close"] < s):
            fill_i = idx
            break
    if fill_i is None:
        last = float(day["Close"].iloc[-1])
        return {"status": "triggered, no retest", "trigger_time": trig.index[0], "last": _r(last),
                "away_pts": _r(abs(last - e)), "gapped": bool(trig.index[0] == b15.index[0] and
                                                             ((day["Open"].iloc[0] > e) if up else (day["Open"].iloc[0] < e)))}
    post = day[day.index >= fill_i]
    t1_hit = None
    for idx, row in post.iterrows():
        hit_stop = row["Low"] <= s if up else row["High"] >= s
        if t1_hit is None and hit_stop:
            return {"status": "stopped out", "fill_time": fill_i, "exit_time": idx}
        if t1_hit is not None and (row["Low"] <= e if up else row["High"] >= e):
            return {"status": "T1 hit, rest stopped at entry", "fill_time": fill_i, "t1_time": t1_hit}
        if t1_hit is None and (row["High"] >= t1 if up else row["Low"] <= t1):
            t1_hit = idx
        if t1_hit is not None and (row["High"] >= t2 if up else row["Low"] <= t2):
            return {"status": "T2 hit", "fill_time": fill_i, "t1_time": t1_hit, "t2_time": idx}
    last = float(day["Close"].iloc[-1])
    pnl = (last - e) if up else (e - last)
    return {"status": "T1 hit" if t1_hit is not None else "open", "fill_time": fill_i,
            "t1_time": t1_hit, "pnl_pts": _r(pnl), "last": _r(last)}


def midday_plan(snap: dict, now: datetime, acct: dict, morning: dict | None) -> dict:
    i = snap["intraday"]
    sc = build_scenarios(i["last"], intraday_levels(snap), i["atr"], intraday=True)
    for side in ("bull", "bear"):
        pb = pullback_variant(snap, side)
        if pb and (pb["rr_ok"] and (not sc[side].get("rr_ok") or i["extended"]
                                    or pb["rr1"] > sc[side].get("rr1", 0))):
            sc[side] = pb
        sc[side].setdefault("how", "breakout")
        attach_option(sc[side], snap, now, acct)

    status = {}
    if morning and morning.get("ok"):
        for side in ("bull", "bear"):
            status[side] = evaluate_plan(morning["scenarios"][side], snap["today_bars"])

    late = (now.hour, now.minute) >= NO_NEW_TRADES_AFTER
    open_pos = [(sd, st) for sd, st in status.items() if st.get("status") in ("open", "T1 hit")]
    if open_pos:
        sd, st = open_pos[0]
        msc = morning["scenarios"][sd]
        lost_vwap = (i["last"] < i["vwap"]) if sd == "bull" else (i["last"] > i["vwap"])
        if lost_vwap:
            action, why = "EXIT", (f"the morning {'long' if sd == 'bull' else 'short'} is open but price has "
                                   f"crossed back {'below' if sd == 'bull' else 'above'} VWAP — the reason for "
                                   "the trade is gone")
        elif st["status"] == "T1 hit":
            action, why = "BOOK PROFIT / TRAIL STOP-LOSS", (f"T1 {_fmt(msc['t1'])} is done — keep at most half, "
                                                             f"stop at entry {_fmt(msc['entry'])}, aim T2 {_fmt(msc['t2'])}")
        else:
            action, why = "HOLD", (f"morning trade is working ({st.get('pnl_pts', 0):+,.0f} pts) — keep the stop at "
                                   f"{_fmt(msc['stop'])}, don't widen it")
    elif late:
        action, why = "NO TRADE", "it's after 2:45 PM — too little time left for a new trade to work"
    elif "choppy" in i["day_type"] or "range inside" in i["day_type"]:
        action, why = "WAIT", "no clean direction — the market is chopping; let it pick a side first"
    elif i["extended"]:
        action, why = "WAIT", ("the move is already stretched far from VWAP — do NOT chase; wait for a "
                               "pullback toward VWAP or a fresh retest")
    else:
        trend_side = "bull" if i["above_vwap"] else "bear"
        cand = sc[trend_side]
        if cand.get("rr_ok") and cand.get("sizing_ok"):
            action, why = "ENTER NEW TRADE (only on confirmation)", (
                f"trend side is {'up' if trend_side == 'bull' else 'down'}; enter only when the "
                f"{'pullback' if cand.get('how') == 'pullback' else 'retest'} confirmation below appears")
        elif cand.get("rr_ok") and cand.get("option") and not cand.get("sizing_ok"):
            action, why = "NO TRADE", ("the trend-side setup is valid, but even 1 lot would risk more than "
                                       "your 1% limit — skip it at this capital")
        else:
            action, why = "WAIT", "trend exists but the risk/reward from here is poor"
    return {"scenarios": sc, "status": status, "action": action, "action_why": why, "late": late}


# ── End of day ────────────────────────────────────────────────────────────────

def eod_analysis(snap: dict, now: datetime, acct: dict) -> dict:
    t = snap["today"] or {}
    i = snap.get("intraday") or {}
    prev = snap["prev"] or {}
    b15 = i.get("bars15")
    sw = lv.swings(b15, k=1) if b15 is not None and len(b15) >= 3 else []
    buyers = sorted({s["price"] for s in sw if s["kind"] == "L"} | ({i["low"]} if i else set()))[:3]
    sellers = sorted({s["price"] for s in sw if s["kind"] == "H"} | ({i["high"]} if i else set()), reverse=True)[:3]
    tom = build_scenarios(t["close"], reference_levels(snap, for_tomorrow=True), (snap["tech"] or {}).get("atr")) \
        if t.get("close") else None
    if tom:
        for side in ("bull", "bear"):
            attach_option(tom[side], snap, now, acct)
    lesson = pick_lesson(snap)
    return {"buyers": buyers, "sellers": sellers, "tomorrow": tom, "lesson": lesson,
            "gap_fill": _gap_fill(t, prev)}


def _gap_fill(t: dict, prev: dict) -> str | None:
    g = t.get("gap_pct")
    if g is None or abs(g) < 0.3:
        return None
    filled = (t["low"] <= prev.get("close", 0)) if g > 0 else (t["high"] >= prev.get("close", 1e12))
    return (f"opened with a {g:+.2f}% gap, which {'was filled' if filled else 'was NOT filled'} — "
            + ("gap traders were trapped" if filled else "the gap held: strong-hands move"))


def pick_lesson(snap: dict) -> dict:
    """One price-action / VWAP lesson chosen from what actually happened today."""
    i = snap.get("intraday") or {}
    t = snap["today"] or {}
    vb = i.get("vwap_behaviour") or {}
    failed = i.get("failed") or []
    if failed:
        f = failed[0]
        up = f["direction"] == "up"
        return {"title": "A breakout is a question; the retest is the answer",
                "text": (f"{snap['label']} broke {'above' if up else 'below'} the {f['level']} "
                         f"({_fmt(f['price'])}) at {f['time']:%I:%M %p} and then closed back "
                         f"{'below' if up else 'above'} it — a false {'breakout' if up else 'breakdown'}. "
                         f"{'Buying calls on' if up else 'Buying puts on'} that candle would have meant "
                         f"{'buying the top' if up else 'selling the bottom'}. Waiting for a 15-min close and "
                         "a retest that HOLDS keeps you out of these traps.")}
    if vb.get("crosses") is not None and vb["crosses"] >= 5:
        return {"title": "Many VWAP crosses = no edge",
                "text": (f"Price crossed VWAP {vb['crosses']} times today. When buyers and sellers keep "
                         "swapping control around the average price, every breakout fails quickly. "
                         "The professional move on such days is to sit out, not to trade more.")}
    if vb.get("label") in ("respected as support", "respected as resistance"):
        up = vb["label"].endswith("support")
        return {"title": "On trend days VWAP is the line in the sand",
                "text": (f"VWAP was {vb['label']} all day. In a trend, the low-risk entry is the pullback "
                         f"to VWAP that holds, with the stop just {'below' if up else 'above'} it — not the "
                         "chase after a big candle.")}
    gf = _gap_fill(t, snap["prev"] or {})
    if gf and "was filled" in gf:
        return {"title": "Gaps are not trends",
                "text": (f"Today {gf}. An opening gap is overnight news being priced in; the first 15–30 "
                         "minutes decide whether it holds. Waiting for the opening range to form avoids "
                         "buying the gap just before it fades.")}
    clv = t.get("clv")
    if clv is not None and (clv <= 0.25 or clv >= 0.75) and i.get("range_atr", 0) >= 0.8:
        return {"title": "Close location tells you who won",
                "text": (f"{snap['label']} closed near its {'high' if clv >= 0.75 else 'low'} after a wide "
                         "range day. A close at the extreme shows the winning side held its gains into "
                         "the bell — tomorrow, respect that side until price proves otherwise.")}
    return {"title": "Patience is a position",
            "text": ("Nothing clean happened today. Most of a trader's edge comes from the trades "
                     "they skip. No setup = no trade, and that protects your capital for the days "
                     "the market does give a clean retest.")}


# ── Final decision ────────────────────────────────────────────────────────────

def _usable(sc: dict) -> bool:
    return bool(sc and sc.get("rr_ok") and sc.get("option") and sc.get("sizing_ok"))


def decide(plans: dict, biases: dict, vix: float | None, phase: str, actions: dict | None = None) -> dict:
    """
    Pick BEST / SECONDARY setups across both indices.
    plans: {"NIFTY": {"bull": sc, "bear": sc}, ...}; biases: {"NIFTY": score_bias(...), ...}
    """
    b = {k: v["bias"] for k, v in biases.items()}
    dirs = {v for v in b.values() if v != "Neutral"}
    conflict = len(dirs) == 2
    avg = sum(v["score"] for v in biases.values()) / max(len(biases), 1)
    market = "Bullish" if avg >= 1.5 and not conflict else "Bearish" if avg <= -1.5 and not conflict else "Neutral"

    ranked, size_blocked = [], []
    for k, p in plans.items():
        for side in ("bull", "bear"):
            sc = p.get(side)
            aligned = (b[k] == "Bullish" and side == "bull") or (b[k] == "Bearish" and side == "bear")
            against = (b[k] == "Bullish" and side == "bear") or (b[k] == "Bearish" and side == "bull")
            if against:
                continue  # never fight the bias with limited capital
            if sc and sc.get("rr_ok") and sc.get("option") and not sc.get("sizing_ok"):
                size_blocked.append((k, side, sc["option"]["size"]))
            if not _usable(sc):
                continue
            rank = (2 if aligned else 1) + min(sc["rr1"], 3) / 10
            ranked.append((rank, k, side, sc))
    ranked.sort(key=lambda x: -x[0])

    best = ranked[0] if ranked and not conflict else None
    second = next((r for r in ranked[1:] if best and r[1:3] != best[1:3]), None) if best else None
    high_vix = vix is not None and vix >= 20

    if best:
        rank, k, side, sc = best
        if phase == "pre":
            conf = "Medium" if (abs(biases[k]["score"]) >= 2.5 and not high_vix and rank >= 2.15) else "Low"
        else:
            conf = "High" if (rank >= 2.2 and abs(biases[k]["score"]) >= 3 and not high_vix) else \
                   "Medium" if rank >= 2 else "Low"
        action = "WAIT (BUY only after the confirmation)" if phase in ("pre", "eod") else \
                 (actions or {}).get(k, "WAIT")
    else:
        conf, action = "Low", "NO TRADE"
    reason = None
    if conflict:
        reason = (f"NIFTY is {b.get('NIFTY')} but BANK NIFTY is {b.get('BANKNIFTY')} — the two indices "
                  "disagree, so neither move has broad support. No trade until they line up.")
    elif not ranked:
        reason = "no setup passes all filters (confirmation level + R:R ≥ 1:1.5 + liquid option + 1% risk)"
    if high_vix and best:
        reason = f"India VIX {vix} is high — option premiums are expensive and swings wide; trade small or skip"
    return {"market_bias": market, "conflict": conflict, "best": best, "secondary": second,
            "confidence": conf, "action": action, "reason": reason, "biases": b,
            "size_blocked": [] if best else size_blocked}
