"""Paper trader (Stage 3).

Drives the SAME meta controller + risk engine + matching engine used in
backtest — paper and backtest must be comparable — but:
  * candles arrive THROUGH the live-feed abstraction (ReplayFeed now, a real
    websocket/REST feed later) so going live is a feed swap, not a rewrite;
  * macro and news context are wired in (news-chaos is a risk-off veto);
  * it produces the operational layer: trade journal, daily/weekly reports, a
    strategy-health snapshot, and a static HTML dashboard.

Paper trading is a MANDATORY gate between a validated backtest and any live
execution. Fills are simulated; no orders leave the building.
"""

from __future__ import annotations

import os
import time

from config import load_config
from data.loaders.crypto_loader import load_crypto
from data.loaders.macro_loader import load_macro
from data.loaders.news_loader import load_news
from data.loaders.realtime_exchange import ReplayFeed
from features.market_features import MarketFeatures
from features.macro_features import MacroContext
from features.news_features import NewsContext
from strategies.meta_controller import MetaController
from risk.risk_engine import RiskEngine
from backtest.engine import run_backtest
from backtest.metrics import compute_metrics
from backtest.scam_detector import detect
from ml.regime_classifier import classify_series
from paper.journal import write_journal
from dashboard.app import render_html


def _out_dir(cfg: dict) -> str:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(root, cfg.get("report", {}).get("out_dir", "reports/output"))


def _aggregate(trades, period: str) -> list[dict]:
    fmt = "%Y-%m-%d" if period == "day" else "%Y-W%W"
    buckets: dict = {}
    for t in trades:
        key = time.strftime(fmt, time.gmtime(t.exit_ts))
        b = buckets.setdefault(key, {"trades": 0, "pnl": 0.0, "wins": 0})
        b["trades"] += 1
        b["pnl"] += t.pnl
        b["wins"] += 1 if t.pnl > 0 else 0
    return [{"period": k, "trades": v["trades"], "pnl": round(v["pnl"], 2),
             "winrate": v["wins"] / v["trades"]} for k, v in sorted(buckets.items())]


def _health(result, risk, news_chaos_bars: int) -> dict:
    st = risk.state
    by_regime: dict = {}
    by_engine: dict = {}
    for d in result.decision_log:
        by_regime[d["regime"]] = by_regime.get(d["regime"], 0) + 1
        by_engine[d["strategy"]] = by_engine.get(d["strategy"], 0) + 1
    return {
        "recent_winrate": st.recent_winrate(),
        "drawdown": st.drawdown(),
        "risk_temperature": st.risk_temperature(),
        "loss_streak": st.loss_streak,
        "signals_proposed": len(result.decision_log),
        "by_engine": by_engine,
        "by_regime": by_regime,
        "news_chaos_bars": news_chaos_bars,
    }


def run_paper(cfg: dict | None = None) -> dict:
    cfg = cfg or load_config()
    print("== GAME MARKET CORE — Paper Trading (Stage 3) ==")

    # Data arrives through the live-feed abstraction.
    feed = ReplayFeed(load_crypto(cfg))
    d = cfg.get("data", {})
    candles = list(feed.stream_candles(d.get("symbol", "BTCUSDT"), d.get("timeframe", "1h")))
    print(f"Streamed {len(candles)} candles via ReplayFeed.")

    sc = cfg.get("strategy", {}).get("false_breakout", {})
    mf = MarketFeatures(candles, atr_period=int(sc.get("atr_period", 14)),
                        sr_lookback=int(sc.get("sr_lookback", 48)))
    regimes = classify_series(mf, cfg)

    macro_series = load_macro(cfg)
    macro = MacroContext(macro_series) if macro_series else None

    events = load_news(cfg, start_ts=candles[0].ts, end_ts=candles[-1].ts)
    news_ctx = NewsContext(events) if events else None
    news_chaos_bars = (sum(1 for c in candles if news_ctx.at(c.ts).get("chaos"))
                       if news_ctx else 0)

    meta = MetaController(cfg)
    risk = RiskEngine(cfg)
    print(f"Engines: {[s.name for s in meta.strategies]} | news events: {len(events)} | "
          f"chaos bars: {news_chaos_bars}")

    result = run_backtest(candles, mf, meta, risk, cfg,
                          regimes=regimes, macro=macro, news=news_ctx)
    metrics = compute_metrics(result)
    flags = detect(metrics, cfg)
    health = _health(result, risk, news_chaos_bars)
    daily = _aggregate(result.trades, "day")
    weekly = _aggregate(result.trades, "week")

    out_dir = _out_dir(cfg)
    write_journal(result.trades, os.path.join(out_dir, "paper_journal.csv"))
    dash_state = {
        "metrics": metrics, "health": health, "flags": flags,
        "recent_trades": [{
            "exit_date": time.strftime("%Y-%m-%d %H:%M", time.gmtime(t.exit_ts)),
            "strategy": t.strategy, "side": t.side, "pnl": t.pnl,
            "r": t.r_multiple, "exit_reason": t.exit_reason,
        } for t in result.trades[-15:]],
        "equity_sample": _sample([e for _, e in result.equity_curve]),
        "source": cfg.get("data", {}).get("source", "synthetic"),
        "target_low": cfg["project"]["romi_target_monthly_low"],
        "target_high": cfg["project"]["romi_target_monthly_high"],
    }
    dash_path = render_html(dash_state, os.path.join(out_dir, "dashboard.html"))
    report_path = _write_paper_report(out_dir, metrics, flags, health, daily, weekly, cfg)

    # Console summary.
    print("\n-- Paper results --------------------------------------------")
    print(f"Trades: {metrics['num_trades']} | total {metrics['total_return_pct']:.2f}% | "
          f"avg monthly ROMI {metrics['avg_monthly_romi_pct']:.2f}% | "
          f"winrate {metrics['winrate']:.1%} | maxDD {metrics['max_drawdown_pct']:.2f}%")
    print(f"Risk temperature now: {health['risk_temperature']:.2f} | "
          f"recent winrate: {health['recent_winrate']:.1%} | loss streak: {health['loss_streak']}")
    print(f"Signals by engine: {health['by_engine']}")
    if any(f["severity"] == "high" for f in flags):
        print("Integrity: HIGH-severity flags present (see report).")
    print(f"\nDashboard: {dash_path}")
    print(f"Report:    {report_path}")
    print(f"Journal:   {os.path.join(out_dir, 'paper_journal.csv')}")
    return {"metrics": metrics, "flags": flags, "health": health,
            "dashboard": dash_path, "report": report_path}


def _sample(curve: list[float], target: int = 200) -> list[float]:
    if len(curve) <= target:
        return curve
    step = len(curve) // target
    return curve[::step]


def _write_paper_report(out_dir, metrics, flags, health, daily, weekly, cfg) -> str:
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "paper_report.md")
    L = []
    L.append("# GAME MARKET CORE — Paper Trading Report")
    L.append(f"\nGenerated: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}")
    L.append("\n> Simulated fills on the live-feed path. A paper run is the gate "
             "before live capital — it is not proof of a real edge by itself.\n")
    L.append("## Summary\n")
    L.append(f"- Total return: {metrics['total_return_pct']:.2f}%")
    L.append(f"- Avg monthly ROMI: {metrics['avg_monthly_romi_pct']:.2f}% "
             f"(target {cfg['project']['romi_target_monthly_low']}-"
             f"{cfg['project']['romi_target_monthly_high']}%)")
    L.append(f"- Trades: {metrics['num_trades']} | win rate {metrics['winrate']:.1%} | "
             f"avg R {metrics['avg_r']:.3f} | PF {metrics['profit_factor']:.2f}")
    L.append(f"- Max drawdown: {metrics['max_drawdown_pct']:.2f}% | "
             f"Sharpe {metrics['sharpe']:.2f} | P(>50% DD) {metrics['prob_large_drawdown']:.1%}")
    L.append("\n## Strategy health\n")
    for k, v in health.items():
        L.append(f"- {k}: {v}")
    L.append("\n## Weekly\n\n| Week | Trades | PnL | Win% |\n|---|---|---|---|")
    for r in weekly[-12:]:
        L.append(f"| {r['period']} | {r['trades']} | {r['pnl']:.2f} | {r['winrate']:.0%} |")
    L.append("\n## Daily (last 14)\n\n| Day | Trades | PnL | Win% |\n|---|---|---|---|")
    for r in daily[-14:]:
        L.append(f"| {r['period']} | {r['trades']} | {r['pnl']:.2f} | {r['winrate']:.0%} |")
    L.append("\n## Integrity checks\n")
    for f in flags:
        L.append(f"- **{f['severity'].upper()}** `{f['code']}` — {f['message']}")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L))
    return path
