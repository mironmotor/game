"""Manual sleep/consolidation mode for Max17.

Compress recent memories and strong synapses into stable pattern memories.
This is deterministic and local: no background process, no external APIs.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from typing import Any

from mark17.events import Event

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

        patterns = [
            self._make_pattern(theme, evidence)
            for theme, evidence in buckets.items()
            if len(evidence) >= 2
        ]
        patterns.sort(key=lambda item: (item["strength"], item["evidence_count"]), reverse=True)
        selected = patterns[:5]

        for pattern in selected:
            self._store_pattern(pattern)

        return {
            "patterns_created": len(selected),
            "patterns": selected,
        }

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
