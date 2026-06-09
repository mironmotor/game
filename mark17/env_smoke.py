#!/usr/bin/env python3
"""Smoke checks for the Max17 environment reasoning loop.

Runs two camera frames in sequence against a shared state directory so the
second frame can reason about the change relative to the first (temporal
reasoning, conclusions, presence inference, concept learning).
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
JSON_CLI = ROOT / "mark17" / "json_cli.py"
EXAMPLES = ROOT / "mark17" / "examples"


def _run_frame(event_file: str, state_dir: Path) -> dict[str, Any]:
    cmd = [
        sys.executable,
        str(JSON_CLI),
        "--no-llm",
        "--state-dir",
        str(state_dir),
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
        raise RuntimeError(f"{event_file} failed:\n{proc.stdout}\n{proc.stderr}")
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
    # A dot-free subdirectory: WorkingMemory treats a dotted dir name as a file.
    with tempfile.TemporaryDirectory() as tmp:
        state_dir = Path(tmp) / "state"
        state_dir.mkdir(parents=True, exist_ok=True)

        frame1 = _run_frame("max17-env-frame1.json", state_dir)
        frame2 = _run_frame("max17-env-frame2.json", state_dir)

    env1 = frame1.get("environment")
    env2 = frame2.get("environment")
    _assert(isinstance(env1, dict), "frame 1 should expose an environment block")
    _assert(isinstance(env2, dict), "frame 2 should expose an environment block")

    _assert(env1.get("observations_count") == 1, "first frame counts as a single observation")
    _assert(env2.get("observations_count") == 2, "second frame should know about the first")

    transitions = env2.get("transitions")
    _assert(isinstance(transitions, list) and len(transitions) >= 1, "second frame should detect transitions")
    kinds = {t.get("kind") for t in transitions if isinstance(t, dict)}
    _assert("light" in kinds, "darker frame should be detected as a light transition")
    _assert("scene" in kinds, "desk -> active-room should be detected as a scene transition")

    _assert(env2.get("presence") == "present", "movement should infer presence=present")

    associations = env2.get("associations")
    _assert(isinstance(associations, list) and len(associations) >= 2, "environment should propose concept associations to learn")

    answer2 = _answer_text(frame2)
    _assert("памят" in answer2.casefold(), "environment answer should mention remembering observations")

    summary = {
        "ok": True,
        "cases": [
            {
                "name": "env_frame1",
                "presence": env1.get("presence"),
                "conclusions": env1.get("conclusions"),
            },
            {
                "name": "env_frame2",
                "presence": env2.get("presence"),
                "transitions": [t.get("kind") for t in transitions if isinstance(t, dict)],
                "conclusions": env2.get("conclusions"),
                "answer": answer2,
            },
        ],
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
