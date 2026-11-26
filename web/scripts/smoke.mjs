#!/usr/bin/env node
/**
 * End-to-end check against the running app and its database:
 *   ingest (HTTP) → stored in Postgres → read back (HTTP + SQL) → cleaned up.
 *
 *   node scripts/smoke.mjs http://localhost:3999 <INGEST_TOKEN>
 *
 * Uses a snapshot dated 3 Jan 2000 and deletes it at the end, so nothing is
 * left in the production branch. Prints no secrets.
 */
import pg from "pg";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* absent */
  }
}

const [base, token] = process.argv.slice(2);
if (!base || !token) {
  console.error("usage: node scripts/smoke.mjs <base-url> <ingest-token>");
  process.exit(2);
}

let failed = 0;
const ok = (cond, label, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!cond) failed++;
  return cond;
};
const get = async (p) => {
  const r = await fetch(base + p, { cache: "no-store" });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const snapshot = {
  schema_version: 1,
  session: "premarket",
  generated_at: "2000-01-03T08:15:00+05:30",
  trade_date: "1999-12-31",
  market_status: "smoke test",
  source: { engine: "smoke-test" },
  data: { indices: { "NIFTY 50": { last: 12345.67, change_pct: 0.42 } }, labels: { opening_hint: "smoke test" } },
  analysis: null,
  telegram_html: null,
};
const id = "20000103-081500-premarket";

// 0. Health + migrations
const h0 = await get("/api/health");
ok(h0.status === 200 && h0.body?.ok, "GET /api/health", `storage=${h0.body?.storage}, migrations=${JSON.stringify(h0.body?.db?.migrations)}, snapshots=${h0.body?.db?.snapshots}`);
ok(h0.body?.storage === "postgres", "app is using Postgres (DATABASE_URL)");

// 1. Auth is enforced
const bad = await fetch(base + "/api/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(snapshot) });
ok(bad.status === 401, "POST /api/ingest without token is rejected", `HTTP ${bad.status}`);

// 2. Ingest
const r = await fetch(base + "/api/ingest", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(snapshot),
});
const rj = await r.json().catch(() => ({}));
ok(r.ok && rj.id === id, "POST /api/ingest stores the snapshot", `HTTP ${r.status} ${JSON.stringify(rj)}`);

// 3. Read back through the API
const one = await get(`/api/snapshots/${id}`);
ok(one.status === 200 && one.body?.data?.indices?.["NIFTY 50"]?.last === 12345.67, "GET /api/snapshots/:id returns it", `NIFTY ${one.body?.data?.indices?.["NIFTY 50"]?.last}`);
const list = await get("/api/snapshots?from=2000-01-01&to=2000-01-31");
ok(list.body?.items?.some((m) => m.id === id), "GET /api/snapshots (date filter) lists it", `${list.body?.items?.length ?? 0} item(s)`);

// 4. Confirm the row is really in the database, over the app's pooled URL
const url = process.env.DATABASE_URL;
if (!ok(!!url, "DATABASE_URL present in .env.local")) process.exit(1);
const host = new URL(url).hostname;
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const { rows } = await pool.query(
    "select id, session, payload->'data'->'indices'->'NIFTY 50'->>'last' as nifty, received_at from snapshots where id = $1",
    [id],
  );
  ok(rows.length === 1 && rows[0].nifty === "12345.67", "row exists in Postgres", `host=${host}${host.includes("-pooler") ? " (pooled)" : ""}, received_at=${rows[0]?.received_at?.toISOString?.()}`);
  const v = await pool.query("select version()");
  console.log(`      ${v.rows[0].version.split(",")[0]}`);
} finally {
  // 5. Clean up
  await pool.query("delete from snapshots where id = $1", [id]).catch(() => {});
  await pool.end();
}
const gone = await get(`/api/snapshots/${id}`);
ok(gone.status === 404, "cleanup: test snapshot deleted", `HTTP ${gone.status}`);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll end-to-end checks passed");
process.exit(failed ? 1 : 0);
