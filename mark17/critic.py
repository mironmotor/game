"""Deterministic self-evaluation for Max17 event handling.

Оценка подчиняется уравнению Дирака

    (i * gamma^mu * d_mu - m) psi = 0

У этого уравнения есть решения с отрицательной энергией — античастицы. Для
ядра это означает: у каждой самооценки есть зеркальный двойник — оценка того
маршрута, который **не** был выбран. Та же масса, противоположный заряд.

По Фейнману-Штюкельбергу античастица движется назад во времени: анти-оценка
смотрит на уже случившееся событие и спрашивает «а что было бы, пойди мы
другим путём». Если у античастицы энергия выше, чем у частицы, пара
аннигилирует — и высвободившаяся энергия становится коррекцией, конкретной
поправкой к следующему шагу.

Всё детерминировано: никакого ML, тот же вход даёт ту же пару.
"""

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

ROUTES = ("plasticity", "memory", "llm", "ignore")

# Rest mass of an evaluation: the baseline score every route starts from.
REST_MASS = 0.35

# Pair annihilates only if the antiparticle is meaningfully hotter, otherwise
# every borderline call would produce a correction and the core would thrash.
ANNIHILATION_THRESHOLD = 0.08


@dataclass(frozen=True)
class AntiEvaluation:
    """The mirror evaluation of the route that was not taken."""

    route: str
    score: float
    reason: str
    charge: float           # opposite sign to the particle's valence
    annihilates: bool
    energy_released: float  # 2mc^2 on annihilation
    correction: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "route": self.route,
            "score": round(max(0.0, min(1.0, self.score)), 4),
            "reason": self.reason,
            "charge": round(self.charge, 4),
            "annihilates": self.annihilates,
            "energy_released": round(self.energy_released, 4),
            "correction": self.correction,
        }


@dataclass(frozen=True)
class SelfEvaluation:
    score: float
    reason: str
    store_memory: bool
    reinforce: str
    anti: AntiEvaluation | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "score": round(max(0.0, min(1.0, self.score)), 4),
            "reason": self.reason,
            "store_memory": self.store_memory,
            "reinforce": self.reinforce,
        }
        if self.anti is not None:
            payload["anti"] = self.anti.to_dict()
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


def _memory_evidence(result: dict[str, Any]) -> float:
    """Strongest memory signal available, whichever route actually ran."""
    memory = result.get("memory")
    if not isinstance(memory, dict):
        return 0.0

    scores: list[float] = []
    for key in ("hits", "recalled", "semantic"):
        hits = memory.get(key)
        if not isinstance(hits, list):
            continue
        for hit in hits:
            if isinstance(hit, dict) and isinstance(hit.get("score"), (int, float)):
                scores.append(float(hit["score"]))
    return max(scores) if scores else 0.0


def _score_route(event: Event, result: dict[str, Any], route: str) -> tuple[float, str]:
    """Score one route against the evidence that is actually on the table.

    This is the counterfactual engine: it is called once for the route that
    ran, and once for the route that did not. A route gets credit only for
    evidence that exists — which is why "we should have used memory" only
    fires when there really were strong memory hits.
    """
    confidence = _confidence(result)
    score = REST_MASS + min(confidence, 1.0) * 0.45
    reason = f"{event.type} handled through {route}"

    if route == "memory":
        evidence = _memory_evidence(result)
        score += 0.1 if evidence else -0.15
        score += evidence * 0.2
        reason = (
            f"{event.type} resolved by memory route"
            if evidence
            else f"{event.type} via memory route without recall evidence"
        )
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
        elif status is None:
            # The LLM never ran on this path — a counterfactual costs latency
            # and tokens we cannot claim we would have spent well.
            score -= 0.12
            reason = f"{event.type} would have escalated to LLM unverified"
        else:
            score -= 0.05
            reason = f"{event.type} routed to LLM with status {status or 'unknown'}"
    elif route == "ignore":
        score = 0.9 if event.type == "ping" else 0.2
        reason = (
            f"{event.type} ignored as low-signal heartbeat"
            if event.type == "ping"
            else f"{event.type} would have been dropped"
        )

    return max(0.0, min(1.0, score)), reason


def _anti_route(result: dict[str, Any], route: str) -> str:
    """The route the wave function nearly collapsed into."""
    decision = result.get("decision")
    if isinstance(decision, dict):
        superposition = decision.get("superposition")
        if isinstance(superposition, dict):
            runner_up = superposition.get("runner_up")
            if isinstance(runner_up, str) and runner_up and runner_up != route:
                return runner_up

    # No wave function available: mirror onto the natural opposite.
    mirror = {
        "plasticity": "llm",
        "llm": "plasticity",
        "memory": "plasticity",
        "ignore": "plasticity",
    }
    return mirror.get(route, "llm")


def _antiparticle(
    event: Event,
    result: dict[str, Any],
    route: str,
    particle_score: float,
    particle_charge: float,
) -> AntiEvaluation:
    anti_route = _anti_route(result, route)
    anti_score, anti_reason = _score_route(event, result, anti_route)

    delta = anti_score - particle_score
    annihilates = delta > ANNIHILATION_THRESHOLD

    if annihilates:
        # E = 2mc^2 — both rest masses converted at once.
        energy = 2.0 * min(particle_score, anti_score)
        correction = (
            f"Аннигиляция: маршрут «{anti_route}» дал бы +{delta:.2f} к оценке. "
            f"В следующий раз на событии {event.type} пробуй {anti_route}."
        )
    else:
        energy = 0.0
        correction = (
            f"Пара устойчива: «{route}» держит преимущество {abs(delta):.2f} "
            f"над «{anti_route}»."
        )

    return AntiEvaluation(
        route=anti_route,
        score=anti_score,
        # Same mass, opposite charge — that is what makes it an antiparticle.
        charge=-particle_charge,
        reason=anti_reason,
        annihilates=annihilates,
        energy_released=energy,
        correction=correction,
    )


def evaluate_event(event: Event, result: dict[str, Any]) -> SelfEvaluation:
    route = str(result.get("route", "unknown"))
    store_memory = event.type in STORE_EVENT_TYPES
    score, reason = _score_route(event, result, route)

    if route == "ignore":
        store_memory = False

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
    # Valence of the particle, mapped onto the -1..1 charge axis.
    charge = score * 2.0 - 1.0

    return SelfEvaluation(
        score=score,
        reason=reason,
        store_memory=store_memory,
        reinforce=_reinforce(event, result),
        anti=_antiparticle(event, result, route, score, charge),
    )
