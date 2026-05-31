"""Short-term session context for Max17.

WorkingMemory is deliberately small: it keeps the current topic, active goal,
recent turns, and the next useful step for the current session.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from mark17.events import Event

TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_]+")
MAX_TURNS = 12


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_state() -> dict[str, Any]:
    return {
        "current_topic": "",
        "active_goal": "",
        "current_mode": "unknown",
        "last_user_intent": "unknown",
        "recent_turns": [],
        "suggested_next_step": "",
        "updated_at": "",
    }


def _normalize(text: Any) -> str:
    raw = str(text or "").casefold().replace("ё", "е")
    return " ".join(TOKEN_RE.findall(raw))


def _event_text(event: Event) -> str:
    if isinstance(event.payload.get("text"), str):
        return str(event.payload["text"]).strip()
    if isinstance(event.payload.get("line"), str):
        return str(event.payload["line"]).strip()
    task = event.payload.get("task")
    if isinstance(task, dict) and task.get("desc"):
        return str(task["desc"]).strip()
    if event.payload:
        return json.dumps(event.payload, ensure_ascii=False, sort_keys=True)[:240]
    return event.type


def detect_intent(text: Any, event_type: str = "user_message") -> str:
    normalized = _normalize(text)
    if event_type in {"terminal_error", "deadline_failed"}:
        return "reports_error"
    if event_type in {"task_created", "task_completed", "system_state", "environment_observation"}:
        return "development_request"
    if not normalized:
        return "unknown"
    if any(term in normalized for term in ("что умеешь", "что можешь", "what can you do", "who are you")):
        return "asks_capability"
    if any(term in normalized for term in ("что ты помнишь", "что помнишь", "что в памяти", "memory status")):
        return "asks_memory"
    if any(term in normalized for term in ("error", "ошибка", "build", "npm", "terminal", "traceback", "терминал", "сборка")):
        return "reports_error"
    if normalized in {"привет", "hello", "hi", "ок", "ok", "йо"}:
        return "greeting"
    if any(
        term in normalized
        for term in (
            "implement",
            "добавь",
            "сделай",
            "делаем",
            "улучшаем",
            "развиваем",
            "fix",
            "исправь",
            "refactor",
        )
    ):
        return "development_request"
    if any(
        term in normalized
        for term in (
            "что дальше",
            "давай дальше",
            "что делать",
            "дальше",
            "next",
            "next step",
            "what should i do",
            "следующий шаг",
            "куда дальше",
        )
    ):
        return "asks_next_step"
    return "unknown"


def detect_topic(text: Any) -> str:
    normalized = _normalize(text)
    if any(term in normalized for term in ("camera", "камера", "сенсор", "environment", "среда", "наблюдение")):
        return "Environment sensing"
    if any(term in normalized for term in ("max17", "mark17", "ядро", "память", "синап", "sleep", "consolidation")):
        return "Max17 core development"
    if any(term in normalized for term in ("game", "hud", "интерфейс")):
        return "Game UI"
    if any(term in normalized for term in ("git", "push", "rebase", "commit", "коммит")):
        return "Git workflow"
    if any(term in normalized for term in ("error", "ошибка", "build", "npm", "terminal", "терминал", "сборка")):
        return "debugging"
    return ""


def topic_for_event(event_type: str, text: Any) -> str:
    if event_type == "environment_observation":
        return "Environment sensing"
    return detect_topic(text)


def mode_for_intent(intent: str) -> str:
    if intent == "reports_error":
        return "debugging"
    if intent == "development_request":
        return "development"
    if intent == "asks_next_step":
        return "planning"
    if intent == "greeting":
        return "chat"
    return "unknown"


def _goal_from_text(text: str, topic: str) -> str:
    cleaned = " ".join(text.split()).strip()
    if not cleaned:
        return ""
    if len(cleaned) <= 160:
        return cleaned
    return cleaned[:157].rstrip() + "..."


def _next_step(state: dict[str, Any]) -> str:
    topic = str(state.get("current_topic") or "")
    goal = str(state.get("active_goal") or "")
    mode = str(state.get("current_mode") or "unknown")
    if topic == "Max17 core development":
        return "Удержать текущую тему, цель и ближайшее действие через Working Memory."
    if topic == "Game UI":
        return "Проверить, что Game UI отправляет события в Max17 и показывает полезный ответ."
    if topic == "Git workflow":
        return "Проверить статус, зафиксировать нужные файлы и не смешивать лишние изменения."
    if topic == "Environment sensing":
        return "Сохранить только полезный сенсорный факт и связать его с текущим контекстом."
    if mode == "debugging":
        return "Сузить ошибку до одного воспроизводимого симптома и проверить минимальный фикс."
    if goal:
        return f"Продолжить цель: {goal}"
    return "Сформулировать текущую цель одним конкретным действием."


def _append_turn(state: dict[str, Any], *, role: str, text: str) -> None:
    if not text:
        return
    turns = state.get("recent_turns")
    if not isinstance(turns, list):
        turns = []
    turns.append({"role": role, "text": text[:500], "timestamp": _now()})
    state["recent_turns"] = turns[-MAX_TURNS:]


class WorkingMemory:
    def __init__(self, path: str | Path) -> None:
        raw_path = Path(path)
        self.path = raw_path if raw_path.suffix else raw_path / "working_memory.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> dict[str, Any]:
        if not self.path.exists():
            return _default_state()
        try:
            data = json.loads(self.path.read_text())
        except (json.JSONDecodeError, OSError):
            return _default_state()
        if not isinstance(data, dict):
            return _default_state()
        state = _default_state()
        state.update(data)
        if not isinstance(state.get("recent_turns"), list):
            state["recent_turns"] = []
        return state

    def save(self, state: dict[str, Any]) -> None:
        current = _default_state()
        current.update(state)
        current["updated_at"] = current.get("updated_at") or _now()
        self.path.write_text(json.dumps(current, ensure_ascii=False, indent=2))

    def update_from_event(
        self,
        event: Event,
        response: dict[str, Any] | None = None,
        self_evaluation: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        state = self.load()
        text = _event_text(event)
        intent = detect_intent(text, event.type)
        topic = topic_for_event(event.type, text)
        mode = mode_for_intent(intent)

        if topic:
            state["current_topic"] = topic
        if mode != "unknown":
            state["current_mode"] = mode
        state["last_user_intent"] = intent

        if intent in {"development_request", "reports_error"} and text:
            state["active_goal"] = _goal_from_text(text, str(state.get("current_topic") or ""))

        next_adaptation = ""
        if isinstance(response, dict):
            next_adaptation = str(response.get("next_adaptation") or "").strip()
        if next_adaptation and next_adaptation != text:
            state["suggested_next_step"] = next_adaptation[:240]
        else:
            state["suggested_next_step"] = _next_step(state)

        has_answer = isinstance(response, dict) and isinstance(response.get("answer"), dict)

        if event.type == "user_message" and not has_answer:
            _append_turn(state, role="user", text=text)
        elif event.type in {"task_created", "task_completed", "deadline_failed", "terminal_error", "system_state", "environment_observation"} and not has_answer:
            _append_turn(state, role="event", text=f"{event.type}: {text}")

        if isinstance(response, dict):
            answer = response.get("answer")
            if isinstance(answer, dict):
                _append_turn(state, role="max17", text=str(answer.get("text") or ""))

        state["updated_at"] = _now()
        self.save(state)
        return self.get_context()

    def get_context(self) -> dict[str, Any]:
        state = self.load()
        return {
            "current_topic": str(state.get("current_topic") or ""),
            "active_goal": str(state.get("active_goal") or ""),
            "current_mode": str(state.get("current_mode") or "unknown"),
            "last_user_intent": str(state.get("last_user_intent") or "unknown"),
            "recent_turns": state.get("recent_turns") if isinstance(state.get("recent_turns"), list) else [],
            "suggested_next_step": str(state.get("suggested_next_step") or ""),
            "updated_at": str(state.get("updated_at") or ""),
        }

    def reset(self) -> dict[str, Any]:
        state = _default_state()
        state["updated_at"] = _now()
        self.save(state)
        return self.get_context()
