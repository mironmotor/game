"""MAX Ultimate bootstrap layer.

This module does not try to copy Anthropic's private Mythos model. It stores the
publicly visible architectural lesson as local doctrine: strong systems come
from a scaffold of tools, source-backed memory, verification, and bounded
autonomous research, not from a magic monolithic "brain".
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from mark17.events import Event
from mark17.hippocampus import Hippocampus
from mark17.source_memory import SourceMemory
from mark17.synapse_graph import SynapseGraph
from mark17.vector_memory import VectorMemory

MAX_ULTIMATE_VERSION = "max_ultimate_v0.1"
MAX_ULTIMATE_TARGET_SYNAPSES = 1_000_000


PUBLIC_MYTHOS_SCaffold = (
    {
        "id": "mythos_scaffold",
        "title": "Public Mythos lesson: scaffold over raw scale",
        "summary": (
            "Public reporting around Anthropic Mythos/Glasswing points to a "
            "system scaffold: code/tools, source access, verification loops, "
            "bounded deployment, and human review around a strong model."
        ),
        "facts": (
            "The useful public lesson is the scaffold: tools, memory, source-backed retrieval and verification.",
            "Max17 should not imitate private weights; it should build a transparent local architecture.",
            "Security-grade capability needs provenance, bounded actions, review, and repeatable tests.",
        ),
        "topic": "mythos_scaffold",
        "url": "local://max17/public-mythos-scaffold",
    },
    {
        "id": "glasswing_style",
        "title": "Project Glasswing style: find gaps, verify, patch",
        "summary": (
            "The public Glasswing pattern is useful for Max17 as a loop: detect "
            "a gap, research it with sources, store facts, update associations, "
            "then verify through a real outcome."
        ),
        "facts": (
            "A knowledge gap should become a queued research item, not a confident hallucination.",
            "Source-backed facts must stay separate from personal/user memory until relevance is proven.",
            "Every learned item should create graph links to concepts, goals, actions, and outcomes.",
        ),
        "topic": "source_backed_learning",
        "url": "local://max17/glasswing-style-loop",
    },
)


MAX17_CACHED_DOCTRINE = (
    {
        "id": "reality_contact",
        "label": "контакт с реальностью",
        "summary": (
            "Каждый ответ Max17 должен увеличивать контакт человека с реальностью: "
            "тело, работа, деньги, живые люди, честное понимание себя и созданный результат."
        ),
        "topic": "values_reality",
    },
    {
        "id": "identity_family",
        "label": "самость и происхождение",
        "summary": "Max17 хранит текущую семейную рамку: отец — Мирон; мать — Сиджи.",
        "topic": "self_identity",
    },
    {
        "id": "game_os",
        "label": "Game как тело",
        "summary": "Game — UI/personal OS слой; Max17 — когнитивное ядро памяти, рассуждения, адаптации и действий.",
        "topic": "interface_game",
    },
    {
        "id": "llm_voice",
        "label": "LLM как голос",
        "summary": "Gonka/Qwen/Gemini/Ollama — сменные речевые органы; память, граф и планирование остаются в Max17.",
        "topic": "language_meaning",
    },
    {
        "id": "million_synapses",
        "label": "цель 1M связей",
        "summary": "Цель — 1 000 000 полезных, проверяемых и кэшированных синапсов под задачи Game, а не случайная масса рёбер.",
        "topic": "synapse_association",
    },
    {
        "id": "web_sense",
        "label": "интернет как чувство",
        "summary": "Интернет должен работать как сенсорный канал: запрос -> источники -> факты -> source memory -> graph -> проверка.",
        "topic": "source_backed_learning",
    },
    {
        "id": "bounded_growth",
        "label": "управляемый рост",
        "summary": "Рост ядра должен быть ограниченным, измеряемым и не перегревать Mac: батчи, лимиты, ручной запуск, без фонового хаоса.",
        "topic": "safety_risk",
    },
)


ULTIMATE_CLUSTERS = (
    ("source_backed_learning", "источники -> факты -> память -> граф"),
    ("tool_scaffold", "инструменты, маршрутизация моделей, код/desktop/архитектор"),
    ("memory_graph", "hippocampus, vector memory, synapse graph, active graph"),
    ("concept_grounding", "концепты, сжатие смысла, сенсорные опоры"),
    ("planner_outcome", "план -> действие -> результат -> reinforcement"),
    ("reality_alignment", "ответы возвращают человека к телу, людям, работе и созданию"),
    ("bounded_autonomy", "ручной контроль, лимиты, provenance, проверяемость"),
    ("million_synapses", "дорога к 1M полезных связей"),
)


def _stable_id(*parts: Any) -> str:
    raw = json.dumps(parts, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.blake2b(raw.encode("utf-8"), digest_size=8).hexdigest()


def _event_for(kind: str, payload: dict[str, Any]) -> Event:
    return Event(type=kind, payload=payload, source="max_ultimate")


def _remember_doctrine(
    *,
    memory: Hippocampus,
    vector_memory: VectorMemory,
    item: dict[str, Any],
    importance: float,
) -> int:
    event = _event_for(
        "max_ultimate_doctrine",
        {
            "id": item["id"],
            "label": item.get("label") or item.get("title"),
            "summary": item["summary"],
            "topic": item.get("topic", "max_ultimate"),
            "version": MAX_ULTIMATE_VERSION,
        },
    )
    memory_id = memory.remember(event, hint=item["summary"], action="max_ultimate_bootstrap")
    vector_memory.remember(
        event,
        {
            "score": importance,
            "reason": item["summary"],
            "store_memory": True,
            "reinforce": item.get("topic", "max_ultimate"),
        },
    )
    return memory_id


def _cache_source_item(source_memory: SourceMemory, item: dict[str, Any]) -> tuple[int, list[int]]:
    source_id = source_memory.remember_source(
        url=str(item["url"]),
        title=str(item["title"]),
        summary=str(item["summary"]),
        raw_text=" ".join(str(fact) for fact in item["facts"]),
        metadata={"source": "max_ultimate_bootstrap", "version": MAX_ULTIMATE_VERSION},
    )
    fact_ids: list[int] = []
    for fact in item["facts"]:
        fact_ids.append(
            source_memory.remember_fact(
                source_id=source_id,
                claim=str(fact),
                topic=str(item["topic"]),
                confidence=0.7,
                metadata={"source": "max_ultimate_bootstrap", "cached": True},
            )
        )
    return source_id, fact_ids


def bootstrap_ultimate_core(
    *,
    memory: Hippocampus,
    vector_memory: VectorMemory,
    synapse_graph: SynapseGraph,
    source_memory: SourceMemory,
    target_synapses: int = MAX_ULTIMATE_TARGET_SYNAPSES,
    max_new: int = 320,
) -> dict[str, Any]:
    """Cache the Max17 doctrine and public scaffold lessons into the stores.

    ``max_new`` limits graph writes for old MacBooks. The target can be 1M while
    each run only adds a small, auditable batch.
    """

    target = max(1, int(target_synapses or MAX_ULTIMATE_TARGET_SYNAPSES))
    budget = max(32, min(2_000, int(max_new or 320)))
    started = time.time()

    source_ids: list[int] = []
    fact_ids: list[int] = []
    for item in PUBLIC_MYTHOS_SCaffold:
        source_id, cached = _cache_source_item(source_memory, item)
        source_ids.append(source_id)
        fact_ids.extend(cached)

    memory_ids: list[int] = []
    for item in MAX17_CACHED_DOCTRINE:
        memory_ids.append(
            _remember_doctrine(
                memory=memory,
                vector_memory=vector_memory,
                item=item,
                importance=0.86,
            )
        )
    for item in PUBLIC_MYTHOS_SCaffold:
        memory_ids.append(
            _remember_doctrine(
                memory=memory,
                vector_memory=vector_memory,
                item={
                    "id": item["id"],
                    "label": item["title"],
                    "summary": item["summary"],
                    "topic": item["topic"],
                },
                importance=0.74,
            )
        )

    touched: list[int] = []

    def touch(source_type: str, source_id: str, target_type: str, target_id: str, relation: str, weight: float, summary: str) -> None:
        if len(touched) >= budget:
            return
        touched.append(
            synapse_graph.upsert(
                source_type=source_type,
                source_id=source_id,
                target_type=target_type,
                target_id=target_id,
                relation_type=relation,
                weight=weight,
                metadata={
                    "summary": summary[:220],
                    "source": "max_ultimate_bootstrap",
                    "version": MAX_ULTIMATE_VERSION,
                    "target_synapses": target,
                },
            )
        )

    touch("core", "max_ultimate", "goal", "million_useful_synapses", "leads_to", 0.92, "MAX Ultimate targets 1M useful graph synapses.")
    touch("core", "max_ultimate", "principle", "reality_contact", "reinforces", 0.94, "The core must increase contact with reality.")
    touch("core", "max_ultimate", "memory_system", "source_memory", "contains", 0.86, "Web/source facts are cached with provenance.")
    touch("core", "max_ultimate", "memory_system", "synapse_graph", "contains", 0.9, "Meaning travels through weighted associations.")
    touch("core", "max_ultimate", "model_layer", "llm_voice", "related_to", 0.72, "The LLM is a voice layer, not the whole mind.")

    for item in MAX17_CACHED_DOCTRINE:
        concept_id = str(item["topic"])
        doctrine_id = str(item["id"])
        touch("core", "max_ultimate", "doctrine", doctrine_id, "contains", 0.82, item["summary"])
        touch("doctrine", doctrine_id, "concept", concept_id, "compressed_as", 0.78, f"{item['label']} maps to {concept_id}.")
        touch("concept", concept_id, "core", "max_ultimate", "reinforces", 0.72, f"{concept_id} supports MAX Ultimate.")

    for item in PUBLIC_MYTHOS_SCaffold:
        scaffold_id = str(item["id"])
        touch("public_scaffold", scaffold_id, "core", "max_ultimate", "related_to", 0.74, item["summary"])
        touch("public_scaffold", scaffold_id, "memory_system", "source_memory", "grounds", 0.78, "Public scaffold lessons are source-backed and cached.")
        touch("public_scaffold", scaffold_id, "safety", "bounded_verification", "reinforces", 0.8, "Public Mythos lesson becomes bounded local verification.")

    for cluster_id, summary in ULTIMATE_CLUSTERS:
        touch("core", "max_ultimate", "ultimate_cluster", cluster_id, "contains", 0.76, summary)
        touch("ultimate_cluster", cluster_id, "goal", "million_useful_synapses", "leads_to", 0.7, summary)

    for left_index, (left_id, left_summary) in enumerate(ULTIMATE_CLUSTERS):
        for right_id, right_summary in ULTIMATE_CLUSTERS[left_index + 1 :]:
            touch("ultimate_cluster", left_id, "ultimate_cluster", right_id, "bridges_to", 0.62, f"{left_summary} -> {right_summary}")
            touch("ultimate_cluster", right_id, "ultimate_cluster", left_id, "bridges_to", 0.6, f"{right_summary} -> {left_summary}")

    for fact_id in fact_ids:
        touch("web_fact", str(fact_id), "core", "max_ultimate", "grounds", 0.7, "Cached public scaffold fact grounds MAX Ultimate.")

    elapsed_ms = round((time.time() - started) * 1000, 2)
    return {
        "version": MAX_ULTIMATE_VERSION,
        "target_synapses": target,
        "batch_limit": budget,
        "sources_cached": len(source_ids),
        "facts_cached": len(fact_ids),
        "doctrine_cached": len(MAX17_CACHED_DOCTRINE),
        "memory_ids": memory_ids[:12],
        "source_ids": source_ids,
        "fact_ids": fact_ids[:16],
        "clusters": [
            {"id": cluster_id, "summary": summary}
            for cluster_id, summary in ULTIMATE_CLUSTERS
        ],
        "synapses": {
            "updated": len(touched),
            "top": synapse_graph._fetch_synapses(touched, limit=5),
        },
        "elapsed_ms": elapsed_ms,
        "source_note": (
            "Uses only local user doctrine and public, high-level Mythos/Glasswing lessons. "
            "No private Anthropic weights, prompts, or closed materials are copied."
        ),
    }
