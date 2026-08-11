"""Scam / self-deception detector.

Before believing ANY result — especially one approaching the 100-300%/mo
target — run these checks. They look for the classic ways a backtest lies:
too few trades, missing costs, impossible Sharpe/winrate, and "too good to
be true" monthly returns. Each flag includes a severity so the report can
refuse to endorse a result that lights up the red ones.
"""

from __future__ import annotations


def detect(metrics: dict, cfg: dict) -> list[dict]:
    sc = cfg.get("scam_detector", {})
    costs = cfg.get("costs", {})
    min_trades = int(sc.get("min_trades", 30))
    suspicious_monthly = float(sc.get("suspicious_monthly_romi", 50))
    max_sharpe = float(sc.get("max_plausible_sharpe", 4.0))
    max_winrate = float(sc.get("max_plausible_winrate", 0.80))

    flags: list[dict] = []

    def flag(sev, code, msg):
        flags.append({"severity": sev, "code": code, "message": msg})

    if metrics["num_trades"] < min_trades:
        flag("high", "too_few_trades",
             f"Only {metrics['num_trades']} trades (< {min_trades}). "
             "Not enough to claim a statistical edge.")

    if metrics["avg_monthly_romi_pct"] > suspicious_monthly:
        flag("high", "implausible_romi",
             f"Avg monthly ROMI {metrics['avg_monthly_romi_pct']:.1f}% exceeds "
             f"{suspicious_monthly:.0f}%/mo. Treat as overfit/leak until proven "
             "out-of-sample + walk-forward + paper.")

    if metrics["sharpe"] > max_sharpe:
        flag("high", "implausible_sharpe",
             f"Sharpe {metrics['sharpe']:.2f} > {max_sharpe:.1f}. Real strategies "
             "rarely sustain this; suspect leakage or unrealistic fills.")

    if metrics["winrate"] > max_winrate and metrics["num_trades"] >= 20:
        flag("medium", "implausible_winrate",
             f"Win rate {metrics['winrate']:.0%} > {max_winrate:.0%}. Check for "
             "look-ahead and survivorship bias.")

    if float(costs.get("taker_fee", 0)) <= 0 and float(costs.get("slippage_bps", 0)) <= 0:
        flag("high", "no_costs",
             "Fees and slippage are both zero — frictionless backtests are fiction.")

    if metrics["max_drawdown_pct"] < 1.0 and metrics["total_return_pct"] > 50:
        flag("high", "too_smooth",
             f"Large return ({metrics['total_return_pct']:.0f}%) with < 1% drawdown "
             "is a hallmark of leakage.")

    if metrics["prob_large_drawdown"] > 0.20:
        flag("medium", "fragile_path",
             f"Monte Carlo: {metrics['prob_large_drawdown']:.0%} chance of a >50% "
             "drawdown under reshuffling. Edge is fragile / under-diversified.")

    if not flags:
        flag("info", "clean",
             "No scam flags raised. Still requires out-of-sample + walk-forward "
             "+ paper trading before any live capital.")
    return flags
