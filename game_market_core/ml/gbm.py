"""Gradient-boosted trees (pure stdlib) — Stage 6.

A small gradient boosting classifier (regression trees fit to the logistic
gradient) used as an ALTERNATIVE trade filter. It earns its place only by
beating BOTH take-all and the logistic baseline out-of-sample (see
training_pipeline.train_gbm); otherwise it ships inert. No numpy/sklearn.
"""

from __future__ import annotations

import json
import math


def _sigmoid(z: float) -> float:
    if z < -35:
        return 0.0
    if z > 35:
        return 1.0
    return 1.0 / (1.0 + math.exp(-z))


def _build_tree(X, resid, idx, depth, max_depth, min_samples):
    # Leaf: mean residual over the rows in this node.
    mean = sum(resid[i] for i in idx) / len(idx)
    if depth >= max_depth or len(idx) < 2 * min_samples:
        return {"leaf": mean}

    best = None  # (sse, feature, threshold, left_idx, right_idx)
    d = len(X[0])
    for f in range(d):
        vals = sorted({X[i][f] for i in idx})
        for a, b in zip(vals, vals[1:]):
            thr = (a + b) / 2
            left = [i for i in idx if X[i][f] <= thr]
            right = [i for i in idx if X[i][f] > thr]
            if len(left) < min_samples or len(right) < min_samples:
                continue
            lm = sum(resid[i] for i in left) / len(left)
            rm = sum(resid[i] for i in right) / len(right)
            sse = (sum((resid[i] - lm) ** 2 for i in left)
                   + sum((resid[i] - rm) ** 2 for i in right))
            if best is None or sse < best[0]:
                best = (sse, f, thr, left, right)
    if best is None:
        return {"leaf": mean}
    _, f, thr, left, right = best
    return {"feature": f, "threshold": thr,
            "left": _build_tree(X, resid, left, depth + 1, max_depth, min_samples),
            "right": _build_tree(X, resid, right, depth + 1, max_depth, min_samples)}


def _tree_predict(node, x):
    while "leaf" not in node:
        node = node["left"] if x[node["feature"]] <= node["threshold"] else node["right"]
    return node["leaf"]


class GradientBoostedClassifier:
    def __init__(self, feature_names: list[str] | None = None):
        self.feature_names = feature_names or []
        self.trees: list[dict] = []
        self.base: float = 0.0
        self.lr: float = 0.1
        self.threshold: float = 0.5
        self.approved: bool = False
        self.meta: dict = {}

    def fit(self, X, y, n_estimators: int = 40, lr: float = 0.1,
            max_depth: int = 3, min_samples: int = 8) -> None:
        if not X:
            return
        self.lr = lr
        p = max(1e-6, min(1 - 1e-6, sum(y) / len(y)))
        self.base = math.log(p / (1 - p))
        F = [self.base] * len(X)
        idx_all = list(range(len(X)))
        self.trees = []
        for _ in range(n_estimators):
            resid = [y[i] - _sigmoid(F[i]) for i in range(len(X))]
            tree = _build_tree(X, resid, idx_all, 0, max_depth, min_samples)
            self.trees.append(tree)
            for i in range(len(X)):
                F[i] += self.lr * _tree_predict(tree, X[i])

    def predict_proba(self, x: list[float]) -> float:
        if not self.trees:
            return 0.5
        F = self.base + self.lr * sum(_tree_predict(t, x) for t in self.trees)
        return _sigmoid(F)

    def predict(self, x: list[float]) -> int:
        return 1 if self.predict_proba(x) >= self.threshold else 0

    def should_trade(self, x: list[float]) -> bool:
        return True if not self.approved else self.predict_proba(x) >= self.threshold

    def save(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"kind": "gbm", "feature_names": self.feature_names,
                       "trees": self.trees, "base": self.base, "lr": self.lr,
                       "threshold": self.threshold, "approved": self.approved,
                       "meta": self.meta}, fh)

    @classmethod
    def load(cls, path: str) -> "GradientBoostedClassifier":
        with open(path, "r", encoding="utf-8") as fh:
            d = json.load(fh)
        m = cls(d.get("feature_names", []))
        m.trees = d["trees"]; m.base = d["base"]; m.lr = d["lr"]
        m.threshold = d.get("threshold", 0.5); m.approved = d.get("approved", False)
        m.meta = d.get("meta", {})
        return m
