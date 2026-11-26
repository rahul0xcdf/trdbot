import "server-only";
import os from "os";
import path from "path";
import { demoMetrics, demoSnapshots } from "@/demo";
import type { MetricRow, Snapshot, TerminalState } from "../types";
import { FileStore } from "./file";
import { MemoryStore } from "./memory";
import { PostgresStore } from "./postgres";
import { databaseConfigured } from "../db";
import type { Store } from "./types";

export type { Store } from "./types";

export function isDemo(): boolean {
  return process.env.DEMO_MODE === "1" || process.env.DEMO_MODE === "true";
}

class DemoStore extends MemoryStore {
  kind = "demo" as const;
  note = "DEMO_MODE=1 — sample snapshots and synthetic prices";
  private seededFor = "";
  seed() {
    const key = new Date().toISOString().slice(0, 13); // re-seed hourly so times stay current
    if (key === this.seededFor) return;
    this.seededFor = key;
    demoSnapshots().forEach((s) => this.snaps.set(s.id, s));
    demoMetrics().forEach((m: MetricRow) => this.metrics.set(m.ts, m));
  }
}

const g = globalThis as unknown as { __mtStore?: Store };

export async function getStore(): Promise<Store> {
  if (isDemo()) {
    const s = (g.__mtStore instanceof DemoStore ? g.__mtStore : (g.__mtStore = new DemoStore())) as DemoStore;
    s.seed();
    return s;
  }
  if (g.__mtStore) return g.__mtStore;
  if (databaseConfigured()) {
    g.__mtStore = new PostgresStore();
  } else {
    const onVercel = !!process.env.VERCEL;
    const dir = onVercel ? path.join(os.tmpdir(), "market-terminal") : path.join(process.cwd(), ".data");
    const fs = new FileStore(dir, onVercel);
    await fs.load();
    g.__mtStore = fs;
  }
  return g.__mtStore;
}

/** Everything the terminal needs for its first paint and each poll. */
export async function getTerminalState(): Promise<TerminalState> {
  const store = await getStore();
  try {
    const [latest, timeline, metrics, version] = await Promise.all([
      store.latestBySession(),
      store.listMeta({ limit: 24 }),
      store.listMetrics(90),
      store.version(),
    ]);
    return {
      server_time: new Date().toISOString(),
      version,
      demo: isDemo(),
      storage: { kind: store.kind, ok: true, note: store.note },
      latest,
      timeline,
      metrics: mergeMetrics(metrics, Object.values(latest).filter(Boolean) as Snapshot[]),
    };
  } catch (e) {
    console.error("[store] read failed", e);
    return {
      server_time: new Date().toISOString(),
      version: "error",
      demo: isDemo(),
      storage: { kind: store.kind, ok: false, note: (e as Error).message },
      latest: {},
      timeline: [],
      metrics: [],
    };
  }
}

/**
 * The PCR/VIX/max-pain/FII series = rows backfilled from signals.db plus the
 * same numbers read straight off each evening snapshot (what bot.py logs).
 */
function mergeMetrics(rows: MetricRow[], snaps: Snapshot[]): MetricRow[] {
  const byDay = new Map<string, MetricRow>();
  rows.forEach((r) => byDay.set(r.ts.slice(0, 10), r));
  snaps
    .filter((s) => s.session === "evening" && s.data.option_chains?.NIFTY)
    .forEach((s) => {
      const c = s.data.option_chains!.NIFTY!;
      const day = new Date(s.generated_at).toISOString().slice(0, 10);
      if (byDay.has(day)) return;
      byDay.set(day, {
        ts: new Date(s.generated_at).toISOString(),
        pcr: c.pcr,
        vix: s.data.indices?.["INDIA VIX"]?.last ?? null,
        max_pain: c.max_pain,
        fii_net: s.data.fii_dii?.fii_net_buy_sell ?? null,
        dii_net: s.data.fii_dii?.dii_net_buy_sell ?? null,
        source: "snapshot",
      });
    });
  return [...byDay.values()].sort((a, b) => +new Date(a.ts) - +new Date(b.ts));
}
