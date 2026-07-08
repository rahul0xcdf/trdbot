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


def _fetch_chain_v3(kind: str, symbol: str) -> tuple[dict, dict] | None:
    """
    Fetch an option chain via NSE's current v3 API.

    NSE retired /api/option-chain-indices|equities; the live endpoint is
    /api/option-chain-v3, which requires an explicit expiry. We first pull the
    expiry list from /api/option-chain-contract-info and use the nearest one
    (ideal for the 0-7 DTE weekly intraday strategy).

    kind: "Indices" or "Equities". Returns (records, filtered) or None.
    """
    import urllib.parse

    ci = _fetch_json(
        f"/api/option-chain-contract-info?symbol={symbol}",
        referer="https://www.nseindia.com/option-chain",
    )
    if not ci:
        return None
    expiries = ci.get("expiryDates") or []
    if not expiries:
        print(f"[ERROR] _fetch_chain_v3({symbol}): no expiry dates")
        return None
    expiry = urllib.parse.quote(expiries[0])  # nearest expiry

    data = _fetch_json(
        f"/api/option-chain-v3?type={kind}&symbol={symbol}&expiry={expiry}",
        referer="https://www.nseindia.com/option-chain",
    )
    if not data:
        return None
    return data.get("records", {}), data.get("filtered", {})


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
        call_oi_by_strike: dict[float, int] = {}
        put_oi_by_strike: dict[float, int] = {}

        for row in rows:
            strike = row.get("strikePrice")
            ce = row.get("CE") or {}
            pe = row.get("PE") or {}
            ce_oi = ce.get("openInterest", 0) or 0
            pe_oi = pe.get("openInterest", 0) or 0
            total_call_oi += ce_oi
            total_put_oi += pe_oi
            if strike is not None:
                call_oi_by_strike[strike] = ce_oi
                put_oi_by_strike[strike] = pe_oi

        if not call_oi_by_strike:
            return None

        pcr = round(total_put_oi / total_call_oi, 2) if total_call_oi else None

        # ATM = listed strike nearest to spot.
        atm_strike = min(call_oi_by_strike, key=lambda k: abs(k - spot))

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

        return {
            "spot": round(spot, 2),
            "pcr": pcr,
            "max_pain": best_strike,
            "atm_strike": atm_strike,
            "total_call_oi": total_call_oi,
            "total_put_oi": total_put_oi,
            "top_call_oi_strikes": [s for s, _ in top_call],
            "top_put_oi_strikes": [s for s, _ in top_put],
        }
    except Exception as e:
        print(f"[ERROR] nse_data._summarise_chain: {e}")
        return None


def get_nifty_options_chain() -> dict | None:
    """Live NIFTY index option chain summary (PCR, max pain, top OI strikes)."""
    chain = _fetch_chain_v3("Indices", "NIFTY")
    if not chain:
        print("[ERROR] get_nifty_options_chain: no data")
        return None
    records, filtered = chain
    summary = _summarise_chain(records, filtered)
    if summary is None:
        print("[ERROR] get_nifty_options_chain: could not summarise chain")
        return None
    summary["symbol"] = "NIFTY"
    print(
        f"[OK] get_nifty_options_chain: PCR={summary['pcr']} "
        f"max_pain={summary['max_pain']} ATM={summary['atm_strike']}"
    )
    return summary


def get_stock_options_oi(symbol: str) -> dict | None:
    """Live equity option chain summary for a single NSE stock symbol."""
    chain = _fetch_chain_v3("Equities", symbol)
    if not chain:
        print(f"[ERROR] get_stock_options_oi({symbol}): no data")
        return None
    records, filtered = chain
    summary = _summarise_chain(records, filtered)
    if summary is None:
        print(f"[ERROR] get_stock_options_oi({symbol}): could not summarise chain")
        return None
    summary["symbol"] = symbol
    print(f"[OK] get_stock_options_oi({symbol}): PCR={summary['pcr']} max_pain={summary['max_pain']}")
    return summary


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
