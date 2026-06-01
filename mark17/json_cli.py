#!/usr/bin/env python3
"""JSON bridge CLI for Game -> Max17.

mark17 is the internal package name for the Max17 core.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
import traceback
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.daemon import Mark17Brain
from mark17.events import Event
from mark17.critic import evaluate_event
from mark17.responder import compose_answer
from mark17.vector_memory import VectorMemory
from mark17.synapse_graph import SynapseGraph
from mark17.consolidation import ConsolidationEngine
from mark17.working_memory import WorkingMemory
from mark17.planner import plan_next_actions
from mark17.outcome import OUTCOME_EVENT_TYPES, evaluate_outcome, update_outcome_synapses
from mark17.growth import grow_synapses
from mark17.concepts import ConceptGrounding
from mark17.concept_compression import compress_to_concept
from mark17.graph_stats import GraphStats, collect_store_counts
from mark17.neural_graph import ClusteredNeuralGraph, TARGET_NEURAL_SYNAPSES

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
    args = parser.parse_args()

    try:
        event = _as_event(_read_input())
        if args.ephemeral:
            with tempfile.TemporaryDirectory(prefix="max17-smoke-") as tmp:
                result = _handle_event(event, args, Path(tmp))
        else:
            result = _handle_event(event, args, args.state_dir)
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


def _handle_event(event: Event, args: argparse.Namespace, state_dir: Path) -> dict[str, Any]:
    brain = Mark17Brain(
        state_dir,
        plasticity_threshold=args.plasticity_threshold,
        llm_enabled=not args.no_llm,
        llm_model=args.ollama_model,
        llm_host=args.ollama_host,
    )
    vector_memory = VectorMemory(state_dir)
    synapse_graph = SynapseGraph(state_dir)
    working_memory = WorkingMemory(state_dir)
    if event.type == "graph_stats" and not args.warmup:
        return _handle_graph_stats(event, state_dir, synapse_graph)
    if event.type == "neural_seed" and not args.warmup:
        return _handle_neural_seed(event, state_dir, synapse_graph)
    if event.type == "neural_walk" and not args.warmup:
        return _handle_neural_walk(event, state_dir, synapse_graph)
    concept_grounding = ConceptGrounding(state_dir)
    if args.warmup:
        _run_warmup(args.warmup, brain, vector_memory, synapse_graph, working_memory, concept_grounding)
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
        return result
    if event.type in OUTCOME_EVENT_TYPES:
        return _handle_outcome_event(event, brain, vector_memory, synapse_graph, working_memory)

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
    answer = compose_answer(event, result, result["self_evaluation"])
    if answer:
        result["answer"] = answer
        if event.type in {"user_message", "task_created", "task_completed", "deadline_failed", "terminal_error", "system_state", "environment_observation"}:
            result["working_memory"] = working_memory.update_from_event(event, result, result["self_evaluation"])
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
