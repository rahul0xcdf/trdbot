import { getStore } from "@/lib/store";
import type { Session } from "@/lib/types";

export const dynamic = "force-dynamic";

const SESSIONS = new Set(["premarket", "afternoon", "evening", "ai_premarket"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/snapshots?session=&from=YYYY-MM-DD&to=YYYY-MM-DD&limit= */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const session = q.get("session");
  const from = q.get("from");
  const to = q.get("to");
  const limit = Math.min(500, Math.max(1, Number(q.get("limit") ?? 200) || 200));
  const store = await getStore();
  const items = await store.listMeta({
    session: session && SESSIONS.has(session) ? (session as Session) : undefined,
    from: from && DAY.test(from) ? from : undefined,
    to: to && DAY.test(to) ? to : undefined,
    limit,
  });
  return Response.json({ items });
}
