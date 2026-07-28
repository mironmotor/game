"""Deterministic auto-planner for Max17 (mark17 core).

Takes a goal and decomposes it into a concrete MGR plan WITHOUT any LLM.
Every task carries a "reality_check" — a small real-world action — so the plan
follows the core principle: increase the human's contact with reality.
"""

from __future__ import annotations

import time
from itertools import permutations
from typing import Any

from mark17.cognitive_physics import path_integral
from mark17.principles import REALITY_CONTACT_PRINCIPLE

# MGR levels mirror the game's framework.
XP = {"MGR-3": 50, "MGR-2": 30, "MGR-1": 10}

SCHEDULE = ["10:00", "12:00", "14:00", "16:00", "17:30", "18:30", "20:00"]

# Activation energy of each task class — what it costs to get moving on one.
MGR_ENERGY = {"MGR-1": 1.0, "MGR-2": 2.2, "MGR-3": 3.6}

# Coefficients of the action functional. These are the only place the planner's
# opinions live: everything else is derived by minimising S.
W_FRICTION = 1.2   # starting heavy costs the most — the day never begins
W_FATIGUE = 0.5    # the same task costs more the later it is attempted
W_SWITCH = 0.25    # jumping between task classes burns context
W_REPEAT = 0.4     # two identical reality checks in a row is one dead step

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


def action(order: tuple[tuple[str, str, str], ...]) -> float:
    """The action S[path] of one candidate ordering of the day.

    Four terms, each a real cost of doing the work in this sequence:

    * **friction** — the activation energy of whatever is attempted first. A day
      that opens with the breakthrough usually does not open at all.
    * **fatigue** — heavy work costs more the later it lands, so the schedule
      pays for putting MGR-3 at 20:00.
    * **switching** — moving between task classes burns context.
    * **repetition** — two identical reality checks back to back is one wasted
      contact with the world.

    Friction and fatigue pull in opposite directions, which is what makes this
    worth minimising rather than sorting: the stationary path is the compromise,
    not either extreme.
    """
    n = len(order)
    if n == 0:
        return 0.0

    energies = [MGR_ENERGY.get(mgr, 1.0) for mgr, _, _ in order]
    checks = [check for _, _, check in order]

    friction = energies[0] * W_FRICTION
    fatigue = sum(
        energy * (index / max(n - 1, 1)) * W_FATIGUE
        for index, energy in enumerate(energies)
    )
    switching = sum(
        abs(energies[i] - energies[i - 1]) * W_SWITCH for i in range(1, n)
    )
    repetition = sum(W_REPEAT for i in range(1, n) if checks[i] == checks[i - 1])

    return friction + fatigue + switching + repetition


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

    # Feynman: the plan is not asserted, it is the path that survives the sum
    # over histories. Every ordering of the day is a history; each is weighted
    # by e^(-S/ħ); the stationary-action ordering is what the core actually
    # schedules. With six steps that is 720 real paths, all of them evaluated.
    candidates = list(permutations(blueprint))
    integral = path_integral(candidates, [action(path) for path in candidates])
    ordering = integral.classical or blueprint

    tasks: list[dict[str, Any]] = []
    for i, (mgr, desc, check) in enumerate(ordering):
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
    # The first move is now whatever least action put first, not a hand-picked
    # rule — the lowest-friction opening is derived rather than declared.
    first_move = tasks[0]

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
        "path_integral": {
            "paths_summed": len(candidates),
            "stationary_action": round(integral.stationary_action, 4),
            "dominance": round(integral.dominance, 4),
        },
        "principle": REALITY_CONTACT_PRINCIPLE,
    }
