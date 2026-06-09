"""Internal dreaming / synergy generation for Max17.

A manual, deterministic "internal thought" pass: it recombines concepts that
already co-occur in recent experience into small synergy patterns
(memory → planning → outcome, …). There is no autonomous background loop yet —
this only runs when an ``internal_dream`` / ``generate_synergies`` event arrives.
The orchestrator is responsible for persisting the result into memory and the
synapse graph.
"""

from __future__ import annotations

from typing import Any

from mark17.concept_codec import CODEC_RULES

_LABELS: dict[str, str] = {str(r["concept"]): str(r["label"]) for r in CODEC_RULES}
_LABELS.setdefault("core", "ядро")

# Ordered concept chains worth crystallising, with a human summary template.
SYNERGY_TEMPLATES: tuple[dict[str, Any], ...] = (
    {
        "concepts": ("memory", "planning", "outcome"),
        "summary": "Если Max17 помнит контекст и планирует следующий шаг, outcome loop усиливает рабочие паттерны.",
    },
    {
        "concepts": ("core", "memory", "action"),
        "summary": "Ядро опирается на память и переводит её в конкретное действие.",
    },
    {
        "concepts": ("intuition", "memory", "planning"),
        "summary": "Интуиция быстро поднимает похожий опыт из памяти и сразу предлагает шаг плана.",
    },
    {
        "concepts": ("performance", "synapse", "core"),
        "summary": "Горячий путь по top-K связям ускоряет ядро без холодного чтения всей памяти.",
    },
    {
        "concepts": ("subconscious", "memory", "synapse"),
        "summary": "Подсознание (глубокая память) подпитывает активные связи фоновым опытом.",
    },
    {
        "concepts": ("debugging", "action", "outcome"),
        "summary": "Отладка превращается в действие и проверяется по результату.",
    },
)


def _present_ids(
    recent_patterns: list[dict[str, Any]] | None,
    synapses: list[dict[str, Any]] | None,
    concepts: list[Any] | None,
) -> set[str]:
    present: set[str] = set()

    for concept in concepts or []:
        if isinstance(concept, dict):
            cid = str(concept.get("id") or concept.get("concept") or "")
        else:
            cid = str(concept or "")
        if cid:
            present.add(cid)

    for synapse in synapses or []:
        if not isinstance(synapse, dict):
            continue
        for key in ("source_id", "target_id"):
            value = str(synapse.get(key) or "")
            if value in _LABELS:
                present.add(value)

    for pattern in recent_patterns or []:
        if not isinstance(pattern, dict):
            continue
        blob = " ".join(
            str(pattern.get(k) or "") for k in ("label", "summary", "pattern_id")
        ).casefold()
        for cid, label in _LABELS.items():
            if cid in blob or label.casefold() in blob:
                present.add(cid)

    return present


def generate_synergies(
    recent_patterns: list[dict[str, Any]] | None,
    synapses: list[dict[str, Any]] | None,
    concepts: list[Any] | None,
    limit: int = 5,
) -> dict[str, Any]:
    present = _present_ids(recent_patterns, synapses, concepts)

    scored: list[tuple[float, dict[str, Any]]] = []
    for template in SYNERGY_TEMPLATES:
        ids = template["concepts"]
        overlap = sum(1 for cid in ids if cid in present)
        # Base relevance from overlap; templates with no overlap still allowed
        # as gentle "what could connect" dreams but ranked last.
        confidence = round(min(0.9, 0.3 + 0.2 * overlap), 4)
        labels = [_LABELS.get(cid, cid) for cid in ids]
        synergy = {
            "title": " → ".join(labels),
            "summary": str(template["summary"]),
            "concepts": list(ids),
            "confidence": confidence,
        }
        scored.append((overlap + confidence, synergy))

    scored.sort(key=lambda item: item[0], reverse=True)
    synergies = [synergy for _, synergy in scored[: max(1, limit)]]

    return {
        "synergies_created": len(synergies),
        "synergies": synergies,
        "source": "dreamer_v0",
    }
