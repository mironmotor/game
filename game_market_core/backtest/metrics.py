"""Performance metrics — computed from the trade list and equity curve.

Reports the full honest panel: returns, monthly ROMI distribution, max
drawdown, Sharpe, Sortino, profit factor, win rate, average R, expectancy,
trade count, exposure, and (via monte_carlo) probability of large drawdown.
"""

from __future__ import annotations

import math
import time

from backtest.engine import BacktestResult
from backtest.monte_carlo import probability_of_ruin


def _ym(ts: int) -> tuple[int, int]:
    t = time.gmtime(ts)
    return t.tm_year, t.tm_mon


def monthly_returns(equity_curve, start_equity) -> list[float]:
    """Month-over-month % returns derived from the equity curve."""
    if not equity_curve:
        return []
    last_by_month: dict[tuple[int, int], float] = {}
    order: list[tuple[int, int]] = []
    for ts, eq in equity_curve:
        key = _ym(ts)
        if key not in last_by_month:
            order.append(key)
        last_by_month[key] = eq

    out: list[float] = []
    prev = start_equity
    for key in order:
        eq = last_by_month[key]
        if prev > 0:
            out.append((eq / prev - 1.0) * 100.0)
        prev = eq
    return out


def _stats(values: list[float]) -> dict:
    if not values:
        return {"min": 0.0, "median": 0.0, "mean": 0.0, "max": 0.0}
    s = sorted(values)
    mid = len(s) // 2
    median = s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2
    return {"min": s[0], "median": median, "mean": sum(s) / len(s), "max": s[-1]}


def compute_metrics(res: BacktestResult) -> dict:
    trades = res.trades
    curve = res.equity_curve
    start, end = res.start_equity, res.end_equity

    total_return = (end / start - 1.0) * 100.0 if start > 0 else 0.0

    # Bar-to-bar returns for risk ratios.
    bar_rets: list[float] = []
    for k in range(1, len(curve)):
        prev = curve[k - 1][1]
        if prev > 0:
            bar_rets.append(curve[k][1] / prev - 1.0)

    periods_per_year = (365 * 24 * 3600) / res.bar_seconds if res.bar_seconds else 8760
    sharpe = sortino = 0.0
    if len(bar_rets) > 1:
        mean = sum(bar_rets) / len(bar_rets)
        var = sum((r - mean) ** 2 for r in bar_rets) / len(bar_rets)
        std = math.sqrt(var)
        if std > 0:
            sharpe = (mean / std) * math.sqrt(periods_per_year)
        downside = [r for r in bar_rets if r < 0]
        if downside:
            dvar = sum(r * r for r in downside) / len(downside)
            dstd = math.sqrt(dvar)
            if dstd > 0:
                sortino = (mean / dstd) * math.sqrt(periods_per_year)

    # Max drawdown from the equity curve.
    peak = -float("inf")
    max_dd = 0.0
    for _, eq in curve:
        peak = max(peak, eq)
        if peak > 0:
            max_dd = max(max_dd, (peak - eq) / peak)

    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]
    gross_win = sum(t.pnl for t in wins)
    gross_loss = -sum(t.pnl for t in losses)
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else float("inf") if gross_win > 0 else 0.0
    winrate = (len(wins) / len(trades)) if trades else 0.0
    avg_r = (sum(t.r_multiple for t in trades) / len(trades)) if trades else 0.0
    expectancy = avg_r  # expected R per trade

    bars_in_market = sum(t.duration_bars for t in trades)
    exposure = bars_in_market / len(curve) if curve else 0.0

    mret = monthly_returns(curve, start)
    months = max(1, len(mret))
    avg_monthly = ((end / start) ** (1 / months) - 1.0) * 100.0 if start > 0 else 0.0

    p_ruin = probability_of_ruin(trades, start)

    return {
        "start_equity": start,
        "end_equity": end,
        "total_return_pct": total_return,
        "months": len(mret),
        "avg_monthly_romi_pct": avg_monthly,
        "monthly_romi_stats": _stats(mret),
        "monthly_romi_series": mret,
        "max_drawdown_pct": max_dd * 100.0,
        "sharpe": sharpe,
        "sortino": sortino,
        "profit_factor": profit_factor,
        "winrate": winrate,
        "num_trades": len(trades),
        "avg_r": avg_r,
        "expectancy_r": expectancy,
        "exposure": exposure,
        "prob_large_drawdown": p_ruin,
        "kill_tripped": res.kill_tripped,
        "kill_reason": res.kill_reason,
        "risk_mode": res.risk_mode,
        "allow_live": res.allow_live,
    }
