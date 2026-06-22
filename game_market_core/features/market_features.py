"""Market feature engine (pure stdlib).

Every feature at index ``i`` depends only on candles ``<= i``. This is the
single most important property for an honest backtest: it makes look-ahead
leakage structurally impossible at the feature layer.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from datatypes import Candle


@dataclass
class MarketFeatures:
    candles: list[Candle]
    atr_period: int = 14
    sr_lookback: int = 48
    rsi_period: int = 14
    vol_window: int = 20

    def __post_init__(self) -> None:
        c = self.candles
        n = len(c)
        self.close = [x.close for x in c]
        self.high = [x.high for x in c]
        self.low = [x.low for x in c]
        self.volume = [x.volume for x in c]

        self.log_ret = [0.0] * n
        for i in range(1, n):
            prev = self.close[i - 1]
            self.log_ret[i] = math.log(self.close[i] / prev) if prev > 0 else 0.0

        self.atr = self._wilder_atr(self.atr_period)
        self.rsi = self._wilder_rsi(self.rsi_period)
        self.realized_vol = self._rolling_std(self.log_ret, self.vol_window)
        self.vol_sma = self._sma(self.volume, self.vol_window)
        self.ema12 = self._ema(self.close, 12)
        self.ema26 = self._ema(self.close, 26)
        self.macd = [self.ema12[i] - self.ema26[i] for i in range(n)]
        self.macd_signal = self._ema(self.macd, 9)
        # Prior-range support/resistance EXCLUDING the current bar so a
        # breakout is measured against levels that already existed.
        self.resistance, self.support = self._rolling_sr(self.sr_lookback)

    # ---- indicator builders -------------------------------------------------
    def _sma(self, src: list[float], period: int) -> list[float]:
        n = len(src)
        out = [float("nan")] * n
        run = 0.0
        for i in range(n):
            run += src[i]
            if i >= period:
                run -= src[i - period]
            if i >= period - 1:
                out[i] = run / period
        return out

    def _ema(self, src: list[float], period: int) -> list[float]:
        n = len(src)
        out = [float("nan")] * n
        if n == 0:
            return out
        k = 2.0 / (period + 1)
        out[0] = src[0]
        for i in range(1, n):
            prev = out[i - 1]
            if math.isnan(prev):
                prev = src[i]
            out[i] = src[i] * k + prev * (1 - k)
        return out

    def _rolling_std(self, src: list[float], period: int) -> list[float]:
        n = len(src)
        out = [float("nan")] * n
        for i in range(n):
            if i >= period - 1:
                window = src[i - period + 1 : i + 1]
                mean = sum(window) / period
                var = sum((x - mean) ** 2 for x in window) / period
                out[i] = math.sqrt(var)
        return out

    def _wilder_atr(self, period: int) -> list[float]:
        n = len(self.candles)
        out = [float("nan")] * n
        if n == 0:
            return out
        tr = [0.0] * n
        tr[0] = self.high[0] - self.low[0]
        for i in range(1, n):
            tr[i] = max(
                self.high[i] - self.low[i],
                abs(self.high[i] - self.close[i - 1]),
                abs(self.low[i] - self.close[i - 1]),
            )
        if n > period:
            out[period] = sum(tr[1 : period + 1]) / period
            for i in range(period + 1, n):
                out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
        return out

    def _wilder_rsi(self, period: int) -> list[float]:
        n = len(self.close)
        out = [float("nan")] * n
        if n <= period:
            return out
        gains = losses = 0.0
        for i in range(1, period + 1):
            ch = self.close[i] - self.close[i - 1]
            gains += max(ch, 0.0)
            losses += max(-ch, 0.0)
        avg_gain = gains / period
        avg_loss = losses / period
        for i in range(period + 1, n):
            ch = self.close[i] - self.close[i - 1]
            avg_gain = (avg_gain * (period - 1) + max(ch, 0.0)) / period
            avg_loss = (avg_loss * (period - 1) + max(-ch, 0.0)) / period
            if avg_loss == 0:
                out[i] = 100.0
            else:
                rs = avg_gain / avg_loss
                out[i] = 100.0 - 100.0 / (1.0 + rs)
        return out

    def _rolling_sr(self, lookback: int) -> tuple[list[float], list[float]]:
        n = len(self.candles)
        res = [float("nan")] * n
        sup = [float("nan")] * n
        for i in range(n):
            if i >= lookback:
                window_hi = self.high[i - lookback : i]   # excludes current bar
                window_lo = self.low[i - lookback : i]
                res[i] = max(window_hi)
                sup[i] = min(window_lo)
        return res, sup

    # ---- convenience --------------------------------------------------------
    def trend_strength(self, i: int) -> float:
        """Signed, ATR-normalized MACD: positive = up-trend pressure."""
        a = self.atr[i]
        if i < 0 or math.isnan(a) or a == 0 or math.isnan(self.macd[i]):
            return 0.0
        return self.macd[i] / a

    def ready(self, i: int) -> bool:
        """True once all features used by strategies are defined at ``i``."""
        return (
            i >= self.sr_lookback
            and not math.isnan(self.atr[i])
            and not math.isnan(self.resistance[i])
            and not math.isnan(self.vol_sma[i])
        )
