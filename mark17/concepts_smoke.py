#!/usr/bin/env python3
"""Smoke check for Max17 Concept Grounding."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _run(event_path: str) -> dict:
    return _run_payload(Path(event_path).read_text())


def _run_payload(data: str) -> dict:
    cmd = [
        sys.executable,
        "mark17/json_cli.py",
        "--no-llm",
        "--ephemeral",
    ]
    proc = subprocess.run(
        cmd,
        cwd=ROOT,
        input=data,
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout)
    return json.loads(proc.stdout.strip().splitlines()[-1])


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    result = _run("mark17/examples/max17-concepts-event.json")
    concepts = result.get("concepts")
    growth = result.get("growth")
    synapses = result.get("synapses")
    answer = result.get("answer", {}).get("text", "")

    _assert(isinstance(concepts, dict), "concepts field missing")
    matches = concepts.get("matches")
    _assert(isinstance(matches, list) and len(matches) >= 5, "expected at least 5 grounded concepts")
    ids = {str(item.get("id")) for item in matches if isinstance(item, dict)}
    for expected in ("mother", "father", "sun", "light", "body", "voice"):
        _assert(expected in ids, f"missing concept: {expected}")

    _assert(isinstance(growth, dict), "growth field missing")
    _assert(int(growth.get("updated") or 0) >= 16, "concept event should grow semantic synapses")
    _assert(isinstance(synapses, dict), "synapses field missing")
    _assert(int(synapses.get("updated") or 0) >= int(growth.get("updated") or 0), "synapses should include growth updates")
    _assert("заземл" in answer.casefold() or "сенсор" in answer.casefold(), "answer should explain concept grounding")

    compression_cases = [
        ("memory", "Several memories about recall, semantic vector search and hippocampus.", {"memory"}),
        ("consolidation", "Sleep consolidation compresses repeated patterns into stable insight tokens.", {"consolidation"}),
        ("action", "Goal, next action, plan, execution, result and outcome feedback.", {"action", "outcome", "action-outcome", "outcome-action"}),
        ("interface", "Game HUD basePath API route localhost interface bridge.", {"interface"}),
    ]
    compression_seen: dict[str, str] = {}
    for name, text, expected in compression_cases:
        payload = json.dumps(
            {
                "type": "compress_memory",
                "text": text,
                "source": "concept_smoke",
            },
            ensure_ascii=False,
        )
        compressed = _run_payload(payload)
        primary = ((compressed.get("concepts") or {}).get("primary") or {})
        concept = str(primary.get("concept") or "")
        label = str(primary.get("label") or "")
        compression_seen[name] = label or concept
        _assert(concept in expected, f"{name} compressed to {concept}, expected one of {sorted(expected)}")
        _assert("смысловой узел" in compressed.get("answer", {}).get("text", ""), "compression answer should mention semantic node")

    print(
        json.dumps(
            {
                "ok": True,
                "concept_ids": sorted(ids),
                "sensory_channels": concepts.get("sensory_channels", [])[:8],
                "growth_updated": growth.get("updated"),
                "synapses_updated": synapses.get("updated"),
                "compression": compression_seen,
                "answer": answer,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
