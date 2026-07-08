"""
News fetchers.

Indian market headlines come from free RSS feeds (feedparser); global
headlines keep the original GNews logic. Any single feed failing is skipped
silently so one dead feed never blocks the rest.
"""

import os
import time
import calendar
from datetime import datetime, timezone, timedelta

import requests
import feedparser

INDIAN_RSS_FEEDS = [
    ("Economic Times", "https://economictimes.indiatimes.com/markets/rss.cms"),
    ("Moneycontrol", "https://www.moneycontrol.com/rss/marketreports.xml"),
    ("NDTV Profit", "https://feeds.feedburner.com/ndtvprofit-latest"),
]

_LOOKBACK = timedelta(hours=12)
_MAX_INDIAN = 15
TIMEOUT = 10


def _entry_dt(entry) -> datetime | None:
    """Best-effort UTC datetime for an RSS entry, or None."""
    for key in ("published_parsed", "updated_parsed"):
        t = entry.get(key)
        if t:
            try:
                return datetime.fromtimestamp(calendar.timegm(t), tz=timezone.utc)
            except Exception:
                continue
    return None


def fetch_indian_news() -> list[dict]:
    """
    Recent Indian market headlines from RSS, last 12 hours only.

    Returns list of {title, source, published}, newest first, capped at 15.
    """
    now = datetime.now(timezone.utc)
    items: list[dict] = []

    for source, url in INDIAN_RSS_FEEDS:
        try:
            # feedparser can fetch directly, but a short requests.get lets us
            # enforce a timeout and skip cleanly on network trouble.
            resp = requests.get(url, timeout=TIMEOUT, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            feed = feedparser.parse(resp.content)
            count = 0
            for entry in feed.entries:
                title = (entry.get("title") or "").strip()
                if not title:
                    continue
                dt = _entry_dt(entry)
                # Keep only last 12h; if no date, keep it (better than dropping).
                if dt is not None and now - dt > _LOOKBACK:
                    continue
                items.append({
                    "title": title,
                    "source": source,
                    "published": dt.isoformat() if dt else None,
                    "_sort": dt or now,
                })
                count += 1
            print(f"[OK] fetch_indian_news {source}: {count} recent")
        except Exception as e:
            print(f"[WARN] fetch_indian_news {source}: {e}")
            continue

    items.sort(key=lambda x: x["_sort"], reverse=True)
    trimmed = [{k: v for k, v in it.items() if k != "_sort"} for it in items[:_MAX_INDIAN]]
    print(f"[OK] fetch_indian_news: {len(trimmed)} headlines total")
    return trimmed


def fetch_global_news() -> list[str]:
    """
    Global finance headlines via GNews free API (original bot.py logic).
    Returns a de-duplicated list of title strings.
    """
    api_key = os.environ.get("GNEWS_API_KEY", "")
    headlines: list[str] = []

    topics = ["stock market", "options trading", "Federal Reserve"]
    for topic in topics:
        try:
            url = (
                f"https://gnews.io/api/v4/search?q={requests.utils.quote(topic)}"
                f"&lang=en&max=3&token={api_key}"
            ) if api_key else (
                "https://gnews.io/api/v4/top-headlines?topic=business&lang=en&max=5"
                "&token=demo"
            )
            r = requests.get(url, timeout=TIMEOUT)
            if r.status_code == 200:
                for a in r.json().get("articles", []):
                    headlines.append(a.get("title", ""))
        except Exception as e:
            print(f"[WARN] fetch_global_news: {e}")

    if not headlines:
        headlines = [
            "Markets open with mixed signals amid global uncertainty",
            "Options activity surges ahead of Fed meeting",
        ]

    result = list(dict.fromkeys(h for h in headlines if h))[:12]
    print(f"[OK] fetch_global_news: {len(result)} headlines")
    return result
