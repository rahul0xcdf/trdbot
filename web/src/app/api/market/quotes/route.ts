import { ALL, GLOBAL, INDIA, resolveInstrument, isYahooSymbolSafe } from "@/lib/instruments";
import { getQuote } from "@/lib/market";

export const dynamic = "force-dynamic";

/** GET /api/market/quotes?keys=NIFTY,BANKNIFTY,RELIANCE  or  ?group=india|global|all */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const group = q.get("group");
  let list =
    group === "india" ? INDIA : group === "global" ? GLOBAL : group === "all" ? ALL : [];
  const keys = (q.get("keys") ?? "").split(",").map((k) => k.trim()).filter(Boolean).slice(0, 40);
  if (keys.length) list = [...list, ...keys.map(resolveInstrument)];
  list = list.filter((i, n, a) => isYahooSymbolSafe(i.yahoo) && a.findIndex((x) => x.key === i.key) === n);
  const quotes = await Promise.all(list.map(getQuote));
  return Response.json({ quotes, fetched_at: new Date().toISOString() });
}
