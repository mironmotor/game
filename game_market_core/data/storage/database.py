"""Lightweight storage helpers (stdlib only).

Stage 1 persists candles and trade journals to SQLite/CSV without any ORM.
This keeps the data layer dependency-free and inspectable.
"""

from __future__ import annotations

import csv
import sqlite3
from pathlib import Path

from datatypes import Candle, Trade


def save_candles_csv(candles: list[Candle], path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["ts", "open", "high", "low", "close", "volume"])
        for c in candles:
            writer.writerow([c.ts, c.open, c.high, c.low, c.close, c.volume])


def save_trades_csv(trades: list[Trade], path: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(
            ["entry_ts", "exit_ts", "side", "entry_price", "exit_price", "qty",
             "fees", "pnl", "r_multiple", "exit_reason", "strategy", "reason"]
        )
        for t in trades:
            writer.writerow(
                [t.entry_ts, t.exit_ts, t.side, t.entry_price, t.exit_price,
                 t.qty, t.fees, t.pnl, t.r_multiple, t.exit_reason, t.strategy, t.reason]
            )


def open_db(path: str) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS candles "
        "(ts INTEGER PRIMARY KEY, open REAL, high REAL, low REAL, close REAL, volume REAL)"
    )
    return conn
