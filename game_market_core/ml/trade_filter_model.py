"""Trade filter meta-model — pure-stdlib logistic regression.

It does NOT predict price. It predicts P(trade is profitable | features) and
is used to VETO low-probability setups. Implemented without numpy/sklearn so
Stage 4 runs out of the box; a LightGBM/XGBoost version can replace it later
(requirements.txt ML extras) but must beat this baseline out-of-sample.

The model is only allowed to act when ``approved`` is True — i.e. when the
training pipeline proved it improves out-of-sample expectancy versus taking
every signal. Otherwise it stays inert (predict-take), so a bad model can
never silently degrade the system.
"""

from __future__ import annotations

import json
import math
import random


def _sigmoid(z: float) -> float:
    if z < -35:
        return 0.0
    if z > 35:
        return 1.0
    return 1.0 / (1.0 + math.exp(-z))


class TradeFilterModel:
    def __init__(self, feature_names: list[str] | None = None):
        self.feature_names = feature_names or []
        self.weights: list[float] = []
        self.bias: float = 0.0
        self.mean: list[float] = []
        self.std: list[float] = []
        self.threshold: float = 0.5
        self.approved: bool = False

    # ---- training ----------------------------------------------------------
    def _standardize_fit(self, X: list[list[float]]) -> None:
        n, d = len(X), len(X[0])
        self.mean = [sum(row[j] for row in X) / n for j in range(d)]
        self.std = []
        for j in range(d):
            var = sum((row[j] - self.mean[j]) ** 2 for row in X) / n
            self.std.append(math.sqrt(var) or 1.0)

    def _z(self, x: list[float]) -> list[float]:
        return [(x[j] - self.mean[j]) / self.std[j] for j in range(len(x))]

    def fit(self, X: list[list[float]], y: list[int], epochs: int = 400,
            lr: float = 0.2, l2: float = 1e-3, seed: int = 17) -> None:
        if not X:
            return
        self._standardize_fit(X)
        Xz = [self._z(row) for row in X]
        d = len(Xz[0])
        self.weights = [0.0] * d
        self.bias = 0.0
        n = len(Xz)
        for _ in range(epochs):
            gw = [0.0] * d
            gb = 0.0
            for row, label in zip(Xz, y):
                p = _sigmoid(sum(self.weights[j] * row[j] for j in range(d)) + self.bias)
                err = p - label
                for j in range(d):
                    gw[j] += err * row[j]
                gb += err
            for j in range(d):
                self.weights[j] -= lr * (gw[j] / n + l2 * self.weights[j])
            self.bias -= lr * (gb / n)

    # ---- inference ---------------------------------------------------------
    def predict_proba(self, x: list[float]) -> float:
        if not self.weights:
            return 1.0  # untrained -> never blocks
        z = self._z(x)
        return _sigmoid(sum(self.weights[j] * z[j] for j in range(len(z))) + self.bias)

    def should_trade(self, x: list[float]) -> bool:
        if not self.approved:
            return True  # inert until proven out-of-sample
        return self.predict_proba(x) >= self.threshold

    # ---- persistence -------------------------------------------------------
    def save(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({
                "feature_names": self.feature_names, "weights": self.weights,
                "bias": self.bias, "mean": self.mean, "std": self.std,
                "threshold": self.threshold, "approved": self.approved,
            }, fh, indent=2)

    @classmethod
    def load(cls, path: str) -> "TradeFilterModel":
        with open(path, "r", encoding="utf-8") as fh:
            d = json.load(fh)
        m = cls(d.get("feature_names", []))
        m.weights = d["weights"]; m.bias = d["bias"]
        m.mean = d["mean"]; m.std = d["std"]
        m.threshold = d["threshold"]; m.approved = d["approved"]
        return m
