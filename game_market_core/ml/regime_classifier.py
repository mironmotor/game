"""Regime classifier (Stage 2 stub).

Goal: label each bar as trend / range / crisis / euphoria from volatility,
trend strength, and (later) macro features. Baseline will be a transparent
rule set, then logistic regression / random forest. The Meta Controller uses
the label to enable/disable engines. Returns "unknown" until trained.
"""

from __future__ import annotations


def classify_regime(features: dict | None = None) -> str:
    return "unknown"
