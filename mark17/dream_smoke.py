#!/usr/bin/env python3
"""Smoke checks for the Max17 internal dreaming / synergy generation path."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
JSON_CLI = ROOT / "mark17" / "json_cli.py"
EXAMPLES = ROOT / "mark17" / "examples"


def _run_case(name: str, *, warmup: str, event: str) -> dict[str, Any]:
    cmd = [
        sys.executable,
        str(JSON_CLI),
        "--no-llm",
        "--ephemeral",
        "--warmup",
        str(EXAMPLES / warmup),
    ]
    proc = subprocess.run(
        cmd,
        cwd=ROOT,
        input=(EXAMPLES / event).read_text(),
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"{name} failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    payload = _run_case(
        "internal_dream",
        warmup="max17-relevance-warmup.jsonl",
        event="max17-internal-dream.json",
    )

    _assert(payload.get("route") == "internal_dream", "internal_dream should route to the dreamer")

    dream = payload.get("dream")
    _assert(isinstance(dream, dict), "internal_dream should expose a dream block")
    created = dream.get("synergies_created")
    _assert(isinstance(created, int) and created >= 1, "dreaming should crystallise at least one synergy")

    synergies = dream.get("synergies")
    _assert(isinstance(synergies, list) and len(synergies) >= 1, "dream should list synergies")
    first = synergies[0]
    _assert(isinstance(first, dict) and bool(str(first.get("summary") or "").strip()), "synergy needs a summary")

    titles = [str(s.get("title") or "") for s in synergies if isinstance(s, dict)]

    summary = {
        "ok": True,
        "cases": [
            {
                "name": "internal_dream",
                "synergies_created": created,
                "titles": titles,
                "first_summary": str(first.get("summary") or ""),
            }
        ],
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
