"""Volatility/stop-based position sizing.

Size is derived from the distance to the stop so that a stop-out costs a
fixed fraction of equity (modulated by the internal risk temperature), then
capped by a hard leverage limit. We never size from a profit target or a
fixed notional — risk is the anchor.
"""

from __future__ import annotations


def size_position(
    equity: float,
    risk_pct: float,
    entry: float,
    stop: float,
    max_leverage: float,
    risk_temperature: float = 1.0,
) -> float:
    per_unit_risk = abs(entry - stop)
    if per_unit_risk <= 0 or equity <= 0 or entry <= 0:
        return 0.0
    risk_amount = equity * risk_pct * max(0.0, min(1.0, risk_temperature))
    qty = risk_amount / per_unit_risk
    # Hard leverage cap on notional exposure.
    max_qty = (equity * max_leverage) / entry
    return max(0.0, min(qty, max_qty))
