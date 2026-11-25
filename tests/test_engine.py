"""Unit tests for the deterministic trading rules (no network)."""
import os
import sys
import types
import unittest
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("GEMINI_API_KEY", "test")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test")
os.environ.setdefault("TELEGRAM_CHAT_ID", "1")
sys.modules.setdefault("feedparser", types.ModuleType("feedparser"))

import pandas as pd  # noqa: E402
import pytz  # noqa: E402

from modules import calendar_events, levels as lv, options as opt, planner, telegram  # noqa: E402

IST = pytz.timezone("Asia/Kolkata")


def bars(rows, day="2026-11-25", start="09:15", freq="5min", w=None):
    idx = pd.date_range(f"{day} {start}", periods=len(rows), freq=freq, tz="Asia/Kolkata")
    df = pd.DataFrame(rows, columns=["Open", "High", "Low", "Close"], index=idx)
    df["Volume"] = 0.0
    df["W"] = w if w is not None else 1.0
    return df


class Levels(unittest.TestCase):
    def test_pivots(self):
        p = lv.floor_pivots(110, 90, 100)
        self.assertEqual(p["P"], 100)
        self.assertEqual(p["R1"], 110)
        self.assertEqual(p["S1"], 90)
        self.assertEqual(p["R2"], 120)

    def test_vwap_weighted(self):
        df = bars([(100, 100, 100, 100), (110, 110, 110, 110)], w=[1.0, 3.0])
        self.assertAlmostEqual(lv.vwap_series(df).iloc[-1], 107.5)

    def test_value_area_centres_on_heavy_price(self):
        rows = [(100, 101, 99, 100)] * 10 + [(120, 121, 119, 120)]
        va = lv.value_area(bars(rows), step=1)
        self.assertTrue(99 <= va["poc"] <= 101)
        self.assertLessEqual(va["vah"], 102)

    def test_false_breakout_detected(self):
        rows = [(100, 101, 99, 100), (100, 103, 100, 102), (102, 102, 99, 100), (100, 100, 98, 99)]
        ev = lv.level_tests(bars(rows), 101.5, "PDH", confirm=2)
        self.assertEqual(len(ev), 1)
        self.assertEqual(ev[0]["direction"], "up")
        self.assertTrue(ev[0]["failed"])

    def test_held_breakout(self):
        rows = [(100, 101, 99, 100), (100, 103, 100, 102.5), (102.5, 104, 102, 103.5), (103.5, 105, 103, 104)]
        ev = lv.level_tests(bars(rows), 101.5, "PDH", confirm=2)
        self.assertFalse(ev[0]["failed"])

    def test_candles(self):
        self.assertEqual(lv.candle_pattern(100, 110, 99, 109.5)["name"], "bullish marubozu")
        self.assertEqual(lv.candle_pattern(100, 105, 95, 100.2)["name"], "doji")
        self.assertEqual(lv.candle_pattern(98, 106, 97, 105, 104, 105, 99, 99.5)["name"], "bullish engulfing")

    def test_opening_range(self):
        rows = [(100, 102, 99, 101), (101, 103, 100, 102), (102, 104, 101, 103), (103, 110, 102, 109)]
        o = lv.opening_range(bars(rows), 15)
        self.assertEqual((o["low"], o["high"]), (99, 104))
        self.assertTrue(o["complete"])

    def test_cluster(self):
        z = lv.cluster([("PDH", 100), ("R1", 100.5), ("VAH", 105)], tol=1)
        self.assertEqual(len(z), 2)
        self.assertEqual(z[0]["names"], ["PDH", "R1"])

    def test_trendline_rising_support(self):
        lows = [100, 98, 96, 99, 101, 103, 100, 98, 101, 104, 106, 105, 107, 109, 111]
        rows = [(l + 2, l + 4, l, l + 3) for l in lows]
        idx = pd.bdate_range("2026-10-01", periods=len(rows), tz="Asia/Kolkata")
        df = pd.DataFrame(rows, columns=["Open", "High", "Low", "Close"], index=idx)
        tl = lv.trendlines(df, k=2)
        self.assertIn("support", tl)
        self.assertGreater(tl["support"]["slope_per_day"], 0)


class Options(unittest.TestCase):
    def test_put_call_parity_and_deltas(self):
        s, k, t, iv = 25000, 25000, 7 / 365, 13
        c, p = opt.bs(s, k, t, iv, "CE"), opt.bs(s, k, t, iv, "PE")
        import math
        self.assertAlmostEqual(c["price"] - p["price"], s - k * math.exp(-opt.RISK_FREE * t), places=4)
        self.assertTrue(0.45 < c["delta"] < 0.6)
        self.assertTrue(-0.55 < p["delta"] < -0.4)
        self.assertLess(c["theta"], 0)

    def test_sizing_caps_risk_at_one_percent(self):
        s = opt.size_position(risk_pts=10, lot=65, capital=200000, risk_pct=5)
        self.assertEqual(s["budget"], 2000)           # 5% request clamped to 1%
        self.assertEqual(s["lots"], 2)                # 750 per lot → 2 lots
        self.assertLessEqual(s["risk_total"], 2000)

    def test_sizing_zero_lots_when_one_lot_too_big(self):
        s = opt.size_position(risk_pts=30, lot=65, capital=100000, risk_pct=1)
        self.assertEqual(s["lots"], 0)
        self.assertGreater(s["capital_for_1_lot"], 100000)

    def test_expiry_rolls_on_expiry_day(self):
        exps = [date(2026, 12, 1), date(2026, 12, 8)]
        e, dte, note = opt.choose_expiry(exps, date(2026, 12, 1), min_dte=1)
        self.assertEqual(e, date(2026, 12, 8))
        self.assertIn("skipped", note)
        e, dte, _ = opt.choose_expiry(exps, date(2026, 11, 30), min_dte=1)
        self.assertEqual((e, dte), (date(2026, 12, 1), 1))

    def test_pick_never_far_otm(self):
        rows = [{"strike": k, "CE": {"ltp": 10, "bid": 9.9, "ask": 10.1, "oi": 1000, "volume": 10, "iv": 13}}
                for k in range(24000, 26050, 50)]
        cands = opt.compare_strikes(rows, "CE", 25000, 25000, 5 / 365, 13, 50)
        self.assertEqual([c["label"] for c in cands], ["ATM", "1 ITM", "2 ITM"])
        self.assertTrue(all(c["strike"] <= 25000 for c in cands))


class Planner(unittest.TestCase):
    def test_scenarios_and_rr_filter(self):
        named = [("PDH", 25200), ("R1", 25400), ("PDL", 24850), ("S1", 24840)]
        sc = planner.build_scenarios(25000, named, atr=250)
        self.assertEqual(sc["bull"]["entry"], 25200)
        self.assertEqual(sc["bull"]["t1"], 25400)
        self.assertTrue(sc["bull"]["rr_ok"])
        self.assertAlmostEqual(sc["bull"]["stop"], 25200 - 37.5)
        # 24,850 and 24,840 merge into one zone; nothing below it → measured 2R target
        self.assertEqual(sc["bear"]["trigger_zone"]["names"], ["S1", "PDL"])
        self.assertEqual(sc["bear"]["rr1"], 2.0)
        self.assertEqual((sc["no_trade"]["low"], sc["no_trade"]["high"]), (24845, 25200))

    def test_level_out_of_reach_is_not_a_plan(self):
        sc = planner.build_scenarios(25000, [("PDL", 24790)], atr=250)   # 210 pts > 0.8 ATR reach
        self.assertFalse(sc["bear"]["valid"])
        self.assertIn("within reach", sc["bear"]["reason"])

    def test_poor_rr_is_no_trade(self):
        # Resistances every 50 pts with a 60-pt stop: no target pays 1.5R → NO TRADE
        named = [("PDH", 25100), ("R1", 25150), ("R2", 25200)]
        sc = planner.build_scenarios(25000, named, atr=400)
        self.assertFalse(sc["bull"]["rr_ok"])
        self.assertIn("below 1:1.5", sc["bull"]["reason"])

    def test_close_level_reanchors_trigger(self):
        # 25,100 has 25,150 right above it (poor R:R) → trigger moves to 25,150, measured targets
        sc = planner.build_scenarios(25000, [("PDH", 25100), ("R1", 25150)], atr=400)
        self.assertEqual(sc["bull"]["entry"], 25150)
        self.assertTrue(sc["bull"]["rr_ok"])

    def test_evaluate_plan_retest_then_t1(self):
        sc = {"side": "bull", "entry": 100.0, "stop": 98.0, "t1": 104.0, "t2": 106.0}
        rows = ([(99, 99.5, 98.8, 99.2)] * 3 +                 # 9:15–9:30 below
                [(99.5, 101, 99.4, 100.8)] * 3 +               # 9:30–9:45 closes above → trigger
                [(100.8, 101, 100.2, 100.6)] +                 # retest within tolerance → fill
                [(100.6, 104.5, 100.5, 104.2)] +               # T1
                [(104.2, 104.4, 103.5, 103.8)])
        st = planner.evaluate_plan(sc, bars(rows))
        self.assertEqual(st["status"], "T1 hit")

    def test_evaluate_plan_stop(self):
        sc = {"side": "bull", "entry": 100.0, "stop": 98.0, "t1": 104.0, "t2": 106.0}
        rows = [(99, 99.5, 98.8, 99.2)] * 3 + [(99.5, 101, 99.4, 100.8)] * 3 + [(100.8, 101, 100.2, 100.6)] + \
               [(100.6, 100.7, 97.5, 97.8)]
        self.assertEqual(planner.evaluate_plan(sc, bars(rows))["status"], "stopped out")

    def test_conflict_means_no_best(self):
        good = {"side": "bull", "rr_ok": True, "rr1": 2.5, "sizing_ok": True, "option": {"x": 1}}
        bad = dict(good, side="bear")
        plans = {"NIFTY": {"bull": good, "bear": bad}, "BANKNIFTY": {"bull": good, "bear": bad}}
        biases = {"NIFTY": {"bias": "Bullish", "score": 3}, "BANKNIFTY": {"bias": "Bearish", "score": -3}}
        d = planner.decide(plans, biases, 14, "pre")
        self.assertTrue(d["conflict"])
        self.assertIsNone(d["best"])
        self.assertEqual(d["action"], "NO TRADE")

    def test_never_trade_against_bias_and_premarket_confidence_capped(self):
        good = {"side": "bull", "rr_ok": True, "rr1": 3, "sizing_ok": True, "option": {"x": 1}}
        bear = dict(good, side="bear")
        d = planner.decide({"NIFTY": {"bull": good, "bear": bear}}, {"NIFTY": {"bias": "Bullish", "score": 4}}, 13, "pre")
        self.assertEqual(d["best"][2], "bull")
        self.assertIn(d["confidence"], ("Low", "Medium"))   # never High before the open
        self.assertTrue(d["action"].startswith("WAIT"))

    def test_account_risk_hard_cap(self):
        os.environ["RISK_PCT"] = "3"
        try:
            self.assertEqual(planner.account()["risk_pct"], 1.0)
        finally:
            del os.environ["RISK_PCT"]


class Calendar(unittest.TestCase):
    def test_december_2026(self):
        hol = [date(2026, 12, 25)]
        nexp = [date(2026, 12, d) for d in (1, 8, 15, 22, 29)]
        ev = calendar_events.month_calendar(2026, 12, hol, nexp, [date(2026, 12, 29)], [])
        by = {(e["date"], e["type"]) for e in ev}
        self.assertIn((date(2026, 12, 4), "rbi"), by)
        self.assertIn((date(2026, 12, 10), "fomc"), by)
        self.assertIn((date(2026, 12, 29), "expiry_monthly"), by)
        self.assertEqual(sum(1 for e in ev if e["type"] == "expiry_weekly"), 4)
        self.assertIn((date(2026, 12, 14), "in_cpi"), by)       # 12 Dec is a Saturday → Monday, est.
        self.assertEqual(sum(1 for e in ev if e["type"] == "us_cpi"), 1)   # fixed date wins over the rule
        rbi = next(e for e in ev if e["type"] == "rbi")
        self.assertEqual(rbi["impact"], "HIGH")
        self.assertFalse(rbi["est"])

    def test_expiry_fallback_moves_off_holiday(self):
        ev = calendar_events.month_calendar(2026, 11, [date(2026, 11, 24)], [], [], [], fixed=[])
        mon = [e for e in ev if e["type"] == "expiry_monthly"]
        self.assertEqual(mon[0]["date"], date(2026, 11, 23))   # Tuesday holiday → Monday
        self.assertTrue(mon[0]["est"])

    def test_first_trading_day(self):
        hol = set()
        self.assertTrue(calendar_events.is_first_trading_day(date(2026, 12, 1), hol))
        self.assertFalse(calendar_events.is_first_trading_day(date(2026, 12, 2), hol))
        self.assertTrue(calendar_events.is_first_trading_day(date(2026, 11, 2), hol))  # 1 Nov is a Sunday


class Schedule(unittest.TestCase):
    def test_slots(self):
        import chain
        n = lambda h, m, d=25: IST.localize(datetime(2026, 11, d, h, m))  # noqa: E731
        self.assertEqual(chain.next_slot(n(7, 0))[0], "premarket")
        self.assertEqual(chain.next_slot(n(7, 0))[1].strftime("%H:%M"), "08:45")
        self.assertEqual(chain.next_slot(n(9, 0))[0], "midday")
        self.assertEqual(chain.next_slot(n(9, 0))[1].strftime("%H:%M"), "11:45")
        self.assertEqual(chain.next_slot(n(12, 0))[0], "evening")
        nxt = chain.next_slot(n(18, 30, d=27))  # Friday evening → Monday 8:45
        self.assertEqual((nxt[0], nxt[1].day, nxt[1].strftime("%H:%M")), ("premarket", 30, "08:45"))

    def test_midday_window(self):
        import bot
        t = lambda h, m: IST.localize(datetime(2026, 11, 25, h, m))  # noqa: E731
        self.assertIsNone(bot._late_run_reason("midday", t(11, 45)))
        self.assertIsNotNone(bot._late_run_reason("midday", t(14, 30)))
        self.assertIsNone(bot._late_run_reason("premarket", t(8, 45)))


class Chunks(unittest.TestCase):
    def test_pre_block_never_split(self):
        table = "<pre>" + "\n".join("x" * 40 for _ in range(30)) + "</pre>"
        msg = "\n\n".join(["a" * 1500, "b" * 1500, table, "c" * 1500])
        for c in telegram._chunks(msg):
            self.assertEqual(c.count("<pre>"), c.count("</pre>"))
            self.assertLessEqual(len(c), telegram._TELEGRAM_MAX)


if __name__ == "__main__":
    unittest.main()
