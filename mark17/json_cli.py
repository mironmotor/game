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
from mark17.voice_state import VoiceProfiles, process_voice_event
from mark17.planner import build_plan
from mark17.big_idea import generate as generate_big_idea
from mark17.dream_sim import generate as generate_dream_sim
from mark17.ingest import generate as generate_ingest, split_stream

ALLOWED_EVENTS = frozenset(
    {
        "user_message",
        "task_created",
        "task_completed",
        "deadline_failed",
        "terminal_error",
        "system_state",
        "sleep_consolidation",
        "voice_state",
        "auto_plan",
        "synapse_graph",
        "big_idea",
        "simulation",
        "ingest",
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
    elif event_type == "voice_state":
        payload["user_id"] = str(data.get("user_id") or data.get("user") or "anon")
        payload["context"] = str(data.get("context") or data.get("text") or "")
    elif event_type == "auto_plan":
        goal = data.get("goal") or data.get("message") or data.get("text") or ""
        payload["goal"] = str(goal)
    elif event_type == "big_idea":
        for key in ("domain", "audience", "trend", "twist"):
            payload[key] = str(data.get(key) or "")
    elif event_type == "simulation":
        prompt = data.get("prompt") or data.get("text") or data.get("message") or ""
        payload["prompt"] = str(prompt)
    elif event_type == "ingest":
        payload["interest"] = str(data.get("interest") or data.get("prompt") or "")
        raw_items = data.get("items")
        if isinstance(raw_items, list):
            payload["items"] = [str(x) for x in raw_items]
        else:
            payload["items"] = split_stream(str(data.get("stream") or data.get("text") or ""))

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
    voice = result.get("voice")
    if isinstance(voice, dict):
        normalized["voice"] = voice
    plan = result.get("plan")
    if isinstance(plan, dict):
        normalized["plan"] = plan
    graph = result.get("graph")
    if isinstance(graph, dict):
        normalized["graph"] = graph
    big = result.get("big_idea")
    if isinstance(big, dict):
        normalized["big_idea"] = big
    sim = result.get("sim")
    if isinstance(sim, dict):
        normalized["sim"] = sim
    ingest = result.get("ingest")
    if isinstance(ingest, dict):
        normalized["ingest"] = ingest
    return normalized


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
    if args.warmup:
        _run_warmup(args.warmup, brain, vector_memory, synapse_graph)
    if event.type == "sleep_consolidation":
        return _handle_sleep_consolidation(event, brain, vector_memory, synapse_graph)
    if event.type == "voice_state":
        return _handle_voice_state(event, brain, vector_memory, synapse_graph, state_dir)
    if event.type == "auto_plan":
        return _handle_auto_plan(event, brain, vector_memory, synapse_graph)
    if event.type == "big_idea":
        return _handle_big_idea(event, brain, synapse_graph)
    if event.type == "simulation":
        return _handle_simulation(event, brain, synapse_graph)
    if event.type == "ingest":
        return _handle_ingest(event, brain, synapse_graph)
    if event.type == "synapse_graph":
        return _handle_synapse_graph(event, synapse_graph)

    result = brain.handle(event)
    _merge_memory(
        result,
        recalled=_recalled_memories(event, brain),
        semantic=_semantic_memories(event, vector_memory),
        consolidated_patterns=_recent_consolidated_patterns(brain) if event.type == "user_message" else [],
    )
    evaluation = evaluate_event(event, result)
    result["self_evaluation"] = evaluation.to_dict()
    result["next_adaptation"] = _next_adaptation(result)
    result["synapses"] = synapse_graph.update_from_event(event, result, result["self_evaluation"])
    answer = compose_answer(event, result, result["self_evaluation"])
    if answer:
        result["answer"] = answer
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


def _handle_synapse_graph(event: Event, synapse_graph: SynapseGraph) -> dict[str, Any]:
    """Read-only export of the real Max synapse graph for visualization."""
    try:
        limit = int(event.payload.get("limit", 400))
    except (TypeError, ValueError):
        limit = 400
    graph = synapse_graph.get_graph(limit=max(1, min(2000, limit)))
    stats = graph.get("stats", {})
    return {
        "ok": True,
        "event_type": event.type,
        "route": "synapse_graph",
        "graph": graph,
        "memory": {"hint": f"synapse graph: {stats.get('shown_synapses', 0)}/{stats.get('total_synapses', 0)} synapses, {stats.get('nodes', 0)} nodes"},
        "plasticity": {"confidence": 1.0 if stats.get("total_synapses") else 0.0, "action": "synapse_graph_read", "learned": False},
        "llm": {"status": "skipped", "text": "Синапс-граф прочитан из ядра Max, без LLM.", "latency_ms": 0.0},
        "decision": {"reason": "synapse graph export", "confidence": 1.0},
        "next_adaptation": "Реальные синапсы ядра Max растут по мере использования системы.",
        "self_evaluation": {"score": 1.0, "reason": "synapse graph export", "store_memory": False, "reinforce": "synapse_graph"},
    }


def _handle_big_idea(event: Event, brain: Mark17Brain, synapse_graph: SynapseGraph) -> dict[str, Any]:
    """Big Idea через ядро: LLM моста (Qwen/OpenRouter) или детерминированный фолбэк."""
    seed = {k: str(event.payload.get(k) or "") for k in ("domain", "audience", "trend", "twist")}
    result_idea = generate_big_idea(seed, brain.llm)
    result: dict[str, Any] = {
        "ok": True,
        "event_type": event.type,
        "route": "big_idea",
        "big_idea": result_idea,
        "memory": {"hint": result_idea["idea"].get("tagline", "")},
        "plasticity": {"confidence": 0.9 if result_idea["source"].startswith("llm") else 0.6,
                        "action": "big_idea", "learned": True},
        "llm": {"status": "ok" if result_idea["source"].startswith("llm") else "skipped",
                "text": f"source={result_idea['source']}", "latency_ms": 0.0},
        "next_adaptation": result_idea["idea"].get("firstStep", ""),
        "self_evaluation": {"score": 0.8, "reason": f"big idea via {result_idea['source']}",
                             "store_memory": True, "reinforce": "big_idea"},
    }
    result["synapses"] = synapse_graph.update_from_event(event, result, result["self_evaluation"])
    brain.memory.remember(
        Event(type="remember", payload={"note": result_idea["idea"].get("tagline", ""),
                                          "seed": seed, "reinforce": "big_idea"}, source="funnel"),
        hint=result_idea["idea"].get("tagline", ""), action="big_idea",
    )
    brain.plasticity.save()
    return result


def _handle_simulation(event: Event, brain: Mark17Brain, synapse_graph: SynapseGraph) -> dict[str, Any]:
    """Симуляция Макса: промпт → параметры мира частиц (LLM или детерминированно)."""
    prompt = str(event.payload.get("prompt") or "")
    sim = generate_dream_sim(prompt, brain.llm)
    result: dict[str, Any] = {
        "ok": True,
        "event_type": event.type,
        "route": "simulation",
        "sim": sim,
        "memory": {"hint": sim.get("thought", "")},
        "plasticity": {"confidence": 0.85 if sim["source"].startswith("llm") else 0.6,
                        "action": "simulation", "learned": True},
        "llm": {"status": "ok" if sim["source"].startswith("llm") else "skipped",
                "text": f"source={sim['source']}", "latency_ms": 0.0},
        "next_adaptation": sim.get("thought", ""),
        "self_evaluation": {"score": 0.75, "reason": f"simulation via {sim['source']}",
                             "store_memory": bool(prompt), "reinforce": "simulation"},
    }
    result["synapses"] = synapse_graph.update_from_event(event, result, result["self_evaluation"])
    if prompt:
        brain.memory.remember(
            Event(type="remember", payload={"note": prompt, "reinforce": "simulation"}, source="simulation"),
            hint=sim.get("thought", ""), action="simulation",
        )
    brain.plasticity.save()
    return result


def _handle_ingest(event: Event, brain: Mark17Brain, synapse_graph: SynapseGraph) -> dict[str, Any]:
    """Инбокс Макса: фильтр потока по промпту; важное → память + синапсы."""
    interest = str(event.payload.get("interest") or "")
    items = event.payload.get("items")
    if not isinstance(items, list):
        items = []
    ingest = generate_ingest(interest, [str(x) for x in items], brain.llm)

    # Важное закрепляем в памяти и растим граф.
    for entry in ingest["kept"]:
        brain.memory.remember(
            Event(
                type="remember",
                payload={"note": entry["text"], "interest": interest,
                         "score": entry["score"], "reinforce": "ingest"},
                source="inbox",
            ),
            hint=entry["text"][:80], action="ingest",
        )

    self_eval = {
        "score": 0.7,
        "reason": f"ingest kept {ingest['kept_count']}/{ingest['total']} via {ingest['source']}",
        "store_memory": ingest["kept_count"] > 0,
        "reinforce": "ingest",
    }
    result: dict[str, Any] = {
        "ok": True,
        "event_type": event.type,
        "route": "ingest",
        "ingest": ingest,
        "memory": {"hint": f"важного: {ingest['kept_count']} из {ingest['total']}"},
        "plasticity": {"confidence": 0.85 if ingest["source"].startswith("llm") else 0.6,
                        "action": "ingest", "learned": ingest["kept_count"] > 0},
        "llm": {"status": "ok" if ingest["source"].startswith("llm") else "skipped",
                "text": f"source={ingest['source']}", "latency_ms": 0.0},
        "next_adaptation": f"В память ушло {ingest['kept_count']} важных фрагментов.",
        "self_evaluation": self_eval,
    }
    result["synapses"] = synapse_graph.update_from_event(event, result, self_eval)
    brain.plasticity.save()
    return result


def _handle_auto_plan(
    event: Event,
    brain: Mark17Brain,
    vector_memory: VectorMemory,
    synapse_graph: SynapseGraph,
) -> dict[str, Any]:
    """Deterministically decompose a goal into an MGR plan on the Max core."""
    goal = str(event.payload.get("goal") or "").strip()
    try:
        horizon = int(event.payload.get("horizon_days", 0))
    except (TypeError, ValueError):
        horizon = 0

    plan = build_plan(goal, horizon_days=horizon)

    # Pull any related past experience for this goal.
    recalled = [
        {
            "id": hit.id,
            "event_type": hit.event_type,
            "importance": round(hit.importance, 3),
            "score": round(hit.score, 3),
            "summary": hit.content.get("hint") or hit.signature[:120],
        }
        for hit in (brain.memory.recall(goal, limit=3) if goal else [])
    ]
    semantic = [hit.to_dict() for hit in (vector_memory.recall(goal, limit=3) if goal else [])]

    confidence = round(min(1.0, 0.5 + 0.1 * len(plan.get("tasks", []))), 3) if plan.get("ok") else 0.0
    result: dict[str, Any] = {
        "ok": bool(plan.get("ok")),
        "event_type": event.type,
        "route": "auto_plan",
        "plan": plan,
        "memory": {"recalled": recalled, "semantic": semantic, "hint": plan.get("summary")},
        "plasticity": {
            "confidence": confidence,
            "action": "auto_plan",
            "learned": bool(plan.get("ok")),
        },
        "llm": {"status": "skipped", "text": "Автоплан собран детерминированно ядром Max, без LLM.", "latency_ms": 0.0},
        "decision": {"reason": plan.get("summary", ""), "confidence": confidence},
        "next_adaptation": plan.get("first_move") and f"Начни с малого: {plan['first_move']}." or plan.get("summary", ""),
        "self_evaluation": {
            "score": confidence,
            "reason": f"auto_plan built {len(plan.get('tasks', []))} tasks for goal",
            "store_memory": bool(plan.get("ok")),
            "reinforce": "auto_plan",
        },
    }
    result["synapses"] = synapse_graph.update_from_event(event, result, result["self_evaluation"])

    # Remember that this goal was planned, so future recall can connect to it.
    if plan.get("ok"):
        brain.memory.remember(
            Event(
                type="remember",
                payload={
                    "note": plan.get("summary", ""),
                    "goal": goal,
                    "domain": plan.get("domain"),
                    "total_xp": plan.get("total_xp"),
                    "reinforce": "auto_plan",
                },
                source="planner",
            ),
            hint=plan.get("summary", ""),
            action="auto_plan",
        )
        vector_memory.remember(event, result["self_evaluation"])
    brain.plasticity.save()
    return result


def _handle_voice_state(
    event: Event,
    brain: Mark17Brain,
    vector_memory: VectorMemory,
    synapse_graph: SynapseGraph,
    state_dir: Path,
) -> dict[str, Any]:
    """Read the speaker's state from voice acoustics + context, remember it."""
    profiles = VoiceProfiles(state_dir)
    user_id = str(event.payload.get("user_id") or "anon")
    context = str(event.payload.get("context") or "")
    voice = process_voice_event(user_id, event.payload, profiles, context=context)

    hint = f"{user_id}: {voice['label']} (F0 {voice['acoustics']['f0']} Гц / {voice['note']})"
    result: dict[str, Any] = {
        "ok": True,
        "event_type": event.type,
        "route": "voice_state",
        "voice": voice,
        "memory": {"hint": hint},
        "plasticity": {
            "confidence": round(max(voice["arousal"], voice["tension"]), 3),
            "action": "voice_state_read",
            "learned": not voice["baseline"]["warming_up"],
        },
        "llm": {},
        "decision": {"reason": hint, "confidence": round(voice["arousal"], 3)},
        "next_adaptation": _voice_adaptation(voice),
    }

    # Remember this reading so Max17 builds a history of the person.
    brain.memory.remember(
        Event(
            type="remember",
            payload={
                "note": hint,
                "user_id": user_id,
                "arousal": voice["arousal"],
                "valence": voice["valence"],
                "tension": voice["tension"],
                "context": context,
            },
            source="voice",
        ),
        hint=hint,
        action="voice_state",
    )
    # Link the voice state to the dialogue context in the synapse graph.
    evaluation = {"score": voice["arousal"], "reason": hint, "reinforce": voice["label"]}
    result["synapses"] = synapse_graph.update_from_event(event, result, evaluation)
    brain.plasticity.save()
    return result


def _voice_adaptation(voice: dict[str, Any]) -> str:
    """Suggest how Max17 should adapt its tone to the detected state."""
    if voice["baseline"]["warming_up"]:
        return f"Учу голос пользователя ({voice['baseline']['obs']} набл.) — пока строю норму."
    if voice["tension"] > 0.66:
        return "Человек напряжён — отвечай мягче, короче, снизь темп."
    if voice["arousal"] > 0.66 and voice["valence"] > 0.55:
        return "Человек воодушевлён — поддержи энергию, можно глубже в тему."
    if voice["arousal"] < 0.35 and voice["valence"] < 0.45:
        return "Человек подавлен — добавь поддержки, не дави фактами."
    return "Состояние ровное — продолжай в текущем тоне."


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
    brain.plasticity.save()
    return result


def _run_warmup(
    path: Path,
    brain: Mark17Brain,
    vector_memory: VectorMemory,
    synapse_graph: SynapseGraph,
) -> None:
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        raw = json.loads(line)
        if not isinstance(raw, dict):
            continue
        event = _as_event(raw)
        if event.type == "sleep_consolidation":
            _handle_sleep_consolidation(event, brain, vector_memory, synapse_graph)
            continue
        result = brain.handle(event)
        evaluation = evaluate_event(event, result)
        result["self_evaluation"] = evaluation.to_dict()
        result["next_adaptation"] = _next_adaptation(result)
        synapse_graph.update_from_event(event, result, result["self_evaluation"])
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
