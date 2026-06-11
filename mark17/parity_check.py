#!/usr/bin/env python3
"""Parity check: warm (persistent) path must equal one-shot path.

Feeds an identical battery of events to two fresh ephemeral state dirs:
  - "oneshot": rebuild every store per event (what json_cli.py does today);
  - "warm":    build one set of stores and reuse it (what serve.py does).

Both dirs start empty and process the exact same ordered sequence, so their
per-event outputs must match after dropping volatile fields (timestamps,
latencies) and rounding floats. This proves serve.py does not change behavior.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

# Parity tests the DETERMINISTIC core; the LLM voice layer is non-deterministic
# and out of scope. Disable it explicitly so a selected model (HUD selector /
# llm_active.json) can't make the answer step call out to a model here.
os.environ["MAX17_GONKA_ENABLED"] = "false"

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.json_cli import _as_event, _build_stores, _handle_event, normalize

VOLATILE_KEYS = frozenset(
    {
        "ts",
        "latency_ms",
        "timestamp",
        "last_used",
        "created_at",
        "updated_at",
    }
)

BATTERY: list[dict[str, Any]] = [
    {"type": "user_message", "text": "привет"},
    {"type": "user_message", "text": "Делаем дальше Max17, растим ядро и память"},
    {"type": "user_message", "text": "ModuleNotFoundError: No module named 'torch'"},
    {"type": "user_message", "text": "что ты помнишь про ядро?"},
    {"type": "task_created", "task": {"desc": "Связать concept grounding с памятью"}},
    {"type": "terminal_error", "line": "Traceback (most recent call last): ValueError"},
    {"type": "system_state", "cpu": 0.4, "ram": 0.7},
    {"type": "environment_observation", "camera": {"brightness": 0.3, "scene_mode": "desk"}},
    {"type": "environment_observation", "camera": {"active": True, "brightness": 0.12, "motion_level": "moving", "scene_mode": "active-room", "light_level": "low"}},
    {"type": "voice_observation", "voice": {"energy": 0.7, "pitch_hz": 180, "pitch_var": 62.0, "tempo": 4.2, "pause_ratio": 0.18, "voiced_ratio": 0.8, "duration_sec": 6.0}, "text": "паритетный голосовой кадр"},
    {"type": "compile_semantic", "text": "Марина моя подруга, ей 26, у неё сын Матвей"},
    {"type": "meaning_tree", "action": "rebuild"},
    {"type": "ultra_think"},
    {"type": "compress_memory", "text": "recall, semantic search, consolidation, synapse growth"},
    {"type": "sleep_consolidation", "limit": 20},
    {"type": "outcome_success", "text": "маленький шаг сработал", "score": 0.9},
    {"type": "graph_stats"},
    {"type": "neural_seed", "max_new": 50},
    {"type": "neural_walk", "query": "мама солнце тело память действие", "steps": 6},
    {"type": "working_memory_reset"},
]


def _strip(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _strip(v) for k, v in value.items() if k not in VOLATILE_KEYS}
    if isinstance(value, list):
        return [_strip(v) for v in value]
    if isinstance(value, float):
        return round(value, 4)
    return value


def _canon(payload: dict[str, Any]) -> str:
    return json.dumps(_strip(payload), ensure_ascii=False, sort_keys=True)


def _make_args() -> argparse.Namespace:
    return argparse.Namespace(
        no_llm=True,
        warmup=None,
        plasticity_threshold=0.7,
        ollama_model="qwen2.5:0.5b",
        ollama_host="http://127.0.0.1:11434",
    )


def _run_oneshot(state_dir: Path, args: argparse.Namespace) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in BATTERY:
        stores = _build_stores(args, state_dir)
        out.append(normalize(_handle_event(_as_event(dict(raw)), args, stores)))
    return out


def _run_warm(state_dir: Path, args: argparse.Namespace) -> list[dict[str, Any]]:
    stores = _build_stores(args, state_dir)
    out: list[dict[str, Any]] = []
    for raw in BATTERY:
        out.append(normalize(_handle_event(_as_event(dict(raw)), args, stores)))
    return out


def _first_diff(a: dict[str, Any], b: dict[str, Any]) -> str:
    sa = _strip(a)
    sb = _strip(b)
    keys = sorted(set(sa) | set(sb))
    for key in keys:
        va = json.dumps(sa.get(key), ensure_ascii=False, sort_keys=True)
        vb = json.dumps(sb.get(key), ensure_ascii=False, sort_keys=True)
        if va != vb:
            return f"key '{key}':\n    oneshot={va[:400]}\n    warm   ={vb[:400]}"
    return "(no field-level diff found, but canonical strings differ)"


def main() -> int:
    args = _make_args()
    with tempfile.TemporaryDirectory(prefix="max17-parity-oneshot-") as d1, tempfile.TemporaryDirectory(
        prefix="max17-parity-warm-"
    ) as d2:
        oneshot = _run_oneshot(Path(d1), args)
        warm = _run_warm(Path(d2), args)

    mismatches: list[str] = []
    for i, raw in enumerate(BATTERY):
        if _canon(oneshot[i]) != _canon(warm[i]):
            mismatches.append(f"[{i}] {raw.get('type')}\n  {_first_diff(oneshot[i], warm[i])}")

    if mismatches:
        print(json.dumps({"ok": False, "checked": len(BATTERY), "mismatches": len(mismatches)}, ensure_ascii=False))
        for m in mismatches:
            print(m, file=sys.stderr)
        return 1

    print(
        json.dumps(
            {"ok": True, "checked": len(BATTERY), "message": "warm path matches one-shot path"},
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
