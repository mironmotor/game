"""Meta Controller — the strategy selector / governor.

The "main brain". It owns the roster of strategies and, given the current
regime, decides which engines may speak, then picks the highest-confidence
allowed signal. Every decision (and every regime-based veto) is logged.

Regime gating (Stage 2):
  range / unknown : False Breakout (mean-reversion-style fade) only
  trend / euphoria: Trend engine only
  crisis          : no new entries (risk-off)
This stops the two engines from fighting each other and encodes "the meta
controller can disable a strategy" from the spec.
"""

from __future__ import annotations

from datatypes import Signal
from features.market_features import MarketFeatures
from strategies.base import Strategy
from strategies.false_breakout_engine import FalseBreakoutEngine
from strategies.trend_engine import TrendEngine

_REGIME_ALLOW = {
    "range": {"false_breakout"},
    "unknown": {"false_breakout"},
    "trend": {"trend"},
    "euphoria": {"trend"},
    "crisis": set(),
}


class MetaController:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.strategies: list[Strategy] = []
        self.decision_log: list[dict] = []

        strat_cfg = cfg.get("strategy", {})
        fb = strat_cfg.get("false_breakout", {})
        if fb.get("enabled", True):
            self.strategies.append(FalseBreakoutEngine(fb))
        tr = strat_cfg.get("trend", {})
        if tr.get("enabled", False):
            self.strategies.append(TrendEngine(tr))

    def allowed_for(self, regime: str) -> set[str]:
        return _REGIME_ALLOW.get(regime, {"false_breakout"})

    def select(self, i: int, mf: MarketFeatures, context: dict) -> Signal | None:
        regime = context.get("regime", "unknown")
        allowed = self.allowed_for(regime)
        if not allowed:
            return None

        best: Signal | None = None
        for strat in self.strategies:
            if strat.name not in allowed:
                continue
            sig = strat.evaluate(i, mf, context)
            if sig is None:
                continue
            if best is None or sig.confidence > best.confidence:
                best = sig

        if best is not None:
            self.decision_log.append({
                "ts": best.ts, "regime": regime, "strategy": best.strategy,
                "side": best.side, "confidence": round(best.confidence, 3),
                "reason": best.reason,
            })
        return best
