# trdbot — NIFTY 50 & BANK NIFTY trading reports on Telegram

Runs on GitHub Actions (no server). Sends three reports every NSE trading day,
plus a monthly event calendar. Built for a small account: confirmation-first
entries, strict risk, and **NO TRADE** whenever the setup is unclear.

| Time (IST) | Report | What's in it |
|---|---|---|
| 8:45 AM | Pre-market | GIFT Nifty, US/Asia, USD/INR, crude, DXY, US 10Y, India VIX, FII/DII, overnight news, today's events · per index: previous-day OHLC, candle, PDH/PDL breakout status, daily structure, 20/50 EMA, RSI (support only), previous VWAP + how price treated it, value area (VAH/POC/VAL), pivots + CPR, swing levels, trendlines, option OI walls / PCR / max pain, expected open · **Scenario A (bullish), B (bearish), C (no-trade)** with exact confirmation, entry, stop, T1/T2, exit rule, R:R, ATM vs ITM option comparison (premium, delta, IV, theta, OI, ΔOI, volume, spread), position size · final trade-plan table · BEST / SECONDARY / NO-TRADE ZONE · TRADE DECISION |
| 11:45 AM | Midday | Open, first 15/30-min range, VWAP and price vs VWAP, futures VWAP/OI, relative volume, day high/low, 5/15-min structure, breakouts and false breakouts, OI, VIX, sectors · what the 8:45 plan actually did · bullish / bearish / range scenarios after 12 · HOLD / BOOK PROFIT / TRAIL / EXIT / WAIT / ENTER (never chase an extended move) · TRADE DECISION |
| 6:00 PM | Daily wrap | Index + sector performance, VIX, FII/DII, volume, global cues · where buyers and sellers entered, VWAP respected or rejected, false breakouts, levels created today, candle, structure, gap behaviour · tomorrow's bullish/bearish levels, supports/resistances, reference levels, no-trade band and plans · one trading lesson · upcoming results/expiries/holidays · TRADE DECISION for tomorrow |
| 1st trading day of the month | Event calendar | RBI MPC, Budget, CPI/WPI/IIP/GDP/PMI, US CPI/PPI/NFP, FOMC, F&O expiries, holidays, heavyweight results — each marked HIGH / MEDIUM / LOW with why it matters and the trading caution |

## How the numbers are made

All levels, triggers, stops, targets, strikes and sizes come from fixed rules in
`modules/planner.py` — the AI (Gemini) only explains them in plain English and is
optional. The rules:

* **Entry = confirmation, never prediction**: a 15-min candle must *close* beyond
  the level, then price must retest it and hold (intraday trends: a pullback to
  VWAP that holds). Never the breakout candle itself.
* **Stop** just beyond the level that should hold (ATR-based buffer).
* **Targets** are the next real levels (prior-day H/L/C, VWAP, value area, pivots,
  swings, trendlines, OI walls); no level beyond → measured 2R / 3R.
* **R:R below 1:1.5 → NO TRADE.** Levels too far away (> 0.8 ATR) are not plans.
* **Options**: ATM or 1-ITM only (1-ITM when its delta at the trigger is 0.55–0.72
  and it's liquid), never far-OTM; rolls off expiry day; wide spreads rejected.
* **Size**: a stop-out may lose at most `RISK_PCT` of `TRADING_CAPITAL` (hard cap
  1%). If even one lot breaks that, the answer is NO TRADE — and the report tells
  you the capital one lot would need.
* **Bias** is a confluence score (structure, EMAs, close location, GIFT gap, S&P,
  FII flows, PCR; intraday also VWAP + 15-min structure). Setups against the bias
  are dropped. If NIFTY and BANK NIFTY disagree, there is no best setup.
* Pre-market confidence is never "High" — nothing is confirmed before the open.

VWAP / value area: an index has no volume, so bars are weighted by the volume
of a tracking ETF (NIFTYBEES / BANKBEES) in the same 5-min bar; the report says
which weighting it used. The NSE futures VWAP is shown alongside when available.

## Settings (repo → Settings → Secrets and variables → Actions)

Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GEMINI_API_KEY`
(optional: `TELEGRAM_SHARE_CHAT_IDS`, `GNEWS_API_KEY`).

Variables (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `TRADING_CAPITAL` | 100000 | Your trading capital in ₹ — used for position size |
| `RISK_PCT` | 1 | Max % of capital lost if the stop is hit (capped at 1) |
| `NIFTY_LOT` / `BANKNIFTY_LOT` | 65 / 30 | Lot sizes — update when NSE revises them |
| `COSTS_PER_LOT` | 100 | Brokerage + charges + slippage per lot, round trip (₹) |
| `GEMINI_MODEL` | gemini-2.5-flash | Model for the plain-English notes |

Curated macro dates live in `data/macro_calendar.json` (each with its source);
add next year's RBI MPC and FOMC schedules there when they are published.

## Scheduling

GitHub's cron fired hours late, so reports use a self-booking timer chain
(`chain.py`, `timer.yml`, `watchdog.yml`) that lands each report on the minute.
Manual run: Actions → *Market Intelligence Bot* → Run workflow → pick the report;
choose **audience: owner** to send a test only to yourself.

## Tests

```
python -m unittest discover -s tests
```

Offline: synthetic bars and option chains, every network call mocked.

*Educational analysis, not financial advice.*
