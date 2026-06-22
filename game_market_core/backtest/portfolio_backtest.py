"""Multi-symbol portfolio backtest (Stage 6).

Runs the full engine independently per symbol with an equal slice of capital,
then combines the per-symbol equity curves into one portfolio curve (aligned
by timestamp, forward-filled) and computes portfolio-level metrics. This
surfaces the one thing single-symbol tests hide: diversification — the
portfolio's max drawdown is usually smaller than the average of its parts.

Offline, symbols are distinct deterministic synthetic series (seed varied per
symbol). With data.source: exchange, each symbol is fetched for real.
"""

from __future__ import annotations

import copy

from datatypes import Candle
from data.loaders.crypto_loader import load_crypto, generate_synthetic
from features.market_features import MarketFeatures
from strategies.meta_controller import MetaController
from risk.risk_engine import RiskEngine
from backtest.engine import run_backtest, BacktestResult
from backtest.metrics import compute_metrics
from ml.regime_classifier import classify_series


def _load_symbol(cfg: dict, symbol: str, idx: int) -> list[Candle]:
    c = copy.deepcopy(cfg)
    c.setdefault("data", {})["symbol"] = symbol
    if c["data"].get("source", "synthetic") == "synthetic":
        # Distinct series per symbol so the portfolio isn't one asset cloned.
        return generate_synthetic(
            bars=int(c["data"].get("bars", 26280)),
            seed=int(c["data"].get("seed", 17)) + 1000 * (idx + 1),
            start_price=float(c["data"].get("start_price", 20000.0)) * (1 + 0.1 * idx),
        )
    return load_crypto(c)


def run_portfolio(cfg: dict) -> dict:
    symbols = cfg.get("portfolio", {}).get("symbols") or [cfg["data"]["symbol"]]
    total_equity = float(cfg.get("risk", {}).get("start_equity", 10000.0))
    per_symbol_equity = total_equity / len(symbols)

    sc = cfg.get("strategy", {}).get("false_breakout", {})
    per_results = []
    curves: list[dict] = []   # per-symbol {ts: equity}
    all_trades = []

    for idx, sym in enumerate(symbols):
        c = copy.deepcopy(cfg)
        c.setdefault("risk", {})["start_equity"] = per_symbol_equity
        candles = _load_symbol(c, sym, idx)
        mf = MarketFeatures(candles, atr_period=int(sc.get("atr_period", 14)),
                            sr_lookback=int(sc.get("sr_lookback", 48)))
        regimes = classify_series(mf, c)
        res = run_backtest(candles, mf, MetaController(c), RiskEngine(c), c, regimes=regimes)
        m = compute_metrics(res)
        per_results.append((sym, m))
        curves.append(dict(res.equity_curve))
        for t in res.trades:
            all_trades.append(t)

    # Build the union timeline and sum forward-filled per-symbol equity.
    all_ts = sorted({ts for cv in curves for ts in cv})
    last = [per_symbol_equity] * len(symbols)
    combined: list[tuple[int, float]] = []
    for ts in all_ts:
        total = 0.0
        for j, cv in enumerate(curves):
            if ts in cv:
                last[j] = cv[ts]
            total += last[j]
        combined.append((ts, total))

    end_equity = combined[-1][1] if combined else total_equity
    bar_seconds = (all_ts[1] - all_ts[0]) if len(all_ts) > 1 else 3600
    port_result = BacktestResult(
        trades=all_trades, equity_curve=combined, start_equity=total_equity,
        end_equity=end_equity, bar_seconds=bar_seconds, kill_tripped=False,
        kill_reason="", risk_mode=cfg.get("risk", {}).get("mode", "balanced"),
        allow_live=False, decision_log=[],
    )
    port_metrics = compute_metrics(port_result)

    avg_symbol_dd = sum(m["max_drawdown_pct"] for _, m in per_results) / len(per_results)
    return {
        "symbols": symbols,
        "portfolio": port_metrics,
        "per_symbol": [(s, m["total_return_pct"], m["max_drawdown_pct"], m["num_trades"])
                       for s, m in per_results],
        "avg_symbol_max_dd": avg_symbol_dd,
        "diversification_gain": avg_symbol_dd - port_metrics["max_drawdown_pct"],
    }
