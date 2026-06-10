#!/usr/bin/env python3
"""Offline smoke for the voice decomposer pipeline (sound → state). No LLM/network.

Feeds three synthetic voice_observation events (excited / tired / calm prosody)
through the full event pipeline and asserts: correct state classification, a
human answer from voice_state, the reading stored in vector memory (so Phase 5
bridges can link it), and a persisted trend history.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import os

os.environ["MAX17_GONKA_ENABLED"] = "false"

from mark17.json_cli import _as_event, _build_stores, _handle_event


def _fail(msg: str) -> None:
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    raise SystemExit(1)


def _args() -> argparse.Namespace:
    return argparse.Namespace(
        no_llm=True,
        warmup=None,
        plasticity_threshold=0.7,
        ollama_model="qwen2.5:0.5b",
        ollama_host="http://127.0.0.1:11434",
    )


CASES = [
    (
        "excited",
        {"energy": 0.85, "pitch_hz": 210, "pitch_var": 68.0, "tempo": 4.6, "pause_ratio": 0.12, "voiced_ratio": 0.85, "duration_sec": 6.0},
        "возбуждён",
    ),
    (
        "tired",
        {"energy": 0.15, "pitch_hz": 120, "pitch_var": 12.0, "tempo": 1.6, "pause_ratio": 0.6, "voiced_ratio": 0.4, "duration_sec": 7.0},
        "устал",
    ),
    (
        "calm",
        {"energy": 0.3, "pitch_hz": 140, "pitch_var": 18.0, "tempo": 2.3, "pause_ratio": 0.35, "voiced_ratio": 0.6, "duration_sec": 5.0},
        "спокоен",
    ),
]


def main() -> int:
    args = _args()
    out_cases = []
    with tempfile.TemporaryDirectory(prefix="max17-voice-") as d:
        state_dir = Path(d)
        stores = _build_stores(args, state_dir)
        for name, voice, expected in CASES:
            event = _as_event({"type": "voice_observation", "voice": voice, "text": f"тест {name}"})
            result = _handle_event(event, args, stores)
            analysis = result.get("voice") or {}
            answer = (result.get("answer") or {}).get("text", "")
            if analysis.get("state") != expected:
                _fail(f"{name}: expected state {expected!r}, got {analysis.get('state')!r}")
            if not answer or "голос" not in answer.lower():
                _fail(f"{name}: no voice answer, got {answer!r}")
            out_cases.append({"name": name, "state": analysis.get("state"), "arousal": analysis.get("arousal"), "trend": analysis.get("trend"), "answer": answer})

        # Memory: the reading must be recallable semantically (bridges feed off this).
        hits = stores.vector_memory.recall("по голосу пользователь возбуждён", limit=3)
        if not hits or not any(h.event_type == "voice_observation" for h in hits):
            _fail(f"voice reading not in vector memory: {[ (h.event_type, h.summary[:40]) for h in hits ]}")

        # Trend history persisted (3 readings).
        history = stores.working_memory.get_voice_history()
        if len(history) != 3:
            _fail(f"voice history expected 3 entries, got {len(history)}")

    print(json.dumps({"ok": True, "cases": out_cases, "memory_hit": hits[0].summary[:60], "history": len(history)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
