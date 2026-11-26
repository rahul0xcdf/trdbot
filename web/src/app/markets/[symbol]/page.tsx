import { InstrumentView } from "@/components/views/MarketsView";

export async function generateMetadata(props: PageProps<"/markets/[symbol]">) {
  const { symbol } = await props.params;
  return { title: decodeURIComponent(symbol).toUpperCase() };
}

export default async function Page(props: PageProps<"/markets/[symbol]">) {
  const { symbol } = await props.params;
  return <InstrumentView symbol={decodeURIComponent(symbol)} />;
}
