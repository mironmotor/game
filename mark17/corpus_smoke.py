#!/usr/bin/env python3
"""Offline smoke for corpus ingest (Phase 10). No LLM, no network.

Proves the bulk path: a blob of text chunks into compile units, grows the
synapse graph (count delta), is idempotent (re-ingest hits the cache and adds
nothing), and prune_weak removes weak/stale edges without touching strong ones.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

os.environ["MAX17_GONKA_ENABLED"] = "false"

from mark17.corpus_ingest import chunk_text, ingest_text  # noqa: E402
from mark17.json_cli import _as_event, _build_stores, _handle_event  # noqa: E402
from mark17.semantic_compiler import SemanticCompiler  # noqa: E402


def _fail(msg: str) -> None:
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    raise SystemExit(1)


def _args() -> argparse.Namespace:
    return argparse.Namespace(
        no_llm=True, warmup=None, plasticity_threshold=0.7,
        ollama_model="qwen2.5:0.5b", ollama_host="http://127.0.0.1:11434",
    )


CORPUS = (
    "Max17 — это когнитивное ядро проекта Game. У него есть синапс-граф и векторная память. "
    "Семантический компилятор превращает речь в IR-код. Меркл-дерево даёт всю память одним тейком. "
    "Ультра-оркестратор сам решает, что делать в простое. Музыкальный слух оценивает треки. "
    "Голосовая сигнатура читает состояние пользователя по тембру и дрожанию. "
    "Bulk-ингест корпусов — путь к миллиону синапсов через настоящие смыслы."
)


def main() -> int:
    args = _args()
    chunks = chunk_text(CORPUS)
    if len(chunks) < 4:
        _fail(f"chunker produced too few chunks: {len(chunks)}")

    with tempfile.TemporaryDirectory(prefix="max17-corpus-") as d:
        stores = _build_stores(args, Path(d))
        compiler = SemanticCompiler(Path(d))

        before = stores.synapse_graph.count()
        r1 = ingest_text(CORPUS, source="smoke", compiler=compiler,
                         vector_memory=stores.vector_memory, synapse_graph=stores.synapse_graph)
        if r1["compiled"] < 3:
            _fail(f"too few chunks compiled: {r1}")
        if r1["synapses_added"] <= 0:
            _fail(f"ingest added no synapses: {r1}")
        if stores.synapse_graph.count() != before + r1["synapses_added"]:
            _fail("count() inconsistent with synapses_added")

        # Idempotent: re-ingest must hit the cache and add ~nothing.
        r2 = ingest_text(CORPUS, source="smoke", compiler=compiler,
                         vector_memory=stores.vector_memory, synapse_graph=stores.synapse_graph)
        if r2["cached"] < r1["compiled"] or r2["synapses_added"] != 0:
            _fail(f"re-ingest not idempotent: {r2}")

        # Pruning: a weak, old, single-evidence edge should be removed; a strong
        # fresh one must survive.
        g = stores.synapse_graph
        old = time.time() - 200000.0
        with g._conn() as c:
            c.execute(
                "INSERT INTO synapses(source_type,source_id,target_type,target_id,relation_type,weight,evidence_count,last_used,created_at,updated_at,metadata_json)"
                " VALUES('t','weak_a','t','weak_b','related_to',0.05,1,?,?,?,'{}')",
                (old, old, old),
            )
            c.execute(
                "INSERT INTO synapses(source_type,source_id,target_type,target_id,relation_type,weight,evidence_count,last_used,created_at,updated_at,metadata_json)"
                " VALUES('t','strong_a','t','strong_b','related_to',0.8,5,?,?,?,'{}')",
                (time.time(), time.time(), time.time()),
            )
        pruned = g.prune_weak()
        if pruned < 1:
            _fail("prune removed nothing despite a weak stale edge")
        rels = {(s["source_id"], s["target_id"]) for s in g.get_top_synapses(limit=500)}
        if ("strong_a", "strong_b") not in rels:
            _fail("prune wrongly removed the strong edge")

        # End-to-end via the event handler.
        ev = _handle_event(_as_event({"type": "ingest_corpus", "text": "Новый абзац про деплой ядра на M2 и фоновый ингест."}), args, stores)
        rep = ev.get("ingest") or {}
        if "Проглотил" not in (ev.get("answer") or {}).get("text", ""):
            _fail(f"event handler answer malformed: {ev.get('answer')}")

        out = {
            "ok": True,
            "chunks": len(chunks),
            "first_ingest": {k: r1[k] for k in ("compiled", "cached", "synapses_added")},
            "reingest_cached": r2["cached"],
            "pruned": pruned,
            "event_added": rep.get("synapses_added"),
        }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
