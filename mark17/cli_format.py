"""Человекочитаемый вывод для терминала."""

from __future__ import annotations

import json
import sys
from typing import Any


ROUTE_ICONS = {
    "plasticity": "⚡",
    "llm": "🧠",
    "memory": "💾",
    "ignore": "·",
}


def format_response(obj: dict[str, Any]) -> str:
    if not obj.get("ok"):
        return f"✗ ошибка: {obj.get('error', obj)}"

    if obj.get("message") == "replay done":
        s = obj.get("stats", {})
        return f"✓ replay done │ patterns={s.get('patterns')} steps={s.get('snn_steps')}"

    if obj.get("message") == "mark17 daemon ready":
        s = obj.get("stats", {})
        mem = obj.get("memory_stats", {})
        llm = "on" if obj.get("llm_available") else "off"
        return (
            f"✓ Mark 17 ready (v{obj.get('version', '?')}) │ "
            f"patterns={s.get('patterns')} memories={mem.get('memories', 0)} ollama={llm}"
        )

    route = obj.get("route", "?")
    icon = ROUTE_ICONS.get(route, "?")
    lines = [f"{icon} [{route}] {obj.get('event_type', '')}"]

    dec = obj.get("decision") or {}
    if dec.get("reason"):
        conf = dec.get("confidence")
        conf_s = f" {conf:.0%}" if isinstance(conf, (int, float)) else ""
        lines.append(f"  └ {dec['reason']}{conf_s}")

    pl = obj.get("plasticity")
    if pl:
        learned = "✓" if pl.get("learned") else "…"
        lines.append(f"  ⚡ {learned} {pl.get('action')} │ {pl.get('confidence', 0):.0%}")
        if pl.get("hint"):
            lines.append(f"  → {pl['hint']}")

    mem = obj.get("memory")
    if mem and mem.get("hits"):
        lines.append(f"  💾 найдено {len(mem['hits'])}:")
        for h in mem["hits"][:3]:
            lines.append(f"     · [{h.get('event_type')}] {h.get('summary', '')}")

    llm = obj.get("llm")
    if llm and llm.get("text"):
        st = llm.get("status", "")
        lat = llm.get("latency_ms")
        lat_s = f" ({lat}ms)" if lat else ""
        lines.append(f"  🧠 [{st}]{lat_s}")
        for part in llm["text"].split("\n")[:8]:
            part = part.strip()
            if part:
                lines.append(f"     {part}")

    return "\n".join(lines)


def emit(obj: dict, *, pretty: bool = False) -> None:
    if pretty:
        sys.stdout.write(format_response(obj) + "\n")
    else:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()
