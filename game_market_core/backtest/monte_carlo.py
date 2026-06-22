"""Monte Carlo robustness checks.

Stage 1 implements ``probability_of_ruin``: bootstrap-resample the realized
per-trade returns (as a fraction of equity at the time of each trade) and
estimate how often a randomly ordered version of this edge would suffer a
catastrophic drawdown. A real edge should survive reshuffling; a fragile one
that depended on a lucky ordering will not.

Full path Monte Carlo (parameter perturbation, block bootstrap) is Stage 2.
"""

from __future__ import annotations

import random

RUIN_DRAWDOWN = 0.50  # treat a 50% peak-to-trough drop as "ruin"


def _trade_fractions(trades) -> list[float]:
    fr: list[float] = []
    for t in trades:
        eq_before = t.equity_after - t.pnl
        if eq_before > 0:
            fr.append(t.pnl / eq_before)
    return fr


def probability_of_ruin(trades, start_equity: float, sims: int = 2000,
                        seed: int = 17) -> float:
    fractions = _trade_fractions(trades)
    if len(fractions) < 5:
        return 0.0
    rng = random.Random(seed)
    ruined = 0
    n = len(fractions)
    for _ in range(sims):
        equity = start_equity
        peak = start_equity
        for _ in range(n):
            equity *= 1.0 + fractions[rng.randrange(n)]
            if equity <= 0:
                ruined += 1
                break
            peak = max(peak, equity)
            if (peak - equity) / peak >= RUIN_DRAWDOWN:
                ruined += 1
                break
    return ruined / sims
