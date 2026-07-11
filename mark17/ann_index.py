"""IVF approximate nearest-neighbour index — Phase 4 scale for Max17 recall.

VectorMemory recall is an exact cosine over every stored vector. That is fine for
tens of thousands of memories, but at ~1M×256 a full scan per query (and a 2GB
float64 matrix) stops being free. This module adds a classic IVF coarse
quantizer, pure-numpy and dependency-free:

  - cluster the L2-normed vectors into C centroids (deterministic k-means);
  - at query time score the C centroids, probe only the nearest ``nprobe`` of
    them, and return just those clusters' rows as candidates.

So a query touches ~N·nprobe/C rows instead of N. VectorMemory keeps the exact
cosine for the candidate set, so ranking quality stays identical to the exact
path for the rows it looks at; only far-away clusters are skipped. The index is
built once and persisted (npz); rows added after a build are always included as
candidates so fresh memories are never missed.

Activates only above a row threshold — below it VectorMemory stays fully exact.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np

# Don't bother clustering below this — a brute-force float32 cosine is a single
# fast BLAS matmul and stays competitive into the hundreds of thousands, while
# giving exact results. IVF earns its keep past this, where scanning ~1/6 of the
# rows meaningfully cuts the per-query memory bandwidth (and at 1M the float32
# matrix is already 1GB). Tunable per machine via MAX17_ANN_MIN_ROWS.
try:
    ANN_MIN_ROWS = max(1000, int(os.environ.get("MAX17_ANN_MIN_ROWS", "300000")))
except (TypeError, ValueError):
    ANN_MIN_ROWS = 300_000
# Rebuild when the store has grown/shrunk this fraction past the built size, so
# the centroids stay representative without rebuilding on every insert.
REBUILD_RATIO = 0.25
_ASSIGN_CHUNK = 50_000  # rows per matmul chunk during build (bounds transient RAM)


def _normalize_rows(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    return matrix / norms


def _assign(matrix: np.ndarray, centroids_n: np.ndarray) -> np.ndarray:
    """Nearest centroid (by cosine) for each row, chunked to bound memory."""
    n = matrix.shape[0]
    out = np.empty(n, dtype=np.int32)
    for start in range(0, n, _ASSIGN_CHUNK):
        end = min(start + _ASSIGN_CHUNK, n)
        sims = matrix[start:end] @ centroids_n.T  # (chunk, C)
        out[start:end] = np.argmax(sims, axis=1).astype(np.int32)
    return out


def _clusters_for(n: int) -> int:
    return int(min(4096, max(64, round(np.sqrt(n)))))


def default_nprobe(n_clusters: int) -> int:
    # Recall matters more than raw speed for a memory: probing ~1/6 of clusters
    # keeps recall high (~0.95) while still scanning only a fraction of all rows.
    return int(min(128, max(12, n_clusters // 6)))


class AnnIndex:
    def __init__(self, centroids: np.ndarray, assignments: np.ndarray, n_built: int) -> None:
        self.centroids = centroids.astype(np.float32, copy=False)
        self.centroids_n = _normalize_rows(self.centroids).astype(np.float32, copy=False)
        self.assignments = assignments.astype(np.int32, copy=False)
        self.n_built = int(n_built)
        self.dim = int(centroids.shape[1])
        self.n_clusters = int(centroids.shape[0])
        # Inverted lists: cluster id -> row indices (sorted once for slicing).
        order = np.argsort(self.assignments, kind="stable")
        sorted_assign = self.assignments[order]
        bounds = np.searchsorted(sorted_assign, np.arange(self.n_clusters + 1))
        self._order = order
        self._bounds = bounds

    # -- build -------------------------------------------------------------
    @classmethod
    def build(
        cls,
        matrix: np.ndarray,
        *,
        n_clusters: int | None = None,
        iters: int = 6,
        min_rows: int | None = None,
    ) -> "AnnIndex | None":
        n = int(matrix.shape[0])
        if n < (ANN_MIN_ROWS if min_rows is None else min_rows):
            return None
        k = n_clusters or _clusters_for(n)
        k = min(k, n)
        X = matrix.astype(np.float32, copy=False)
        # Deterministic init: evenly strided picks across the (insertion-ordered)
        # rows — reproducible, no RNG seed to thread through.
        init_idx = np.linspace(0, n - 1, k).astype(np.int64)
        centroids = X[init_idx].copy()
        assign = np.zeros(n, dtype=np.int32)
        for _ in range(max(1, iters)):
            centroids_n = _normalize_rows(centroids)
            assign = _assign(X, centroids_n)
            # Update centroids as the mean of their members; keep empty clusters
            # pinned to their previous position.
            sums = np.zeros_like(centroids)
            counts = np.bincount(assign, minlength=k).astype(np.float32)
            np.add.at(sums, assign, X)
            nonempty = counts > 0
            centroids[nonempty] = sums[nonempty] / counts[nonempty, None]
        return cls(centroids, assign, n)

    # -- query -------------------------------------------------------------
    def candidates(self, query: np.ndarray, n_total: int, *, nprobe: int | None = None) -> np.ndarray:
        """Row indices to score for this query: the nearest ``nprobe`` clusters'
        members, plus every row added after the index was built (so recent
        memories are never skipped)."""
        nprobe = nprobe or default_nprobe(self.n_clusters)
        nprobe = int(min(self.n_clusters, max(1, nprobe)))
        csims = self.centroids_n @ query.astype(np.float32, copy=False)
        probe = np.argpartition(-csims, nprobe - 1)[:nprobe] if nprobe < self.n_clusters else np.arange(self.n_clusters)
        parts: list[np.ndarray] = []
        for c in probe:
            lo, hi = self._bounds[c], self._bounds[c + 1]
            if hi > lo:
                parts.append(self._order[lo:hi])
        cand = np.concatenate(parts) if parts else np.empty(0, dtype=np.int64)
        if n_total > self.n_built:  # tail rows inserted after the build
            cand = np.concatenate([cand, np.arange(self.n_built, n_total, dtype=np.int64)])
        return np.unique(cand)

    def is_stale(self, n_total: int, *, dim: int) -> bool:
        if dim != self.dim or self.n_built == 0:
            return True
        return abs(n_total - self.n_built) / self.n_built > REBUILD_RATIO

    # -- persistence -------------------------------------------------------
    def save(self, path: Path) -> None:
        try:
            np.savez(
                path,
                centroids=self.centroids,
                assignments=self.assignments,
                n_built=np.int64(self.n_built),
            )
        except Exception:  # noqa: BLE001 - persistence is best-effort
            pass

    @classmethod
    def load(cls, path: Path) -> "AnnIndex | None":
        try:
            if not Path(path).exists():
                return None
            data = np.load(path)
            return cls(data["centroids"], data["assignments"], int(data["n_built"]))
        except Exception:  # noqa: BLE001 - a corrupt cache just rebuilds
            return None


# --------------------------------------------------------------------------- #
# HNSW full-corpus index (hnswlib). Unlike the IVF above (which narrows within
# the in-RAM capped matrix), this indexes ALL memory vectors by their sqlite id
# and returns (ids, sims) over the WHOLE corpus — recall then fetches meta only
# for the returned top-k, so search scales past RECALL_CAP toward 1M without
# loading all meta into RAM. Optional: if hnswlib is missing or anything fails,
# VectorMemory falls back to the exact capped-matrix path.
# --------------------------------------------------------------------------- #

try:
    import hnswlib  # type: ignore

    _HNSW_OK = True
except Exception:  # noqa: BLE001
    _HNSW_OK = False

# Below this many memories, the exact cosine over the capped matrix is already
# sub-millisecond — HNSW earns its keep only when the corpus exceeds the cap.
try:
    HNSW_MIN_ROWS = max(1000, int(os.environ.get("MAX17_HNSW_MIN_ROWS", "5000")))
except (TypeError, ValueError):
    HNSW_MIN_ROWS = 5000


class HnswIndex:
    """Full-corpus ANN over all memory vectors (hnswlib, cosine). Labels = ids."""

    def __init__(self, index: "object", dim: int, built_max_id: int) -> None:
        self._idx = index
        self.dim = int(dim)
        self.built_max_id = int(built_max_id)

    @staticmethod
    def available() -> bool:
        return _HNSW_OK

    @classmethod
    def build(cls, matrix: np.ndarray, ids: list[int], built_max_id: int) -> "HnswIndex | None":
        if not _HNSW_OK or matrix.shape[0] == 0 or not ids:
            return None
        try:
            n, dim = int(matrix.shape[0]), int(matrix.shape[1])
            idx = hnswlib.Index(space="cosine", dim=dim)
            idx.init_index(max_elements=max(n * 2, 1024), ef_construction=200, M=16)
            idx.add_items(matrix.astype(np.float32, copy=False), np.asarray(ids, dtype=np.int64))
            idx.set_ef(64)
            return cls(idx, dim, built_max_id)
        except Exception:  # noqa: BLE001
            return None

    def add(self, vector: list[float], row_id: int) -> None:
        try:
            if self._idx.get_current_count() >= self._idx.get_max_elements():
                self._idx.resize_index(self._idx.get_max_elements() * 2)
            self._idx.add_items(
                np.asarray([vector], dtype=np.float32), np.asarray([row_id], dtype=np.int64)
            )
        except Exception:  # noqa: BLE001
            pass

    def query(self, vector: list[float], k: int) -> tuple[list[int], list[float]]:
        try:
            count = int(self._idx.get_current_count())
            if count == 0:
                return [], []
            k = max(1, min(int(k), count))
            labels, dist = self._idx.knn_query(np.asarray([vector], dtype=np.float32), k=k)
            ids = [int(x) for x in labels[0].tolist()]
            sims = [1.0 - float(d) for d in dist[0].tolist()]  # cosine space: dist = 1 - cos
            return ids, sims
        except Exception:  # noqa: BLE001
            return [], []

    def save(self, path: Path) -> None:
        try:
            self._idx.save_index(str(path))
        except Exception:  # noqa: BLE001
            pass

    @classmethod
    def load(cls, path: Path, dim: int, count_hint: int, built_max_id: int) -> "HnswIndex | None":
        if not _HNSW_OK or not Path(path).exists():
            return None
        try:
            idx = hnswlib.Index(space="cosine", dim=int(dim))
            idx.load_index(str(path), max_elements=max(count_hint * 2, 1024))
            idx.set_ef(64)
            return cls(idx, dim, built_max_id)
        except Exception:  # noqa: BLE001
            return None
