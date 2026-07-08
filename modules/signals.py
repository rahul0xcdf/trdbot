"""
Signal logging + NSE snapshots (SQLite).

Reuses backtest.py as the single source of truth for the signals table and
its save/resolve helpers (backtest.py stays unchanged). Adds an nse_snapshots
table for tracking PCR / VIX / max pain / FII-DII over time.
"""

import sqlite3
from datetime import datetime
from pathlib import Path

# Reuse the existing schema + helpers rather than duplicating them.
from backtest import DB_PATH, init_db as _init_signals_db, save_signal, resolve_signals

__all__ = ["init_db", "save_signal", "resolve_signals", "log_nse_snapshot", "DB_PATH"]


def init_db() -> sqlite3.Connection:
    """Open the DB with the signals table (from backtest) plus nse_snapshots."""
    conn = _init_signals_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS nse_snapshots (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            ts       TEXT NOT NULL,
            pcr      REAL,
            vix      REAL,
            max_pain REAL,
            fii_net  REAL,
            dii_net  REAL
        )
    """)
    conn.commit()
    return conn


def log_nse_snapshot(conn, timestamp, pcr, vix, max_pain, fii_net=None, dii_net=None):
    """Persist a point-in-time NSE snapshot."""
    try:
        ts = timestamp or datetime.utcnow().isoformat()
        conn.execute(
            """INSERT INTO nse_snapshots (ts, pcr, vix, max_pain, fii_net, dii_net)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (ts, pcr, vix, max_pain, fii_net, dii_net),
        )
        conn.commit()
        print(f"[OK] log_nse_snapshot: PCR={pcr} VIX={vix} max_pain={max_pain}")
    except Exception as e:
        print(f"[WARN] log_nse_snapshot: {e}")
