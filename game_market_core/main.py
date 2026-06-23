"""GAME MARKET CORE — entry point.

Commands:
    python3 main.py [backtest]            # backtest (synthetic by default)
    python3 main.py walkforward           # walk-forward validation (OOS)
    python3 main.py paper                 # paper trading: news + dashboard
    python3 main.py train [filter|regime|news|gbm|all]   # train + OOS-gate models
    python3 main.py backtest --ml         # apply the best approved ML filter
    python3 main.py portfolio             # multi-symbol portfolio backtest
    python3 main.py serve [--port 8000]   # live web dashboard (open in browser)
    python3 main.py livecheck             # probe REST + websocket feeds (safe)
    python3 main.py --source exchange     # pull real data (Binance) if reachable
    python3 main.py --mode conservative   # risk profile override
    python3 main.py --mode godmode_research   # research only, never live
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import load_config  # noqa: E402
from data.loaders.crypto_loader import load_crypto  # noqa: E402
from data.loaders.macro_loader import load_macro  # noqa: E402
from data.loaders.onchain_loader import load_onchain  # noqa: E402
from features.market_features import MarketFeatures  # noqa: E402
from features.macro_features import MacroContext  # noqa: E402
from features.onchain_features import OnchainContext  # noqa: E402
from strategies.meta_controller import MetaController  # noqa: E402
from risk.risk_engine import RiskEngine  # noqa: E402
from backtest.engine import run_backtest  # noqa: E402
from backtest.metrics import compute_metrics  # noqa: E402
from backtest.scam_detector import detect  # noqa: E402
from backtest.walk_forward import walk_forward  # noqa: E402
from reports.report_generator import generate_report  # noqa: E402
from data.storage.database import save_trades_csv  # noqa: E402


def _parse_args(argv: list[str]) -> dict:
    opts = {"command": "backtest", "mode": None, "source": None, "ml": False,
            "target": None, "port": 8000}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in {"backtest", "walkforward", "paper", "train", "portfolio",
                 "livecheck", "serve", "dashboard", "selfcheck"}:
            opts["command"] = a
        elif a in {"filter", "regime", "news", "gbm", "seq", "all"}:
            opts["target"] = a
        elif a == "--port" and i + 1 < len(argv):
            opts["port"] = int(argv[i + 1]); i += 1
        elif a == "--mode" and i + 1 < len(argv):
            opts["mode"] = argv[i + 1]; i += 1
        elif a == "--source" and i + 1 < len(argv):
            opts["source"] = argv[i + 1]; i += 1
        elif a == "--ml":
            opts["ml"] = True
        i += 1
    return opts


def _apply_overrides(cfg: dict, opts: dict) -> None:
    if opts.get("mode"):
        cfg.setdefault("risk", {})["mode"] = opts["mode"]
    if opts.get("source"):
        cfg.setdefault("data", {})["source"] = opts["source"]


def _build_features(candles, cfg):
    sc = cfg.get("strategy", {}).get("false_breakout", {})
    return MarketFeatures(candles, atr_period=int(sc.get("atr_period", 14)),
                          sr_lookback=int(sc.get("sr_lookback", 48)))


def run_backtest_cmd(cfg: dict, use_ml: bool = False) -> int:
    print("== GAME MARKET CORE — Backtest ==")
    print(f"Data source: {cfg.get('data', {}).get('source')} | "
          f"symbol: {cfg.get('data', {}).get('symbol')} | "
          f"timeframe: {cfg.get('data', {}).get('timeframe')}")

    candles = load_crypto(cfg)
    print(f"Loaded {len(candles)} candles.")
    macro_series = load_macro(cfg)
    macro = MacroContext(macro_series) if macro_series else None
    onchain_series = load_onchain(cfg)
    onchain = OnchainContext(onchain_series) if onchain_series else None

    trade_filter = None
    if use_ml:
        from ml.training_pipeline import load_model
        trade_filter = load_model()
        if trade_filter is None:
            print("[ml] no trained model found — run `python3 main.py train` first. "
                  "Continuing without ML filter.")
        else:
            print(f"[ml] trade filter loaded (approved={trade_filter.approved}, "
                  f"threshold={trade_filter.threshold:.2f}) — "
                  f"{'active' if trade_filter.approved else 'INERT'}")

    mf = _build_features(candles, cfg)
    meta = MetaController(cfg)
    risk = RiskEngine(cfg)
    print(f"Engines: {[s.name for s in meta.strategies]}")
    print(f"Risk mode: {risk.mode} | risk/trade: {risk.risk_per_trade:.2%} | "
          f"max leverage: {risk.max_leverage:g}x | live allowed: {risk.allow_live}")

    result = run_backtest(candles, mf, meta, risk, cfg, macro=macro,
                          onchain=onchain, trade_filter=trade_filter)
    metrics = compute_metrics(result)
    flags = detect(metrics, cfg)

    root = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(root, cfg.get("report", {}).get("out_dir", "reports/output"))
    save_trades_csv(result.trades, os.path.join(out_dir, "trades.csv"))
    report_path = generate_report(metrics, flags, cfg, result)

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

    # Regime / strategy decision breakdown.
    by_regime: dict = {}
    by_strat: dict = {}
    for d in result.decision_log:
        by_regime[d["regime"]] = by_regime.get(d["regime"], 0) + 1
        by_strat[d["strategy"]] = by_strat.get(d["strategy"], 0) + 1
    if result.decision_log:
        # Signals PROPOSED by the meta controller (many are later vetoed by
        # the risk engine — daily limits, cooldown, kill switch — so this is
        # far larger than the executed trade count above).
        print(f"Signals proposed by regime: {by_regime}")
        print(f"Signals proposed by engine: {by_strat}")

    print("\n-- Integrity flags ------------------------------------------")
    for f in flags:
        print(f"[{f['severity'].upper():5}] {f['code']}: {f['message']}")
    print(f"\nReport written to: {report_path}")
    return 0


def run_walkforward_cmd(cfg: dict) -> int:
    print("== GAME MARKET CORE — Walk-Forward (out-of-sample) ==")
    candles = load_crypto(cfg)
    print(f"Loaded {len(candles)} candles.")
    n_folds = int(cfg.get("walk_forward", {}).get("n_folds", 5))
    wf = walk_forward(candles, cfg, n_folds=n_folds)
    if "error" in wf:
        print(f"Walk-forward error: {wf['error']}")
        return 1

    print(f"\nFolds: {wf['n_folds']}  |  OOS total return: {wf['oos_total_return_pct']}%")
    s = wf["oos_trade_stats"]
    print(f"OOS trades: {s['n']} | winrate {s['winrate']:.1%} | avg R {s['avg_r']:.3f} | "
          f"PF {s['profit_factor']:.2f}")
    print("\nPer fold (in-sample train score -> out-of-sample return):")
    for f in wf["folds"]:
        print(f"  fold {f['fold']}: IS {f['is_train_score_pct']:+.2f}%  ->  "
              f"OOS {f['oos_return_pct']:+.2f}%  "
              f"({f['oos_trades']} trades, params {f['best_params']})")

    is_mean = sum(f["is_train_score_pct"] for f in wf["folds"]) / max(1, len(wf["folds"]))
    oos_mean = sum(f["oos_return_pct"] for f in wf["folds"]) / max(1, len(wf["folds"]))
    print(f"\nMean IS {is_mean:+.2f}% vs mean OOS {oos_mean:+.2f}% per fold.")
    if oos_mean <= 0:
        if is_mean > 0:
            print("VERDICT: no edge out-of-sample — in-sample profit was overfitting. "
                  "Do not trade this.")
        else:
            print("VERDICT: no edge in-sample OR out-of-sample. Strategy/params reject. "
                  "(Expected on synthetic data — proves the validator works.)")
    elif oos_mean < 0.4 * is_mean:
        print("VERDICT: large in-sample/out-of-sample gap — fragile, not trustworthy yet.")
    else:
        print("VERDICT: edge partially survives OOS. Still needs paper trading before live.")
    return 0


def run_portfolio_cmd(cfg: dict) -> int:
    print("== GAME MARKET CORE — Multi-symbol Portfolio ==")
    from backtest.portfolio_backtest import run_portfolio
    r = run_portfolio(cfg)
    print(f"Symbols: {r['symbols']}")
    print(f"Risk budget: {r['risk_budget']} | weights: {r['weights']}")
    print("\n-- Per symbol -----------------------------------------------")
    for sym, ret, dd, n in r["per_symbol"]:
        print(f"  {sym:10} return {ret:+7.2f}% | maxDD {dd:5.2f}% | trades {n}")
    p = r["portfolio"]
    print("\n-- Portfolio ------------------------------------------------")
    print(f"Total return:   {p['total_return_pct']:+.2f}%")
    print(f"Avg monthly:    {p['avg_monthly_romi_pct']:+.2f}%")
    print(f"Max drawdown:   {p['max_drawdown_pct']:.2f}%")
    print(f"Sharpe/Sortino: {p['sharpe']:.2f} / {p['sortino']:.2f}")
    print(f"Trades:         {p['num_trades']}")
    print(f"\nDiversification: avg single-symbol maxDD {r['avg_symbol_max_dd']:.2f}% -> "
          f"portfolio maxDD {p['max_drawdown_pct']:.2f}% "
          f"(gain {r['diversification_gain']:+.2f} pts)")
    if r["portfolio_kill"]:
        print(f"PORTFOLIO KILL: {p['kill_reason']} — book halted.")
    return 0


def run_serve_cmd(cfg: dict, port: int = 8000, use_ml: bool = True) -> int:
    """Live visualizer: a stdlib HTTP server (no deps) that regenerates and
    serves the strategy-health dashboard. Open the printed URL in a browser."""
    import os
    from functools import partial
    from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
    from paper.paper_trader import run_paper

    root = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(root, cfg.get("report", {}).get("out_dir", "reports/output"))
    os.makedirs(out_dir, exist_ok=True)

    print("== GAME MARKET CORE — Dashboard server ==")
    print("Building dashboard (paper run)...")
    run_paper(cfg, use_ml=use_ml)

    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path in ("/", "/index.html"):
                self.path = "/dashboard.html"
            elif self.path.startswith("/refresh"):
                # Regenerate from a fresh run, then redirect to the dashboard.
                try:
                    run_paper(cfg, use_ml=use_ml)
                except Exception as exc:  # keep the server alive on errors
                    print(f"[serve] refresh failed: {exc}")
                self.send_response(303)
                self.send_header("Location", "/dashboard.html")
                self.end_headers()
                return
            return super().do_GET()

        def log_message(self, *args):  # quiet access log
            pass

    handler = partial(Handler, directory=out_dir)
    srv = ThreadingHTTPServer(("127.0.0.1", port), handler)
    url = f"http://127.0.0.1:{port}"
    print(f"\nServing dashboard at:  {url}")
    print(f"Force a fresh run at:  {url}/refresh")
    print("Press Ctrl-C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        srv.server_close()
    return 0


def run_livecheck_cmd(cfg: dict) -> int:
    """Probe the live REST feed and show execution-adapter safety gates.
    Sends NO orders; in a locked-down sandbox the feed probe fails cleanly."""
    print("== GAME MARKET CORE — Live check (no orders sent) ==")
    d = cfg.get("data", {})
    venue = d.get("venue", "binance")
    from data.loaders.realtime_exchange import RestPollFeed
    feed = RestPollFeed(venue=venue, max_polls=1, poll_seconds=0)
    try:
        bars = list(feed.stream_candles(d.get("symbol", "BTCUSDT"), d.get("timeframe", "1h")))
        print(f"[rest] {venue}: received {len(bars)} finalized candle(s) "
              f"(last close {bars[-1].close if bars else 'n/a'})")
    except Exception as exc:
        print(f"[rest] {venue}: live probe failed ({type(exc).__name__}: {str(exc)[:60]}). "
              "Expected in a locked-down environment.")

    try:
        from data.loaders.ws_feed import WebSocketFeed
        ws = WebSocketFeed(venue="binance", max_messages=1, timeout=4)
        bar = next(ws.stream_candles(d.get("symbol", "BTCUSDT"), d.get("timeframe", "1h")))
        print(f"[ws]   binance: streamed 1 finalized candle (close {bar.close})")
    except Exception as exc:
        print(f"[ws]   binance: websocket probe failed ({type(exc).__name__}). "
              "Expected in a locked-down environment.")

    try:
        from data.loaders.orderbook import fetch_order_book
        from features.microstructure import microstructure_state
        book = fetch_order_book(venue, d.get("symbol", "BTCUSDT"), limit=20)
        ms = microstructure_state(book)
        print(f"[book] {venue}: OBI {ms['obi']:+.3f} | spread {ms['spread_bps']:.2f} bps")
    except Exception as exc:
        print(f"[book] {venue}: order-book probe failed ({type(exc).__name__}). "
              "Expected in a locked-down environment.")

    from execution.execution_adapter import ExecutionAdapter
    risk = RiskEngine(cfg)
    adapter = ExecutionAdapter(cfg, risk)
    print(f"[exec] live_enabled = {adapter.live_enabled}")
    print(f"[exec] gates blocking live: {adapter.gate_reasons()}")
    res = adapter.place_order({"side": "long", "qty": 0.001, "price": 30000.0})
    print(f"[exec] sample order -> status={res.status} ({res.reason})")
    return 0


def main(argv: list[str]) -> int:
    opts = _parse_args(argv)
    cfg = load_config()
    _apply_overrides(cfg, opts)
    if opts["command"] == "walkforward":
        return run_walkforward_cmd(cfg)
    if opts["command"] == "train":
        target = opts["target"] or "filter"
        if target in ("filter", "all"):
            from ml.training_pipeline import train
            train(cfg)
        if target in ("regime", "all"):
            from ml.regime_model import train as train_regime
            train_regime(cfg)
        if target in ("news", "all"):
            from ml.news_model import train as train_news
            train_news(cfg)
        if target in ("gbm", "all"):
            from ml.training_pipeline import train_gbm
            train_gbm(cfg)
        if target in ("seq", "all"):
            from ml.seq_model import train as train_seq
            train_seq(cfg)
        return 0
    if opts["command"] == "portfolio":
        return run_portfolio_cmd(cfg)
    if opts["command"] in ("serve", "dashboard"):
        return run_serve_cmd(cfg, port=opts["port"], use_ml=opts["ml"])
    if opts["command"] == "livecheck":
        return run_livecheck_cmd(cfg)
    if opts["command"] == "paper":
        from paper.paper_trader import run_paper
        run_paper(cfg, use_ml=opts["ml"])
        return 0
    return run_backtest_cmd(cfg, use_ml=opts["ml"])


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
