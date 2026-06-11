#!/usr/bin/env python3
"""Offline smoke for the semantic compiler (Phase 6). No LLM, no network.

Proves: deterministic fallback compile, the round-trip honesty gate, the
text-hash cache («кешированные графы»), the graph growth and the recall row —
the full speech→IR-code memory loop in no-LLM mode.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

os.environ["MAX17_GONKA_ENABLED"] = "false"

from mark17.json_cli import _as_event, _build_stores, _handle_event  # noqa: E402
from mark17.semantic_compiler import render_ir, verbalize  # noqa: E402
import argparse  # noqa: E402


def _fail(msg: str) -> None:
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    raise SystemExit(1)


def _args() -> argparse.Namespace:
    return argparse.Namespace(
        no_llm=True, warmup=None, plasticity_threshold=0.7,
        ollama_model="qwen2.5:0.5b", ollama_host="http://127.0.0.1:11434",
    )


def main() -> int:
    # Pure unit sanity: render + verbalize on a hand-written IR.
    units = [
        {"kind": "entity", "id": "marina", "attrs": {"age": 26, "rel": "friend-of user"}},
        {"kind": "event", "id": "rel_fail", "about": "marina", "attrs": {"what": "relationships", "count": 4, "outcome": "fail"}},
        {"kind": "cause", "from": "rel_fail", "to": "avoid_touch"},
    ]
    ir_text = render_ir(units)
    if "(cause rel_fail -> avoid_touch)" not in ir_text or "marina" not in ir_text:
        _fail(f"render_ir malformed: {ir_text!r}")
    if "приводит" not in verbalize(units):
        _fail("verbalize lost the cause link")

    text = "Марина моя подруга, ей 26 лет, у неё сын Матвей и она устала от неудачных отношений"
    args = _args()
    with tempfile.TemporaryDirectory(prefix="max17-sem-") as d:
        stores = _build_stores(args, Path(d))

        # 1) first compile: fallback compiler, must persist + verify round-trip.
        r1 = _handle_event(_as_event({"type": "compile_semantic", "text": text}), args, stores)
        ir1 = r1.get("semantic_ir") or {}
        if not ir1.get("units"):
            _fail(f"no units compiled: {ir1}")
        if ir1.get("cached"):
            _fail("first compile reported cached")
        if not ir1.get("verified"):
            _fail(f"fallback compile failed round-trip: sim={ir1.get('sim')}")

        # 2) same text again: must hit the cache («кешированный граф»).
        r2 = _handle_event(_as_event({"type": "compile_semantic", "text": text}), args, stores)
        ir2 = r2.get("semantic_ir") or {}
        if not ir2.get("cached"):
            _fail("second compile did not hit the cache")

        # 3) recall: the IR row must be findable semantically.
        hits = stores.vector_memory.recall("марина подруга отношения", limit=4)
        if not any(h.event_type == "semantic_ir" for h in hits):
            _fail(f"IR row not recallable: {[(h.event_type, h.summary[:40]) for h in hits]}")

        # 4) graph growth: ir_node edges exist.
        rels = [s for s in stores.synapse_graph.get_top_synapses(limit=60) if s.get("source_type") == "ir_node"]
        if not rels:
            _fail("no ir_node edges in synapse graph")

        out = {
            "ok": True,
            "first": {"units": len(ir1["units"]), "sim": ir1["sim"], "verified": ir1["verified"], "compiler": ir1["compiler"]},
            "cache_hit": ir2.get("cached"),
            "recall_hit": True,
            "ir_edges": len(rels),
            "ir_text": ir1.get("ir_text"),
        }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
