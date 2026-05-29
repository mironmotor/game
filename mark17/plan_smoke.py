#!/usr/bin/env python3
"""Smoke check for Max17 Planner / Next Action Engine."""

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
        raise RuntimeError(f"planner smoke failed:\n{proc.stdout}\n{proc.stderr}")
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
    plan = payload.get("plan")
    _assert(isinstance(working_memory, dict), "working_memory field is missing")
    _assert(isinstance(plan, dict), "plan field is missing")
    assert isinstance(working_memory, dict)
    assert isinstance(plan, dict)

    actions = plan.get("actions")
    answer = _answer_text(payload)
    _assert(working_memory.get("current_topic") == "Max17 core development", "wrong working topic")
    _assert(isinstance(actions, list) and len(actions) >= 1, "planner should return at least one action")
    _assert("Дальше" in answer or "предлагаю" in answer, "answer should present planned actions")
    _assert("1." in answer or "Сделать" in answer or "Выбрать" in answer, "answer should mention a concrete action")

    print(
        json.dumps(
            {
                "ok": True,
                "working_memory": {
                    "current_topic": working_memory.get("current_topic"),
                    "active_goal": working_memory.get("active_goal"),
                    "current_mode": working_memory.get("current_mode"),
                },
                "plan": {
                    "mode": plan.get("mode"),
                    "goal": plan.get("goal"),
                    "actions": actions,
                },
                "answer": answer,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
