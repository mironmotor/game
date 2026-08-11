"""Feature vector built at signal time — the input to the ML trade filter.

The SAME builder is used to (a) snapshot features onto every executed trade
(for training labels) and (b) score a live signal for the should-trade veto.
Using one builder guarantees train/serve parity (no train/serve skew).

Every value comes from data available at the close of the signal bar ``i``.
NaNs collapse to 0.0 so the vector is always well-formed.
"""

from __future__ import annotations

import math

FEATURE_NAMES = [
    "trend_strength", "rsi", "realized_vol", "atr_pct", "vol_ratio",
    "sweep_up_atr", "sweep_dn_atr",
    "is_trend", "is_range", "is_euphoria",
    "news_severity", "news_sentiment", "news_novelty",
    "onchain_fees_z", "onchain_miner_z",
    "side_long", "confidence",
    "is_false_breakout", "is_trend_engine", "is_news_shock",
]


def _f(x: float) -> float:
    return 0.0 if x is None or (isinstance(x, float) and math.isnan(x)) else float(x)


def build_vector(i: int, mf, context: dict, sig) -> list[float]:
    atr = _f(mf.atr[i])
    close = _f(mf.close[i]) or 1.0
    vol_sma = _f(mf.vol_sma[i]) or 1.0
    res = _f(mf.resistance[i])
    sup = _f(mf.support[i])
    regime = context.get("regime", "unknown")
    news = context.get("news", {}) or {}
    onchain = context.get("onchain", {}) or {}

    sweep_up = (_f(mf.high[i]) - res) / atr if atr > 0 else 0.0
    sweep_dn = (sup - _f(mf.low[i])) / atr if atr > 0 else 0.0

    return [
        _f(mf.trend_strength(i)),
        _f(mf.rsi[i]) / 100.0,
        _f(mf.realized_vol[i]),
        atr / close,
        _f(mf.volume[i]) / vol_sma,
        max(0.0, sweep_up),
        max(0.0, sweep_dn),
        1.0 if regime == "trend" else 0.0,
        1.0 if regime == "range" else 0.0,
        1.0 if regime == "euphoria" else 0.0,
        _f(news.get("severity")),
        _f(news.get("sentiment")),
        _f(news.get("novelty")),
        _f(onchain.get("fees_z")),
        _f(onchain.get("miner_z")),
        1.0 if sig.side == "long" else 0.0,
        _f(sig.confidence),
        1.0 if sig.strategy == "false_breakout" else 0.0,
        1.0 if sig.strategy == "trend" else 0.0,
        1.0 if sig.strategy == "news_shock" else 0.0,
    ]
