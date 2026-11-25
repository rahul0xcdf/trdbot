"""
NSE data scraper — free, no API key.

NSE's public JSON endpoints reject requests that don't look like a browser.
The reliable pattern (and the only one that works from a bare server/CI):
  1. Use a persistent requests.Session()
  2. First GET the homepage so NSE hands us cookies
  3. Then hit the /api/... endpoint reusing those cookies + browser headers

Every function is defensive: any failure returns None and logs a clear
[ERROR] line prefixed with the function name. One bad fetch never raises.
"""

import time
import requests

TIMEOUT = 10

_BASE = "https://www.nseindia.com"

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/option-chain",
}

# Reused across calls in a single run so we only seed cookies once.
_session = None


def _get_session():
    """Return a cookie-seeded NSE session, creating one on first use."""
    global _session
    if _session is not None:
        return _session

    try:
        s = requests.Session()
        s.headers.update(_HEADERS)
        # Seed cookies — NSE sets them on the homepage / option-chain page.
        s.get(_BASE, timeout=TIMEOUT)
        s.get(f"{_BASE}/option-chain", timeout=TIMEOUT)
        _session = s
        return _session
    except Exception as e:
        print(f"[ERROR] nse_data._get_session: {e}")
        return None


def _fetch_json(path: str, referer: str | None = None):
    """GET an NSE /api path with a seeded session. Retries once on failure."""
    for attempt in range(2):
        session = _get_session()
        if session is None:
            return None
        try:
            headers = {"Referer": referer} if referer else {}
            r = session.get(f"{_BASE}{path}", headers=headers, timeout=TIMEOUT)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f"[WARN] nse_data._fetch_json {path} (attempt {attempt + 1}): {e}")
            # Cookies may have expired / been rejected — rebuild the session.
            global _session
            _session = None
            time.sleep(1)
    print(f"[ERROR] nse_data._fetch_json: giving up on {path}")
    return None


def _today_ist():
    from datetime import datetime
    import pytz
    return datetime.now(pytz.timezone("Asia/Kolkata")).date()


def _parse_date(s: str):
    """NSE 'dd-Mon-YYYY' (optionally with ' HH:MM') → date, or None."""
    from datetime import datetime
    try:
        return datetime.strptime((s or "").strip()[:11], "%d-%b-%Y").date()
    except ValueError:
        return None


def _live_expiries(expiries: list[str]) -> list[str]:
    """Expiry strings that are today or later (keeps order)."""
    today = _today_ist()
    live = [e for e in expiries if (_parse_date(e) or today) >= today]
    return live or expiries


def get_next_expiries(symbol: str, n: int = 2) -> list[str]:
    """Next `n` option expiries for an index/stock, e.g. ['01-Dec-2026', ...]."""
    import urllib.parse
    ci = _fetch_json(
        f"/api/option-chain-contract-info?symbol={urllib.parse.quote(symbol)}",
        referer="https://www.nseindia.com/option-chain",
    )
    if not ci:
        return []
    return _live_expiries(ci.get("expiryDates") or [])[:n]


def _fetch_chain_v3(kind: str, symbol: str) -> tuple[dict, dict] | None:
    """
    Fetch an option chain via NSE's current v3 API.

    NSE retired /api/option-chain-indices|equities; the live endpoint is
    /api/option-chain-v3, which requires an explicit expiry. We first pull the
    expiry list from /api/option-chain-contract-info and use the nearest one
    (ideal for the 0-7 DTE weekly intraday strategy).

    kind: "Indices" or "Equities". Returns (records, filtered, expiry) or None.
    """
    import urllib.parse

    sym = urllib.parse.quote(symbol)  # handles M&M, BAJAJ-AUTO, etc.
    ci = _fetch_json(
        f"/api/option-chain-contract-info?symbol={sym}",
        referer="https://www.nseindia.com/option-chain",
    )
    if not ci:
        return None
    expiries = _live_expiries(ci.get("expiryDates") or [])
    if not expiries:
        print(f"[ERROR] _fetch_chain_v3({symbol}): no expiry dates")
        return None
    # Nearest expiry that hasn't passed. NSE keeps an expired date at the
    # head of the list until the next session trades (e.g. the morning
    # after a Monday expiry + Tuesday holiday), so expiries[0] can be stale.
    expiry = expiries[0]

    data = _fetch_json(
        f"/api/option-chain-v3?type={kind}&symbol={sym}"
        f"&expiry={urllib.parse.quote(expiry)}",
        referer="https://www.nseindia.com/option-chain",
    )
    if not data:
        return None
    return data.get("records", {}), data.get("filtered", {}), expiry


def _summarise_chain(records: dict, filtered: dict) -> dict | None:
    """Turn a raw NSE option-chain payload into our summary dict."""
    try:
        # v3 returns rows under records.data (filtered may be empty); the older
        # shape used filtered.data. Prefer whichever is populated.
        rows = filtered.get("data") or records.get("data") or []
        spot = records.get("underlyingValue") or filtered.get("underlyingValue")
        if not rows or spot is None:
            return None

        total_call_oi = 0
        total_put_oi = 0
        chg_call_oi = 0
        chg_put_oi = 0
        call_oi_by_strike: dict[float, int] = {}
        put_oi_by_strike: dict[float, int] = {}
        iv_by_strike: dict[float, tuple] = {}

        for row in rows:
            strike = row.get("strikePrice")
            ce = row.get("CE") or {}
            pe = row.get("PE") or {}
            ce_oi = ce.get("openInterest", 0) or 0
            pe_oi = pe.get("openInterest", 0) or 0
            total_call_oi += ce_oi
            total_put_oi += pe_oi
            chg_call_oi += ce.get("changeinOpenInterest", 0) or 0
            chg_put_oi += pe.get("changeinOpenInterest", 0) or 0
            if strike is not None:
                call_oi_by_strike[strike] = ce_oi
                put_oi_by_strike[strike] = pe_oi
                iv_by_strike[strike] = (
                    ce.get("impliedVolatility"), pe.get("impliedVolatility"),
                )

        if not call_oi_by_strike:
            return None

        pcr = round(total_put_oi / total_call_oi, 2) if total_call_oi else None

        # ATM = listed strike nearest to spot.
        atm_strike = min(call_oi_by_strike, key=lambda k: abs(k - spot))

        # ATM IV = mean of the ATM CE/PE implied vols (whichever are present).
        atm_ivs = [v for v in (iv_by_strike.get(atm_strike) or ()) if v]
        atm_iv = round(sum(atm_ivs) / len(atm_ivs), 2) if atm_ivs else None

        # Max pain = strike that minimises total intrinsic payout to option
        # holders (i.e. the pain inflicted on writers is minimised there).
        strikes = sorted(call_oi_by_strike)
        best_strike, best_pain = None, None
        for expiry in strikes:
            pain = 0.0
            for k in strikes:
                if expiry > k:  # calls at k are ITM
                    pain += call_oi_by_strike[k] * (expiry - k)
                if expiry < k:  # puts at k are ITM
                    pain += put_oi_by_strike[k] * (k - expiry)
            if best_pain is None or pain < best_pain:
                best_pain, best_strike = pain, expiry

        top_call = sorted(call_oi_by_strike.items(), key=lambda x: x[1], reverse=True)[:5]
        top_put = sorted(put_oi_by_strike.items(), key=lambda x: x[1], reverse=True)[:5]

        # ΔOI skew reads positioning: heavy fresh PE writing = bullish support,
        # heavy fresh CE writing = bearish cap.
        if chg_put_oi > chg_call_oi * 1.5 and chg_put_oi > 0:
            oi_signal = "put writing dominant (bullish support)"
        elif chg_call_oi > chg_put_oi * 1.5 and chg_call_oi > 0:
            oi_signal = "call writing dominant (bearish cap)"
        elif chg_call_oi < 0 and chg_put_oi > 0:
            oi_signal = "call unwinding + put writing (bullish)"
        elif chg_put_oi < 0 and chg_call_oi > 0:
            oi_signal = "put unwinding + call writing (bearish)"
        else:
            oi_signal = "balanced"

        return {
            "spot": round(spot, 2),
            "pcr": pcr,
            "max_pain": best_strike,
            "atm_strike": atm_strike,
            "atm_iv": atm_iv,
            "total_call_oi": total_call_oi,
            "total_put_oi": total_put_oi,
            "change_call_oi": chg_call_oi,
            "change_put_oi": chg_put_oi,
            "oi_signal": oi_signal,
            "top_call_oi_strikes": [s for s, _ in top_call],
            "top_put_oi_strikes": [s for s, _ in top_put],
        }
    except Exception as e:
        print(f"[ERROR] nse_data._summarise_chain: {e}")
        return None


def _index_chain(symbol: str) -> dict | None:
    chain = _fetch_chain_v3("Indices", symbol)
    if not chain:
        print(f"[ERROR] {symbol} chain: no data")
        return None
    records, filtered, expiry = chain
    summary = _summarise_chain(records, filtered)
    if summary is None:
        print(f"[ERROR] {symbol} chain: could not summarise")
        return None
    summary["symbol"] = symbol
    summary["expiry"] = expiry
    print(
        f"[OK] {symbol} chain: PCR={summary['pcr']} "
        f"max_pain={summary['max_pain']} ATM={summary['atm_strike']}"
    )
    return summary


def get_nifty_options_chain() -> dict | None:
    """Live NIFTY index option chain summary (PCR, max pain, top OI strikes)."""
    return _index_chain("NIFTY")


def get_banknifty_options_chain() -> dict | None:
    """Live BANKNIFTY index option chain summary."""
    return _index_chain("BANKNIFTY")


def get_stock_options_oi(symbol: str) -> dict | None:
    """Live equity option chain summary for a single NSE stock symbol."""
    chain = _fetch_chain_v3("Equities", symbol)
    if not chain:
        print(f"[ERROR] get_stock_options_oi({symbol}): no data")
        return None
    records, filtered, expiry = chain
    summary = _summarise_chain(records, filtered)
    if summary is None:
        print(f"[ERROR] get_stock_options_oi({symbol}): could not summarise chain")
        return None
    summary["symbol"] = symbol
    summary["expiry"] = expiry
    print(f"[OK] get_stock_options_oi({symbol}): PCR={summary['pcr']} max_pain={summary['max_pain']}")
    return summary


def get_sector_indices() -> list[dict] | None:
    """
    Sectoral index performance from NSE allIndices — the raw material for
    sector-rotation analysis. Returns [{sector, last, change_pct}], sorted
    strongest first.
    """
    data = _fetch_json("/api/allIndices")
    if not data:
        print("[ERROR] get_sector_indices: no data")
        return None
    wanted = {
        "NIFTY BANK", "NIFTY IT", "NIFTY AUTO", "NIFTY PHARMA", "NIFTY FMCG",
        "NIFTY METAL", "NIFTY REALTY", "NIFTY ENERGY", "NIFTY FINANCIAL SERVICES",
        "NIFTY MEDIA", "NIFTY PSU BANK", "NIFTY PRIVATE BANK", "NIFTY INFRASTRUCTURE",
        "NIFTY HEALTHCARE INDEX", "NIFTY CONSUMER DURABLES", "NIFTY OIL & GAS",
    }
    out = []
    try:
        for row in data.get("data", []):
            name = (row.get("index") or "").upper().strip()
            if name in wanted and row.get("last") is not None:
                last = float(row["last"])
                week_ago = _num(row.get("oneWeekAgoVal"))
                words = name.replace("NIFTY ", "").replace(" INDEX", "").split()
                label = " ".join(w if w in ("IT", "PSU", "FMCG") else w.title() for w in words)
                out.append({
                    "sector": label,
                    "last": round(last, 2),
                    "change_pct": round(float(row.get("percentChange") or 0), 2),
                    # 1-week % — separates a one-day blip from a real trend.
                    "week_pct": round((last - week_ago) / week_ago * 100, 2)
                                if week_ago else None,
                })
        out.sort(key=lambda x: x["change_pct"], reverse=True)
        print(f"[OK] get_sector_indices: {len(out)} sectors")
        return out or None
    except Exception as e:
        print(f"[ERROR] get_sector_indices: {e}")
        return None


def get_delivery_map() -> dict[str, float]:
    """
    Delivery-to-traded % for ALL NSE stocks from the daily bhavcopy archive
    (archives.nseindia.com — static host, no cookie dance, one request).
    High delivery on an up move hints at genuine institutional buying rather
    than intraday churn.

    The /api/quote-equity endpoint 403s for non-browser clients, so this CSV
    is the reliable route. Walks back up to 5 days to find the latest session.

    Returns {SYMBOL: delivery_pct} for the EQ series; empty dict on failure.
    """
    from datetime import datetime, timedelta

    for days_back in range(1, 6):
        day = datetime.now() - timedelta(days=days_back)
        url = (
            "https://archives.nseindia.com/products/content/"
            f"sec_bhavdata_full_{day.strftime('%d%m%Y')}.csv"
        )
        try:
            r = requests.get(url, timeout=TIMEOUT,
                             headers={"User-Agent": _HEADERS["User-Agent"]})
            if r.status_code != 200:
                continue  # weekend/holiday — try the previous day
            out: dict[str, float] = {}
            lines = r.text.splitlines()
            header = [h.strip() for h in lines[0].split(",")]
            i_sym = header.index("SYMBOL")
            i_series = header.index("SERIES")
            i_dp = header.index("DELIV_PER")
            for line in lines[1:]:
                parts = [p.strip() for p in line.split(",")]
                if len(parts) <= i_dp or parts[i_series] != "EQ":
                    continue
                try:
                    out[parts[i_sym]] = round(float(parts[i_dp]), 2)
                except ValueError:
                    continue  # DELIV_PER can be '-'
            print(f"[OK] get_delivery_map: {len(out)} stocks "
                  f"({day.strftime('%d-%b-%Y')})")
            return out
        except Exception as e:
            print(f"[WARN] get_delivery_map {day.strftime('%d%m%Y')}: {e}")
    print("[ERROR] get_delivery_map: no bhavcopy found in last 5 days")
    return {}


def get_fii_dii_data() -> dict | None:
    """FII/DII net cash-market activity in crores for the latest session."""
    data = _fetch_json("/api/fiidiiTradeReact")
    if not data:
        print("[ERROR] get_fii_dii_data: no data")
        return None
    try:
        fii_net = dii_net = None
        date = None
        for row in data:
            category = (row.get("category") or "").upper()
            net = row.get("netValue")
            net = round(float(net), 2) if net is not None else None
            date = row.get("date", date)
            if "FII" in category or "FPI" in category:
                fii_net = net
            elif "DII" in category:
                dii_net = net
        result = {"fii_net_buy_sell": fii_net, "dii_net_buy_sell": dii_net, "date": date}
        print(f"[OK] get_fii_dii_data: FII={fii_net} DII={dii_net} ({date})")
        return result
    except Exception as e:
        print(f"[ERROR] get_fii_dii_data: {e}")
        return None


def get_india_vix() -> dict | None:
    """Current INDIA VIX level and session % change."""
    data = _fetch_json("/api/allIndices")
    if not data:
        print("[ERROR] get_india_vix: no data")
        return None
    try:
        for row in data.get("data", []):
            name = (row.get("index") or row.get("indexSymbol") or "").upper()
            if "INDIA VIX" in name:
                value = row.get("last")
                change_pct = row.get("percentChange")
                result = {
                    "value": round(float(value), 2) if value is not None else None,
                    "change_pct": round(float(change_pct), 2) if change_pct is not None else None,
                }
                print(f"[OK] get_india_vix: {result['value']} ({result['change_pct']}%)")
                return result
        print("[ERROR] get_india_vix: INDIA VIX not found in response")
        return None
    except Exception as e:
        print(f"[ERROR] get_india_vix: {e}")
        return None


# ── Report helpers (pre-market / afternoon / evening) ─────────────────────────

def _num(v):
    """NSE sends numbers as floats, strings, '-' or ''. → float or None."""
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def get_gift_nifty() -> dict | None:
    """
    Live GIFT Nifty (NSE IX near-month future) from NSE's marketStatus feed.
    {last, change, change_pct, as_of, expiry}. Note it's a FUTURE, so its
    price carries a premium over Nifty spot — read change_pct, not the
    raw gap to the spot close.
    """
    data = _fetch_json("/api/marketStatus")
    g = (data or {}).get("giftnifty") or {}
    last = _num(g.get("LASTPRICE"))
    if last is None:
        print("[ERROR] get_gift_nifty: no GIFT Nifty in marketStatus")
        return None
    result = {
        "last": last,
        "change": _num(g.get("DAYCHANGE")),
        "change_pct": _num(g.get("PERCHANGE")),
        "as_of": g.get("TIMESTMP"),
        "expiry": g.get("EXPIRYDATE"),
    }
    print(f"[OK] get_gift_nifty: {last} ({result['change_pct']}%) at {result['as_of']}")
    return result


def get_index_board() -> dict | None:
    """
    NIFTY 50, NIFTY BANK and INDIA VIX rows from allIndices:
    {"NIFTY 50": {last, change, change_pct, open, high, low, prev_close,
                  advances, declines, week_pct}, ..., "_date": "23-Nov-2026"}
    Before the open this is the previous session's close.
    """
    data = _fetch_json("/api/allIndices")
    if not data:
        print("[ERROR] get_index_board: no data")
        return None
    out = {"_date": None}
    for row in data.get("data", []):
        name = (row.get("index") or "").upper().strip()
        if name not in ("NIFTY 50", "NIFTY BANK", "INDIA VIX"):
            continue
        last = _num(row.get("last"))
        week_ago = _num(row.get("oneWeekAgoVal"))
        out[name] = {
            "last": last,
            "change": _num(row.get("variation")),
            "change_pct": _num(row.get("percentChange")),
            "open": _num(row.get("open")),
            "high": _num(row.get("high")),
            "low": _num(row.get("low")),
            "prev_close": _num(row.get("previousClose")),
            "advances": int(_num(row.get("advances")) or 0),
            "declines": int(_num(row.get("declines")) or 0),
            "week_pct": round((last - week_ago) / week_ago * 100, 2)
                        if last and week_ago else None,
        }
        out["_date"] = out["_date"] or row.get("previousDay")
    # The session the numbers belong to (marketStatus knows it exactly).
    ms = _fetch_json("/api/marketStatus") or {}
    for m in ms.get("marketState", []):
        if m.get("market") == "Capital Market" and m.get("tradeDate"):
            out["_date"] = m["tradeDate"][:11]
            out["_status"] = m.get("marketStatusMessage")
    print(f"[OK] get_index_board: {[k for k in out if not k.startswith('_')]} ({out['_date']})")
    return out if len(out) > 2 else None


def get_top_movers(index: str = "NIFTY", n: int = 3) -> dict:
    """Top gainers / losers in an index today: {"gainers": [...], "losers": [...]}."""
    out = {"gainers": [], "losers": []}
    for key, path in (("gainers", "gainers"), ("losers", "loosers")):  # sic: NSE spells it 'loosers'
        data = _fetch_json(f"/api/live-analysis-variations?index={path}")
        rows = ((data or {}).get(index) or {}).get("data") or []
        items = [{"symbol": r.get("symbol"),
                  "ltp": _num(r.get("ltp")),
                  "change_pct": _num(r.get("perChange") or r.get("net_price"))}
                 for r in rows]
        items = [i for i in items if i["change_pct"] is not None
                 and (i["change_pct"] > 0 if key == "gainers" else i["change_pct"] < 0)]
        # NSE's order isn't reliable (BANKNIFTY losers come smallest-first).
        items.sort(key=lambda i: i["change_pct"], reverse=(key == "gainers"))
        out[key] = items[:n]
    print(f"[OK] get_top_movers({index}): {len(out['gainers'])} up / {len(out['losers'])} down")
    return out


def get_index_constituents() -> dict[str, list[str]]:
    """{SYMBOL: ["Nifty 50", "Bank Nifty"]} from NSE's published index lists."""
    lists = {"Nifty 50": "ind_nifty50list.csv", "Bank Nifty": "ind_niftybanklist.csv"}
    out: dict[str, list[str]] = {}
    for label, fname in lists.items():
        try:
            r = requests.get(f"https://archives.nseindia.com/content/indices/{fname}",
                             headers={"User-Agent": _HEADERS["User-Agent"]}, timeout=TIMEOUT)
            r.raise_for_status()
            lines = r.text.splitlines()
            i_sym = [h.strip() for h in lines[0].split(",")].index("Symbol")
            for line in lines[1:]:
                parts = line.split(",")
                if len(parts) > i_sym and parts[i_sym].strip():
                    out.setdefault(parts[i_sym].strip(), []).append(label)
        except Exception as e:
            print(f"[WARN] get_index_constituents {label}: {e}")
    print(f"[OK] get_index_constituents: {len(out)} symbols")
    return out


def get_upcoming_events(days: int = 7) -> dict:
    """
    Corporate events for Nifty 50 / Bank Nifty companies in the next `days`:
      results  — board meetings for financial results (and other meetings)
      actions  — ex-dates for dividends, splits, bonuses, buybacks
    Each item: {date, symbol, indices, what}. Sorted by date.
    """
    from datetime import timedelta
    today = _today_ist()
    frm, to = today.strftime("%d-%m-%Y"), (today + timedelta(days=days)).strftime("%d-%m-%Y")
    members = get_index_constituents()
    out = {"results": [], "actions": []}

    for ev in _fetch_json(f"/api/event-calendar?index=equities&from_date={frm}&to_date={to}") or []:
        sym = ev.get("symbol")
        if sym in members:
            out["results"].append({"date": ev.get("date"), "symbol": sym,
                                   "indices": members[sym],
                                   "what": ev.get("purpose") or "Board meeting"})

    url = f"/api/corporates-corporateActions?index=equities&from_date={frm}&to_date={to}"
    for ca in _fetch_json(url) or []:
        sym = ca.get("symbol")
        if sym in members:
            out["actions"].append({"date": ca.get("exDate"), "symbol": sym,
                                   "indices": members[sym],
                                   "what": ca.get("subject") or "Corporate action"})

    for k in out:
        out[k].sort(key=lambda x: _parse_date(x["date"]) or today)
    print(f"[OK] get_upcoming_events: {len(out['results'])} meetings, {len(out['actions'])} actions")
    return out


def get_trading_holidays() -> list[dict]:
    """NSE equity trading holidays this year: [{date, day, name}]."""
    data = _fetch_json("/api/holiday-master?type=trading") or {}
    out = [{"date": h.get("tradingDate"), "day": h.get("weekDay"), "name": h.get("description")}
           for h in data.get("CM", [])]
    print(f"[OK] get_trading_holidays: {len(out)} holidays")
    return out


def is_trading_holiday(day=None) -> str | None:
    """Holiday name if `day` (default today, IST) is an NSE holiday, else None."""
    day = day or _today_ist()
    for h in get_trading_holidays():
        if _parse_date(h["date"]) == day:
            return h["name"]
    return None
