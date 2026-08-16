"""Deterministic next-action planner for Max17.

The planner turns current working context into a few practical actions.
It does not call external APIs and does not claim autonomous agency.
"""

from __future__ import annotations

import math
import time
from typing import Any

from mark17.events import Event
from mark17.principles import REALITY_CONTACT_PRINCIPLE

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


XP = {"MGR-3": 50, "MGR-2": 30, "MGR-1": 10}


DOMAINS: dict[str, tuple[str, ...]] = {
    "money": ("деньг", "доход", "продаж", "клиент", "оплат", "money", "income", "sales", "бизнес", "выручк"),
    "body": ("тело", "спорт", "трен", "здоров", "сон", "бег", "зал", "body", "gym", "health"),
    "learn": ("учеб", "курс", "изуч", "навык", "язык", "learn", "study", "skill", "книг"),
    "build": ("код", "проект", "прилож", "сайт", "запуст", "build", "ship", "mvp", "релиз", "продукт"),
    "people": ("встреч", "созвон", "люди", "команд", "партн", "сеть", "people", "meeting", "созвон"),
}


REALITY_CHECKS: dict[str, str] = {
    "money": "Свяжи с деньгами: назови сумму, выстави счёт или напиши клиенту сегодня.",
    "body": "Проверь телом: сделай это физически — встань, выйди, подвигайся.",
    "learn": "Закрепи делом: примени новое знание в одном маленьком реальном действии.",
    "build": "Доведи до результата: собери минимальный кусок, который можно показать.",
    "people": "Вынеси к людям: скажи одному живому человеку, что ты делаешь.",
    "default": "Проверь в реальности: тело, работа, деньги, живые люди или созданный результат.",
}

TRAJECTORIES: dict[str, tuple[int, ...]] = {
    "logistics_first": (3, 4, 5, 1, 2, 0),
    "alternating": (3, 1, 4, 2, 5, 0),
    "focus_first": (1, 2, 3, 4, 5, 0),
    "breakthrough_first": (0, 1, 2, 3, 4, 5),
}

def action(order: tuple[int, ...], mgrs: list[str], domain: str) -> float:
    """S[path] = sum_i (friction_i - lambda * contact_i) * w_i."""
    total = 0.0
    for position, index in enumerate(order):
        mgr = mgrs[index]
        # The first step is taken cold, so its friction dominates the action.
        weight = 1.0 / (1.0 + position)
        total += (_friction(mgr, domain) - CONTACT_LAMBDA * CONTACT[mgr]) * weight
    return total

def _friction(mgr: str, domain: str) -> float:
    """Activation friction, modulated by what kind of goal this is."""
    base = FRICTION[mgr]
    if domain == "build" and mgr == "MGR-3":
        base -= 0.15   # builders start by building; diving in is cheap for them
    elif domain == "money" and mgr == "MGR-3":
        base -= 0.10   # a money goal dies if the big ask keeps getting deferred
    elif domain == "body" and mgr == "MGR-1":
        base -= 0.08   # physical logistics are nearly frictionless
    elif domain == "learn" and mgr == "MGR-2":
        base -= 0.10   # focus blocks are the natural unit of learning
    return max(0.05, base)

FRICTION = {"MGR-3": 0.9, "MGR-2": 0.55, "MGR-1": 0.2}

CONTACT_LAMBDA = 0.5

CONTACT = {"MGR-3": 1.0, "MGR-2": 0.6, "MGR-1": 0.35}

H_BAR = 0.35

TRAJECTORY_LABELS = {
    "logistics_first": "Сначала логистика — самый холодный старт стоит дешевле всего.",
    "alternating": "Чередование — логистика и фокус по очереди.",
    "focus_first": "Сначала фокус-блоки — прорыв в конце, на разгоне.",
    "breakthrough_first": "Сначала прорыв — дорогой старт, но максимум контакта сразу.",
}

SCHEDULE = ["10:00", "12:00", "14:00", "16:00", "17:30", "18:30", "20:00"]

# ── Автоплан (/autoplan) ─────────────────────────────────────────────────────
# Перенесено из ветки main целиком: цель разбирается на задачи с опытом,
# сроком и первым шагом. Существующий планировщик рядом и не тронут.

def _detect_domain(goal_lower: str) -> str:
    for domain, keys in DOMAINS.items():
        if any(k in goal_lower for k in keys):
            return domain
    return "default"


def _short(goal: str, limit: int = 60) -> str:
    g = " ".join(goal.split())
    return g if len(g) <= limit else g[: limit - 1].rstrip() + "…"


def path_integral(mgrs: list[str], domain: str) -> list[dict[str, Any]]:
    """Sum over histories: every trajectory with its action and probability."""
    entries: list[dict[str, Any]] = []
    for name, order in TRAJECTORIES.items():
        s = action(order, mgrs, domain)
        # Euclidean time, so the amplitude is real: exp(-S/hbar).
        amplitude = math.exp(-s / H_BAR)
        entries.append(
            {
                "path": name,
                "label": TRAJECTORY_LABELS[name],
                "order": list(order),
                "action": s,
                "amplitude": amplitude,
            }
        )

    norm = sum(entry["amplitude"] ** 2 for entry in entries) or 1.0
    for entry in entries:
        entry["probability"] = (entry["amplitude"] ** 2) / norm

    # Stationary action first — that is the classical path.
    entries.sort(key=lambda entry: entry["action"])
    return entries


def _iso_deadline(now_ts: float, horizon_days: int) -> str:
    end = now_ts + max(0, horizon_days) * 86400
    # deadline at ~21:00 of the horizon day, UTC ISO for the frontend
    lt = time.gmtime(end)
    return time.strftime("%Y-%m-%dT21:00:00Z", lt)


def build_plan(goal: str, *, horizon_days: int = 0, now_ts: float | None = None) -> dict[str, Any]:
    """Decompose a goal into a deterministic MGR plan."""
    now_ts = time.time() if now_ts is None else now_ts
    goal = (goal or "").strip()
    if not goal:
        return {
            "ok": False,
            "goal": "",
            "tasks": [],
            "total_xp": 0,
            "summary": "Нет цели. Назови, чего хочешь достичь — соберу план.",
            "principle": REALITY_CONTACT_PRINCIPLE,
        }

    core = _short(goal)
    domain = _detect_domain(goal.lower())
    rc = REALITY_CHECKS[domain]
    deadline = _iso_deadline(now_ts, horizon_days)

    # Decomposition: one breakthrough (MGR-3), two focus blocks (MGR-2),
    # three logistics steps (MGR-1). Deterministic, no randomness.
    blueprint: list[tuple[str, str, str]] = [
        ("MGR-3", f"Прорыв: {core}", rc),
        ("MGR-2", f"Подготовить базу под цель: {core}", REALITY_CHECKS["build"]),
        ("MGR-2", f"Фокус-блок 90 минут по цели", rc),
        ("MGR-1", f"Собрать материалы и убрать помехи", REALITY_CHECKS["default"]),
        ("MGR-1", f"Назначить точное время и место старта", REALITY_CHECKS["body"]),
        ("MGR-1", f"Сказать одному человеку о цели", REALITY_CHECKS["people"]),
    ]

    # Sum over histories: the task set is fixed, only the order through it is free.
    mgrs = [mgr for mgr, _, _ in blueprint]
    paths = path_integral(mgrs, domain)
    classical = paths[0]

    tasks: list[dict[str, Any]] = []
    for position, index in enumerate(classical["order"]):
        mgr, desc, check = blueprint[index]
        tasks.append(
            {
                "id": f"plan_{index + 1}",
                "desc": desc,
                "mgr": mgr,
                "xp": XP[mgr],
                "status": "active",
                "scheduledTime": SCHEDULE[position % len(SCHEDULE)],
                "deadline": deadline,
                "reality_check": check,
                "step": position + 1,
            }
        )

    total_xp = sum(t["xp"] for t in tasks)
    # Stationary action already put the cheapest possible start in front.
    first_move = tasks[0]

    return {
        "ok": True,
        "goal": goal,
        "domain": domain,
        "horizon_days": max(0, horizon_days),
        "tasks": tasks,
        "total_xp": total_xp,
        "first_move": first_move["desc"],
        "path": classical["path"],
        "action": round(float(classical["action"]), 4),
        "paths": [
            {
                "path": entry["path"],
                "label": entry["label"],
                "order": entry["order"],
                "action": round(float(entry["action"]), 4),
                "amplitude": round(float(entry["amplitude"]), 4),
                "probability": round(float(entry["probability"]), 4),
                "classical": entry["path"] == classical["path"],
            }
            for entry in paths
        ],
        "summary": (
            f"План на цель «{core}»: 1 прорыв, 2 фокус-блока, 3 шага логистики — {total_xp} XP. "
            f"Траектория наименьшего действия — «{classical['path']}» "
            f"(S={classical['action']:.3f}, p={classical['probability']:.0%}). "
            f"Начни с малого: {first_move['desc']}."
        ),
        "principle": REALITY_CONTACT_PRINCIPLE,
    }
