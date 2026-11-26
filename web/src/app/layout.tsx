import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";
import { getTerminalState } from "@/lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "trdbot · Markets", template: "%s · trdbot" },
  description: "Your market engine's analysis, levels and setups — visualised.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#070707",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const state = await getTerminalState();
  return (
    <html lang="en">
      <body>
        <AppShell initial={state}>{children}</AppShell>
      </body>
    </html>
  );
}
