import {
  Activity,
  BarChart3,
  CandlestickChart,
  Gauge,
  Globe2,
  History,
  Home,
  Layers,
  Newspaper,
  Star,
  Target,
} from "lucide-react";

/** `primary` items sit in the desktop top bar; `tab` items in the mobile tab bar. */
export const NAV = [
  { href: "/", label: "Today", icon: Home, primary: true, tab: true },
  { href: "/markets", label: "Markets", icon: Activity, primary: true },
  { href: "/charts", label: "Charts", icon: CandlestickChart, primary: true, tab: true },
  { href: "/options", label: "Options", icon: Layers, primary: true, tab: true },
  { href: "/setups", label: "Setups", icon: Target, primary: true },
  { href: "/news", label: "News", icon: Newspaper, primary: true, tab: true },
  { href: "/global", label: "Global", icon: Globe2 },
  { href: "/sectors", label: "Sectors", icon: BarChart3 },
  { href: "/history", label: "History", icon: History },
  { href: "/performance", label: "Performance", icon: Gauge },
  { href: "/watchlist", label: "Watchlist", icon: Star },
] as const;

export type NavItem = (typeof NAV)[number];
export const isActive = (href: string, path: string) => (href === "/" ? path === "/" : path.startsWith(href));
