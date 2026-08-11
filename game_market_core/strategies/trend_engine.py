"""Trend Following Engine (Stage 2).

Enters in the direction of an established trend, but only when multiple
conditions agree and the regime allows it (the Meta Controller restricts
this engine to trend/euphoria regimes). This is the counterpart to the
mean-reversion-style False Breakout engine: the two are gated by regime so
they don't fight each other.

Long conditions (mirror for short):
  * ATR-normalized trend strength (MACD/ATR) >= threshold
  * fast EMA above slow EMA and price above the slow EMA (alignment)
  * RSI in a continuation band (not already exhausted)
Stop = ATR multiple below entry; target = reward:risk multiple of that risk.
All inputs use data available at the close of bar i only.
"""

from __future__ import annotations

import math

from datatypes import Signal
from features.market_features import MarketFeatures
from strategies.base import Strategy


class TrendEngine(Strategy):
    name = "trend"

    def __init__(self, params: dict | None = None):
        p = params or {}
        self.min_strength = float(p.get("min_trend_strength", 0.6))
        self.stop_atr = float(p.get("stop_atr", 2.0))
        self.reward_risk = float(p.get("reward_risk", 2.0))
        self.rsi_long_band = (float(p.get("rsi_long_min", 50)), float(p.get("rsi_long_max", 78)))
        self.rsi_short_band = (float(p.get("rsi_short_min", 22)), float(p.get("rsi_short_max", 50)))
        self.min_confidence = float(p.get("min_confidence", 0.5))

    def evaluate(self, i: int, mf: MarketFeatures, context: dict) -> Signal | None:
        if not mf.ready(i):
            return None
        atr = mf.atr[i]
        ts_strength = mf.trend_strength(i)
        if atr <= 0 or math.isnan(ts_strength):
            return None
        if math.isnan(mf.ema12[i]) or math.isnan(mf.ema26[i]) or math.isnan(mf.rsi[i]):
            return None

        close = mf.close[i]
        rsi = mf.rsi[i]
        ts = mf.candles[i].ts
        conf = min(1.0, abs(ts_strength) / (2 * self.min_strength))
        if conf < self.min_confidence:
            return None

        up = (ts_strength >= self.min_strength and mf.ema12[i] > mf.ema26[i]
              and close > mf.ema26[i] and self.rsi_long_band[0] <= rsi <= self.rsi_long_band[1])
        if up:
            stop = close - self.stop_atr * atr
            risk = close - stop
            if risk > 0:
                return Signal(ts=ts, side="long", entry=close, stop=stop,
                              take_profit=close + self.reward_risk * risk,
                              confidence=conf, strategy=self.name,
                              reason=f"uptrend strength {ts_strength:.2f}, EMA aligned, RSI {rsi:.0f}")

        dn = (ts_strength <= -self.min_strength and mf.ema12[i] < mf.ema26[i]
              and close < mf.ema26[i] and self.rsi_short_band[0] <= rsi <= self.rsi_short_band[1])
        if dn:
            stop = close + self.stop_atr * atr
            risk = stop - close
            if risk > 0:
                return Signal(ts=ts, side="short", entry=close, stop=stop,
                              take_profit=close - self.reward_risk * risk,
                              confidence=conf, strategy=self.name,
                              reason=f"downtrend strength {ts_strength:.2f}, EMA aligned, RSI {rsi:.0f}")
        return None
