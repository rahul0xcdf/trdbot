# trdbot · web

The visual side of the market bot. The Python engine keeps doing all the
analysis and keeps sending Telegram messages exactly as before. After each
report, it also POSTs the structured data that report was built from. This
Next.js app stores that data and shows it.

```
NSE / Yahoo / RSS ──► engine (bot.py, reports.py, planner.py)  ── unchanged
                          │
                          ├──► Telegram (same message as before)
                          │
                          └──► modules/publish.py ──POST──► /api/ingest
                                                              │
                                                         Postgres
                                                              │
                                                  /api/latest · /api/snapshots
                                                              │
                                                     this website
```

## Rules the site follows

* **It never makes its own calls.** Bias, levels, setups, labels and AI notes
  are shown exactly as the engine published them. `src/lib/derive.ts` only
  selects and labels values; it computes no signal.
* **Every number says what it is.** The tags are `Raw` (market data), `Engine`
  (your engine's analysis) and `View` (a chart or bar drawn from the data above).
  Each also shows its time. "Analysis updated" and "Data updated" are kept apart.
* **Missing means missing.** If the engine doesn't publish something (see
  *Gaps* below), the panel says so instead of inventing it.
* **Live prices are raw data only.** Candles, sparklines and global markets come
  from Yahoo Finance's public chart endpoint, the same source the engine uses
  for Sensex (NSE quotes are about 15 minutes delayed). When Yahoo is
  unreachable, the site falls back to the last price the engine captured from
  NSE and labels it that way.
* **Setup status is mechanical.** WATCH / TRIGGERED / ACTIVE / COMPLETED /
  INVALIDATED replays today's 5-minute bars against the engine's own entry
  zone, stop and targets (`src/lib/track.ts`). Performance does the same for
  past reports, and only once that session's prices exist.

## What the engine publishes

`modules/publish.py` (schema_version 2) sends the same objects the report
builders already computed — nothing is recalculated for the website.

| Session | When (IST) | Source in the engine | What's in it |
|---|---|---|---|
| `premarket` | 8:45 AM | `reports.build_premarket` | GIFT Nifty, global cues, VIX, FII/DII, overnight news, today's events; per index: previous session (OHLC, candle, VWAP, value area, pivots/CPR, swings, trendlines, EMAs, RSI), option chain, bias score, expected open, **Scenario A / B / C** (trigger, stop, T1/T2, R:R, confirmation, exit, invalidation, option + premiums + lots, ATM-vs-ITM), level zones; the **TRADE DECISION**; Gemini narration |
| `midday` | 11:45 AM | `reports.build_midday` | Intraday read (opening range, VWAP behaviour, structure, breakout/false-breakout tests, day type, futures), what happened to the 8:45 plan, re-planned scenarios, HOLD / BOOK / TRAIL / EXIT / WAIT / ENTER |
| `evening` | 6:00 PM | `reports.build_evening` | Where buyers / sellers stepped in, false breakouts, levels created, candle, lesson, movers, sector momentum, results / ex-dates / expiries / holidays, **tomorrow's** zones and plans (`plan_for` = next trading day) |
| `monthly` | first trading day, with 8:45 | `reports.build_monthly` | Volatility calendar: RBI, Fed, US & India data, expiries, results, holidays, rated HIGH / MEDIUM / LOW |

Setup status on the site (Watch → Triggered → Active → Completed / Stopped)
replays live 5-min candles through `planner.evaluate_plan`, ported line for
line to `src/lib/track.ts` and checked against the Python on 72 cases.

## Live prices on Vercel

Yahoo answers Vercel's Node runtime with HTTP 429. `api/yf.py` is a small
Python function on the same deployment that fetches Yahoo's chart JSON with
`curl_cffi` impersonating Chrome (the same thing `yfinance` does for the
bot). `src/lib/market.ts` calls it in one batched request; locally it calls
Yahoo directly. Optional for local dev: `python3 api/yf.py` and
`YF_BRIDGE_URL=http://127.0.0.1:5328/api/yf npm run dev`.

## Deploy (Neon + Vercel)

The database is Lakebase Postgres on Neon (project `calm-silence-47085807`,
branch `production`), declared in `neon.ts` and reached with `node-postgres`
plus Vercel's `attachDatabasePool`, as the Neon agent skill recommends for
Next.js on Vercel.

1. **Neon.** From `web/`, either run `bash scripts/neon-setup.sh`, which does all of
   the following plus a build and an end-to-end test against Neon and logs to
   `neon-setup.log`, or run the steps by hand:
   ```bash
   npm i -g neon@latest
   neon login                       # browser sign-in
   neon init -y --org-id org-little-pine-41842727 --project-id calm-silence-47085807 --branch production --services postgres
   neon deploy                      # applies neon.ts, writes DATABASE_URL + DATABASE_URL_UNPOOLED to .env.local
   npm run db:migrate               # applies db/migrations over the direct (unpooled) URL
   ```
2. **Vercel project.** Import the repo, set **Root Directory = `web`**, and add
   these environment variables:
   * `DATABASE_URL`: the **pooled** URL from `.env.local` (its host contains `-pooler`).
   * `INGEST_TOKEN`: a long random string, e.g. `openssl rand -hex 32`.
3. **GitHub secrets** on the bot repo (Settings → Secrets → Actions):
   * `WEB_INGEST_URL` = `https://<your-app>.vercel.app/api/ingest`
   * `WEB_INGEST_TOKEN` = the same value as `INGEST_TOKEN`
4. Check `https://<app>.vercel.app/api/health`. It runs a live query against
   Neon and reports the snapshot and metric counts and applied migrations.

Schema changes go in a new `db/migrations/000N_*.sql` file. Run
`npm run db:migrate` against a Neon branch first (`neon checkout dev --create`),
then against production.

The site has no login. Before you share the URL, add Vercel's deployment
protection or put auth in front of it.

## Local development

```bash
cd web
npm install
npm run demo          # DEMO_MODE=1: sample snapshots + synthetic prices, with a DEMO banner
# or, against real ingest:
INGEST_TOKEN=dev npm run dev
# then, from the repo root, make the engine write/POST payloads:
RUN_TYPE=premarket DRY_RUN=1 TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=x GEMINI_API_KEY=<key> python bot.py   # writes data/web/premarket.json
curl -X POST localhost:3000/api/ingest -H "authorization: Bearer dev" \
     -H "content-type: application/json" --data @data/web/premarket.json
```

Without `DATABASE_URL`, snapshots are kept in `web/.data/store.json`. With it (after `neon deploy`), run `npm run db:migrate` once.

## API

| Method | Path | |
|---|---|---|
| POST | `/api/ingest` | Engine payload, or `{kind:"metrics", rows:[…]}`. Needs `Authorization: Bearer $INGEST_TOKEN`. |
| GET | `/api/latest?v=` | Latest snapshot per session, timeline, metrics. Returns `{unchanged:true}` if `v` is still current. |
| GET | `/api/snapshots?session=&from=&to=&limit=` | Snapshot list for History. |
| GET | `/api/snapshots/:id` | One snapshot, exactly as stored. |
| GET | `/api/market/quotes?group=india\|global\|all&keys=` | Raw prices (Yahoo). |
| GET | `/api/market/candles?key=NIFTY&tf=1D\|5D\|1M\|6M\|1Y` | Raw OHLCV (Yahoo). |
| GET | `/api/performance?n=15` | AI reports replayed against actual prices. |
| GET | `/api/health` | Storage and config check. |

## Gaps: things the engine doesn't publish (yet)

The site shows these as "not published" rather than inventing them. To fill
one, add the field in `modules/publish.py`, add it to `src/lib/types.ts`, and
render it.

* News **category, sentiment, impact, related instruments**.
* FII/DII **futures and options** split (cash only today).
* Breadth: **new highs/lows** and **% above 20/50/200 EMA**.
* **Sector constituents** for drill-down.
* Plans for anything beyond **NIFTY 50 and BANK NIFTY** (other instruments show live prices only).

## Stack

Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · TradingView
lightweight-charts · zustand (watchlist + live state) · cmdk + vaul (search,
bottom sheets) · node-postgres on Neon (`@neon/env`, `@vercel/functions`) · zod. Design tokens come from stash.aruo.dev
(Archivo, `#070707` ground, amber accent).
