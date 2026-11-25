"""Render every report end-to-end with all network calls replaced by synthetic data."""
import os
import re
import sys
import types
import unittest
from datetime import date, datetime
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("GEMINI_API_KEY", "test")
sys.modules.setdefault("feedparser", types.ModuleType("feedparser"))  # optional dep for news

import pytz  # noqa: E402

import synth  # noqa: E402
from modules import ai_engine, market_data, news, nse_data, reports, telegram  # noqa: E402

IST = pytz.timezone("Asia/Kolkata")
DAYS = ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23"]
TODAY = "2026-11-25"


class FakeWorld:
    def __init__(self, mode, upto="11:40", drift=0.00025):
        sessions = DAYS + ([TODAY] if mode != "pre" else [])
        self.data = {}
        for key, start, step, seed in (("^NSEI", 25350.0, 50, 3), ("^NSEBANK", 62600.0, 100, 4)):
            d, i = synth.market(sessions, start=start, seed=seed, upto=upto if mode == "live" else "15:25",
                                vol=False, last_drift=drift)
            _, proxy = synth.market(sessions, start=start / 100, seed=seed + 50, upto=upto if mode == "live" else "15:25")
            proxy.index = i.index
            self.data[key] = (d, i, proxy)
        self.spot = {"NIFTY": float(self.data["^NSEI"][1]["Close"].iloc[-1]),
                     "BANKNIFTY": float(self.data["^NSEBANK"][1]["Close"].iloc[-1])}

    def bundle(self, yf_sym, proxy):
        d, i, p = self.data[yf_sym]
        return {"daily": d, "intra": i, "proxy": p}

    def chain(self, sym, expiry=None, expiries=None):
        step = 50 if sym == "NIFTY" else 100
        exp = expiry or (date(2026, 12, 1) if sym == "NIFTY" else date(2026, 12, 29))
        c = synth.chain(self.spot[sym], step=step, expiry=exp)
        c["expiries"] = self.expiries(sym)
        return c

    @staticmethod
    def expiries(sym):
        if sym == "NIFTY":
            return [date(2026, 12, 1), date(2026, 12, 8), date(2026, 12, 15), date(2026, 12, 22), date(2026, 12, 29)]
        return [date(2026, 12, 29), date(2027, 1, 26)]

    def patches(self, now):
        board = {"INDIA VIX": {"last": 14.2, "change_pct": -3.1}, "_date": "23-Nov-2026"}
        cues = [{"label": l, "symbol": s, "group": g, "last": 100.0 + n, "change_pct": 0.4 - n * 0.1, "as_of": "24 Nov"}
                for n, (l, s, g) in enumerate(market_data.GLOBAL_TICKERS)]
        return [
            mock.patch.object(nse_data, "get_index_board", return_value=board),
            mock.patch.object(nse_data, "get_trading_holidays",
                              return_value=[{"date": "24-Nov-2026", "day": "Tuesday", "name": "Guru Nanak Jayanti"},
                                            {"date": "25-Dec-2026", "day": "Friday", "name": "Christmas"}]),
            mock.patch.object(nse_data, "get_expiries", side_effect=self.expiries),
            mock.patch.object(nse_data, "get_chain", side_effect=self.chain),
            mock.patch.object(nse_data, "get_index_futures", return_value={"expiry": "29-Dec-2026", "last": 25890.0,
                                                                         "vwap": 25850.0, "oi": 1.6e7, "chg_oi": 2e5,
                                                                         "volume": 1e5, "underlying": 25800.0}),
            mock.patch.object(nse_data, "get_fii_dii_data", return_value={"fii_net_buy_sell": -1234.5,
                                                                        "dii_net_buy_sell": 2345.6, "date": "23-Nov-2026"}),
            mock.patch.object(nse_data, "get_sector_indices", return_value=[
                {"sector": "Private Bank", "last": 1, "change_pct": 2.1, "week_pct": 1.0},
                {"sector": "IT", "last": 1, "change_pct": 1.2, "week_pct": 2.0},
                {"sector": "Metal", "last": 1, "change_pct": -1.4, "week_pct": -3.0},
                {"sector": "Pharma", "last": 1, "change_pct": -0.3, "week_pct": 0.5}]),
            mock.patch.object(nse_data, "get_gift_nifty", return_value={"last": 25660.0, "change": 300.0,
                                                                      "change_pct": 1.18, "as_of": "25-Nov-2026 08:40"}),
            mock.patch.object(nse_data, "get_upcoming_events", return_value={
                "results": [{"date": "10-Dec-2026", "symbol": "INFY", "indices": ["Nifty 50"], "what": "Results"}],
                "actions": []}),
            mock.patch.object(nse_data, "get_top_movers", return_value={
                "gainers": [{"symbol": "HDFCBANK", "change_pct": 3.4}], "losers": [{"symbol": "TATASTEEL", "change_pct": -2.0}]}),
            mock.patch.object(nse_data, "get_next_expiries", return_value=["01-Dec-2026"]),
            mock.patch.object(market_data, "get_index_bundle", side_effect=self.bundle),
            mock.patch.object(market_data, "get_global_cues", return_value=cues),
            mock.patch.object(news, "fetch_indian_news", return_value=[
                {"title": "Banks lead rebound after Monday's sell-off", "source": "Test", "published": None}]),
            mock.patch.object(ai_engine, "narrate", return_value=None),  # template fallback path
            mock.patch.object(reports, "datetime", wraps=datetime, **{"now.return_value": now}),
        ]


def render(builder, mode, now, **kw):
    w = FakeWorld(mode, **kw)
    ps = w.patches(now)
    for p in ps:
        p.start()
    try:
        return builder()
    finally:
        for p in reversed(ps):
            p.stop()


def assert_telegram_safe(tc, msg):
    chunks = telegram._chunks(msg)
    for c in chunks:
        tc.assertLessEqual(len(c), telegram._TELEGRAM_MAX)
        for tag in ("b", "i", "pre"):
            tc.assertEqual(len(re.findall(f"<{tag}>", c)), len(re.findall(f"</{tag}>", c)),
                           f"unbalanced <{tag}> in a chunk")
    tc.assertNotIn("None", re.sub(r"<[^>]+>", "", msg).replace("NONE", ""))
    return chunks


class ReportTests(unittest.TestCase):
    def setUp(self):
        self._tmp = reports.PLAN_PATH
        reports.PLAN_PATH = reports.Path(os.path.join(os.path.dirname(__file__), "_day_plan_test.json"))

    def tearDown(self):
        if reports.PLAN_PATH.exists():
            reports.PLAN_PATH.unlink()
        reports.PLAN_PATH = self._tmp

    def test_premarket(self):
        now = IST.localize(datetime(2026, 11, 25, 8, 45))
        msg, data = render(reports.build_premarket, "pre", now)
        for s in ("PRE-MARKET REPORT", "GIFT Nifty", "A — Bullish", "B — Bearish", "C — No-trade",
                  "FINAL 8:45 AM TRADE PLAN", "BEST SETUP:", "SECONDARY SETUP:", "NO-TRADE ZONE:",
                  "TRADE DECISION", "Market Bias:", "Position Size:", "Action:", "India VIX", "FII / DII"):
            self.assertIn(s, msg)
        self.assertTrue(reports.PLAN_PATH.exists(), "day plan saved for the midday report")
        assert_telegram_safe(self, msg)

    def test_midday_uses_morning_plan(self):
        pre = IST.localize(datetime(2026, 11, 25, 8, 45))
        render(reports.build_premarket, "pre", pre)
        now = IST.localize(datetime(2026, 11, 25, 11, 45))
        msg, _ = render(reports.build_midday, "live", now)
        for s in ("MIDDAY REPORT", "First 15-min range", "First 30-min", "VWAP", "Morning plan",
                  "What is happening now?", "What is likely after 12 PM?", "1. Bullish", "2. Bearish",
                  "3. Range-bound", "TRADE DECISION", "Action:"):
            self.assertIn(s, msg)
        self.assertRegex(msg, r"(HOLD|BOOK PROFIT|TRAIL|EXIT|WAIT|ENTER NEW TRADE|NO TRADE)")
        assert_telegram_safe(self, msg)

    def test_evening(self):
        now = IST.localize(datetime(2026, 11, 25, 18, 0))
        msg, _ = render(reports.build_evening, "eod", now)
        for s in ("DAILY MARKET REPORT", "Market summary", "Buyers stepped in at", "Sellers stepped in at",
                  "False breakouts", "Tomorrow's setup", "Bullish above", "Bearish below",
                  "Tomorrow's bullish plan", "Tomorrow's bearish plan", "Tomorrow's no-trade zone",
                  "Trading lesson", "TRADE DECISION (for tomorrow)"):
            self.assertIn(s, msg)
        assert_telegram_safe(self, msg)

    def test_monthly(self):
        now = IST.localize(datetime(2026, 12, 1, 8, 45))
        msg, data = render(lambda: reports.build_monthly(2026, 12), "pre", now)
        ev = data["events"]
        self.assertIn("RBI MPC policy decision (meeting 2–4 Dec)", [e["event"] for e in ev])
        self.assertTrue(any(e["date"] == date(2026, 12, 29) and e["impact"] == "HIGH" for e in ev))
        self.assertTrue(any(e["date"] == date(2026, 12, 25) and e["type"] == "holiday" for e in ev))
        self.assertIn("HIGH", msg)
        assert_telegram_safe(self, msg)


if __name__ == "__main__":
    unittest.main()
