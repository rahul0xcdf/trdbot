import { isoDateIST } from "../format";
import { toMeta } from "../derive";
import type { MetricRow, Session, Snapshot, SnapshotMeta } from "../types";
import type { ListFilter, Store } from "./types";

/** In-memory store. Also the base for the file store and the demo store. */
export class MemoryStore implements Store {
  kind: Store["kind"] = "memory";
  note?: string;
  protected snaps = new Map<string, Snapshot>();
  protected metrics = new Map<string, MetricRow>();
  protected rev = 0;

  async putSnapshot(s: Snapshot) {
    this.snaps.set(s.id, s);
    this.rev++;
    await this.persist();
  }
  async getSnapshot(id: string) {
    return this.snaps.get(id) ?? null;
  }
  protected sorted(): Snapshot[] {
    return [...this.snaps.values()].sort((a, b) => +new Date(b.generated_at) - +new Date(a.generated_at));
  }
  async listMeta(f: ListFilter = {}): Promise<SnapshotMeta[]> {
    return this.sorted()
      .filter((s) => !f.session || s.session === f.session)
      .filter((s) => !f.from || isoDateIST(s.generated_at) >= f.from)
      .filter((s) => !f.to || isoDateIST(s.generated_at) <= f.to)
      .slice(0, f.limit ?? 200)
      .map(toMeta);
  }
  async latestBySession() {
    const out: Partial<Record<Session, Snapshot>> = {};
    for (const s of this.sorted()) if (!out[s.session]) out[s.session] = s;
    return out;
  }
  async recent(session: Session, n: number) {
    return this.sorted().filter((s) => s.session === session).slice(0, n);
  }
  async putMetrics(rows: MetricRow[]) {
    rows.forEach((r) => this.metrics.set(new Date(r.ts).toISOString(), r));
    this.rev++;
    await this.persist();
    return rows.length;
  }
  async listMetrics(limit = 120) {
    return [...this.metrics.values()].sort((a, b) => +new Date(a.ts) - +new Date(b.ts)).slice(-limit);
  }
  async version() {
    const newest = this.sorted()[0];
    return `${this.kind}:${this.rev}:${newest?.id ?? "none"}`;
  }
  protected async persist() {}
}
