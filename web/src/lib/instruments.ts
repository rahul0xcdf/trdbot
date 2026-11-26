/**
 * Instruments the terminal can show live (raw) prices for, and how each maps
 * to the engine's own keys. Live prices come from Yahoo Finance (~15 min
 * delayed for NSE, same source the engine itself uses for Sensex).
 */

export interface Instrument {
  key: string; // URL key, e.g. NIFTY
  name: string;
  yahoo: string; // Yahoo symbol
  group: "india" | "us" | "asia" | "commodities" | "currencies" | "stock";
  engineIndex?: string; // key in snapshot.data.indices
  engineSector?: string; // key in snapshot.data.sectors
  chain?: "NIFTY" | "BANKNIFTY"; // option chain published by the engine
  decimals?: number;
}

export const INDIA: Instrument[] = [
  { key: "NIFTY", name: "NIFTY 50", yahoo: "^NSEI", group: "india", engineIndex: "NIFTY 50", chain: "NIFTY" },
  { key: "BANKNIFTY", name: "BANK NIFTY", yahoo: "^NSEBANK", group: "india", engineIndex: "NIFTY BANK", chain: "BANKNIFTY" },
  { key: "SENSEX", name: "SENSEX", yahoo: "^BSESN", group: "india", engineIndex: "SENSEX" },
  { key: "FINNIFTY", name: "FINNIFTY", yahoo: "NIFTY_FIN_SERVICE.NS", group: "india", engineSector: "Financial Services" },
  { key: "INDIAVIX", name: "INDIA VIX", yahoo: "^INDIAVIX", group: "india", engineIndex: "INDIA VIX" },
];

export const GLOBAL: Instrument[] = [
  { key: "SPX", name: "S&P 500", yahoo: "^GSPC", group: "us" },
  { key: "NASDAQ", name: "Nasdaq", yahoo: "^IXIC", group: "us" },
  { key: "DOW", name: "Dow Jones", yahoo: "^DJI", group: "us" },
  { key: "VIX", name: "CBOE VIX", yahoo: "^VIX", group: "us" },
  { key: "NIKKEI", name: "Nikkei 225", yahoo: "^N225", group: "asia" },
  { key: "HANGSENG", name: "Hang Seng", yahoo: "^HSI", group: "asia" },
  { key: "SHANGHAI", name: "Shanghai", yahoo: "000001.SS", group: "asia" },
  { key: "KOSPI", name: "KOSPI", yahoo: "^KS11", group: "asia" },
  { key: "BRENT", name: "Brent", yahoo: "BZ=F", group: "commodities" },
  { key: "WTI", name: "WTI", yahoo: "CL=F", group: "commodities" },
  { key: "GOLD", name: "Gold", yahoo: "GC=F", group: "commodities" },
  { key: "SILVER", name: "Silver", yahoo: "SI=F", group: "commodities", decimals: 3 },
  { key: "USDINR", name: "USD/INR", yahoo: "INR=X", group: "currencies", decimals: 3 },
  { key: "DXY", name: "Dollar Index", yahoo: "DX-Y.NYB", group: "currencies", decimals: 3 },
];

export const ALL = [...INDIA, ...GLOBAL];

export const GROUP_LABEL: Record<Instrument["group"], string> = {
  india: "India",
  us: "US",
  asia: "Asia",
  commodities: "Commodities",
  currencies: "Currencies",
  stock: "Stocks",
};

/** Resolve a key ("NIFTY", "RELIANCE", "^NSEI") to an instrument. Unknown = NSE stock. */
export function resolveInstrument(raw: string): Instrument {
  const k = decodeURIComponent(raw).trim().toUpperCase();
  const hit = ALL.find((i) => i.key === k || i.yahoo.toUpperCase() === k || i.name.toUpperCase() === k);
  if (hit) return hit;
  const sym = k.replace(/\.NS$/, "");
  return { key: sym, name: sym, yahoo: `${sym}.NS`, group: "stock" };
}

export function isYahooSymbolSafe(s: string): boolean {
  return /^[A-Za-z0-9^=.\-_&]{1,32}$/.test(s);
}
