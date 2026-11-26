import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/snapshots/[id]">) {
  const { id } = await ctx.params;
  const snap = await (await getStore()).getSnapshot(id);
  if (!snap) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(snap);
}
