import type { MetricRow, Session, Snapshot, SnapshotMeta } from "../types";

export interface ListFilter {
  limit?: number;
  session?: Session;
  from?: string; // YYYY-MM-DD (IST trade/generation date)
  to?: string;
}

export interface Store {
  kind: "postgres" | "file" | "memory" | "demo";
  note?: string;
  putSnapshot(s: Snapshot): Promise<void>;
  getSnapshot(id: string): Promise<Snapshot | null>;
  listMeta(f?: ListFilter): Promise<SnapshotMeta[]>;
  latestBySession(): Promise<Partial<Record<Session, Snapshot>>>;
  /** Most recent N snapshots of one session, newest first (full payloads). */
  recent(session: Session, n: number): Promise<Snapshot[]>;
  putMetrics(rows: MetricRow[]): Promise<number>;
  listMetrics(limit?: number): Promise<MetricRow[]>;
  /** Changes whenever anything new is stored — lets clients skip unchanged polls. */
  version(): Promise<string>;
}
