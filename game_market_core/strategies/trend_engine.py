"""Trend Following Engine (Stage 2 stub).

Plan: enter in the direction of a confirmed multi-timeframe trend
(W1/D1/H4 alignment, ATR-normalized MACD slope, price above/below key
EMAs) and only while the regime classifier reports a trending regime.
Returns no signal until implemented.
"""

from __future__ import annotations

from datatypes import Signal
from features.market_features import MarketFeatures
from strategies.base import Strategy


class TrendEngine(Strategy):
    name = "trend"

    def __init__(self, params: dict | None = None):
        self.params = params or {}

    def evaluate(self, i: int, mf: MarketFeatures, context: dict) -> Signal | None:
        return None
