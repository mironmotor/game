"""Backtest engine — honest by construction.

Design choices that keep results believable:
* Signals are generated at the CLOSE of bar i and FILLED at the OPEN of bar
  i+1. A signal can never trade on its own bar.
* Every fill pays taker fees, slippage, and half-spread, all adverse.
* Perpetual funding is charged per holding period.
* When a bar's range contains BOTH the stop and the take-profit, the STOP
  is assumed to fill first (pessimistic).
* One position at a time (Stage 1), sized entirely by the Risk Engine.
"""

from __future__ import annotations

from dataclasses import dataclass

from datatypes import Candle, Signal, Trade
from features.market_features import MarketFeatures
from risk.risk_engine import RiskEngine
from strategies.meta_controller import MetaController
from ml.regime_classifier import classify_series
from ml.feature_vector import build_vector


@dataclass
class BacktestResult:
    trades: list[Trade]
    equity_curve: list[tuple[int, float]]
    start_equity: float
    end_equity: float
    bar_seconds: int
    kill_tripped: bool
    kill_reason: str
    risk_mode: str
    allow_live: bool
    decision_log: list[dict]


def _adverse(price: float, side_is_buy: bool, bps: float) -> float:
    """Move a fill price adverse to the trader by ``bps`` basis points."""
    factor = bps / 10_000.0
    return price * (1 + factor) if side_is_buy else price * (1 - factor)


def _impact_bps(qty: float, ref_price: float, bar, coeff: float) -> float:
    """Size-dependent market impact in bps.

    Impact grows with order notional relative to the bar's dollar volume, so
    large orders cost more — this is the capacity limit that makes "infinite
    scaling" impossible. Negligible for small accounts; bites at size.
    """
    if coeff <= 0:
        return 0.0
    dollar_vol = bar.volume * bar.close
    if dollar_vol <= 0:
        return 0.0
    notional = abs(qty) * ref_price
    return coeff * (notional / dollar_vol)


def run_backtest(
    candles: list[Candle],
    mf: MarketFeatures,
    meta: MetaController,
    risk: RiskEngine,
    cfg: dict,
    regimes: list[str] | None = None,
    macro=None,
    news=None,
    onchain=None,
    trade_filter=None,
    trade_window: tuple[int, int] | None = None,
) -> BacktestResult:
    if regimes is None:
        regimes = classify_series(mf, cfg)
    win_start, win_end = (trade_window if trade_window else (0, len(candles)))

    costs = cfg.get("costs", {})
    taker = float(costs.get("taker_fee", 0.0004))
    slip = float(costs.get("slippage_bps", 2.0))
    spread = float(costs.get("spread_bps", 1.0))
    funding_8h = float(costs.get("funding_bps_per_8h", 1.0))
    impact_coeff = float(costs.get("impact_coeff", 0.0))
    fill_bps = slip + spread  # adverse cost applied to each fill

    n = len(candles)
    bar_seconds = (candles[1].ts - candles[0].ts) if n > 1 else 3600

    equity = risk.start_equity
    equity_curve: list[tuple[int, float]] = []
    trades: list[Trade] = []

    pending: tuple[Signal, float] | None = None  # (signal, qty) to fill next open
    pos = None  # dict with open-position state

    for i in range(n):
        bar = candles[i]
        risk.on_equity(bar.ts, equity)

        # 0) Walk-forward window boundary: stop trading past the test window
        #    and force-close any residual position at this bar's open.
        if trade_window is not None and i >= win_end:
            pending = None
            if pos is not None:
                equity = _close_position(
                    pos, bar.open, "window_end", bar, taker, fill_bps,
                    funding_8h, bar_seconds, equity, trades, risk, impact_coeff
                )
                pos = None
            equity_curve.append((bar.ts, equity))
            continue

        # 1) Fill a pending order at this bar's open.
        if pending is not None and pos is None:
            sig, qty, fv = pending
            pending = None
            is_buy = sig.side == "long"
            entry_impact = _impact_bps(qty, bar.open, bar, impact_coeff)
            entry_fill = _adverse(bar.open, is_buy, fill_bps + entry_impact)
            entry_fee = taker * entry_fill * qty
            init_risk = qty * abs(entry_fill - sig.stop)
            pos = {
                "side": sig.side, "qty": qty, "entry_fill": entry_fill,
                "stop": sig.stop, "tp": sig.take_profit, "entry_ts": bar.ts,
                "entry_index": i, "fees": entry_fee, "strategy": sig.strategy,
                "reason": sig.reason, "init_risk": init_risk, "features": fv,
            }
            risk.register_open(bar.ts)

        # 2) Manage an open position against this bar's range.
        if pos is not None:
            exit_price = None
            exit_reason = None
            if pos["side"] == "long":
                if bar.low <= pos["stop"]:           # stop first (pessimistic)
                    exit_price, exit_reason = pos["stop"], "stop"
                elif bar.high >= pos["tp"]:
                    exit_price, exit_reason = pos["tp"], "take_profit"
            else:
                if bar.high >= pos["stop"]:
                    exit_price, exit_reason = pos["stop"], "stop"
                elif bar.low <= pos["tp"]:
                    exit_price, exit_reason = pos["tp"], "take_profit"

            if exit_price is not None:
                equity = _close_position(
                    pos, exit_price, exit_reason, bar, taker, fill_bps,
                    funding_8h, bar_seconds, equity, trades, risk, impact_coeff
                )
                pos = None

        # 3) If flat and idle, ask the meta controller for a new signal.
        in_window = win_start <= i < win_end
        if pos is None and pending is None and i + 1 < n and in_window:
            macro_state = macro.at(bar.ts) if macro is not None else {}
            news_state = news.at(bar.ts) if news is not None else {}
            onchain_state = onchain.at(bar.ts) if onchain is not None else {}
            context = {"regime": regimes[i], "news": news_state,
                       "macro": macro_state, "onchain": onchain_state}
            # Macro crisis and news chaos are independent risk-off vetoes:
            # no new entries while the world is on fire.
            if macro_state.get("crisis_mode") or news_state.get("chaos"):
                context["regime"] = "crisis"
            sig = meta.select(i, mf, context)
            if sig is not None:
                fv = build_vector(i, mf, context, sig)
                # ML meta-model veto (only acts when the model is approved).
                if trade_filter is not None and not trade_filter.should_trade(fv):
                    pass
                else:
                    decision = risk.evaluate(
                        ts=bar.ts, equity=equity, entry=sig.entry,
                        stop=sig.stop, spread_bps=spread,
                    )
                    if decision.allow:
                        pending = (sig, decision.qty, fv)

        equity_curve.append((bar.ts, equity))

    # Close any residual position at the final close.
    if pos is not None:
        last = candles[-1]
        equity = _close_position(
            pos, last.close, "end_of_data", last, taker, fill_bps,
            funding_8h, bar_seconds, equity, trades, risk, impact_coeff
        )
        if equity_curve:
            equity_curve[-1] = (last.ts, equity)

    return BacktestResult(
        trades=trades,
        equity_curve=equity_curve,
        start_equity=risk.start_equity,
        end_equity=equity,
        bar_seconds=bar_seconds,
        kill_tripped=risk.kill.tripped,
        kill_reason=risk.kill.trip_reason,
        risk_mode=risk.mode,
        allow_live=risk.allow_live,
        decision_log=meta.decision_log,
    )


def _close_position(pos, exit_price, exit_reason, bar, taker, fill_bps,
                    funding_8h, bar_seconds, equity, trades, risk,
                    impact_coeff: float = 0.0) -> float:
    is_buy_exit = pos["side"] == "short"  # closing a short = buy
    qty = pos["qty"]
    exit_impact = _impact_bps(qty, exit_price, bar, impact_coeff)
    exit_fill = _adverse(exit_price, is_buy_exit, fill_bps + exit_impact)
    exit_fee = taker * exit_fill * qty

    if pos["side"] == "long":
        gross = (exit_fill - pos["entry_fill"]) * qty
    else:
        gross = (pos["entry_fill"] - exit_fill) * qty

    held_bars = max(1, bar.ts // bar_seconds - pos["entry_ts"] // bar_seconds)
    notional = pos["entry_fill"] * qty
    funding = notional * (funding_8h / 10_000.0) * (held_bars * bar_seconds) / (8 * 3600)

    fees = pos["fees"] + exit_fee
    pnl = gross - fees - funding
    equity += pnl

    r = pnl / pos["init_risk"] if pos["init_risk"] > 0 else 0.0
    trades.append(Trade(
        entry_ts=pos["entry_ts"], exit_ts=bar.ts, side=pos["side"],
        entry_price=pos["entry_fill"], exit_price=exit_fill, qty=qty,
        fees=fees + funding, pnl=pnl, r_multiple=r, strategy=pos["strategy"],
        reason=pos["reason"], exit_reason=exit_reason, equity_after=equity,
        duration_bars=held_bars, features=pos.get("features", []),
    ))
    risk.register_close(bar.ts, pnl, equity, bar_seconds)
    return equity
