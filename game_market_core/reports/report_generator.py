"""Markdown report generator.

Produces the honest verdict the project is built around: it states the
measured monthly ROMI, compares it to the user's 100-300%/mo target, lists
every scam flag, and gives a realistic expectation range with the caveats
that still stand (out-of-sample, walk-forward, paper trading).
"""

from __future__ import annotations

import os
import time


def _fmt_pf(pf: float) -> str:
    return "inf" if pf == float("inf") else f"{pf:.2f}"


def _verdict(metrics: dict, cfg: dict, flags: list[dict]) -> str:
    target_low = cfg.get("project", {}).get("romi_target_monthly_low", 100)
    target_high = cfg.get("project", {}).get("romi_target_monthly_high", 300)
    avg = metrics["avg_monthly_romi_pct"]
    high_flags = [f for f in flags if f["severity"] == "high"]

    lines = []
    lines.append(f"**Target:** {target_low}-{target_high}% ROMI per month.")
    lines.append(f"**Measured (in-sample, after costs):** {avg:.2f}% per month "
                 f"over {metrics['months']} month(s), {metrics['num_trades']} trades.")

    if high_flags:
        lines.append("")
        lines.append("**Verdict: NOT credible as shown.** High-severity integrity "
                     "flags were raised (see below). No claim about reaching the "
                     "target can be made until they are resolved.")
    elif avg >= target_low:
        lines.append("")
        lines.append("**Verdict: target numerically reached IN-SAMPLE — treat with "
                     "extreme suspicion.** A single in-sample backtest hitting "
                     f"{target_low}%+/mo is far more likely to be overfitting than a "
                     "real edge. It is meaningless until it survives out-of-sample, "
                     "walk-forward, and paper trading.")
    else:
        lines.append("")
        lines.append("**Verdict: target NOT reached at safe risk — this is the "
                     "expected, honest outcome.** Sustained 100-300%/mo at "
                     "controlled drawdown is not a realistic objective for capital "
                     "you cannot afford to lose.")

    lines.append("")
    lines.append("**Realistic expectation (framing, not a promise):** a genuinely "
                 "validated crypto edge typically lands in the low-single-digits to "
                 "low-tens of percent per month BEFORE the inevitable degradation "
                 "from competition, regime shift, and capacity limits — with real "
                 "drawdowns. Anything advertising 100-300%/mo persistently is either "
                 "taking ruinous leverage, mismeasuring, or lying.")
    return "\n".join(lines)


def generate_report(metrics: dict, flags: list[dict], cfg: dict, result) -> str:
    out_dir = cfg.get("report", {}).get("out_dir", "reports/output")
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if not os.path.isabs(out_dir):
        out_dir = os.path.join(root, out_dir)
    os.makedirs(out_dir, exist_ok=True)

    stamp = time.strftime("%Y%m%d_%H%M%S", time.gmtime())
    path = os.path.join(out_dir, f"report_{stamp}.md")

    mstats = metrics["monthly_romi_stats"]
    md = []
    md.append("# GAME MARKET CORE — Backtest Report")
    md.append("")
    md.append(f"Generated: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}  ")
    md.append(f"Strategy: False Breakout Engine | Risk mode: **{metrics['risk_mode']}** | "
              f"Live trading allowed: **{metrics['allow_live']}**")
    md.append("")
    md.append("> Stage 1 runs on deterministic SYNTHETIC data. These numbers test "
              "the *plumbing and discipline* of the system, not a real edge. Real "
              "data, out-of-sample, walk-forward, and paper trading come in later "
              "stages before any live capital.")
    md.append("")

    md.append("## Verdict on the 100-300% ROMI target")
    md.append("")
    md.append(_verdict(metrics, cfg, flags))
    md.append("")

    md.append("## Headline metrics")
    md.append("")
    md.append("| Metric | Value |")
    md.append("|---|---|")
    md.append(f"| Start equity | ${metrics['start_equity']:,.2f} |")
    md.append(f"| End equity | ${metrics['end_equity']:,.2f} |")
    md.append(f"| Total return | {metrics['total_return_pct']:.2f}% |")
    md.append(f"| Avg monthly ROMI | {metrics['avg_monthly_romi_pct']:.2f}% |")
    md.append(f"| Months covered | {metrics['months']} |")
    md.append(f"| Trades | {metrics['num_trades']} |")
    md.append(f"| Win rate | {metrics['winrate']:.1%} |")
    md.append(f"| Avg R / expectancy | {metrics['avg_r']:.3f} R |")
    md.append(f"| Profit factor | {_fmt_pf(metrics['profit_factor'])} |")
    md.append(f"| Max drawdown | {metrics['max_drawdown_pct']:.2f}% |")
    md.append(f"| Sharpe (annualized) | {metrics['sharpe']:.2f} |")
    md.append(f"| Sortino (annualized) | {metrics['sortino']:.2f} |")
    md.append(f"| Market exposure | {metrics['exposure']:.1%} |")
    md.append(f"| P(>50% drawdown), Monte Carlo | {metrics['prob_large_drawdown']:.1%} |")
    md.append(f"| Kill switch tripped | {metrics['kill_tripped']} {('— ' + metrics['kill_reason']) if metrics['kill_tripped'] else ''} |")
    md.append("")

    md.append("## Monthly ROMI distribution")
    md.append("")
    md.append(f"min **{mstats['min']:.2f}%** | median **{mstats['median']:.2f}%** | "
              f"mean **{mstats['mean']:.2f}%** | max **{mstats['max']:.2f}%**")
    md.append("")

    md.append("## Integrity checks (scam detector)")
    md.append("")
    md.append("| Severity | Code | Finding |")
    md.append("|---|---|---|")
    for f in flags:
        md.append(f"| {f['severity'].upper()} | `{f['code']}` | {f['message']} |")
    md.append("")

    md.append("## What still has to be true before this means anything")
    md.append("")
    md.append("1. Replace synthetic data with real exchange history (BTC/ETH/alts).")
    md.append("2. Out-of-sample test on data the parameters never saw.")
    md.append("3. Walk-forward validation across multiple regimes.")
    md.append("4. Paper trading on live data with simulated fills.")
    md.append("5. Only then, live with hard risk limits — never in `godmode_research` mode.")
    md.append("")

    text = "\n".join(md)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return path
