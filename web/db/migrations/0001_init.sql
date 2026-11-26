-- 0001 — snapshot + metrics storage.
-- Applied by `npm run db:migrate` over DATABASE_URL_UNPOOLED (direct
-- connection, as Neon recommends for migrations). Never edit an applied
-- migration; add 0002_*.sql instead.

create table if not exists snapshots (
  id            text primary key,              -- 20261126-081502-premarket
  session       text not null,                 -- premarket | afternoon | evening | ai_premarket
  generated_at  timestamptz not null,          -- when the engine produced it
  trade_date    date,                          -- the session the market data belongs to
  bias          text,                          -- engine's sentiment (AI report only)
  meta          jsonb not null,                -- list-view summary (src/lib/derive.ts toMeta)
  payload       jsonb not null,                -- the full engine JSON, verbatim
  received_at   timestamptz not null default now()
);
create index if not exists snapshots_time_idx on snapshots (generated_at desc);
create index if not exists snapshots_session_idx on snapshots (session, generated_at desc);

-- Daily PCR / VIX / max pain / FII-DII series (mirrors nse_snapshots in signals.db)
create table if not exists metrics (
  ts        timestamptz primary key,
  pcr       double precision,
  vix       double precision,
  max_pain  double precision,
  fii_net   double precision,
  dii_net   double precision,
  source    text
);
