"use client";
/**
 * Client data hooks. Polling (not websockets) because the engine publishes a
 * handful of times a day and Vercel functions are request/response.
 */
import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { livePollMs, marketClock } from "./market-hours";
import type { CandleSeries, Quote, TerminalState } from "./types";

/* ── Terminal state (engine snapshots) ───────────────────────────────────── */

interface TerminalStore {
  state: TerminalState | null;
  lastPoll: number;
  error: string | null;
  set: (s: TerminalState) => void;
  poll: () => Promise<void>;
}

export const useTerminal = create<TerminalStore>((set, get) => ({
  state: null,
  lastPoll: 0,
  error: null,
  set: (s) => set({ state: s, lastPoll: Date.now() }),
  poll: async () => {
    const cur = get().state;
    try {
      const r = await fetch(`/api/latest${cur ? `?v=${encodeURIComponent(cur.version)}` : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (j.unchanged) set({ lastPoll: Date.now(), error: null, state: cur ? { ...cur, server_time: j.server_time } : cur });
      else set({ state: j as TerminalState, lastPoll: Date.now(), error: null });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
}));

/** Poll /api/latest every 30 s (and on tab focus) while the app is open. */
export function useTerminalPolling(initial: TerminalState) {
  useEffect(() => {
    const cur = useTerminal.getState().state;
    if (!cur || cur.server_time < initial.server_time) useTerminal.setState({ state: initial, lastPoll: Date.now() });
  }, [initial]);
  useEffect(() => {
    const poll = useTerminal.getState().poll;
    const id = setInterval(poll, 30_000);
    const onVis = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  const live = useTerminal((s) => s.state);
  return live && live.server_time >= initial.server_time ? live : initial;
}

/* ── Raw market data (Yahoo) ─────────────────────────────────────────────── */

function usePolled<T>(url: string | null, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!url) return;
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as T);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    setLoading(!!url);
    load();
    if (!url) return;
    const id = setInterval(load, intervalMs);
    return () => clearInterval(id);
  }, [url, intervalMs, load]);
  return { data, loading, error, reload: load };
}

export function useQuotes(params: { group?: "india" | "global" | "all"; keys?: string[] }) {
  const phase = marketClock().phase;
  const qs = new URLSearchParams();
  if (params.group) qs.set("group", params.group);
  if (params.keys?.length) qs.set("keys", params.keys.join(","));
  const url = params.group || params.keys?.length ? `/api/market/quotes?${qs}` : null;
  const r = usePolled<{ quotes: Quote[]; fetched_at: string }>(url, livePollMs(phase));
  const map = new Map((r.data?.quotes ?? []).map((q) => [q.symbol, q]));
  return { ...r, quotes: r.data?.quotes ?? [], map, fetchedAt: r.data?.fetched_at ?? null };
}

export function useCandles(key: string | null, tf: string) {
  const phase = marketClock().phase;
  const ms = tf === "1D" || tf === "5D" ? livePollMs(phase) : 10 * 60_000;
  return usePolled<CandleSeries>(key ? `/api/market/candles?key=${encodeURIComponent(key)}&tf=${tf}` : null, ms);
}

/* ── Watchlist (per-browser, localStorage via zustand persist) ───────────── */

interface WatchlistStore {
  keys: string[];
  add: (k: string) => void;
  remove: (k: string) => void;
  move: (k: string, dir: -1 | 1) => void;
}

export const useWatchlist = create<WatchlistStore>()(
  persist(
    (set) => ({
      keys: ["NIFTY", "BANKNIFTY", "FINNIFTY", "RELIANCE", "HDFCBANK", "INFY"],
      add: (k) => set((s) => ({ keys: s.keys.includes(k) ? s.keys : [...s.keys, k] })),
      remove: (k) => set((s) => ({ keys: s.keys.filter((x) => x !== k) })),
      move: (k, dir) =>
        set((s) => {
          const i = s.keys.indexOf(k);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= s.keys.length) return s;
          const keys = [...s.keys];
          [keys[i], keys[j]] = [keys[j], keys[i]];
          return { keys };
        }),
    }),
    { name: "mt-watchlist" },
  ),
);

/* ── Clock tick for "x min ago" labels ───────────────────────────────────── */

export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
