#!/usr/bin/env python3
"""Offline smoke for the Phase 4 IVF scale path. No LLM, no network.

Two proofs:
  A) AnnIndex recall ≈ exact on synthetic clustered vectors, while touching far
     fewer rows than a full scan (the whole point of IVF).
  B) VectorMemory with the threshold lowered: the ANN path activates and returns
     essentially the same top hits as the exact path (no quality regression).
"""

from __future__ import annotations

import json
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def _fail(msg: str) -> None:
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    raise SystemExit(1)


def _normalize(m: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(m, axis=1, keepdims=True)
    n[n == 0] = 1.0
    return m / n


def part_a() -> dict:
    from mark17.ann_index import AnnIndex

    rng = np.random.default_rng(0)
    dim, n_clusters, per = 256, 40, 2000
    n = n_clusters * per  # 80_000 (> ANN_MIN_ROWS)
    centers = _normalize(rng.standard_normal((n_clusters, dim)))
    blocks = [centers[c] + 0.18 * rng.standard_normal((per, dim)) for c in range(n_clusters)]
    X = _normalize(np.vstack(blocks)).astype(np.float32)

    index = AnnIndex.build(X, min_rows=1000)  # force-build below the prod threshold
    if index is None:
        _fail("AnnIndex.build returned None")

    k = 10
    queries = X[rng.integers(0, n, size=200)] + 0.05 * rng.standard_normal((200, dim))
    queries = _normalize(queries).astype(np.float32)

    recalls, scanned = [], []
    t_exact = t_ann = 0.0
    for q in queries:
        t0 = time.perf_counter()
        exact_top = set(np.argsort(X @ q)[-k:].tolist())
        t_exact += time.perf_counter() - t0

        t0 = time.perf_counter()
        cand = index.candidates(q, n)
        sub = X[cand] @ q
        ann_top = set(cand[np.argsort(sub)[-k:]].tolist())
        t_ann += time.perf_counter() - t0

        recalls.append(len(exact_top & ann_top) / k)
        scanned.append(cand.size)

    mean_recall = float(np.mean(recalls))
    mean_scanned = float(np.mean(scanned))
    if mean_recall < 0.85:
        _fail(f"ANN recall@{k} too low: {mean_recall:.3f}")
    if mean_scanned > 0.5 * n:
        _fail(f"ANN scanned too many rows: {mean_scanned:.0f}/{n}")

    return {
        "n": n,
        "clusters": index.n_clusters,
        f"recall@{k}": round(mean_recall, 3),
        "rows_scanned_avg": round(mean_scanned),
        "scan_fraction": round(mean_scanned / n, 3),
        "speedup_x": round(t_exact / max(t_ann, 1e-9), 1),
    }


def part_b() -> dict:
    # Lower the activation threshold so a small store exercises the ANN path.
    import mark17.ann_index as ai
    import mark17.vector_memory as vm

    ai.ANN_MIN_ROWS = 150
    vm.ANN_MIN_ROWS = 150
    from mark17.events import Event

    with tempfile.TemporaryDirectory(prefix="max17-ann-") as d:
        mem = vm.VectorMemory(Path(d))
        for i in range(260):
            mem.remember(Event(type="user_message", payload={"text": f"заметка {i} про тему {i % 19} и деталь {i % 7}"}))
        mem._ensure_index()
        if mem._ann is None:
            _fail("VectorMemory ANN did not activate above lowered threshold")

        overlaps = []
        for qi in (12, 100, 187, 240):
            q = f"заметка {qi} про тему"
            ann_ids = {h.id for h in mem.recall(q, limit=5)}
            saved = mem._ann
            mem._ann = None  # force exact
            exact_ids = {h.id for h in mem.recall(q, limit=5)}
            mem._ann = saved
            if exact_ids:
                overlaps.append(len(ann_ids & exact_ids) / len(exact_ids))
        mean_overlap = float(np.mean(overlaps)) if overlaps else 0.0
        if mean_overlap < 0.6:
            _fail(f"ANN vs exact top-5 overlap too low in VectorMemory: {mean_overlap:.3f}")

    return {"rows": 260, "ann_active": True, "top5_overlap_vs_exact": round(mean_overlap, 3)}


def main() -> int:
    out = {"ok": True, "part_a_ann_index": part_a(), "part_b_vector_memory": part_b()}
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
