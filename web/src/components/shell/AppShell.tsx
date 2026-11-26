"use client";
import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ChevronDown, MoreHorizontal, Search } from "lucide-react";
import { useTerminalPolling } from "@/lib/client";
import { latestScheduled } from "@/lib/derive";
import { marketClock } from "@/lib/market-hours";
import type { TerminalState } from "@/lib/types";
import { Sheet } from "../Sheet";
import { Fresh, Tag } from "../ui";
import { CommandPalette } from "./CommandPalette";
import { Ctx, PaletteCtx } from "./context";
import { NAV, isActive } from "./nav";

export function AppShell({ initial, children }: { initial: TerminalState; children: ReactNode }) {
  const state = useTerminalPolling(initial);
  const [palette, setPalette] = useState(false);
  const path = usePathname();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Ctx.Provider value={state}>
      <PaletteCtx.Provider value={setPalette}>
        {state.demo ? (
          <div className="border-b border-accent-line bg-[#1a1206] px-4 py-1 text-center text-2xs font-medium tracking-[0.08em] text-accent uppercase">
            <span className="sm:hidden">Demo data · not market data</span><span className="hidden sm:inline">Demo data — sample snapshots &amp; synthetic prices, not market data</span>
          </div>
        ) : null}
        {!state.storage.ok || state.storage.kind === "memory" ? (
          <div className="border-b border-line bg-card-2 px-4 py-1.5 text-center text-xs text-ink-2">Storage: {state.storage.note ?? "unavailable"}</div>
        ) : null}
        <TopBar state={state} path={path} onSearch={() => setPalette(true)} />
        <main className="mx-auto w-full max-w-[1240px] px-4 pt-4 pb-32 sm:px-6 sm:pt-8 lg:pb-16">{children}</main>
        <TabBar path={path} />
        <CommandPalette open={palette} onOpenChange={setPalette} state={state} />
      </PaletteCtx.Provider>
    </Ctx.Provider>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="grid size-8 place-items-center rounded-[10px] bg-accent text-accent-ink">
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
          <path d="M2 11.5 5.5 8l2.5 2.5L14 4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="text-[17px] font-semibold tracking-[-0.03em]">trdbot</span>
    </Link>
  );
}

function useClock(state: TerminalState) {
  const holidays = latestScheduled(state)?.data.holidays ?? [];
  const [clock, setClock] = useState(() => marketClock(new Date(state.server_time), holidays));
  useEffect(() => {
    const tick = () => setClock(marketClock(new Date(), holidays));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holidays.length]);
  return clock;
}

function TopBar({ state, path, onSearch }: { state: TerminalState; path: string; onSearch: () => void }) {
  const clock = useClock(state);
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => setMore(false), [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => moreRef.current && !moreRef.current.contains(e.target as Node) && setMore(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const primary = NAV.filter((n) => "primary" in n && n.primary);
  const rest = NAV.filter((n) => !("primary" in n && n.primary));
  const dot = clock.phase === "open" ? "bg-up live-dot" : clock.phase === "pre-open" ? "bg-accent" : "bg-faint";
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-4 px-4 sm:px-6">
        <Brand />
        <nav className="ml-2 hidden items-center gap-1 lg:flex">
          {primary.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={clsx(
                "press rounded-full px-3.5 py-1.5 text-sm transition-colors",
                isActive(n.href, path) ? "bg-card-2 text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-ink-2 hover:text-ink",
              )}
            >
              {n.label}
            </Link>
          ))}
          <div className="relative" ref={moreRef}>
            <button
              onClick={() => setMore((m) => !m)}
              className={clsx(
                "press flex items-center gap-1 rounded-full px-3.5 py-1.5 text-sm",
                rest.some((n) => isActive(n.href, path)) ? "bg-card-2 text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-ink-2 hover:text-ink",
              )}
            >
              More <ChevronDown className="size-3.5" />
            </button>
            {more ? (
              <div className="absolute top-11 left-0 w-52 rounded-2xl border border-line-strong bg-card-2 p-1.5 shadow-2xl">
                {rest.map((n) => {
                  const Icon = n.icon;
                  return (
                    <Link key={n.href} href={n.href} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink-2 hover:bg-hover hover:text-ink">
                      <Icon className="size-4 text-dim" strokeWidth={1.75} />
                      {n.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs md:flex">
            <span className={clsx("size-1.5 rounded-full", dot)} />
            <span className="text-ink">{clock.label}</span>
            <span className="text-dim">{clock.detail}</span>
          </span>
          <button
            onClick={onSearch}
            className="press flex size-9 items-center justify-center gap-2 rounded-full border border-line bg-card text-sm text-dim hover:border-line-strong hover:text-ink-2 sm:w-auto sm:px-3.5"
            aria-label="Search"
          >
            <Search className="size-4" />
            <span className="hidden xl:inline">Search</span>
            <kbd className="hidden rounded-md border border-line px-1.5 text-2xs text-faint xl:inline">⌘K</kbd>
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-1.5 text-2xs md:hidden">
        <span className={clsx("size-1.5 rounded-full", dot)} />
        <span className="text-ink-2">{clock.label}</span>
        <span className="text-dim">· {clock.detail}</span>
        <span className="ml-auto">
          <Fresh at={state.timeline[0]?.generated_at} label="Analysis" seconds={false} staleAfterMin={24 * 60} />
        </span>
      </div>
    </header>
  );
}

function TabBar({ path }: { path: string }) {
  const [more, setMore] = useState(false);
  const tabs = NAV.filter((n) => "tab" in n && n.tab);
  const rest = NAV.filter((n) => !("tab" in n && n.tab));
  useEffect(() => setMore(false), [path]);
  return (
    <>
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/85 backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5 px-1">
          {tabs.map((n) => {
            const active = isActive(n.href, path);
            const Icon = n.icon;
            return (
              <Link key={n.href} href={n.href} className="press flex flex-col items-center gap-1 pt-2 pb-1.5 text-[10.5px] font-medium">
                <Icon className={clsx("size-[22px]", active ? "text-accent" : "text-dim")} strokeWidth={active ? 2 : 1.6} />
                <span className={active ? "text-ink" : "text-dim"}>{n.label}</span>
              </Link>
            );
          })}
          <button onClick={() => setMore(true)} className="press flex flex-col items-center gap-1 pt-2 pb-1.5 text-[10.5px] font-medium">
            <MoreHorizontal className={clsx("size-[22px]", rest.some((n) => isActive(n.href, path)) ? "text-accent" : "text-dim")} strokeWidth={1.6} />
            <span className="text-dim">More</span>
          </button>
        </div>
      </nav>
      <Sheet open={more} onOpenChange={setMore} title="More">
        <div className="overflow-hidden rounded-2xl border border-line bg-card-2">
          {rest.map((n, i) => {
            const Icon = n.icon;
            return (
              <Link key={n.href} href={n.href} className={clsx("flex items-center gap-3 px-4 py-3.5 text-[15px] active:bg-hover", i && "border-t border-line")}>
                <span className="grid size-8 place-items-center rounded-[10px] bg-hover">
                  <Icon className="size-4 text-ink-2" strokeWidth={1.75} />
                </span>
                <span className={isActive(n.href, path) ? "text-accent" : "text-ink"}>{n.label}</span>
                <span className="ml-auto text-dim">›</span>
              </Link>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-2xs text-dim">
          <Tag kind="raw">market data</Tag>
          <Tag kind="engine">your engine</Tag>
          <Tag kind="view">visualisation</Tag>
        </div>
      </Sheet>
    </>
  );
}
