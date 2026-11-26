import { promises as fs } from "fs";
import path from "path";
import type { MetricRow, Snapshot } from "../types";
import { MemoryStore } from "./memory";

/**
 * JSON-file store for local development (no DATABASE_URL). On Vercel the
 * filesystem is read-only except /tmp, which does not survive between
 * function instances — the UI says so, and you should set DATABASE_URL.
 */
export class FileStore extends MemoryStore {
  private loaded = false;
  constructor(private dir: string, ephemeral: boolean) {
    super();
    this.kind = ephemeral ? "memory" : "file";
    this.note = ephemeral
      ? "No DATABASE_URL — snapshots are kept in /tmp and will be lost. Set DATABASE_URL."
      : `Local files in ${dir}`;
  }
  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(path.join(this.dir, "store.json"), "utf8");
      const j = JSON.parse(raw) as { snapshots: Snapshot[]; metrics: MetricRow[] };
      j.snapshots.forEach((s) => this.snaps.set(s.id, s));
      j.metrics.forEach((m) => this.metrics.set(new Date(m.ts).toISOString(), m));
    } catch {
      /* first run */
    }
  }
  protected async persist() {
    try {
      await fs.mkdir(this.dir, { recursive: true });
      const body = JSON.stringify({ snapshots: [...this.snaps.values()], metrics: [...this.metrics.values()] });
      await fs.writeFile(path.join(this.dir, "store.json"), body);
    } catch (e) {
      console.warn("[store] file persist failed", e);
    }
  }
}
