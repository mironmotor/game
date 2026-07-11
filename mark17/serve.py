#!/usr/bin/env python3
"""Persistent Max17 bridge.

Long-lived sibling of json_cli.py. Builds every store once, then processes
newline-delimited JSON events from stdin and writes one JSON response line per
event to stdout. This removes the per-request Python/numpy import and SQLite
re-open cost that one-shot json_cli.py pays on every call.

Protocol (line-delimited JSON over stdio):
  in:  one JSON object per line, same shape json_cli.py reads from stdin
  out: one JSON object per line (the normalized response), flushed immediately

A blank line is ignored. A line that is not valid JSON yields an error
response but never kills the loop.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.json_cli import _as_event, _build_stores, _handle_event, normalize


def _error(message: str, *, trace: str | None = None) -> dict:
    payload = {
        "ok": False,
        "route": "error",
        "memory": {},
        "plasticity": {},
        "llm": {},
        "confidence": 0.0,
        "next_adaptation": "Bridge error. Inspect error payload.",
        "error": message,
    }
    if trace:
        payload["trace"] = trace
    return payload


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description="Persistent Max17 JSON bridge")
    parser.add_argument("--state-dir", type=Path, default=Path(__file__).resolve().parent / "state")
    parser.add_argument("--plasticity-threshold", type=float, default=0.7)
    parser.add_argument("--ollama-model", default="qwen2.5:0.5b")
    parser.add_argument("--ollama-host", default="http://127.0.0.1:11434")
    parser.add_argument("--no-llm", action="store_true")
    parser.add_argument("--web-enabled", action="store_true")
    args = parser.parse_args()
    # serve mode never runs a one-shot warmup file; _handle_event branches on this.
    args.warmup = None

    stores = _build_stores(args, args.state_dir)

    # Прогрев ДО приёма запросов: строим рекол-индекс и трогаем граф, чтобы первый
    # user_message не платил ~12с холодной загрузки (иначе бюджет → десинк демона).
    try:
        stores.vector_memory._ensure_index()
        stores.vector_memory._ensure_hnsw()  # полнокорпусный HNSW готов до первого recall
        stores.synapse_graph.count()
    except Exception:
        pass

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
            if not isinstance(data, dict):
                _emit(_error("input must be a JSON object"))
                continue
            event = _as_event(data)
            result = _handle_event(event, args, stores)
            _emit(normalize(result))
        except Exception as exc:
            _emit(_error(str(exc), trace=traceback.format_exc()))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
