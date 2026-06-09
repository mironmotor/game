#!/usr/bin/env python3
"""Smoke checks for the Max17 intuitive / active-graph hot path."""

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
    payload = _run_case(
        "intuition",
        warmup="max17-relevance-warmup.jsonl",
        event="max17-intuition.json",
    )

    active_graph = payload.get("active_graph")
    _assert(isinstance(active_graph, dict), "user_message should expose active_graph")
    _assert(active_graph.get("cold_reads") == 0, "active graph must stay on the hot path (cold_reads=0)")
    concepts = active_graph.get("activated_concepts")
    _assert(isinstance(concepts, list) and len(concepts) > 0, "active graph should activate at least one concept")

    intuition = payload.get("intuition")
    _assert(isinstance(intuition, dict), "user_message should expose intuition")
    intuition_text = str(intuition.get("intuition") or "")
    _assert(bool(intuition_text.strip()), "intuition should produce a felt-sense reading")

    causal = payload.get("causal_decoder")
    _assert(isinstance(causal, dict), "user_message should expose causal_decoder")
    causal_summary = str(causal.get("summary") or "")
    _assert("связ" in causal_summary.casefold(), "causal decoder should describe an active linkage")

    answer = _answer_text(payload).casefold()
    _assert("routed to llm" not in answer, "answer leaked route telemetry")
    _assert(bool(answer.strip()), "intuitive answer should not be empty")

    labels = [
        str(c.get("label") or c.get("id"))
        for c in concepts
        if isinstance(c, dict)
    ]

    summary = {
        "ok": True,
        "cases": [
            {
                "name": "intuition",
                "answer": _answer_text(payload),
                "active_concepts": labels,
                "cold_reads": active_graph.get("cold_reads"),
                "intuition": intuition_text,
                "causal_summary": causal_summary,
            }
        ],
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
