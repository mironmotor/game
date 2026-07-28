"""Deterministic self-evaluation for Max17 event handling."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from mark17.cognitive_physics import DiracPair, annihilate, conjugate
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
    dirac: DiracPair | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "score": round(max(0.0, min(1.0, self.score)), 4),
            "reason": self.reason,
            "store_memory": self.store_memory,
            "reinforce": self.reinforce,
        }
        if self.dirac is not None:
            payload["dirac"] = self.dirac.to_dict()
            payload["uncertain"] = self.dirac.uncertain
        return payload


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


def _antiparticle(event: Event, result: dict[str, Any], score: float) -> float:
    """Evidence that the same handling was actually a *failure*.

    The Dirac equation's negative-energy solutions are not an artefact to be
    discarded — they are antimatter, and they are real. So every evaluation gets
    its conjugate reading built from the same run: the route that fired without
    learning anything, the LLM that was reached but did not answer, the memory
    lookup that returned nothing, the confidence asserted with no pattern behind
    it.

    The baseline is the naive conjugate ``1 - score``. Note what that implies:
    when nothing below fires, ``annihilate`` returns exactly the original score,
    so this layer is a no-op unless there is genuine counter-evidence. It can
    only ever move a score that was overstated.
    """
    anti = conjugate(score)
    route = str(result.get("route", "unknown"))

    if route == "plasticity":
        plasticity = result.get("plasticity")
        if isinstance(plasticity, dict) and not plasticity.get("learned"):
            # The reflex fired, but nothing was actually reinforced.
            anti += 0.18

    elif route == "llm":
        llm = result.get("llm")
        status = llm.get("status") if isinstance(llm, dict) else None
        if status != "ok":
            anti += 0.3

    elif route == "memory":
        memory = result.get("memory")
        hits = (memory or {}).get("hits") if isinstance(memory, dict) else None
        recalled = (memory or {}).get("recalled") if isinstance(memory, dict) else None
        if not hits and not recalled:
            # Routed to memory and memory had nothing to say.
            anti += 0.25

    if _confidence(result) < 0.2 and route != "ignore":
        anti += 0.1

    if event.type in {"deadline_failed", "terminal_error"}:
        # The event itself carries negative charge: something in the world broke,
        # and a smooth internal handling does not undo that.
        anti += 0.12

    return max(0.0, min(1.0, anti))


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

    score = max(0.0, min(1.0, score))

    # Dirac: pair-produce the conjugate reading and let the two annihilate.
    # What survives is the net charge — the score the run actually earned.
    pair = annihilate(score, _antiparticle(event, result, score))
    if pair.uncertain:
        reason = f"{reason} (uncertain: evidence annihilates)"

    return SelfEvaluation(
        score=pair.net,
        reason=reason,
        store_memory=store_memory,
        reinforce=_reinforce(event, result),
        dirac=pair,
    )
