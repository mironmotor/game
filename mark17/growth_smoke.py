#!/usr/bin/env python3
"""Smoke check for Max17 SynapseGrowth loop."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _run(event_path: str, *, warmup: str | None = None) -> dict:
    cmd = [
        sys.executable,
        "mark17/json_cli.py",
        "--no-llm",
        "--ephemeral",
    ]
    if warmup:
        cmd.extend(["--warmup", warmup])
    data = Path(event_path).read_text()
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
    result = _run(
        "mark17/examples/max17-growth-event.json",
        warmup="mark17/examples/max17-growth-warmup.jsonl",
    )
    growth = result.get("growth")
    synapses = result.get("synapses")
    plan = result.get("plan")

    _assert(isinstance(growth, dict), "growth field missing")
    _assert(growth.get("target_synapses") == 100_000, "target_synapses should be 100000")
    _assert(int(growth.get("updated") or 0) >= 8, "growth should update at least 8 synapses")
    _assert(isinstance(synapses, dict), "synapses field missing")
    _assert(int(synapses.get("updated") or 0) >= int(growth.get("updated") or 0), "synapses should include growth updates")
    _assert(isinstance(plan, dict) and plan.get("actions"), "plan actions should exist")
    _assert(result.get("answer", {}).get("text"), "answer.text should exist")

    print(
        json.dumps(
            {
                "ok": True,
                "growth_updated": growth.get("updated"),
                "synapses_updated": synapses.get("updated"),
                "target_synapses": growth.get("target_synapses"),
                "top_growth": growth.get("top", [])[:2],
                "answer": result.get("answer", {}).get("text"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
