"""Internal algorithm state — the strategy observing itself.

This is the "risk temperature" of the system: recent winrate, drawdown,
loss streak, and a derived confidence multiplier. The Risk Engine reads
this to size down after losses and only size up once a genuine edge has
been re-established. Ported in spirit from the MT4 EA's performance
multipliers, but made explicit and inspectable.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field


@dataclass
class InternalState:
    window: int = 30
    results: deque = field(default_factory=lambda: deque(maxlen=30))
    loss_streak: int = 0
    win_streak: int = 0
    peak_equity: float = 0.0
    equity: float = 0.0

    def update_trade(self, pnl: float, equity: float) -> None:
        won = pnl > 0
        self.results.append(1 if won else 0)
        if won:
            self.win_streak += 1
            self.loss_streak = 0
        else:
            self.loss_streak += 1
            self.win_streak = 0
        self.equity = equity
        self.peak_equity = max(self.peak_equity, equity)

    def recent_winrate(self) -> float:
        if not self.results:
            return 0.5
        return sum(self.results) / len(self.results)

    def drawdown(self) -> float:
        if self.peak_equity <= 0:
            return 0.0
        return max(0.0, (self.peak_equity - self.equity) / self.peak_equity)

    def risk_temperature(self) -> float:
        """0..1 multiplier on risk. Cool after losses/drawdown, warm slowly.

        Deliberately asymmetric: a loss streak cuts risk fast; recovery
        warms it back gradually. This is what stops a "100-300%/mo" target
        from turning into a blow-up.
        """
        temp = 1.0
        temp *= max(0.25, 1.0 - 0.20 * self.loss_streak)
        dd = self.drawdown()
        if dd > 0.05:
            temp *= max(0.25, 1.0 - 2.0 * (dd - 0.05))
        wr = self.recent_winrate()
        temp *= 0.7 + 0.6 * wr            # 0.7..1.3 scaling by recent winrate
        return max(0.1, min(1.0, temp))
