import { notFound } from "next/navigation";
import { SnapshotView } from "@/components/views/HistoryViews";
import { getStore } from "@/lib/store";

export default async function Page(props: PageProps<"/history/[id]">) {
  const { id } = await props.params;
  const snap = await (await getStore()).getSnapshot(decodeURIComponent(id));
  if (!snap) notFound();
  return <SnapshotView snap={snap} />;
}
