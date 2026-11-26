import { getStore } from "@/lib/store";
import { evaluateReports } from "@/lib/performance";

export const dynamic = "force-dynamic";

/** GET /api/performance?n=15 — the engine's 8:45 AM plans replayed against actual prices. */
export async function GET(req: Request) {
  const n = Math.min(40, Math.max(1, Number(new URL(req.url).searchParams.get("n") ?? 15) || 15));
  const store = await getStore();
  const [pre, mid] = await Promise.all([store.recent("premarket", n), store.recent("midday", n)]);
  const results = await evaluateReports(pre, mid);
  return Response.json({ results, computed_at: new Date().toISOString() });
}
