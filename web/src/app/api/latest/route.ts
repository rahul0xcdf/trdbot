import { getTerminalState } from "@/lib/store";

export const dynamic = "force-dynamic";

/** GET /api/latest?v=<version> — {unchanged:true} when nothing new has landed. */
export async function GET(req: Request) {
  const v = new URL(req.url).searchParams.get("v");
  const state = await getTerminalState();
  if (v && v === state.version) return Response.json({ unchanged: true, version: v, server_time: state.server_time });
  return Response.json(state, { headers: { "Cache-Control": "no-store" } });
}
