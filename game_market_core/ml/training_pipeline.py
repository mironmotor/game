"""Training pipeline (Stage 2+ stub).

Plan: build leakage-safe datasets from the feature engine with strict
time-based train/validation/test splits, train the baseline models above,
log metrics, and persist artifacts. No model is allowed into the live path
until it beats a trivial baseline out-of-sample. Optional deps (scikit-learn,
LightGBM/XGBoost) live in requirements.txt under the ML extras.
"""

from __future__ import annotations


def train(*args, **kwargs):
    raise NotImplementedError("Training pipeline arrives in Stage 2.")
