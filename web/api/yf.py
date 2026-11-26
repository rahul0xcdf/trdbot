"""Yahoo Finance chart bridge for the website. RAW DATA ONLY.

Why this exists: from Vercel's Node runtime Yahoo answers every request with
HTTP 429. Yahoo serves clients that look like a real browser, which is why the
Telegram bot (yfinance, which uses curl_cffi) is not affected. This function
fetches the same public v8 chart JSON with curl_cffi impersonating Chrome and
returns it untouched. No indicators, levels or signals are computed here.

GET /api/yf?s=^NSEI,^NSEBANK&range=1d&interval=5m
  -> {"results": {"^NSEI": {"status": 200, "data": {...chart json...}}, ...}}

Called only by src/lib/market.ts. When INGEST_TOKEN is set, the caller must
send "Authorization: Bearer <INGEST_TOKEN>" so this is not an open proxy.

Local use (optional):  python3 api/yf.py   then
  YF_BRIDGE_URL=http://127.0.0.1:5328/api/yf npm run dev
"""

import asyncio
import hmac
import json
import os
import re
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, quote, urlparse

from curl_cffi.requests import AsyncSession

SYMBOL = re.compile(r"^[A-Za-z0-9^=._&-]{1,32}$")
RANGES = {"1d", "5d", "1mo", "60d", "3mo", "6mo", "1y", "2y", "5y"}
INTERVALS = {"1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "1wk"}
MAX_SYMBOLS = 25
IMPERSONATE = "chrome"

_crumb = {"value": None, "cookies": None}


async def _fetch_crumb(s):
    """Cookie + crumb, the way yfinance does it. Used only after a refusal."""
    try:
        await s.get("https://fc.yahoo.com", timeout=6, allow_redirects=True)
    except Exception:
        pass
    try:
        r = await s.get("https://query1.finance.yahoo.com/v1/test/getcrumb", timeout=6)
        text = (r.text or "").strip()
        if r.status_code == 200 and text and "<" not in text and len(text) < 64:
            _crumb["value"] = text
            _crumb["cookies"] = dict(s.cookies)
    except Exception:
        pass
    return _crumb["value"]


async def _one(s, symbol, rng, interval, crumb):
    path = (
        f"/v8/finance/chart/{quote(symbol, safe='')}"
        f"?range={rng}&interval={interval}&includePrePost=false"
    )
    if crumb:
        path += "&crumb=" + quote(crumb, safe="")
    last = {"status": 502, "error": "no response"}
    for host in ("query1", "query2"):
        try:
            r = await s.get(f"https://{host}.finance.yahoo.com{path}", timeout=8)
        except Exception as e:  # network error: try the other host
            last = {"status": 502, "error": f"{type(e).__name__}: {e}"[:200]}
            continue
        if r.status_code == 200:
            try:
                return {"status": 200, "data": r.json()}
            except Exception:
                last = {"status": 502, "error": "bad JSON from Yahoo"}
                continue
        if r.status_code == 404:  # unknown symbol: Yahoo's own error JSON
            try:
                return {"status": 404, "data": r.json()}
            except Exception:
                return {"status": 404, "error": "symbol not found"}
        last = {"status": r.status_code, "error": f"HTTP {r.status_code}"}
    return last


async def fetch_many(symbols, rng, interval):
    async with AsyncSession(impersonate=IMPERSONATE) as s:
        if _crumb["cookies"]:
            s.cookies.update(_crumb["cookies"])
        crumb = _crumb["value"]
        out = dict(zip(symbols, await asyncio.gather(
            *(_one(s, sym, rng, interval, crumb) for sym in symbols))))
        refused = [k for k, v in out.items() if v["status"] in (401, 403, 429)]
        if refused:  # retry once with a fresh cookie + crumb
            crumb = await _fetch_crumb(s)
            if crumb:
                retry = await asyncio.gather(
                    *(_one(s, sym, rng, interval, crumb) for sym in refused))
                out.update(zip(refused, retry))
        return out


def _run(coro):
    """asyncio.run, but safe if the runtime already has a loop in this thread."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(1) as ex:
        return ex.submit(asyncio.run, coro).result()


def _authorised(headers):
    token = os.environ.get("INGEST_TOKEN")
    if not token:
        return True
    got = headers.get("Authorization") or ""
    return hmac.compare_digest(got.encode(), f"Bearer {token}".encode())


class handler(BaseHTTPRequestHandler):
    def _send(self, code, body):
        raw = json.dumps(body, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if not _authorised(self.headers):
            return self._send(401, {"error": "unauthorised"})
        q = parse_qs(urlparse(self.path).query)
        symbols = [x.strip() for x in (q.get("s", [""])[0]).split(",") if x.strip()]
        rng = q.get("range", ["1d"])[0]
        interval = q.get("interval", ["5m"])[0]
        if not symbols or len(symbols) > MAX_SYMBOLS:
            return self._send(400, {"error": f"pass 1-{MAX_SYMBOLS} symbols in s="})
        bad = [x for x in symbols if not SYMBOL.match(x)]
        if bad or rng not in RANGES or interval not in INTERVALS:
            return self._send(400, {"error": "bad symbol, range or interval"})
        symbols = list(dict.fromkeys(symbols))
        results = _run(fetch_many(symbols, rng, interval))
        return self._send(200, {"results": results, "via": f"curl_cffi/{IMPERSONATE}"})

    def log_message(self, *args):  # keep function logs quiet
        pass


if __name__ == "__main__":
    from http.server import ThreadingHTTPServer

    port = int(os.environ.get("PORT", "5328"))
    print(f"Yahoo bridge on http://127.0.0.1:{port}/api/yf")
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
