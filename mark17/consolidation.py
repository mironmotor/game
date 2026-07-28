"""Manual sleep/consolidation mode for Max17.

Compress recent memories and strong synapses into stable pattern memories.
This is deterministic and local: no background process, no external APIs.

Сон подчиняется уравнению Фридмана

    (a'/a)^2 = (8 pi G / 3) * rho - k/a^2 + Lambda/3

Память — это расширяющаяся вселенная. Масштабный фактор ``a`` — её размер,
``rho`` — плотность свидетельств, ``k`` — кривизна (перевес доказательств),
``Lambda`` — тёмная энергия, то есть энтропийное давление.

Именно Lambda делает здесь настоящую работу: расширение разрежает вещество,
и паттерны, чья плотность падает ниже порога разрежения, не выживают до утра.
Без этого члена вселенная памяти либо схлопывается в один переобобщённый
паттерн (Big Crunch), либо копит мусор без предела. Судьба вселенной —
``expanding`` / ``flat`` / ``collapsing`` — считается из Omega и возвращается
наружу: ядро знает, в какую сторону едет его собственная память.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import defaultdict
from typing import Any

from mark17.events import Event

# --- Friedmann constants ---------------------------------------------------
# Gravitational coupling of evidence to the memory metric. Chosen as 1/(8 pi)
# so that the matter term of the Friedmann equation reduces to rho/3 and the
# critical density to 3H^2 — natural units for a memory-sized universe.
G_COSMO = 1.0 / (8.0 * math.pi)
# Dark energy: the entropy pressure that keeps diluting weak patterns.
LAMBDA_COSMO = 0.08
# A pattern below this diluted strength does not survive the expansion.
DILUTION_FLOOR = 0.18
# Universe size at which the memory space is considered "grown up".
SCALE_REFERENCE = 500.0
# Evidence per pattern that counts as normal density for this core.
EVIDENCE_REFERENCE = 6.0

TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_]+")
STOPWORDS = {
    "and",
    "the",
    "for",
    "with",
    "this",
    "that",
    "через",
    "пока",
    "этот",
    "такие",
    "событие",
    "события",
    "запрос",
    "задача",
    "task",
    "user_message",
    "remember",
    "session",
    "self",
    "evaluation",
    "self_evaluation",
    "evaluated",
    "evaluated_as",
    "as",
    "source",
    "route",
    "score",
    "status",
}

CONCEPTS = {
    "memory": {
        "memory",
        "semantic",
        "recall",
        "remember",
        "память",
        "памяти",
        "помнишь",
        "вспоминаю",
    },
    "pattern": {
        "pattern",
        "patterns",
        "consolidation",
        "паттерн",
        "паттерны",
        "связь",
        "связи",
    },
    "core": {
        "core",
        "brain",
        "kernel",
        "max17",
        "mark17",
        "ядро",
        "ядра",
        "мозг",
    },
    "development": {
        "development",
        "learning",
        "adaptive",
        "развитие",
        "обучение",
        "адаптация",
    },
    "task": {
        "task",
        "tasks",
        "completed",
        "failed",
        "deadline",
        "task_completed",
        "task_created",
        "deadline_failed",
        "задача",
        "квест",
        "дедлайн",
    },
}

CONCEPT_INDEX = {token: concept for concept, tokens in CONCEPTS.items() for token in tokens}


def _stable_id(text: str) -> str:
    return hashlib.blake2b(text.encode("utf-8"), digest_size=8).hexdigest()


def _tokens(text: str) -> list[str]:
    tokens: list[str] = []
    for raw in TOKEN_RE.findall(text.casefold()):
        if len(raw) < 3 or raw in STOPWORDS:
            continue
        tokens.append(CONCEPT_INDEX.get(raw, raw))
    return tokens


def _memory_text(memory: Any) -> str:
    content = getattr(memory, "content", {})
    parts = [getattr(memory, "event_type", "")]
    if isinstance(content, dict):
        hint = content.get("hint")
        if hint:
            parts.append(str(hint))
        payload = content.get("payload")
        if isinstance(payload, dict):
            for key in ("note", "text", "line", "reinforce", "event_type"):
                value = payload.get(key)
                if value:
                    parts.append(str(value))
            task = payload.get("task")
            if isinstance(task, dict):
                for key in ("desc", "status", "mgr"):
                    value = task.get(key)
                    if value:
                        parts.append(str(value))
    return " ".join(parts)


def _synapse_text(synapse: dict[str, Any]) -> str:
    return " ".join(
        str(synapse.get(key, ""))
        for key in ("source_type", "target_type", "relation_type", "summary")
    )


def friedmann(
    scale_factor: float,
    density: float,
    curvature: float,
    *,
    lambda_term: float = LAMBDA_COSMO,
) -> dict[str, Any]:
    """Solve (a'/a)^2 = (8 pi G / 3) rho - k/a^2 + Lambda/3 for the memory universe.

    Returns the Hubble rate, the density parameters and the resulting fate.
    """
    a = max(1e-6, float(scale_factor))

    matter_term = (8.0 * math.pi * G_COSMO / 3.0) * max(0.0, density)
    curvature_term = curvature / (a * a)
    lambda_over_3 = lambda_term / 3.0

    h_squared = matter_term - curvature_term + lambda_over_3
    hubble = math.sqrt(max(0.0, h_squared))

    # Critical density rho_c = 3H^2 / (8 pi G): the density that makes it flat.
    if h_squared > 0:
        critical = (3.0 * h_squared) / (8.0 * math.pi * G_COSMO)
        omega_m = max(0.0, density) / critical if critical > 0 else 0.0
        omega_lambda = lambda_over_3 / h_squared
    else:
        # H^2 <= 0: expansion has already stalled, the universe is turning over.
        critical = 0.0
        omega_m = 2.0
        omega_lambda = 0.0

    # Omega_total is the *content* of the universe: matter plus dark energy.
    # Curvature is not a third ingredient to add in — it is what is left over,
    # Omega_k = 1 - Omega_total. Summing all three would give exactly 1 for
    # every universe there is, which decides nothing.
    omega_total = omega_m + omega_lambda
    omega_k = 1.0 - omega_total

    if h_squared <= 0 or omega_total > 1.08:
        fate = "collapsing"
        note = (
            "Big Crunch: память схлопывается в переобобщённые паттерны — "
            "нужно больше новых событий, а не больше сна."
        )
    elif omega_total < 0.92:
        fate = "expanding"
        note = (
            "Открытая вселенная: связи разрежаются быстрее, чем крепнут — "
            "консолидируй чаще, иначе паттерны разлетятся."
        )
    else:
        fate = "flat"
        note = "Плоская вселенная: рост памяти и её сжатие уравновешены."

    # How hard the expansion dilutes what is already there.
    dilution = 1.0 / (1.0 + hubble)

    return {
        "scale_factor": round(a, 4),
        "hubble": round(hubble, 4),
        "density": round(max(0.0, density), 4),
        "critical_density": round(critical, 4),
        "curvature": round(curvature, 4),
        "omega_matter": round(omega_m, 4),
        "omega_lambda": round(omega_lambda, 4),
        "omega_curvature": round(omega_k, 4),
        "omega_total": round(omega_total, 4),
        "lambda": lambda_term,
        "dilution": round(dilution, 4),
        "fate": fate,
        "note": note,
        "equation": "(a'/a)^2 = (8 pi G/3) rho - k/a^2 + Lambda/3",
    }


class ConsolidationEngine:
    def __init__(self, hippocampus: Any, vector_memory: Any, synapse_graph: Any) -> None:
        self.hippocampus = hippocampus
        self.vector_memory = vector_memory
        self.synapse_graph = synapse_graph

    def consolidate_recent(self, limit: int = 50) -> dict[str, Any]:
        limit = max(5, min(int(limit or 50), 500))
        memories = self.hippocampus.recent(limit=limit)
        synapses = self.synapse_graph.get_top_synapses(limit=min(limit, 50))

        buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for memory in memories:
            text = _memory_text(memory)
            for token in set(_tokens(text)):
                buckets[token].append(
                    {
                        "source": "memory",
                        "text": text,
                        "importance": float(getattr(memory, "importance", 0.5)),
                    }
                )

        for synapse in synapses:
            text = _synapse_text(synapse)
            for token in set(_tokens(text)):
                buckets[token].append(
                    {
                        "source": "synapse",
                        "text": text,
                        "importance": float(synapse.get("weight", 0.4) or 0.4),
                    }
                )

        candidates = [
            self._make_pattern(theme, evidence)
            for theme, evidence in buckets.items()
            if len(evidence) >= 2
        ]
        candidates.sort(key=lambda item: (item["strength"], item["evidence_count"]), reverse=True)

        # Expansion first, then selection: Lambda decides what is still dense
        # enough to survive the night before we decide what to keep.
        cosmology = self._cosmology(memories, synapses, candidates)
        survivors, evaporated = self._dilute(candidates, cosmology["dilution"])
        selected = survivors[:5]

        for pattern in selected:
            self._store_pattern(pattern)

        return {
            "patterns_created": len(selected),
            "patterns": selected,
            "evaporated": evaporated,
            "cosmology": cosmology,
        }

    def _cosmology(
        self,
        memories: list[Any],
        synapses: list[dict[str, Any]],
        candidates: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Measure the memory universe, then solve Friedmann for it."""
        try:
            total_memories = int(self.hippocampus.stats().get("memories") or 0)
        except Exception:  # pragma: no cover - stats is best-effort telemetry
            total_memories = 0
        total_memories = max(total_memories, len(memories))

        # a — how far the memory universe has already expanded, from half size
        # at boot to full size once grown. A fresh core is a small universe,
        # not a Big Bang: letting a fall toward zero makes the k/a^2 term
        # diverge and evaporates every pattern the core has ever formed.
        scale = 0.5 + 0.5 * min(1.0, total_memories / SCALE_REFERENCE)

        evidence = sum(int(item.get("evidence_count") or 0) for item in candidates)
        # Density is evidence *per pattern*, not per node: the raw count scales
        # with vocabulary size, which says nothing about how dense the universe
        # actually is.
        mean_evidence = evidence / len(candidates) if candidates else 0.0
        density = min(1.5, mean_evidence / EVIDENCE_REFERENCE)

        # k > 0 (closed) when a handful of patterns hold most of the evidence:
        # that universe is headed for a crunch into one overgeneralised rule.
        # k < 0 (open) when evidence is spread thin and connections fly apart.
        if evidence > 0:
            concentration = sum(
                int(item.get("evidence_count") or 0) for item in candidates[:3]
            ) / evidence
        else:
            concentration = 0.0
        curvature = (concentration - 0.5) * 0.5

        return friedmann(scale, density, curvature)

    def _dilute(
        self,
        candidates: list[dict[str, Any]],
        dilution: float,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Lambda term: expansion thins everything out; the weak do not survive."""
        survivors: list[dict[str, Any]] = []
        evaporated: list[dict[str, Any]] = []

        for pattern in candidates:
            diluted = float(pattern["strength"]) * float(dilution)
            if diluted < DILUTION_FLOOR:
                evaporated.append(
                    {
                        "pattern_id": pattern["pattern_id"],
                        "summary": pattern["summary"],
                        "strength": pattern["strength"],
                        "diluted_strength": round(diluted, 4),
                    }
                )
            else:
                survivors.append({**pattern, "diluted_strength": round(diluted, 4)})

        return survivors, evaporated

    def _make_pattern(self, theme: str, evidence: list[dict[str, Any]]) -> dict[str, Any]:
        evidence_count = len(evidence)
        avg_importance = sum(item["importance"] for item in evidence) / evidence_count
        strength = min(1.0, avg_importance * 0.7 + min(evidence_count / 8, 1.0) * 0.3)
        examples = [item["text"] for item in evidence[:3]]
        summary = self._summary(theme, evidence_count, examples)
        return {
            "pattern_id": f"pattern:{_stable_id(theme + summary)}",
            "summary": summary,
            "evidence_count": evidence_count,
            "strength": round(strength, 4),
            "source": "consolidation",
        }

    def _summary(self, theme: str, evidence_count: int, examples: list[str]) -> str:
        readable = theme.replace("_", " ")
        if theme in CONCEPTS:
            readable = {
                "memory": "память и recall",
                "pattern": "паттерны и связи",
                "core": "развитие ядра",
                "development": "обучение и адаптация",
                "task": "задачи и результаты",
            }.get(theme, readable)

        return f"Повторяющийся паттерн: {readable} ({evidence_count} свидетельств)."

    def _store_pattern(self, pattern: dict[str, Any]) -> None:
        event = Event(
            type="consolidated_pattern",
            payload=pattern,
            source="consolidation",
        )
        self.hippocampus.remember(
            event,
            hint=str(pattern["summary"]),
            action="consolidation",
        )
        self.vector_memory.remember(
            event,
            {
                "score": pattern["strength"],
                "reason": "sleep consolidation pattern",
                "reinforce": pattern["summary"],
            },
        )
