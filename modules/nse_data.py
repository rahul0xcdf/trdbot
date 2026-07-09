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
    expiries = ci.get("expiryDates") or []
    if not expiries:
        print(f"[ERROR] _fetch_chain_v3({symbol}): no expiry dates")
        return None
    expiry = expiries[0]  # nearest expiry

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
                out.append({
                    "sector": name.replace("NIFTY ", "").title(),
                    "last": round(float(row["last"]), 2),
                    "change_pct": round(float(row.get("percentChange") or 0), 2),
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
