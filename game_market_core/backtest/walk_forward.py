"""Walk-forward validation (Stage 2, hardened in Stage 7 against fragility).

The antidote to in-sample self-deception. For each fold we:
  1. rank a small param grid on a TRAIN window,
  2. evaluate ONLY on the following, untouched TEST window,
  3. chain the test results into one out-of-sample (OOS) track.

Two anti-overfit hardenings (this is what shrinks the IS >> OOS gap):
  * Selection by EXPECTANCY (avg R per trade), not total return. Total return
    rewards whichever params happened to catch the biggest in-sample trend — a
    classic overfit. Avg R is far more stable across regimes.
  * TOP-K ENSEMBLE: instead of betting the fold on the single best param set,
    average the OOS of the top-K params. One lucky in-sample peak can't carry
    the result.
  * EMBARGO gap between train and test, so the test window doesn't start on
    bars adjacent to (and correlated with) the training data.

It reports OOS efficiency (mean OOS / mean IS): closer to 1 = the edge
generalizes; near 0 (or negative) = in-sample mirage.
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
_TOP_K = 3


def _with_params(cfg: dict, params: dict, start_equity: float) -> dict:
    c = copy.deepcopy(cfg)
    c.setdefault("strategy", {}).setdefault("false_breakout", {}).update(params)
    c.setdefault("risk", {})["start_equity"] = start_equity
    return c


def _avg_r(trades) -> float:
    return sum(t.r_multiple for t in trades) / len(trades) if trades else 0.0


def _trade_stats(trades) -> dict:
    if not trades:
        return {"n": 0, "winrate": 0.0, "avg_r": 0.0, "profit_factor": 0.0}
    wins = [t for t in trades if t.pnl > 0]
    gl = -sum(t.pnl for t in trades if t.pnl <= 0)
    gw = sum(t.pnl for t in wins)
    pf = (gw / gl) if gl > 0 else (float("inf") if gw > 0 else 0.0)
    return {"n": len(trades), "winrate": len(wins) / len(trades),
            "avg_r": _avg_r(trades), "profit_factor": pf}


def _run(cfg, mf, regimes, params, window, start_equity):
    c = _with_params(cfg, params, start_equity)
    return run_backtest(candles_of(mf), mf, MetaController(c), RiskEngine(c), c,
                        regimes=regimes, trade_window=window)


def candles_of(mf):
    return mf.candles


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
    embargo = max(1, fold // 20)   # gap between train and test windows

    base_equity = float(cfg.get("risk", {}).get("start_equity", 10000.0))
    oos_equity = base_equity
    oos_trades = []
    folds_out = []
    is_returns_all, oos_returns_all = [], []

    for k in range(n_folds):
        train_window = (warmup, warmup + fold * (k + 1))
        test_start = train_window[1] + embargo
        test_window = (test_start, test_start + fold)
        if test_window[1] > n:
            break

        # 1) Rank the grid on TRAIN by expectancy (avg R), not total return.
        ranked = []
        for params in grid:
            res = _run(cfg, mf, regimes, params, train_window, base_equity)
            stats = _trade_stats(res.trades)
            is_ret = (res.end_equity / res.start_equity - 1.0) * 100.0
            score = stats["avg_r"] if stats["n"] >= 5 else -9.9
            ranked.append((score, is_ret, params))
        ranked.sort(key=lambda x: x[0], reverse=True)
        top = ranked[:_TOP_K]

        # 2) OOS = average of the top-K params on the untouched TEST window.
        fold_oos, fold_is = [], []
        oos_trades_fold = []
        for _, is_ret, params in top:
            res = _run(cfg, mf, regimes, params, test_window, oos_equity)
            fold_oos.append((res.end_equity / res.start_equity - 1.0) * 100.0)
            fold_is.append(is_ret)
            oos_trades_fold.extend(res.trades)
        mean_oos = sum(fold_oos) / len(fold_oos)
        mean_is = sum(fold_is) / len(fold_is)
        oos_equity *= (1.0 + mean_oos / 100.0)
        oos_trades.extend(oos_trades_fold)
        is_returns_all.append(mean_is)
        oos_returns_all.append(mean_oos)

        folds_out.append({
            "fold": k + 1, "train_bars": train_window, "test_bars": test_window,
            "best_params": top[0][2], "is_train_score_pct": round(mean_is, 2),
            "oos_return_pct": round(mean_oos, 2),
            "oos_trades": len(oos_trades_fold) // _TOP_K,
        })

    oos_total = (oos_equity / base_equity - 1.0) * 100.0
    mean_is = sum(is_returns_all) / len(is_returns_all) if is_returns_all else 0.0
    mean_oos = sum(oos_returns_all) / len(oos_returns_all) if oos_returns_all else 0.0
    efficiency = (mean_oos / mean_is) if mean_is > 0 else (1.0 if mean_oos > 0 else 0.0)
    return {
        "n_folds": len(folds_out),
        "oos_total_return_pct": round(oos_total, 2),
        "oos_end_equity": round(oos_equity, 2),
        "oos_trade_stats": _trade_stats(oos_trades),
        "mean_is_pct": round(mean_is, 2),
        "mean_oos_pct": round(mean_oos, 2),
        "oos_efficiency": round(efficiency, 2),
        "embargo_bars": embargo,
        "top_k": _TOP_K,
        "folds": folds_out,
    }
