import { HistoryView } from "@/components/views/HistoryViews";
import { getStore } from "@/lib/store";

export const metadata = { title: "History" };

export default async function Page() {
  const items = await (await getStore()).listMeta({ limit: 300 }).catch(() => []);
  return <HistoryView initial={items} />;
}
