# 📊 Market Intelligence Bot

Telegram bot that runs on **GitHub Actions** (free), uses **OpenRouter** for AI analysis, and sends daily market insights + options signals.

---

## Architecture

```
GitHub Actions (cron)
    → bot.py
        → yfinance      (price data)
        → GNews API     (headlines)
        → OpenRouter    (AI analysis — Gemini / Claude / GPT-4)
        → Telegram Bot  (sends digest to your phone)
```

---

## Setup — 5 Steps

### Step 1 — Create your Telegram Bot

1. Open Telegram → search **@BotFather**
2. Send `/newbot` → follow prompts → copy your **Bot Token**
3. Start a chat with your new bot
4. Get your **Chat ID**: visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`  
   after sending a message to the bot — look for `"chat":{"id":XXXXXXX}`

### Step 2 — Get your OpenRouter API key

1. Sign up at [openrouter.ai](https://openrouter.ai)
2. Go to **Keys** → create a new key
3. Add credits (Gemini Flash is ~$0.00015/1K tokens — nearly free)

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
| `OPENROUTER_API_KEY` | Your OpenRouter key |
| `TELEGRAM_BOT_TOKEN` | Your bot token from BotFather |
| `TELEGRAM_CHAT_ID` | Your chat ID (number) |
| `GNEWS_API_KEY` | *(optional)* from gnews.io |

### Step 5 — Set Variables (optional, for live strategy switching)

Go to **Settings → Secrets and variables → Actions → Variables tab**

| Variable | Default | Options |
|---|---|---|
| `ACTIVE_STRATEGY` | `balanced` | `balanced`, `momentum`, `conservative`, `sentiment_first` |
| `OPENROUTER_MODEL` | `google/gemini-flash-1.5` | Any OpenRouter model string |

---

## Schedule

The bot runs **3 times per trading day** (Mon–Fri):

| Time (IST) | Time (UTC) | Run type |
|---|---|---|
| 8:30 AM | 3:00 AM | Pre-market India digest |
| 7:00 PM | 1:30 PM | Pre-market US digest |
| 6:00 PM | 12:30 PM | End-of-day summary |

To change schedule, edit `.github/workflows/market-bot.yml` → `cron` lines.

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
| `balanced` | 2% | Most traders, equal signal weight |
| `momentum` | 3% | Strong trend environments |
| `conservative` | 1% | Low volatility, high conviction only |
| `sentiment_first` | 2.5% | News/tweet-driven moves |

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

## Recommended OpenRouter Models

| Model | Speed | Cost | Best for |
|---|---|---|---|
| `google/gemini-flash-1.5` | Fast | ~Free | Daily use (default) |
| `google/gemini-pro-1.5` | Medium | Low | Better reasoning |
| `anthropic/claude-3-haiku` | Fast | Low | Concise signals |
| `anthropic/claude-sonnet-4-6` | Slower | Medium | Deep analysis |
| `openai/gpt-4o-mini` | Fast | Low | Alternative |

Change model any time via the `OPENROUTER_MODEL` variable — no code changes needed.

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
