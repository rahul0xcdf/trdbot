/**
 * Validation for what the engine POSTs. Deliberately loose on the inner
 * data (every engine layer is best-effort and may be missing) but strict on
 * the envelope so a bad payload can't break the terminal.
 */
import { z } from "zod";
import { snapshotId } from "./derive";
import type { MetricRow, Snapshot } from "./types";

const SessionZ = z.enum(["premarket", "midday", "evening", "monthly"]);

export const SnapshotIn = z.object({
  // v1 came from the old AI engine; only the rules-based engine (v2) is accepted now.
  schema_version: z.number().int().min(2, "schema_version 2+ (rules-based engine) required"),
  session: SessionZ,
  generated_at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "generated_at must be an ISO time"),
  trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  plan_for: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  market_status: z.string().nullable().optional(),
  source: z.record(z.string(), z.any()).optional(),
  data: z.record(z.string(), z.any()),
  indices: z.partialRecord(z.enum(["NIFTY", "BANKNIFTY"]), z.record(z.string(), z.any())).optional(),
  decision: z.record(z.string(), z.any()).nullable().optional(),
  account: z.record(z.string(), z.any()).nullable().optional(),
  ai: z.record(z.string(), z.string()).nullable().optional(),
  note: z.string().nullable().optional(),
  telegram_html: z.string().max(60_000).nullable().optional(),
});

const MetricZ = z.object({
  ts: z.string().refine((s) => !Number.isNaN(Date.parse(s))),
  pcr: z.number().nullable(),
  vix: z.number().nullable(),
  max_pain: z.number().nullable(),
  fii_net: z.number().nullable(),
  dii_net: z.number().nullable(),
  source: z.string().optional(),
});

export const MetricsIn = z.object({
  kind: z.literal("metrics"),
  rows: z.array(MetricZ).max(5000),
});

export function toSnapshot(p: z.infer<typeof SnapshotIn>): Snapshot {
  return {
    id: snapshotId(p.session, p.generated_at),
    schema_version: p.schema_version,
    session: p.session,
    generated_at: p.generated_at,
    trade_date: p.trade_date ?? null,
    plan_for: p.plan_for ?? null,
    market_status: p.market_status ?? null,
    source: p.source as Snapshot["source"],
    data: p.data as Snapshot["data"],
    indices: (p.indices ?? {}) as Snapshot["indices"],
    decision: (p.decision ?? null) as Snapshot["decision"],
    account: (p.account ?? null) as Snapshot["account"],
    ai: p.ai ?? null,
    note: p.note ?? null,
    telegram_html: p.telegram_html ?? null,
    received_at: new Date().toISOString(),
  };
}

export function toMetricRows(p: z.infer<typeof MetricsIn>): MetricRow[] {
  return p.rows.map((r) => ({ ...r, ts: new Date(r.ts).toISOString() }));
}

/** Constant-time compare so the token can't be guessed byte by byte. */
export function tokenOk(header: string | null, expected: string | undefined): boolean {
  if (!expected) return false;
  const got = (header ?? "").replace(/^Bearer\s+/i, "");
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
