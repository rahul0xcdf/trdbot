# trdbot · web

The visual side of the market bot. The Python engine keeps doing all the
analysis and keeps sending Telegram messages exactly as before. After each
report, it also POSTs the structured data that report was built from. This
Next.js app stores that data and shows it.

```
NSE / Yahoo / RSS ──► engine (bot.py, reports.py, ai_engine.py)  ── unchanged
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

| Session | When (IST) | Source in the engine | What's in it |
|---|---|---|---|
| `evening` | 6:00 PM | `reports.build_evening` | Close, FII/DII, sectors + building/fading, movers, Nifty chain, results/ex-dates/expiry/holidays, news, AI "Outlook" bullets |
| `premarket` | 8:15 AM | `reports.build_premarket` | GIFT Nifty + opening hint, previous session, Nifty & Bank Nifty chains (with per-strike rows), PCR reads, FII/DII, sectors, today's events, AI "Today's read" |
| `afternoon` | 2:00 PM | `reports.build_afternoon` | Market so far, sectors, movers, news, AI "What's driving it" |
| `ai_premarket` | when `/premarket` runs | `premarket.generate` | Bias, GO/CAUTION, confidence, bull/range/bear %, Nifty & Bank Nifty levels, call/put setups (entry, SL, T1, T2, strike, expiry, scores), alerts, risks, plan, screener indicators |

> The scheduled pre-market report runs at **8:15 AM**, not 8:45. That's
> `chain.py`'s `SLOTS`, and the site reads the actual time from each snapshot.

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
4. **Backfill** the history the engine already has (the last AI report and
   every PCR / VIX / max pain / FII-DII row in `signals.db`):
   ```bash
   WEB_INGEST_URL=https://<app>.vercel.app/api/ingest WEB_INGEST_TOKEN=... python tools/backfill_web.py
   ```
5. Check `https://<app>.vercel.app/api/health`. It runs a live query against
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

* Break-above / break-below **scenario triggers** and a **no-trade zone**. The
  AI report gives bull/range/bear probabilities and levels only.
* **Macro calendar** (RBI, Fed, CPI, GDP, PMI, jobs).
* News **category, sentiment, impact, related instruments**.
* FII/DII **futures and options** split (cash only today).
* Breadth: **new highs/lows** and **% above 20/50/200 EMA**.
* **Sector constituents** for drill-down.
* **Index technical indicators** (RSI, MACD, VWAP, EMAs for Nifty). The screener
  computes these for shortlisted stocks only, and they're shown on those setups.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · TradingView
lightweight-charts · zustand (watchlist + live state) · cmdk + vaul (search,
bottom sheets) · node-postgres on Neon (`@neon/env`, `@vercel/functions`) · zod. Design tokens come from stash.aruo.dev
(Archivo, `#070707` ground, amber accent).
