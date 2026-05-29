"""Deterministic next-action planner for Max17.

The planner turns current working context into a few practical actions.
It does not call external APIs and does not claim autonomous agency.
"""

from __future__ import annotations

from typing import Any

from mark17.events import Event

VALID_MODES = {"development", "debugging", "planning", "chat", "unknown"}


def _text(value: Any, limit: int = 220) -> str:
    cleaned = " ".join(str(value or "").strip().split())
    for prefix in ("user_message: ", "task_completed: ", "task_created: ", "terminal_error: "):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix) :]
    return cleaned[:limit]


def _mode(working_memory: dict[str, Any] | None) -> str:
    if not isinstance(working_memory, dict):
        return "unknown"
    mode = str(working_memory.get("current_mode") or "unknown")
    return mode if mode in VALID_MODES else "unknown"


def _goal(event: Event, working_memory: dict[str, Any] | None) -> str:
    if isinstance(working_memory, dict):
        active_goal = _text(working_memory.get("active_goal"))
        if active_goal:
            return active_goal

    payload_text = event.payload.get("text") or event.payload.get("line")
    if isinstance(payload_text, str) and payload_text.strip():
        return _text(payload_text)

    task = event.payload.get("task")
    if isinstance(task, dict) and task.get("desc"):
        return _text(task["desc"])

    return _text(event.type)


def _strong_pattern_reason(response: dict[str, Any]) -> str:
    synapses = response.get("synapses")
    if isinstance(synapses, dict):
        top = synapses.get("top")
        if isinstance(top, list):
            for item in top:
                if not isinstance(item, dict):
                    continue
                weight = item.get("weight")
                summary = _text(item.get("summary"), 160)
                if "route:" in summary or "routed to llm" in summary.casefold():
                    continue
                if isinstance(weight, (int, float)) and weight >= 0.55 and summary:
                    return f"Есть усиленная ассоциация: {summary}."

    memory = response.get("memory")
    if isinstance(memory, dict):
        for key in ("consolidated_patterns", "semantic", "recalled"):
            rows = memory.get(key)
            if not isinstance(rows, list):
                continue
            for item in rows:
                if not isinstance(item, dict):
                    continue
                summary = _text(item.get("summary") or item.get("reinforce"), 160)
                if "routed to llm" in summary.casefold():
                    continue
                if summary:
                    return f"Память поддерживает направление: {summary}."

    return "Текущий контекст достаточен для маленького следующего шага."


def _action(
    *,
    title: str,
    reason: str,
    priority: int,
    effort: str,
    expected_result: str,
) -> dict[str, Any]:
    return {
        "title": title,
        "reason": reason,
        "priority": priority,
        "effort": effort,
        "expected_result": expected_result,
    }


def _development_actions(goal: str, reason: str) -> list[dict[str, Any]]:
    return [
        _action(
            title="Сделать минимальный рабочий слой",
            reason=f"{reason} Цель сейчас: {goal}.",
            priority=1,
            effort="small",
            expected_result="В коде появляется маленькая проверяемая функция без переписывания архитектуры.",
        ),
        _action(
            title="Проверить поведение smoke-командой",
            reason="Для Max17 важнее рабочий цикл, чем красивая гипотеза без проверки.",
            priority=2,
            effort="small",
            expected_result="Есть воспроизводимый JSON-ответ, который показывает новый слой.",
        ),
        _action(
            title="Коротко задокументировать слой",
            reason="Документация удерживает границы: что слой реально делает и чего пока не делает.",
            priority=3,
            effort="small",
            expected_result="README объясняет назначение слоя без fake AGI claims.",
        ),
    ]


def _debugging_actions(goal: str, reason: str) -> list[dict[str, Any]]:
    return [
        _action(
            title="Воспроизвести ошибку одним коротким сценарием",
            reason=f"{reason} Сначала нужен стабильный симптом.",
            priority=1,
            effort="small",
            expected_result="Есть команда или запрос, который повторяет проблему.",
        ),
        _action(
            title="Посмотреть логи и JSON-ответ",
            reason="Max17 уже разделяет answer.text и telemetry, поэтому диагностику можно читать в JSON.",
            priority=2,
            effort="small",
            expected_result="Понятно, где ломается путь: UI, API bridge или Python core.",
        ),
        _action(
            title="Сделать минимальный фикс",
            reason="Нужно менять только слой, где найден симптом.",
            priority=3,
            effort="medium",
            expected_result="Ошибка исправлена без побочных изменений в /classic или архитектуре.",
        ),
    ]


def _planning_actions(goal: str, topic: str, reason: str) -> list[dict[str, Any]]:
    if topic == "Max17 core development":
        return [
            _action(
                title="Выбрать следующий проверяемый слой Max17",
                reason=f"{reason} Текущая цель: {goal}.",
                priority=1,
                effort="small",
                expected_result="Следующий шаг сформулирован как маленькая реализация, а не большая идея.",
            ),
            _action(
                title="Превратить шаг в smoke-тест",
                reason="Если слой нельзя проверить smoke-командой, он пока слишком расплывчатый.",
                priority=2,
                effort="small",
                expected_result="Появляется команда, которая показывает успешный сценарий.",
            ),
            _action(
                title="После проверки обновить README",
                reason="Max17 растёт слоями; README фиксирует реальное состояние ядра.",
                priority=3,
                effort="small",
                expected_result="Следующий разработчик видит, что слой делает и как его запускать.",
            ),
        ]

    return [
        _action(
            title="Сформулировать один конкретный следующий шаг",
            reason=f"{reason} Контекст: {topic or 'unknown'}.",
            priority=1,
            effort="small",
            expected_result="Есть действие, которое можно выполнить и проверить за короткий цикл.",
        )
    ]


def _chat_actions(goal: str, reason: str) -> list[dict[str, Any]]:
    return [
        _action(
            title="Уточнить намерение пользователя",
            reason=reason,
            priority=1,
            effort="small",
            expected_result="Max17 понимает, нужен разговор, план, отладка или разработка.",
        )
    ]


def plan_next_actions(
    event: Event,
    response: dict[str, Any],
    working_memory: dict[str, Any] | None = None,
    self_evaluation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    mode = _mode(working_memory)
    intent = ""
    topic = ""
    if isinstance(working_memory, dict):
        intent = str(working_memory.get("last_user_intent") or "")
        topic = str(working_memory.get("current_topic") or "")

    if intent == "asks_next_step":
        mode = "planning"
    if mode == "unknown" and event.type in {"task_created", "task_completed"}:
        mode = "development"
    if mode == "unknown" and event.type in {"terminal_error", "deadline_failed"}:
        mode = "debugging"

    goal = _goal(event, working_memory)
    reason = _strong_pattern_reason(response)

    if mode == "development":
        actions = _development_actions(goal, reason)
    elif mode == "debugging":
        actions = _debugging_actions(goal, reason)
    elif mode == "planning":
        actions = _planning_actions(goal, topic, reason)
    elif mode == "chat":
        actions = _chat_actions(goal, reason)
    else:
        actions = [
            _action(
                title="Уточнить текущую цель",
                reason=reason,
                priority=1,
                effort="small",
                expected_result="Max17 получает достаточно контекста, чтобы предложить рабочий следующий шаг.",
            )
        ]

    return {
        "mode": mode,
        "goal": goal,
        "actions": actions[:3],
    }
