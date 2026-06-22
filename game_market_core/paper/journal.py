"""Trade journal — every decision and its reason.

The Meta Controller logs WHY each trade was taken; the journal persists
trades + reasons so daily/weekly reports can be reconstructed and audited.
Stage 1 reuses the backtest's CSV journal writer; this module is the live
hook for Stage 3 paper trading.
"""

from __future__ import annotations

from datatypes import Trade
from data.storage.database import save_trades_csv


def write_journal(trades: list[Trade], path: str) -> None:
    save_trades_csv(trades, path)
