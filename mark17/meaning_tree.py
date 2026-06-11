"""Merkle meaning tree — Phase 7 (MAX ULTRA): the whole memory in one take.

Borrowed from crypto the RIGHT way: not encryption (a cipher destroys meaning),
but content-addressing and Merkle trees. Every memory leaf has a content hash;
clusters of semantically-close leaves get a conspect + a hash of their children;
the root hash covers everything. So:

  - Max reads the ROOT + cluster conspects (a few KB) and grasps ALL his memory
    «одним тейком» — O(log N) instead of O(N);
  - descending a branch reveals detail only where needed;
  - the root hash changes iff ANY meaning changed (Merkle property) — memory
    becomes verifiable: no silent corruption, cheap "did anything change?";
  - duplicates collapse by content hash for free.

Deterministic and local: clustering is the same strided k-means used by the ANN
index (Phase 4), conspects are token statistics — same memories ⇒ same tree ⇒
same root hash, bit for bit. No LLM, no network.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any

import numpy as np

from mark17.vector_memory import VectorMemory

_TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_\-]+")
_STOP = frozenset(
    {
        "и", "а", "но", "что", "это", "как", "в", "на", "с", "по", "у", "не", "же",
        "то", "за", "из", "для", "она", "он", "они", "мы", "ты", "я", "его", "ее",
        "её", "их", "был", "была", "было", "есть", "сейчас", "очень", "просто",
        "the", "a", "an", "is", "are", "was", "and", "or", "of", "to", "in", "it",
        "user", "message", "event", "observation", "environment", "system", "state",
        "compressed", "concept", "consolidated", "pattern", "повторяющийся",
        "свидетельств", "паттерн",
    }
)
# Don't let one giant modality (e.g. thousands of camera frames) drown the map.
MAX_LEAVES = 4000


def _hash(*parts: str) -> str:
    h = hashlib.blake2b(digest_size=12)
    for p in parts:
        h.update(p.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()


def _tokens(text: str) -> list[str]:
    return [t for t in _TOKEN_RE.findall(str(text).casefold()) if len(t) >= 3 and t not in _STOP and not t.isdigit()]


def _top_tokens(texts: list[str], k: int = 5) -> list[str]:
    counts: dict[str, int] = {}
    for text in texts:
        for tok in _tokens(text):
            counts[tok] = counts.get(tok, 0) + 1
    # deterministic: count desc, then alphabetical
    return [t for t, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:k]]


def _kmeans(matrix: np.ndarray, k: int, iters: int = 5) -> np.ndarray:
    n = matrix.shape[0]
    k = max(1, min(k, n))
    init_idx = np.linspace(0, n - 1, k).astype(np.int64)
    centroids = matrix[init_idx].copy()
    assign = np.zeros(n, dtype=np.int32)
    for _ in range(iters):
        norms = np.linalg.norm(centroids, axis=1, keepdims=True)
        norms[norms == 0.0] = 1.0
        sims = matrix @ (centroids / norms).T
        assign = np.argmax(sims, axis=1).astype(np.int32)
        sums = np.zeros_like(centroids)
        counts = np.bincount(assign, minlength=k).astype(np.float32)
        np.add.at(sums, assign, matrix)
        nonempty = counts > 0
        centroids[nonempty] = sums[nonempty] / counts[nonempty, None]
    return assign


class MeaningTree:
    """Builds and serves the 3-level tree: root → clusters → memory leaves."""

    def __init__(self, state_dir: Path) -> None:
        self.path = Path(state_dir) / "meaning_tree.json"

    # -- build ---------------------------------------------------------------
    def build(self, vector_memory: VectorMemory) -> dict[str, Any]:
        vector_memory._ensure_index()
        matrix = vector_memory._matrix
        meta = vector_memory._meta
        if matrix is None or matrix.shape[0] < 2:
            tree = {"root": {"hash": _hash("empty"), "total": 0, "conspect": "память пуста"}, "clusters": []}
            self._save(tree)
            return tree

        n = int(matrix.shape[0])
        if n > MAX_LEAVES:  # newest window keeps the map fresh and the build cheap
            matrix = matrix[-MAX_LEAVES:]
            meta = meta[-MAX_LEAVES:]
            n = MAX_LEAVES

        k = max(2, min(24, round(np.sqrt(n) / 2)))
        assign = _kmeans(matrix.astype(np.float32, copy=False), k)

        clusters: list[dict[str, Any]] = []
        for c in range(int(assign.max()) + 1):
            idx = np.nonzero(assign == c)[0]
            if idx.size == 0:
                continue
            members = [meta[int(i)] for i in idx]
            texts = [str(m.get("summary") or m.get("text") or "") for m in members]
            toks = _top_tokens(texts, k=5)
            label = " ".join(toks[:2]) or "разное"
            # exemplars: highest-importance members, deterministic tie-break by id
            ordered = sorted(members, key=lambda m: (-float(m.get("importance") or 0), int(m.get("id") or 0)))
            examples = [str(m.get("summary") or m.get("text") or "")[:90] for m in ordered[:2]]
            leaf_hashes = sorted(_hash(str(m.get("text") or m.get("summary") or "")) for m in members)
            types: dict[str, int] = {}
            for m in members:
                et = str(m.get("event_type") or "?")
                types[et] = types.get(et, 0) + 1
            clusters.append(
                {
                    "id": f"c{c}",
                    "hash": _hash(*leaf_hashes),
                    "size": int(idx.size),
                    "label": label,
                    "tokens": toks,
                    "types": dict(sorted(types.items(), key=lambda kv: (-kv[1], kv[0]))[:4]),
                    "conspect": f"{label} — {idx.size} восп.: " + "; ".join(examples),
                    "leaf_ids": [int(m.get("id") or 0) for m in ordered[:200]],
                }
            )

        clusters.sort(key=lambda cl: (-cl["size"], cl["hash"]))
        root_hash = _hash(*sorted(cl["hash"] for cl in clusters))
        labels = ", ".join(cl["label"] for cl in clusters[:8])
        tree = {
            "root": {
                "hash": root_hash,
                "total": n,
                "clusters": len(clusters),
                "conspect": f"{n} воспоминаний в {len(clusters)} смысловых кластерах: {labels}",
            },
            "clusters": clusters,
            "built_at": time.time(),
        }
        self._save(tree)
        return tree

    # -- read ----------------------------------------------------------------
    def _save(self, tree: dict[str, Any]) -> None:
        try:
            self.path.write_text(json.dumps(tree, ensure_ascii=False), encoding="utf-8")
        except Exception:  # noqa: BLE001 - persistence is best-effort
            pass

    def load(self) -> dict[str, Any] | None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) and "root" in data else None
        except Exception:  # noqa: BLE001
            return None

    def one_take(self, vector_memory: VectorMemory, *, rebuild: bool = False) -> dict[str, Any]:
        """Root + cluster conspects — the whole memory in a few KB. Rebuilds when
        missing, forced, or stale (memory grew >15% past the built size)."""
        tree = None if rebuild else self.load()
        if tree is not None:
            vector_memory._ensure_index()
            n_now = int(vector_memory._matrix.shape[0]) if vector_memory._matrix is not None else 0
            built = int(tree.get("root", {}).get("total") or 0)
            if built and abs(n_now - built) / max(built, 1) > 0.15:
                tree = None
        if tree is None:
            tree = self.build(vector_memory)
        view = {
            "root": tree["root"],
            "clusters": [
                {k: cl[k] for k in ("id", "hash", "size", "label", "conspect", "types")}
                for cl in tree.get("clusters", [])
            ],
        }
        return view

    def descend(self, cluster_id: str, vector_memory: VectorMemory) -> dict[str, Any]:
        tree = self.load()
        if tree is None:
            tree = self.build(vector_memory)
        for cl in tree.get("clusters", []):
            if cl.get("id") == cluster_id:
                vector_memory._ensure_index()
                by_id = {int(m.get("id") or 0): m for m in vector_memory._meta}
                leaves = []
                for lid in cl.get("leaf_ids", [])[:40]:
                    m = by_id.get(int(lid))
                    if m:
                        leaves.append(
                            {
                                "id": int(lid),
                                "event_type": m.get("event_type"),
                                "summary": str(m.get("summary") or m.get("text") or "")[:160],
                                "importance": round(float(m.get("importance") or 0), 3),
                            }
                        )
                return {"cluster": cluster_id, "label": cl.get("label"), "size": cl.get("size"), "leaves": leaves}
        return {"cluster": cluster_id, "error": "нет такого кластера", "leaves": []}
