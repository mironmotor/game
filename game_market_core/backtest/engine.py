"""Backtest engine — honest by construction.

Design choices that keep results believable:
* Signals are generated at the CLOSE of bar i and FILLED at the OPEN of bar
  i+1. A signal can never trade on its own bar.
* Every fill pays taker fees, slippage, and half-spread, all adverse.
* Perpetual funding is charged per holding period.
* When a bar's range contains BOTH the stop and the take-profit, the STOP
  is assumed to fill first (pessimistic).
* One position at a time, sized entirely by the Risk Engine.
* Trade lifecycle (breakeven / partial take-profit / ATR trailing stop) is
  optional and ported from the MT4 EA's breakeven/firstCut/deepTrailing model
  — it lets winners run instead of capping every trend trade at a fixed R:R.
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
    # Cap impact at 1000 bps (10%): in a real thin market the order simply
    # wouldn't fill at size, not at an absurd price. Without this, near-zero
    # early-history volume produces nonsensical fills and negative equity.
    return min(coeff * (notional / dollar_vol), 1000.0)


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
    advisor=None,
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
    lifecycle_cfg = cfg.get("risk", {}).get("trade_lifecycle", {}) or {}

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
        if advisor is not None and advisor.enabled:
            advisor.on_equity(bar.ts, equity)

        # 0) Walk-forward window boundary: stop trading past the test window
        #    and force-close any residual position at this bar's open.
        if trade_window is not None and i >= win_end:
            pending = None
            if pos is not None:
                equity = _close_leg(
                    pos, bar.open, "window_end", pos["qty"], bar, taker, fill_bps,
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
            pos = {
                "side": sig.side, "orig_qty": qty, "qty": qty, "entry_fill": entry_fill,
                "stop": sig.stop, "tp": sig.take_profit, "entry_ts": bar.ts,
                "entry_index": i, "strategy": sig.strategy, "reason": sig.reason,
                "risk_per_unit": abs(entry_fill - sig.stop), "features": fv,
                "breakeven_done": False, "partial_taken": False, "trail_active": False,
            }
            risk.register_open(bar.ts)

        # 2) Manage an open position against this bar's range: lifecycle first
        #    (breakeven / partial tp / trailing may adjust stop or shrink qty),
        #    then check the (possibly updated) stop/take-profit for exit.
        if pos is not None:
            atr_i = mf.atr[i] if i < len(mf.atr) else None
            equity = _update_lifecycle(
                pos, bar, atr_i, lifecycle_cfg, taker, fill_bps,
                funding_8h, bar_seconds, equity, trades, risk, impact_coeff
            )
            if pos["qty"] <= 1e-12:
                pos = None

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
                equity = _close_leg(
                    pos, exit_price, exit_reason, pos["qty"], bar, taker, fill_bps,
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
                ml_ok = (trade_filter is None) or trade_filter.should_trade(fv)
                # Max risk-critic veto (second opinion; can only block).
                max_ok = True
                if advisor is not None and advisor.enabled:
                    mctx = {
                        "ts": bar.ts, "regime": context["regime"], "side": sig.side,
                        "strategy": sig.strategy, "confidence": sig.confidence,
                        "news": context.get("news"), "onchain": context.get("onchain"),
                        "macro": context.get("macro"),
                        "risk_temp": risk.state.risk_temperature(),
                        "drawdown": risk.state.drawdown(),
                        "loss_streak": risk.state.loss_streak,
                    }
                    max_ok = advisor.advise(mctx)["verdict"] != "SKIP"
                if ml_ok and max_ok:
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
        equity = _close_leg(
            pos, last.close, "end_of_data", pos["qty"], last, taker, fill_bps,
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


def _close_leg(pos, exit_price, exit_reason, qty_leg, bar, taker, fill_bps,
              funding_8h, bar_seconds, equity, trades, risk,
              impact_coeff: float = 0.0) -> float:
    """Close ``qty_leg`` units of ``pos`` (may be a full or partial close).

    Entry fees are charged proportionally to the leg being closed (rather than
    upfront on the whole position), so partial take-profits and the final
    remainder each carry their fair share of cost — no double counting.
    """
    is_buy_exit = pos["side"] == "short"  # closing a short = buy
    exit_impact = _impact_bps(qty_leg, exit_price, bar, impact_coeff)
    exit_fill = _adverse(exit_price, is_buy_exit, fill_bps + exit_impact)
    entry_fee = taker * pos["entry_fill"] * qty_leg
    exit_fee = taker * exit_fill * qty_leg

    if pos["side"] == "long":
        gross = (exit_fill - pos["entry_fill"]) * qty_leg
    else:
        gross = (pos["entry_fill"] - exit_fill) * qty_leg

    held_bars = max(1, bar.ts // bar_seconds - pos["entry_ts"] // bar_seconds)
    notional = pos["entry_fill"] * qty_leg
    funding = notional * (funding_8h / 10_000.0) * (held_bars * bar_seconds) / (8 * 3600)

    fees = entry_fee + exit_fee
    pnl = gross - fees - funding
    equity += pnl

    rpu = pos.get("risk_per_unit", 0.0)
    r = pnl / (qty_leg * rpu) if rpu > 0 and qty_leg > 0 else 0.0
    trades.append(Trade(
        entry_ts=pos["entry_ts"], exit_ts=bar.ts, side=pos["side"],
        entry_price=pos["entry_fill"], exit_price=exit_fill, qty=qty_leg,
        fees=fees + funding, pnl=pnl, r_multiple=r, strategy=pos["strategy"],
        reason=pos["reason"], exit_reason=exit_reason, equity_after=equity,
        duration_bars=held_bars, features=pos.get("features", []),
    ))
    risk.register_close(bar.ts, pnl, equity, bar_seconds)
    pos["qty"] = max(0.0, pos["qty"] - qty_leg)
    return equity


def _update_lifecycle(pos, bar, atr, lc_cfg, taker, fill_bps, funding_8h,
                      bar_seconds, equity, trades, risk,
                      impact_coeff: float = 0.0) -> float:
    """Breakeven stop / partial take-profit / ATR trailing stop.

    Ported from the MT4 EA's breakeven -> firstCut -> deepTrailing lifecycle:
    once a trade is favorable, lock in cost, bank part of it, and let the
    remainder trail the move instead of capping every trend trade at a fixed
    R:R. All three are optional and off unless configured; each only ever
    tightens the stop (never loosens it) and only ever reduces size.
    """
    if not lc_cfg.get("enabled", False) or pos["qty"] <= 0:
        return equity
    rpu = pos.get("risk_per_unit", 0.0)
    if rpu <= 0:
        return equity

    is_long = pos["side"] == "long"
    favorable = bar.high if is_long else bar.low
    r_fav = ((favorable - pos["entry_fill"]) / rpu if is_long
             else (pos["entry_fill"] - favorable) / rpu)

    # 1) Partial take-profit ("firstCut"): bank part of the winner once it
    #    reaches partial_tp_at_r, at the exact price level (not the bar close).
    p_r = float(lc_cfg.get("partial_tp_at_r", 0) or 0)
    p_frac = float(lc_cfg.get("partial_tp_fraction", 0) or 0)
    if not pos["partial_taken"] and p_r > 0 and p_frac > 0 and r_fav >= p_r:
        target = pos["entry_fill"] + p_r * rpu if is_long else pos["entry_fill"] - p_r * rpu
        qty_leg = min(pos["qty"], pos["orig_qty"] * p_frac)
        if qty_leg > 0:
            equity = _close_leg(pos, target, "partial_tp", qty_leg, bar, taker,
                                fill_bps, funding_8h, bar_seconds, equity,
                                trades, risk, impact_coeff)
        pos["partial_taken"] = True
        if pos["qty"] <= 0:
            return equity

    # 2) Breakeven stop: once favorable by breakeven_at_r, move the stop to
    #    entry (+ a small buffer to cover round-trip cost) — never loosens.
    be_r = float(lc_cfg.get("breakeven_at_r", 0) or 0)
    if not pos["breakeven_done"] and be_r > 0 and r_fav >= be_r:
        buf = float(lc_cfg.get("breakeven_buffer_r", 0.0)) * rpu
        new_stop = pos["entry_fill"] + buf if is_long else pos["entry_fill"] - buf
        pos["stop"] = max(pos["stop"], new_stop) if is_long else min(pos["stop"], new_stop)
        pos["breakeven_done"] = True

    # 3) ATR trailing stop ("deepTrailing"): once favorable by
    #    trail_activate_at_r, trail behind the extreme by trail_atr_mult*ATR.
    #    The trailing stop REPLACES the fixed take-profit as the exit for the
    #    remainder (push tp to +/-infinity) — otherwise the original R:R cap
    #    still fires first and the trend never gets a chance to run further,
    #    which defeats the point of trailing (this was tested and confirmed:
    #    without it, total return and Sharpe were WORSE than the fixed-TP
    #    baseline, not better).
    trail_r = float(lc_cfg.get("trail_activate_at_r", 0) or 0)
    trail_mult = float(lc_cfg.get("trail_atr_mult", 0) or 0)
    if trail_r > 0 and trail_mult > 0 and r_fav >= trail_r and atr and atr > 0:
        trail_stop = favorable - trail_mult * atr if is_long else favorable + trail_mult * atr
        pos["stop"] = max(pos["stop"], trail_stop) if is_long else min(pos["stop"], trail_stop)
        if not pos["trail_active"]:
            pos["tp"] = float("inf") if is_long else float("-inf")
        pos["trail_active"] = True

    return equity
