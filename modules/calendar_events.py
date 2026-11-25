"""
Monthly volatility calendar for NIFTY / BANK NIFTY.

Sources, best first:
  1. NSE live data       — F&O expiries, trading holidays, Nifty 50 /
                           Bank Nifty company results (passed in by reports.py)
  2. data/macro_calendar.json — curated official dates (RBI MPC, FOMC, Budget,
                           US CPI/NFP...) with a source per entry
  3. rules               — recurring releases with a usual day of the month
                           (India CPI ~12th, WPI ~14th, IIP ~28th, PMIs, US NFP
                           first Friday...). Always labelled "(est.)".
Nothing is invented silently: every estimated date says so.
"""

from __future__ import annotations

import calendar
import json
from datetime import date, timedelta
from pathlib import Path

CAL_PATH = Path("data/macro_calendar.json")

# Heavyweights whose results move the index on their own.
HEAVYWEIGHTS = {"HDFCBANK", "ICICIBANK", "RELIANCE", "INFY", "TCS", "SBIN", "AXISBANK",
                "KOTAKBANK", "BHARTIARTL", "LT", "ITC", "BAJFINANCE"}

# type → (impact, market, why it matters, trading caution)
INFO = {
    "rbi": ("HIGH", "India",
            "Repo-rate / stance / liquidity decision — banks and NBFCs reprice instantly, Bank Nifty moves first.",
            "No fresh option buys from 9:45 AM until 30 min after the 10:00 AM announcement + Governor's speech; IV crush after."),
    "budget": ("HIGH", "India",
               "Taxes, capex, fiscal deficit and sector allocations — intraday swings of 2–3% are common.",
               "Trade only after the speech ends; size down to half; expect whipsaws both ways."),
    "in_survey": ("MEDIUM", "India", "Sets the growth / fiscal tone a few days before the Budget.",
                  "Usually a non-event for price; don't pre-position for the Budget."),
    "in_gdp": ("MEDIUM", "India", "Quarterly growth print — shifts rate expectations and the macro narrative.",
               "Released 4 PM after the close — the reaction is next morning's gap; check GIFT Nifty."),
    "in_cpi": ("MEDIUM", "India", "Retail inflation drives RBI policy expectations → banks, rate-sensitives.",
               "Released ~4 PM after the close; a surprise shows up as the next day's gap."),
    "in_wpi": ("LOW", "India", "Wholesale inflation — secondary to CPI.", "Rarely moves the index by itself."),
    "in_iip": ("LOW", "India", "Industrial output — a lagging indicator.", "Rarely moves the index by itself."),
    "in_pmi": ("LOW", "India", "Business-activity survey; flash PMIs give an early growth read.", "Minor; watch only if far from 50–55."),
    "in_gst": ("LOW", "India", "GST collections — a consumption proxy.", "Minor for the index."),
    "in_auto": ("LOW", "India", "Monthly auto sales — moves Nifty Auto stocks.", "Stock-specific, not index-wide."),
    "fomc": ("HIGH", "US / Global",
             "US interest-rate decision + Fed chair press conference — drives global risk appetite, the dollar, FII flows.",
             "Lands after midnight IST: expect a gap next morning; don't carry overnight option buys into it."),
    "fomc_strategy": ("LOW", "US / Global", "Policy-framework discussion, no rate decision.", "Little direct market impact."),
    "us_cpi": ("HIGH", "US / Global", "US inflation sets Fed-cut/hike odds → global yields, dollar, FII flows.",
               "Prints ~7 PM IST (8:30 PM in US summer): GIFT Nifty reacts overnight; avoid carrying positions."),
    "us_ppi": ("MEDIUM", "US / Global", "Producer inflation — a lead on CPI.", "Smaller than CPI; mostly an overnight effect."),
    "us_nfp": ("HIGH", "US / Global", "US jobs report — a big driver of Fed expectations and the dollar.",
               "Friday ~7 PM IST: Monday's open carries the reaction."),
    "us_gdp": ("MEDIUM", "US / Global", "US quarterly growth (advance estimate).", "Overnight effect via GIFT Nifty."),
    "expiry_weekly": ("MEDIUM", "NSE F&O", "NIFTY weekly options expiry — pinning near max pain, fast theta, gamma spikes.",
                      "Avoid buying same-day-expiry options; premiums can go to zero in minutes."),
    "expiry_monthly": ("HIGH", "NSE F&O",
                       "Monthly expiry for NIFTY, BANK NIFTY and stock F&O — rollovers and big OI unwinding.",
                       "Wild last-hour moves are common; trade smaller and close positions before 3 PM."),
    "holiday": ("LOW", "NSE", "Market closed.", "Holiday-shortened week: lower volumes, faster theta on weeklies."),
    "results_heavy": ("HIGH", "India (stock)",
                      "Index heavyweight results — can move NIFTY / BANK NIFTY by themselves.",
                      "Expect a gap next session in that stock and its index; avoid holding options overnight into it."),
    "results": ("MEDIUM", "India (stock)", "Nifty 50 / Bank Nifty constituent results.",
                "Stock-specific; matters for the index only if several big names report together."),
}

IMPACT_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}


def _workday(d: date, holidays: set[date]) -> date:
    while d.weekday() >= 5 or d in holidays:
        d += timedelta(days=1)
    return d


def _nth_workday(year: int, month: int, n: int, holidays: set[date]) -> date:
    d = _workday(date(year, month, 1), holidays)
    for _ in range(n - 1):
        d = _workday(d + timedelta(days=1), holidays)
    return d


def _first_weekday(year: int, month: int, weekday: int) -> date:
    d = date(year, month, 1)
    return d + timedelta(days=(weekday - d.weekday()) % 7)


def _last_weekday(year: int, month: int, weekday: int) -> date:
    d = date(year, month, calendar.monthrange(year, month)[1])
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def load_fixed(path: Path = CAL_PATH) -> list[dict]:
    try:
        raw = json.loads(path.read_text())
        out = []
        for e in raw.get("events", []):
            d = date.fromisoformat(e["date"])
            out.append({**e, "date": d})
        return out
    except Exception as e:
        print(f"[WARN] calendar_events.load_fixed: {e}")
        return []


def _rule_events(year: int, month: int, holidays: set[date]) -> list[dict]:
    """Recurring releases on their usual dates — always estimates."""
    ev = []

    def add(d, typ, name, time=None):
        ev.append({"date": d, "type": typ, "event": name, "time": time, "est": True})

    india_hol = holidays
    add(_workday(date(year, month, 12), india_hol), "in_cpi", "India CPI inflation (prev. month)", "4:00 PM IST")
    add(_workday(date(year, month, 14), india_hol), "in_wpi", "India WPI inflation", "12:00 PM IST")
    add(_workday(date(year, month, 28), india_hol), "in_iip", "India IIP (industrial output)", "4:00 PM IST")
    add(_nth_workday(year, month, 1, india_hol), "in_pmi", "India Manufacturing PMI (final)", "10:30 AM IST")
    add(_nth_workday(year, month, 3, india_hol), "in_pmi", "India Services PMI (final)", "10:30 AM IST")
    add(_nth_workday(year, month, 1, india_hol), "in_gst", "GST collections (prev. month)")
    add(_nth_workday(year, month, 1, india_hol), "in_auto", "Monthly auto sales numbers")
    add(_first_weekday(year, month, 4), "us_nfp", "US Non-Farm Payrolls", "7:00 PM IST")
    add(_workday(date(year, month, 11), set()), "us_cpi", "US CPI", "7:00 PM IST")
    add(_workday(date(year, month, 13), set()), "us_ppi", "US PPI", "7:00 PM IST")
    if month in (1, 4, 7, 10):
        add(_last_weekday(year, month, 3), "us_gdp", "US GDP (advance estimate)", "7:00 PM IST")
    if month in (2, 5, 8, 11):
        last = date(year, month, calendar.monthrange(year, month)[1])
        while last.weekday() >= 5 or last in india_hol:
            last -= timedelta(days=1)
        add(last, "in_gdp", "India quarterly GDP", "4:00 PM IST")
    return ev


def _expiry_events(nifty: list[date], bank: list[date], year: int, month: int,
                   holidays: set[date]) -> list[dict]:
    """NSE expiries for the month; falls back to the Tuesday rule if NSE gave nothing."""
    inm = lambda ds: sorted(d for d in ds if d.year == year and d.month == month)  # noqa: E731
    n, b = inm(nifty), inm(bank)
    est = False
    if not n:
        est = True
        d = _first_weekday(year, month, 1)
        while d.month == month:
            x = d
            while x in holidays or x.weekday() >= 5:
                x -= timedelta(days=1)
            n.append(x)
            d += timedelta(days=7)
    if not b:
        est = True
        x = _last_weekday(year, month, 1)
        while x in holidays or x.weekday() >= 5:
            x -= timedelta(days=1)
        b = [x]
    out = []
    monthly = set(b)
    for d in n:
        if d in monthly or d == n[-1]:
            continue
        out.append({"date": d, "type": "expiry_weekly", "event": "NIFTY weekly expiry", "est": est})
    for d in b:
        out.append({"date": d, "type": "expiry_monthly",
                    "event": "Monthly expiry — NIFTY, BANK NIFTY, stock F&O", "est": est})
    if n and n[-1] not in monthly:
        out.append({"date": n[-1], "type": "expiry_monthly", "event": "NIFTY monthly expiry", "est": est})
    return out


def month_calendar(year: int, month: int, holidays: list[date] | None = None,
                   nifty_expiries: list[date] | None = None, bank_expiries: list[date] | None = None,
                   results: list[dict] | None = None, fixed: list[dict] | None = None) -> list[dict]:
    """
    Every event for the month, sorted by date then impact:
      {date, event, time, impact, market, why, caution, est, source}
    """
    hol = set(holidays or [])
    fixed = load_fixed() if fixed is None else fixed
    events = []
    fixed_m = [e for e in fixed if e["date"].year == year and e["date"].month == month]
    have = {e["type"] for e in fixed_m}
    events += [{**e, "est": bool(e.get("verify"))} for e in fixed_m]
    events += [e for e in _rule_events(year, month, hol) if e["type"] not in have]
    events += _expiry_events(nifty_expiries or [], bank_expiries or [], year, month, hol)
    for h in sorted(d for d in hol if d.year == year and d.month == month):
        events.append({"date": h, "type": "holiday", "event": "NSE trading holiday", "est": False})

    by_day: dict[date, list[str]] = {}
    heavy_days: set[date] = set()
    for r in results or []:
        d = r.get("date")
        if not d or d.year != year or d.month != month:
            continue
        by_day.setdefault(d, []).append(r["symbol"])
        if r["symbol"] in HEAVYWEIGHTS:
            heavy_days.add(d)
    for d, syms in by_day.items():
        heavy = [s for s in syms if s in HEAVYWEIGHTS]
        names = heavy + [s for s in syms if s not in HEAVYWEIGHTS]
        events.append({"date": d, "type": "results_heavy" if heavy else "results",
                       "event": "Results: " + ", ".join(dict.fromkeys(names[:6])) + ("…" if len(names) > 6 else ""),
                       "est": False})

    out = []
    for e in events:
        imp, mkt, why, caution = INFO.get(e["type"], ("LOW", "—", "", ""))
        out.append({"date": e["date"], "event": e["event"], "time": e.get("time"), "impact": imp,
                    "market": mkt, "why": why, "caution": caution, "est": bool(e.get("est")),
                    "source": e.get("source"), "type": e["type"]})
    out.sort(key=lambda e: (e["date"], IMPACT_ORDER[e["impact"]]))
    return out


def is_first_trading_day(day: date, holidays: set[date]) -> bool:
    d = date(day.year, day.month, 1)
    while d < day:
        if d.weekday() < 5 and d not in holidays:
            return False
        d += timedelta(days=1)
    return day.weekday() < 5 and day not in holidays
