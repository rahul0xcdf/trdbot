#!/usr/bin/env node
/**
 * Apply db/migrations/*.sql in order, once each, over the DIRECT connection
 * (DATABASE_URL_UNPOOLED) as Neon recommends for schema changes.
 *
 *   npm run db:migrate
 *
 * Reads .env.local / .env (what `neon deploy` and `neon env pull` write).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* file absent */
  }
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL_UNPOOLED / DATABASE_URL — run `neon deploy` (or `neon env pull`) first.");
  process.exit(1);
}
if (!process.env.DATABASE_URL_UNPOOLED) console.warn("[migrate] DATABASE_URL_UNPOOLED not set — falling back to DATABASE_URL");

const dir = path.join(process.cwd(), "db", "migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(path.join(dir, f), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [f]);
      await client.query("commit");
      console.log(`[migrate] applied ${f}`);
      applied++;
    } catch (e) {
      await client.query("rollback");
      throw new Error(`${f}: ${e.message}`);
    }
  }
  console.log(`[migrate] ${applied} applied, ${files.length - applied} already up to date`);
} finally {
  await client.end();
}
