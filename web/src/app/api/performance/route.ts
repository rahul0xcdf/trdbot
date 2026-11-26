import { getStore } from "@/lib/store";
import { evaluateReports } from "@/lib/performance";

export const dynamic = "force-dynamic";

/** GET /api/performance?n=15 — engine AI reports replayed against actual prices. */
export async function GET(req: Request) {
  const n = Math.min(40, Math.max(1, Number(new URL(req.url).searchParams.get("n") ?? 15) || 15));
  const snaps = await (await getStore()).recent("ai_premarket", n);
  const results = await evaluateReports(snaps);
  return Response.json({ results, computed_at: new Date().toISOString() });
}
