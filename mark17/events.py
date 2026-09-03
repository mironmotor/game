"""События Mark 17: JSONL из stdin, файла или другого процесса."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

from mark17.compression import stems_of


def topic_key(text: Any, *, limit: int = 12) -> str:
    """Ключ темы реплики: основы значимых слов, отсортированные и без повторов.

    Порядок слов и словоформы не должны влиять: «поднять доход» и «доход
    поднимать» — про одно. Ограничение в 12 основ не даёт длинному сообщению
    развалиться на уникальный ключ из-за одной лишней детали в конце; берутся
    самые длинные основы, потому что короткие чаще всего служебные.

    Пусто (одни стоп-слова, смайлик, «ок») — ключ вырождается в сам текст,
    иначе все такие реплики схлопнулись бы в один паттерн.
    """
    stems = sorted(set(stems_of(text)))
    if not stems:
        return str(text or "").strip().lower()[:60]
    top = sorted(sorted(stems, key=len, reverse=True)[:limit])
    return " ".join(top)


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
    }
)


@dataclass
class Event:
    type: str
    payload: dict[str, Any] = field(default_factory=dict)
    ts: float = field(default_factory=time.time)
    source: str = "stdin"

    def signature(self) -> str:
        """Стабильный ключ паттерна для meta/plasticity cache.

        Для реплики человека ключ строится по СМЫСЛУ, а не по строке.

        Раньше здесь был json.dumps всего payload, то есть SHA от точного
        текста. Из-за этого «как поднять доход» и «как поднять доход в этом
        месяце» были двумя разными паттернами, каждый со счётчиком с нуля.
        В живом чате человек дословно не повторяется никогда — значит hits
        почти всегда оставался единицей, а уверенность (0.45·hits/6 + …)
        навсегда прилипала к трети. Ядро училось только на копипасте.

        Теперь берутся основы значимых слов, отсортированные и без повторов:
        одна и та же мысль разными словами — один паттерн, и повторный разговор
        о том же наконец засчитывается как повтор.
        """
        if self.type == "terminal_error":
            line = str(self.payload.get("line", ""))[:120]
            return f"terminal_error:{line}"
        if self.type == "open_folder":
            return f"open_folder:{self.payload.get('path', '')}"
        if self.type == "shell_command":
            return f"shell_command:{self.payload.get('cmd', '')}"
        if self.type == "user_message":
            return f"user_message:{topic_key(self.payload.get('text', ''))}"
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
