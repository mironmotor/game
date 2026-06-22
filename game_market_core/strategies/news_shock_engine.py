"""News Shock Engine (Stage 3 stub).

Plan: react to high-severity, high-novelty events, estimate direction and
size, and — crucially — REFUSE to trade when the event is too uncertain
(news chaos). Fail-safe by default. Returns no signal until news data is
wired.
"""

from __future__ import annotations

from datatypes import Signal
from features.market_features import MarketFeatures
from strategies.base import Strategy


class NewsShockEngine(Strategy):
    name = "news_shock"

    def __init__(self, params: dict | None = None):
        self.params = params or {}

    def evaluate(self, i: int, mf: MarketFeatures, context: dict) -> Signal | None:
        news = context.get("news", {})
        if news.get("chaos"):
            return None
        return None
