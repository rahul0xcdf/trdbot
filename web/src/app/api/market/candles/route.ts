import { isYahooSymbolSafe, resolveInstrument } from "@/lib/instruments";
import { getCandles } from "@/lib/market";

export const dynamic = "force-dynamic";

const TF: Record<string, [string, string]> = {
  "1D": ["1d", "5m"],
  "5D": ["5d", "15m"],
  "1M": ["1mo", "1h"],
  "6M": ["6mo", "1d"],
  "1Y": ["1y", "1d"],
};

/** GET /api/market/candles?key=NIFTY&tf=1D  (raw OHLCV, Yahoo Finance) */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const inst = resolveInstrument(q.get("key") ?? "NIFTY");
  if (!isYahooSymbolSafe(inst.yahoo)) return Response.json({ error: "bad symbol" }, { status: 400 });
  const [range, interval] = TF[q.get("tf") ?? "1D"] ?? TF["1D"];
  return Response.json(await getCandles(inst, range, interval));
}
