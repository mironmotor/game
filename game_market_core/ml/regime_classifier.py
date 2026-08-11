"""Regime classifier — baseline rule set (Stage 2).

Labels each bar as one of: trend, euphoria, crisis, range, unknown — using
only trailing information (realized volatility vs its own running average,
and ATR-normalized trend strength). This transparent baseline is the gate
the Meta Controller uses to enable/disable engines. A learned classifier
(logistic regression / gradient boosting) can replace it later and must beat
this baseline out-of-sample before being trusted.

Regime logic at bar i (vol_rel = realized_vol / running-avg realized_vol):
  crisis    : vol_rel high AND trend down hard   (risk-off, fast drawdowns)
  euphoria  : vol_rel high AND trend up hard      (blow-off / momentum)
  trend     : |trend_strength| above threshold    (directional, normal vol)
  range     : otherwise
  unknown   : features not warmed up yet
"""

from __future__ import annotations

import math


def classify_series(mf, cfg: dict | None = None) -> list[str]:
    cfg = cfg or {}
    rc = cfg.get("regime", {}) if isinstance(cfg, dict) else {}
    trend_thresh = float(rc.get("trend_strength_threshold", 0.5))
    vol_hot = float(rc.get("vol_hot_multiple", 1.8))
    warmup = max(mf.sr_lookback, 50)

    n = len(mf.candles)
    out = ["unknown"] * n
    run_sum = 0.0
    run_cnt = 0

    for i in range(n):
        rv = mf.realized_vol[i]
        if not math.isnan(rv):
            run_sum += rv
            run_cnt += 1
        if i < warmup or run_cnt < 20 or math.isnan(rv):
            continue

        avg_rv = run_sum / run_cnt
        vol_rel = rv / avg_rv if avg_rv > 0 else 1.0
        ts = mf.trend_strength(i)

        if vol_rel >= vol_hot and ts < -trend_thresh:
            out[i] = "crisis"
        elif vol_rel >= vol_hot and ts > trend_thresh:
            out[i] = "euphoria"
        elif abs(ts) >= trend_thresh:
            out[i] = "trend"
        else:
            out[i] = "range"
    return out


def classify_regime(features: dict | None = None) -> str:
    """Single-feature helper (kept for callers that pass a feature dict)."""
    return "unknown"
