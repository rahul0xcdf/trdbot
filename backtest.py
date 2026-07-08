"""
Backtester — replays saved signals against historical price data.
Run locally:  python backtest.py --strategy momentum --days 60
"""

import json
import argparse
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
import yfinance as yf

DB_PATH = Path("data/signals.db")

# ── Database ──────────────────────────────────────────────────────────────────

def init_db():
    DB_PATH.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS signals (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ts          TEXT NOT NULL,
            strategy    TEXT NOT NULL,
            symbol      TEXT NOT NULL,
            direction   TEXT NOT NULL,
            strength    REAL,
            sentiment   REAL,
            price_entry REAL,
            outcome_pct REAL,
            resolved    INTEGER DEFAULT 0
        )
    """)
    conn.commit()
    return conn


def save_signal(conn, strategy, symbol, direction, strength, sentiment, price_entry):
    conn.execute("""
        INSERT INTO signals (ts, strategy, symbol, direction, strength, sentiment, price_entry)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (datetime.utcnow().isoformat(), strategy, symbol, direction, strength, sentiment, price_entry))
    conn.commit()


def resolve_signals(conn, hold_days=5):
    """Look up current prices for unresolved signals and calculate outcome."""
    rows = conn.execute(
        "SELECT id, ts, symbol, direction, price_entry FROM signals WHERE resolved=0"
    ).fetchall()

    for row in rows:
        sid, ts, symbol, direction, entry = row
        signal_date = datetime.fromisoformat(ts)
        if datetime.utcnow() - signal_date < timedelta(days=hold_days):
            continue  # not enough time elapsed yet

        try:
            ticker = yf.Ticker(symbol)
            hist   = ticker.history(period=f"{hold_days + 2}d")
            if hist.empty:
                continue
            exit_price = hist["Close"].iloc[-1]
            pct = ((exit_price - entry) / entry) * 100
            if direction == "PUT":
                pct = -pct  # inverse

            conn.execute(
                "UPDATE signals SET outcome_pct=?, resolved=1 WHERE id=?",
                (round(pct, 2), sid)
            )
            conn.commit()
            print(f"  Resolved {symbol} {direction}: {pct:+.2f}%")
        except Exception as e:
            print(f"  [WARN] Could not resolve {symbol}: {e}")


# ── Backtest Report ───────────────────────────────────────────────────────────

def run_report(conn, strategy: str, days: int):
    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
    rows = conn.execute("""
        SELECT symbol, direction, strength, sentiment, price_entry, outcome_pct
        FROM signals
        WHERE strategy=? AND ts>=? AND resolved=1
        ORDER BY ts ASC
    """, (strategy, cutoff)).fetchall()

    if not rows:
        print(f"\nNo resolved signals for strategy '{strategy}' in last {days} days.")
        return

    wins   = [r for r in rows if r[5] and r[5] > 0]
    losses = [r for r in rows if r[5] and r[5] <= 0]
    total  = len(rows)
    win_rate = len(wins) / total * 100 if total else 0

    outcomes = [r[5] for r in rows if r[5] is not None]
    avg_win   = sum(r[5] for r in wins)   / len(wins)   if wins   else 0
    avg_loss  = sum(r[5] for r in losses) / len(losses) if losses else 0
    total_pct = sum(outcomes)
    sharpe    = (sum(outcomes) / len(outcomes)) / (
        (sum((x - sum(outcomes)/len(outcomes))**2 for x in outcomes) / len(outcomes)) ** 0.5
        if len(outcomes) > 1 else 1
    )

    print(f"""
╔══════════════════════════════════════════════════════╗
║  Backtest Report — {strategy:<15} — last {days}d      ║
╠══════════════════════════════════════════════════════╣
  Total signals   : {total}
  Win rate        : {win_rate:.1f}%  ({len(wins)}W / {len(losses)}L)
  Avg win         : +{avg_win:.2f}%
  Avg loss        : {avg_loss:.2f}%
  Total return    : {total_pct:+.2f}%
  Sharpe (approx) : {sharpe:.2f}

  Signal breakdown:
""")
    for r in rows:
        icon = "✅" if r[5] and r[5] > 0 else "❌"
        print(f"    {icon}  {r[0]:<14} {r[1]:<5}  entry: {r[3]:.2f}  outcome: {r[5]:+.2f}%")

    print("\n  ⚠️  Past performance is not indicative of future results.\n")


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Market Bot Backtester")
    parser.add_argument("--strategy", default="balanced", help="Strategy name")
    parser.add_argument("--days",     default=30, type=int, help="Lookback window in days")
    parser.add_argument("--resolve",  action="store_true",  help="Resolve open signals first")
    parser.add_argument("--hold",     default=5,  type=int, help="Hold period in days for resolution")
    args = parser.parse_args()

    conn = init_db()

    if args.resolve:
        print(f"Resolving open signals (hold={args.hold}d)...")
        resolve_signals(conn, hold_days=args.hold)

    run_report(conn, strategy=args.strategy, days=args.days)


