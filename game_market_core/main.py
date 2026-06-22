"""GAME MARKET CORE — entry point.

Runs the Stage 1 pipeline end to end:
    load data -> features -> meta controller (False Breakout) -> risk engine
    -> backtest -> metrics -> scam detector -> markdown report.

Usage:
    python3 main.py                 # run backtest with config.yaml
    python3 main.py backtest        # same
    python3 main.py --mode aggressive
    python3 main.py --mode godmode_research   # research-only, never live
"""

from __future__ import annotations

import os
import sys

# Make the package root importable regardless of the caller's cwd.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import load_config  # noqa: E402
from data.loaders.crypto_loader import load_crypto  # noqa: E402
from features.market_features import MarketFeatures  # noqa: E402
from strategies.meta_controller import MetaController  # noqa: E402
from risk.risk_engine import RiskEngine  # noqa: E402
from backtest.engine import run_backtest  # noqa: E402
from backtest.metrics import compute_metrics  # noqa: E402
from backtest.scam_detector import detect  # noqa: E402
from reports.report_generator import generate_report  # noqa: E402
from data.storage.database import save_trades_csv  # noqa: E402


def _parse_args(argv: list[str]) -> dict:
    opts = {"command": "backtest", "mode": None}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in {"backtest", "selfcheck"}:
            opts["command"] = a
        elif a == "--mode" and i + 1 < len(argv):
            opts["mode"] = argv[i + 1]
            i += 1
        i += 1
    return opts


def run(opts: dict) -> int:
    cfg = load_config()
    if opts.get("mode"):
        cfg.setdefault("risk", {})["mode"] = opts["mode"]

    print("== GAME MARKET CORE — Stage 1 ==")
    print(f"Data source: {cfg.get('data', {}).get('source')} | "
          f"symbol: {cfg.get('data', {}).get('symbol')} | "
          f"timeframe: {cfg.get('data', {}).get('timeframe')}")

    candles = load_crypto(cfg)
    print(f"Loaded {len(candles)} candles.")

    strat_cfg = cfg.get("strategy", {}).get("false_breakout", {})
    mf = MarketFeatures(
        candles,
        atr_period=int(strat_cfg.get("atr_period", 14)),
        sr_lookback=int(strat_cfg.get("sr_lookback", 48)),
    )
    meta = MetaController(cfg)
    risk = RiskEngine(cfg)
    print(f"Risk mode: {risk.mode} | risk/trade: {risk.risk_per_trade:.2%} | "
          f"max leverage: {risk.max_leverage:g}x | live allowed: {risk.allow_live}")

    result = run_backtest(candles, mf, meta, risk, cfg)
    metrics = compute_metrics(result)
    flags = detect(metrics, cfg)

    # Persist trade journal + report.
    root = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(root, cfg.get("report", {}).get("out_dir", "reports/output"))
    save_trades_csv(result.trades, os.path.join(out_dir, "trades.csv"))
    report_path = generate_report(metrics, flags, cfg, result)

    # Console summary.
    print("\n-- Results --------------------------------------------------")
    print(f"Trades:            {metrics['num_trades']}")
    print(f"Total return:      {metrics['total_return_pct']:.2f}%")
    print(f"Avg monthly ROMI:  {metrics['avg_monthly_romi_pct']:.2f}%  "
          f"(target {cfg['project']['romi_target_monthly_low']}-"
          f"{cfg['project']['romi_target_monthly_high']}%)")
    print(f"Win rate:          {metrics['winrate']:.1%}")
    print(f"Avg R:             {metrics['avg_r']:.3f}")
    print(f"Profit factor:     {metrics['profit_factor']:.2f}")
    print(f"Max drawdown:      {metrics['max_drawdown_pct']:.2f}%")
    print(f"Sharpe / Sortino:  {metrics['sharpe']:.2f} / {metrics['sortino']:.2f}")
    print(f"P(>50% DD) MC:     {metrics['prob_large_drawdown']:.1%}")
    if metrics["kill_tripped"]:
        print(f"KILL SWITCH:       TRIPPED — {metrics['kill_reason']}")
    print("\n-- Integrity flags ------------------------------------------")
    for f in flags:
        print(f"[{f['severity'].upper():5}] {f['code']}: {f['message']}")
    print(f"\nReport written to: {report_path}")
    return 0


def main(argv: list[str]) -> int:
    opts = _parse_args(argv)
    return run(opts)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
