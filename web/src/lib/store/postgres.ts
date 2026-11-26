import type { Pool } from "pg";
import { getPool } from "../db";
import { toMeta } from "../derive";
import type { MetricRow, Session, Snapshot, SnapshotMeta } from "../types";
import type { ListFilter, Store } from "./types";

/**
 * Snapshots and metrics in Lakebase Postgres on Neon (node-postgres, pooled
 * DATABASE_URL). The schema lives in db/migrations and is applied with
 * `npm run db:migrate` — this class never runs DDL on the request path.
 */
export class PostgresStore implements Store {
  kind = "postgres" as const;
  note = "Lakebase Postgres on Neon";
  private get pool(): Pool {
    return getPool();
  }

  private async q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    try {
      return (await this.pool.query(sql, params)).rows as T[];
    } catch (e) {
      const err = e as { code?: string; message: string };
      if (err.code === "42P01") throw new Error("Database tables are missing — run `npm run db:migrate`.");
      throw e;
    }
  }

  async putSnapshot(s: Snapshot) {
    const meta = toMeta(s);
    await this.q(
      `insert into snapshots (id, session, generated_at, trade_date, bias, meta, payload)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       on conflict (id) do update set payload = excluded.payload, meta = excluded.meta,
         bias = excluded.bias, trade_date = excluded.trade_date, received_at = now()`,
      [s.id, s.session, s.generated_at, s.trade_date, meta.bias, JSON.stringify(meta), JSON.stringify(s)],
    );
  }

  async getSnapshot(id: string) {
    const rows = await this.q<{ payload: Snapshot }>(`select payload from snapshots where id = $1`, [id]);
    return rows[0]?.payload ?? null;
  }

  async listMeta(f: ListFilter = {}): Promise<SnapshotMeta[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.session) where.push(`session = $${params.push(f.session)}`);
    if (f.from) where.push(`(generated_at at time zone 'Asia/Kolkata')::date >= $${params.push(f.from)}::date`);
    if (f.to) where.push(`(generated_at at time zone 'Asia/Kolkata')::date <= $${params.push(f.to)}::date`);
    const rows = await this.q<{ meta: SnapshotMeta }>(
      `select meta from snapshots ${where.length ? `where ${where.join(" and ")}` : ""}
       order by generated_at desc limit $${params.push(f.limit ?? 200)}`,
      params,
    );
    return rows.map((r) => r.meta);
  }

  async latestBySession() {
    const rows = await this.q<{ payload: Snapshot }>(
      `select distinct on (session) payload from snapshots order by session, generated_at desc`,
    );
    const out: Partial<Record<Session, Snapshot>> = {};
    rows.forEach((r) => (out[r.payload.session] = r.payload));
    return out;
  }

  async recent(session: Session, n: number) {
    const rows = await this.q<{ payload: Snapshot }>(
      `select payload from snapshots where session = $1 order by generated_at desc limit $2`,
      [session, n],
    );
    return rows.map((r) => r.payload);
  }

  async putMetrics(rows: MetricRow[]) {
    if (!rows.length) return 0;
    // One statement for the whole batch (backfill sends ~40+ rows).
    await this.q(
      `insert into metrics (ts, pcr, vix, max_pain, fii_net, dii_net, source)
       select * from unnest($1::timestamptz[], $2::float8[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::text[])
       on conflict (ts) do update set pcr = excluded.pcr, vix = excluded.vix, max_pain = excluded.max_pain,
         fii_net = excluded.fii_net, dii_net = excluded.dii_net, source = excluded.source`,
      [
        rows.map((r) => r.ts),
        rows.map((r) => r.pcr),
        rows.map((r) => r.vix),
        rows.map((r) => r.max_pain),
        rows.map((r) => r.fii_net),
        rows.map((r) => r.dii_net),
        rows.map((r) => r.source ?? null),
      ],
    );
    return rows.length;
  }

  async listMetrics(limit = 120) {
    const rows = await this.q<MetricRow & { ts: Date }>(
      `select ts, pcr, vix, max_pain, fii_net, dii_net, source
         from (select * from metrics order by ts desc limit $1) t order by ts asc`,
      [limit],
    );
    return rows.map((r) => ({ ...r, ts: new Date(r.ts).toISOString() }));
  }

  async version() {
    const rows = await this.q<{ s: string; m: string; n: number }>(
      `select coalesce(max(received_at)::text, 'none') as s,
              (select coalesce(max(ts)::text, 'none') from metrics) as m,
              count(*)::int as n
         from snapshots`,
    );
    return `pg:${rows[0].s}:${rows[0].m}:${rows[0].n}`;
  }

  /** Round-trip check for /api/health. */
  async ping() {
    const rows = await this.q<{ now: Date; snapshots: number; metrics: number; migrations: string[] }>(
      `select now(),
              (select count(*)::int from snapshots) as snapshots,
              (select count(*)::int from metrics) as metrics,
              (select coalesce(array_agg(name order by name), '{}') from schema_migrations) as migrations`,
    );
    return rows[0];
  }
}
