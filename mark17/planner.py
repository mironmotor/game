"""Deterministic auto-planner for Max17 (mark17 core).

Takes a goal and decomposes it into a concrete MGR plan WITHOUT any LLM.
Every task carries a "reality_check" — a small real-world action — so the plan
follows the core principle: increase the human's contact with reality.

Порядок шагов выбирается интегралом Фейнмана по траекториям

    <x_f | x_i> = Integral D[x] * exp(i S[x] / hbar)

Набор задач фиксирован — это и есть закреплённые концы x_i и x_f. Свободен
только **путь** между ними: в каком порядке их проходить. Для каждой
траектории считается действие

    S[path] = sum_i (friction_i - lambda * contact_i) * w_i,   w_i = 1/(1+i)

Вес w_i убывает: первый шаг делается на холодную, и его трение стоит дороже
всего. Дальше вклад падает — разгон уже набран. Амплитуда каждого пути равна
exp(-S/hbar) (евклидово время, поэтому вещественная), а возвращается путь
наименьшего действия — классическая траектория. Остальные не выбрасываются:
они уходят наружу со своими вероятностями, потому что ядро должно уметь
сказать, насколько его план был близок к альтернативе.
"""

from __future__ import annotations

import math
import time
from typing import Any

from mark17.principles import REALITY_CONTACT_PRINCIPLE

# --- Path-integral constants -----------------------------------------------
# Activation friction of each task class: how hard it is to start it cold.
FRICTION = {"MGR-3": 0.9, "MGR-2": 0.55, "MGR-1": 0.2}
# Reality contact each task class buys — the thing the whole core optimises for.
CONTACT = {"MGR-3": 1.0, "MGR-2": 0.6, "MGR-1": 0.35}
# Weight of reality contact against friction in the action functional.
CONTACT_LAMBDA = 0.5
# hbar sets how sharply the classical path dominates the sum over histories.
H_BAR = 0.35

# Candidate trajectories over the six blueprint slots. Same tasks, same
# endpoints — only the order through them differs.
TRAJECTORIES: dict[str, tuple[int, ...]] = {
    "logistics_first": (3, 4, 5, 1, 2, 0),
    "alternating": (3, 1, 4, 2, 5, 0),
    "focus_first": (1, 2, 3, 4, 5, 0),
    "breakthrough_first": (0, 1, 2, 3, 4, 5),
}

TRAJECTORY_LABELS = {
    "logistics_first": "Сначала логистика — самый холодный старт стоит дешевле всего.",
    "alternating": "Чередование — логистика и фокус по очереди.",
    "focus_first": "Сначала фокус-блоки — прорыв в конце, на разгоне.",
    "breakthrough_first": "Сначала прорыв — дорогой старт, но максимум контакта сразу.",
}

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


def action(order: tuple[int, ...], mgrs: list[str], domain: str) -> float:
    """S[path] = sum_i (friction_i - lambda * contact_i) * w_i."""
    total = 0.0
    for position, index in enumerate(order):
        mgr = mgrs[index]
        # The first step is taken cold, so its friction dominates the action.
        weight = 1.0 / (1.0 + position)
        total += (_friction(mgr, domain) - CONTACT_LAMBDA * CONTACT[mgr]) * weight
    return total


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
