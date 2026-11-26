"""
Send each scheduled report to the website as structured JSON.

The website (web/, Next.js on Vercel) only DISPLAYS what this engine
decided. Everything in the payload is copied from objects the report
builders already computed — levels, zones, scenarios, options, sizes,
the TRADE DECISION, the AI narration — nothing is recalculated here.

  POST {WEB_INGEST_URL}  (Authorization: Bearer {WEB_INGEST_TOKEN})

Publishing is best-effort: any failure is logged and swallowed, so the
Telegram report is never delayed or lost because of the website.
With DRY_RUN=1 (or no WEB_INGEST_URL) the payload is written to
data/web/<session>.json instead of being sent.

Payload (schema_version 2):
  session        premarket | midday | evening | monthly
  generated_at   ISO time, IST
  trade_date     the session the market data belongs to (YYYY-MM-DD)
  plan_for       the session the plan is for (evening → next trading day)
  data           board, vix, fii_dii, sectors, gift_nifty, global, news,
                 events_today, movers, upcoming, holidays, calendar …
  indices        per index: prev / today session, daily tech, intraday read,
                 option chain (summary + strikes near spot), futures,
                 plan {bias, zones, no_trade, bull, bear, action …}, eod {…}
  decision       the TRADE DECISION block
  ai             Gemini's plain-words narration (optional)
  telegram_html  the exact message sent to Telegram
"""

from __future__ import annotations

import json
import math
import os
from datetime import date, datetime
from pathlib import Path

import requests

from modules.telegram import IST

SCHEMA_VERSION = 2
OUT_DIR = Path("data/web")
STRIKES_EACH_SIDE = 25  # chain rows kept around spot

# Bulky or internal objects that never go to the website
_DROP_KEYS = {"sessions", "today_bars", "prev_bars", "vwap_series", "bars15", "cfg", "rows", "_vals", "_hi"}


class _Skip:  # sentinel for values that can't be represented in JSON
    pass


_SKIP = _Skip()


def _iso(x) -> str:
    if isinstance(x, datetime):
        if x.tzinfo is not None:
            x = x.astimezone(IST)
        return x.isoformat(timespec="seconds")
    return x.isoformat()


def clean(x):
    """JSON-safe copy: timestamps → ISO (IST), NaN → null, DataFrames dropped."""
    try:
        import numpy as np
        import pandas as pd
    except Exception:  # pragma: no cover
        np = pd = None
    if x is None or isinstance(x, (bool, str)):
        return x
    if isinstance(x, int):
        return x
    if isinstance(x, float):
        return None if (math.isnan(x) or math.isinf(x)) else x
    if np is not None:
        if isinstance(x, np.bool_):
            return bool(x)
        if isinstance(x, np.integer):
            return int(x)
        if isinstance(x, np.floating):
            f = float(x)
            return None if (math.isnan(f) or math.isinf(f)) else f
    if pd is not None:
        if isinstance(x, (pd.DataFrame, pd.Series, pd.Index)):
            return _SKIP
        if isinstance(x, pd.Timestamp):
            return None if pd.isna(x) else _iso(x.to_pydatetime())
    if isinstance(x, (datetime, date)):
        return _iso(x)
    if isinstance(x, dict):
        out = {}
        for k, v in x.items():
            if str(k) in _DROP_KEYS:
                continue
            c = clean(v)
            if c is not _SKIP:
                out[str(k)] = c
        return out
    if isinstance(x, (list, tuple, set)):
        items = sorted(x) if isinstance(x, set) else x
        return [c for c in (clean(v) for v in items) if c is not _SKIP]
    return str(x)


# ── Pieces ────────────────────────────────────────────────────────────────────

def _strikes(ch: dict) -> list[dict]:
    """Chain rows near spot, flattened (strike, ce_oi, …, pe_ltp)."""
    rows = ch.get("rows") or []
    spot = ch.get("spot")
    if spot is not None:
        rows = sorted(rows, key=lambda r: abs((r.get("strike") or 0) - spot))[: STRIKES_EACH_SIDE * 2 + 1]
    out = []
    for r in sorted(rows, key=lambda r: r.get("strike") or 0):
        row = {"strike": r.get("strike")}
        for side, key in (("ce", "CE"), ("pe", "PE")):
            leg = r.get(key) or {}
            for f in ("oi", "chg_oi", "volume", "iv", "ltp", "bid", "ask"):
                row[f"{side}_{f}"] = leg.get(f)
        out.append(row)
    return clean(out)


def _chain(ch: dict | None) -> dict | None:
    if not ch:
        return None
    return clean({
        "symbol": ch.get("symbol"), "expiry": ch.get("expiry"), "dte": ch.get("dte"),
        "expiry_note": ch.get("expiry_note"), "summary_expiry": ch.get("summary_expiry"),
        "spot": ch.get("spot"), "summary": ch.get("summary"),
        "expiries": (ch.get("expiries") or [])[:6], "strikes": _strikes(ch),
    })


def _scenarios(sc: dict | None) -> dict:
    """{ref, sl_buf, zones, no_trade, bull, bear} from planner.build_scenarios()."""
    sc = sc or {}
    return clean({k: sc.get(k) for k in ("ref", "sl_buf", "zones", "no_trade", "bull", "bear")})


def _index(snap: dict, plan: dict | None = None, eod: dict | None = None) -> dict:
    cfg = snap.get("cfg") or {}
    return clean({
        "key": snap.get("key"), "label": snap.get("label"), "mode": snap.get("mode"),
        "lot": cfg.get("lot"), "step": cfg.get("step"), "expiry_kind": cfg.get("expiry_kind"),
        "yahoo": cfg.get("yf"),
        "weight_source": snap.get("weight_source"),
        "prev": snap.get("prev"), "today": snap.get("today"), "tech": snap.get("tech"),
        "intraday": snap.get("intraday"), "futures": snap.get("futures"),
        "chain": _chain(snap.get("chain")),
        "plan": plan, "eod": eod,
    })


def _setup_ref(entry, names: dict) -> dict | None:
    if not entry:
        return None
    rank, k, side, sc = entry
    return {"index": k, "side": side, "rank": round(float(rank), 3), "name": names.get((k, side))}


def _decision(dec: dict | None) -> dict | None:
    if not dec:
        return None
    from modules import reports  # late import: reports imports nothing from here
    names = {}
    for e in (dec.get("best"), dec.get("secondary")):
        if e:
            names[(e[1], e[2])] = reports._setup_name(e[1], e[3])
    return clean({
        "market_bias": dec.get("market_bias"), "conflict": dec.get("conflict"),
        "confidence": dec.get("confidence"), "action": dec.get("action"), "reason": dec.get("reason"),
        "biases": dec.get("biases"),
        "best": _setup_ref(dec.get("best"), names),
        "secondary": _setup_ref(dec.get("secondary"), names),
        "size_blocked": [{"index": k, "side": s, "size": sz} for k, s, sz in dec.get("size_blocked") or []],
    })


def _account(acct: dict | None) -> dict | None:
    # Capital itself is not published (the site is public); sizes already
    # carry the per-trade budget the engine used.
    if not acct:
        return None
    return {"risk_pct": acct.get("risk_pct"), "capital_is_default": acct.get("capital_is_default"),
            "costs_per_lot": acct.get("costs_per_lot")}


def _common(g: dict) -> dict:
    board = {k: v for k, v in (g.get("board") or {}).items() if not str(k).startswith("_")}
    return {"board": board, "board_date": (g.get("board") or {}).get("_date"),
            "board_status": (g.get("board") or {}).get("_status"),
            "vix": g.get("vix_row"), "fii_dii": g.get("fii"), "sectors": g.get("sectors")}


# ── Payload ───────────────────────────────────────────────────────────────────

def build_payload(session: str, message: str, data: dict | None, now: datetime | None = None) -> dict:
    now = now or datetime.now(IST)
    w = (data or {}).get("web") or {}
    g = w.get("g") or {}
    out: dict = {
        "schema_version": SCHEMA_VERSION, "session": session,
        "generated_at": _iso(now), "trade_date": now.date().isoformat(), "plan_for": None,
        "market_status": None, "source": _source(), "data": {}, "indices": {}, "decision": None,
        "account": _account(w.get("acct")), "ai": w.get("ai") or None, "note": w.get("unavailable"),
        "telegram_html": message,
    }
    snaps = g.get("snaps") or {}

    if session == "premarket":
        out["plan_for"] = now.date().isoformat()
        out["market_status"] = "pre-open"
        out["data"] = {**_common(g), "gift_nifty": w.get("gift"), "global": w.get("cues"),
                       "news": w.get("headlines"), "events_today": w.get("events_today")}
        for k, snap in snaps.items():
            p = (w.get("plans") or {}).get(k) or {}
            plan = {"kind": "premarket", "ok": bool(p.get("ok")), "reason": p.get("reason"),
                    "bias": (w.get("biases") or {}).get(k), "expected_open": p.get("expected_open"),
                    "gap_pct": p.get("gap_pct"), "gap_words": p.get("gap_words"), "atr": p.get("atr"),
                    **_scenarios(p.get("scenarios"))}
            out["indices"][k] = _index(snap, plan)

    elif session == "midday":
        out["plan_for"] = now.date().isoformat()
        out["market_status"] = "open"
        out["data"] = _common(g)
        for k, snap in snaps.items():
            m = (w.get("mids") or {}).get(k)
            plan = None
            if m:
                morning = m.get("morning") or {}
                plan = {"kind": "midday", "ok": True, "bias": (w.get("biases") or {}).get(k),
                        "action": m.get("action"), "action_why": m.get("action_why"), "late": m.get("late"),
                        **_scenarios(m.get("scenarios")),
                        "morning": {"source": morning.get("source"), "ok": bool(morning.get("ok")),
                                    "bull": (morning.get("scenarios") or {}).get("bull"),
                                    "bear": (morning.get("scenarios") or {}).get("bear"),
                                    "status": m.get("status")} if morning else None}
            out["indices"][k] = _index(snap, plan)

    elif session == "evening":
        out["plan_for"] = (g.get("ref_day") or now.date()).isoformat()
        out["market_status"] = "closed"
        out["data"] = {**_common(g), "global": w.get("cues"), "news": w.get("headlines"),
                       "movers": w.get("movers"), "sector_momentum": w.get("sector_momentum"),
                       "upcoming": w.get("upcoming"), "upcoming_days": w.get("days_ahead"),
                       "expiries": w.get("expiries"), "holidays": w.get("holidays")}
        for k, snap in snaps.items():
            e = (w.get("eods") or {}).get(k)
            plan = eod = None
            if e:
                tom = e.get("tomorrow")
                plan = {"kind": "tomorrow", "ok": bool(tom), "bias": (w.get("biases") or {}).get(k),
                        **_scenarios(tom)}
                eod = {"buyers": e.get("buyers"), "sellers": e.get("sellers"),
                       "gap_fill": e.get("gap_fill"), "lesson": e.get("lesson")}
            out["indices"][k] = _index(snap, plan, eod)

    elif session == "monthly":
        out["market_status"] = None
        out["data"] = {"calendar": w.get("events") or (data or {}).get("events"),
                       "month": w.get("month")}

    out["decision"] = _decision(w.get("decision"))
    return clean(out)


def _source() -> dict:
    run = None
    if os.environ.get("GITHUB_RUN_ID") and os.environ.get("GITHUB_REPOSITORY"):
        run = (f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/"
               f"{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}")
    return {"engine": "trdbot rules engine (modules/planner.py)",
            "ai_model": os.environ.get("GEMINI_MODEL") or None,
            "commit": (os.environ.get("GITHUB_SHA") or "")[:7] or None,
            "run_url": run, "trigger": os.environ.get("TRIGGER") or os.environ.get("GITHUB_EVENT_NAME")}


# ── Delivery ──────────────────────────────────────────────────────────────────

def send(payload: dict) -> bool:
    url = (os.environ.get("WEB_INGEST_URL") or "").strip()
    token = (os.environ.get("WEB_INGEST_TOKEN") or "").strip()
    dry = (os.environ.get("DRY_RUN") or "").strip().lower() in ("1", "true", "yes")
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if dry or not url:
        if not dry:
            print("[SKIP] publish: WEB_INGEST_URL not set — website not updated")
            return False
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        path = OUT_DIR / f"{payload['session']}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=1))
        print(f"[OK] publish (dry run): wrote {path} ({len(body) / 1024:.0f} KB)")
        return True
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}
    for attempt in (1, 2):
        try:
            r = requests.post(url, data=body.encode(), headers=headers, timeout=20)
            if r.status_code < 300:
                print(f"[OK] publish: {payload['session']} → website ({len(body) / 1024:.0f} KB, {r.status_code})")
                return True
            print(f"[WARN] publish attempt {attempt}: HTTP {r.status_code} {r.text[:200]}")
            if r.status_code in (400, 401, 403, 413, 422):
                return False  # retrying won't help
        except Exception as e:
            print(f"[WARN] publish attempt {attempt}: {e}")
    return False


def publish_report(session: str, message: str, data: dict | None) -> bool:
    """Build + send; never raises (the Telegram report has already gone out)."""
    try:
        return send(build_payload(session, message, data))
    except Exception as e:
        print(f"[WARN] publish {session}: {e}")
        return False
