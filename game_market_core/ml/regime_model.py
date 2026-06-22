"""Learned regime model (Stage 5) — volatility-regime forecaster.

It does NOT learn to mimic the rule classifier (that would be circular).
It forecasts a real, future-derived target: will the NEXT ``horizon`` bars be
MORE volatile than the recent trailing average? Ground truth comes from
future realized volatility; the trailing baseline is computed from the past
only, so the dataset is leakage-free.

It must beat a persistence baseline ("recent above-average vol persists")
out-of-sample, or it ships inert — same discipline as the trade filter.
"""

from __future__ import annotations

import math
import os

from config import load_config
from data.loaders.crypto_loader import load_crypto
from features.market_features import MarketFeatures
from ml.logistic import LogisticRegression, log_loss

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "regime_model.json")
FEATURES = ["trend_strength", "rsi", "realized_vol", "atr_pct", "vol_ratio", "vol_rel"]
HORIZON = 12


def build_dataset(cfg: dict):
    candles = load_crypto(cfg)
    sc = cfg.get("strategy", {}).get("false_breakout", {})
    mf = MarketFeatures(candles, atr_period=int(sc.get("atr_period", 14)),
                        sr_lookback=int(sc.get("sr_lookback", 48)))
    n = len(candles)
    warmup = max(mf.sr_lookback, 50)

    # Trailing (past-only) running mean of realized vol -> the baseline level.
    base = [float("nan")] * n
    run_sum = 0.0
    run_cnt = 0
    for i in range(n):
        rv = mf.realized_vol[i]
        if not math.isnan(rv):
            run_sum += rv
            run_cnt += 1
        if run_cnt >= 20 and not math.isnan(rv):
            base[i] = run_sum / run_cnt

    rows = []
    for i in range(warmup, n - HORIZON - 1):
        rv = mf.realized_vol[i]
        b = base[i]
        if math.isnan(rv) or math.isnan(b) or b <= 0:
            continue
        future = [mf.realized_vol[k] for k in range(i + 1, i + 1 + HORIZON)
                  if not math.isnan(mf.realized_vol[k])]
        if not future:
            continue
        label = 1 if (sum(future) / len(future)) > b else 0
        close = mf.close[i] or 1.0
        x = [_f(mf.trend_strength(i)), _f(mf.rsi[i]) / 100.0, rv,
             _f(mf.atr[i]) / close, _f(mf.volume[i]) / (_f(mf.vol_sma[i]) or 1.0), rv / b]
        persistence = 1 if rv > b else 0
        rows.append((candles[i].ts, x, label, persistence))
    return rows


def _f(x):
    return 0.0 if x is None or (isinstance(x, float) and math.isnan(x)) else float(x)


def train(cfg: dict | None = None) -> dict:
    cfg = cfg or load_config()
    print("== Train regime model (volatility-regime forecaster) ==")
    rows = build_dataset(cfg)
    print(f"Dataset rows: {len(rows)}")
    if len(rows) < 200:
        print("Too few rows (<200). Model stays inert.")
        return {"approved": False, "reason": "too_few_rows"}

    cut = int(len(rows) * 0.7)
    train_rows, test_rows = rows[:cut], rows[cut:]
    model = LogisticRegression(FEATURES)
    model.fit([r[1] for r in train_rows], [r[2] for r in train_rows])

    y_test = [r[2] for r in test_rows]
    p_test = [model.predict_proba(r[1]) for r in test_rows]
    model_acc = sum(1 for r, p in zip(test_rows, p_test) if (p >= 0.5) == bool(r[2])) / len(test_rows)
    base_acc = sum(1 for r in test_rows if r[3] == r[2]) / len(test_rows)
    model_ll = log_loss(y_test, p_test)

    approved = model_acc > base_acc + 0.01
    model.approved = approved
    model.meta = {"oos_acc": model_acc, "baseline_acc": base_acc,
                  "oos_logloss": model_ll, "horizon": HORIZON}
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    model.save(MODEL_PATH)

    print(f"OOS accuracy: model {model_acc:.1%} vs persistence baseline {base_acc:.1%} "
          f"(logloss {model_ll:.3f})")
    print("VERDICT:", "APPROVED — beats persistence OOS." if approved
          else "REJECTED — no edge over persistence. Saved INERT.")
    print(f"Saved to: {MODEL_PATH}")
    return model.meta | {"approved": approved}


def load_model() -> LogisticRegression | None:
    return LogisticRegression.load(MODEL_PATH) if os.path.exists(MODEL_PATH) else None
