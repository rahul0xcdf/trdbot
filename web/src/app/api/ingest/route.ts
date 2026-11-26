import { revalidatePath } from "next/cache";
import { getStore, isDemo } from "@/lib/store";
import { MetricsIn, SnapshotIn, toMetricRows, toSnapshot, tokenOk } from "@/lib/ingest";

export const dynamic = "force-dynamic";

/**
 * POST /api/ingest — called by the Python engine (modules/publish.py).
 * Auth: Authorization: Bearer <INGEST_TOKEN>.
 * Body: a snapshot payload, or {kind: "metrics", rows: [...]} from tools/backfill_web.py.
 */
export async function POST(req: Request) {
  if (!tokenOk(req.headers.get("authorization"), process.env.INGEST_TOKEN)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const store = await getStore();

  if ((body as { kind?: string })?.kind === "metrics") {
    const m = MetricsIn.safeParse(body);
    if (!m.success) return Response.json({ error: "invalid metrics", issues: m.error.issues.slice(0, 5) }, { status: 422 });
    const n = await store.putMetrics(toMetricRows(m.data));
    return Response.json({ ok: true, id: `metrics:${n}`, rows: n });
  }

  const p = SnapshotIn.safeParse(body);
  if (!p.success) return Response.json({ error: "invalid snapshot", issues: p.error.issues.slice(0, 5) }, { status: 422 });
  const snap = toSnapshot(p.data);
  if (isDemo()) snap.demo = true;
  await store.putSnapshot(snap);
  revalidatePath("/", "layout");
  return Response.json({ ok: true, id: snap.id, storage: store.kind });
}
