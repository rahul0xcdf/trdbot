"""
The three scheduled Telegram reports (Mon–Fri, IST):

  premarket  8:15 AM — GIFT Nifty, previous session recap (Nifty / Sensex /
                       Bank Nifty), Nifty + Bank Nifty PCR, FII/DII, sector trend
  afternoon  2:00 PM — what the market has done so far today + the news
  evening    6:00 PM — day's wrap, sectors/stocks gaining vs losing strength,
                       and the dates coming up (results, ex-dates, expiry,
                       holidays) for Nifty 50 / Bank Nifty companies

Each builder returns (message_html, data). Every data source is best-effort:
a section whose source failed is left out instead of failing the report, and
the AI note (Gemini) is optional — if it fails the report still goes out.
"""

import html
from datetime import datetime, timedelta

from modules import ai_engine, market_data, news, nse_data
from modules.telegram import IST


# ── Small formatting helpers ──────────────────────────────────────────────────

def _dot(pct) -> str:
    if pct is None:
        return "⚪"
    return "🟢" if pct > 0 else "🔴" if pct < 0 else "⚪"


def _n(x, d: int = 2) -> str:
    return "—" if x is None else f"{x:,.{d}f}"


def _pct(x) -> str:
    return "—" if x is None else f"{x:+.2f}%"


def _signed(x, d: int = 2) -> str:
    return "—" if x is None else f"{x:+,.{d}f}"


def _day(date_str: str | None, fmt: str = "%a %d %b") -> str:
    d = nse_data._parse_date(date_str or "")
    return d.strftime(fmt) if d else (date_str or "—")


def _now_label() -> str:
    return datetime.now(IST).strftime("%a %d %b %Y · %I:%M %p IST")


def _index_line(label: str, d: dict | None, with_range: bool = True) -> list[str]:
    if not d or d.get("last") is None:
        return [f"⚪ <b>{label}:</b> unavailable"]
    lines = [f"{_dot(d.get('change_pct'))} <b>{label}</b>  {_n(d['last'])}  "
             f"{_signed(d.get('change'))} ({_pct(d.get('change_pct'))})"]
    if with_range and d.get("low") is not None and d.get("high") is not None:
        lines.append(f"      Range {_n(d['low'])} – {_n(d['high'])}")
    return lines


def _indices_block(board: dict, sensex: dict | None, with_range: bool = True) -> list[str]:
    lines = []
    lines += _index_line("Nifty 50", board.get("NIFTY 50"), with_range)
    lines += _index_line("Sensex", sensex, with_range)
    lines += _index_line("Bank Nifty", board.get("NIFTY BANK"), with_range)
    vix = board.get("INDIA VIX")
    if vix and vix.get("last") is not None:
        lines.append(f"🌡 <b>India VIX</b>  {_n(vix['last'])} ({_pct(vix.get('change_pct'))})")
    nifty = board.get("NIFTY 50") or {}
    if nifty.get("advances") or nifty.get("declines"):
        lines.append(f"📊 Nifty 50 breadth: {nifty['advances']} up / {nifty['declines']} down")
    return lines


def _pcr_label(p) -> str:
    if p is None:
        return "n/a"
    if p >= 1.3:
        return "very high — strong put support, but stretched"
    if p >= 1.0:
        return "bullish lean — put writers in control"
    if p >= 0.8:
        return "neutral"
    if p >= 0.6:
        return "bearish lean — call writers in control"
    return "very low — oversold, short-covering bounce possible"


def _pcr_block(nifty_chain: dict | None, bank_chain: dict | None) -> list[str]:
    if not nifty_chain and not bank_chain:
        return []
    lines = ["<b>🔗 PCR (option OI)</b>"]
    for label, c in (("Nifty", nifty_chain), ("Bank Nifty", bank_chain)):
        if not c:
            lines.append(f"  {label}: unavailable")
            continue
        lines.append(f"  {label} PCR <b>{c.get('pcr')}</b> — {_pcr_label(c.get('pcr'))}  "
                     f"<i>(exp {_day(c.get('expiry'), '%d %b')})</i>")
        sup, res = c.get("top_put_oi_strikes") or [], c.get("top_call_oi_strikes") or []
        if sup or res:
            lines.append(f"      Support {', '.join(_n(s, 0) for s in sup[:2])} · "
                         f"Resistance {', '.join(_n(s, 0) for s in res[:2])} · "
                         f"Max pain {_n(c.get('max_pain'), 0)}")
    a = (nifty_chain or {}).get("pcr")
    b = (bank_chain or {}).get("pcr")
    if a is not None and b is not None:
        if a >= 1.0 and b >= 1.0:
            mix = "both leaning bullish"
        elif a < 0.8 and b < 0.8:
            mix = "both leaning bearish"
        else:
            mix = "mixed — the two indices disagree"
        lines.append(f"  <b>Mix:</b> avg {round((a + b) / 2, 2)} → {mix}")
    return lines


def _fii_block(fii: dict | None, today_label: str | None = None) -> list[str]:
    if not fii or (fii.get("fii_net_buy_sell") is None and fii.get("dii_net_buy_sell") is None):
        return []
    f, d = fii.get("fii_net_buy_sell"), fii.get("dii_net_buy_sell")
    head = f"<b>💰 FII / DII</b>  <i>({_day(fii.get('date'))})</i>"
    if today_label and nse_data._parse_date(fii.get("date") or "") != nse_data._today_ist():
        head += f"  <i>— {today_label}</i>"
    lines = [head]
    for label, v in (("FII", f), ("DII", d)):
        if v is not None:
            lines.append(f"  {_dot(v)} {label}: {_signed(v)} Cr ({'bought' if v >= 0 else 'sold'})")
    if f is not None and d is not None:
        lines.append(f"  Net together: {_signed(f + d)} Cr")
    return lines


def _sector_line(s: dict) -> str:
    wk = f", 1W {_pct(s['week_pct'])}" if s.get("week_pct") is not None else ""
    return f"  {_dot(s.get('change_pct'))} {s['sector']} {_pct(s.get('change_pct'))}{wk}"


def _sectors_block(sectors: list[dict], title: str, n: int = 3) -> list[str]:
    if not sectors:
        return []
    ranked = sorted(sectors, key=lambda s: s.get("change_pct") or 0, reverse=True)
    lines = [f"<b>{title}</b>", "  <i>Strongest</i>"]
    lines += [_sector_line(s) for s in ranked[:n]]
    lines.append("  <i>Weakest</i>")
    lines += [_sector_line(s) for s in ranked[-n:][::-1]]
    return lines


def _movers_block(movers: dict, title: str) -> list[str]:
    g, l = movers.get("gainers") or [], movers.get("losers") or []
    if not g and not l:
        return []
    lines = [f"<b>{title}</b>"]
    if g:
        lines.append("  🟢 " + " · ".join(f"{m['symbol']} {_pct(m['change_pct'])}" for m in g))
    if l:
        lines.append("  🔴 " + " · ".join(f"{m['symbol']} {_pct(m['change_pct'])}" for m in l))
    return lines


def _ai_block(title: str, bullets: list[str] | None) -> list[str]:
    if not bullets:
        return ["<i>🤖 AI note unavailable this run (data above is live).</i>"]
    return [f"<b>{title}</b>"] + [f"  • {html.escape(b, quote=False)}" for b in bullets]


def _context(**parts) -> str:
    """Compact text dump of the gathered data for the AI prompt."""
    import json
    return "\n".join(f"{k}: {json.dumps(v, default=str)}" for k, v in parts.items() if v)


def _footer() -> list[str]:
    return ["", "<i>⚠️ Not financial advice. Do your own research.</i>"]


# ── 8:15 AM — Pre-market ──────────────────────────────────────────────────────

def build_premarket() -> tuple[str, dict]:
    gift = nse_data.get_gift_nifty()
    board = nse_data.get_index_board() or {}
    sensex = market_data.get_sensex()
    nifty_chain = nse_data.get_nifty_options_chain()
    bank_chain = nse_data.get_banknifty_options_chain()
    fii = nse_data.get_fii_dii_data()
    sectors = nse_data.get_sector_indices() or []
    today = nse_data._today_ist()
    events_today = [e for e in nse_data.get_upcoming_events(days=0).get("results", [])
                    if nse_data._parse_date(e["date"]) == today]

    lines = [f"<b>🌅 Pre-Market Brief</b>", f"<i>{_now_label()}</i>", ""]

    if gift:
        p = gift.get("change_pct")
        hint = ("positive start likely" if p is not None and p >= 0.3 else
                "negative start likely" if p is not None and p <= -0.3 else
                "flat start likely")
        lines += [f"{_dot(p)} <b>GIFT Nifty</b>  {_n(gift['last'])}  "
                  f"{_signed(gift.get('change'))} ({_pct(p)})",
                  f"      → {hint}  <i>(as of {(gift.get('as_of') or '')[-5:]})</i>"]
    else:
        lines.append("⚪ <b>GIFT Nifty:</b> unavailable")

    lines += ["", f"<b>📈 Previous session ({_day(board.get('_date'))})</b>"]
    lines += _indices_block(board, sensex)

    pcr = _pcr_block(nifty_chain, bank_chain)
    if pcr:
        lines += [""] + pcr
    fii_lines = _fii_block(fii)
    if fii_lines:
        lines += [""] + fii_lines
    sec = _sectors_block(sectors, "🏭 Sector trend (previous session)")
    if sec:
        lines += [""] + sec
    if events_today:
        lines += ["", "<b>📅 Today</b>"]
        lines += [f"  • {e['symbol']}: {html.escape(e['what'], quote=False)}" for e in events_today[:6]]

    bullets = ai_engine.brief_bullets(
        "Using the previous session and overnight GIFT Nifty, say how today is likely "
        "to open, which Nifty / Bank Nifty levels matter (from the OI support and "
        "resistance), and the main risk to watch in the first hour.",
        _context(gift_nifty=gift, previous_session=board, sensex=sensex,
                 nifty_chain=nifty_chain, banknifty_chain=bank_chain, fii_dii=fii,
                 sectors=sectors[:16], results_today=events_today))
    lines += [""] + _ai_block("🤖 Today's read", bullets) + _footer()

    data = {"nifty_chain": nifty_chain, "vix": board.get("INDIA VIX"), "fii_dii": fii}
    return "\n".join(lines), data


# ── 2:00 PM — Afternoon ───────────────────────────────────────────────────────

def build_afternoon() -> tuple[str, dict]:
    board = nse_data.get_index_board() or {}
    sensex = market_data.get_sensex()
    sectors = nse_data.get_sector_indices() or []
    movers = nse_data.get_top_movers("NIFTY")
    headlines = news.fetch_indian_news(lookback_hours=7)

    lines = [f"<b>🕑 Afternoon Update</b>", f"<i>{_now_label()}</i>", "",
             "<b>📈 Market so far</b>"]
    lines += _indices_block(board, sensex)
    mv = _movers_block(movers, "🔥 Nifty 50 top movers")
    if mv:
        lines += [""] + mv
    sec = _sectors_block(sectors, "🏭 Sectors today")
    if sec:
        lines += [""] + sec
    if headlines:
        lines += ["", "<b>📰 News</b>"]
        lines += [f"  • {html.escape(h['title'], quote=False)} <i>({h['source']})</i>" for h in headlines[:7]]

    bullets = ai_engine.brief_bullets(
        "Explain what has happened in the market so far today and what is driving it. "
        "Link headlines to index or sector moves only where the data supports it.",
        _context(indices=board, sensex=sensex, top_movers=movers, sectors=sectors[:16],
                 headlines=[h["title"] for h in headlines[:12]]))
    lines += [""] + _ai_block("🤖 What's driving it", bullets) + _footer()
    return "\n".join(lines), {}


# ── 6:00 PM — Evening wrap ────────────────────────────────────────────────────

def _momentum_sectors(sectors: list[dict], n: int = 3) -> tuple[list[dict], list[dict]]:
    """Sectors up today AND over the week (building) vs down on both (fading)."""
    up = [s for s in sectors if (s.get("change_pct") or 0) > 0 and (s.get("week_pct") or 0) > 0]
    down = [s for s in sectors if (s.get("change_pct") or 0) < 0 and (s.get("week_pct") or 0) < 0]
    up.sort(key=lambda s: (s.get("week_pct") or 0) + (s.get("change_pct") or 0), reverse=True)
    down.sort(key=lambda s: (s.get("week_pct") or 0) + (s.get("change_pct") or 0))
    return up[:n], down[:n]


def _upcoming_block(events: dict, nifty_exp: list[str], bank_exp: list[str],
                    holidays: list[dict], days: int) -> list[str]:
    today = nse_data._today_ist()
    lines = [f"<b>📅 Coming up (next {days} days)</b>"]

    res = events.get("results") or []
    if res:
        lines.append("  <i>Results / board meetings</i>")
        for e in res[:8]:
            lines.append(f"  • {_day(e['date'], '%d %b')} — <b>{e['symbol']}</b> "
                         f"({', '.join(e['indices'])}): {html.escape(e['what'], quote=False)}")
    else:
        lines.append("  • No Nifty 50 / Bank Nifty results scheduled")

    acts = events.get("actions") or []
    if acts:
        lines.append("  <i>Ex-dates (dividend / split / bonus)</i>")
        for e in acts[:6]:
            lines.append(f"  • {_day(e['date'], '%d %b')} — <b>{e['symbol']}</b>: "
                         f"{html.escape(e['what'], quote=False)}")

    exp = []
    if nifty_exp:
        exp.append(f"Nifty {_day(nifty_exp[0])}")
    if bank_exp:
        exp.append(f"Bank Nifty {_day(bank_exp[0])}")
    if exp:
        lines.append("  <i>Next expiry</i>")
        lines.append("  • " + " · ".join(exp))

    soon = [h for h in holidays
            if (d := nse_data._parse_date(h["date"])) and today < d <= today + timedelta(days=14)]
    if soon:
        lines.append("  <i>Market holidays</i>")
        lines += [f"  • {_day(h['date'])} — {html.escape(h['name'] or '', quote=False)}" for h in soon]
    return lines


def build_evening(days_ahead: int = 7) -> tuple[str, dict]:
    board = nse_data.get_index_board() or {}
    sensex = market_data.get_sensex()
    fii = nse_data.get_fii_dii_data()
    sectors = nse_data.get_sector_indices() or []
    movers = nse_data.get_top_movers("NIFTY")
    bank_movers = nse_data.get_top_movers("BANKNIFTY", n=2)
    nifty_chain = nse_data.get_nifty_options_chain()
    events = nse_data.get_upcoming_events(days=days_ahead)
    nifty_exp = nse_data.get_next_expiries("NIFTY", 1)
    bank_exp = nse_data.get_next_expiries("BANKNIFTY", 1)
    holidays = nse_data.get_trading_holidays()
    headlines = news.fetch_indian_news(lookback_hours=10)

    building, fading = _momentum_sectors(sectors)

    lines = [f"<b>🌙 Evening Wrap</b>", f"<i>{_now_label()}</i>", "",
             f"<b>📈 Close ({_day(board.get('_date'))})</b>"]
    lines += _indices_block(board, sensex, with_range=False)

    fii_lines = _fii_block(fii, today_label="today's figures not out yet")
    if fii_lines:
        lines += [""] + fii_lines

    if building or fading:
        lines += ["", "<b>🚀 Gaining strength</b> <i>(up today and this week)</i>"]
        lines += [_sector_line(s) for s in building] or ["  • none today"]
        lines += ["<b>📉 Losing strength</b> <i>(down today and this week)</i>"]
        lines += [_sector_line(s) for s in fading] or ["  • none today"]
    else:
        lines += [""] + _sectors_block(sectors, "🏭 Sectors today")

    mv = _movers_block(movers, "🔥 Nifty 50 top movers")
    if mv:
        lines += [""] + mv
    bmv = _movers_block(bank_movers, "🏦 Bank Nifty top movers")
    if bmv:
        lines += bmv

    lines += [""] + _upcoming_block(events, nifty_exp, bank_exp, holidays, days_ahead)

    bullets = ai_engine.brief_bullets(
        "Give a brief wrap of today and what to watch tomorrow: which sectors or stocks "
        "show strength that could continue, which are weakening, and which upcoming "
        "events (results, expiry, holidays) could move Nifty, Sensex or Bank Nifty.",
        _context(close=board, sensex=sensex, fii_dii=fii, sectors=sectors[:16],
                 building=building, fading=fading, nifty_movers=movers,
                 banknifty_movers=bank_movers, nifty_chain=nifty_chain,
                 upcoming=events, next_expiry={"nifty": nifty_exp, "banknifty": bank_exp},
                 headlines=[h["title"] for h in headlines[:10]]), n=3)
    lines += [""] + _ai_block("🤖 Outlook", bullets) + _footer()

    data = {"nifty_chain": nifty_chain, "vix": board.get("INDIA VIX"), "fii_dii": fii}
    return "\n".join(lines), data
