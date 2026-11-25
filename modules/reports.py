"""
Scheduled Telegram reports (Mon–Fri, IST) for NIFTY 50 and BANK NIFTY:

  premarket  8:45 AM — global & Indian factors, previous-session price action,
                       levels, Scenario A (bullish) / B (bearish) / C (no-trade),
                       ATM-vs-ITM option comparison, final trade-plan table
  midday    11:45 AM — what the morning actually did (opening range, VWAP,
                       structure, breakouts / failed breakouts, OI, sectors),
                       what the morning plan did, the three after-12 scenarios
                       and HOLD / BOOK / TRAIL / EXIT / WAIT / ENTER
  evening    6:00 PM — full daily wrap: where buyers / sellers entered, VWAP,
                       false breakouts, candles, structure, tomorrow's levels
                       and plans, one trading lesson, upcoming dates
  monthly    first trading day of the month (sent with the pre-market
                       report) — volatility event calendar

Every report ends with the TRADE DECISION block. All levels, triggers,
stops, targets, strikes and sizes come from modules/planner.py (fixed
rules); Gemini only explains them in plain words and is optional.
A data source that fails is shown as "n/a" — numbers are never made up.
Each builder returns (message_html, data).
"""

import html
import json
from datetime import date, datetime, timedelta
from pathlib import Path

from modules import ai_engine, calendar_events, levels as lv, market_data, news, nse_data, planner
from modules import options as opt
from modules.telegram import IST

PLAN_PATH = Path("data/day_plan.json")
KEYS = ("NIFTY", "BANKNIFTY")


# ── Small formatting helpers ──────────────────────────────────────────────────

def _dot(pct) -> str:
    if pct is None:
        return "⚪"
    return "🟢" if pct > 0 else "🔴" if pct < 0 else "⚪"


def _n(x, d: int = 2) -> str:
    return "n/a" if x is None else f"{x:,.{d}f}"


def _f(x) -> str:  # index level, whole points
    return "n/a" if x is None else f"{x:,.0f}"


def _pct(x) -> str:
    return "n/a" if x is None else f"{x:+.2f}%"


def _signed(x, d: int = 2) -> str:
    return "n/a" if x is None else f"{x:+,.{d}f}"


def _esc(s) -> str:
    return html.escape(str(s or ""), quote=False)


def _day(date_str: str | None, fmt: str = "%a %d %b") -> str:
    d = nse_data._parse_date(date_str or "")
    return d.strftime(fmt) if d else (date_str or "n/a")


def _now_label(now: datetime | None = None) -> str:
    return (now or datetime.now(IST)).strftime("%a %d %b %Y · %I:%M %p IST")


def _tm(ts) -> str:
    try:
        return ts.strftime("%I:%M %p").lstrip("0")
    except Exception:
        return "n/a"


def _lakh(x) -> str:
    if x is None:
        return "n/a"
    a = abs(x)
    s = f"{a / 1e7:.2f}Cr" if a >= 1e7 else f"{a / 1e5:.1f}L" if a >= 1e5 else f"{a / 1e3:.0f}k" if a >= 1e3 else f"{a:.0f}"
    return ("-" if x < 0 else "") + s


def _rupees(x) -> str:
    if x is None:
        return "n/a"
    s = f"{abs(x):,.0f}"
    # Indian grouping: 1,23,456
    if abs(x) >= 1e5:
        n = f"{abs(int(round(x))):d}"
        head, tail = n[:-3], n[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        s = ",".join([head] + parts + [tail]) if head else ",".join(parts + [tail])
    return ("-" if x < 0 else "") + "₹" + s


DISCLAIMER = ("<i>Capital protection comes first. A missed trade is better than a bad trade.\n"
              "⚠️ Educational analysis, not financial advice. Prices from NSE/Yahoo can be delayed; "
              "check your broker's live quote before acting.</i>")


# ── Old shared blocks (still used) ────────────────────────────────────────────

def _fii_block(fii: dict | None, today_label: str | None = None) -> list[str]:
    if not fii or (fii.get("fii_net_buy_sell") is None and fii.get("dii_net_buy_sell") is None):
        return ["💰 <b>FII / DII:</b> n/a (NSE didn't respond)"]
    f, d = fii.get("fii_net_buy_sell"), fii.get("dii_net_buy_sell")
    head = f"💰 <b>FII / DII</b> <i>({_day(fii.get('date'))})</i>"
    if today_label and nse_data._parse_date(fii.get("date") or "") != nse_data._today_ist():
        head += f" <i>— {today_label}</i>"
    parts = []
    for label, v in (("FII", f), ("DII", d)):
        if v is not None:
            parts.append(f"{_dot(v)} {label} {_signed(v, 0)} cr")
    return [head + "  " + " · ".join(parts)]


def _sector_line(s: dict) -> str:
    wk = f", 1W {_pct(s['week_pct'])}" if s.get("week_pct") is not None else ""
    return f"  {_dot(s.get('change_pct'))} {s['sector']} {_pct(s.get('change_pct'))}{wk}"


def _sectors_compact(sectors: list[dict], n: int = 3) -> list[str]:
    if not sectors:
        return ["🏭 <b>Sectors:</b> n/a"]
    r = sorted(sectors, key=lambda s: s.get("change_pct") or 0, reverse=True)
    fmt = lambda s: f"{s['sector']} {_pct(s.get('change_pct'))}"  # noqa: E731
    return [f"🏭 <b>Strongest:</b> {' · '.join(fmt(s) for s in r[:n])}",
            f"🏭 <b>Weakest:</b> {' · '.join(fmt(s) for s in r[-n:][::-1])}"]


def _momentum_sectors(sectors: list[dict], n: int = 3) -> tuple[list[dict], list[dict]]:
    """Sectors up today AND over the week (building) vs down on both (fading)."""
    up = [s for s in sectors if (s.get("change_pct") or 0) > 0 and (s.get("week_pct") or 0) > 0]
    down = [s for s in sectors if (s.get("change_pct") or 0) < 0 and (s.get("week_pct") or 0) < 0]
    up.sort(key=lambda s: (s.get("week_pct") or 0) + (s.get("change_pct") or 0), reverse=True)
    down.sort(key=lambda s: (s.get("week_pct") or 0) + (s.get("change_pct") or 0))
    return up[:n], down[:n]


def _movers_block(movers: dict, title: str) -> list[str]:
    g, l = movers.get("gainers") or [], movers.get("losers") or []
    if not g and not l:
        return []
    lines = [f"<b>{title}</b>"]
    if g:
        lines.append("  🟢 " + " · ".join(f"{m['symbol']} {_pct(m['change_pct'])}" for m in g))
    if l:
        lines.append("  🔴 " + " · ".join(f"{m['symbol']} {_pct(m['change_pct'])}" for m in l))
    return lines


def _upcoming_block(events: dict, nifty_exp: list[str], bank_exp: list[str],
                    holidays: list[dict], days: int) -> list[str]:
    today = nse_data._today_ist()
    lines = [f"<b>📅 Coming up (next {days} days)</b>"]
    res = events.get("results") or []
    if res:
        lines.append("  <i>Results / board meetings</i>")
        for e in res[:8]:
            lines.append(f"  • {_day(e['date'], '%d %b')} — <b>{e['symbol']}</b> "
                         f"({', '.join(e['indices'])}): {_esc(e['what'])}")
    else:
        lines.append("  • No Nifty 50 / Bank Nifty results scheduled")
    acts = events.get("actions") or []
    if acts:
        lines.append("  <i>Ex-dates (dividend / split / bonus)</i>")
        for e in acts[:6]:
            lines.append(f"  • {_day(e['date'], '%d %b')} — <b>{e['symbol']}</b>: {_esc(e['what'])}")
    exp = []
    if nifty_exp:
        exp.append(f"Nifty {_day(nifty_exp[0])}")
    if bank_exp:
        exp.append(f"Bank Nifty {_day(bank_exp[0])}")
    if exp:
        lines.append("  <i>Next expiry</i>")
        lines.append("  • " + " · ".join(exp))
    soon = [h for h in holidays
            if (d := nse_data._parse_date(h["date"])) and today < d <= today + timedelta(days=14)]
    if soon:
        lines.append("  <i>Market holidays</i>")
        lines += [f"  • {_day(h['date'])} — {_esc(h['name'])}" for h in soon]
    return lines


# ── Data gathering ────────────────────────────────────────────────────────────

def _next_trading_day(d: date, holidays: set[date]) -> date:
    d += timedelta(days=1)
    while d.weekday() >= 5 or d in holidays:
        d += timedelta(days=1)
    return d


def _chain_for(key: str, ref_day: date) -> dict | None:
    """Chain for the expiry we'd actually trade (rolls off expiry day), with the
    nearest expiry's PCR / OI walls as the positioning summary."""
    cfg = planner.INDICES[key]
    exps = nse_data.get_expiries(cfg["nse"])
    if not exps:
        return None
    expiry, dte, note = opt.choose_expiry(exps, ref_day, cfg["min_dte"])
    ch = nse_data.get_chain(cfg["nse"], expiry, exps)
    if not ch:
        return None
    ch.update(dte=dte, expiry_note=note, summary_expiry=expiry)
    if expiry != exps[0]:
        near = nse_data.get_chain(cfg["nse"], exps[0], exps)
        if near and near.get("summary"):
            ch["summary"], ch["summary_expiry"] = near["summary"], exps[0]
    return ch


def _gather(mode: str, now: datetime) -> dict:
    board = nse_data.get_index_board() or {}
    vix_row = board.get("INDIA VIX") or {}
    vix = vix_row.get("last")
    holidays = {d for h in nse_data.get_trading_holidays() if (d := nse_data._parse_date(h["date"]))}
    ref_day = _next_trading_day(now.date(), holidays) if mode == "eod" else now.date()
    snaps = {}
    for key in KEYS:
        cfg = planner.INDICES[key]
        b = market_data.get_index_bundle(cfg["yf"], cfg["proxy"])
        ch = _chain_for(key, ref_day)
        fut = nse_data.get_index_futures(cfg["nse"]) if mode != "pre" else None
        snaps[key] = planner.snapshot(key, b["daily"], b["intra"], b["proxy"], now, mode,
                                      chain=ch, futures=fut, vix=vix)
    return {"board": board, "vix_row": vix_row, "vix": vix, "snaps": snaps, "holidays": holidays,
            "fii": nse_data.get_fii_dii_data(), "sectors": nse_data.get_sector_indices() or [],
            "now": now, "ref_day": ref_day}


# ── Shared renderers ──────────────────────────────────────────────────────────

def _cue(cues: list[dict], label: str) -> dict | None:
    return next((c for c in cues if c["label"] == label), None)


def _cue_str(c: dict | None, fmt: str = "{:,.2f}") -> str:
    if not c:
        return "n/a"
    return f"{c['label']} {fmt.format(c['last'])} ({_pct(c['change_pct'])})"


def _globals_lines(cues: list[dict]) -> list[str]:
    if not cues:
        return ["🌍 Global markets: n/a (Yahoo didn't respond)"]
    us = [c for c in cues if c["group"] == "US"]
    asia = [c for c in cues if c["group"] == "Asia"]
    mac = [c for c in cues if c["group"] == "Macro"]
    out = []
    if us:
        out.append(f"🇺🇸 <b>US</b> <i>({us[0]['as_of']})</i>: " + " · ".join(_cue_str(c, "{:,.0f}") for c in us))
    if asia:
        out.append("🌏 <b>Asia</b>: " + " · ".join(_cue_str(c, "{:,.0f}") for c in asia))
    if mac:
        out.append("💱 <b>Macro</b>: " + " · ".join(_cue_str(c) for c in mac))
    return out


def _vix_lines(vix_row: dict, snaps: dict) -> list[str]:
    v = vix_row.get("last")
    if v is None:
        return ["🌡 <b>India VIX:</b> n/a"]
    regime = ("very calm — small moves, cheap premiums" if v < 12 else
              "normal" if v < 16 else
              "elevated — wider swings, pricier premiums; be selective" if v < 20 else
              "HIGH — premiums expensive, stops get hit easily; trade small or skip")
    moves = []
    for k, s in snaps.items():
        ref = ((s.get("intraday") or {}).get("last") or (s["today"] or {}).get("close")
               or (s["prev"] or {}).get("close"))
        if ref:
            moves.append(f"{s['label']} ±{ref * v / 100 / 365 ** 0.5:,.0f}")
    return [f"🌡 <b>India VIX {_n(v)}</b> ({_pct(vix_row.get('change_pct'))}) → {regime}",
            f"     Implied 1-day move ≈ ±{v / 365 ** 0.5:.2f}%: " + " · ".join(moves)]


def _oi_line(snap: dict) -> str:
    ch = snap["chain"] or {}
    s = ch.get("summary") or {}
    if not s:
        return "🔗 Option OI: n/a (NSE chain unavailable)"
    exp = ch.get("summary_expiry")
    return (f"🔗 OI <i>({exp:%d %b})</i>: PCR <b>{s.get('pcr')}</b> · put wall {_f((s.get('top_put_oi_strikes') or [None])[0])} · "
            f"call wall {_f((s.get('top_call_oi_strikes') or [None])[0])} · max pain {_f(s.get('max_pain'))} · "
            f"ΔOI: {s.get('oi_signal', 'n/a')}") if exp else "🔗 Option OI: n/a"


def _option_lines(sc: dict, indent: str = "    ") -> list[str]:
    o = sc.get("option")
    if not o:
        note = sc.get("option_note")
        return [f"{indent}Option: {_esc(note)}"] if note else []
    lines = [f"{indent}Option: <b>{o['name']}</b> ({o['label']}, Δ≈{abs(o['delta_at_trigger']):.2f} at trigger)"
             + (f" — <i>{_esc(o.get('expiry_note'))}</i>" if o.get("expiry_note") not in (None, "nearest expiry") else "")]
    for c in sc.get("option_cands") or []:
        if c["label"] == "2 ITM":
            continue
        lines.append(f"{indent}  {c['label']} {c['strike']:.0f}{c['kind']}: LTP ₹{_n(c['ltp'], 1)} · Δ{abs(c['delta_at_trigger']):.2f}@trigger · "
                     f"IV {c['iv']}%{'*' if c['iv_source'] != 'chain' else ''} · θ {c['theta_day']:+.1f}/day · "
                     f"OI {_lakh(c['oi'])} ({_lakh(c['chg_oi'])}) · vol {_lakh(c['volume'])} · {c['liq']['words']}")
    p, sz = o["premiums"], o["size"]
    lines.append(f"{indent}Premium (est.): entry ₹{p['entry']} → SL ₹{p['stop']} · T1 ₹{p['t1']} · T2 ₹{p['t2']}")
    if sz["lots"] >= 1:
        lines.append(f"{indent}Size: <b>{sz['lots']} lot</b> ({sz['lots'] * o['lot']} qty) · risk ≈ {_rupees(sz['risk_total'])} "
                     f"(≤ {_rupees(sz['budget'])} = your max risk)")
    else:
        lines.append(f"{indent}Size: ❌ 1 lot risks ≈ {_rupees(sz['risk_per_lot'])} > your max {_rupees(sz['budget'])} → "
                     f"<b>NO TRADE at this capital</b> (1 lot needs ≥ {_rupees(sz['capital_for_1_lot'])})")
    return lines


def _scenario_block(title: str, sc: dict) -> list[str]:
    if sc.get("entry") is None:
        return [f"<b>{title}</b> — ❌ {_esc(sc.get('reason', 'no setup'))}"]
    ok = sc.get("rr_ok")
    tz = sc.get("trigger_zone") or {}
    tag = "✅ valid" if ok else f"❌ {_esc(sc.get('reason', 'R:R poor'))} → NO TRADE"
    lines = [f"<b>{title}</b> — {tag}",
             f"    Key level: {_f(tz.get('price'))} ({' + '.join(tz.get('names') or [])})",
             f"    Confirm: {_esc(sc.get('confirm'))}",
             f"    Entry {_f(sc['entry'])} · SL {_f(sc['stop'])} · T1 {_f(sc['t1'])} · T2 {_f(sc['t2'])} · "
             f"R:R 1:{sc['rr1']} / 1:{sc['rr2']}",
             f"    Exit: {_esc(sc.get('exit_rule'))}"]
    if ok:
        lines += _option_lines(sc)
    lines.append(f"    Invalid if: {_esc(sc.get('invalidation'))}")
    return lines


def _plan_table(plans: dict, biases: dict, dec: dict, snaps: dict) -> list[str]:
    """Transposed table (fields × indices) so it fits a phone screen."""
    def pick(k):
        p = plans.get(k) or {}
        b = (biases.get(k) or {}).get("bias", "Neutral")
        side = "bull" if b == "Bullish" else "bear" if b == "Bearish" else None
        if side is None:
            cands = [s for s in ("bull", "bear") if planner._usable(p.get(s))]
            side = cands[0] if cands else "bull"
        return b, p.get(side) or {}
    rows = {"Bias": [], "Key level": [], "Trigger": [], "Option": [], "Stop loss": [], "Target 1": [],
            "Target 2": [], "R:R": [], "Action": []}
    for k in KEYS:
        b, sc = pick(k)
        o = sc.get("option") or {}
        usable = planner._usable(sc)
        best = dec.get("best")
        is_best = bool(best and best[1] == k)
        rows["Bias"].append(b)
        rows["Key level"].append(((sc.get("trigger_zone") or {}).get("names") or ["—"])[0])
        rows["Trigger"].append(("15m>" if sc.get("side") == "bull" else "15m<") + _f(sc.get("entry")) if sc.get("entry") else "—")
        rows["Option"].append(f"{o['strike']:.0f}{o['kind']}" if o else "—")
        rows["Stop loss"].append(_f(sc.get("stop")))
        rows["Target 1"].append(_f(sc.get("t1")))
        rows["Target 2"].append(_f(sc.get("t2")))
        rows["R:R"].append(f"1:{sc['rr1']}" if sc.get("rr1") else "—")
        rows["Action"].append(("WAIT-trigger" if usable else "NO TRADE") + ("*" if is_best else ""))
    w = 12
    out = ["<pre>" + f"{'':<11}" + "".join(f"{planner.INDICES[k]['label']:<{w}}" for k in KEYS)]
    for f, vals in rows.items():
        out.append(f"{f:<11}" + "".join(f"{str(v)[:w - 1]:<{w}}" for v in vals))
    out[-1] += "</pre>"
    out.append("<i>* = best setup · trigger = 15-min close beyond the level, then a retest</i>")
    return out


def _setup_name(k: str, sc: dict) -> str:
    how = sc.get("how", "breakout")
    side = "Bullish" if sc["side"] == "bull" else "Bearish"
    if how == "pullback":
        return f"{planner.INDICES[k]['label']} {side} — VWAP pullback near {_f(sc['entry'])}"
    return (f"{planner.INDICES[k]['label']} {side} — {'breakout' if sc['side'] == 'bull' else 'breakdown'}"
            f"-retest of {_f(sc['entry'])}")


def _decision_block(dec: dict, acct: dict, title: str = "TRADE DECISION") -> list[str]:
    best = dec.get("best")
    lines = ["", f"<b>━━━━ {title} ━━━━</b>", f"<b>Market Bias:</b> {dec['market_bias']}"]
    if best:
        _, k, side, sc = best
        o = sc["option"]
        p, sz = o["premiums"], o["size"]
        conf_text = sc.get("confirm", "")
        lines += [
            f"<b>Best Index:</b> {planner.INDICES[k]['label']}",
            f"<b>Best Setup:</b> {_setup_name(k, sc)}",
            f"<b>Entry Confirmation:</b> {_esc(conf_text)}",
            f"<b>Option:</b> {o['name']} ({o['label']}, Δ≈{abs(o['delta_at_trigger']):.2f})",
            f"<b>Stop Loss:</b> {_f(sc['stop'])} on the index (≈ ₹{p['stop']} premium)",
            f"<b>Target:</b> T1 {_f(sc['t1'])} / T2 {_f(sc['t2'])} (≈ ₹{p['t1']} / ₹{p['t2']})",
            f"<b>Risk/Reward:</b> 1:{sc['rr1']} (T1) · 1:{sc['rr2']} (T2)",
            f"<b>Position Size:</b> {sz['lots']} lot ({sz['lots'] * o['lot']} qty) · risk ≈ {_rupees(sz['risk_total'])} "
            f"= {sz['risk_total'] / acct['capital'] * 100:.2f}% of {_rupees(acct['capital'])}",
        ]
    else:
        lines += ["<b>Best Index:</b> —", "<b>Best Setup:</b> none", "<b>Entry Confirmation:</b> —",
                  "<b>Option:</b> —", "<b>Stop Loss:</b> —", "<b>Target:</b> —", "<b>Risk/Reward:</b> —",
                  "<b>Position Size:</b> 0"]
    lines += [f"<b>Confidence:</b> {dec['confidence']}", f"<b>Action:</b> <b>{dec['action']}</b>"]
    if dec.get("reason"):
        lines.append(f"<i>Why: {_esc(dec['reason'])}</i>")
    for k, side, sz in dec.get("size_blocked") or []:
        lines.append(f"<i>Note: the {planner.INDICES[k]['label']} {'bullish' if side == 'bull' else 'bearish'} "
                     f"setup is otherwise valid, but 1 lot risks ≈ {_rupees(sz['risk_per_lot'])} — above your "
                     f"{acct['risk_pct']:g}% limit ({_rupees(sz['budget'])}).</i>")
    if acct["capital_is_default"]:
        lines.append("<i>Sizing assumes ₹1,00,000 capital — set the TRADING_CAPITAL repo variable to yours.</i>")
    return lines


def _ai_lines(title: str, text: str | None) -> list[str]:
    return [f"<b>{title}</b>", _esc(text)] if text else []


def _compact(sc: dict | None) -> dict | None:
    if not sc or sc.get("entry") is None:
        return {"valid": False, "reason": (sc or {}).get("reason")}
    o = sc.get("option") or {}
    return {"side": sc["side"], "how": sc.get("how", "breakout"), "level": sc["entry"], "stop": sc["stop"],
            "t1": sc["t1"], "t2": sc["t2"], "rr1": sc["rr1"], "valid": sc.get("rr_ok"),
            "reason": sc.get("reason"), "option": o.get("name"),
            "lots": (o.get("size") or {}).get("lots")}


def _decision_facts(dec: dict) -> dict:
    best = dec.get("best")
    return {"market_bias": dec["market_bias"], "conflict": dec["conflict"], "action": dec["action"],
            "confidence": dec["confidence"], "reason": dec.get("reason"),
            "best": _setup_name(best[1], best[3]) if best else None}


# ── Day-plan persistence (pre-market → midday) ────────────────────────────────

def save_day_plan(now: datetime, plans: dict):
    out = {"date": now.date().isoformat(), "plans": {}}
    for k, p in plans.items():
        if not p.get("ok"):
            continue
        out["plans"][k] = {s: {f: p["scenarios"][s].get(f) for f in ("side", "entry", "stop", "t1", "t2", "rr1", "rr_ok")}
                           for s in ("bull", "bear")}
    try:
        PLAN_PATH.parent.mkdir(exist_ok=True)
        PLAN_PATH.write_text(json.dumps(out, indent=1, default=str))
    except Exception as e:
        print(f"[WARN] save_day_plan: {e}")


def load_day_plan(today: date) -> dict:
    try:
        raw = json.loads(PLAN_PATH.read_text())
        if raw.get("date") != today.isoformat():
            return {}
        return {k: {"ok": True, "scenarios": v, "source": "8:45 AM plan"} for k, v in raw["plans"].items()}
    except Exception:
        return {}


# ── 8:45 AM — Pre-market ──────────────────────────────────────────────────────

def _prev_session_lines(snap: dict, plan: dict) -> list[str]:
    p, t = snap["prev"] or {}, snap["tech"] or {}
    if not p:
        return [f"<b>📊 {snap['label']}</b>: previous-session data unavailable"]
    bars = snap.get("prev_bars")
    lines = [f"<b>📊 {snap['label']}</b> — previous session ({p['date']:%a %d %b})",
             f"O {_f(p['open'])} · H {_f(p['high'])} · L {_f(p['low'])} · C <b>{_n(p['close'])}</b> "
             f"({_pct(p['change_pct'])})",
             f"Candle: {p['pattern']['name']} — {p['pattern']['meaning']}; closed "
             + ("near its high" if (p['clv'] or 0) >= 0.7 else "near its low" if (p['clv'] or 1) <= 0.3 else "mid-range")
             + f" (close location {p['clv']})"]
    if p.get("vs_prior"):
        lines.append(f"Range: {p['vs_prior']}")
    st = (t.get("structure") or {}).get("label", "n/a")
    lines.append(f"Daily structure: {st} · {t.get('ema_words', 'EMAs n/a')} "
                 f"(20 EMA {_f(t.get('ema20'))}, 50 EMA {_f(t.get('ema50'))}) · RSI {t.get('rsi')} <i>(support only)</i>")
    if bars is not None and len(bars):
        vw = lv.vwap_series(bars)
        vb = lv.vwap_behaviour(bars, vw, (t.get("atr") or 100) * 0.05)
        st15 = lv.structure(lv.resample(bars, 15), k=1)
        rv = lv.rel_volume(snap["sessions"], p["date"])
        lines.append(f"VWAP {_f(p['vwap_close'])}: closed {'ABOVE' if p['close'] > (p['vwap_close'] or 0) else 'BELOW'} it · "
                     f"VWAP was {vb['label']} ({vb['crosses']} crosses)")
        st5 = lv.structure(bars.tail(12), k=2)
        lines.append(f"Intraday: 15-min {st15['label']} · last hour (5-min) {st5['label']} · volume "
                     f"{f'{rv}× the 5-day norm' if rv else 'n/a'} <i>({snap['weight_source']})</i>")
    va = p["va"]
    lines.append(f"Value area: VAL {_f(va.get('val'))} · POC {_f(va.get('poc'))} · VAH {_f(va.get('vah'))}")
    pv = p["pivots_next"]
    cpr = pv.get("cpr_width_pct")
    lines.append(f"Pivots: S2 {_f(pv['S2'])} · S1 {_f(pv['S1'])} · P {_f(pv['P'])} · R1 {_f(pv['R1'])} · R2 {_f(pv['R2'])}"
                 + (f" · CPR {cpr}% ({'narrow → trend day more likely' if cpr < 0.1 else 'wide → range day more likely' if cpr > 0.25 else 'normal'})" if cpr is not None else ""))
    if t.get("swing_res") or t.get("swing_sup"):
        lines.append(f"Swing levels (daily): resistance {', '.join(_f(x) for x in t.get('swing_res') or []) or 'none near'} · "
                     f"support {', '.join(_f(x) for x in t.get('swing_sup') or []) or 'none near'} · "
                     f"20-day range {_f(t.get('low_20d'))}–{_f(t.get('high_20d'))}")
    tl = t.get("trendlines") or {}
    if tl:
        lines.append("Trendlines (daily): " + " · ".join(
            f"{'rising support' if k == 'support' else 'falling resistance'} ≈ {_f(v['today'])} today"
            for k, v in tl.items()))
    else:
        lines.append("Trendlines (daily): no clean rising-support / falling-resistance line")
    lines.append(_oi_line(snap))
    if plan.get("ok"):
        b = plan["bias"]
        lines.append(f"Bias score {b['score']:+g} → <b>{b['bias']}</b> <i>({'; '.join(b['why']) or 'no strong factor'})</i>")
        lines.append(f"Expected open ≈ <b>{_f(plan['expected_open'])}</b> → {plan['gap_words']}")
    return lines


def _no_trade_block(snap: dict, plan: dict, gift_pct, vix, events_today: list[dict]) -> list[str]:
    nt = plan["scenarios"]["no_trade"]
    lines = ["<b>C — No-trade / sideways</b>"]
    if nt["low"] and nt["high"]:
        lines.append(f"    Avoid trading between <b>{_f(nt['low'])} and {_f(nt['high'])}</b> — inside this band "
                     "there is no edge, only noise.")
    inval = ["the first 15 minutes (9:15–9:30) — never enter on the opening candles",
             "price keeps crossing VWAP (3+ times) — that's chop",
             "NIFTY and BANK NIFTY move in opposite directions"]
    if gift_pct is not None and abs(gift_pct) >= 0.6:
        inval.insert(0, f"a {gift_pct:+.1f}% gap — wait 30 minutes for the gap to hold or fade")
    if vix is not None and vix >= 18:
        inval.append(f"India VIX ({vix}) rising further — stops get hunted")
    for e in events_today:
        if e["impact"] == "HIGH":
            inval.append(f"{e['event']}{' at ' + e['time'] if e.get('time') else ''} — no trade until it's out")
    lines.append("    Setup invalid if: " + "; ".join(inval) + ".")
    lines.append("    Wait for: a 15-min candle closing OUTSIDE the band with rising volume, then a retest that holds.")
    return lines


def build_premarket() -> tuple[str, dict]:
    now = datetime.now(IST)
    g = _gather("pre", now)
    gift = nse_data.get_gift_nifty()
    cues = market_data.get_global_cues()
    headlines = news.fetch_indian_news(lookback_hours=14)
    acct = planner.account()
    gift_pct = (gift or {}).get("change_pct")
    spx = _cue(cues, "S&P 500")
    fii = g["fii"] or {}
    today = now.date()
    todays = [e for e in nse_data.get_upcoming_events(days=0).get("results", [])
              if nse_data._parse_date(e["date"]) == today]
    exps = {k: ((g["snaps"][k]["chain"] or {}).get("expiries") or []) for k in KEYS}
    cal_today = [e for e in calendar_events.month_calendar(
        today.year, today.month, sorted(g["holidays"]), exps["NIFTY"], exps["BANKNIFTY"],
        [{"date": today, "symbol": e["symbol"]} for e in todays]) if e["date"] == today]

    plans, biases = {}, {}
    for k, snap in g["snaps"].items():
        plans[k] = planner.premarket_plan(snap, gift_pct, now, acct,
                                          spx_pct=(spx or {}).get("change_pct"),
                                          fii_net=fii.get("fii_net_buy_sell"))
        biases[k] = plans[k]["bias"] if plans[k].get("ok") else {"score": 0, "bias": "Neutral", "why": []}
    ok_plans = {k: p["scenarios"] for k, p in plans.items() if p.get("ok")}
    dec = planner.decide(ok_plans, biases, g["vix"], "pre")

    facts = {
        "gift_nifty": gift, "global": cues, "vix": g["vix_row"], "fii_dii": fii,
        "headlines": [h["title"] for h in headlines[:10]], "events_today": [e["event"] for e in cal_today],
        "indices": {k: {"prev": {x: (g["snaps"][k]["prev"] or {}).get(x) for x in ("close", "change_pct", "high", "low", "clv")},
                        "pattern": ((g["snaps"][k]["prev"] or {}).get("pattern") or {}).get("name"),
                        "structure": ((g["snaps"][k]["tech"] or {}).get("structure") or {}).get("label"),
                        "bias": biases[k], "expected_open": plans[k].get("expected_open"),
                        "bull": _compact((plans[k].get("scenarios") or {}).get("bull")),
                        "bear": _compact((plans[k].get("scenarios") or {}).get("bear"))} for k in KEYS},
        "decision": _decision_facts(dec),
    }
    ai = ai_engine.narrate("8:45 AM pre-market report", facts, {
        "global_read": "2-3 sentences: what the global and Indian factors (GIFT, US, Asia, crude, USD/INR, VIX, FII/DII, the most important headline) mean for today's open. Name what is unknown.",
        "nifty_read": "2 sentences on NIFTY: yesterday's price action and what must happen today before a trade.",
        "banknifty_read": "2 sentences on BANK NIFTY, same style; mention any conflict with NIFTY.",
        "beginner_tip": "1 sentence of practical risk advice for today specifically.",
    }) or {}

    lines = [f"<b>🌅 8:45 AM PRE-MARKET REPORT — NIFTY 50 &amp; BANK NIFTY</b>", f"<i>{_now_label(now)}</i>", "",
             "<b>🌍 GLOBAL &amp; INDIAN FACTORS</b>"]
    if gift:
        lines.append(f"{_dot(gift_pct)} <b>GIFT Nifty</b> {_n(gift['last'])} ({_pct(gift_pct)}) "
                     f"<i>as of {(gift.get('as_of') or '')[-5:]}</i>")
    else:
        lines.append("⚪ <b>GIFT Nifty:</b> n/a — gap estimate unavailable, treat the open as unknown")
    lines += _globals_lines(cues)
    lines += _vix_lines(g["vix_row"], g["snaps"])
    lines += _fii_block(fii)
    if headlines:
        lines.append("📰 <b>Overnight news</b>")
        lines += [f"  • {_esc(h['title'])} <i>({h['source']})</i>" for h in headlines[:5]]
    if cal_today:
        lines.append("📅 <b>Today</b>: " + " · ".join(f"{e['event']} ({e['impact']})" for e in cal_today))
    lines += _ai_lines("🧭 Read", ai.get("global_read"))

    for k in KEYS:
        snap, plan = g["snaps"][k], plans[k]
        lines += ["", "━━━━━━━━━━━━━━━━"] + _prev_session_lines(snap, plan)
        lines += _ai_lines("🧭", ai.get("nifty_read" if k == "NIFTY" else "banknifty_read"))
        if not plan.get("ok"):
            lines.append(f"<i>No plan: {plan.get('reason')}</i>")
            continue
        sc = plan["scenarios"]
        ch = snap["chain"] or {}
        if ch.get("expiry"):
            lines.append(f"🗓 Expiry used: <b>{ch['expiry']:%a %d %b}</b> ({ch.get('dte')} days, "
                         f"{snap['cfg']['expiry_kind']}) — {_esc(ch.get('expiry_note'))}. "
                         "Prefer ATM / 1-ITM: they move with the index; far-OTM decays to zero.")
        lines += [""] + _scenario_block("A — Bullish", sc["bull"])
        lines += [""] + _scenario_block("B — Bearish", sc["bear"])
        lines += [""] + _no_trade_block(snap, plan, gift_pct, g["vix"], cal_today)

    lines += ["", "━━━━━━━━━━━━━━━━", "<b>📋 FINAL 8:45 AM TRADE PLAN</b>"]
    lines += _plan_table({k: (plans[k].get("scenarios") or {}) for k in KEYS}, biases, dec, g["snaps"])
    best, second = dec.get("best"), dec.get("secondary")
    lines.append(f"<b>BEST SETUP:</b> {_setup_name(best[1], best[3]) + ' — only after confirmation' if best else 'none — NO TRADE unless a clean trigger + retest appears'}")
    lines.append(f"<b>SECONDARY SETUP:</b> {_setup_name(second[1], second[3]) if second else 'none'}")
    nts = [f"{g['snaps'][k]['label']} {_f(plans[k]['scenarios']['no_trade']['low'])}–{_f(plans[k]['scenarios']['no_trade']['high'])}"
           for k in KEYS if plans[k].get("ok") and plans[k]["scenarios"]["no_trade"]["low"] and plans[k]["scenarios"]["no_trade"]["high"]]
    lines.append(f"<b>NO-TRADE ZONE:</b> {' · '.join(nts) or 'until the opening range forms'}")
    if dec.get("conflict"):
        lines.append(f"⚠️ <b>Conflict:</b> {_esc(dec['reason'])}")
    if ai.get("beginner_tip"):
        lines.append(f"💡 {_esc(ai['beginner_tip'])}")
    lines += _decision_block(dec, acct)
    lines += ["", DISCLAIMER]

    save_day_plan(now, plans)
    nifty_chain = (g["snaps"]["NIFTY"]["chain"] or {}).get("summary")
    return "\n".join(lines), {"nifty_chain": nifty_chain, "vix": g["vix_row"], "fii_dii": fii,
                              "plans": plans, "decision": dec}


# ── 11:45 AM — Midday ─────────────────────────────────────────────────────────

def _status_words(sc: dict, st: dict) -> str:
    s = st.get("status", "n/a")
    lvl = _f(sc.get("entry"))
    if s == "not triggered":
        return f"{lvl}: not triggered"
    if s == "triggered, no retest":
        how = "gapped through it at the open" if st.get("gapped") else f"triggered at {_tm(st['trigger_time'])}"
        return f"{lvl}: {how}, no retest yet — now {_f(st.get('away_pts'))} pts away, do NOT chase"
    if s == "open":
        return f"{lvl}: entered ~{_tm(st['fill_time'])}, open ({st.get('pnl_pts', 0):+,.0f} pts) — SL {_f(sc.get('stop'))}"
    if s == "T1 hit":
        return f"{lvl}: entered, T1 {_f(sc.get('t1'))} hit ✅ — book half, stop to entry"
    if s == "T1 hit, rest stopped at entry":
        return f"{lvl}: T1 hit ✅, remainder closed at entry"
    if s == "T2 hit":
        return f"{lvl}: T2 {_f(sc.get('t2'))} hit ✅✅ — trade done"
    if s == "stopped out":
        return f"{lvl}: entered then stopped out ❌ at {_tm(st.get('exit_time'))} — done, no revenge trade"
    return f"{lvl}: {s}"


def _live_lines(snap: dict) -> list[str]:
    i, p = snap["intraday"], snap["prev"] or {}
    t = snap["today"] or {}
    vb = i["vwap_behaviour"]
    diff = i["last"] - i["vwap"]
    lines = [f"<b>📊 {snap['label']}</b> — {_tm(snap['now'])}",
             f"Open {_f(i['open'])} (gap {_pct(t.get('gap_pct'))}) · Now <b>{_n(i['last'])}</b> "
             f"({_pct((i['last'] - p['close']) / p['close'] * 100 if p.get('close') else None)})",
             f"Day high {_f(i['high'])} ({_tm(i['hod_time'])}) · Day low {_f(i['low'])} ({_tm(i['lod_time'])})",
             f"First 15-min range: {_f(i['or15']['low'])}–{_f(i['or15']['high'])} · "
             f"First 30-min: {_f(i['or30']['low'])}–{_f(i['or30']['high'])}",
             f"VWAP {_f(i['vwap'])} → price {'ABOVE' if diff > 0 else 'BELOW'} by {abs(diff):,.0f} pts "
             f"({i['ext_vwap_atr']}× ATR) · VWAP {vb['label']} ({vb['crosses']} crosses, {vb['pct_above']}% of bars above)"]
    fut = snap.get("futures")
    if fut and fut.get("vwap"):
        lines.append(f"Futures ({_day(fut.get('expiry'), '%b')}): {_n(fut.get('last'))} · fut VWAP {_n(fut.get('vwap'))} · "
                     f"OI {_lakh(fut.get('oi'))} ({_lakh(fut.get('chg_oi'))})")
    rv = i.get("rvol")
    lines.append(f"Volume: {str(rv) + '× normal for this time' if rv else 'n/a'} <i>({snap['weight_source']})</i>")
    lines.append(f"Structure: 5-min {i['struct_5m']['label']} · 15-min {i['struct_15m']['label']}")
    if i["tests"]:
        lines.append("Breakout attempts: " + _tests_words(i["tests"]))
    else:
        lines.append("Breakout attempts: none of the opening-range / prior-day levels has been tested")
    lines.append(_oi_line(snap))
    lines.append(f"Day type: <b>{i['day_type']}</b> · {'⚠️ EXTENDED — do not chase' if i['extended'] else 'not extended'}")
    return lines


def _tests_words(tests: list[dict], only_failed: bool = False) -> str:
    """One phrase per level: latest outcome, with a count when it was tried repeatedly."""
    by: dict = {}
    for e in tests:
        if only_failed and not e["failed"]:
            continue
        by.setdefault((e["level"], e["direction"]), []).append(e)
    out = []
    for (name, d), evs in by.items():
        last = evs[-1]
        kind = "breakout" if d == "up" else "breakdown"
        fails = sum(1 for e in evs if e["failed"])
        if last["failed"]:
            word = f"❌ false {kind}" + (f" ×{fails}" if fails > 1 else "")
        else:
            word = f"✅ {kind} held" + (f" (after {fails} failed tries)" if fails else "")
        out.append(f"{name} {_f(last['price'])} at {_tm(last['time'])}: {word}")
    return " · ".join(out)


def _range_block(sc: dict, i: dict) -> list[str]:
    lo, hi = sc["no_trade"]["low"], sc["no_trade"]["high"]
    lines = ["<b>3. Range-bound</b>"]
    if lo and hi:
        lines.append(f"    Range to avoid: <b>{_f(lo)}–{_f(hi)}</b> (VWAP {_f(i['vwap'])} sits in the middle).")
    lines.append("    Signs: price keeps crossing VWAP, 5-min candles overlap, volume dries up after 12.")
    lines.append("    Wait for: a 15-min close outside the range with volume picking up, then a retest. "
                 "Until then: NO TRADE.")
    return lines


def build_midday() -> tuple[str, dict]:
    now = datetime.now(IST)
    g = _gather("live", now)
    acct = planner.account()
    morning = load_day_plan(now.date())
    plans, biases, mids, actions = {}, {}, {}, {}
    for k, snap in g["snaps"].items():
        if snap.get("intraday") is None:
            continue
        m = morning.get(k)
        if not m and snap["today"]:
            m = planner.premarket_plan(snap, snap["today"]["gap_pct"], now, acct)
            if m.get("ok"):
                m["source"] = "rebuilt from today's actual open"
        mids[k] = planner.midday_plan(snap, now, acct, m)
        mids[k]["morning"] = m
        plans[k] = mids[k]["scenarios"]
        biases[k] = planner.score_bias(snap, use_today=True)
        actions[k] = mids[k]["action"]
    if not mids:
        msg = (f"<b>🕚 11:45 AM MIDDAY REPORT</b>\n<i>{_now_label(now)}</i>\n\n"
               "Today's intraday data is not available (market closed or data feed down). "
               "No assessment — <b>NO TRADE</b> on missing data.\n\n" + DISCLAIMER)
        return msg, {}
    dec = planner.decide(plans, biases, g["vix"], "live", actions)
    if dec.get("best"):
        dec["action"] = actions.get(dec["best"][1], dec["action"])

    facts = {"vix": g["vix_row"], "sectors": g["sectors"][:16],
             "indices": {k: {"open": snap["intraday"]["open"], "last": snap["intraday"]["last"],
                             "high": snap["intraday"]["high"], "low": snap["intraday"]["low"],
                             "vwap": snap["intraday"]["vwap"],
                             "vwap_behaviour": snap["intraday"]["vwap_behaviour"]["label"],
                             "day_type": snap["intraday"]["day_type"], "extended": snap["intraday"]["extended"],
                             "or30": snap["intraday"]["or30"],
                             "failed_breakouts": [(e["level"], e["price"]) for e in snap["intraday"]["failed"]],
                             "structure_15m": snap["intraday"]["struct_15m"]["label"],
                             "bias": biases[k], "action": actions[k],
                             "bull": _compact(plans[k]["bull"]), "bear": _compact(plans[k]["bear"])}
                         for k, snap in g["snaps"].items() if k in mids},
             "decision": _decision_facts(dec)}
    ai = ai_engine.narrate("11:45 AM midday report", facts, {
        "what_is_happening": "3-5 very simple sentences for a beginner: who is in control (buyers/sellers), relation to VWAP and the opening range, any trap/failed breakout, sector leadership. Mention any NIFTY vs BANK NIFTY disagreement.",
        "after_12": "2 sentences: which of the three scenarios (bullish, bearish, range) looks more likely from the facts and why — as probability, never certainty — and what confirmation to wait for.",
    }) or {}

    lines = [f"<b>🕚 11:45 AM MIDDAY REPORT — NIFTY 50 &amp; BANK NIFTY</b>", f"<i>{_now_label(now)}</i>", ""]
    lines += _vix_lines(g["vix_row"], g["snaps"])
    lines += _sectors_compact(g["sectors"])
    lines += _fii_block(g["fii"], today_label="today's figures come after the close")

    for k in KEYS:
        if k not in mids:
            continue
        snap, mp = g["snaps"][k], mids[k]
        lines += ["", "━━━━━━━━━━━━━━━━"] + _live_lines(snap)
        m = mp.get("morning")
        if m and m.get("ok") and mp["status"]:
            lines.append(f"Morning plan <i>({m.get('source', '8:45 AM plan')})</i>:")
            for side, nm in (("bull", "Bull"), ("bear", "Bear")):
                lines.append(f"    {nm} " + _status_words(m["scenarios"][side], mp["status"][side]))

    if ai.get("what_is_happening"):
        lines += ["", "<b>🧭 What is happening now?</b>", _esc(ai["what_is_happening"])]
    else:
        lines += ["", "<b>🧭 What is happening now?</b>"]
        for k in KEYS:
            if k in mids:
                i = g["snaps"][k]["intraday"]
                lines.append(f"{g['snaps'][k]['label']}: {i['day_type']}; price {'above' if i['above_vwap'] else 'below'} "
                             f"VWAP, so {'buyers' if i['above_vwap'] else 'sellers'} have the upper hand for now"
                             f"{' — but the move is stretched, so chasing it is poor risk/reward' if i['extended'] else ''}.")

    lines += ["", "<b>🔮 What is likely after 12 PM?</b>"]
    if ai.get("after_12"):
        lines.append(f"<i>{_esc(ai['after_12'])}</i>")
    for k in KEYS:
        if k not in mids:
            continue
        snap, mp = g["snaps"][k], mids[k]
        sc = mp["scenarios"]
        lines += ["", f"<b>▶ {snap['label']}</b>"]
        lines += _scenario_block("1. Bullish" + (" (VWAP pullback)" if sc["bull"].get("how") == "pullback" else " (breakout)"), sc["bull"])
        lines += _scenario_block("2. Bearish" + (" (VWAP pullback)" if sc["bear"].get("how") == "pullback" else " (breakdown)"), sc["bear"])
        lines += _range_block(sc, snap["intraday"])
        lines.append(f"👉 <b>{mp['action']}</b> — {_esc(mp['action_why'])}")
        if snap["intraday"]["extended"]:
            lines.append("    The morning move is already extended — <b>do not chase it</b>; a late entry here has "
                         "a far stop and a near target.")
    lines.append("<i>If you hold a position: keep the original stop, never widen it; book half at T1 and trail; "
                 f"square off intraday options by {planner.SQUARE_OFF_BY}.</i>")
    lines += _decision_block(dec, acct)
    lines += ["", DISCLAIMER]
    return "\n".join(lines), {"decision": dec}


# ── 6:00 PM — Daily wrap ──────────────────────────────────────────────────────

def _eod_index_lines(snap: dict, eod: dict, ai_text: str | None) -> list[str]:
    t, i, tech = snap["today"] or {}, snap.get("intraday") or {}, snap["tech"] or {}
    if not t or not i:
        return [f"<b>📊 {snap['label']}</b>: today's intraday data unavailable"]
    vb = i["vwap_behaviour"]
    va = t["va"]
    lines = [f"<b>📈 Price action — {snap['label']}</b>"]
    if ai_text:
        lines.append(_esc(ai_text))
    lines += [
        f"Buyers stepped in at: " + ", ".join(_f(x) for x in eod["buyers"]) + f" (day low {_f(i['low'])} at {_tm(i['lod_time'])})",
        f"Sellers stepped in at: " + ", ".join(_f(x) for x in eod["sellers"]) + f" (day high {_f(i['high'])} at {_tm(i['hod_time'])})",
        f"VWAP: {vb['label']} ({vb['crosses']} crosses) · closed {'ABOVE' if t['close'] > (t['vwap_close'] or 0) else 'BELOW'} "
        f"VWAP {_f(t['vwap_close'])}",
        "False breakouts: " + (_tests_words(i["failed"], only_failed=True) or "none — breakouts that happened held"),
        f"Levels created today: high {_f(t['high'])} · low {_f(t['low'])} · VWAP {_f(t['vwap_close'])} · "
        f"POC {_f(va.get('poc'))} · VAH {_f(va.get('vah'))} · VAL {_f(va.get('val'))}",
        f"Candle: <b>{t['pattern']['name']}</b> — {t['pattern']['meaning']} (close location {t['clv']})",
        f"Structure: daily {(tech.get('structure') or {}).get('label', 'n/a')} · 15-min {i['struct_15m']['label']} · day type {i['day_type']}",
    ]
    if eod.get("gap_fill"):
        lines.append(f"Gap: {eod['gap_fill']}")
    return lines


def _tomorrow_lines(snap: dict, eod: dict) -> list[str]:
    tom = eod.get("tomorrow")
    t = snap["today"] or {}
    if not tom:
        return []
    zones = tom["zones"]
    close = t["close"]
    res = [z for z in zones if z["price"] > close][:3]
    sup = sorted([z for z in zones if z["price"] < close], key=lambda z: -z["price"])[:3]
    bull, bear, nt = tom["bull"], tom["bear"], tom["no_trade"]
    lines = [f"<b>🗺 Tomorrow's setup — {snap['label']}</b>",
             f"Bullish above: <b>{_f(bull.get('entry'))}</b> (breakout level) · Bearish below: <b>{_f(bear.get('entry'))}</b> (breakdown level)",
             "Resistance: " + (" · ".join(lv.zone_label(z) for z in res) or "none overhead (blue sky)"),
             "Support: " + (" · ".join(lv.zone_label(z) for z in sup) or "none below"),
             f"VWAP / reference: today's VWAP {_f(t['vwap_close'])} · POC {_f(t['va'].get('poc'))} · close {_f(close)}",
             f"Avoid trading around: {_f(nt['low'])}–{_f(nt['high'])} (no-trade band) and the POC {_f(t['va'].get('poc'))}",
             ""]
    lines += _scenario_block("Tomorrow's bullish plan", bull)
    lines += _scenario_block("Tomorrow's bearish plan", bear)
    lines.append(f"<b>Tomorrow's no-trade zone:</b> {_f(nt['low'])}–{_f(nt['high'])}, the first 15 minutes, "
                 "and any open that chops around VWAP. Re-check at 8:45 AM with GIFT Nifty.")
    return lines


def build_evening(days_ahead: int = 7) -> tuple[str, dict]:
    now = datetime.now(IST)
    g = _gather("eod", now)
    acct = planner.account()
    cues = market_data.get_global_cues()
    movers = nse_data.get_top_movers("NIFTY")
    bank_movers = nse_data.get_top_movers("BANKNIFTY", n=2)
    events = nse_data.get_upcoming_events(days=days_ahead)
    nifty_exp = nse_data.get_next_expiries("NIFTY", 1)
    bank_exp = nse_data.get_next_expiries("BANKNIFTY", 1)
    holidays = nse_data.get_trading_holidays()
    headlines = news.fetch_indian_news(lookback_hours=10)

    eods, plans, biases = {}, {}, {}
    for k, snap in g["snaps"].items():
        if not snap.get("today") or not snap.get("intraday"):
            continue
        eods[k] = planner.eod_analysis(snap, now, acct)
        if eods[k].get("tomorrow"):
            plans[k] = {s: eods[k]["tomorrow"][s] for s in ("bull", "bear")}
        biases[k] = planner.score_bias(snap, use_today=True)
    dec = planner.decide(plans, biases, g["vix"], "eod")

    facts = {"vix": g["vix_row"], "fii_dii": g["fii"], "sectors": g["sectors"][:16], "global": cues,
             "headlines": [h["title"] for h in headlines[:8]],
             "indices": {k: {"today": {x: (g["snaps"][k]["today"] or {}).get(x) for x in
                                       ("open", "high", "low", "close", "change_pct", "vwap_close", "clv", "gap_pct")},
                             "pattern": (g["snaps"][k]["today"] or {}).get("pattern"),
                             "vwap_behaviour": (g["snaps"][k].get("intraday") or {}).get("vwap_behaviour"),
                             "failed": [(e["level"], e["price"], str(e["time"])) for e in (g["snaps"][k].get("intraday") or {}).get("failed", [])],
                             "day_type": (g["snaps"][k].get("intraday") or {}).get("day_type"),
                             "buyers": eods[k]["buyers"], "sellers": eods[k]["sellers"],
                             "tomorrow_bull": _compact((eods[k].get("tomorrow") or {}).get("bull")),
                             "tomorrow_bear": _compact((eods[k].get("tomorrow") or {}).get("bear"))}
                         for k in eods},
             "lesson": {k: eods[k]["lesson"] for k in eods}, "decision": _decision_facts(dec)}
    ai = ai_engine.narrate("6:00 PM end-of-day report", facts, {
        "nifty_story": "3 simple sentences: what NIFTY did today and why (who was in control when, VWAP, traps).",
        "banknifty_story": "3 simple sentences, same for BANK NIFTY; note if it diverged from NIFTY.",
        "tomorrow": "2 sentences: what today's price action suggests for tomorrow, as probabilities with the levels given.",
        "lesson": "Rewrite the NIFTY lesson in under 70 simple words, keep its point and numbers.",
    }) or {}

    lines = [f"<b>🌙 6:00 PM DAILY MARKET REPORT — NIFTY 50 &amp; BANK NIFTY</b>", f"<i>{_now_label(now)}</i>", "",
             "<b>🧾 Market summary</b>"]
    for k in KEYS:
        s = g["snaps"][k]
        t = s["today"] or {}
        rv = lv.rel_volume(s["sessions"], t["date"]) if t else None
        lines.append(f"{_dot(t.get('change_pct'))} <b>{s['label']}</b> {_n(t.get('close'))} {_signed(t.get('change'))} "
                     f"({_pct(t.get('change_pct'))}) · range {_f(t.get('low'))}–{_f(t.get('high'))} · volume "
                     f"{f'{rv}× 5-day avg' if rv else 'n/a'}")
    lines += _vix_lines(g["vix_row"], g["snaps"])
    lines += _fii_block(g["fii"], today_label="today's figures not out yet")
    building, fading = _momentum_sectors(g["sectors"])
    lines += _sectors_compact(g["sectors"])
    if building:
        lines.append("🚀 Gaining strength (up today &amp; this week): " + ", ".join(s["sector"] for s in building))
    if fading:
        lines.append("📉 Losing strength (down today &amp; this week): " + ", ".join(s["sector"] for s in fading))
    mv = _movers_block(movers, "🔥 Nifty 50 movers")
    lines += mv + _movers_block(bank_movers, "🏦 Bank Nifty movers")
    lines += _globals_lines(cues)

    for k in KEYS:
        if k not in eods:
            continue
        snap = g["snaps"][k]
        lines += ["", "━━━━━━━━━━━━━━━━"]
        lines += _eod_index_lines(snap, eods[k], ai.get("nifty_story" if k == "NIFTY" else "banknifty_story"))
        lines += [""] + _tomorrow_lines(snap, eods[k])
    if ai.get("tomorrow"):
        lines += ["", f"<b>🔭 What today tells us about tomorrow</b>", _esc(ai["tomorrow"])]

    if eods:
        les = eods.get("NIFTY", next(iter(eods.values())))["lesson"]
        lines += ["", f"<b>📘 Trading lesson: {_esc(les['title'])}</b>", _esc(ai.get("lesson") or les["text"])]
    lines += [""] + _upcoming_block(events, nifty_exp, bank_exp, holidays, days_ahead)
    lines += _decision_block(dec, acct, "TRADE DECISION (for tomorrow)")
    lines += ["", DISCLAIMER]

    nifty_chain = (g["snaps"]["NIFTY"]["chain"] or {}).get("summary")
    return "\n".join(lines), {"nifty_chain": nifty_chain, "vix": g["vix_row"], "fii_dii": g["fii"]}


# ── Monthly event calendar ────────────────────────────────────────────────────

_IMPACT_DOT = {"HIGH": "🔴", "MEDIUM": "🟠", "LOW": "🟢"}


def build_monthly(year: int | None = None, month: int | None = None) -> tuple[str, dict]:
    now = datetime.now(IST)
    year, month = year or now.year, month or now.month
    import calendar as _cal
    last = date(year, month, _cal.monthrange(year, month)[1])
    holidays = [d for h in nse_data.get_trading_holidays() if (d := nse_data._parse_date(h["date"]))]
    nexp = nse_data.get_expiries("NIFTY")
    bexp = nse_data.get_expiries("BANKNIFTY")
    days = max((last - now.date()).days, 0)
    ev = nse_data.get_upcoming_events(days=days)
    results = [{"date": nse_data._parse_date(e["date"]), "symbol": e["symbol"]} for e in ev.get("results", [])]
    events = calendar_events.month_calendar(year, month, holidays, nexp, bexp, results)

    high = [e for e in events if e["impact"] == "HIGH"]
    ai = ai_engine.narrate("monthly event calendar", {"month": f"{year}-{month:02d}",
                                                      "events": [{k: e[k] for k in ("date", "event", "impact")} for e in events]},
                           {"month_note": "2 sentences: which weeks/days look most volatile and how a small-capital trader should adjust (size, no overnight options)."}) or {}

    lines = [f"<b>🗓 MONTHLY EVENT CALENDAR — {date(year, month, 1):%B %Y}</b>", f"<i>{_now_label(now)}</i>",
             "🔴 HIGH · 🟠 MEDIUM · 🟢 LOW impact · <i>(verify)</i> = estimated date or secondary source", ""]
    if ai.get("month_note"):
        lines += [_esc(ai["month_note"]), ""]
    cur = None
    for e in events:
        if e["date"] != cur:
            cur = e["date"]
            lines.append(f"<b>{cur:%a %d %b}</b>")
        est = " <i>(verify)</i>" if e["est"] else ""
        tm = f" · {e['time']}" if e.get("time") else ""
        lines.append(f"  {_IMPACT_DOT[e['impact']]} <b>{e['impact']}</b> — {_esc(e['event'])}{est}{tm} · {e['market']}")
        if e["impact"] != "LOW":
            lines.append(f"      Why: {_esc(e['why'])}")
            lines.append(f"      Caution: {_esc(e['caution'])}")
    if high:
        lines += ["", "<b>⚠️ Trade lighter / no overnight option buys on:</b> "
                  + ", ".join(sorted({f'{e["date"]:%d %b}' for e in high}))]
    lines += ["", "<i>Sources: NSE (expiries, holidays, results), data/macro_calendar.json (RBI, Fed, BLS, MoSPI "
              "schedules), and usual-release-day rules for the rest. Dates can change — check the official "
              "calendars the day before.</i>"]
    return "\n".join(lines), {"events": events}


# ── Back-compat name ──────────────────────────────────────────────────────────

build_afternoon = build_midday
