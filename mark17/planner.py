"""Deterministic auto-planner for Max17 (mark17 core).

Takes a goal and decomposes it into a concrete MGR plan WITHOUT any LLM.
Every task carries a "reality_check" — a small real-world action — so the plan
follows the core principle: increase the human's contact with reality.
"""

from __future__ import annotations

import time
from typing import Any

from mark17.principles import REALITY_CONTACT_PRINCIPLE

# MGR levels mirror the game's framework.
XP = {"MGR-3": 50, "MGR-2": 30, "MGR-1": 10}

SCHEDULE = ["10:00", "12:00", "14:00", "16:00", "17:30", "18:30", "20:00"]

# Domain detection → tailors the real-world checks.
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


def _detect_domain(goal_lower: str) -> str:
    for domain, keys in DOMAINS.items():
        if any(k in goal_lower for k in keys):
            return domain
    return "default"


def _short(goal: str, limit: int = 60) -> str:
    g = " ".join(goal.split())
    return g if len(g) <= limit else g[: limit - 1].rstrip() + "…"


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

    tasks: list[dict[str, Any]] = []
    for i, (mgr, desc, check) in enumerate(blueprint):
        tasks.append(
            {
                "id": f"plan_{i + 1}",
                "desc": desc,
                "mgr": mgr,
                "xp": XP[mgr],
                "status": "active",
                "scheduledTime": SCHEDULE[i % len(SCHEDULE)],
                "deadline": deadline,
                "reality_check": check,
            }
        )

    total_xp = sum(t["xp"] for t in tasks)
    # First move = the earliest, smallest logistics step (lowest friction to start).
    first_move = next((t for t in tasks if t["mgr"] == "MGR-1"), tasks[0])

    return {
        "ok": True,
        "goal": goal,
        "domain": domain,
        "horizon_days": max(0, horizon_days),
        "tasks": tasks,
        "total_xp": total_xp,
        "first_move": first_move["desc"],
        "summary": (
            f"План на цель «{core}»: 1 прорыв, 2 фокус-блока, 3 шага логистики — {total_xp} XP. "
            f"Начни с малого: {first_move['desc']}."
        ),
        "principle": REALITY_CONTACT_PRINCIPLE,
    }
