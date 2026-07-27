"""Outcome feedback for Max17 plans and actions.

This module evaluates whether a suggested action helped, failed, partially
worked, or was skipped. It is deterministic and local.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from mark17.events import Event

OUTCOME_EVENT_TYPES = frozenset(
    {
        "outcome_success",
        "outcome_failure",
        "outcome_partial",
        "action_done",
        "action_skipped",
    }
)


def _clean(value: Any, limit: int = 240) -> str:
    return " ".join(str(value or "").strip().split())[:limit]


def _stable_id(*parts: Any) -> str:
    raw = json.dumps(parts, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.blake2b(raw.encode("utf-8"), digest_size=8).hexdigest()


def _event_text(event: Event) -> str:
    for key in ("result", "text", "message", "action", "note"):
        value = event.payload.get(key)
        if isinstance(value, str) and value.strip():
            return _clean(value)
    return event.type


def _top_action(plan: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(plan, dict):
        return {}
    actions = plan.get("actions")
    if not isinstance(actions, list) or not actions:
        return {}
    first = actions[0]
    return first if isinstance(first, dict) else {}


def _status_for_event(event_type: str) -> str:
    if event_type in {"outcome_success", "action_done"}:
        return "success"
    if event_type == "outcome_failure":
        return "failure"
    if event_type == "outcome_partial":
        return "partial"
    if event_type == "action_skipped":
        return "skipped"
    return "unknown"


def _score_for_status(status: str) -> float:
    return {
        "success": 0.9,
        "partial": 0.58,
        "failure": 0.18,
        "skipped": 0.12,
    }.get(status, 0.35)


def evaluate_outcome(
    event: Event,
    working_memory: dict[str, Any] | None = None,
    plan: dict[str, Any] | None = None,
    self_evaluation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    status = _status_for_event(event.type)
    score = _score_for_status(status)
    action = _top_action(plan)
    # Поверхность, рапортующая «я выполнил шаг X», знает действие точнее плана:
    # явный payload.action побеждает; иначе — действие плана, иначе текст события.
    action_title = _clean(event.payload.get("action")) or _clean(action.get("title") or _event_text(event))
    # Цель для причинной связи. Приоритет — у САМОГО события: поверхность,
    # которая закрывает петлю (автопилот, прогон, Доктор, тьютор), знает свою
    # цель точнее, чем рабочая память. Без цели `leads_to` не создаётся вовсе —
    # именно поэтому причинных связей было всего 1.1%.
    goal = _clean(event.payload.get("goal") or event.payload.get("related_goal"))
    if not goal and isinstance(working_memory, dict):
        goal = _clean(working_memory.get("active_goal") or working_memory.get("current_topic"))
    if not goal and isinstance(plan, dict):
        goal = _clean(plan.get("goal"))

    if status == "success":
        reason = f"Action helped: {action_title}."
        reinforce = f"{goal} -> {action_title}" if goal else action_title
        weaken = ""
        next_adjustment = "Продолжить этот паттерн и проверить следующий маленький шаг."
    elif status == "partial":
        reason = f"Action partially worked: {action_title}."
        reinforce = action_title
        weaken = "scope too broad"
        next_adjustment = "Сузить масштаб и проверить меньший вариант."
    elif status == "failure":
        reason = f"Action did not work: {action_title}."
        reinforce = ""
        weaken = f"{goal} -> {action_title}" if goal else action_title
        next_adjustment = "Уменьшить масштаб и проверить более простой вариант."
    elif status == "skipped":
        reason = f"Action was skipped: {action_title}."
        reinforce = ""
        weaken = action_title
        next_adjustment = "Выбрать действие меньше, яснее и дешевле по усилию."
    else:
        reason = f"Outcome observed: {action_title}."
        reinforce = ""
        weaken = ""
        next_adjustment = "Уточнить результат и связать его с текущей целью."

    return {
        "status": status,
        "score": round(score, 4),
        "reason": reason,
        "reinforce": reinforce,
        "weaken": weaken,
        "related_goal": goal,
        "next_adjustment": next_adjustment,
    }


def update_outcome_synapses(
    synapse_graph: Any,
    *,
    event: Event,
    outcome: dict[str, Any],
    working_memory: dict[str, Any] | None = None,
    plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    status = str(outcome.get("status") or "unknown")
    score = float(outcome.get("score") or 0.0)
    goal = _clean(outcome.get("related_goal"))
    adjustment = _clean(outcome.get("next_adjustment"))
    action = _top_action(plan)
    # Поверхность, рапортующая «я выполнил шаг X», знает действие точнее плана:
    # явный payload.action побеждает; иначе — действие плана, иначе текст события.
    action_title = _clean(event.payload.get("action")) or _clean(action.get("title") or _event_text(event))
    plan_goal = _clean(plan.get("goal")) if isinstance(plan, dict) else goal
    outcome_id = _stable_id(event.type, status, goal, action_title, _event_text(event))
    weight = max(0.05, min(1.0, score))
    touched: list[int] = []

    if action_title:
        touched.append(
            synapse_graph.upsert(
                source_type="action",
                source_id=_stable_id(action_title),
                target_type="outcome",
                target_id=outcome_id,
                relation_type="action_result",
                weight=weight,
                metadata={"summary": f"{action_title} -> {status}", "source_trust": 1.0},
            )
        )

    if goal:
        touched.append(
            synapse_graph.upsert(
                source_type="goal",
                source_id=_stable_id(goal),
                target_type="action",
                target_id=_stable_id(action_title),
                relation_type="goal_of",
                weight=weight,
                metadata={"summary": f"{goal} -> {action_title}", "source_trust": 1.0},
            )
        )
        touched.append(
            synapse_graph.upsert(
                source_type="goal",
                source_id=_stable_id(goal),
                target_type="outcome",
                target_id=outcome_id,
                relation_type="leads_to",
                weight=weight,
                metadata={"summary": f"{goal} -> {status}", "source_trust": 1.0},
            )
        )

    if plan_goal:
        touched.append(
            synapse_graph.upsert(
                source_type="plan",
                source_id=_stable_id(plan_goal),
                target_type="outcome",
                target_id=outcome_id,
                relation_type="evaluated_as",
                weight=weight,
                metadata={"summary": f"plan for {plan_goal} evaluated as {status}"},
            )
        )

    if adjustment:
        touched.append(
            synapse_graph.upsert(
                source_type="outcome",
                source_id=outcome_id,
                target_type="adaptation",
                target_id=_stable_id(adjustment),
                relation_type="adapted_by",
                weight=weight,
                metadata={"summary": adjustment},
            )
        )

    return {
        "updated": len(touched),
        "top": synapse_graph.get_top_synapses(limit=3),
    }
