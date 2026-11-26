"use client";
import { createContext, useContext } from "react";
import type { TerminalState } from "@/lib/types";

export const Ctx = createContext<TerminalState | null>(null);
export function useTerminalState(): TerminalState {
  const s = useContext(Ctx);
  if (!s) throw new Error("useTerminalState outside AppShell");
  return s;
}

export const PaletteCtx = createContext<(open: boolean) => void>(() => {});
export const useOpenPalette = () => useContext(PaletteCtx);
