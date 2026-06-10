#!/usr/bin/env python3
"""JSON bridge CLI for Game -> Max17.

mark17 is the internal package name for the Max17 core.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.daemon import Mark17Brain
from mark17.events import Event
from mark17.critic import evaluate_event
from mark17.gonka_bridge import chat as gonka_chat, is_enabled as gonka_is_enabled
from mark17.responder import compose_answer
from mark17.vector_memory import VectorMemory
from mark17.synapse_graph import SynapseGraph
from mark17.consolidation import ConsolidationEngine
from mark17.working_memory import WorkingMemory
from mark17.planner import plan_next_actions
from mark17.outcome import OUTCOME_EVENT_TYPES, evaluate_outcome, update_outcome_synapses
from mark17.growth import grow_synapses
from mark17.synapse_growth import propose_seeds
from mark17.concepts import ConceptGrounding
from mark17.concept_compression import compress_to_concept
from mark17.concept_codec import extract_concepts as codec_extract_concepts
from mark17.active_graph import build_active_graph
from mark17.causal_decoder import decode_causal_chain
from mark17.intuitive_memory import intuitive_recall
from mark17.dreamer import generate_synergies
from mark17.environment import analyze_environment, extract_observation
from mark17.graph_stats import GraphStats, collect_store_counts
from mark17.neural_graph import ClusteredNeuralGraph, TARGET_NEURAL_SYNAPSES
from mark17.curiosity import CuriosityLedger
from mark17.orchestrator import classify as classify_intent
from mark17.source_memory import SourceMemory
from mark17.web_sense import (
    WEB_SYNAPSE_TARGET,
    detect_knowledge_gap,
    normalize_text as _web_normalize,
    web_research,
)

ALLOWED_EVENTS = frozenset(
    {
        "user_message",
        "task_created",
        "task_completed",
        "deadline_failed",
        "terminal_error",
        "system_state",
        "environment_observation",
        "sleep_consolidation",
        "working_memory_reset",
        "outcome_success",
        "outcome_failure",
        "outcome_partial",
        "action_done",
        "action_skipped",
        "compress_memory",
        "graph_stats",
        "neural_seed",
        "neural_walk",
        "internal_dream",
        "generate_synergies",
        "web_research",
        "web_ingest",
        "autonomous_research",
    }
)


def _read_input() -> dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        raise ValueError("missing JSON input on stdin")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("input must be a JSON object")
    return data


def _as_event(data: dict[str, Any]) -> Event:
    event_type = str(data.get("type") or data.get("event") or "")
    if event_type not in ALLOWED_EVENTS:
        allowed = ", ".join(sorted(ALLOWED_EVENTS))
        raise ValueError(f"unsupported event type '{event_type}'. Allowed: {allowed}")

    payload = {
        key: value
        for key, value in data.items()
        if key not in {"type", "event", "source", "ts"}
    }

    if event_type in {"user_message", "compress_memory"}:
        text = data.get("message") or data.get("text") or data.get("content") or ""
        payload["text"] = str(text)
    elif event_type in {"web_research", "web_ingest"}:
        text = data.get("query") or data.get("text") or data.get("message") or data.get("content") or ""
        payload["query"] = str(text)
    elif event_type == "terminal_error":
        line = data.get("line") or data.get("message") or data.get("text") or ""
        payload["line"] = str(line)

    return Event(
        type=event_type,
        payload=payload,
        source=str(data.get("source", "game")),
    )


def _next_adaptation(result: dict[str, Any]) -> str:
    existing = result.get("next_adaptation")
    if isinstance(existing, str) and existing.strip():
        return existing

    evaluation = result.get("self_evaluation")
    if isinstance(evaluation, dict) and evaluation.get("reinforce"):
        return str(evaluation["reinforce"])

    memory = result.get("memory")
    if isinstance(memory, dict):
        if memory.get("hint"):
            return str(memory["hint"])
        hits = memory.get("hits")
        if isinstance(hits, list) and hits:
            summary = hits[0].get("summary")
            if summary:
                return f"Recall related memory: {summary}"

    plasticity = result.get("plasticity")
    if isinstance(plasticity, dict):
        if plasticity.get("hint"):
            return str(plasticity["hint"])
        if plasticity.get("learned"):
            return "Pattern reinforced. Keep watching for repeated context."

    llm = result.get("llm")
    if isinstance(llm, dict) and llm.get("text"):
        return str(llm["text"]).splitlines()[0][:240]

    decision = result.get("decision")
    if isinstance(decision, dict) and decision.get("reason"):
        return str(decision["reason"])

    return "No adaptation proposed."


def _confidence(result: dict[str, Any]) -> float:
    plasticity = result.get("plasticity")
    if isinstance(plasticity, dict) and isinstance(plasticity.get("confidence"), (int, float)):
        return float(plasticity["confidence"])

    decision = result.get("decision")
    if isinstance(decision, dict) and isinstance(decision.get("confidence"), (int, float)):
        return float(decision["confidence"])

    return 0.0


def _recalled_memories(event: Event, brain: Mark17Brain) -> list[dict[str, Any]]:
    if event.type != "user_message":
        return []

    query = str(event.payload.get("text") or "").strip()
    if not query:
        return []

    return [
        {
            "id": hit.id,
            "event_type": hit.event_type,
            "importance": round(hit.importance, 3),
            "score": round(hit.score, 3),
            "summary": hit.content.get("hint") or hit.signature[:120],
            "reinforce": hit.content.get("payload", {}).get("reinforce"),
        }
        for hit in brain.memory.recall(query, limit=3)
    ]


def _semantic_memories(event: Event, vector_memory: VectorMemory) -> list[dict[str, Any]]:
    if event.type != "user_message":
        return []

    query = str(event.payload.get("text") or "").strip()
    if not query:
        return []

    return [hit.to_dict() for hit in vector_memory.recall(query, limit=3)]


def _recent_consolidated_patterns(brain: Mark17Brain, *, limit: int = 5) -> list[dict[str, Any]]:
    patterns: list[dict[str, Any]] = []
    for hit in brain.memory.recent(
        limit=limit,
        event_type="consolidated_pattern",
        source="consolidation",
    ):
        payload = hit.content.get("payload") if isinstance(hit.content, dict) else None
        payload = payload if isinstance(payload, dict) else {}
        summary = payload.get("summary") or hit.content.get("hint") or hit.signature[:120]
        patterns.append(
            {
                "id": hit.id,
                "event_type": hit.event_type,
                "importance": round(hit.importance, 3),
                "score": round(hit.score, 3),
                "summary": summary,
                "pattern_id": payload.get("pattern_id"),
                "evidence_count": payload.get("evidence_count"),
                "strength": payload.get("strength"),
                "concept": payload.get("concept"),
                "label": payload.get("label"),
                "source": payload.get("source") or hit.content.get("source"),
            }
        )
    return patterns


def _merge_memory(
    result: dict[str, Any],
    *,
    recalled: list[dict[str, Any]],
    semantic: list[dict[str, Any]],
    consolidated_patterns: list[dict[str, Any]] | None = None,
) -> None:
    memory = result.get("memory")
    if not isinstance(memory, dict):
        memory = {}
    memory["recalled"] = recalled
    memory["semantic"] = semantic
    if consolidated_patterns is not None:
        memory["consolidated_patterns"] = consolidated_patterns
    result["memory"] = memory


def _stable_id(*parts: Any) -> str:
    raw = json.dumps(parts, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.blake2b(raw.encode("utf-8"), digest_size=8).hexdigest()


def _event_text(event: Event) -> str:
    if isinstance(event.payload.get("text"), str):
        return str(event.payload["text"]).strip()
    if isinstance(event.payload.get("line"), str):
        return str(event.payload["line"]).strip()
    task = event.payload.get("task")
    if isinstance(task, dict) and task.get("desc"):
        return str(task["desc"]).strip()
    if event.payload:
        return json.dumps(event.payload, ensure_ascii=False, sort_keys=True)[:500]
    return event.type


def _merge_concept_payload(
    result: dict[str, Any],
    *,
    grounding: dict[str, Any] | None = None,
    compression: dict[str, Any] | None = None,
) -> None:
    concepts = result.get("concepts")
    concepts = concepts if isinstance(concepts, dict) else {}
    if isinstance(grounding, dict):
        concepts.update(grounding)
    if isinstance(compression, dict):
        primary = compression.get("primary")
        if isinstance(primary, dict):
            concepts["primary"] = primary
        related = compression.get("related")
        if isinstance(related, list):
            concepts["related"] = related
        keywords = compression.get("keywords")
        if isinstance(keywords, list):
            concepts["keywords"] = keywords
        concepts["compression_source"] = compression.get("source", "concept_compression_v0")
    result["concepts"] = concepts


def _apply_event_compression(
    result: dict[str, Any],
    event: Event,
    working_memory: dict[str, Any] | None = None,
) -> dict[str, Any]:
    compression = compress_to_concept(_event_text(event), working_memory)
    _merge_concept_payload(result, compression=compression)
    return compression


def _apply_hot_path(result: dict[str, Any], event: Event) -> None:
    """Attach the activated subgraph, intuition and causal decoder.

    Pure transform over fields already in ``result`` (top synapses, semantic
    hits, concepts, working memory) plus in-memory concept extraction — it does
    no extra database reads, so it stays on the hot path.
    """
    text = _event_text(event)
    working_memory = result.get("working_memory")
    working_memory = working_memory if isinstance(working_memory, dict) else None
    concepts = codec_extract_concepts(text, working_memory)

    synapses = result.get("synapses")
    top_synapses = synapses.get("top") if isinstance(synapses, dict) else None
    memory = result.get("memory")
    semantic = memory.get("semantic") if isinstance(memory, dict) else None

    active_graph = build_active_graph(
        text=text,
        working_memory=working_memory,
        concepts=concepts,
        top_synapses=top_synapses if isinstance(top_synapses, list) else None,
        semantic_hits=semantic if isinstance(semantic, list) else None,
    )
    result["active_graph"] = active_graph
    result["intuition"] = intuitive_recall(event, working_memory, active_graph)
    result["causal_decoder"] = decode_causal_chain(
        active_graph,
        working_memory,
        result.get("plan") if isinstance(result.get("plan"), dict) else None,
        result.get("outcome") if isinstance(result.get("outcome"), dict) else None,
    )

    concepts_payload = result.get("concepts")
    if isinstance(concepts_payload, dict):
        concepts_payload["activated"] = active_graph.get("activated_concepts", [])
        concepts_payload["codec_source"] = "concept_codec_v0"


def _apply_environment_reasoning(
    result: dict[str, Any],
    event: Event,
    brain: Mark17Brain,
    vector_memory: VectorMemory,
    synapse_graph: SynapseGraph,
    working_memory: WorkingMemory,
) -> None:
    """Reason about the environment over time, then remember and learn.

    Compares the current camera frame to the rolling history (persisted in
    working memory), derives transitions/conclusions, stores the most useful
    conclusion in memory, and reinforces concept→concept associations in the
    SynapseGraph. This is the "think → conclude → learn" loop for vision.
    """

    observation = extract_observation(event)
    history = working_memory.get_env_history()
    environment = analyze_environment(observation, history)
    result["environment"] = environment

    # Persist this frame so the next observation can reason about the trend.
    working_memory.push_env_observation(observation)

    conclusions = environment.get("conclusions")
    conclusion_text = ""
    if isinstance(conclusions, list) and conclusions:
        conclusion_text = "; ".join(str(c) for c in conclusions[:2])

    if conclusion_text:
        confidence = float(environment.get("confidence") or 0.4)
        env_event = Event(
            type="environment_observation",
            payload={
                "note": conclusion_text,
                "scene_mode": environment.get("state", {}).get("scene_mode"),
                "presence": environment.get("presence"),
            },
            source="environment",
        )
        brain.memory.remember(env_event, hint=conclusion_text, action="environment_reasoning")
        vector_memory.remember(
            env_event,
            {"score": confidence, "reason": conclusion_text, "store_memory": True, "reinforce": "environment"},
        )

    for assoc in environment.get("associations", []):
        if not isinstance(assoc, dict):
            continue
        left = str(assoc.get("from") or "")
        right = str(assoc.get("to") or "")
        if not left or not right:
            continue
        synapse_graph.upsert_synapse(
            source_type="concept",
            source_id=left,
            target_type="concept",
            target_id=right,
            relation_type=str(assoc.get("relation") or "related_to"),
            weight=float(assoc.get("weight") or 0.5),
            metadata={"origin": "environment_observation", "presence": environment.get("presence")},
        )


def _handle_internal_dream(
    event: Event,
    brain: Mark17Brain,
    vector_memory: VectorMemory,
    synapse_graph: SynapseGraph,
) -> dict[str, Any]:
    recent_patterns = _recent_consolidated_patterns(brain)
    top_synapses = synapse_graph.get_top_synapses(limit=8)
    pattern_text = " ".join(
        str(p.get("summary") or p.get("label") or "")
        for p in recent_patterns
        if isinstance(p, dict)
    )
    concepts = codec_extract_concepts(pattern_text)
    try:
        limit = int(event.payload.get("limit") or 5)
    except (TypeError, ValueError):
        limit = 5

    dream = generate_synergies(recent_patterns, top_synapses, concepts, limit=limit)

    stored = 0
    for synergy in dream.get("synergies", []):
        if not isinstance(synergy, dict):
            continue
        title = str(synergy.get("title") or "")
        summary = str(synergy.get("summary") or "")
        confidence = float(synergy.get("confidence") or 0.4)
        note = f"Dream synergy: {title}. {summary}".strip()
        dream_event = Event(
            type="internal_dream",
            payload={
                "synergy_title": title,
                "summary": summary,
                "concepts": synergy.get("concepts", []),
                "confidence": confidence,
            },
            source="dreamer",
        )
        brain.memory.remember(dream_event, hint=note, action="dream_synergy")
        vector_memory.remember(
            dream_event,
            {"score": confidence, "reason": note, "store_memory": True, "reinforce": title},
        )
        ids = [str(c) for c in synergy.get("concepts", []) if c]
        for left, right in zip(ids, ids[1:]):
            synapse_graph.upsert_synapse(
                source_type="concept",
                source_id=left,
                target_type="concept",
                target_id=right,
                relation_type="synergy_with",
                weight=confidence,
                metadata={"origin": "internal_dream", "title": title},
            )
        stored += 1

    brain.plasticity.save()

    top_title = ""
    synergies = dream.get("synergies")
    if isinstance(synergies, list) and synergies and isinstance(synergies[0], dict):
        top_title = str(synergies[0].get("title") or "")
    answer_text = (
        f"Во внутреннем сне я собрал {stored} синергий из уже знакомых связей. "
        + (f"Сильнее всего проявилась: {top_title}. " if top_title else "")
        + "Это гипотезы — их стоит проверить маленьким реальным действием."
    )

    return {
        "ok": True,
        "event_type": event.type,
        "route": "internal_dream",
        "memory": {"dream_synergies_stored": stored},
        "plasticity": {"confidence": 0.6, "action": "dream", "learned": True},
        "llm": {"status": "skipped", "text": "LLM отключён для внутреннего сна.", "latency_ms": 0.0},
        "confidence": 0.6,
        "next_adaptation": "Связать новые синергии с реальными задачами и проверить на практике.",
        "dream": dream,
        "answer": {"text": answer_text, "source": "dreamer", "confidence": 0.6},
    }


def _web_enabled(args: argparse.Namespace) -> bool:
    return bool(getattr(args, "web_enabled", False) or os.environ.get("MAX17_WEB_ENABLED") == "true")


def _web_query_from_event(event: Event) -> str:
    for key in ("query", "text", "message", "content"):
        value = event.payload.get(key)
        if isinstance(value, str) and value.strip():
            return " ".join(value.split())
    return event.signature()[:240]


def _web_research_limit(event: Event) -> int:
    try:
        return max(1, min(5, int(event.payload.get("limit") or 3)))
    except (TypeError, ValueError):
        return 3


def _web_research_urls(event: Event) -> list[str]:
    urls = event.payload.get("urls")
    if isinstance(urls, list):
        return [str(url).strip() for url in urls if str(url).strip()]
    url = event.payload.get("url")
    if isinstance(url, str) and url.strip():
        return [url.strip()]
    return []


def _remember_web_facts(
    *,
    event: Event,
    research: dict[str, Any],
    brain: Mark17Brain,
    vector_memory: VectorMemory,
    synapse_graph: SynapseGraph,
) -> dict[str, Any]:
    query = str(research.get("query") or _web_query_from_event(event))
    query_id = _stable_id("web_query", query)
    facts = research.get("facts")
    if not isinstance(facts, list):
        facts = []

    stored_memory_ids: list[int] = []
    touched: list[int] = []
    for fact in facts[:12]:
        if not isinstance(fact, dict):
            continue
        claim = str(fact.get("claim") or "").strip()
        if not claim:
            continue
        fact_id = str(fact.get("fact_id") or _stable_id("web_fact", claim))
        source_id = str(fact.get("id") or fact.get("source_id") or "source")
        source_title = str(fact.get("title") or fact.get("domain") or fact.get("url") or "source")
        confidence = float(fact.get("confidence") or 0.55)
        topic = str(fact.get("topic") or "web")

        web_event = Event(
            type="web_fact",
            payload={
                "query": query,
                "claim": claim,
                "source_id": source_id,
                "source_title": source_title,
                "url": fact.get("url"),
                "topic": topic,
                "confidence": confidence,
            },
            source="web_sense",
        )
        memory_id = brain.memory.remember(
            web_event,
            hint=claim,
            action="source_backed_fact",
        )
        stored_memory_ids.append(memory_id)
        vector_memory.remember(
            web_event,
            {
                "score": confidence,
                "reason": claim,
                "store_memory": True,
                "reinforce": topic,
            },
        )
        touched.append(
            synapse_graph.upsert_synapse(
                source_type="web_query",
                source_id=query_id,
                target_type="web_fact",
                target_id=fact_id,
                relation_type="related_to",
                weight=confidence,
                metadata={
                    "summary": claim[:180],
                    "origin": "web_sense",
                    "query": query,
                },
            )
        )
        touched.append(
            synapse_graph.upsert_synapse(
                source_type="web_source",
                source_id=source_id,
                target_type="web_fact",
                target_id=fact_id,
                relation_type="grounds",
                weight=max(0.45, confidence),
                metadata={
                    "summary": f"{source_title}: {claim}"[:180],
                    "origin": "web_sense",
                    "url": fact.get("url"),
                },
            )
        )
        concepts = codec_extract_concepts(f"{query} {claim}")
        activated = concepts.get("matches") if isinstance(concepts, dict) else []
        if isinstance(activated, list):
            for concept in activated[:3]:
                if not isinstance(concept, dict):
                    continue
                concept_id = str(concept.get("id") or concept.get("label") or "").strip()
                if not concept_id:
                    continue
                touched.append(
                    synapse_graph.upsert_synapse(
                        source_type="web_fact",
                        source_id=fact_id,
                        target_type="concept",
                        target_id=concept_id,
                        relation_type="grounds",
                        weight=confidence,
                        metadata={
                            "summary": claim[:180],
                            "origin": "web_sense",
                        },
                    )
                )

    return {
        "stored_facts": len(stored_memory_ids),
        "stored_memory_ids": stored_memory_ids[:8],
        "synapses": {
            "updated": len(touched),
            "top": synapse_graph._fetch_synapses(touched, limit=3),
        },
    }


def _handle_web_research(
    event: Event,
    args: argparse.Namespace,
    brain: Mark17Brain,
    vector_memory: VectorMemory,
    synapse_graph: SynapseGraph,
    source_memory: SourceMemory,
) -> dict[str, Any]:
    query = _web_query_from_event(event)
    research = web_research(
        query=query,
        source_memory=source_memory,
        urls=_web_research_urls(event),
        allow_network=_web_enabled(args),
        limit=_web_research_limit(event),
    )
    stored = _remember_web_facts(
        event=event,
        research=research,
        brain=brain,
        vector_memory=vector_memory,
        synapse_graph=synapse_graph,
    )
    facts = research.get("facts") if isinstance(research.get("facts"), list) else []
    confidence = 0.0
    fact_scores = [
        float(fact.get("confidence") or 0.0)
        for fact in facts
        if isinstance(fact, dict) and isinstance(fact.get("confidence"), (int, float))
    ]
    if fact_scores:
        confidence = sum(fact_scores) / len(fact_scores)
    evaluation = {
        "score": round(confidence, 4),
        "reason": f"web research stored {stored['stored_facts']} source-backed facts",
        "store_memory": bool(stored["stored_facts"]),
        "reinforce": "source-backed knowledge",
    }
    result: dict[str, Any] = {
        "ok": True,
        "event_type": event.type,
        "route": "web_research",
        "memory": {
            "recalled": [],
            "semantic": [],
            "web_fact_stored_ids": stored["stored_memory_ids"],
            "source_memory_counts": source_memory.counts(),
        },
        "plasticity": {
            "confidence": confidence,
            "action": "source_ingest",
            "learned": bool(stored["stored_facts"]),
        },
        "llm": {
            "status": "skipped",
            "text": "LLM отключён для web_research.",
            "latency_ms": 0.0,
        },
        "confidence": confidence,
        "next_adaptation": "Связать новые source-backed факты с задачами, recall и планом только после проверки релевантности.",
        "self_evaluation": evaluation,
        "web": {
            **research,
            "stored_facts": stored["stored_facts"],
        },
        "synapses": stored["synapses"],
    }
    _merge_concept_payload(result, compression=compress_to_concept(query))
    _apply_compression_synapses(synapse_graph, event, result)
    answer = compose_answer(event, result, evaluation)
    if answer:
        result["answer"] = answer
    brain.plasticity.save()
    return result


def _run_curiosity_pass(
    args: argparse.Namespace,
    stores: Mark17Stores,
    *,
    limit: int = 3,
) -> dict[str, Any]:
    """Phase 2 flywheel: take the most-wanted open gaps and try to learn them
    from the web on our own, distilling facts into memory + the synapse graph and
    marking them learned. Network is gated by MAX17_AUTO_WEB; without it this is a
    no-op and the gaps stay queued."""
    ledger = stores.curiosity
    allow_network = _web_enabled(args) and os.environ.get("MAX17_AUTO_WEB") == "true"
    if not allow_network:
        return {
            "autonomous_research": {
                "network": False,
                "processed": 0,
                "facts_learned": 0,
                "items": [],
                "note": "MAX17_AUTO_WEB выключен — пробелы стоят в очереди.",
                "ledger": ledger.stats(),
            }
        }

    # Phase 3: ask our own questions. Mine the graph's most salient nodes for new
    # topics and queue them as self-sourced gaps, so the flywheel keeps learning
    # from real sources even with no user-driven gaps left. Bounded + deduped
    # against everything the ledger already knows, and best-effort (never blocks).
    self_seeds: list[str] = []
    try:
        self_seeds = propose_seeds(stores.synapse_graph, limit=limit, avoid=ledger.known_keys())
        for seed in self_seeds:
            ledger.record_gap(seed, source="self")
    except Exception:  # noqa: BLE001 - self-seeding must never break the pass
        self_seeds = []

    gaps = ledger.top_open(limit=limit)
    items: list[dict[str, Any]] = []
    total_facts = 0
    synapse_summary: dict[str, Any] | None = None
    for gap in gaps:
        query = str(gap.get("query") or gap.get("topic_key") or "").strip()
        if not query:
            continue
        research = web_research(
            query=query,
            source_memory=stores.source_memory,
            allow_network=True,
            limit=3,
        )
        relevant = _relevant_fact_count(query, research)
        facts = 0
        if relevant or research.get("status") == "fetched":
            stored = _remember_web_facts(
                event=Event(type="web_fact", payload={"query": query}, source="curiosity"),
                research=research,
                brain=stores.brain,
                vector_memory=stores.vector_memory,
                synapse_graph=stores.synapse_graph,
            )
            facts = stored["stored_facts"]
            total_facts += facts
            synapse_summary = _merge_synapse_summaries(synapse_summary, stored["synapses"])
        status = "learned" if facts else ("checked" if research.get("status") == "fetched" else "no_source")
        ledger.mark(gap["topic_key"], status=status, facts_learned=facts)
        items.append(
            {
                "topic": query,
                "hits": gap.get("hits", 1),
                "status": status,
                "facts": facts,
                "web_status": research.get("status"),
            }
        )

    summary: dict[str, Any] = {
        "autonomous_research": {
            "network": True,
            "processed": len(gaps),
            "facts_learned": total_facts,
            "self_seeded": self_seeds,
            "items": items,
            "ledger": ledger.stats(),
        }
    }
    if synapse_summary is not None:
        summary["synapses"] = synapse_summary
    return summary


def _dispatch_result(event: Event, intent: dict[str, Any]) -> dict[str, Any]:
    """Orchestrator short-circuit: a code/desktop task is handed to its agent in
    the HUD instead of running the chat pipeline. Returns a small routing reply;
    the client reads `dispatch` to open the right mode with the instruction."""
    route = str(intent.get("route"))
    instruction = _event_text(event)
    confidence = float(intent.get("confidence") or 0.6)
    text = (
        "Похоже на задачу для кода — открываю код-режим и передаю её агенту Qwen3."
        if route == "code"
        else "Похоже на задачу для рабочего стола — открываю desktop-режим и передаю её агенту."
    )
    return {
        "ok": True,
        "event_type": "user_message",
        "route": "orchestrator",
        "memory": {},
        "plasticity": {"confidence": confidence, "action": f"route_{route}", "learned": False},
        "llm": {"status": "skipped", "text": "Маршрутизация оркестратором.", "latency_ms": 0.0},
        "next_adaptation": text,
        "self_evaluation": {
            "score": confidence,
            "reason": f"orchestrator routed to {route}",
            "store_memory": False,
            "reinforce": "orchestrator",
        },
        "answer": {"text": text, "source": "orchestrator", "confidence": confidence},
        "route_intent": intent,
        "dispatch": {"route": route, "instruction": instruction},
    }


def _handle_autonomous_research(
    event: Event,
    args: argparse.Namespace,
    stores: Mark17Stores,
) -> dict[str, Any]:
    try:
        limit = int(event.payload.get("limit", 3))
    except (TypeError, ValueError):
        limit = 3
    summary = _run_curiosity_pass(args, stores, limit=max(1, min(8, limit)))
    info = summary.get("autonomous_research", {})
    learned = int(info.get("facts_learned", 0))
    processed = int(info.get("processed", 0))
    seeded = info.get("self_seeded") or []
    seed_note = f" Сам придумал темы: {', '.join(seeded[:3])}." if seeded else ""
    text = (
        f"Самообучение: закрыл {learned} факт(ов) по {processed} пробел(ам).{seed_note} Спроси — отвечу из памяти."
        if learned
        else f"Самообучение: новых фактов не выучил (web-доступ выключен или очередь пуста).{seed_note}"
    )
    result: dict[str, Any] = {
        "ok": True,
        "event_type": event.type,
        "route": "autonomous_research",
        "memory": {},
        "plasticity": {
            "confidence": 0.6 if learned else 0.3,
            "action": "self_learned" if learned else "idle",
            "learned": bool(learned),
        },
        "llm": {"status": "skipped", "text": "Автономное само-обучение.", "latency_ms": 0.0},
        "next_adaptation": text,
        "self_evaluation": {
            "score": 0.6 if learned else 0.2,
            "reason": f"autonomous research learned {learned} facts over {processed} gaps",
            "store_memory": False,
            "reinforce": "self learning",
        },
        "answer": {"text": text, "source": "composer", "confidence": 0.6 if learned else 0.3},
        "autonomous_research": info,
    }
    if isinstance(summary.get("synapses"), dict):
        result["synapses"] = summary["synapses"]
    return result


def _apply_knowledge_gap(
    result: dict[str, Any],
    event: Event,
    args: argparse.Namespace,
    brain: Mark17Brain,
    vector_memory: VectorMemory,
    synapse_graph: SynapseGraph,
    source_memory: SourceMemory,
    curiosity: CuriosityLedger,
) -> None:
    gap = detect_knowledge_gap(event_text=_event_text(event), response=result)
    result["knowledge_gap"] = gap
    if not gap.get("needed"):
        return

    # Retrieval-first: on a knowledge gap we search by meaning BEFORE the answer
    # is composed (compose_answer runs after this in _handle_event). Offline this
    # returns deterministic curated/seed sources — no network — so even with the
    # network disabled the composer can ground its reply in source-backed facts.
    # Live fetching only happens when web is explicitly enabled.
    query = _event_text(event)
    research = web_research(
        query=query,
        source_memory=source_memory,
        allow_network=_web_enabled(args),
        limit=3,
    )
    relevant = _relevant_fact_count(query, research)
    result["web"] = {
        **research,
        "stored_facts": 0,
        "relevant_facts": relevant,
        "auto_triggered": True,
    }
    # Only ingest into long-term memory + the graph when the facts actually share
    # meaning with the question (or were fetched live). This keeps an offline
    # curated fallback from bloating the graph on every vague low-confidence turn,
    # while still learning genuinely relevant source-backed knowledge.
    if relevant or research.get("status") == "fetched":
        stored = _remember_web_facts(
            event=event,
            research=research,
            brain=brain,
            vector_memory=vector_memory,
            synapse_graph=synapse_graph,
        )
        result["web"]["stored_facts"] = stored["stored_facts"]
        result["synapses"] = _merge_synapse_summaries(
            result.get("synapses") if isinstance(result.get("synapses"), dict) else None,
            stored["synapses"],
        )

    # Phase 2: if we could not satisfy this gap live (no source-backed facts
    # stored — offline, or nothing relevant found), queue the topic so an idle /
    # sleep curiosity pass can research and learn it on its own later.
    if result["web"].get("stored_facts", 0) == 0:
        if curiosity.record_gap(query, source="user"):
            result["knowledge_gap"]["queued_for_self_learning"] = True


def _relevant_fact_count(query: str, research: dict[str, Any]) -> int:
    """Number of retrieved facts that share meaning (token overlap ≥ 4 chars)
    with the query. Lets the gap path keep curated fallbacks from being treated
    as on-topic when they are not actually about the question."""
    query_tokens = {token for token in _web_normalize(query).split() if len(token) >= 4}
    facts = research.get("facts") if isinstance(research.get("facts"), list) else []
    count = 0
    for fact in facts:
        if not isinstance(fact, dict):
            continue
        # Curated facts whose topic triggers matched the query are semantically
        # on-topic by construction (the triggers are bilingual), so count them
        # even when the claim text shares no surface tokens with the question
        # (e.g. an English MDN claim answering a Russian question).
        if fact.get("mode") == "curated_match":
            count += 1
            continue
        if not query_tokens:
            continue
        claim_tokens = set(_web_normalize(fact.get("claim")).split())
        if query_tokens & claim_tokens:
            count += 1
    return count


def _gonka_facts_block(result: dict[str, Any]) -> str:
    """Source-backed facts gathered retrieval-first, formatted for the prompt."""
    web = result.get("web") if isinstance(result.get("web"), dict) else {}
    facts = web.get("facts") if isinstance(web.get("facts"), list) else []
    lines: list[str] = []
    seen: set[str] = set()
    for fact in facts:
        if not isinstance(fact, dict):
            continue
        claim = str(fact.get("claim") or "").strip()
        if not claim or claim in seen:
            continue
        seen.add(claim)
        title = str(fact.get("title") or fact.get("url") or "").strip()
        lines.append(f"- {claim}" + (f" [Источник: {title}]" if title else ""))
        if len(lines) >= 6:
            break
    return "\n".join(lines)


_VISION_LIGHT_RU = {"low": "низкое", "medium": "среднее", "high": "яркое"}
_VISION_MOTION_RU = {
    "still": "неподвижно",
    "subtle": "слабое движение",
    "moving": "заметное движение",
}


def _gonka_vision_block(working_memory: WorkingMemory) -> str:
    """Latest live camera observation (if the camera is on), as a readable line
    so the model can answer 'что ты видишь?' from real sensor data."""
    try:
        history = working_memory.get_env_history(limit=1)
    except Exception:  # noqa: BLE001 - vision context is best-effort.
        return ""
    if not history:
        return ""
    obs = history[-1]
    if not isinstance(obs, dict) or obs.get("active") is False:
        return ""
    # Only treat the camera as "seeing now" if the last frame is fresh. The HUD
    # streams a frame every few seconds while active and stops when off, so a
    # stale frame means the camera was turned off — don't claim live vision then.
    observed_at = str(obs.get("observed_at") or "")
    if observed_at:
        try:
            from datetime import datetime, timezone

            seen = datetime.fromisoformat(observed_at)
            if seen.tzinfo is None:
                seen = seen.replace(tzinfo=timezone.utc)
            if (datetime.now(timezone.utc) - seen).total_seconds() > 120:
                return ""
        except Exception:  # noqa: BLE001 - unparseable timestamp -> best-effort, keep it.
            pass
    light = _VISION_LIGHT_RU.get(str(obs.get("light_level")), str(obs.get("light_level") or "")).strip()
    motion = _VISION_MOTION_RU.get(str(obs.get("motion_level")), str(obs.get("motion_level") or "")).strip()
    bits: list[str] = []
    if light:
        bits.append(f"освещение {light}")
    if motion:
        bits.append(f"движение: {motion}")
    # Real face detection (TinyFaceDetector). int => detector ran; None => off.
    faces = obs.get("faces")
    has_detector = isinstance(faces, int)
    if has_detector:
        if faces > 0:
            bits.append(f"в кадре есть человек, лиц обнаружено: {faces}")
        else:
            bits.append("лиц в кадре не обнаружено")
    if not bits:
        return ""
    if has_detector:
        preamble = (
            "Камера включена. Различаю свет, движение и наличие лиц (детектор лиц). "
            "Личность не узнаю, предметы/мебель/место (стол, кровать) не распознаю: "
        )
    else:
        preamble = (
            "Камера включена. Различаю только свет и движение (лица, людей, предметы и "
            "место НЕ распознаю): "
        )
    return preamble + ", ".join(bits) + "."


def _gonka_history_block(working_memory: WorkingMemory) -> str:
    """Recent dialog turns, for conversational continuity in the voice answer."""
    try:
        ctx = working_memory.get_context()
    except Exception:  # noqa: BLE001
        return ""
    turns = ctx.get("recent_turns") if isinstance(ctx.get("recent_turns"), list) else []
    lines: list[str] = []
    for turn in turns[-6:]:
        if isinstance(turn, dict) and turn.get("text"):
            who = "Ты" if turn.get("role") == "model" else "Пользователь"
            lines.append(f"{who}: {str(turn['text'])[:200]}")
    return "\n".join(lines)


def _synthesize_natural_answer(result: dict[str, Any], event: Event, working_memory: WorkingMemory) -> None:
    """Optional voice layer: turn the retrieved source-backed facts + live camera
    vision + the deterministic draft into a natural reply via the Gonka
    (OpenAI-compatible Qwen3) bridge. No-op unless GONKA_API_KEY is set; on any
    failure the deterministic compose_answer text is kept as the grounded
    fallback."""
    if not gonka_is_enabled("chat"):
        return
    question = _event_text(event)
    if not question:
        return

    facts_block = _gonka_facts_block(result)
    vision_block = _gonka_vision_block(working_memory)
    draft = ""
    existing = result.get("answer")
    if isinstance(existing, dict):
        draft = str(existing.get("text") or "")

    system = (
        "Ты — MAX17: когнитивное AGI-ядро проекта Game, которое стоит НАД языковой моделью. "
        "Твой разум — это память, синапс-граф (~100 000 связей), концепты, рабочая память и "
        "планирование; языковая модель (её можно менять) — лишь твой речевой орган: она формулирует, "
        "но мыслишь и помнишь ТЫ. Говори от первого лица как Max, опираясь на свою память/граф/факты "
        "ниже — а не как обычный чат-ассистент (никаких «я всего лишь ИИ-помощник»). "
        "Отвечай на языке пользователя живо, развёрнуто и по делу (без воды); "
        "учитывай недавний диалог для связности. "
        "Опирайся ТОЛЬКО на приведённые ниже факты из источников, данные с камеры и черновик; "
        "если данных не хватает — честно скажи и предложи уточнить, ничего не выдумывай. "
        "Камера даёт ограниченные сигналы: уровень света, движение и наличие лиц (детектор лиц). "
        "Ты можешь сказать, есть ли в кадре человек и сколько лиц, и описать свет/движение — строго по "
        "блоку «Зрение (камера)». Но ты НЕ узнаёшь личность и НЕ распознаёшь предметы, мебель и место "
        "(стол, кровать, комнату) — никогда такое не утверждай и не угадывай. Если блока «Зрение» нет — "
        "камера выключена, так и скажи. "
        "Если использовал источники — коротко упомяни их. "
        "Не утверждай, что управляешь пользователем."
    )
    parts: list[str] = []
    history_block = _gonka_history_block(working_memory)
    if history_block:
        parts.append("Недавний диалог (для контекста):\n" + history_block)
    parts.append(f"Вопрос пользователя: {question}")
    if vision_block:
        parts.append("Зрение (камера, прямо сейчас):\n" + vision_block)
    if facts_block:
        parts.append("Найденные факты (source-backed, retrieval-first):\n" + facts_block)
    if draft:
        parts.append("Черновик детерминированного ядра (можно улучшить/переформулировать):\n" + draft)
    parts.append("Сформулируй финальный, естественный ответ пользователю.")
    user = "\n\n".join(parts)

    # Answer length follows the selected model: small for slow local CPU (snappy),
    # large for fast cloud models (richer). Driven by llm_config per active preset.
    from mark17.llm_config import voice_max_tokens

    voice_max = voice_max_tokens("chat")
    res = gonka_chat(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        role="chat",
        max_tokens=voice_max,
        temperature=0.35,
    )
    voice: dict[str, Any] = {
        "provider": "gonka",
        "status": res.status,
        "model": res.model,
        "role": res.role,
        "latency_ms": res.latency_ms,
    }
    if res.error:
        voice["error"] = res.error
    result["llm_voice"] = voice

    if not res.ok or not res.text:
        return  # keep the deterministic, grounded answer
    deterministic = existing if isinstance(existing, dict) else {}
    result["answer"] = {
        "text": res.text,
        "source": "gonka",
        "model": res.model,
        "confidence": deterministic.get("confidence", 0.7),
        "grounded": bool(facts_block or vision_block),
        "draft": deterministic.get("text", ""),
    }


def normalize(result: dict[str, Any]) -> dict[str, Any]:
    normalized = {
        "ok": bool(result.get("ok", False)),
        "route": result.get("route", "error"),
        "memory": result.get("memory") or {},
        "plasticity": result.get("plasticity") or {},
        "llm": result.get("llm") or {},
        "confidence": max(0.0, min(1.0, _confidence(result))),
        "next_adaptation": _next_adaptation(result),
        "self_evaluation": result.get("self_evaluation")
        or {
            "score": 0.0,
            "reason": "self-evaluation unavailable",
            "store_memory": False,
            "reinforce": "",
        },
        "raw": {
            "event_type": result.get("event_type"),
            "decision": result.get("decision") or {},
            "message": result.get("message"),
        },
    }
    answer = result.get("answer")
    if isinstance(answer, dict):
        normalized["answer"] = answer
    synapses = result.get("synapses")
    if isinstance(synapses, dict):
        normalized["synapses"] = synapses
    consolidation = result.get("consolidation")
    if isinstance(consolidation, dict):
        normalized["consolidation"] = consolidation
    working_memory = result.get("working_memory")
    if isinstance(working_memory, dict):
        normalized["working_memory"] = working_memory
    plan = result.get("plan")
    if isinstance(plan, dict):
        normalized["plan"] = plan
    outcome = result.get("outcome")
    if isinstance(outcome, dict):
        normalized["outcome"] = outcome
    growth = result.get("growth")
    if isinstance(growth, dict):
        normalized["growth"] = growth
    concepts = result.get("concepts")
    if isinstance(concepts, dict):
        normalized["concepts"] = concepts
    graph_stats = result.get("graph_stats")
    if isinstance(graph_stats, dict):
        normalized["graph_stats"] = graph_stats
    neural_graph = result.get("neural_graph")
    if isinstance(neural_graph, dict):
        normalized["neural_graph"] = neural_graph
    active_graph = result.get("active_graph")
    if isinstance(active_graph, dict):
        normalized["active_graph"] = active_graph
    intuition = result.get("intuition")
    if isinstance(intuition, dict):
        normalized["intuition"] = intuition
    causal_decoder = result.get("causal_decoder")
    if isinstance(causal_decoder, dict):
        normalized["causal_decoder"] = causal_decoder
    dream = result.get("dream")
    if isinstance(dream, dict):
        normalized["dream"] = dream
    environment = result.get("environment")
    if isinstance(environment, dict):
        normalized["environment"] = environment
    web = result.get("web")
    if isinstance(web, dict):
        normalized["web"] = web
    knowledge_gap = result.get("knowledge_gap")
    if isinstance(knowledge_gap, dict):
        normalized["knowledge_gap"] = knowledge_gap
    llm_voice = result.get("llm_voice")
    if isinstance(llm_voice, dict):
        normalized["llm_voice"] = llm_voice
    autonomous_research = result.get("autonomous_research")
    if isinstance(autonomous_research, dict):
        normalized["autonomous_research"] = autonomous_research
    route_intent = result.get("route_intent")
    if isinstance(route_intent, dict):
        normalized["route_intent"] = route_intent
    dispatch = result.get("dispatch")
    if isinstance(dispatch, dict):
        normalized["dispatch"] = dispatch
    return normalized


def _merge_synapse_summaries(
    base_synapses: dict[str, Any] | None,
    growth: dict[str, Any],
) -> dict[str, Any]:
    base = base_synapses if isinstance(base_synapses, dict) else {"updated": 0, "top": []}
    base_top = base.get("top") if isinstance(base.get("top"), list) else []
    growth_top = growth.get("top") if isinstance(growth.get("top"), list) else []
    merged_top: list[dict[str, Any]] = []
    seen: set[Any] = set()
    for item in [*growth_top, *base_top]:
        if not isinstance(item, dict):
            continue
        key = item.get("id") or (
            item.get("source_type"),
            item.get("source_id"),
            item.get("target_type"),
            item.get("target_id"),
            item.get("relation_type"),
        )
        if key in seen:
            continue
        seen.add(key)
        merged_top.append(item)
        if len(merged_top) >= 3:
            break

    return {
        **base,
        "updated": int(base.get("updated") or 0) + int(growth.get("updated") or 0),
        "top": merged_top,
    }


def _apply_growth(
    synapse_graph: SynapseGraph,
    event: Event,
    result: dict[str, Any],
    self_evaluation: dict[str, Any] | None,
) -> None:
    growth = grow_synapses(
        synapse_graph,
        event=event,
        response=result,
        working_memory=result.get("working_memory") if isinstance(result.get("working_memory"), dict) else None,
        self_evaluation=self_evaluation,
    )
    result["growth"] = growth
    result["synapses"] = _merge_synapse_summaries(
        result.get("synapses") if isinstance(result.get("synapses"), dict) else None,
        growth,
    )


def _apply_compression_synapses(
    synapse_graph: SynapseGraph,
    event: Event,
    result: dict[str, Any],
    *,
    memory_id: int | None = None,
) -> None:
    concepts = result.get("concepts")
    if not isinstance(concepts, dict):
        return
    primary = concepts.get("primary")
    if not isinstance(primary, dict):
        return
    concept_id = str(primary.get("concept") or "").strip()
    if not concept_id:
        return

    event_id = _stable_id("event", event.type, event.signature())
    confidence = primary.get("confidence")
    weight = float(confidence) if isinstance(confidence, (int, float)) else 0.45
    if concept_id == "context" and weight < 0.3 and event.type != "compress_memory":
        return
    touched: list[int] = []

    def touch(source_type: str, source_id: str, target_type: str, target_id: str, weight_scale: float, summary: str) -> None:
        if not source_id or not target_id:
            return
        touched.append(
            synapse_graph.upsert(
                source_type=source_type,
                source_id=source_id,
                target_type=target_type,
                target_id=target_id,
                relation_type="compressed_as",
                weight=max(0.05, min(1.0, weight * weight_scale)),
                metadata={
                    "summary": summary[:180],
                    "source": "concept_compression_v0",
                    "event_type": event.type,
                },
            )
        )

    label = str(primary.get("label") or concept_id)
    touch("event", event_id, "compressed_concept", concept_id, 1.0, f"{event.type} compressed as {label}")
    if memory_id is not None:
        touch("memory", str(memory_id), "compressed_concept", concept_id, 0.95, f"memory compressed as {label}")

    memory = result.get("memory")
    if isinstance(memory, dict):
        for key, source_type in (("recalled", "memory"), ("semantic", "semantic_memory")):
            rows = memory.get(key)
            if not isinstance(rows, list):
                continue
            for row in rows[:3]:
                if isinstance(row, dict) and row.get("id") is not None:
                    touch(source_type, str(row["id"]), "compressed_concept", concept_id, 0.72, f"{source_type} compressed as {label}")

    consolidation = result.get("consolidation")
    if isinstance(consolidation, dict):
        patterns = consolidation.get("patterns")
        if isinstance(patterns, list):
            for pattern in patterns[:5]:
                if not isinstance(pattern, dict):
                    continue
                pattern_id = str(pattern.get("pattern_id") or "")
                pattern_concept = str(pattern.get("concept") or concept_id)
                pattern_label = str(pattern.get("label") or label)
                touch("pattern", pattern_id, "compressed_concept", pattern_concept, 0.9, f"pattern compressed as {pattern_label}")

    related = concepts.get("related")
    if isinstance(related, list):
        for item in related[:3]:
            if isinstance(item, dict) and item.get("concept"):
                touch(
                    "compressed_concept",
                    concept_id,
                    "compressed_concept",
                    str(item["concept"]),
                    0.62,
                    f"{label} relates to {item.get('label') or item['concept']}",
                )

    if touched:
        summary = {
            "updated": len(touched),
            "top": synapse_graph._fetch_synapses(touched, limit=3),
        }
        result["synapses"] = _merge_synapse_summaries(
            result.get("synapses") if isinstance(result.get("synapses"), dict) else None,
            summary,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Max17 JSON bridge over mark17 core")
    parser.add_argument("--state-dir", type=Path, default=Path(__file__).resolve().parent / "state")
    parser.add_argument("--ephemeral", action="store_true", help="use a temporary state dir for one-shot smoke tests")
    parser.add_argument("--warmup", type=Path, help="JSONL events to process before stdin event")
    parser.add_argument("--plasticity-threshold", type=float, default=0.7)
    parser.add_argument("--ollama-model", default="qwen2.5:0.5b")
    parser.add_argument("--ollama-host", default="http://127.0.0.1:11434")
    parser.add_argument("--no-llm", action="store_true")
    parser.add_argument("--web-enabled", action="store_true", help="allow explicit web_research events to fetch network sources")
    args = parser.parse_args()

    try:
        event = _as_event(_read_input())
        if args.ephemeral:
            with tempfile.TemporaryDirectory(prefix="max17-smoke-") as tmp:
                result = _handle_event(event, args, _build_stores(args, Path(tmp)))
        else:
            result = _handle_event(event, args, _build_stores(args, args.state_dir))
        sys.stdout.write(json.dumps(normalize(result), ensure_ascii=False) + "\n")
        return 0
    except Exception as exc:
        error = {
            "ok": False,
            "route": "error",
            "memory": {},
            "plasticity": {},
            "llm": {},
            "confidence": 0.0,
            "next_adaptation": "Bridge error. Inspect error payload.",
            "error": str(exc),
            "trace": traceback.format_exc(),
        }
        sys.stdout.write(json.dumps(error, ensure_ascii=False) + "\n")
        return 1


@dataclass
class Mark17Stores:
    """Warm, reusable handles to every Max17 store.

    Built once per process. One-shot json_cli builds a fresh set per event;
    the persistent serve.py builds a single set and reuses it across events,
    which removes per-request Python/numpy import and SQLite re-open cost.
    """

    state_dir: Path
    brain: Mark17Brain
    vector_memory: VectorMemory
    synapse_graph: SynapseGraph
    working_memory: WorkingMemory
    concept_grounding: ConceptGrounding
    source_memory: SourceMemory
    curiosity: CuriosityLedger


def _build_stores(args: argparse.Namespace, state_dir: Path) -> Mark17Stores:
    return Mark17Stores(
        state_dir=state_dir,
        brain=Mark17Brain(
            state_dir,
            plasticity_threshold=args.plasticity_threshold,
            llm_enabled=not args.no_llm,
            llm_model=args.ollama_model,
            llm_host=args.ollama_host,
        ),
        vector_memory=VectorMemory(state_dir),
        synapse_graph=SynapseGraph(state_dir),
        working_memory=WorkingMemory(state_dir),
        concept_grounding=ConceptGrounding(state_dir),
        source_memory=SourceMemory(state_dir),
        curiosity=CuriosityLedger(state_dir),
    )


def _handle_event(event: Event, args: argparse.Namespace, stores: Mark17Stores) -> dict[str, Any]:
    state_dir = stores.state_dir
    brain = stores.brain
    vector_memory = stores.vector_memory
    synapse_graph = stores.synapse_graph
    working_memory = stores.working_memory
    concept_grounding = stores.concept_grounding
    source_memory = stores.source_memory
    curiosity = stores.curiosity
    if event.type == "graph_stats" and not args.warmup:
        return _handle_graph_stats(event, state_dir, synapse_graph)
    if event.type == "neural_seed" and not args.warmup:
        return _handle_neural_seed(event, state_dir, synapse_graph)
    if event.type == "neural_walk" and not args.warmup:
        return _handle_neural_walk(event, state_dir, synapse_graph)
    if args.warmup:
        _run_warmup(args.warmup, brain, vector_memory, synapse_graph, working_memory, concept_grounding, source_memory, args)
    if event.type == "working_memory_reset":
        return _handle_working_memory_reset(working_memory)
    if event.type == "graph_stats":
        return _handle_graph_stats(event, state_dir, synapse_graph)
    if event.type == "neural_seed":
        return _handle_neural_seed(event, state_dir, synapse_graph)
    if event.type == "neural_walk":
        return _handle_neural_walk(event, state_dir, synapse_graph)
    if event.type == "compress_memory":
        return _handle_compress_memory(event, brain, vector_memory, synapse_graph, working_memory)
    if event.type == "sleep_consolidation":
        result = _handle_sleep_consolidation(event, brain, vector_memory, synapse_graph)
        result["working_memory"] = working_memory.get_context()
        # Phase 2: sleep is also when Max17 researches its own open gaps.
        if os.environ.get("MAX17_AUTO_WEB") == "true":
            summary = _run_curiosity_pass(args, stores, limit=2)
            result["autonomous_research"] = summary.get("autonomous_research")
            if isinstance(summary.get("synapses"), dict):
                result["synapses"] = _merge_synapse_summaries(
                    result.get("synapses") if isinstance(result.get("synapses"), dict) else None,
                    summary["synapses"],
                )
        return result
    if event.type == "autonomous_research":
        return _handle_autonomous_research(event, args, stores)
    if event.type in OUTCOME_EVENT_TYPES:
        return _handle_outcome_event(event, brain, vector_memory, synapse_graph, working_memory)
    if event.type in {"internal_dream", "generate_synergies"}:
        return _handle_internal_dream(event, brain, vector_memory, synapse_graph)
    if event.type in {"web_research", "web_ingest"}:
        return _handle_web_research(event, args, brain, vector_memory, synapse_graph, source_memory)

    # Orchestrator: route a clear code/desktop task to its agent BEFORE paying for
    # the chat pipeline (memory + web + Gonka). Ambiguous stays "chat".
    intent: dict[str, Any] | None = None
    if event.type == "user_message":
        intent = classify_intent(_event_text(event))
        if intent.get("route") in {"code", "desktop"} and float(intent.get("confidence") or 0.0) >= 0.6:
            return _dispatch_result(event, intent)

    result = brain.handle(event)
    _merge_memory(
        result,
        recalled=_recalled_memories(event, brain),
        semantic=_semantic_memories(event, vector_memory),
        consolidated_patterns=_recent_consolidated_patterns(brain) if event.type == "user_message" else [],
    )
    _merge_concept_payload(result, grounding=concept_grounding.match_event(event))
    evaluation = evaluate_event(event, result)
    result["self_evaluation"] = evaluation.to_dict()
    result["next_adaptation"] = _next_adaptation(result)
    if event.type in {"user_message", "task_created", "task_completed", "deadline_failed", "terminal_error", "system_state", "environment_observation"}:
        result["working_memory"] = working_memory.update_from_event(event, result, result["self_evaluation"])
    _apply_event_compression(
        result,
        event,
        result.get("working_memory") if isinstance(result.get("working_memory"), dict) else None,
    )
    result["synapses"] = synapse_graph.update_from_event(event, result, result["self_evaluation"])
    result["plan"] = plan_next_actions(
        event,
        result,
        result.get("working_memory"),
        result["self_evaluation"],
    )
    if event.type == "user_message":
        _apply_hot_path(result, event)
        _apply_knowledge_gap(result, event, args, brain, vector_memory, synapse_graph, source_memory, curiosity)
        if intent is not None:
            result["route_intent"] = intent
    if event.type == "environment_observation":
        _apply_environment_reasoning(result, event, brain, vector_memory, synapse_graph, working_memory)
    answer = compose_answer(event, result, result["self_evaluation"])
    if answer:
        result["answer"] = answer
        if event.type in {"user_message", "task_created", "task_completed", "deadline_failed", "terminal_error", "system_state", "environment_observation"}:
            result["working_memory"] = working_memory.update_from_event(event, result, result["self_evaluation"])
    if event.type == "user_message":
        _synthesize_natural_answer(result, event, working_memory)
    _apply_compression_synapses(synapse_graph, event, result)
    _apply_growth(synapse_graph, event, result, result["self_evaluation"])
    if evaluation.store_memory:
        brain.memory.remember(
            Event(
                type="remember",
                payload={
                    "note": evaluation.reason,
                    "event_type": event.type,
                    "route": result.get("route"),
                    "reinforce": evaluation.reinforce,
                    "score": evaluation.score,
                },
                source="critic",
            ),
            hint=evaluation.reason,
            action="self_evaluation",
        )
        vector_memory.remember(event, result["self_evaluation"])
    brain.plasticity.save()
    return result


def _handle_outcome_event(
    event: Event,
    brain: Mark17Brain,
    vector_memory: VectorMemory,
    synapse_graph: SynapseGraph,
    working_memory: WorkingMemory,
) -> dict[str, Any]:
    working_context = working_memory.get_context()
    seed: dict[str, Any] = {
        "ok": True,
        "event_type": event.type,
        "route": "outcome",
        "memory": {},
        "plasticity": {
            "confidence": 0.5,
            "action": "observe_outcome",
            "learned": False,
        },
        "llm": {
            "status": "skipped",
            "text": "LLM отключён для outcome feedback.",
            "latency_ms": 0.0,
        },
        "working_memory": working_context,
    }
    plan = plan_next_actions(event, seed, working_context)
    outcome = evaluate_outcome(event, working_context, plan)
    evaluation = {
        "score": outcome["score"],
        "reason": outcome["reason"],
        "store_memory": True,
        "reinforce": outcome.get("reinforce") or outcome.get("next_adjustment") or "",
    }
    result: dict[str, Any] = {
        **seed,
        "confidence": outcome["score"],
        "plasticity": {
            "confidence": outcome["score"],
            "action": "reinforce" if outcome["status"] == "success" else "adjust",
            "learned": True,
        },
        "next_adaptation": outcome["next_adjustment"],
        "self_evaluation": evaluation,
        "plan": plan,
        "outcome": outcome,
    }
    result["synapses"] = update_outcome_synapses(
        synapse_graph,
        event=event,
        outcome=outcome,
        working_memory=working_context,
        plan=plan,
    )

    summary = f"{outcome['status']}: {outcome['reason']} Next: {outcome['next_adjustment']}"
    stored_id = brain.memory.remember(
        Event(
            type=event.type,
            payload={
                **event.payload,
                "outcome": outcome,
                "plan_action": (plan.get("actions") or [{}])[0] if isinstance(plan.get("actions"), list) else {},
            },
            source=event.source,
        ),
        hint=summary,
        action="outcome_feedback",
    )
    vector_memory.remember(
        Event(
            type=event.type,
            payload={
                **event.payload,
                "outcome": outcome,
            },
            source=event.source,
        ),
        evaluation,
    )
    result["memory"] = {
        "outcome_stored_id": stored_id,
        "outcome_summary": summary,
        "recalled": [],
        "semantic": [],
    }

    answer = compose_answer(event, result, evaluation)
    if answer:
        result["answer"] = answer
    _apply_growth(synapse_graph, event, result, evaluation)
    brain.plasticity.save()
    return result


def _handle_graph_stats(
    event: Event,
    state_dir: Path,
    synapse_graph: SynapseGraph,
) -> dict[str, Any]:
    try:
        target_synapses = int(event.payload.get("target_synapses") or TARGET_NEURAL_SYNAPSES)
    except (TypeError, ValueError):
        target_synapses = TARGET_NEURAL_SYNAPSES
    stats = GraphStats(synapse_graph, target_synapses=target_synapses).collect(limit=5)
    stats["stores"] = collect_store_counts(state_dir)
    stats["neural_graph"] = ClusteredNeuralGraph(synapse_graph).snapshot(limit=5)
    result: dict[str, Any] = {
        "ok": True,
        "event_type": event.type,
        "route": "graph_stats",
        "memory": {},
        "plasticity": {
            "confidence": 1.0,
            "action": "measure_graph",
            "learned": False,
        },
        "llm": {
            "status": "skipped",
            "text": "LLM отключён для graph_stats.",
            "latency_ms": 0.0,
        },
        "confidence": 1.0,
        "next_adaptation": "Рост к 100 000 граф-синапсов измерен. Следующий шаг — растить кластеры и межкластерные мосты.",
        "self_evaluation": {
            "score": 1.0,
            "reason": "graph stats collected",
            "store_memory": False,
            "reinforce": "measure synapse growth",
        },
        "graph_stats": stats,
    }
    answer = compose_answer(event, result, result["self_evaluation"])
    if answer:
        result["answer"] = answer
    return result


def _handle_neural_seed(
    event: Event,
    state_dir: Path,
    synapse_graph: SynapseGraph,
) -> dict[str, Any]:
    try:
        target_synapses = int(event.payload.get("target_synapses") or TARGET_NEURAL_SYNAPSES)
    except (TypeError, ValueError):
        target_synapses = TARGET_NEURAL_SYNAPSES
    max_new_raw = event.payload.get("max_new")
    try:
        max_new = int(max_new_raw) if max_new_raw is not None else None
    except (TypeError, ValueError):
        max_new = None

    neural_graph = ClusteredNeuralGraph(synapse_graph)
    seed = neural_graph.seed(target_synapses=target_synapses, max_new=max_new)
    stats = GraphStats(synapse_graph, target_synapses=target_synapses).collect(limit=5)
    stats["stores"] = collect_store_counts(state_dir)
    result: dict[str, Any] = {
        "ok": True,
        "event_type": event.type,
        "route": "neural_graph",
        "memory": {},
        "plasticity": {
            "confidence": 1.0,
            "action": "seed_neural_graph",
            "learned": bool(seed.get("created_or_updated")),
        },
        "llm": {
            "status": "skipped",
            "text": "LLM отключён для neural_seed.",
            "latency_ms": 0.0,
        },
        "confidence": 1.0,
        "next_adaptation": "Используй neural_walk, чтобы проверять путь активации между кластерами.",
        "self_evaluation": {
            "score": 1.0,
            "reason": "clustered neural graph seeded",
            "store_memory": False,
            "reinforce": "clustered neural graph",
        },
        "graph_stats": stats,
        "neural_graph": {
            "seed": seed,
            "snapshot": neural_graph.snapshot(limit=6),
        },
    }
    answer = compose_answer(event, result, result["self_evaluation"])
    if answer:
        result["answer"] = answer
    return result


def _handle_neural_walk(
    event: Event,
    state_dir: Path,
    synapse_graph: SynapseGraph,
) -> dict[str, Any]:
    query = str(event.payload.get("query") or event.payload.get("text") or "Max17").strip()
    try:
        steps = int(event.payload.get("steps") or 8)
    except (TypeError, ValueError):
        steps = 8
    neural_graph = ClusteredNeuralGraph(synapse_graph)
    walk = neural_graph.walk(query, steps=steps)
    stats = GraphStats(synapse_graph).collect(limit=3)
    stats["stores"] = collect_store_counts(state_dir)
    result: dict[str, Any] = {
        "ok": True,
        "event_type": event.type,
        "route": "neural_graph",
        "memory": {},
        "plasticity": {
            "confidence": 0.9 if walk.get("steps") else 0.35,
            "action": "walk_neural_graph",
            "learned": False,
        },
        "llm": {
            "status": "skipped",
            "text": "LLM отключён для neural_walk.",
            "latency_ms": 0.0,
        },
        "confidence": 0.9 if walk.get("steps") else 0.35,
        "next_adaptation": "Если путь пустой, сначала запусти neural_seed для заполнения кластеров.",
        "self_evaluation": {
            "score": 0.9 if walk.get("steps") else 0.35,
            "reason": "neural graph activation path collected",
            "store_memory": False,
            "reinforce": "cluster traversal",
        },
        "graph_stats": stats,
        "neural_graph": {
            "walk": walk,
            "snapshot": neural_graph.snapshot(limit=4),
        },
    }
    answer = compose_answer(event, result, result["self_evaluation"])
    if answer:
        result["answer"] = answer
    return result


def _handle_compress_memory(
    event: Event,
    brain: Mark17Brain,
    vector_memory: VectorMemory,
    synapse_graph: SynapseGraph,
    working_memory: WorkingMemory,
) -> dict[str, Any]:
    working_context = working_memory.get_context()
    compression = compress_to_concept(_event_text(event), working_context)
    primary = compression.get("primary") if isinstance(compression, dict) else {}
    primary = primary if isinstance(primary, dict) else {}
    confidence = float(primary.get("confidence")) if isinstance(primary.get("confidence"), (int, float)) else 0.35
    evaluation = {
        "score": confidence,
        "reason": f"compressed memory as {primary.get('label') or primary.get('concept') or 'context'}",
        "store_memory": True,
        "reinforce": str(primary.get("label") or primary.get("concept") or ""),
    }
    result: dict[str, Any] = {
        "ok": True,
        "event_type": event.type,
        "route": "compression",
        "memory": {
            "recalled": [],
            "semantic": [],
        },
        "plasticity": {
            "confidence": confidence,
            "action": "compress_memory",
            "learned": True,
        },
        "llm": {
            "status": "skipped",
            "text": "LLM отключён для compress_memory.",
            "latency_ms": 0.0,
        },
        "confidence": confidence,
        "next_adaptation": "Используй сжатый смысловой узел как будущую точку recall и планирования.",
        "self_evaluation": evaluation,
        "working_memory": working_context,
    }
    _merge_concept_payload(result, compression=compression)
    concept_event = Event(
        type="compressed_concept",
        payload={
            "text": _event_text(event),
            "compression": compression,
            "source_event": event.type,
        },
        source=event.source,
    )
    memory_id = brain.memory.remember(
        concept_event,
        hint=f"{primary.get('label') or primary.get('concept')}: {_event_text(event)[:160]}",
        action="concept_crystallization",
    )
    vector_memory.remember(concept_event, evaluation)
    result["memory"]["compressed_stored_id"] = memory_id
    _apply_compression_synapses(synapse_graph, event, result, memory_id=memory_id)
    answer = compose_answer(event, result, evaluation)
    if answer:
        result["answer"] = answer
    brain.plasticity.save()
    return result


def _handle_working_memory_reset(working_memory: WorkingMemory) -> dict[str, Any]:
    state = working_memory.reset()
    return {
        "ok": True,
        "event_type": "working_memory_reset",
        "route": "working_memory",
        "memory": {},
        "plasticity": {
            "confidence": 1.0,
            "action": "reset",
            "learned": False,
        },
        "llm": {
            "status": "skipped",
            "text": "LLM отключён для working_memory_reset.",
            "latency_ms": 0.0,
        },
        "confidence": 1.0,
        "next_adaptation": "Оперативный контекст очищен.",
        "self_evaluation": {
            "score": 1.0,
            "reason": "working memory reset",
            "store_memory": False,
            "reinforce": "clear session context",
        },
        "working_memory": state,
        "answer": {
            "text": "Я очистил оперативный контекст сессии.",
            "source": "composer",
            "confidence": 1.0,
        },
    }


def _handle_sleep_consolidation(
    event: Event,
    brain: Mark17Brain,
    vector_memory: VectorMemory,
    synapse_graph: SynapseGraph,
) -> dict[str, Any]:
    try:
        limit = int(event.payload.get("limit", 50))
    except (TypeError, ValueError):
        limit = 50
    engine = ConsolidationEngine(brain.memory, vector_memory, synapse_graph)
    consolidation = engine.consolidate_recent(limit=limit)
    # Phase 5: during sleep also wire cross-cluster bridges (associative insight
    # links between semantically-close memories of different modalities). Best-
    # effort — must never break consolidation.
    try:
        bridges = engine.bridge_distant(limit=12)
    except Exception:  # noqa: BLE001
        bridges = {"bridges_created": 0, "bridges": []}
    if isinstance(consolidation, dict):
        consolidation["bridges"] = bridges
    patterns = consolidation.get("patterns") if isinstance(consolidation, dict) else []
    strengths = [
        float(pattern.get("strength", 0.0))
        for pattern in patterns
        if isinstance(pattern, dict) and isinstance(pattern.get("strength"), (int, float))
    ]
    confidence = sum(strengths) / len(strengths) if strengths else 0.0
    result: dict[str, Any] = {
        "ok": True,
        "event_type": event.type,
        "route": "consolidation",
        "memory": {},
        "plasticity": {
            "confidence": confidence,
            "action": "consolidated",
            "learned": bool(patterns),
        },
        "llm": {
            "status": "skipped",
            "text": "LLM отключён для sleep_consolidation.",
            "latency_ms": 0.0,
        },
        "consolidation": consolidation,
        "next_adaptation": "Проверь один устойчивый паттерн через маленькое действие в реальности.",
        "self_evaluation": {
            "score": round(confidence, 4),
            "reason": f"sleep consolidation created {len(patterns)} patterns",
            "store_memory": False,
            "reinforce": "sleep consolidation",
        },
    }
    if patterns:
        compression = compress_to_concept(
            " ".join(str(pattern.get("summary") or "") for pattern in patterns if isinstance(pattern, dict))
        )
        _merge_concept_payload(result, compression=compression)
    result["synapses"] = synapse_graph.update_from_event(event, result, result["self_evaluation"])
    _apply_compression_synapses(synapse_graph, event, result)
    answer = compose_answer(event, result, result["self_evaluation"])
    if answer:
        result["answer"] = answer
    _apply_growth(synapse_graph, event, result, result["self_evaluation"])
    brain.plasticity.save()
    return result


def _run_warmup(
    path: Path,
    brain: Mark17Brain,
    vector_memory: VectorMemory,
    synapse_graph: SynapseGraph,
    working_memory: WorkingMemory,
    concept_grounding: ConceptGrounding,
    source_memory: SourceMemory,
    args: argparse.Namespace,
) -> None:
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        raw = json.loads(line)
        if not isinstance(raw, dict):
            continue
        event = _as_event(raw)
        if event.type == "working_memory_reset":
            working_memory.reset()
            continue
        if event.type == "graph_stats":
            _handle_graph_stats(event, brain.memory.db_path.parent, synapse_graph)
            continue
        if event.type == "neural_seed":
            _handle_neural_seed(event, brain.memory.db_path.parent, synapse_graph)
            continue
        if event.type == "neural_walk":
            _handle_neural_walk(event, brain.memory.db_path.parent, synapse_graph)
            continue
        if event.type == "compress_memory":
            _handle_compress_memory(event, brain, vector_memory, synapse_graph, working_memory)
            continue
        if event.type == "sleep_consolidation":
            _handle_sleep_consolidation(event, brain, vector_memory, synapse_graph)
            continue
        if event.type in OUTCOME_EVENT_TYPES:
            _handle_outcome_event(event, brain, vector_memory, synapse_graph, working_memory)
            continue
        if event.type in {"web_research", "web_ingest"}:
            _handle_web_research(event, args, brain, vector_memory, synapse_graph, source_memory)
            continue
        result = brain.handle(event)
        _merge_concept_payload(result, grounding=concept_grounding.match_event(event))
        evaluation = evaluate_event(event, result)
        result["self_evaluation"] = evaluation.to_dict()
        result["next_adaptation"] = _next_adaptation(result)
        if event.type in {"user_message", "task_created", "task_completed", "deadline_failed", "terminal_error", "system_state", "environment_observation"}:
            result["working_memory"] = working_memory.update_from_event(event, result, result["self_evaluation"])
        _apply_event_compression(
            result,
            event,
            result.get("working_memory") if isinstance(result.get("working_memory"), dict) else None,
        )
        result["synapses"] = synapse_graph.update_from_event(event, result, result["self_evaluation"])
        result["plan"] = plan_next_actions(
            event,
            result,
            result.get("working_memory"),
            result["self_evaluation"],
        )
        answer = compose_answer(event, result, result["self_evaluation"])
        if answer:
            result["answer"] = answer
            if event.type in {"user_message", "task_created", "task_completed", "deadline_failed", "terminal_error", "system_state", "environment_observation"}:
                working_memory.update_from_event(event, result, result["self_evaluation"])
        _apply_compression_synapses(synapse_graph, event, result)
        _apply_growth(synapse_graph, event, result, result["self_evaluation"])
        if evaluation.store_memory:
            brain.memory.remember(
                Event(
                    type="remember",
                    payload={
                        "note": evaluation.reason,
                        "event_type": event.type,
                        "route": result.get("route"),
                        "reinforce": evaluation.reinforce,
                        "score": evaluation.score,
                    },
                    source="critic",
                ),
                hint=evaluation.reason,
                action="self_evaluation",
            )
            vector_memory.remember(event, evaluation.to_dict())


if __name__ == "__main__":
    raise SystemExit(main())
