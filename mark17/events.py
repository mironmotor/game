"""События Mark 17: JSONL из stdin, файла или другого процесса."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any


KNOWN_TYPES = frozenset(
    {
        "terminal_error",
        "open_folder",
        "shell_command",
        "file_saved",
        "ping",
        "recall",
        "search_memory",
        "remember",
        "environment_observation",
    }
)


@dataclass
class Event:
    type: str
    payload: dict[str, Any] = field(default_factory=dict)
    ts: float = field(default_factory=time.time)
    source: str = "stdin"

    def signature(self) -> str:
        """Стабильный ключ паттерна для meta/plasticity cache."""
        if self.type == "terminal_error":
            line = str(self.payload.get("line", ""))[:120]
            return f"terminal_error:{line}"
        if self.type == "open_folder":
            return f"open_folder:{self.payload.get('path', '')}"
        if self.type == "shell_command":
            return f"shell_command:{self.payload.get('cmd', '')}"
        return f"{self.type}:{json.dumps(self.payload, sort_keys=True)}"


def parse_shorthand(line: str) -> Event:
    """Короткие команды для интерактива: err / open / cmd / recall / ping."""
    parts = line.split(maxsplit=1)
    cmd = parts[0].lower()
    rest = parts[1] if len(parts) > 1 else ""

    if cmd in ("ping", "p"):
        return Event(type="ping")
    if cmd in ("err", "error", "e"):
        return Event(type="terminal_error", payload={"line": rest})
    if cmd in ("open", "folder", "f"):
        return Event(type="open_folder", payload={"path": rest})
    if cmd in ("cmd", "shell", "c"):
        return Event(type="shell_command", payload={"cmd": rest})
    if cmd in ("recall", "r", "mem"):
        return Event(type="recall", payload={"query": rest})
    if cmd in ("remember", "m"):
        return Event(type="remember", payload={"note": rest})
    raise ValueError(
        f"unknown shorthand '{cmd}'. Use: ping, err, open, cmd, recall, or JSON"
    )


def parse_event_line(line: str) -> Event:
    raw = json.loads(line.strip())
    if not isinstance(raw, dict):
        raise ValueError("event must be a JSON object")

    etype = raw.get("type") or raw.get("event")
    if not etype:
        raise ValueError("missing 'type' or 'event' field")

    etype = str(etype)
    payload = {k: v for k, v in raw.items() if k not in ("type", "event", "ts", "source")}
    ts = float(raw["ts"]) if "ts" in raw else time.time()
    source = str(raw.get("source", "stdin"))
    return Event(type=etype, payload=payload, ts=ts, source=source)
