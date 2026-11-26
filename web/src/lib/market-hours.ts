/**
 * NSE session clock (IST). This only says whether the exchange is open —
 * it is not analysis. Holidays come from the engine's snapshot when present.
 */
import { isoDateIST, parseNseDate } from "./format";
import type { Holiday } from "./types";

export type Phase = "pre-open" | "open" | "closed" | "weekend" | "holiday";

export interface MarketClock {
  phase: Phase;
  label: string;
  detail: string;
  minutesToNext: number | null;
  istDate: string;
}

function istParts(d: Date) {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return { dow: ist.getUTCDay(), mins: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
}

const OPEN = 9 * 60 + 15;
const CLOSE = 15 * 60 + 30;
const PRE = 9 * 60;

export function marketClock(now: Date = new Date(), holidays: Holiday[] = []): MarketClock {
  const istDate = isoDateIST(now);
  const { dow, mins } = istParts(now);
  const holiday = holidays.find((h) => {
    const d = parseNseDate(h.date);
    return d && isoDateIST(d) === istDate;
  });
  if (dow === 0 || dow === 6)
    return { phase: "weekend", label: "Closed", detail: "Weekend", minutesToNext: null, istDate };
  if (holiday)
    return { phase: "holiday", label: "Closed", detail: holiday.name, minutesToNext: null, istDate };
  if (mins >= OPEN && mins < CLOSE)
    return { phase: "open", label: "Market open", detail: `Closes 3:30 PM`, minutesToNext: CLOSE - mins, istDate };
  if (mins >= PRE && mins < OPEN)
    return { phase: "pre-open", label: "Pre-open", detail: "Opens 9:15 AM", minutesToNext: OPEN - mins, istDate };
  if (mins < PRE)
    return { phase: "closed", label: "Closed", detail: "Opens 9:15 AM", minutesToNext: OPEN - mins, istDate };
  return { phase: "closed", label: "Closed", detail: "Closed at 3:30 PM", minutesToNext: null, istDate };
}

/** Polling interval for live prices: fast while trading, slow otherwise. */
export function livePollMs(phase: Phase): number {
  return phase === "open" ? 30_000 : phase === "pre-open" ? 60_000 : 5 * 60_000;
}
