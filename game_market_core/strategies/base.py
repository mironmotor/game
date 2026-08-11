"""Strategy interface.

A strategy is a pure function of *past* market state: given the feature
frame and the current bar index ``i``, it returns at most one Signal using
only information available at the close of bar ``i``. The backtest fills at
the next bar's open, so a signal never trades on its own future.
"""

from __future__ import annotations

from datatypes import Signal
from features.market_features import MarketFeatures


class Strategy:
    name = "base"

    def evaluate(self, i: int, mf: MarketFeatures, context: dict) -> Signal | None:
        raise NotImplementedError
