"""Trade filter meta-model (Stage 4 stub).

Goal: NOT to predict price. It predicts whether a strategy's proposed trade
is worth taking — P(profitable | features) — and vetoes low-probability
setups. Baselines first (logistic regression / gradient boosting if
available), sequence models only after a baseline beats "always take".
Returns 1.0 (take) until trained so it never silently blocks Stage 1.
"""

from __future__ import annotations


def should_trade_probability(features: dict | None = None) -> float:
    return 1.0
