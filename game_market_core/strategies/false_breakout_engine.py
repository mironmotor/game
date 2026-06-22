"""False Breakout Engine.

Direct descendant of the MT4 EA's false-breakout model. The thesis: price
sweeps a known support/resistance level (a liquidity grab), fails, and
closes back inside the range. We fade the failed move.

A signal requires ALL of:
  1. The bar pierced a prior S/R level by >= ``atr_penetration`` * ATR
     (a meaningful sweep, not noise).
  2. The bar closed back inside the range (rejection).
  3. Volume >= ``volume_factor`` * rolling average volume (participation).

Direction: fade. Swept resistance -> short. Swept support -> long.
Stop sits just beyond the sweep extreme; target is a fixed reward:risk.
All levels use data available at the close of bar ``i`` only.
"""

from __future__ import annotations

from datatypes import Signal
from features.market_features import MarketFeatures
from strategies.base import Strategy


class FalseBreakoutEngine(Strategy):
    name = "false_breakout"

    def __init__(self, params: dict):
        self.atr_penetration = float(params.get("atr_penetration", 0.75))
        self.close_back_inside = bool(params.get("close_back_inside", True))
        self.volume_factor = float(params.get("volume_factor", 1.3))
        self.stop_atr_buffer = float(params.get("stop_atr_buffer", 0.5))
        self.reward_risk = float(params.get("reward_risk", 1.8))
        self.min_confidence = float(params.get("min_confidence", 0.5))

    def evaluate(self, i: int, mf: MarketFeatures, context: dict) -> Signal | None:
        if not mf.ready(i):
            return None

        atr = mf.atr[i]
        if atr <= 0:
            return None

        high, low, close = mf.high[i], mf.low[i], mf.close[i]
        res, sup = mf.resistance[i], mf.support[i]
        vol_ok = mf.volume[i] >= self.volume_factor * mf.vol_sma[i]
        if not vol_ok:
            return None

        ts = mf.candles[i].ts

        # --- Bearish false breakout: swept resistance, closed back inside ----
        pierce_up = high - res
        if pierce_up >= self.atr_penetration * atr:
            closed_inside = (close < res) if self.close_back_inside else True
            if closed_inside:
                stop = high + self.stop_atr_buffer * atr
                risk = stop - close
                if risk > 0:
                    tp = close - self.reward_risk * risk
                    conf = self._confidence(pierce_up / atr, mf.volume[i] / mf.vol_sma[i])
                    if conf >= self.min_confidence:
                        return Signal(
                            ts=ts, side="short", entry=close, stop=stop,
                            take_profit=tp, confidence=conf, strategy=self.name,
                            reason=f"swept resistance {res:.2f} by {pierce_up/atr:.2f} ATR, closed back inside",
                        )

        # --- Bullish false breakout: swept support, closed back inside -------
        pierce_dn = sup - low
        if pierce_dn >= self.atr_penetration * atr:
            closed_inside = (close > sup) if self.close_back_inside else True
            if closed_inside:
                stop = low - self.stop_atr_buffer * atr
                risk = close - stop
                if risk > 0:
                    tp = close + self.reward_risk * risk
                    conf = self._confidence(pierce_dn / atr, mf.volume[i] / mf.vol_sma[i])
                    if conf >= self.min_confidence:
                        return Signal(
                            ts=ts, side="long", entry=close, stop=stop,
                            take_profit=tp, confidence=conf, strategy=self.name,
                            reason=f"swept support {sup:.2f} by {pierce_dn/atr:.2f} ATR, closed back inside",
                        )
        return None

    def _confidence(self, pierce_atr: float, vol_ratio: float) -> float:
        """Blend sweep depth and volume participation into 0..1."""
        depth = min(1.0, pierce_atr / 2.0)          # 2 ATR sweep -> full
        vol = min(1.0, (vol_ratio - 1.0) / 1.0)     # 2x avg vol  -> full
        return max(0.0, min(1.0, 0.5 * depth + 0.5 * vol))
