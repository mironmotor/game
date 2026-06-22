"""Training pipeline for the trade filter (Stage 4).

Pipeline:
  1. Run a backtest to collect every executed signal's feature snapshot and
     its realized outcome (label = profitable?).
  2. Time-split the trades (no shuffling): first 60% train, last 40% test.
  3. Train the logistic trade filter on TRAIN; tune the decision threshold on
     TRAIN only (no peeking at TEST).
  4. GATE on TEST: the model is ``approved`` only if filtering improves
     out-of-sample expectancy (mean R) versus taking every signal, while still
     taking enough trades. Otherwise it ships inert.
  5. Persist the model to ml/models/trade_filter.json.

This is deliberately strict: ML here must EARN the right to veto trades by
proving it out-of-sample, or it does nothing.
"""

from __future__ import annotations

import os

from config import load_config
from data.loaders.crypto_loader import load_crypto
from data.loaders.macro_loader import load_macro
from data.loaders.news_loader import load_news
from features.market_features import MarketFeatures
from features.macro_features import MacroContext
from features.news_features import NewsContext
from strategies.meta_controller import MetaController
from risk.risk_engine import RiskEngine
from backtest.engine import run_backtest
from ml.regime_classifier import classify_series
from ml.feature_vector import FEATURE_NAMES
from ml.trade_filter_model import TradeFilterModel

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "trade_filter.json")


def _collect_trades(cfg: dict):
    candles = load_crypto(cfg)
    sc = cfg.get("strategy", {}).get("false_breakout", {})
    mf = MarketFeatures(candles, atr_period=int(sc.get("atr_period", 14)),
                        sr_lookback=int(sc.get("sr_lookback", 48)))
    regimes = classify_series(mf, cfg)
    macro_series = load_macro(cfg)
    macro = MacroContext(macro_series) if macro_series else None
    events = load_news(cfg, start_ts=candles[0].ts, end_ts=candles[-1].ts)
    news_ctx = NewsContext(events) if events else None
    res = run_backtest(candles, mf, MetaController(cfg), RiskEngine(cfg), cfg,
                       regimes=regimes, macro=macro, news=news_ctx)
    return [t for t in res.trades if t.features]


def _expectancy(trades) -> float:
    return sum(t.r_multiple for t in trades) / len(trades) if trades else 0.0


def _best_threshold(model, train) -> tuple[float, float]:
    best = (0.5, -1e9)
    for thr in (0.40, 0.45, 0.50, 0.55, 0.60, 0.65):
        taken = [t for t in train if model.predict_proba(t.features) >= thr]
        if len(taken) < max(10, len(train) // 10):
            continue
        exp = _expectancy(taken)
        if exp > best[1]:
            best = (thr, exp)
    return best


def train(cfg: dict | None = None) -> dict:
    cfg = cfg or load_config()
    print("== GAME MARKET CORE — Train trade filter (Stage 4) ==")
    trades = _collect_trades(cfg)
    trades.sort(key=lambda t: t.entry_ts)
    print(f"Collected {len(trades)} labeled trades.")
    if len(trades) < 40:
        print("Too few trades to train a credible filter (<40). Aborting; model stays inert.")
        return {"approved": False, "reason": "too_few_trades", "n": len(trades)}

    cut = int(len(trades) * 0.6)
    train_set, test_set = trades[:cut], trades[cut:]
    X = [t.features for t in train_set]
    y = [1 if t.pnl > 0 else 0 for t in train_set]

    model = TradeFilterModel(FEATURE_NAMES)
    model.fit(X, y)
    thr, train_exp = _best_threshold(model, train_set)
    model.threshold = thr

    base_exp = _expectancy(test_set)
    taken = [t for t in test_set if model.predict_proba(t.features) >= thr]
    filt_exp = _expectancy(taken)
    acc = sum(1 for t in test_set if (model.predict_proba(t.features) >= 0.5) == (t.pnl > 0)) / len(test_set)

    approved = filt_exp > base_exp and len(taken) >= max(15, len(test_set) // 5)
    model.approved = approved

    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    model.save(MODEL_PATH)

    print(f"\nThreshold (tuned on train): {thr:.2f}")
    print(f"OOS take-all expectancy:   {base_exp:+.3f} R over {len(test_set)} trades")
    print(f"OOS filtered expectancy:   {filt_exp:+.3f} R over {len(taken)} trades")
    print(f"OOS direction accuracy:    {acc:.1%}")
    if approved:
        print("VERDICT: APPROVED — filter improves OOS expectancy. It will now veto "
              "low-probability signals when run with --ml.")
    else:
        print("VERDICT: REJECTED — filter does NOT beat take-all out-of-sample. "
              "Saved as INERT (will not veto). This is the honest, common outcome.")
    print(f"Model saved to: {MODEL_PATH}")
    return {"approved": approved, "threshold": thr, "oos_baseline_r": base_exp,
            "oos_filtered_r": filt_exp, "oos_accuracy": acc,
            "n_train": len(train_set), "n_test": len(test_set), "n_taken": len(taken)}


def load_model() -> TradeFilterModel | None:
    if os.path.exists(MODEL_PATH):
        return TradeFilterModel.load(MODEL_PATH)
    return None
