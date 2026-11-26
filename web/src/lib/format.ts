/** Formatting helpers. Indian grouping (1,23,456) for numbers, IST for time. */

export const IST_TZ = "Asia/Kolkata";

export function num(x: number | null | undefined, d = 2): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return x.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function int(x: number | null | undefined): string {
  return num(x, 0);
}

export function signed(x: number | null | undefined, d = 2): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const s = num(Math.abs(x), d);
  return x > 0 ? `+${s}` : x < 0 ? `−${s}` : s;
}

export function pct(x: number | null | undefined, d = 2): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${signed(x, d)}%`;
}

/** 1.2Cr / 45.3L / 12.4K — compact Indian units, for OI and volume. */
export function compact(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const a = Math.abs(x);
  const sign = x < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
  return `${sign}${a.toFixed(0)}`;
}

/** ₹ crore figures as the engine reports FII/DII (already in crores). */
export function crore(x: number | null | undefined): string {
  if (x === null || x === undefined) return "—";
  return `${x < 0 ? "−" : "+"}₹${num(Math.abs(x), 0)} Cr`;
}

export function tone(x: number | null | undefined): "up" | "down" | "flat" {
  if (x === null || x === undefined || x === 0 || Number.isNaN(x)) return "flat";
  return x > 0 ? "up" : "down";
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-IN", { timeZone: IST_TZ, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

export function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "08:15 AM" in IST */
export function timeIST(v: string | number | Date | null | undefined, seconds = false): string {
  const d = toDate(v);
  if (!d) return "—";
  return fmt({ hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: true })
    .format(d)
    .toUpperCase();
}

/** "Thu 26 Nov" in IST */
export function dayIST(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  return fmt({ weekday: "short", day: "2-digit", month: "short" }).format(d);
}

/** "26 Nov 2026" */
export function dateIST(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  return fmt({ day: "2-digit", month: "short", year: "numeric" }).format(d);
}

/** "2026-11-26" — the IST calendar date */
export function isoDateIST(v: string | number | Date = new Date()): string {
  const d = toDate(v) ?? new Date();
  const p = fmt({ year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** NSE "26-Nov-2026" or "26-Nov-2026 08:10" → Date (IST midnight / time) */
export function parseNseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const mo = months.indexOf(m[2].toLowerCase());
  if (mo < 0) return null;
  const hh = m[4] ? Number(m[4]) : 0;
  const mm = m[5] ? Number(m[5]) : 0;
  // IST = UTC+5:30
  return new Date(Date.UTC(Number(m[3]), mo, Number(m[1]), hh - 5, mm - 30));
}

export function ago(v: string | number | Date | null | undefined, now: number = Date.now()): string {
  const d = toDate(v);
  if (!d) return "—";
  const s = Math.round((now - d.getTime()) / 1000);
  if (s < 0) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const dd = Math.round(h / 24);
  return `${dd} d ago`;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
