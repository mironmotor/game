"""Kill switch — a hard, non-negotiable stop on trading activity.

Trips on max drawdown from equity peak. Once tripped it stays tripped for
the rest of the run (Stage 1) — research can inspect what happened rather
than letting the system "trade its way back", which is how accounts die.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class KillSwitch:
    max_drawdown_stop: float
    peak_equity: float = 0.0
    tripped: bool = False
    trip_reason: str = ""

    def update(self, equity: float) -> None:
        self.peak_equity = max(self.peak_equity, equity)
        if self.peak_equity > 0:
            dd = (self.peak_equity - equity) / self.peak_equity
            if dd >= self.max_drawdown_stop and not self.tripped:
                self.tripped = True
                self.trip_reason = (
                    f"max drawdown {dd:.1%} >= limit {self.max_drawdown_stop:.1%}"
                )
