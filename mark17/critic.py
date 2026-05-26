"""Deterministic self-evaluation for Max17 event handling."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from mark17.events import Event

STORE_EVENT_TYPES = frozenset(
    {
        "user_message",
        "task_created",
        "task_completed",
        "deadline_failed",
        "terminal_error",
        "system_state",
    }
)


@dataclass(frozen=True)
class SelfEvaluation:
    score: float
    reason: str
    store_memory: bool
    reinforce: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "score": round(max(0.0, min(1.0, self.score)), 4),
            "reason": self.reason,
            "store_memory": self.store_memory,
            "reinforce": self.reinforce,
        }


def _confidence(result: dict[str, Any]) -> float:
    plasticity = result.get("plasticity")
    if isinstance(plasticity, dict) and isinstance(plasticity.get("confidence"), (int, float)):
        return float(plasticity["confidence"])

    decision = result.get("decision")
    if isinstance(decision, dict) and isinstance(decision.get("confidence"), (int, float)):
        return float(decision["confidence"])

    return 0.0


def _reinforce(event: Event, result: dict[str, Any]) -> str:
    task = event.payload.get("task")
    if isinstance(task, dict) and task.get("desc"):
        return str(task["desc"])

    text = event.payload.get("text")
    if isinstance(text, str) and text.strip():
        return text.strip()[:240]

    plasticity = result.get("plasticity")
    if isinstance(plasticity, dict):
        hint = plasticity.get("hint")
        if hint:
            return str(hint)
        action = plasticity.get("action")
        if action:
            return str(action)

    memory = result.get("memory")
    if isinstance(memory, dict):
        hits = memory.get("hits")
        if isinstance(hits, list) and hits:
            summary = hits[0].get("summary")
            if summary:
                return f"recall:{summary}"

    route = result.get("route", "unknown")
    return f"observe:{event.type}:{route}"


def evaluate_event(event: Event, result: dict[str, Any]) -> SelfEvaluation:
    route = str(result.get("route", "unknown"))
    confidence = _confidence(result)
    store_memory = event.type in STORE_EVENT_TYPES
    score = 0.35 + min(confidence, 1.0) * 0.45
    reason = f"{event.type} handled through {route}"

    if route == "memory":
        score += 0.1
        reason = f"{event.type} resolved by memory route"
    elif route == "plasticity":
        learned = bool((result.get("plasticity") or {}).get("learned"))
        score += 0.1 if learned else 0.02
        reason = f"{event.type} reinforced through plasticity"
    elif route == "llm":
        llm = result.get("llm")
        status = llm.get("status") if isinstance(llm, dict) else None
        if status == "ok":
            score += 0.1
            reason = f"{event.type} escalated to LLM successfully"
        else:
            score -= 0.05
            reason = f"{event.type} routed to LLM with status {status or 'unknown'}"
    elif route == "ignore":
        store_memory = False
        score = 0.9
        reason = f"{event.type} ignored as low-signal heartbeat"

    if event.type == "deadline_failed":
        store_memory = True
        score = max(score, 0.7)
        reason = "deadline failure should be remembered for future planning"
    elif event.type in {"task_created", "task_completed"}:
        task = event.payload.get("task")
        desc = task.get("desc") if isinstance(task, dict) else None
        if desc:
            reason = f"{event.type}: {desc}"
    elif event.type == "system_state":
        store_memory = True
        score = max(score, 0.55)
        reason = "system state snapshot captured for context"

    return SelfEvaluation(
        score=max(0.0, min(1.0, score)),
        reason=reason,
        store_memory=store_memory,
        reinforce=_reinforce(event, result),
    )
