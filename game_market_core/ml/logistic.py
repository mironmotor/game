"""Reusable logistic regression (pure stdlib) for Stage 5 learned models.

Shared core for the regime and news models so they get the same disciplined
behaviour as the Stage 4 trade filter: standardized inputs, L2-regularized
gradient descent, JSON persistence, and an ``approved`` flag that keeps a
model inert until it has been proven out-of-sample. No numpy/sklearn.
"""

from __future__ import annotations

import json
import math


def sigmoid(z: float) -> float:
    if z < -35:
        return 0.0
    if z > 35:
        return 1.0
    return 1.0 / (1.0 + math.exp(-z))


def log_loss(y: list[int], p: list[float]) -> float:
    eps = 1e-12
    return -sum(yi * math.log(pi + eps) + (1 - yi) * math.log(1 - pi + eps)
               for yi, pi in zip(y, p)) / max(1, len(y))


class LogisticRegression:
    def __init__(self, feature_names: list[str] | None = None):
        self.feature_names = feature_names or []
        self.weights: list[float] = []
        self.bias: float = 0.0
        self.mean: list[float] = []
        self.std: list[float] = []
        self.threshold: float = 0.5
        self.approved: bool = False
        self.meta: dict = {}

    def _fit_scaler(self, X: list[list[float]]) -> None:
        n, d = len(X), len(X[0])
        self.mean = [sum(r[j] for r in X) / n for j in range(d)]
        self.std = []
        for j in range(d):
            var = sum((r[j] - self.mean[j]) ** 2 for r in X) / n
            self.std.append(math.sqrt(var) or 1.0)

    def _z(self, x: list[float]) -> list[float]:
        return [(x[j] - self.mean[j]) / self.std[j] for j in range(len(x))]

    def fit(self, X, y, epochs: int = 400, lr: float = 0.2, l2: float = 1e-3) -> None:
        if not X:
            return
        self._fit_scaler(X)
        Xz = [self._z(r) for r in X]
        d = len(Xz[0])
        self.weights = [0.0] * d
        self.bias = 0.0
        n = len(Xz)
        for _ in range(epochs):
            gw = [0.0] * d
            gb = 0.0
            for row, label in zip(Xz, y):
                p = sigmoid(sum(self.weights[j] * row[j] for j in range(d)) + self.bias)
                err = p - label
                for j in range(d):
                    gw[j] += err * row[j]
                gb += err
            for j in range(d):
                self.weights[j] -= lr * (gw[j] / n + l2 * self.weights[j])
            self.bias -= lr * (gb / n)

    def predict_proba(self, x: list[float]) -> float:
        if not self.weights:
            return 0.5
        z = self._z(x)
        return sigmoid(sum(self.weights[j] * z[j] for j in range(len(z))) + self.bias)

    def predict(self, x: list[float]) -> int:
        return 1 if self.predict_proba(x) >= self.threshold else 0

    def save(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"feature_names": self.feature_names, "weights": self.weights,
                       "bias": self.bias, "mean": self.mean, "std": self.std,
                       "threshold": self.threshold, "approved": self.approved,
                       "meta": self.meta}, fh, indent=2)

    @classmethod
    def load(cls, path: str) -> "LogisticRegression":
        with open(path, "r", encoding="utf-8") as fh:
            d = json.load(fh)
        m = cls(d.get("feature_names", []))
        m.weights = d["weights"]; m.bias = d["bias"]
        m.mean = d["mean"]; m.std = d["std"]
        m.threshold = d.get("threshold", 0.5); m.approved = d.get("approved", False)
        m.meta = d.get("meta", {})
        return m
