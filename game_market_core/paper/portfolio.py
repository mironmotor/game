"""Virtual portfolio for paper trading (minimal, functional).

Tracks cash, a single open position, and realized equity using the same
adverse-fill conventions as the backtest so paper results are comparable.
Stage 3 expands this into the full real-time loop.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Portfolio:
    equity: float
    position: dict | None = None
    realized: list[float] = field(default_factory=list)

    def is_flat(self) -> bool:
        return self.position is None
