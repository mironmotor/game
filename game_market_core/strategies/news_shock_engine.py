"""News Shock Engine (Stage 3).

Reacts to high-severity, high-novelty, directional news — and, crucially,
REFUSES when the news is contradictory/chaotic. Fail-safe by default: if the
event is ambiguous (weak sentiment) or the window is chaotic, no trade.

Entry on the bar after the shock (next-bar fill handled by the engine), stop
at an ATR multiple, target at a fixed reward:risk. Confidence blends
severity, novelty, and sentiment magnitude.
"""

from __future__ import annotations

from datatypes import Signal
from features.market_features import MarketFeatures
from strategies.base import Strategy


class NewsShockEngine(Strategy):
    name = "news_shock"

    def __init__(self, params: dict | None = None):
        p = params or {}
        self.min_severity = float(p.get("min_severity", 0.6))
        self.min_novelty = float(p.get("min_novelty", 0.4))
        self.min_abs_sentiment = float(p.get("min_abs_sentiment", 0.35))
        self.stop_atr = float(p.get("stop_atr", 2.0))
        self.reward_risk = float(p.get("reward_risk", 1.5))
        self.min_confidence = float(p.get("min_confidence", 0.5))

    def evaluate(self, i: int, mf: MarketFeatures, context: dict) -> Signal | None:
        news = context.get("news", {})
        if not news or news.get("chaos"):
            return None
        sev = news.get("severity", 0.0)
        nov = news.get("novelty", 0.0)
        sent = news.get("sentiment", 0.0)
        if sev < self.min_severity or nov < self.min_novelty or abs(sent) < self.min_abs_sentiment:
            return None
        if not mf.ready(i):
            return None
        atr = mf.atr[i]
        if atr <= 0:
            return None

        close = mf.close[i]
        ts = mf.candles[i].ts
        conf = min(1.0, 0.5 * sev + 0.3 * nov + 0.2 * min(1.0, abs(sent)))
        if conf < self.min_confidence:
            return None

        ents = ",".join(news.get("entities", [])[:3])
        if sent > 0:
            stop = close - self.stop_atr * atr
            risk = close - stop
            tp = close + self.reward_risk * risk
            side = "long"
        else:
            stop = close + self.stop_atr * atr
            risk = stop - close
            tp = close - self.reward_risk * risk
            side = "short"
        if risk <= 0:
            return None
        return Signal(ts=ts, side=side, entry=close, stop=stop, take_profit=tp,
                      confidence=conf, strategy=self.name,
                      reason=f"news shock sev={sev:.2f} nov={nov:.2f} sent={sent:+.2f} [{ents}]")
