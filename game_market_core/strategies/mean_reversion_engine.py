"""Mean Reversion Engine (Stage 2 stub).

Plan: fade stretched moves toward a rolling anchor (e.g. RSI extremes +
distance from VWAP/EMA), allowed ONLY in a ranging regime and hard-disabled
during trends. Returns no signal until the regime classifier gates it.
"""

from __future__ import annotations

from datatypes import Signal
from features.market_features import MarketFeatures
from strategies.base import Strategy


class MeanReversionEngine(Strategy):
    name = "mean_reversion"

    def __init__(self, params: dict | None = None):
        self.params = params or {}

    def evaluate(self, i: int, mf: MarketFeatures, context: dict) -> Signal | None:
        if context.get("regime") == "trend":
            return None
        return None
