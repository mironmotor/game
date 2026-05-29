#!/usr/bin/env python3
"""Smoke check for Max17 Outcome Feedback Loop."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
JSON_CLI = ROOT / "mark17" / "json_cli.py"
EXAMPLES = ROOT / "mark17" / "examples"


def _run(event_file: str) -> dict[str, Any]:
    cmd = [
        sys.executable,
        str(JSON_CLI),
        "--no-llm",
        "--ephemeral",
        "--warmup",
        str(EXAMPLES / "max17-outcome-warmup.jsonl"),
    ]
    proc = subprocess.run(
        cmd,
        cwd=ROOT,
        input=(EXAMPLES / event_file).read_text(),
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"outcome smoke failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


def _answer_text(payload: dict[str, Any]) -> str:
    answer = payload.get("answer")
    if isinstance(answer, dict):
        return str(answer.get("text") or "")
    return ""


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    payload = _run("max17-outcome-action-done.json")
    outcome = payload.get("outcome")
    synapses = payload.get("synapses")
    memory = payload.get("memory")
    answer = _answer_text(payload)

    _assert(isinstance(outcome, dict), "outcome field is missing")
    _assert(isinstance(synapses, dict), "synapses field is missing")
    _assert(isinstance(memory, dict), "memory field is missing")
    assert isinstance(outcome, dict)
    assert isinstance(synapses, dict)
    assert isinstance(memory, dict)

    _assert(outcome.get("status") == "success", f"unexpected outcome status: {outcome.get('status')}")
    _assert(int(synapses.get("updated") or 0) > 0, "outcome should update synapses")
    _assert("успеш" in answer.casefold() or "усилил" in answer.casefold(), "answer should confirm reinforcement")
    _assert("outcome_summary" in memory and memory["outcome_summary"], "memory should contain outcome summary")

    failure_payload = _run("max17-outcome-failure.json")
    failure_outcome = failure_payload.get("outcome")
    _assert(isinstance(failure_outcome, dict), "failure outcome field is missing")
    assert isinstance(failure_outcome, dict)
    _assert(failure_outcome.get("status") == "failure", "failure event should produce failure status")
    _assert(
        "меньш" in str(failure_outcome.get("next_adjustment") or "").casefold()
        or "прост" in str(failure_outcome.get("next_adjustment") or "").casefold(),
        "failure event should suggest a smaller/simpler adjustment",
    )

    print(
        json.dumps(
            {
                "ok": True,
                "outcome": outcome,
                "synapses_updated": synapses.get("updated"),
                "memory": {
                    "outcome_stored_id": memory.get("outcome_stored_id"),
                    "outcome_summary": memory.get("outcome_summary"),
                },
                "answer": answer,
                "failure_next_adjustment": failure_outcome.get("next_adjustment"),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
