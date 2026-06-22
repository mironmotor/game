"""Risk Engine — the most important module in the system.

It decides whether a Signal may become a position and, if so, how large.
It enforces, in order: kill switch, daily/weekly loss limits, max daily
trades, loss-streak cooldown, spread filter, and finally position sizing
modulated by the internal risk temperature.

Risk modes
----------
conservative      : half risk, leverage capped at 1x.
balanced          : config as-is (default).
aggressive        : 1.5x risk (capped at 3% per trade), config leverage.
godmode_research  : permits the 100-300%/mo experiments — but is RESEARCH
                    ONLY. ``allow_live`` is False, so any live/paper executor
                    must refuse it. This is how we explore the user's target
                    without ever shipping a blow-up to real money.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from features.internal_state import InternalState
from risk.kill_switch import KillSwitch
from risk.position_sizing import size_position


@dataclass
class RiskDecision:
    allow: bool
    qty: float
    reason: str


class RiskEngine:
    def __init__(self, cfg: dict):
        r = cfg.get("risk", {})
        self.mode = r.get("mode", "balanced")
        self.start_equity = float(r.get("start_equity", 10000.0))
        self.max_daily_loss = float(r.get("max_daily_loss", 0.06))
        self.max_weekly_loss = float(r.get("max_weekly_loss", 0.12))
        self.max_daily_trades = int(r.get("max_daily_trades", 3))
        self.loss_streak_cooldown = int(r.get("loss_streak_cooldown", 3))
        self.max_spread_bps = float(r.get("max_spread_bps", 8.0))

        base_risk = float(r.get("max_risk_per_trade", 0.01))
        base_lev = float(r.get("max_leverage", 3.0))
        self.risk_per_trade, self.max_leverage, self.allow_live = self._apply_mode(
            base_risk, base_lev
        )

        self.kill = KillSwitch(max_drawdown_stop=float(r.get("max_drawdown_stop", 0.25)))
        self.state = InternalState()
        self.state.equity = self.start_equity
        self.state.peak_equity = self.start_equity
        self.kill.update(self.start_equity)

        # Rolling period accounting.
        self._cur_day = None
        self._cur_week = None
        self._day_start_equity = self.start_equity
        self._week_start_equity = self.start_equity
        self._trades_today = 0
        self._cooldown_until_ts = 0

    def _apply_mode(self, base_risk: float, base_lev: float) -> tuple[float, float, bool]:
        if self.mode == "conservative":
            return base_risk * 0.5, min(base_lev, 1.0), True
        if self.mode == "aggressive":
            return min(base_risk * 1.5, 0.03), base_lev, True
        if self.mode == "godmode_research":
            # Intentionally permissive — but research only, never live.
            return max(base_risk, 0.10), max(base_lev, 10.0), False
        return base_risk, base_lev, True  # balanced

    # ---- per-bar bookkeeping -----------------------------------------------
    def _roll_periods(self, ts: int, equity: float) -> None:
        day = ts // 86400
        week = ts // (86400 * 7)
        if day != self._cur_day:
            self._cur_day = day
            self._day_start_equity = equity
            self._trades_today = 0
        if week != self._cur_week:
            self._cur_week = week
            self._week_start_equity = equity

    def on_equity(self, ts: int, equity: float) -> None:
        self._roll_periods(ts, equity)
        self.kill.update(equity)

    def evaluate(self, ts: int, equity: float, entry: float, stop: float,
                 spread_bps: float) -> RiskDecision:
        self._roll_periods(ts, equity)

        if self.kill.tripped:
            return RiskDecision(False, 0.0, f"kill switch tripped: {self.kill.trip_reason}")

        if ts < self._cooldown_until_ts:
            return RiskDecision(False, 0.0, "loss-streak cooldown active")

        if self._trades_today >= self.max_daily_trades:
            return RiskDecision(False, 0.0, f"max daily trades reached ({self.max_daily_trades})")

        day_loss = (self._day_start_equity - equity) / self._day_start_equity
        if day_loss >= self.max_daily_loss:
            return RiskDecision(False, 0.0, f"daily loss limit hit ({day_loss:.1%})")

        week_loss = (self._week_start_equity - equity) / self._week_start_equity
        if week_loss >= self.max_weekly_loss:
            return RiskDecision(False, 0.0, f"weekly loss limit hit ({week_loss:.1%})")

        if spread_bps > self.max_spread_bps:
            return RiskDecision(False, 0.0, f"spread too wide ({spread_bps:.1f} bps)")

        qty = size_position(
            equity=equity,
            risk_pct=self.risk_per_trade,
            entry=entry,
            stop=stop,
            max_leverage=self.max_leverage,
            risk_temperature=self.state.risk_temperature(),
        )
        if qty <= 0:
            return RiskDecision(False, 0.0, "computed size is zero")
        return RiskDecision(True, qty, "ok")

    def register_open(self, ts: int) -> None:
        self._trades_today += 1

    def register_close(self, ts: int, pnl: float, equity: float, bar_seconds: int = 3600) -> None:
        self.state.update_trade(pnl, equity)
        self.kill.update(equity)
        if self.state.loss_streak >= self.loss_streak_cooldown:
            # Sit out a number of bars equal to the cooldown setting.
            self._cooldown_until_ts = ts + self.loss_streak_cooldown * bar_seconds
