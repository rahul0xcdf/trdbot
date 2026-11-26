import "server-only";
import { parseEnv } from "@neon/env";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import neonConfig from "../../neon";

/**
 * Lakebase Postgres on Neon, reached with node-postgres — the driver the
 * Neon skill recommends for Next.js on Vercel. `attachDatabasePool` keeps a
 * Vercel Fluid instance alive just long enough to close idle connections
 * (it is a no-op locally and during builds).
 *
 * DATABASE_URL is the pooled (-pooler) URL that `neon deploy` / `neon env pull`
 * write to .env.local; app traffic should always use the pooled one.
 */

export function databaseConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

const g = globalThis as unknown as { __mtPool?: Pool };

export function getPool(): Pool {
  if (!g.__mtPool) {
    const { postgres } = parseEnv(neonConfig, ["DATABASE_URL"]);
    const pool = new Pool({
      connectionString: postgres.databaseUrl,
      max: 5,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("error", (e) => console.error("[db] idle client error", e.message));
    attachDatabasePool(pool);
    g.__mtPool = pool;
  }
  return g.__mtPool;
}
