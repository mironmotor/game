"""Intuitive (fast) recall for Max17.

A "felt sense" reading of the request built only from the active subgraph —
activated concepts, the top synapses already loaded, and the semantic echoes the
engine recalled. It does not run its own database scan; it is the fast,
associative counterpart to deliberate recall.
"""

from __future__ import annotations

from typing import Any

from mark17.concept_codec import context_text, extract_concepts


def _event_text(event: Any) -> str:
    payload = getattr(event, "payload", None)
    if isinstance(payload, dict):
        for key in ("text", "line"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return str(getattr(event, "type", "") or "")


def intuitive_recall(
    event: Any,
    working_memory: dict[str, Any] | None,
    concept_graph: dict[str, Any] | None,
    limit: int = 5,
) -> dict[str, Any]:
    graph = concept_graph if isinstance(concept_graph, dict) else {}
    concepts = graph.get("activated_concepts")
    if not isinstance(concepts, list) or not concepts:
        concepts = extract_concepts(_event_text(event), working_memory)

    supporting_concepts = [
        str(c.get("label") or c.get("id"))
        for c in concepts[:limit]
        if isinstance(c, dict)
    ]

    echoes = graph.get("memory_echoes")
    echoes = echoes if isinstance(echoes, list) else []
    supporting_memories = [
        str(echo.get("summary"))
        for echo in echoes[:limit]
        if isinstance(echo, dict) and echo.get("summary")
    ]

    synapses = graph.get("activated_synapses")
    synapses = synapses if isinstance(synapses, list) else []

    primary_label = supporting_concepts[0] if supporting_concepts else ""
    confidence = _confidence(concepts, supporting_memories, synapses)

    if not primary_label:
        intuition = "Интуитивно запрос пока без явной темы — нужен ещё один контакт с контекстом."
    else:
        linked = ", ".join(supporting_concepts[1:3])
        if linked:
            intuition = (
                f"Интуитивно текущий запрос относится к теме «{primary_label}»: "
                f"она уже связана с {linked}."
            )
        else:
            intuition = f"Интуитивно текущий запрос тяготеет к теме «{primary_label}»."

    return {
        "intuition": intuition,
        "confidence": round(confidence, 4),
        "supporting_concepts": supporting_concepts,
        "supporting_memories": supporting_memories,
        "source": "active_graph",
    }


def _confidence(
    concepts: list[dict[str, Any]],
    memories: list[str],
    synapses: list[dict[str, Any]],
) -> float:
    if not concepts:
        return 0.2
    top = 0.0
    for concept in concepts:
        if isinstance(concept, dict):
            try:
                top = max(top, float(concept.get("confidence") or 0.0))
            except (TypeError, ValueError):
                continue
    support = min(0.2, 0.05 * (len(memories) + len(synapses)))
    return max(0.0, min(0.95, top * 0.8 + support))
