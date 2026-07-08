# 📊 Market Intelligence Bot

Telegram bot that runs on **GitHub Actions** (free), uses the **Gemini API** for AI analysis, and sends Indian intraday market digests + options signals. Also answers **slash commands** live during market hours.

---

## Architecture

```
GitHub Actions (cron, 8 slots/day)          GitHub Actions (listener, market hours)
    → bot.py  RUN_TYPE=<slot>                   → bot.py  RUN_TYPE=listen
        → NSE scraper   (OI, PCR, VIX, FII/DII)     → long-polls Telegram getUpdates
        → yfinance      (price data)                → answers /price /oi /vix /analyze …
        → RSS + GNews   (headlines)
        → Gemini API    (AI analysis)
        → Telegram Bot  (pushes digest to your phone)
```

---

## Setup — 5 Steps

### Step 1 — Create your Telegram Bot

1. Open Telegram → search **@BotFather**
2. Send `/newbot` → follow prompts → copy your **Bot Token**
3. Start a chat with your new bot
4. Get your **Chat ID**: visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`  
   after sending a message to the bot — look for `"chat":{"id":XXXXXXX}`

### Step 2 — Get your Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Create an API key (Gemini Flash has a generous free tier)

### Step 3 — Fork this repo on GitHub

```bash
# Clone, add your files, push to GitHub
git init
git add .
git commit -m "Initial market bot"
gh repo create market-bot --public --push
```

### Step 4 — Add Secrets to GitHub

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Value |
|---|---|
| `GEMINI_API_KEY` | Your Gemini API key |
| `TELEGRAM_BOT_TOKEN` | Your bot token from BotFather |
| `TELEGRAM_CHAT_ID` | Your chat ID (number) |
| `GNEWS_API_KEY` | *(optional)* from gnews.io |

### Step 5 — Set Variables (optional, for live strategy switching)

Go to **Settings → Secrets and variables → Actions → Variables tab**

| Variable | Default | Options |
|---|---|---|
| `ACTIVE_STRATEGY` | `adaptive` | `adaptive`, `nifty_intraday`, `balanced`, `momentum`, `conservative`, `sentiment_first` |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Any Gemini model id |

---

## Schedule

Push digests run **8 times per trading day** (Mon–Fri, IST):

| Time (IST) | Run type |
|---|---|
| 8:15 AM | `premarket` — gap, VIX, PCR/max pain, stocks to watch |
| 9:30 AM | `opening` — short, actionable open read |
| 11:00 AM | `midmorning` — trend check + OI |
| 12:30 PM | `european_open` — trend check + OI |
| 1:30 PM | `london_us` — trend check + OI |
| 2:45 PM | `exit_reminder` — square-off nudge |
| 4:00 PM | `eod` — FII/DII + OI setup for tomorrow |
| every 30 min | `vix_check` — silent unless VIX > 18 or moves > 10% |

The **command listener** runs in two windows (9:00 AM–12:15 PM, 12:15 PM–3:30 PM IST) via `.github/workflows/telegram-listener.yml`.

To change schedules, edit the `cron` lines in the workflow files. Note GitHub cron can fire a few minutes late.

---

## Telegram Slash Commands

While a listener window is up, the bot answers these in your chat (they also
appear in Telegram's `/` autocomplete menu):

| Command | What it does |
|---|---|
| `/premarket` | Full AI pre-market report (today's cached copy, or regenerates in 2–4 min) |
| `/watchlist` | Top call & put opportunities — only setups scoring ≥85/100 |
| `/market` | Overall market bias, GO/CAUTION/WARNING/STAY-OUT + trading plan |
| `/sectors` | Live sector strength rankings + rotation read |
| `/alerts` | Today's events, expiry proximity, macro risks |
| `/stock RELIANCE` | Deep AI analysis of one stock — technicals, chain, fundamentals (~1 min) |
| `/price RELIANCE` | Quote + momentum, volume spike, VWAP (also `/price NIFTY`) |
| `/oi` or `/oi RELIANCE` | Option-chain summary — PCR, max pain, ΔOI, IV, top strikes |
| `/vix` | India VIX + what it means for option premiums |
| `/fii` | Latest FII/DII net flows |
| `/news` | Top Indian market headlines (last 12h) |
| `/analyze` | Full AI analysis on demand (~1–2 min) |
| `/strategy` | Currently active strategy params (live, regime-resolved) |
| `/stats` | Signal win-rate stats from the local DB |
| `/help`, `/ping` | Command list / liveness check |

---

## AI Pre-Market Screener

The 8:15 AM run is a full research pipeline, not a single AI call:

1. **Quantitative screen** — ~70 liquid F&O stocks, 6 months of daily data in one
   batch: EMA 20/50/200 alignment, RSI, MACD, Supertrend, ADX, ATR, Bollinger %B,
   RVOL, market structure (HH/HL), swing support/resistance, 52-week proximity.
   Each stock gets a bull/bear pre-score; top ~8 per side advance.
2. **Deep dive (shortlist only)** — live option chain (PCR, max pain, change in
   OI, ATM IV, put/call-writing signal), delivery %, and fundamentals
   (PE, ROE, D/E, growth, institutional holding) as a confidence filter.
3. **Context** — NIFTY + BANKNIFTY chains, India VIX, FII/DII, sector indices,
   universe breadth (advance/decline), overnight headlines.
4. **AI ranking** — Gemini scores each candidate /100 (technical 40, options 20,
   volume 10, news 10, fundamentals 20, minus risk deductions) and only
   recommends **≥85/100** — with entry zone, stop loss, two targets, risk:reward,
   strike, expiry, scalping suitability and holding time. If nothing qualifies it
   says so and recommends capital preservation.

The report is committed to `data/premarket_report.json` so the command listener
serves `/premarket`, `/watchlist`, `/market` and `/alerts` instantly all day.

**Data honesty:** prices are ~15 min delayed (Yahoo), there is no IV-history for
IV rank, no promoter-holding/insider feed, and no bulk/block-deal feed — the AI
is told what it doesn't know. Nothing here is financial advice.

Only your `TELEGRAM_CHAT_ID` is answered — messages from anyone else are ignored.
Commands sent while no listener is running are answered at the start of the next
window (if less than an hour old) or dropped.

---

## Switching Strategies

**Option A — GitHub UI (permanent)**  
Settings → Variables → Change `ACTIVE_STRATEGY`

**Option B — Manual run (one-time)**  
Actions tab → Market Intelligence Bot → Run workflow → pick strategy

---

## Available Strategies

| Strategy | Risk/trade | Best for |
|---|---|---|
| `adaptive` *(default)* | 0.75–1.5% (regime-based) | Auto-tunes thresholds & size from live VIX / PCR / gap |
| `nifty_intraday` | 1.5% | Fixed weekly-options intraday config |
| `balanced` | 2% | Most traders, equal signal weight |
| `momentum` | 3% | Strong trend environments |
| `conservative` | 1% | Low volatility, high conviction only |
| `sentiment_first` | 2.5% | News/tweet-driven moves |

**How `adaptive` works:** before each run it reads the live regime and derives
the strategy instead of using fixed numbers — VIX ≥ 20 raises the signal bar to
0.80 and cuts risk to 0.75% (prefer spreads); VIX < 15 relaxes to 0.65 / 1.5%;
a PCR at an extreme (≥ 1.3 or ≤ 0.7) adds +0.05 to the required strength; a
big opening gap adds a gap-trap warning. The regime summary is injected into
the AI prompt, so the analysis itself reasons with it.

---

## Backtesting

Signals are saved to `data/signals.db` (SQLite). After 2+ weeks of running:

```bash
# Install deps locally
pip install -r requirements.txt

# Resolve open signals + run report
python backtest.py --strategy balanced --days 30 --resolve

# Compare strategies
python backtest.py --strategy momentum --days 60
```

---

## Gemini Models

| Model | Speed | Cost | Best for |
|---|---|---|---|
| `gemini-2.5-flash` | Fast | ~Free | Daily use (default) |
| `gemini-2.5-pro` | Slower | Low | Deeper reasoning |

Change model any time via the `GEMINI_MODEL` variable — no code changes needed.

---

## Groww / Broker Integration (Manual)

Groww has no public API. Workaround:
1. Export your holdings CSV from Groww
2. Upload to this repo as `data/portfolio.csv`
3. `bot.py` will skip signals that overlap your existing positions

For **auto-execution**, switch to Zerodha Kite API (₹2000/mo) — a future `broker.py` module can handle order placement.

---

## Cost Estimate

| Service | Cost |
|---|---|
| GitHub Actions | Free (2000 min/month free) |
| OpenRouter (Gemini Flash) | ~$0.001–0.005 per run |
| Telegram | Free |
| **Total/month** | **< $0.50** |

---

## Disclaimer

This bot is for informational purposes only. Nothing it outputs constitutes financial advice. Options trading involves significant risk of loss. Always do your own research.
