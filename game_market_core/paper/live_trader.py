"""Continuous live paper trader (real-time loop).

Runs non-stop and re-renders the dashboard on every new bar, while serving it
with an auto-refresh tag so the browser updates itself — no manual reload.

Two modes:
  * source: exchange  -> polls the venue for finalized candles (TRUE real time;
    needs a reachable exchange, e.g. Bybit).
  * otherwise         -> replays the loaded history bar-by-bar at `speed` bars
    per tick, so you can WATCH it trade live on the dashboard even offline.

Honest note: a live loop does not change the edge — it just runs it in real
time. The same modest, fragile trend edge applies.
"""

from __future__ import annotations

import os
import threading
import time
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

from config import load_config
from data.loaders.crypto_loader import load_crypto
from data.loaders.macro_loader import load_macro
from data.loaders.news_loader import load_news
from data.loaders.onchain_loader import load_onchain
from data.loaders.realtime_exchange import RestPollFeed
from features.market_features import MarketFeatures
from features.macro_features import MacroContext
from features.news_features import NewsContext
from features.onchain_features import OnchainContext
from strategies.meta_controller import MetaController
from risk.risk_engine import RiskEngine
from backtest.engine import run_backtest
from backtest.metrics import compute_metrics
from backtest.scam_detector import detect
from ml.regime_classifier import classify_series
from dashboard.app import render_html
from paper.paper_trader import _health, _sample, _out_dir


def _start_server(out_dir: str, port: int):
    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path.split("?")[0] in ("/", "/index.html"):
                self.path = "/dashboard.html"
            return super().do_GET()

        def log_message(self, *args):
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=out_dir))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def run_live(cfg: dict | None = None, use_ml: bool = False, use_max: bool = False,
             speed: int = 60, port: int = 8000, refresh_sec: int = 2,
             max_ticks: int | None = None) -> None:
    cfg = cfg or load_config()
    out_dir = _out_dir(cfg)
    os.makedirs(out_dir, exist_ok=True)
    dash_path = os.path.join(out_dir, "dashboard.html")

    d = cfg.get("data", {})
    source = d.get("source", "synthetic")
    full = load_crypto(cfg)
    bar_seconds = (full[1].ts - full[0].ts) if len(full) > 1 else 3600

    # Point-in-time contexts built once (their .at(ts) is leakage-safe).
    macro_series = load_macro(cfg)
    macro = MacroContext(macro_series) if macro_series else None
    events = load_news(cfg, start_ts=full[0].ts, end_ts=full[-1].ts)
    news_ctx = NewsContext(events) if events else None
    onchain_series = load_onchain(cfg)
    onchain = OnchainContext(onchain_series) if onchain_series else None

    trade_filter = None
    if use_ml:
        from ml.training_pipeline import load_model
        trade_filter = load_model()

    sc = cfg.get("strategy", {}).get("false_breakout", {})
    atr_p, sr_lb = int(sc.get("atr_period", 14)), int(sc.get("sr_lookback", 48))

    srv = _start_server(out_dir, port)
    print("== GAME MARKET CORE — LIVE (non-stop) ==")
    print(f"mode: {'real-time exchange' if source == 'exchange' else 'history replay'} | "
          f"source: {source} | ml: {use_ml} | max: {use_max}")
    print(f"Serving LIVE dashboard at: http://127.0.0.1:{port}  (auto-refresh {refresh_sec}s)")
    print("Press Ctrl-C to stop.\n")

    def render(current, idx, total):
        mf = MarketFeatures(current, atr_period=atr_p, sr_lookback=sr_lb)
        regimes = classify_series(mf, cfg)
        advisor = None
        if use_max or cfg.get("max", {}).get("enabled", False):
            from integrations.max_bridge import MaxAdvisor
            advisor = MaxAdvisor(cfg)
            advisor.enabled = True
        meta = MetaController(cfg)
        risk = RiskEngine(cfg)
        result = run_backtest(current, mf, meta, risk, cfg, regimes=regimes,
                              macro=macro, news=news_ctx, onchain=onchain,
                              trade_filter=trade_filter, advisor=advisor)
        metrics = compute_metrics(result)
        flags = detect(metrics, cfg)
        health = _health(result, risk, 0)
        max_note = advisor.explain() if advisor is not None else None
        state = {
            "metrics": metrics, "health": health, "flags": flags,
            "recent_trades": [{
                "exit_date": time.strftime("%Y-%m-%d %H:%M", time.gmtime(t.exit_ts)),
                "strategy": t.strategy, "side": t.side, "pnl": t.pnl,
                "r": t.r_multiple, "exit_reason": t.exit_reason,
            } for t in result.trades[-15:]],
            "equity_sample": _sample([e for _, e in result.equity_curve]),
            "source": source, "max_note": max_note,
            "target_low": cfg["project"]["romi_target_monthly_low"],
            "target_high": cfg["project"]["romi_target_monthly_high"],
            "live": True, "refresh_sec": refresh_sec,
            "bar_index": idx, "bar_total": total,
        }
        render_html(state, dash_path)
        return metrics

    ticks = 0
    try:
        if source == "exchange":
            current = list(full)
            render(current, len(current), len(current))
            feed = RestPollFeed(venue=d.get("venue", "bybit"), poll_seconds=bar_seconds)
            for bar in feed.stream_candles(d.get("symbol", "BTCUSDT"), d.get("timeframe", "1h")):
                current.append(bar)
                m = render(current, len(current), len(current))
                ticks += 1
                print(f"[live] bar {len(current)} | total {m['total_return_pct']:+.2f}% | "
                      f"trades {m['num_trades']} | maxDD {m['max_drawdown_pct']:.1f}%")
                if max_ticks and ticks >= max_ticks:
                    break
        else:
            warmup = max(60, sr_lb)
            total = len(full)
            i = warmup
            while i <= total:
                m = render(full[:i], i, total)
                ticks += 1
                print(f"[live] bar {i}/{total} | total {m['total_return_pct']:+.2f}% | "
                      f"trades {m['num_trades']} | ROMI {m['avg_monthly_romi_pct']:+.2f}%/mo")
                if max_ticks and ticks >= max_ticks:
                    break
                i += max(1, speed)
                time.sleep(0.7)
            render(full[:total], total, total)
            print("\n[live] replay reached present. Holding final state (dashboard stays up).")
            while not max_ticks:
                time.sleep(3600)
    except KeyboardInterrupt:
        print("\n[live] stopped.")
    finally:
        srv.shutdown()
