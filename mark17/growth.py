"""Deterministic synapse growth loop for Max17.

This module grows useful association density after an event has already been
handled. It does not create random edges; it links event, intent, topic, goal,
answer, plan actions, and environment context into the SynapseGraph.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from mark17.events import Event
from mark17.synapse_graph import SynapseGraph
from mark17.working_memory import detect_intent, topic_for_event

TARGET_GRAPH_SYNAPSES = 100_000


def _stable_id(*parts: Any) -> str:
    raw = json.dumps(parts, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.blake2b(raw.encode("utf-8"), digest_size=8).hexdigest()


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def _text(value: Any, limit: int = 220) -> str:
    return " ".join(str(value or "").strip().split())[:limit]


def _event_text(event: Event) -> str:
    if isinstance(event.payload.get("text"), str):
        return _text(event.payload["text"])
    if isinstance(event.payload.get("line"), str):
        return _text(event.payload["line"])
    task = event.payload.get("task")
    if isinstance(task, dict) and task.get("desc"):
        return _text(task["desc"])
    return _text(event.type)


def _confidence(response: dict[str, Any]) -> float:
    value = response.get("confidence")
    if isinstance(value, (int, float)):
        return _clamp(float(value))
    plasticity = response.get("plasticity")
    if isinstance(plasticity, dict) and isinstance(plasticity.get("confidence"), (int, float)):
        return _clamp(float(plasticity["confidence"]))
    return 0.35


def _evaluation_score(self_evaluation: dict[str, Any] | None) -> float:
    if isinstance(self_evaluation, dict) and isinstance(self_evaluation.get("score"), (int, float)):
        return _clamp(float(self_evaluation["score"]))
    return 0.35


def _working_value(working_memory: dict[str, Any] | None, key: str) -> str:
    if not isinstance(working_memory, dict):
        return ""
    return _text(working_memory.get(key))


def _answer_text(response: dict[str, Any]) -> str:
    answer = response.get("answer")
    if isinstance(answer, dict):
        return _text(answer.get("text"), 320)
    return ""


def _plan_actions(response: dict[str, Any]) -> list[dict[str, Any]]:
    plan = response.get("plan")
    if not isinstance(plan, dict):
        return []
    actions = plan.get("actions")
    return [action for action in actions if isinstance(action, dict)] if isinstance(actions, list) else []


def _top_memory_summaries(response: dict[str, Any], *, limit: int = 2) -> list[tuple[str, str]]:
    memory = response.get("memory")
    if not isinstance(memory, dict):
        return []

    found: list[tuple[str, str]] = []
    for memory_type, key in (("semantic_memory", "semantic"), ("memory", "recalled")):
        rows = memory.get(key)
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            summary = _text(row.get("summary") or row.get("reinforce"))
            if summary:
                found.append((memory_type, summary))
            if len(found) >= limit:
                return found
    return found


def _concept_matches(response: dict[str, Any], *, limit: int = 6) -> list[dict[str, Any]]:
    concepts = response.get("concepts")
    if not isinstance(concepts, dict):
        return []
    matches = concepts.get("matches")
    if not isinstance(matches, list):
        return []
    return [item for item in matches[:limit] if isinstance(item, dict)]


def _vision_context(event: Event) -> dict[str, Any]:
    camera = event.payload.get("camera")
    if not isinstance(camera, dict):
        return {}
    summary = camera.get("vision_summary")
    summary = summary if isinstance(summary, dict) else {}
    return {
        "scene_mode": _text(camera.get("scene_mode") or summary.get("scene_mode")),
        "summary": _text(camera.get("summary") or summary.get("summary")),
        "motion_level": _text(camera.get("motion_level") or summary.get("motion_level")),
        "light_level": _text(camera.get("light_level") or summary.get("light_level")),
    }


def grow_synapses(
    synapse_graph: SynapseGraph,
    *,
    event: Event,
    response: dict[str, Any],
    working_memory: dict[str, Any] | None = None,
    self_evaluation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Add useful behavioral/context associations after normal event handling."""

    event_text = _event_text(event)
    intent = _working_value(working_memory, "last_user_intent") or detect_intent(event_text, event.type)
    topic = _working_value(working_memory, "current_topic") or topic_for_event(event.type, event_text)
    goal = _working_value(working_memory, "active_goal") or event_text
    mode = _working_value(working_memory, "current_mode") or "unknown"
    next_step = _text(response.get("next_adaptation") or _working_value(working_memory, "suggested_next_step"))
    answer = _answer_text(response)
    route = _text(response.get("route") or "unknown", 80)
    confidence = _confidence(response)
    score = _evaluation_score(self_evaluation)
    base = _clamp(0.18 + confidence * 0.35 + score * 0.35)

    event_id = _stable_id("event", event.type, event.signature())
    touched: list[int] = []

    def touch(
        source_type: str,
        source_id: str,
        target_type: str,
        target_id: str,
        relation_type: str,
        weight: float,
        summary: str,
    ) -> None:
        if not source_id or not target_id or source_id == target_id:
            return
        touched.append(
            synapse_graph.upsert(
                source_type=source_type,
                source_id=source_id,
                target_type=target_type,
                target_id=target_id,
                relation_type=relation_type,
                weight=_clamp(weight),
                metadata={
                    "summary": _text(summary),
                    "source": "growth_loop_v0",
                    "event_type": event.type,
                },
            )
        )

    if intent:
        touch("event", event_id, "intent", intent, "related_to", base, f"{event.type} expresses intent:{intent}")
    if topic:
        touch("event", event_id, "topic", topic, "related_to", base * 0.95, f"{event.type} belongs to topic:{topic}")
    if mode and intent:
        touch("intent", intent, "mode", mode, "related_to", base * 0.88, f"intent:{intent} runs in mode:{mode}")
    if topic and goal:
        topic_id = _stable_id("topic", topic)
        goal_id = _stable_id("goal", goal)
        touch("topic", topic_id, "goal", goal_id, "leads_to", base * 0.95, f"{topic} supports goal: {goal}")
        touch("event", event_id, "goal", goal_id, "leads_to", base * 0.9, f"{event.type} updates goal: {goal}")
    else:
        goal_id = _stable_id("goal", goal) if goal else ""

    if route and intent:
        touch("intent", intent, "route", route, "routed_to", base * 0.82, f"intent:{intent} usually routes to {route}")
    if next_step and goal_id:
        step_id = _stable_id("adaptation", next_step)
        touch("goal", goal_id, "adaptation", step_id, "adapted_by", base * 0.86, f"goal uses next adaptation: {next_step}")
    if answer and goal_id:
        answer_id = _stable_id("answer", answer)
        touch("answer", answer_id, "goal", goal_id, "reinforces", base * 0.84, f"answer reinforces goal: {goal}")
        touch("event", event_id, "answer", answer_id, "leads_to", base * 0.8, "event produced a human-readable answer")

    actions = _plan_actions(response)
    if actions and goal_id:
        plan_id = _stable_id("plan", response.get("plan"))
        touch("goal", goal_id, "plan", plan_id, "leads_to", base * 0.88, f"goal creates plan for: {goal}")
        for action in actions[:3]:
            title = _text(action.get("title"), 160)
            if not title:
                continue
            action_id = _stable_id("action", title)
            touch("plan", plan_id, "action", action_id, "leads_to", base * 0.86, f"plan suggests action: {title}")
            touch("action", action_id, "goal", goal_id, "reinforces", base * 0.82, f"action supports goal: {goal}")

    for memory_type, summary in _top_memory_summaries(response):
        memory_id = _stable_id(memory_type, summary)
        if goal_id:
            touch(memory_type, memory_id, "goal", goal_id, "related_to", base * 0.78, f"memory supports goal: {summary}")
        if topic:
            touch(memory_type, memory_id, "topic", _stable_id("topic", topic), "related_to", base * 0.76, f"memory belongs near topic: {topic}")

    for concept in _concept_matches(response):
        concept_id = _text(concept.get("id"), 80)
        label = _text(concept.get("label") or concept_id, 120)
        summary = _text(concept.get("summary"), 180)
        if not concept_id:
            continue
        touch("event", event_id, "concept", concept_id, "related_to", base * 0.9, f"event grounded in concept: {label}")
        if topic:
            touch("concept", concept_id, "topic", _stable_id("topic", topic), "related_to", base * 0.82, f"{label} supports topic: {topic}")
        if goal_id:
            touch("concept", concept_id, "goal", goal_id, "related_to", base * 0.82, f"{label} supports goal: {goal}")
        if summary and answer:
            touch("concept", concept_id, "answer", _stable_id("answer", answer), "reinforces", base * 0.72, f"{label}: {summary}")

        channels = concept.get("sensory_grounding")
        if isinstance(channels, list):
            for channel in channels[:4]:
                channel_id = _text(channel, 80)
                if channel_id:
                    touch("concept", concept_id, "sensory_channel", channel_id, "related_to", base * 0.86, f"{label} is grounded by {channel_id}")

        relations = concept.get("relations")
        if isinstance(relations, list):
            for relation in relations[:4]:
                relation_id = _text(relation, 80)
                if relation_id:
                    touch("concept", concept_id, "concept", relation_id, "related_to", base * 0.68, f"{label} relates to {relation_id}")

    vision = _vision_context(event)
    if vision:
        scene = vision.get("scene_mode")
        scene_summary = vision.get("summary") or scene
        if scene:
            scene_id = _stable_id("scene", scene)
            touch("event", event_id, "scene", scene_id, "related_to", base * 0.86, f"vision scene: {scene_summary}")
            if topic:
                touch("scene", scene_id, "topic", _stable_id("topic", topic), "related_to", base * 0.8, f"scene context supports topic: {topic}")
            if goal_id:
                touch("scene", scene_id, "goal", goal_id, "related_to", base * 0.78, f"scene context supports goal: {goal}")

    return {
        "updated": len(touched),
        "target_synapses": TARGET_GRAPH_SYNAPSES,
        "top": synapse_graph._fetch_synapses(touched, limit=3),
    }
