"""
AI pre-market pipeline — data gathering → screening → AI report.

Used by both the 8:15 AM cron flow (bot.py) and the on-demand /premarket
command. The finished report is cached to data/premarket_report.json; the
workflow commits it, so the command listener (a separate CI job) can serve
today's report instantly instead of regenerating it.
"""

import json
from datetime import datetime
from pathlib import Path

import pytz

from modules import nse_data, market_data, news, ai_engine, screener

IST = pytz.timezone("Asia/Kolkata")
REPORT_PATH = Path("data/premarket_report.json")


def _today_ist() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


def generate(strategy_resolver) -> tuple[dict, dict]:
    """
    Run the full pipeline. Returns (report, nse_context).
    Every data layer is best-effort; the AI is told what's missing.
    """
    # 1. Index/derivatives context
    nse = {
        "gift_nifty": market_data.get_gift_nifty(),
        "vix": nse_data.get_india_vix(),
        "nifty_chain": nse_data.get_nifty_options_chain(),
        "banknifty_chain": nse_data.get_banknifty_options_chain(),
        "fii_dii": nse_data.get_fii_dii_data(),
    }
    strategy = strategy_resolver(nse)
    sectors = nse_data.get_sector_indices()

    # 2. Quantitative screen over the F&O universe
    rows = screener.screen_universe()
    bulls, bears = screener.shortlist(rows)

    # 3. Deep dive only on the shortlist (options chain, delivery, fundamentals)
    delivery_map = nse_data.get_delivery_map()
    screener.deep_dive(bulls, delivery_map=delivery_map)
    screener.deep_dive(bears, delivery_map=delivery_map)

    scan = {
        "total": len(rows),
        "advances": sum(1 for r in rows if (r.get("change_pct") or 0) > 0),
        "declines": sum(1 for r in rows if (r.get("change_pct") or 0) < 0),
        "bulls": bulls,
        "bears": bears,
    }

    # 4. News + AI report
    headlines = [h["title"] for h in news.fetch_indian_news()]
    if len(headlines) < 8:
        headlines += news.fetch_global_news()

    report = ai_engine.premarket_report(scan, sectors, nse, headlines[:15], strategy)
    report["generated_date"] = _today_ist()
    report["generated_at"] = datetime.now(IST).strftime("%d %b %Y %I:%M %p IST")
    report["sectors_raw"] = sectors or []
    report["strategy_name"] = strategy["name"]

    save(report)
    return report, nse


def save(report: dict):
    try:
        REPORT_PATH.parent.mkdir(exist_ok=True)
        REPORT_PATH.write_text(json.dumps(report, indent=1, default=str))
        print(f"[OK] premarket.save: {REPORT_PATH}")
    except Exception as e:
        print(f"[WARN] premarket.save: {e}")


def load_cached(today_only: bool = True) -> dict | None:
    """Today's cached report, or None (stale reports are not served)."""
    try:
        if not REPORT_PATH.exists():
            return None
        report = json.loads(REPORT_PATH.read_text())
        if today_only and report.get("generated_date") != _today_ist():
            print("[OK] premarket.load_cached: cache is stale")
            return None
        return report
    except Exception as e:
        print(f"[WARN] premarket.load_cached: {e}")
        return None
