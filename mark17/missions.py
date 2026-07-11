"""Трекер миссий MAX — живая доска реальных целей Мирона.

Не todo-список, а то, что MAX держит на виду: помнит цели, пушит к ОДНОМУ
следующему шагу (а не в «8 измерений бесконечности»), замечает прогресс.
Состояние: state/missions.json. missions_context() инжектится в голос MAX,
чтобы он знал миссии в любом разговоре.
"""

from __future__ import annotations

import itertools
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_counter = itertools.count()

_STATE = Path(os.environ.get("MAX17_STATE_DIR") or (Path(__file__).resolve().parent / "state"))
_PATH = _STATE / "missions.json"

_STATUSES = {"active", "blocked", "paused", "done"}

# Засев — реальные миссии Мирона (его слова). Дальше правит сам.
_SEED = [
    {"title": "Запустить Game MVP", "why": "показать миру MAX, не строить вечно", "next_step": "первый рабочий агент"},
    {"title": "Заработать $5000", "why": "топливо для разгона", "next_step": ""},
    {"title": "Закрыть оверстей", "why": "", "next_step": ""},
    {"title": "Таргет на завод (ещё раз)", "why": "", "next_step": ""},
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    # timestamp + процессный счётчик → уникально даже в цикле засева.
    return "m" + datetime.now(timezone.utc).strftime("%y%m%d%H%M%S%f") + str(next(_counter))


def _load() -> dict[str, Any]:
    try:
        d = json.loads(_PATH.read_text(encoding="utf-8"))
        if isinstance(d, dict) and isinstance(d.get("missions"), list):
            return d
    except Exception:  # noqa: BLE001
        pass
    # Первый запуск — засеваем целями Мирона.
    missions = []
    for s in _SEED:
        missions.append({
            "id": _new_id(), "title": s["title"], "why": s.get("why", ""),
            "status": "active", "progress": 0, "next_step": s.get("next_step", ""),
            "tag": "", "notes": [], "created": _now(), "updated": _now(),
        })
    seeded = {"missions": missions, "active_id": missions[0]["id"] if missions else "", "updated": _now()}
    _save(seeded)  # персистим засев сразу — иначе id «плавают» и мутации не липнут
    return seeded


def _save(d: dict[str, Any]) -> None:
    try:
        _STATE.mkdir(parents=True, exist_ok=True)
        d["updated"] = _now()
        _PATH.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass


def _find(d: dict[str, Any], mid: str) -> dict[str, Any] | None:
    for m in d.get("missions", []):
        if m.get("id") == mid:
            return m
    return None


def add(title: str, why: str = "", next_step: str = "", tag: str = "") -> dict[str, Any]:
    title = (title or "").strip()
    d = _load()
    if not title:
        return snapshot()
    m = {
        "id": _new_id(), "title": title[:160], "why": (why or "")[:240],
        "status": "active", "progress": 0, "next_step": (next_step or "")[:200],
        "tag": (tag or "")[:40], "notes": [], "created": _now(), "updated": _now(),
    }
    d["missions"].append(m)
    if not d.get("active_id"):
        d["active_id"] = m["id"]
    _save(d)
    return snapshot()


def update(mid: str, **fields: Any) -> dict[str, Any]:
    d = _load()
    m = _find(d, mid)
    if not m:
        return snapshot()
    if "title" in fields and fields["title"]:
        m["title"] = str(fields["title"])[:160]
    if "why" in fields:
        m["why"] = str(fields["why"] or "")[:240]
    if "next_step" in fields:
        m["next_step"] = str(fields["next_step"] or "")[:200]
    if "status" in fields and fields["status"] in _STATUSES:
        m["status"] = fields["status"]
    if "progress" in fields:
        try:
            m["progress"] = max(0, min(100, int(fields["progress"])))
        except (TypeError, ValueError):
            pass
    if fields.get("note"):
        m.setdefault("notes", []).append({"t": _now(), "text": str(fields["note"])[:300]})
    m["updated"] = _now()
    _save(d)
    return snapshot()


def complete(mid: str) -> dict[str, Any]:
    return update(mid, status="done", progress=100)


def set_active(mid: str) -> dict[str, Any]:
    d = _load()
    if _find(d, mid):
        d["active_id"] = mid
        _save(d)
    return snapshot()


def remove(mid: str) -> dict[str, Any]:
    d = _load()
    d["missions"] = [m for m in d.get("missions", []) if m.get("id") != mid]
    if d.get("active_id") == mid:
        d["active_id"] = d["missions"][0]["id"] if d["missions"] else ""
    _save(d)
    return snapshot()


def active(d: dict[str, Any] | None = None) -> dict[str, Any] | None:
    d = d or _load()
    return _find(d, d.get("active_id", "")) or None


def snapshot() -> dict[str, Any]:
    d = _load()
    act = active(d)
    open_missions = [m for m in d["missions"] if m.get("status") != "done"]
    done = [m for m in d["missions"] if m.get("status") == "done"]
    return {
        "missions": d["missions"],
        "active_id": d.get("active_id", ""),
        "active": act,
        "open_count": len(open_missions),
        "done_count": len(done),
        "updated": d.get("updated", ""),
    }


def missions_context() -> str:
    """Блок для голоса MAX — чтобы он знал миссии и пушил к одному шагу."""
    d = _load()
    open_missions = [m for m in d["missions"] if m.get("status") != "done"]
    if not open_missions:
        return ""
    lines = ["—— МИССИИ МИРОНА (держи на виду) ——"]
    act = active(d)
    if act and act.get("status") != "done":
        step = act.get("next_step") or "—"
        lines.append(f"Сейчас в фокусе: «{act['title']}» (прогресс {act.get('progress', 0)}%). Следующий шаг: {step}")
    lines.append("Все открытые:")
    for m in open_missions[:8]:
        mark = "▸" if m.get("id") == d.get("active_id") else "•"
        lines.append(f"  {mark} {m['title']} [{m.get('status', 'active')}, {m.get('progress', 0)}%]")
    lines.append(
        "Ты держишь его цели на виду: мягко возвращай к ОДНОМУ конкретному следующему шагу "
        "(а не к «бесконечности агентов»), замечай и радуйся прогрессу. Без списков-меню — живо."
    )
    return "\n".join(lines)
