"""Lightweight synapse growth log — append-only (timestamp, total) snapshots so
the road to 1M can be charted over time. Dedups consecutive identical totals.
Best-effort: any failure is swallowed (never breaks a request)."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

_FILE = "growth_log.jsonl"
_EVENTS_FILE = "growth_events.jsonl"


def record_event(state_dir: Path, event: dict[str, Any]) -> None:
    """Append a typed learning/growth event (e.g. agent_experience). Separate from
    the numeric record() snapshots. Best-effort; never raises."""
    try:
        path = Path(state_dir) / _EVENTS_FILE
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"t": round(time.time(), 1), **event}, ensure_ascii=False) + "\n")
    except (OSError, ValueError, TypeError):
        pass


def history(state_dir: Path, limit: int = 200) -> list[dict[str, Any]]:
    try:
        path = Path(state_dir) / _FILE
        if not path.exists():
            return []
        rows: list[dict[str, Any]] = []
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return rows[-limit:]
    except OSError:
        return []


def record(state_dir: Path, total: int) -> None:
    try:
        rows = history(state_dir, limit=1)
        if rows and int(rows[-1].get("total", -1)) == int(total):
            return  # dedup consecutive identical totals
        path = Path(state_dir) / _FILE
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"t": round(time.time(), 1), "total": int(total)}, ensure_ascii=False) + "\n")
    except (OSError, ValueError):
        pass
