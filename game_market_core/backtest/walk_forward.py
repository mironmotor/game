"""Walk-forward validation (Stage 2).

The antidote to in-sample self-deception. For each fold we:
  1. pick the best False Breakout params on a TRAIN window (grid search),
  2. evaluate ONLY on the following, untouched TEST window,
  3. chain the test returns into one out-of-sample (OOS) track.

Because the train window always precedes its test window in time and all
features use trailing data, this is leakage-free. A strategy that looks great
in-sample but collapses OOS is exactly what this is built to expose — and
that gap is reported, not hidden.
"""

from __future__ import annotations

import copy

from features.market_features import MarketFeatures
from strategies.meta_controller import MetaController
from risk.risk_engine import RiskEngine
from backtest.engine import run_backtest
from ml.regime_classifier import classify_series

_DEFAULT_GRID = [
    {"atr_penetration": p, "reward_risk": rr}
    for p in (0.5, 0.75, 1.0)
    for rr in (1.5, 2.0, 2.5)
]


def _with_params(cfg: dict, params: dict, start_equity: float) -> dict:
    c = copy.deepcopy(cfg)
    c.setdefault("strategy", {}).setdefault("false_breakout", {}).update(params)
    c.setdefault("risk", {})["start_equity"] = start_equity
    return c


def _trade_stats(trades) -> dict:
    if not trades:
        return {"n": 0, "winrate": 0.0, "avg_r": 0.0, "profit_factor": 0.0}
    wins = [t for t in trades if t.pnl > 0]
    gl = -sum(t.pnl for t in trades if t.pnl <= 0)
    gw = sum(t.pnl for t in wins)
    pf = (gw / gl) if gl > 0 else (float("inf") if gw > 0 else 0.0)
    return {
        "n": len(trades),
        "winrate": len(wins) / len(trades),
        "avg_r": sum(t.r_multiple for t in trades) / len(trades),
        "profit_factor": pf,
    }


def walk_forward(candles, cfg: dict, n_folds: int = 5, grid=None) -> dict:
    grid = grid or _DEFAULT_GRID
    strat_cfg = cfg.get("strategy", {}).get("false_breakout", {})
    mf = MarketFeatures(
        candles,
        atr_period=int(strat_cfg.get("atr_period", 14)),
        sr_lookback=int(strat_cfg.get("sr_lookback", 48)),
    )
    regimes = classify_series(mf, cfg)
    n = len(candles)
    warmup = max(mf.sr_lookback, 50)
    usable = n - warmup
    fold = usable // (n_folds + 1)
    if fold < 50:
        return {"error": "not enough data for walk-forward", "bars": n}

    base_equity = float(cfg.get("risk", {}).get("start_equity", 10000.0))
    oos_equity = base_equity
    oos_trades = []
    folds_out = []

    for k in range(n_folds):
        train_window = (warmup, warmup + fold * (k + 1))
        test_window = (train_window[1], train_window[1] + fold)
        if test_window[1] > n:
            break

        # 1) In-sample grid search.
        best = None
        for params in grid:
            c = _with_params(cfg, params, base_equity)
            res = run_backtest(candles, mf, MetaController(c), RiskEngine(c), c,
                               regimes=regimes, trade_window=train_window)
            n_tr = len(res.trades)
            score = (res.end_equity / res.start_equity - 1.0)
            if n_tr < 5:
                score -= 1.0  # penalize too-few-trades fits
            if best is None or score > best[0]:
                best = (score, params)
        best_params = best[1]

        # 2) Out-of-sample evaluation with the chosen params.
        c = _with_params(cfg, best_params, oos_equity)
        res_test = run_backtest(candles, mf, MetaController(c), RiskEngine(c), c,
                                regimes=regimes, trade_window=test_window)
        fold_ret = res_test.end_equity / res_test.start_equity - 1.0
        oos_equity = res_test.end_equity
        oos_trades.extend(res_test.trades)

        folds_out.append({
            "fold": k + 1,
            "train_bars": train_window,
            "test_bars": test_window,
            "best_params": best_params,
            "is_train_score_pct": round(best[0] * 100, 2),
            "oos_return_pct": round(fold_ret * 100, 2),
            "oos_trades": len(res_test.trades),
        })

    oos_total = (oos_equity / base_equity - 1.0) * 100.0
    return {
        "n_folds": len(folds_out),
        "oos_total_return_pct": round(oos_total, 2),
        "oos_end_equity": round(oos_equity, 2),
        "oos_trade_stats": _trade_stats(oos_trades),
        "folds": folds_out,
    }
