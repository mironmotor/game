"""Sequence model (Stage 7) — a tiny Elman RNN trained with BPTT, pure stdlib.

It reads a window of recent (scaled) log-returns and predicts P(next bar up).
This is a genuine recurrent sequence model — forward pass over time plus full
backpropagation-through-time — not a bag-of-lags fed to logistic regression.
Kept small (hidden=6, length=12) so it trains in seconds without numpy.

Like every learned component here, it must beat its baselines (majority class
AND "predict last move") OUT-OF-SAMPLE or it ships inert. On synthetic data
near-random returns it will not — which is the honest result, and exactly why
"predict the future from the past" is not a money printer.
"""

from __future__ import annotations

import json
import math
import os
import random

from config import load_config
from data.loaders.crypto_loader import load_crypto

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "seq_model.json")
H = 6          # hidden units
L = 12         # sequence length (bars)
MAX_SAMPLES = 2500


def _sigmoid(z):
    if z < -35: return 0.0
    if z > 35: return 1.0
    return 1.0 / (1.0 + math.exp(-z))


class SeqModel:
    def __init__(self):
        self.wxh = [0.0] * H
        self.Whh = [[0.0] * H for _ in range(H)]
        self.bh = [0.0] * H
        self.why = [0.0] * H
        self.by = 0.0
        self.ret_std = 1.0
        self.threshold = 0.5
        self.approved = False
        self.meta = {}

    def _init(self, seed=17):
        rng = random.Random(seed)
        s = 0.3
        self.wxh = [rng.uniform(-s, s) for _ in range(H)]
        self.Whh = [[rng.uniform(-s, s) for _ in range(H)] for _ in range(H)]
        self.why = [rng.uniform(-s, s) for _ in range(H)]

    def _forward(self, seq):
        hs = [[0.0] * H]
        for t in range(L):
            x = seq[t]
            h = [0.0] * H
            for i in range(H):
                a = self.wxh[i] * x + self.bh[i]
                row = self.Whh[i]
                prev = hs[t]
                for j in range(H):
                    a += row[j] * prev[j]
                h[i] = math.tanh(a)
            hs.append(h)
        logit = self.by + sum(self.why[i] * hs[L][i] for i in range(H))
        return _sigmoid(logit), hs

    def predict_proba(self, seq):
        return self._forward(seq)[0]

    def fit(self, X, y, epochs=4, lr=0.1, seed=17):
        self._init(seed)
        idx = list(range(len(X)))
        rng = random.Random(seed)
        for _ in range(epochs):
            rng.shuffle(idx)
            for n in idx:
                seq, label = X[n], y[n]
                p, hs = self._forward(seq)
                dlogit = p - label
                # output layer grads
                for i in range(H):
                    self.why[i] -= lr * dlogit * hs[L][i]
                self.by -= lr * dlogit
                dh = [self.why[i] * dlogit for i in range(H)]
                # BPTT
                for t in range(L, 0, -1):
                    h = hs[t]
                    da = [max(-5.0, min(5.0, dh[i] * (1 - h[i] * h[i]))) for i in range(H)]
                    x = seq[t - 1]
                    prev = hs[t - 1]
                    for i in range(H):
                        self.wxh[i] -= lr * da[i] * x
                        self.bh[i] -= lr * da[i]
                        row = self.Whh[i]
                        for j in range(H):
                            row[j] -= lr * da[i] * prev[j]
                    new_dh = [0.0] * H
                    for j in range(H):
                        s = 0.0
                        for i in range(H):
                            s += self.Whh[i][j] * da[i]
                        new_dh[j] = s
                    dh = new_dh

    def save(self, path):
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"wxh": self.wxh, "Whh": self.Whh, "bh": self.bh,
                       "why": self.why, "by": self.by, "ret_std": self.ret_std,
                       "threshold": self.threshold, "approved": self.approved,
                       "meta": self.meta, "H": H, "L": L}, fh)

    @classmethod
    def load(cls, path):
        with open(path, "r", encoding="utf-8") as fh:
            d = json.load(fh)
        m = cls()
        for k in ("wxh", "Whh", "bh", "why", "by", "ret_std", "threshold", "approved", "meta"):
            setattr(m, k, d[k])
        return m


def _build_dataset(cfg):
    candles = load_crypto(cfg)
    closes = [c.close for c in candles]
    rets = [0.0] + [math.log(closes[i] / closes[i - 1]) if closes[i - 1] > 0 else 0.0
                    for i in range(1, len(closes))]
    rows = []  # (raw_seq_returns, label, persistence_pred)
    for t in range(L, len(rets) - 1):
        seq = rets[t - L + 1:t + 1]
        label = 1 if rets[t + 1] > 0 else 0
        persistence = 1 if rets[t] > 0 else 0
        rows.append((seq, label, persistence))
    return rows


def train(cfg=None):
    cfg = cfg or load_config()
    print("== Train sequence model (Elman RNN, BPTT) ==")
    rows = _build_dataset(cfg)
    if len(rows) > MAX_SAMPLES:
        step = len(rows) // MAX_SAMPLES
        rows = rows[::step]
    print(f"Sequence samples: {len(rows)} (len={L}, hidden={H})")
    if len(rows) < 300:
        print("Too few samples (<300). Model stays inert.")
        return {"approved": False, "reason": "too_few"}

    cut = int(len(rows) * 0.7)
    train_rows, test_rows = rows[:cut], rows[cut:]
    # Scale by TRAIN return std only (no leakage).
    flat = [r for row in train_rows for r in row[0]]
    mean = sum(flat) / len(flat)
    std = math.sqrt(sum((x - mean) ** 2 for x in flat) / len(flat)) or 1.0

    def scale(seq):
        return [(x - mean) / std for x in seq]

    model = SeqModel()
    model.ret_std = std
    model.fit([scale(r[0]) for r in train_rows], [r[1] for r in train_rows])

    y_test = [r[1] for r in test_rows]
    preds = [1 if model.predict_proba(scale(r[0])) >= 0.5 else 0 for r in test_rows]
    model_acc = sum(1 for p, yi in zip(preds, y_test) if p == yi) / len(y_test)
    pos = sum(y_test) / len(y_test)
    majority_acc = max(pos, 1 - pos)
    persistence_acc = sum(1 for r in test_rows if r[2] == r[1]) / len(test_rows)
    baseline = max(majority_acc, persistence_acc)

    approved = model_acc > baseline + 0.01
    model.approved = approved
    model.meta = {"oos_acc": model_acc, "majority_acc": majority_acc,
                  "persistence_acc": persistence_acc, "up_rate": pos}
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    model.save(MODEL_PATH)

    print(f"OOS accuracy: model {model_acc:.1%} vs baseline {baseline:.1%} "
          f"(majority {majority_acc:.1%}, persistence {persistence_acc:.1%})")
    print("VERDICT:", "APPROVED — beats baselines OOS." if approved
          else "REJECTED — no edge over baselines. Saved INERT. "
               "(Expected: near-random returns are not predictable.)")
    print(f"Saved to: {MODEL_PATH}")
    return model.meta | {"approved": approved}


def load_model():
    return SeqModel.load(MODEL_PATH) if os.path.exists(MODEL_PATH) else None
