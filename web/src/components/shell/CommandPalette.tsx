"use client";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Drawer } from "vaul";
import { ArrowUpRight, FileText, Search, Star, Target } from "lucide-react";
import { useWatchlist } from "@/lib/client";
import { SESSION_SHORT, latestWith, opportunities } from "@/lib/derive";
import { dayIST, timeIST } from "@/lib/format";
import { ALL } from "@/lib/instruments";
import type { TerminalState } from "@/lib/types";
import { NAV } from "./nav";

const item =
  "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-2 aria-selected:bg-hover aria-selected:text-ink";
const group = "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:tracking-[0.1em] [&_[cmdk-group-heading]]:text-dim [&_[cmdk-group-heading]]:uppercase";

export function CommandPalette({ open, onOpenChange, state }: { open: boolean; onOpenChange: (o: boolean) => void; state: TerminalState }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const add = useWatchlist((s) => s.add);
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const setups = useMemo(() => opportunities(state.latest.ai_premarket), [state]);
  const news = useMemo(() => latestWith(state, (s) => s.data.news)?.value ?? [], [state]);
  const go = (href: string) => {
    onOpenChange(false);
    if (href.startsWith("http")) window.open(href, "_blank", "noopener");
    else router.push(href);
  };
  const sym = q.trim().toUpperCase().replace(/[^A-Z0-9&_-]/g, "");
  // Offer "open <SYMBOL>" only when nothing we already know matches the query.
  const known = sym.length >= 2 && (ALL.some((i) => `${i.key} ${i.name}`.toUpperCase().includes(sym)) || setups.some((o) => o.symbol.includes(sym)));

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction="top">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <Drawer.Content className="fixed inset-x-0 top-0 z-50 mx-auto mt-0 max-w-xl px-3 pt-3 outline-none sm:pt-20">
          <Drawer.Title className="sr-only">Search</Drawer.Title>
          <Drawer.Description className="sr-only">Search instruments, setups, snapshots and news</Drawer.Description>
          <Command className="overflow-hidden rounded-3xl border border-line-strong bg-card-2 shadow-2xl" loop>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-dim" />
              <Command.Input
                autoFocus
                value={q}
                onValueChange={setQ}
                placeholder="Search a symbol, setup, snapshot or headline…"
                className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
              />
              <kbd className="rounded-md border border-line px-1.5 text-2xs text-faint">esc</kbd>
            </div>
            <Command.List className="max-h-[60dvh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-sm text-dim">Nothing found.</Command.Empty>
              {sym.length >= 2 && !known ? (
                <Command.Group heading="Stock" className={group}>
                  <Command.Item value={`open ${sym}`} onSelect={() => go(`/markets/${sym}`)} className={item}>
                    <ArrowUpRight className="size-4 text-dim" />
                    Open <span className="font-medium text-ink">{sym}</span> (NSE)
                  </Command.Item>
                  <Command.Item value={`watch ${sym}`} onSelect={() => (add(sym), go("/watchlist"))} className={item}>
                    <Star className="size-4 text-dim" />
                    Add {sym} to watchlist
                  </Command.Item>
                </Command.Group>
              ) : null}
              {setups.length ? (
                <Command.Group heading="Today's setups (engine)" className={group}>
                  {setups.map((o) => (
                    <Command.Item key={o.symbol + o.side} value={`setup ${o.symbol} ${o.side} ${o.suggested_strike}`} onSelect={() => go(`/setups#${o.symbol}`)} className={item}>
                      <Target className="size-4 text-accent" />
                      <span className="font-medium text-ink">{o.symbol}</span>
                      <span className={o.side === "CALL" ? "text-up" : "text-down"}>{o.side}</span>
                      <span className="ml-auto text-xs text-dim">{o.suggested_strike}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              <Command.Group heading="Markets" className={group}>
                {ALL.map((i) => (
                  <Command.Item key={i.key} value={`${i.name} ${i.key} ${i.yahoo}`} onSelect={() => go(`/markets/${i.key}`)} className={item}>
                    <span className="grid size-7 place-items-center rounded-lg bg-hover text-2xs font-semibold text-ink-2">{i.name.slice(0, 2)}</span>
                    <span className="text-ink">{i.name}</span>
                    <span className="ml-auto text-xs text-dim capitalize">{i.group}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Pages" className={group}>
                {NAV.map((n) => {
                  const Icon = n.icon;
                  return (
                    <Command.Item key={n.href} value={`page ${n.label}`} onSelect={() => go(n.href)} className={item}>
                      <Icon className="size-4 text-dim" strokeWidth={1.75} />
                      {n.label}
                    </Command.Item>
                  );
                })}
              </Command.Group>
              {state.timeline.length ? (
                <Command.Group heading="Analysis snapshots" className={group}>
                  {state.timeline.slice(0, 12).map((m) => (
                    <Command.Item key={m.id} value={`snapshot ${SESSION_SHORT[m.session]} ${dayIST(m.generated_at)} ${m.bias ?? ""}`} onSelect={() => go(`/history/${m.id}`)} className={item}>
                      <FileText className="size-4 text-dim" />
                      {SESSION_SHORT[m.session]}
                      <span className="ml-auto text-xs text-dim">
                        {dayIST(m.generated_at)} · {timeIST(m.generated_at)}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {news.length ? (
                <Command.Group heading="Headlines" className={group}>
                  {news.slice(0, 15).map((n, i) => (
                    <Command.Item key={i} value={`news ${n.title} ${n.source}`} onSelect={() => go(n.link || "/news")} className={item}>
                      <span className="line-clamp-1">{n.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-dim">{n.source}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
            </Command.List>
          </Command>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
