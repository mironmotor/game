"""Macro feature engine (Stage 2+ stub).

Turns macro_loader series into regime features: risk-on/off, dollar
strength, inflation regime, rate cycle, recession-probability proxy, crisis
mode. Until macro data is wired, returns neutral defaults so the Meta
Controller can treat "no macro signal" as a valid, non-blocking state.
"""

from __future__ import annotations


def macro_state(ts: int, macro: dict | None = None) -> dict:
    return {
        "risk_on": 0.0,          # -1 risk-off .. +1 risk-on
        "dollar_strength": 0.0,
        "inflation_regime": "unknown",
        "rate_cycle": "unknown",
        "recession_prob": 0.0,
        "crisis_mode": False,
    }
