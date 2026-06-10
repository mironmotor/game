#!/usr/bin/env python3
"""Offline smoke for Phase 5 cross-cluster bridges. No LLM, no network.

Stores semantically-related memories of DIFFERENT event_types (proxy for
different clusters / modalities) and asserts bridge_distant wires an associative
"bridges" synapse across them — the insight link that will also connect a future
audio/vision state to related text memories.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.consolidation import ConsolidationEngine
from mark17.events import Event
from mark17.synapse_graph import SynapseGraph
from mark17.vector_memory import VectorMemory


def _fail(msg: str) -> None:
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    raise SystemExit(1)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="max17-bridge-") as d:
        state = Path(d)
        vm = VectorMemory(state)
        graph = SynapseGraph(state)

        # Same topic ("камера/свет"), different modalities/clusters.
        vm.remember(Event(type="user_message", payload={"text": "включи камеру и следи за освещением в комнате"}))
        vm.remember(Event(type="environment_observation", payload={"text": "камера активна, освещение низкое, движение в комнате"}))
        # An unrelated pair that should NOT bridge to the above.
        vm.remember(Event(type="user_message", payload={"text": "посчитай факториал числа и напиши тест"}))
        vm.remember(Event(type="terminal_error", payload={"text": "ModuleNotFoundError no module named torch"}))

        engine = ConsolidationEngine(None, vm, graph)
        res = engine.bridge_distant(limit=8, min_sim=0.12)

        if res["bridges_created"] < 1:
            _fail(f"no bridges created: {res}")

        # A bridge must span two different event_types.
        spans = [b for b in res["bridges"] if b["a_type"] != b["b_type"]]
        if not spans:
            _fail(f"bridges did not span clusters: {res['bridges']}")

        # And the graph must now hold a "bridges" synapse.
        rels = {s.get("relation_type") for s in graph.get_top_synapses(limit=50)}
        if "bridges" not in rels:
            _fail(f"no 'bridges' synapse in graph; relations={rels}")

    print(json.dumps({"ok": True, **res}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
