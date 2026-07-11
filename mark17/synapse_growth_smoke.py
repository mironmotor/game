#!/usr/bin/env python3
"""Offline smoke for self-seeded growth (Phase 3). No LLM, no network.

Proves the core can ask its OWN questions: it mines readable topics from the
graph's strongest edges, skips hex stable-ids and structural scaffolding, and
respects the ledger's known-keys so it never re-asks what it already learned.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.curiosity import _topic_key
from mark17.synapse_graph import BulkRecord, SynapseGraph
from mark17.synapse_growth import _HEX16, _STRUCTURAL, propose_seeds


def _fail(msg: str) -> None:
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    raise SystemExit(1)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="max17-selfgrow-") as d:
        graph = SynapseGraph(Path(d))

        # kNN forge can emit the same undirected pair twice in one flush. The
        # batch writer must collapse it before INSERT instead of tripping the
        # graph's unique index.
        duplicate = BulkRecord(
            source_type="memory",
            source_id="0123456789abcdef",
            target_type="memory",
            target_id="fedcba9876543210",
            relation_type="similar_to",
            weight=0.8,
            metadata={"forge": True},
        )
        if graph.bulk_upsert([duplicate, duplicate]) != 1 or graph.count() != 1:
            _fail("bulk_upsert did not collapse duplicate keys")

        # Salient, readable concept/topic edges -> should become seeds.
        readable = [
            ("concept", "webrtc", "topic", "видеосвязь", "event grounded in concept: webrtc", 0.9, 8),
            ("concept", "вектор embedding", "topic", "поиск по смыслу", "label supports topic: вектор embedding", 0.85, 6),
            ("intent", "debugging", "route", "code", "intent:debugging usually routes to code", 0.8, 5),
            ("concept", "синапс граф", "goal", "0a1b2c3d4e5f6071", "concept синапс граф supports goal", 0.78, 4),
        ]
        # Pure-scaffolding / hex edges -> must NOT become seeds.
        noise = [
            ("event", "0123456789abcdef", "goal", "fedcba9876543210", "event produced a human-readable answer", 0.95, 9),
            ("goal", "abcdef0123456789", "plan", "0f1e2d3c4b5a6978", "goal creates plan for goal", 0.92, 7),
        ]
        for st, si, tt, ti, summary, w, ev in readable + noise:
            for _ in range(ev):  # bump evidence_count via repeated upserts
                graph.upsert(
                    source_type=st, source_id=si, target_type=tt, target_id=ti,
                    relation_type="related_to", weight=w, metadata={"summary": summary},
                )

        seeds = propose_seeds(graph, limit=5)
        if not seeds:
            _fail("propose_seeds returned nothing from a populated graph")

        # No seed may be a hex node id or pure structural scaffolding.
        for seed in seeds:
            if _HEX16.match(seed.replace(" ", "")):
                _fail(f"hex stable-id leaked into seeds: {seed!r}")
            toks = seed.split()
            if toks and all(t in _STRUCTURAL for t in toks):
                _fail(f"purely structural seed: {seed!r}")

        # The strong readable concepts should surface.
        joined = " | ".join(seeds)
        if "webrtc" not in joined:
            _fail(f"expected salient concept 'webrtc' among seeds, got {seeds}")

        # avoid: once a topic is 'known', it must not be re-proposed.
        known = {_topic_key(seeds[0])}
        seeds2 = propose_seeds(graph, limit=5, avoid=known)
        if any(_topic_key(s) in known for s in seeds2):
            _fail(f"avoid set ignored: {seeds[0]!r} re-proposed in {seeds2}")

    print(json.dumps({"ok": True, "seeds": seeds, "after_avoid": seeds2}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
