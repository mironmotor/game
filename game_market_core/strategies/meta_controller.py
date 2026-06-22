"""Meta Controller — the strategy selector / governor.

The "main brain". It owns the roster of strategies and decides which one(s)
may speak given the current regime, and logs the reason for every decision.

Stage 1 scope: route to the single enabled strategy (False Breakout). The
regime-aware selection, per-strategy enable/disable, and confidence-weighted
arbitration hooks are present so Stage 2+ engines slot in without changing
the backtest/risk interfaces.
"""

from __future__ import annotations

from datatypes import Signal
from features.market_features import MarketFeatures
from strategies.base import Strategy
from strategies.false_breakout_engine import FalseBreakoutEngine


class MetaController:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.strategies: list[Strategy] = []
        self.decision_log: list[dict] = []

        strat_cfg = cfg.get("strategy", {})
        fb = strat_cfg.get("false_breakout", {})
        if fb.get("enabled", True):
            self.strategies.append(FalseBreakoutEngine(fb))

    def select(self, i: int, mf: MarketFeatures, context: dict) -> Signal | None:
        """Return the highest-confidence allowed signal at bar ``i``."""
        best: Signal | None = None
        for strat in self.strategies:
            sig = strat.evaluate(i, mf, context)
            if sig is None:
                continue
            if best is None or sig.confidence > best.confidence:
                best = sig
        if best is not None:
            self.decision_log.append(
                {"ts": best.ts, "strategy": best.strategy,
                 "side": best.side, "confidence": round(best.confidence, 3),
                 "reason": best.reason}
            )
        return best
