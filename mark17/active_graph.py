"""Active subgraph for the current request (Max17 hot path).

Instead of scanning the whole synapse graph on every request, this assembles a
small "what is lit up right now" view from data already loaded in the response:
the activated concepts, the top synapses the engine touched, and the semantic
hits it already recalled. It performs no database reads of its own
(``cold_reads`` is therefore 0) and is meant to drive the causal decoder and
intuitive recall on the fast path.
"""

from __future__ import annotations

from typing import Any

from mark17.concept_codec import context_text, extract_concepts

NEXT_STEP_MARKERS = (
    "что дальше",
    "что делать дальше",
    "следующий шаг",
    "what next",
    "next step",
)


def _looks_like_next_step(text: str) -> bool:
    low = str(text or "").casefold()
    return any(marker in low for marker in NEXT_STEP_MARKERS)


def _synapse_brief(synapse: dict[str, Any]) -> dict[str, Any]:
    return {
        "source_type": synapse.get("source_type"),
        "source_id": synapse.get("source_id"),
        "target_type": synapse.get("target_type"),
        "target_id": synapse.get("target_id"),
        "relation_type": synapse.get("relation_type"),
        "weight": synapse.get("weight"),
        "summary": synapse.get("summary"),
    }


def _memory_echo(hit: dict[str, Any]) -> dict[str, Any]:
    return {
        "summary": hit.get("summary") or hit.get("text") or hit.get("reinforce") or "",
        "score": hit.get("score"),
        "event_type": hit.get("event_type"),
    }


def build_active_graph(
    *,
    text: str,
    working_memory: dict[str, Any] | None = None,
    concepts: list[dict[str, Any]] | None = None,
    top_synapses: list[dict[str, Any]] | None = None,
    semantic_hits: list[dict[str, Any]] | None = None,
    limit: int = 6,
) -> dict[str, Any]:
    """Build the activated subgraph from in-memory request data only."""
    activated_concepts = list(concepts) if concepts else extract_concepts(text, working_memory)

    # If the message itself was too vague to activate anything, resolve context
    # from working memory (current topic / goal) instead of a cold scan.
    if not activated_concepts and working_memory:
        activated_concepts = extract_concepts(context_text(working_memory))

    # Make sure planning-oriented questions light up the planning side even if
    # the literal trigger words were sparse.
    if _looks_like_next_step(text):
        present = {c["id"] for c in activated_concepts}
        for missing in ("planning", "action", "outcome"):
            if missing not in present:
                activated_concepts.append(
                    {
                        "id": missing,
                        "label": {"planning": "план", "action": "действие", "outcome": "результат"}[missing],
                        "confidence": 0.4,
                        "source_terms": ["next-step intent"],
                        "aliases": [missing],
                    }
                )

    activated_concepts = activated_concepts[:limit]
    activated_synapses = [_synapse_brief(s) for s in (top_synapses or []) if isinstance(s, dict)][:limit]
    memory_echoes = [_memory_echo(h) for h in (semantic_hits or []) if isinstance(h, dict)][:limit]

    hot_path = bool(activated_concepts) or bool(activated_synapses)
    return {
        "activated_concepts": activated_concepts,
        "activated_synapses": activated_synapses,
        "memory_echoes": memory_echoes,
        "hot_path": hot_path,
        "cold_reads": 0,
        "latency_hint": "fast" if hot_path else "warm",
        "source": "active_graph_v0",
    }
