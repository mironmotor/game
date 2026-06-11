#!/usr/bin/env python3
"""Smoke check for MAX Ultimate bootstrap."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _run() -> dict:
    event_path = ROOT / "mark17" / "examples" / "max17-ultimate-bootstrap.json"
    proc = subprocess.run(
        [sys.executable, "mark17/json_cli.py", "--no-llm", "--ephemeral"],
        cwd=ROOT,
        input=event_path.read_text(),
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise AssertionError(proc.stderr or proc.stdout)
    line = proc.stdout.strip().splitlines()[-1]
    return json.loads(line)


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    payload = _run()
    ultimate = payload.get("ultimate_core")
    _assert(payload.get("ok") is True, "ultimate payload should be ok")
    _assert(payload.get("route") == "ultimate_core", "route should be ultimate_core")
    _assert(isinstance(ultimate, dict), "ultimate_core field missing")
    _assert(int(ultimate.get("target_synapses") or 0) == 1_000_000, "target should be 1M")
    _assert(int(ultimate.get("facts_cached") or 0) >= 3, "source facts should be cached")
    _assert(int(ultimate.get("doctrine_cached") or 0) >= 5, "doctrine should be cached")
    synapses = payload.get("synapses")
    _assert(isinstance(synapses, dict), "synapses field missing")
    _assert(int(synapses.get("updated") or 0) > 0, "ultimate bootstrap should update synapses")
    answer = payload.get("answer")
    _assert(isinstance(answer, dict) and "MAX Ultimate" in str(answer.get("text")), "answer should mention MAX Ultimate")
    print(
        json.dumps(
            {
                "ok": True,
                "route": payload.get("route"),
                "facts_cached": ultimate.get("facts_cached"),
                "doctrine_cached": ultimate.get("doctrine_cached"),
                "synapses_updated": synapses.get("updated"),
                "target_synapses": ultimate.get("target_synapses"),
                "answer": answer.get("text"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
