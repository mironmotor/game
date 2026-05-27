#!/usr/bin/env python3
"""Smoke checks for the Max17 JSON bridge."""

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


def _answer_text(payload: dict[str, Any]) -> str:
    answer = payload.get("answer")
    if isinstance(answer, dict):
        return str(answer.get("text") or "")
    return ""


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    memory_question = _run_case(
        "memory_question",
        warmup="max17-memory-question-warmup.jsonl",
        event="max17-smoke.json",
    )
    memory_answer = _answer_text(memory_question).casefold()
    _assert("паттерн" in memory_answer, "memory question answer should mention consolidated patterns")
    _assert("routed to llm" not in memory_answer, "memory question answer leaked route telemetry")

    vague_game = _run_case(
        "vague_game",
        warmup="max17-relevance-warmup.jsonl",
        event="max17-smoke-game.json",
    )
    game_answer = _answer_text(vague_game).casefold()
    for forbidden in ("torch", "pip install", "modulenotfounderror"):
        _assert(forbidden not in game_answer, f"GAME answer leaked irrelevant technical memory: {forbidden}")

    torch_error = _run_case(
        "torch_error",
        warmup="max17-relevance-warmup.jsonl",
        event="max17-smoke-torch.json",
    )
    torch_answer = _answer_text(torch_error).casefold()
    torch_memory = json.dumps(torch_error.get("memory", {}), ensure_ascii=False).casefold()
    _assert("torch" in torch_memory, "torch memory should remain present in JSON telemetry")
    _assert("torch" in torch_answer, "technical torch question should be allowed to mention torch memory")

    summary = {
        "ok": True,
        "cases": [
            {
                "name": "memory_question",
                "answer": _answer_text(memory_question),
                "synapses_updated": (memory_question.get("synapses") or {}).get("updated", 0),
            },
            {
                "name": "vague_game",
                "answer": _answer_text(vague_game),
                "semantic_memories": len((vague_game.get("memory") or {}).get("semantic") or []),
            },
            {
                "name": "torch_error",
                "answer": _answer_text(torch_error),
                "semantic_memories": len((torch_error.get("memory") or {}).get("semantic") or []),
            },
        ],
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
