"""Shared lightweight data structures used across the pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Candle:
    ts: int          # unix seconds
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Signal:
    """A trade intention emitted by a strategy. Sizing is decided later by
    the Risk Engine; the strategy only expresses direction and price levels."""

    ts: int
    side: str                 # "long" | "short"
    entry: float
    stop: float
    take_profit: float
    confidence: float         # 0..1
    strategy: str
    reason: str = ""


@dataclass
class Trade:
    """A closed trade as recorded by the backtest engine."""

    entry_ts: int
    exit_ts: int
    side: str
    entry_price: float
    exit_price: float
    qty: float
    fees: float
    pnl: float                # net of all costs, in quote currency
    r_multiple: float         # realized PnL in units of initial risk
    strategy: str
    reason: str
    exit_reason: str          # "take_profit" | "stop" | "end_of_data"
    equity_after: float = 0.0
    duration_bars: int = 0
    features: list = field(default_factory=list)  # ML feature snapshot at entry
