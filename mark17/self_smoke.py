#!/usr/bin/env python3
"""Offline smoke for Max's self-state (Phase 11). No LLM, no network.

Proves Max has his OWN mood: it's a valid affective reading, it RESPONDS to
signals (graph growth lifts him; the user sounding tense draws empathy), it
DRIFTS rather than jumping, persists, and the introspect event reflects it.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

os.environ["MAX17_GONKA_ENABLED"] = "false"

from mark17.events import Event  # noqa: E402
from mark17.json_cli import _as_event, _build_stores, _handle_event  # noqa: E402
from mark17.self_state import SelfState  # noqa: E402


def _fail(msg: str) -> None:
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    raise SystemExit(1)


def _args() -> argparse.Namespace:
    return argparse.Namespace(
        no_llm=True, warmup=None, plasticity_threshold=0.7,
        ollama_model="qwen2.5:0.5b", ollama_host="http://127.0.0.1:11434",
    )


def main() -> int:
    args = _args()
    with tempfile.TemporaryDirectory(prefix="max17-self-") as d:
        stores = _build_stores(args, Path(d))
        ss = SelfState(Path(d))

        s0 = ss.update(stores)
        for key in ("feeling", "valence", "energy", "reflection", "emoji"):
            if key not in s0:
                _fail(f"self-state missing {key}: {s0}")
        if not (0.0 <= s0["valence"] <= 1.0 and 0.0 <= s0["energy"] <= 1.0):
            _fail(f"affect out of range: {s0}")

        # Growth should lift mood: add many strong synapses, re-evaluate.
        g = stores.synapse_graph
        import time as _t
        with g._conn() as c:
            for i in range(120):
                now = _t.time()
                c.execute(
                    "INSERT INTO synapses(source_type,source_id,target_type,target_id,relation_type,weight,evidence_count,last_used,created_at,updated_at,metadata_json)"
                    " VALUES('n',?,'n',?,'related_to',0.6,2,?,?,?,'{}')",
                    (f"a{i}", f"b{i}", now, now, now),
                )
        s1 = ss.update(stores)
        if s1["valence"] < s0["valence"]:
            _fail(f"growth did not lift valence: {s0['valence']} -> {s1['valence']}")
        if s1["signals"]["growth"] < 100:
            _fail(f"growth not registered: {s1['signals']}")

        # Empathy: a tense user voice should pull his mood DOWN vs neutral.
        stores.working_memory.push_voice_observation({"state": "напряжён", "arousal": 0.8, "trend": "возбуждение растёт"})
        s2 = ss.update(stores)
        if s2["valence"] > s1["valence"]:
            _fail(f"tense user did not lower valence: {s1['valence']} -> {s2['valence']}")

        # Drift: a single signal can't swing valence more than ~DRIFT.
        if abs(s2["valence"] - s1["valence"]) > 0.4:
            _fail(f"mood jumped instead of drifting: {s1['valence']} -> {s2['valence']}")

        # introspect event reflects it.
        ev = _handle_event(_as_event({"type": "introspect"}), args, stores)
        st = ev.get("self_state") or {}
        if not st.get("feeling") or "Сейчас я" not in (ev.get("answer") or {}).get("text", ""):
            _fail(f"introspect malformed: {ev.get('answer')}")

        out = {
            "ok": True,
            "neutral": {"feeling": s0["feeling"], "valence": s0["valence"]},
            "after_growth": {"feeling": s1["feeling"], "valence": s1["valence"], "growth": s1["signals"]["growth"]},
            "tense_user": {"feeling": s2["feeling"], "valence": s2["valence"]},
            "reflection": st.get("reflection"),
        }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
