#!/usr/bin/env python3
"""JSON bridge CLI for Game -> Max17.

mark17 is the internal package name for the Max17 core.
"""

from __future__ import annotations

import argparse
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

    if event_type == "user_message":
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
    concept_grounding = ConceptGrounding(state_dir)
    if args.warmup:
        _run_warmup(args.warmup, brain, vector_memory, synapse_graph, working_memory, concept_grounding)
    if event.type == "working_memory_reset":
        return _handle_working_memory_reset(working_memory)
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
    result["concepts"] = concept_grounding.match_event(event)
    evaluation = evaluate_event(event, result)
    result["self_evaluation"] = evaluation.to_dict()
    result["next_adaptation"] = _next_adaptation(result)
    if event.type in {"user_message", "task_created", "task_completed", "deadline_failed", "terminal_error", "system_state", "environment_observation"}:
        result["working_memory"] = working_memory.update_from_event(event, result, result["self_evaluation"])
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
    result["synapses"] = synapse_graph.update_from_event(event, result, result["self_evaluation"])
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
        if event.type == "sleep_consolidation":
            _handle_sleep_consolidation(event, brain, vector_memory, synapse_graph)
            continue
        if event.type in OUTCOME_EVENT_TYPES:
            _handle_outcome_event(event, brain, vector_memory, synapse_graph, working_memory)
            continue
        result = brain.handle(event)
        result["concepts"] = concept_grounding.match_event(event)
        evaluation = evaluate_event(event, result)
        result["self_evaluation"] = evaluation.to_dict()
        result["next_adaptation"] = _next_adaptation(result)
        if event.type in {"user_message", "task_created", "task_completed", "deadline_failed", "terminal_error", "system_state", "environment_observation"}:
            result["working_memory"] = working_memory.update_from_event(event, result, result["self_evaluation"])
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
