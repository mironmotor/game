#!/usr/bin/env python3
"""Smoke check for Max17 WorkingMemory."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
JSON_CLI = ROOT / "mark17" / "json_cli.py"
EXAMPLES = ROOT / "mark17" / "examples"


def _run() -> dict[str, Any]:
    cmd = [
        sys.executable,
        str(JSON_CLI),
        "--no-llm",
        "--ephemeral",
        "--warmup",
        str(EXAMPLES / "max17-working-warmup.jsonl"),
    ]
    proc = subprocess.run(
        cmd,
        cwd=ROOT,
        input=(EXAMPLES / "max17-working-next.json").read_text(),
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"working smoke failed:\n{proc.stdout}\n{proc.stderr}")
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
    payload = _run()
    working_memory = payload.get("working_memory")
    _assert(isinstance(working_memory, dict), "working_memory field is missing")
    assert isinstance(working_memory, dict)

    topic = str(working_memory.get("current_topic") or "")
    mode = str(working_memory.get("current_mode") or "")
    answer = _answer_text(payload)

    _assert(topic == "Max17 core development", f"unexpected current_topic: {topic}")
    _assert(mode in {"planning", "development"}, f"unexpected current_mode: {mode}")
    _assert("Max17 core" in answer or "Max17" in answer, "answer should mention Max17 context")
    _assert(
        any(token in answer for token in ("Следующий", "следующий", "Дальше", "предлагаю")),
        "answer should include a next step",
    )

    print(
        json.dumps(
            {
                "ok": True,
                "working_memory": {
                    "current_topic": topic,
                    "active_goal": working_memory.get("active_goal"),
                    "current_mode": mode,
                    "last_user_intent": working_memory.get("last_user_intent"),
                    "suggested_next_step": working_memory.get("suggested_next_step"),
                },
                "answer": answer,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
