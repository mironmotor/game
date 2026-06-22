"""Exchange execution adapter (Stage 4) — behind hard live limits.

This is the only place that could ever touch real money, so it is wrapped in
multiple independent safety gates. Live order placement is refused unless ALL
of these are true:
  * config execution.live == true
  * config execution.i_understand_risk == true   (explicit human opt-in)
  * risk mode allows live (godmode_research has allow_live = False)
  * API credentials are present in the environment (GMC_API_KEY/SECRET)
  * a concrete venue order implementation exists

By default it runs in DRY-RUN: it validates and logs orders but sends nothing.
Even when "live" is configured, the venue send is intentionally NOT
implemented here — going live is a deliberate, separate engineering step, not
a flag that silently starts trading. Per-order risk limits are enforced
regardless of mode.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class ExecResult:
    status: str       # "dry_run" | "rejected" | "sent"
    reason: str
    order: dict


class ExecutionAdapter:
    def __init__(self, cfg: dict, risk_engine):
        ex = cfg.get("execution", {})
        self.cfg_live = bool(ex.get("live", False))
        self.acknowledged = bool(ex.get("i_understand_risk", False))
        self.venue = ex.get("venue", "binance")
        self.risk = risk_engine
        self.has_keys = bool(os.environ.get("GMC_API_KEY") and os.environ.get("GMC_API_SECRET"))
        # Venue send is not implemented on purpose (see module docstring).
        self.venue_impl_available = False

    @property
    def live_enabled(self) -> bool:
        return (self.cfg_live and self.acknowledged and self.risk.allow_live
                and self.has_keys and self.venue_impl_available)

    def gate_reasons(self) -> list[str]:
        reasons = []
        if not self.cfg_live:
            reasons.append("execution.live is false")
        if not self.acknowledged:
            reasons.append("execution.i_understand_risk is false")
        if not self.risk.allow_live:
            reasons.append(f"risk mode '{self.risk.mode}' forbids live orders")
        if not self.has_keys:
            reasons.append("no API credentials in environment")
        if not self.venue_impl_available:
            reasons.append("venue send not implemented (deliberate safety stop)")
        return reasons

    def _validate_risk(self, order: dict) -> str | None:
        equity = self.risk.state.equity or self.risk.start_equity
        notional = abs(order.get("qty", 0.0)) * order.get("price", 0.0)
        if notional <= 0:
            return "non-positive notional"
        if notional > equity * self.risk.max_leverage:
            return (f"notional {notional:.2f} exceeds leverage cap "
                    f"{equity * self.risk.max_leverage:.2f}")
        if self.risk.kill.tripped:
            return f"kill switch tripped: {self.risk.kill.trip_reason}"
        return None

    def place_order(self, order: dict) -> ExecResult:
        violation = self._validate_risk(order)
        if violation:
            return ExecResult("rejected", violation, order)
        if not self.live_enabled:
            return ExecResult("dry_run", "; ".join(self.gate_reasons()), order)
        # Reaching here would mean every gate passed; we still refuse to send
        # because no real venue implementation is wired (by design).
        raise NotImplementedError(
            "Live order placement is not implemented. Implement the venue "
            "client explicitly and review risk limits before enabling.")
