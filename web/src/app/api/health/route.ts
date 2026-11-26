import { getStore, isDemo } from "@/lib/store";
import { PostgresStore } from "@/lib/store/postgres";

export const dynamic = "force-dynamic";

/** GET /api/health — storage, config and (on Postgres) a live round trip to Neon. */
export async function GET() {
  const store = await getStore();
  try {
    const db = store instanceof PostgresStore ? await store.ping() : null;
    const version = await store.version();
    return Response.json({
      ok: true,
      storage: store.kind,
      note: store.note,
      demo: isDemo(),
      version,
      ingest_token_set: !!process.env.INGEST_TOKEN,
      db,
    });
  } catch (e) {
    return Response.json({ ok: false, storage: store.kind, error: (e as Error).message }, { status: 500 });
  }
}
