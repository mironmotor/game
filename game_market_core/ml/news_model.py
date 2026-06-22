"""Learned news-impact model (Stage 5).

Target with real ground truth: after a high-severity news event, does a
significant price move (>= ``move_threshold``) occur within the next ``K``
bars? Label comes from future returns (leakage-free — never used as a
feature). Output is a calibrated P(impact) the News Shock Engine can use to
size/gate its reactions.

Must beat a majority-class baseline out-of-sample, or it ships inert.
"""

from __future__ import annotations

import bisect
import math
import os

from config import load_config
from data.loaders.crypto_loader import load_crypto
from data.loaders.news_loader import load_news
from features.market_features import MarketFeatures
from ml.logistic import LogisticRegression, log_loss

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "news_model.json")
FEATURES = ["severity", "novelty", "sentiment", "abs_sentiment", "entity_count",
            "realized_vol", "atr_pct"]
K = 6


def _f(x):
    return 0.0 if x is None or (isinstance(x, float) and math.isnan(x)) else float(x)


def build_dataset(cfg: dict):
    candles = load_crypto(cfg)
    events = load_news(cfg, start_ts=candles[0].ts, end_ts=candles[-1].ts)
    if not events:
        return []
    sc = cfg.get("strategy", {}).get("false_breakout", {})
    mf = MarketFeatures(candles, atr_period=int(sc.get("atr_period", 14)),
                        sr_lookback=int(sc.get("sr_lookback", 48)))
    move_thr = float(cfg.get("news", {}).get("move_threshold", 0.02))
    cts = [c.ts for c in candles]
    n = len(candles)
    rows = []
    for ev in events:
        if ev.get("severity", 0.0) < 0.5:
            continue
        idx = bisect.bisect_right(cts, ev["ts"]) - 1
        if idx < 50 or idx + K >= n:
            continue
        base_close = candles[idx].close or 1.0
        maxmove = max(abs(candles[k].close - base_close) / base_close
                      for k in range(idx + 1, idx + 1 + K))
        label = 1 if maxmove >= move_thr else 0
        x = [_f(ev.get("severity")), _f(ev.get("novelty")), _f(ev.get("sentiment")),
             abs(_f(ev.get("sentiment"))), float(len(ev.get("entities", []))),
             _f(mf.realized_vol[idx]), _f(mf.atr[idx]) / base_close]
        rows.append((ev["ts"], x, label))
    rows.sort(key=lambda r: r[0])
    return rows


def train(cfg: dict | None = None) -> dict:
    cfg = cfg or load_config()
    print("== Train news-impact model ==")
    rows = build_dataset(cfg)
    print(f"High-severity events with labels: {len(rows)}")
    if len(rows) < 60:
        print("Too few labeled events (<60). Model stays inert.")
        return {"approved": False, "reason": "too_few_events"}

    cut = int(len(rows) * 0.7)
    train_rows, test_rows = rows[:cut], rows[cut:]
    model = LogisticRegression(FEATURES)
    model.fit([r[1] for r in train_rows], [r[2] for r in train_rows])

    y_test = [r[2] for r in test_rows]
    p_test = [model.predict_proba(r[1]) for r in test_rows]
    model_acc = sum(1 for yi, p in zip(y_test, p_test) if (p >= 0.5) == bool(yi)) / len(y_test)
    pos_rate = sum(y_test) / len(y_test)
    majority_acc = max(pos_rate, 1 - pos_rate)
    model_ll = log_loss(y_test, p_test)

    approved = model_acc > majority_acc + 0.02
    model.approved = approved
    model.meta = {"oos_acc": model_acc, "majority_acc": majority_acc,
                  "oos_logloss": model_ll, "pos_rate": pos_rate, "K": K}
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    model.save(MODEL_PATH)

    print(f"OOS accuracy: model {model_acc:.1%} vs majority baseline {majority_acc:.1%} "
          f"(impact base rate {pos_rate:.1%}, logloss {model_ll:.3f})")
    print("VERDICT:", "APPROVED — beats majority OOS." if approved
          else "REJECTED — no edge over majority. Saved INERT.")
    print(f"Saved to: {MODEL_PATH}")
    return model.meta | {"approved": approved}


def load_model() -> LogisticRegression | None:
    return LogisticRegression.load(MODEL_PATH) if os.path.exists(MODEL_PATH) else None
