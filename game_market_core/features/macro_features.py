"""Macro feature engine.

Converts the macro basket (S&P, Nasdaq, gold, dollar) into a small set of
regime-context signals aligned to any crypto timestamp via "last known value
<= ts" (no look-ahead). Used by the Meta Controller / risk layer to know
whether the broad risk environment is supportive, and to flag crisis.

Empty input -> neutral state, so the system never blocks on missing macro.
"""

from __future__ import annotations

import bisect
import math


class MacroContext:
    def __init__(self, macro_series: dict | None = None, sma_window: int = 50,
                 crisis_drawdown: float = 0.15):
        self.crisis_drawdown = crisis_drawdown
        self._prepared: dict[str, dict] = {}
        for name, series in (macro_series or {}).items():
            if not series:
                continue
            series = sorted(series, key=lambda x: x[0])
            ts = [p[0] for p in series]
            close = [p[1] for p in series]
            sma = self._sma(close, sma_window)
            rollmax = self._rolling_max(close, sma_window * 2)
            self._prepared[name] = {"ts": ts, "close": close, "sma": sma, "rollmax": rollmax}

    @staticmethod
    def _sma(src, w):
        out = [float("nan")] * len(src)
        run = 0.0
        for i, v in enumerate(src):
            run += v
            if i >= w:
                run -= src[i - w]
            if i >= w - 1:
                out[i] = run / w
        return out

    @staticmethod
    def _rolling_max(src, w):
        out = [float("nan")] * len(src)
        for i in range(len(src)):
            lo = max(0, i - w + 1)
            out[i] = max(src[lo:i + 1])
        return out

    def _idx_at(self, name: str, ts: int) -> int | None:
        prep = self._prepared.get(name)
        if not prep:
            return None
        i = bisect.bisect_right(prep["ts"], ts) - 1
        return i if i >= 0 else None

    def at(self, ts: int) -> dict:
        state = {
            "risk_on": 0.0,           # -1 risk-off .. +1 risk-on (from SPX vs SMA)
            "dollar_strength": 0.0,   # +1 strong USD (risk-off tilt for crypto)
            "crisis_mode": False,
            "available": bool(self._prepared),
        }
        i = self._idx_at("spx", ts)
        if i is not None:
            prep = self._prepared["spx"]
            sma = prep["sma"][i]
            if not math.isnan(sma) and sma > 0:
                state["risk_on"] = max(-1.0, min(1.0, (prep["close"][i] / sma - 1.0) * 10))
            rm = prep["rollmax"][i]
            if not math.isnan(rm) and rm > 0:
                dd = (rm - prep["close"][i]) / rm
                state["crisis_mode"] = dd >= self.crisis_drawdown
        j = self._idx_at("dxy", ts)
        if j is not None:
            prep = self._prepared["dxy"]
            sma = prep["sma"][j]
            if not math.isnan(sma) and sma > 0:
                state["dollar_strength"] = max(-1.0, min(1.0, (prep["close"][j] / sma - 1.0) * 10))
        return state


def macro_state(ts: int, macro: dict | None = None) -> dict:
    """Backwards-compatible single-call helper."""
    return MacroContext(macro).at(ts)
