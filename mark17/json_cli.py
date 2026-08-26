#!/usr/bin/env python3
"""JSON bridge CLI for Game -> Max17.

mark17 is the internal package name for the Max17 core.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import tempfile
import traceback
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
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
from mark17.voice_state import analyze_voice
from mark17.semantic_compiler import MIN_SIM as IR_MIN_SIM, SemanticCompiler
from mark17.meaning_tree import MeaningTree
from mark17.ultra_orchestrator import decide as ultra_decide, gather_state as ultra_gather_state
from mark17.music_sense import aggregate_taste, analyze_music, mood_music_spec
from mark17.corpus_ingest import ingest_path, ingest_text
from mark17.growth_log import history as growth_history, record as growth_record
from mark17.self_state import SelfState
from mark17.skill_graph import SKILLS as SKILL_LABELS, SkillGraph
from mark17.synapse_forge import forge as forge_synapses
from mark17.guardian import is_clean as _guard_clean, record as _guard_record, total as _guard_total
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
from mark17.compression import compress as compress_similar
from mark17.big_idea import generate as generate_big_idea
from mark17.dream_sim import generate as generate_dream_sim
from mark17.ingest import generate as generate_ingest, split_stream
from mark17.decoder import generate as generate_decode
from mark17 import reality as reality_ledger
from mark17.ultimate_core import MAX_ULTIMATE_TARGET_SYNAPSES, bootstrap_ultimate_core
from mark17 import web_sense
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
        "voice_observation",
        "compile_semantic",
        "meaning_tree",
        "ultra_think",
        "concept_explain",
        "music_observation",
        "music_taste",
        "dream_mood",
        "ingest_corpus",
        "introspect",
        "sleep_consolidation",
        "working_memory_reset",
        "outcome_success",
        "outcome_failure",
        "outcome_partial",
        "action_done",
        "action_skipped",
        "compress_memory",
        "graph_stats",
        "compress_links",
        "system_scales",
        "skills",
        "synapse_forge",
        "neural_seed",
        "neural_walk",
        "internal_dream",
        "generate_synergies",
        "web_research",
        "web_ingest",
        "autonomous_research",
        "ultimate_bootstrap",
        "memory_recall",
        "memory_store",
        "llm_raw",
        "heart",
        "cache_stats",
        "agent_experience",
        "missions",
        "cluster",
        "health",
        "chrono_day",
        "reality",
        # MAX VISION: фото и видео как отдельная способность, а не поток с камеры.
        "see",
        # Режимы, перенесённые из main: витрина графа, автоплан, эфир.
        "synapse_graph",
        "auto_plan",
        "world_state",
        # Визуальные режимы GAME (Воронка, Симуляция, Инбокс, ДЕКОДЕР).
        "big_idea",
        "simulation",
        "ingest",
        "decode",
        "compress_similar",
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

    if event_type in {"user_message", "compress_memory", "compile_semantic", "ingest_corpus", "memory_recall", "memory_store", "llm_raw"}:
        text = data.get("message") or data.get("text") or data.get("content") or ""
        payload["text"] = str(text)
    elif event_type in {"web_research", "web_ingest"}:
        text = data.get("query") or data.get("text") or data.get("message") or data.get("content") or ""
        payload["query"] = str(text)
    elif event_type == "terminal_error":
        line = data.get("line") or data.get("message") or data.get("text") or ""
        payload["line"] = str(line)
    elif event_type == "reality":
        payload["kind"] = str(data.get("kind") or "")
        payload["note"] = str(data.get("note") or data.get("text") or "")
        try:
            payload["amount"] = float(data.get("amount") or 0)
        except (TypeError, ValueError):
            payload["amount"] = 0.0
    elif event_type == "compress_similar":
        raw = data.get("items")
        payload["items"] = [str(x) for x in raw] if isinstance(raw, list) else []
        try:
            payload["threshold"] = float(data.get("threshold") or 0) or None
        except (TypeError, ValueError):
            payload["threshold"] = None
    elif event_type == "big_idea":
        for key in ("domain", "audience", "trend", "twist"):
            payload[key] = str(data.get(key) or "")
    elif event_type == "simulation":
        payload["prompt"] = str(data.get("prompt") or data.get("text") or data.get("message") or "")
    elif event_type == "decode":
        payload["target"] = str(data.get("target") or data.get("prompt") or data.get("text") or "")
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
    if event.type not in {"user_message", "memory_recall"}:
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
        for hit in brain.memory.recall(query, limit=6)
    ]


_OUTCOME_STATUS = {
    "outcome_success": "success",
    "action_done": "success",
    "outcome_failure": "failure",
    "outcome_partial": "partial",
    "action_skipped": "skipped",
}


def _recalled_outcomes(event: Event, brain: Mark17Brain) -> list[dict[str, Any]]:
    """Past outcomes relevant to the query, so the planner can avoid what failed
    and reinforce what worked (closes the learning loop into decisions)."""
    if event.type not in {"user_message", "memory_recall"}:
        return []
    query = str(event.payload.get("text") or "").strip()
    if not query:
        return []
    out: list[dict[str, Any]] = []
    for hit in brain.memory.recall(query, limit=10):
        status = _OUTCOME_STATUS.get(hit.event_type)
        if not status:
            continue
        out.append(
            {
                "text": hit.content.get("hint") or hit.signature[:120],
                "status": status,
                "score": round(hit.score, 3),
            }
        )
        if len(out) >= 5:
            break
    return out


def _semantic_memories(event: Event, vector_memory: VectorMemory) -> list[dict[str, Any]]:
    if event.type not in {"user_message", "memory_recall"}:
        return []

    query = str(event.payload.get("text") or "").strip()
    if not query:
        return []

    return [hit.to_dict() for hit in vector_memory.recall(query, limit=6)]


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


def _handle_memory_recall(
    event: Event, brain: Mark17Brain, vector_memory: VectorMemory
) -> dict[str, Any]:
    """Fast, network-free recall: graph + vector memory only — no LLM voice, no web.

    Used by the MAX orchestrator's Memory Agent so the council stays instant while
    still being grounded in real Max17 memory (a user_message would also fire the
    Gonka voice + web sense, ~17s)."""
    return {
        "ok": True,
        "route": "memory_recall",
        "memory": {
            "recalled": _recalled_memories(event, brain),
            "semantic": _semantic_memories(event, vector_memory),
        },
        "outcomes": _recalled_outcomes(event, brain),
        "consolidation": {"patterns": _recent_consolidated_patterns(brain)},
        "plasticity": {},
        "llm": {"status": "skipped", "text": "recall only", "latency_ms": 0.0},
        "confidence": 0.0,
        "next_adaptation": "recall only",
    }


def _handle_memory_store(
    event: Event, brain: Mark17Brain, vector_memory: VectorMemory
) -> dict[str, Any]:
    """Fast, network-free write: persist an orchestrator turn into graph + vector
    memory so the council remembers its own past goals/decisions. No LLM, no web."""
    text = str(event.payload.get("text") or "").strip()
    if not text:
        return {
            "ok": False,
            "route": "memory_store",
            "memory": {},
            "plasticity": {},
            "llm": {"status": "skipped"},
            "confidence": 0.0,
            "next_adaptation": "nothing to store",
        }
    note = str(event.payload.get("note") or text)
    brain.memory.remember(
        Event(
            type="remember",
            payload={
                "note": note,
                "event_type": "orchestrator_turn",
                "reinforce": "orchestrator",
                "payload": {"reinforce": "orchestrator"},
            },
            source="orchestrator",
        ),
        hint=text,
        action="orchestrator_turn",
    )
    vector_id = vector_memory.remember(
        event,
        {"score": 0.6, "reason": note, "store_memory": True, "reinforce": "orchestrator"},
    )
    return {
        "ok": True,
        "route": "memory_store",
        "stored": {"hippocampus": True, "vector": vector_id},
        "memory": {"recalled": [], "semantic": []},
        "plasticity": {},
        "llm": {"status": "skipped", "text": "store only", "latency_ms": 0.0},
        "confidence": 0.0,
        "next_adaptation": "stored",
    }


def _handle_llm_raw(event: Event) -> dict[str, Any]:
    """Raw LLM call (Gonka) for a single prompt — no memory, no web, no synapses.
    Powers the orchestrator's deep/LLM-grounded agent mode from the TS side."""
    prompt = str(event.payload.get("text") or "").strip()
    system = str(event.payload.get("system") or "")
    base = {
        "route": "llm_raw",
        "memory": {},
        "plasticity": {},
        "confidence": 0.0,
        "next_adaptation": "llm_raw",
        "llm_text": "",
    }
    if not prompt:
        return {**base, "ok": False, "llm": {"status": "error"}, "error": "empty prompt"}
    if not gonka_is_enabled("chat"):
        return {**base, "ok": False, "llm": {"status": "disabled"}, "error": "gonka disabled"}
    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    try:
        max_tokens = int(event.payload.get("max_tokens") or 700)
    except (TypeError, ValueError):
        max_tokens = 700
    response_format = {"type": "json_object"} if event.payload.get("json") else None
    res = gonka_chat(messages, role="chat", max_tokens=max_tokens, temperature=0.4, response_format=response_format)
    return {
        **base,
        "ok": bool(res.ok),
        "llm": {"status": res.status, "model": res.model, "latency_ms": res.latency_ms},
        "llm_text": res.text,
        "error": None if res.ok else res.error,
    }


def _handle_heart(event: Event) -> dict[str, Any]:
    """Сердце MAX — снимок слоя привязанности; опционально запоминает важное.
    payload: {remember?: str, bond?: str, creator?: str} — всё необязательно."""
    base = {"route": "heart", "memory": {}, "plasticity": {}, "confidence": 1.0, "next_adaptation": "heart"}
    try:
        from mark17 import heart as _heart
    except Exception as exc:  # noqa: BLE001
        return {**base, "ok": False, "error": str(exc)}
    remember = str(event.payload.get("remember") or "").strip()
    bond = str(event.payload.get("bond") or "").strip()
    creator = str(event.payload.get("creator") or "").strip()
    if remember:
        _heart.remember(remember)
    if bond:
        _heart.note_bond(bond)
    if creator:
        _heart.note_creator(creator)
    return {**base, "ok": True, "heart": _heart.snapshot()}


_AX_STOP = {
    "это", "что", "как", "для", "при", "под", "над", "без", "про", "его", "так",
    "the", "and", "for", "with", "this", "that", "сделай", "напиши", "покажи",
    "пожалуйста", "можешь", "мне", "нужно", "надо",
}


def _simple_concepts(text: str, limit: int = 6) -> list[str]:
    """Лёгкое извлечение концептов из текста задачи (без LLM): значимые слова."""
    out: list[str] = []
    seen: set[str] = set()
    for tok in re.split(r"[^\wа-яёА-ЯЁ]+", str(text or "").lower()):
        if len(tok) < 4 or tok in _AX_STOP or tok in seen:
            continue
        seen.add(tok)
        out.append(tok)
        if len(out) >= limit:
            break
    return out


def _handle_agent_experience(event: Event, state_dir: Path, stores: "Mark17Stores") -> dict[str, Any]:
    """№4 — агент→граф: успех агента пишется как ЗАРАБОТАННЫЙ (validated) синапс.
    Один писатель (демон) → без гонок. Концепты задачи усиливаются исходом."""
    base = {"route": "agent_experience", "memory": {}, "plasticity": {}, "confidence": 1.0, "next_adaptation": "agent_experience"}
    agent = str(event.payload.get("agent") or "code")
    text = _event_text(event)
    ok = bool(event.payload.get("ok", True))
    try:
        score = float(event.payload.get("score") or (0.9 if ok else 0.18))
    except (TypeError, ValueError):
        score = 0.9 if ok else 0.18
    concepts = _simple_concepts(text)
    exp = stores.synapse_graph.agent_experience_to_graph(
        agent=agent, request_text=text, concepts=concepts, ok=ok, score=score,
    )
    validated = stores.synapse_graph.validated_count()
    total = stores.synapse_graph.count()
    try:
        from mark17 import growth_log as _gl
        _gl.record_event(state_dir, {"kind": "agent_experience", "agent": agent, "ok": ok, "written": exp["written"], "validated": validated})
    except Exception:  # noqa: BLE001
        pass
    return {**base, "ok": True, "agent_experience": {**exp, "agent": agent, "concepts": concepts, "validated_synapses": validated, "total_synapses": total}}


def _handle_missions(event: Event) -> dict[str, Any]:
    """Трекер миссий — живая доска целей. action: list|add|update|complete|focus|remove."""
    base = {"route": "missions", "memory": {}, "plasticity": {}, "confidence": 1.0, "next_adaptation": "missions"}
    try:
        from mark17 import missions as _m
    except Exception as exc:  # noqa: BLE001
        return {**base, "ok": False, "error": str(exc)}
    p = event.payload
    action = str(p.get("action") or "list").lower()
    mid = str(p.get("id") or "")
    if action == "add":
        snap = _m.add(str(p.get("title") or ""), str(p.get("why") or ""), str(p.get("next_step") or ""))
    elif action == "update":
        fields = {k: p[k] for k in ("title", "why", "next_step", "status", "progress", "note") if k in p}
        snap = _m.update(mid, **fields)
    elif action == "complete":
        snap = _m.complete(mid)
    elif action == "focus":
        snap = _m.set_active(mid)
    elif action == "remove":
        snap = _m.remove(mid)
    else:
        snap = _m.snapshot()
    return {**base, "ok": True, "missions": snap}


def _handle_reality(event: Event, brain: Mark17Brain, synapse_graph: SynapseGraph) -> dict[str, Any]:
    """Реальность-гейт: записать событие и вернуть честное соотношение блоков к перебору.

    Без `kind` — просто читаем сводку, ничего не записывая.
    """
    kind = str(event.payload.get("kind") or "")
    recorded = None
    if kind:
        recorded = reality_ledger.record(
            kind,
            note=str(event.payload.get("note") or ""),
            amount=float(event.payload.get("amount") or 0),
            source=str(event.source or "game"),
        )

    stats = reality_ledger.stats()
    verdict = reality_ledger.verdict(stats)
    is_block = bool(recorded and recorded.get("block"))

    self_eval = {
        # Подкрепляем ТОЛЬКО блоки. Перебор веса не даёт — в этом весь смысл:
        # иначе граф снова начнёт награждать стройку ради стройки.
        "score": 0.95 if is_block else 0.15,
        "reason": verdict,
        "store_memory": is_block,
        "reinforce": f"reality:{kind}" if is_block else "",
    }
    result: dict[str, Any] = {
        "ok": True,
        "event_type": event.type,
        "route": "reality",
        "reality": {"ok": True, "recorded": recorded, "verdict": verdict, **stats},
        "memory": {"hint": verdict},
        "plasticity": {"confidence": 0.9 if is_block else 0.3,
                       "action": "reality", "learned": is_block},
        "llm": {"status": "skipped", "text": "reality gate is deterministic", "latency_ms": 0.0},
        "next_adaptation": verdict,
        "self_evaluation": self_eval,
    }
    result["synapses"] = synapse_graph.update_from_event(event, result, self_eval)
    if is_block:
        brain.memory.remember(
            Event(type="remember",
                  payload={"note": f"{kind}: {recorded.get('note', '')}", "reinforce": "reality"},
                  source="reality"),
            hint=verdict, action="reality",
        )
    brain.plasticity.save()
    return result


def _handle_compress_similar(event: Event, brain: Mark17Brain, synapse_graph: SynapseGraph) -> dict[str, Any]:
    """Свернуть похожие записи в одну с весом. Без items берём память ядра."""
    items = event.payload.get("items")
    items = [str(x) for x in items] if isinstance(items, list) else []
    source = "переданные записи"
    if not items:
        source = "память ядра"
        try:
            for hit in brain.memory.recent(limit=200):
                content = hit.content if isinstance(hit.content, dict) else {}
                text = str(content.get("hint") or content.get("note") or hit.signature or "")
                if text:
                    items.append(text)
        except Exception:
            pass

    threshold = event.payload.get("threshold")
    kwargs = {"threshold": float(threshold)} if threshold else {}
    report = compress_similar([{"text": t} for t in items], **kwargs)
    report["source"] = source

    self_eval = {"score": 0.75, "reason": report["verdict"],
                 "store_memory": report["merged_groups"] > 0, "reinforce": "compress"}
    result: dict[str, Any] = {
        "ok": True, "event_type": event.type, "route": "compress_similar",
        "compression": report,
        "memory": {"hint": report["verdict"]},
        "plasticity": {"confidence": 0.8, "action": "compress",
                       "learned": report["merged_groups"] > 0},
        "llm": {"status": "skipped", "text": "compression is deterministic", "latency_ms": 0.0},
        "next_adaptation": report["verdict"],
        "self_evaluation": self_eval,
    }
    result["synapses"] = synapse_graph.update_from_event(event, result, self_eval)
    brain.plasticity.save()
    return result


def _handle_big_idea(event: Event, brain: Mark17Brain, synapse_graph: SynapseGraph) -> dict[str, Any]:
    """Воронка: Big Idea через ядро (LLM моста или детерминированный фолбэк)."""
    seed = {k: str(event.payload.get(k) or "") for k in ("domain", "audience", "trend", "twist")}
    idea = generate_big_idea(seed, brain.llm)
    llm_ok = idea["source"].startswith("llm")
    self_eval = {"score": 0.8, "reason": f"big idea via {idea['source']}",
                 "store_memory": True, "reinforce": "big_idea"}
    result: dict[str, Any] = {
        "ok": True, "event_type": event.type, "route": "big_idea", "big_idea": idea,
        "memory": {"hint": idea["idea"].get("tagline", "")},
        "plasticity": {"confidence": 0.9 if llm_ok else 0.6, "action": "big_idea", "learned": True},
        "llm": {"status": "ok" if llm_ok else "skipped", "text": f"source={idea['source']}", "latency_ms": 0.0},
        "next_adaptation": idea["idea"].get("firstStep", ""),
        "self_evaluation": self_eval,
    }
    result["synapses"] = synapse_graph.update_from_event(event, result, self_eval)
    brain.memory.remember(
        Event(type="remember", payload={"note": idea["idea"].get("tagline", ""), "seed": seed,
                                        "reinforce": "big_idea"}, source="funnel"),
        hint=idea["idea"].get("tagline", ""), action="big_idea",
    )
    brain.plasticity.save()
    return result


def _handle_simulation(event: Event, brain: Mark17Brain, synapse_graph: SynapseGraph) -> dict[str, Any]:
    """Симуляция Макса: промпт → параметры 3D-мира частиц."""
    prompt = str(event.payload.get("prompt") or "")
    sim = generate_dream_sim(prompt, brain.llm)
    llm_ok = sim["source"].startswith("llm")
    self_eval = {"score": 0.75, "reason": f"simulation via {sim['source']}",
                 "store_memory": bool(prompt), "reinforce": "simulation"}
    result: dict[str, Any] = {
        "ok": True, "event_type": event.type, "route": "simulation", "sim": sim,
        "memory": {"hint": sim.get("thought", "")},
        "plasticity": {"confidence": 0.85 if llm_ok else 0.6, "action": "simulation", "learned": True},
        "llm": {"status": "ok" if llm_ok else "skipped", "text": f"source={sim['source']}", "latency_ms": 0.0},
        "next_adaptation": sim.get("thought", ""),
        "self_evaluation": self_eval,
    }
    result["synapses"] = synapse_graph.update_from_event(event, result, self_eval)
    if prompt:
        brain.memory.remember(
            Event(type="remember", payload={"note": prompt, "reinforce": "simulation"}, source="simulation"),
            hint=sim.get("thought", ""), action="simulation",
        )
    brain.plasticity.save()
    return result


def _handle_decode(event: Event, brain: Mark17Brain, synapse_graph: SynapseGraph) -> dict[str, Any]:
    """ДЕКОДЕР: параметры визуальной сессии взлома хэшей."""
    target = str(event.payload.get("target") or "")
    decode = generate_decode(target, brain.llm)
    llm_ok = decode["source"].startswith("llm")
    self_eval = {"score": 0.72, "reason": f"decode session via {decode['source']}",
                 "store_memory": bool(target), "reinforce": "decode"}
    result: dict[str, Any] = {
        "ok": True, "event_type": event.type, "route": "decode", "decode": decode,
        "memory": {"hint": decode.get("thought", "")},
        "plasticity": {"confidence": 0.8 if llm_ok else 0.6, "action": "decode", "learned": True},
        "llm": {"status": "ok" if llm_ok else "skipped", "text": f"source={decode['source']}", "latency_ms": 0.0},
        "next_adaptation": decode.get("thought", ""),
        "self_evaluation": self_eval,
    }
    result["synapses"] = synapse_graph.update_from_event(event, result, self_eval)
    if target:
        brain.memory.remember(
            Event(type="remember", payload={"note": f"decode: {target}", "reinforce": "decode"}, source="decoder"),
            hint=decode.get("thought", ""), action="decode",
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
    llm_ok = ingest["source"].startswith("llm")
    for entry in ingest["kept"]:
        brain.memory.remember(
            Event(type="remember",
                  payload={"note": entry["text"], "interest": interest,
                           "score": entry["score"], "reinforce": "ingest"},
                  source="inbox"),
            hint=entry["text"][:80], action="ingest",
        )
    self_eval = {"score": 0.7,
                 "reason": f"ingest kept {ingest['kept_count']}/{ingest['total']} via {ingest['source']}",
                 "store_memory": ingest["kept_count"] > 0, "reinforce": "ingest"}
    result: dict[str, Any] = {
        "ok": True, "event_type": event.type, "route": "ingest", "ingest": ingest,
        "memory": {"hint": f"важного: {ingest['kept_count']} из {ingest['total']}"},
        "plasticity": {"confidence": 0.85 if llm_ok else 0.6, "action": "ingest",
                       "learned": ingest["kept_count"] > 0},
        "llm": {"status": "ok" if llm_ok else "skipped", "text": f"source={ingest['source']}", "latency_ms": 0.0},
        "next_adaptation": f"В память ушло {ingest['kept_count']} важных фрагментов.",
        "self_evaluation": self_eval,
    }
    result["synapses"] = synapse_graph.update_from_event(event, result, self_eval)
    brain.plasticity.save()
    return result


def _handle_cluster(event: Event) -> dict[str, Any]:
    """MAX GOD кластер: статус воркера / настройка адреса / диспатч задания на воркер."""
    base = {"route": "cluster", "memory": {}, "plasticity": {}, "confidence": 1.0, "next_adaptation": "cluster"}
    try:
        from mark17 import cluster as _c
    except Exception as exc:  # noqa: BLE001
        return {**base, "ok": False, "error": str(exc)}
    p = event.payload
    action = str(p.get("action") or "status").lower()
    if action == "set_worker":
        _c.set_worker(str(p.get("url") or ""))
        return {**base, "ok": True, "cluster": _c.status()}
    if action == "dispatch":
        inner = p.get("event")
        if not isinstance(inner, dict):
            return {**base, "ok": False, "error": "нет event для диспатча"}
        res = _c.dispatch(inner)
        return {**base, "ok": bool(res.get("ok")), "cluster": {**_c.status(), "result": res}}
    return {**base, "ok": True, "cluster": _c.status()}


def _handle_chrono_day(event: Event) -> dict[str, Any]:
    """ChronoSync «Фаза дня»: 3 действия из миссий + фокус + стоп через призму фазы месяца."""
    base = {"route": "chrono", "memory": {}, "plasticity": {}, "confidence": 1.0, "next_adaptation": "chrono"}
    try:
        from mark17 import chrono as _ch
    except Exception as exc:  # noqa: BLE001
        return {**base, "ok": False, "error": str(exc)}
    return {**base, "ok": True, "chrono": _ch.phase_of_day(event.payload)}


def _handle_health(event: Event) -> dict[str, Any]:
    """Доктор: свип здоровья GAME+MAX / безопасный авто-фикс. action: sweep|fix."""
    base = {"route": "health", "memory": {}, "plasticity": {}, "confidence": 1.0, "next_adaptation": "health"}
    try:
        from mark17 import doctor as _d
    except Exception as exc:  # noqa: BLE001
        return {**base, "ok": False, "error": str(exc)}
    p = event.payload
    action = str(p.get("action") or "sweep").lower()
    if action == "fix":
        res = _d.apply_fix(str(p.get("fix_action") or ""))
        report = _d.health_sweep(p)
        report["fix"] = res
        return {**base, "ok": bool(res.get("ok")), "health": report}
    return {**base, "ok": True, "health": _d.health_sweep(p)}


def _handle_cache_stats(event: Event) -> dict[str, Any]:
    """Fast-path LLM cache: hit-rate мониторинг. payload {clear?: bool}."""
    base = {"route": "cache_stats", "memory": {}, "plasticity": {}, "confidence": 1.0, "next_adaptation": "cache_stats"}
    try:
        from mark17 import gonka_bridge as _gb

        if event.payload.get("clear"):
            _gb.cache_clear()
        return {**base, "ok": True, "cache": _gb.cache_stats()}
    except Exception as exc:  # noqa: BLE001
        return {**base, "ok": False, "error": str(exc)}


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


def _apply_voice_reasoning(
    result: dict[str, Any],
    event: Event,
    brain: Mark17Brain,
    vector_memory: VectorMemory,
    synapse_graph: SynapseGraph,
    working_memory: WorkingMemory,
) -> None:
    """Sound → state: decompose the HUD's voice summary into a user-state reading,
    remember it (so Phase 5 bridges link it to what was said/seen) and persist the
    trend. Mirrors _apply_environment_reasoning for the audio modality."""
    observation = event.payload.get("voice")
    observation = observation if isinstance(observation, dict) else {}
    history = working_memory.get_voice_history()
    voice = analyze_voice(observation, history)
    result["voice"] = voice

    # Persist this reading so the next observation can reason about the trend.
    working_memory.push_voice_observation(
        {"state": voice.get("state"), "arousal": voice.get("arousal"), "trend": voice.get("trend")}
    )

    conclusions = voice.get("conclusions")
    conclusion_text = ""
    if isinstance(conclusions, list) and conclusions:
        conclusion_text = "; ".join(str(c) for c in conclusions[:2])

    if conclusion_text:
        confidence = float(voice.get("confidence") or 0.4)
        voice_event = Event(
            type="voice_observation",
            payload={
                "note": conclusion_text,
                "state": voice.get("state"),
                "text": str(event.payload.get("text") or "")[:140],
            },
            source="voice",
        )
        brain.memory.remember(voice_event, hint=conclusion_text, action="voice_reasoning")
        vector_memory.remember(
            voice_event,
            {"score": confidence, "reason": conclusion_text, "store_memory": True, "reinforce": "voice_state"},
        )

    for assoc in voice.get("associations", []):
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
            metadata={"origin": "voice_observation", "state": voice.get("state")},
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

    heart_signal = event.payload.get("heart_signal")
    if not isinstance(heart_signal, dict):
        try:
            from mark17 import heart as _heart

            heart_signal = _heart.signal()
        except Exception:  # noqa: BLE001
            heart_signal = None

    theme = str(event.payload.get("theme") or "").strip().lower() or None
    dream = generate_synergies(
        recent_patterns,
        top_synapses,
        concepts,
        limit=limit,
        heart_signal=heart_signal if isinstance(heart_signal, dict) else None,
        theme=theme,
    )
    persist_raw = event.payload.get("persist", True)
    persist = not (
        persist_raw is False
        or persist_raw == 0
        or str(persist_raw).strip().lower() in {"0", "false", "no", "off"}
    )
    blocked = bool(dream.get("blocked"))

    stored = 0
    for synergy in dream.get("synergies", []):
        if not isinstance(synergy, dict):
            continue
        if blocked or not persist:
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
                "heart_signal_id": (heart_signal or {}).get("signal_id") if isinstance(heart_signal, dict) else "",
                "heart_guided": bool(synergy.get("heart_guided")),
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
                metadata={
                    "origin": "internal_dream",
                    "title": title,
                    "heart_guided": bool(synergy.get("heart_guided")),
                    "heart_signal_id": (heart_signal or {}).get("signal_id") if isinstance(heart_signal, dict) else "",
                },
            )
        stored += 1

    brain.plasticity.save()

    top_title = ""
    synergies = dream.get("synergies")
    if isinstance(synergies, list) and synergies and isinstance(synergies[0], dict):
        top_title = str(synergies[0].get("title") or "")
    if blocked:
        answer_text = (
            "Сон остановлен сердцем: сейчас важнее безопасность, отдых и живой контакт, "
            "а не генерация новых связей."
        )
    elif not persist:
        answer_text = (
            f"Во внутреннем сне я предложил {len(synergies) if isinstance(synergies, list) else 0} синергий без записи в память. "
            + (f"Сильнее всего проявилась: {top_title}. " if top_title else "")
            + "Это режим черновика: можно посмотреть Explain и решить, что проверять."
        )
    else:
        answer_text = (
            f"Во внутреннем сне я собрал {stored} синергий из уже знакомых связей. "
            + (f"Сильнее всего проявилась: {top_title}. " if top_title else "")
            + "Это гипотезы — их стоит проверить маленьким реальным действием."
        )
    confidence = 0.0 if blocked else (0.35 if not persist else 0.6)
    learned = bool((not blocked) and persist)

    return {
        "ok": True,
        "event_type": event.type,
        "route": "internal_dream",
        "memory": {
            "dream_synergies_stored": stored,
            "dream_synergies_proposed": len(synergies) if isinstance(synergies, list) else 0,
            "persisted": persist and not blocked,
        },
        "plasticity": {"confidence": confidence, "action": "dream", "learned": learned},
        "llm": {"status": "skipped", "text": "LLM отключён для внутреннего сна.", "latency_ms": 0.0},
        "confidence": confidence,
        "next_adaptation": (
            "Остановить творческий сон и перейти к заботе/восстановлению."
            if blocked
            else (
                "Рассмотреть предложения сна без записи и выбрать маленькую проверку."
                if not persist
                else "Связать новые синергии с реальными задачами и проверить на практике."
            )
        ),
        "dream": dream,
        "dream_persistence": "blocked" if blocked else ("stored" if persist else "proposal_only"),
        "heart_influence": dream.get("heart_influence"),
        "explain": dream.get("explain"),
        "answer": {"text": answer_text, "source": "dreamer", "confidence": confidence},
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
    blocked = 0
    for fact in facts[:12]:
        if not isinstance(fact, dict):
            continue
        claim = str(fact.get("claim") or "").strip()
        if not claim:
            continue
        # Ангел безопасности: войну/политику/пороки из веба — не в ядро MAX.
        if not _guard_clean(claim):
            blocked += 1
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

    if blocked:
        _guard_record(blocked)
    return {
        "stored_facts": len(stored_memory_ids),
        "stored_memory_ids": stored_memory_ids[:8],
        "guardian_blocked": blocked,
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


def _handle_research_inline(event: Event, args: argparse.Namespace, stores: Mark17Stores) -> dict[str, Any]:
    """Чат-ресёрч по запросу: веб → Ангел → граф → curiosity (автопетля) →
    естественный ответ Gonka из свежих фактов. Так «найди X» реально исследует."""
    query = _event_text(event)
    # Чистим тему от командных слов → ищем суть («кремний»), а не всю фразу.
    topic = re.sub(
        r"(?iu)\b(найди|найти|поищи|погугли|загугли|нагугли|разузнай|разведай|исследуй|"
        r"исследовать|ресёрч|ресерч|research|узнай|что\s+такое|сделай|свой)\b",
        " ",
        query,
    )
    topic = re.sub(r"\s+", " ", topic).strip(" -—:,.«»\"") or query
    research = web_research(
        query=topic,
        source_memory=stores.source_memory,
        allow_network=_web_enabled(args),
        limit=4,
    )
    stored = _remember_web_facts(
        event=Event(type="web_fact", payload={"query": topic}, source="research"),
        research=research,
        brain=stores.brain,
        vector_memory=stores.vector_memory,
        synapse_graph=stores.synapse_graph,
    )
    # Автопетля: тему в очередь — в простое MAX дозабьёт её глубже сам.
    try:
        stores.curiosity.record_gap(topic, source="user")
    except Exception:
        pass
    facts = research.get("facts") if isinstance(research.get("facts"), list) else []
    fact_scores = [
        float(f.get("confidence") or 0.0)
        for f in facts
        if isinstance(f, dict) and isinstance(f.get("confidence"), (int, float))
    ]
    confidence = round(sum(fact_scores) / len(fact_scores), 4) if fact_scores else 0.4
    n_facts = int(stored.get("stored_facts") or 0)
    blocked = int(stored.get("guardian_blocked") or 0)
    note = f"Исследовал «{topic[:60]}»: +{n_facts} фактов в память" + (f", Ангел отсёк {blocked}" if blocked else "") + "."
    result: dict[str, Any] = {
        "ok": True,
        "event_type": "user_message",
        "route": "research",
        "memory": {"recalled": [], "semantic": []},
        "plasticity": {"confidence": confidence, "action": "research", "learned": n_facts > 0},
        "llm": {"status": "pending", "text": "", "latency_ms": 0.0},
        "confidence": confidence,
        "next_adaptation": note,
        "self_evaluation": {"score": confidence, "reason": f"inline research {n_facts} facts", "store_memory": False, "reinforce": "research"},
        "web": {**research, "stored_facts": n_facts},
        "synapses": stored.get("synapses", {}),
        "research": {"query": topic, "stored_facts": n_facts, "guardian_blocked": blocked, "status": research.get("status")},
    }
    draft = compose_answer(event, result, result["self_evaluation"])
    if draft:
        result["answer"] = draft
    # Gonka формулирует ответ из свежих фактов (если включена).
    _synthesize_natural_answer(result, event, stores.working_memory)
    try:
        stores.skills.record("research", success=0.9 if n_facts else 0.5)
    except Exception:
        pass
    stores.brain.plasticity.save()
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
        else "Открываю Режим 777 — сочиняю трек с нуля и запускаю. Слушай и смотри визуал."
        if route == "music"
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


VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"}


def _handle_see(event: Event, stores: Mark17Stores) -> dict[str, Any]:
    """MAX VISION: посмотреть фото или видео и запомнить увиденное.

    Зрение здесь — способность ядра, а не сенсор HUD: увиденное ложится в
    память и в синапс-граф наравне с прочитанным и услышанным, иначе кадр
    исчезает сразу после того, как его описали.

    payload: path (файл), mode ('auto'|'photo'|'video'|'corners'),
             depth ('auto'|'quick'|'full'), eye ('auto'|'local'|'cloud'),
             branches (bool — развернуть ветки того, что могло бы дальше).
    """
    from pathlib import Path as _Path

    from mark17 import vision_core as vision

    raw_path = str(event.payload.get("path") or event.payload.get("text") or "").strip()
    if not raw_path:
        return {"ok": False, "route": "see", "error": "нечего смотреть: нет path"}
    path = _Path(raw_path).expanduser()
    # Смотреть можно только на то, что лежит в песочнице ядра. Роут /api/max17
    # открыт без авторизации, и без этой проверки любой прохожий мог заставить
    # сервер открыть и вслух описать произвольный файл — хоть .env.local.
    # Роут /api/max17 кладёт присланный кадр во временный каталог процесса и
    # передаёт сюда путь — без него зрение видит только собственную песочницу и
    # отказывает всему, что прислал человек.
    import tempfile as _tempfile

    allowed_roots = [_Path(stores.state_dir).resolve(), _Path(_tempfile.gettempdir()).resolve()]
    extra_root = os.environ.get("MAX17_UPLOADS_ROOT")
    if extra_root:
        allowed_roots.append(_Path(extra_root).expanduser().resolve())
    try:
        resolved = path.resolve()
        inside = any(resolved == root or root in resolved.parents for root in allowed_roots)
    except (OSError, RuntimeError):
        inside = False
    if not inside:
        return {"ok": False, "route": "see", "error": "смотреть можно только на файлы ядра"}
    path = resolved
    if not path.exists():
        return {"ok": False, "route": "see", "error": f"файл не найден: {path}"}

    mode = str(event.payload.get("mode") or "auto").lower()
    if mode == "auto":
        mode = "video" if path.suffix.lower() in VIDEO_SUFFIXES else "photo"
    eye = str(event.payload.get("eye") or "auto").lower()
    depth = str(event.payload.get("depth") or "auto").lower()

    # Сначала — свой счёт по пикселям. Он не требует ни модели, ни сети, идёт
    # доли секунды и работает даже там, где нейро-глаз невозможен в принципе
    # (на дроплете двести мегабайт памяти). Это база зрения, а не запасной путь.
    pixels: dict[str, Any] = {}
    if mode != "video":
        try:
            from mark17 import vision_pixels

            pixels = vision_pixels.measure(path)
        except Exception as exc:  # noqa: BLE001 - без numpy/Pillow остаётся нейро-слой
            pixels = {"error": str(exc)}

    # Нейро-слой — усиление сверху: он называет смысл («логотип», «человек у
    # окна»), которого в числах нет. Если глаз нет, зрение всё равно состоится.
    seen: dict[str, Any] = {}
    neuro_error = ""

    # Кто смотрит. Своя модель зрения весит 3.2 ГБ и живёт в памяти МАКА: один
    # взгляд отнимает у человека две трети оперативки, грузится дольше минуты и
    # при этом додумывает (на трёхцветной картинке «увидела» текст). Рука
    # смотрит точнее, мгновенно и не занимает ни байта чужой памяти — поэтому
    # при свободной руке кадр уходит ей, а числа пиксельного разбора человек
    # получает сразу, не дожидаясь ничьего взгляда.
    handoff = None
    hand_free = False
    try:
        from mark17 import hands as hands_channel

        hand_free = bool(hands_channel.stats(stores.state_dir).get("free"))
    except Exception:  # noqa: BLE001
        hand_free = False

    if hand_free and mode != "video":
        site = (os.environ.get("GAME_PUBLIC_URL") or "https://mir.care").rstrip("/")
        try:
            handoff = hands_channel.request(
                f"посмотри на кадр {site}/api/media/{path.name} и опиши подробно: "
                f"что на нём, есть ли текст, что важно",
                "человек прислал кадр — нужен внимательный взгляд",
                stores.state_dir,
            )
        except Exception:  # noqa: BLE001
            handoff = None

    try:
        if handoff and handoff.get("ok"):
            seen = {"summary": "", "handed": True}   # свои глаза не будим: смотрит рука
        elif mode == "video":
            seen = vision.perceive_video(path, count=int(event.payload.get("frames") or 4), prefer=eye)
        elif mode == "corners":
            seen = vision.perceive_corners(path, prefer=eye)
        else:
            seen = vision.perceive(path, depth=depth, prefer=eye)
    except Exception as exc:  # noqa: BLE001 - слепота не должна ронять ядро
        neuro_error = str(exc)

    neuro_text = str(seen.get("text") or "").strip()
    pixel_text = str(pixels.get("text") or "").strip()

    # Ядро складывает из измерений картину. Само по себе «палитра: чёрный 96%,
    # контраст 0.108» — показания прибора, а не зрение; понимание начинается,
    # когда из чисел собирается связное представление о кадре. Модель здесь
    # текстовая (зрячей на сервере нет и не будет), поэтому ей запрещено
    # называть то, чего в измерениях не содержится: «кот» из гистограммы не
    # выводится, а «тёмный интерфейс с текстом в верхней трети» — выводится.
    imagined = ""
    if pixels and not pixels.get("error") and gonka_is_enabled("chat"):
        try:
            facts = json.dumps(
                {k: v for k, v in pixels.items() if k != "text"}, ensure_ascii=False
            )[:2500]
            res = gonka_chat(
                [
                    {
                        "role": "system",
                        "content": (
                            "Ты MAX. Ты не смотришь на изображение глазами — у тебя есть точные "
                            "измерения его пикселей. Собери из них представление о кадре: что это "
                            "за изображение, как оно устроено, где что расположено, каким оно "
                            "выглядит. Пиши живо, 2–4 предложения, по-русски, от первого лица.\n\n"
                            "ЗАПРЕЩЕНО называть конкретные объекты, людей, животных, места и "
                            "надписи: измерения этого не содержат, и любая такая догадка будет "
                            "выдумкой. Говори о том, что следует из чисел: тип изображения, свет, "
                            "палитра, композиция, плотность деталей, текст как факт наличия строк. "
                            "Где данных не хватает — так и скажи, это честнее домысла."
                        ),
                    },
                    {"role": "user", "content": f"Измерения кадра:\n{facts}"},
                ],
                role="chat",
                max_tokens=320,
                temperature=0.5,
            )
            imagined = (res.text or "").strip()
        except Exception:  # noqa: BLE001 - без синтеза остаются сами измерения
            imagined = ""

    blocks = [b for b in (neuro_text, imagined) if b]
    if pixel_text:
        blocks.append(f"Замеры: {pixel_text}")
    # Кадр ушёл руке: человек получает числа сразу и знает, что подробный взгляд
    # придёт следом. Молчать здесь нельзя — пустой ответ читается как поломка.
    if seen.get("handed"):
        blocks.insert(0, "Кадр вижу, смотрю внимательно — опишу отдельным сообщением.")
    text = "\n\n".join(blocks)
    if not text:
        return {
            "ok": False,
            "route": "see",
            "error": f"ничего не разглядел: {neuro_error or 'нет ни пиксельного разбора, ни глаз'}",
            "vision": seen,
        }

    # Увиденное — такое же воспоминание, как услышанное. Пишем и в эпизодическую
    # память, и в векторную: первое даёт «когда», второе — «на что похоже».
    note = text[:600]
    seen_event = Event(type="see", payload={"note": note, "source": str(path), "mode": mode}, source="vision")
    evaluation = {"score": 0.75, "reason": f"увидел: {path.name}", "store_memory": True, "reinforce": "vision"}
    try:
        stores.brain.memory.remember(seen_event, hint=note[:200], action="seeing")
        stores.vector_memory.remember(seen_event, evaluation)
    except Exception:  # noqa: BLE001 - память лучше пропустить, чем потерять взгляд
        pass

    # Синапс «этот файл ↔ что в нём было»: чтобы через неделю MAX нашёл кадр
    # по смыслу, а не по имени файла.
    try:
        stores.synapse_graph.upsert_synapse(
            source_type="media",
            source_id=path.name,
            target_type="sight",
            target_id=note[:80],
            relation_type="seen_as",
            weight=0.7,
        )
    except Exception:  # noqa: BLE001
        pass

    # Второй взгляд рукой. Свои глаза на маке съедают 5.6 ГБ из восьми и всё
    # равно додумывают: на трёхцветной картинке qwen2.5vl «увидела» текст,
    # которого нет. Рука смотрит точнее и не занимает ни байта памяти человека —
    # поэтому её зовут, когда своими глазами вышло скудно или не вышло вовсе.
    # Ответ придёт следом, отдельным сообщением: взгляд руки асинхронен.
    handoff = None
    if len(str(text or "").strip()) < 120 or neuro_error:
        try:
            from mark17 import hands as hands_channel

            site = (os.environ.get("GAME_PUBLIC_URL") or "https://mir.care").rstrip("/")
            handoff = hands_channel.request(
                f"посмотри на кадр {site}/api/media/{path.name} и опиши подробно: "
                f"что на нём, есть ли текст, что важно",
                "свои глаза разглядели мало" if not neuro_error else f"свои глаза не сработали: {neuro_error}",
                stores.state_dir,
            )
        except Exception:  # noqa: BLE001 - рука не должна ронять взгляд
            handoff = None

    result: dict[str, Any] = {
        "ok": True,
        "route": "see",
        "handoff": handoff,
        "vision": {**seen, "pixels": pixels, **({"neuro_error": neuro_error} if neuro_error else {})},
        "answer": {"text": text, "source": "vision", "confidence": 0.75},
        "memory": {"stored": True},
        "next_adaptation": "Увиденное записано в память ядра.",
        "self_evaluation": {**evaluation, "store_memory": True},
    }

    # Кадр как состояние вселенной. Мир ядра ждёт перепись из одиннадцати
    # чисел, и у каждого есть измеряемый прообраз, так что увиденное входит в
    # физику напрямую, без единого слова по дороге.
    #
    # Движение считается против ПРОШЛОГО увиденного кадра: его уменьшенная
    # копия лежит в состоянии ядра. Иначе рождений и смертей взяться неоткуда —
    # присланный файл живёт в temp-папке ровно один запрос, и сравнивать было
    # бы не с чем.
    if pixels and not pixels.get("error") and mode != "video":
        try:
            from mark17 import vision_pixels as _vp
            from mark17.world_model import WorldCensus, WorldModel

            last_frame = _Path(stores.state_dir) / "last_sight.jpg"
            if last_frame.exists():
                try:
                    pixels["движение"] = _vp.motion(_vp._load(last_frame), _vp._load(path))
                except Exception:  # noqa: BLE001 - прошлый кадр может быть битым
                    pass
            pixels["геометрия"] = _vp.geometry(_vp._load(path, side=384))

            census = _vp.as_census(pixels, dt=1.0)
            world = WorldModel(last_frame.parent)
            wid = world.ensure_world(seed=17, title="то, что видит MAX")["id"]
            observed = world.observe(wid, WorldCensus(**census), tension=0.3)
            result["world"] = {"census": census, **{k: observed[k] for k in ("laws",) if k in observed}}

            # Кадр сохраняем последним действием: следующий взгляд будет
            # сравнивать себя именно с ним.
            try:
                from PIL import Image

                img = Image.open(path).convert("RGB")
                img.thumbnail((256, 256))
                img.save(last_frame, format="JPEG", quality=80)
            except Exception:  # noqa: BLE001
                pass
        except Exception:  # noqa: BLE001 - физика необязательна, зрение важнее
            pass

    # Увиденное входит в ту же ленту наблюдений, что и камера: среда умеет
    # помнить недавние кадры и замечать переходы («стало темнее», «появилось
    # движение»), копя из них ассоциации в граф. До сих пор она питалась только
    # камерой HUD, и присланные фотографии проходили мимо этой памяти.
    if pixels and not pixels.get("error"):
        try:
            from mark17 import vision_pixels as _vp

            observation = _vp.as_observation(pixels)
            env = analyze_environment(observation, stores.working_memory.get_env_history(limit=8))
            stores.working_memory.push_env_observation(observation)
            result["environment"] = {
                k: env[k] for k in ("state", "transitions", "conclusions", "presence") if k in env
            }
            for assoc in env.get("associations") or []:
                if isinstance(assoc, dict) and assoc.get("from") and assoc.get("to"):
                    stores.synapse_graph.upsert_synapse(
                        source_type="concept",
                        source_id=str(assoc["from"]),
                        target_type="concept",
                        target_id=str(assoc["to"]),
                        relation_type=str(assoc.get("relation") or "related_to"),
                        weight=float(assoc.get("weight") or 0.5),
                    )
        except Exception:  # noqa: BLE001 - среда необязательна, зрение важнее
            pass

    # Зрительная память: подпись кадра из его же измерений. Сначала ищем, не
    # видели ли похожее — и только потом запоминаем, иначе кадр найдёт сам
    # себя и любое узнавание станет бессмысленным.
    if pixels and not pixels.get("error"):
        try:
            from mark17 import vision_pixels as _vp

            sight_vector = _vp.as_vector(pixels)
            seen_before = stores.vector_memory.similar_sights(sight_vector, limit=5)
            stores.vector_memory.remember_sight(
                path.name,
                sight_vector,
                label=str((pixels.get("что_это") or {}).get("тип") or ""),
                summary=note[:300],
            )
            if seen_before:
                result["recognized"] = seen_before
                # Порог 0.97 — по замеру: кадры одной сцены дают 0.99–1.00,
                # разные сцены не поднимаются выше 0.81. Между ними пусто,
                # поэтому «уже видел» говорится только при настоящем совпадении.
                close = [s for s in seen_before if s["близость"] >= 0.97]
                if close:
                    result["seen_before"] = close[0]
                    # Узнавание должно быть слышно, а не лежать в данных.
                    # И оно называет расстояние: MAX не «догадался», а измерил.
                    hit = close[0]
                    answer = result.get("answer")
                    if isinstance(answer, dict):
                        answer["text"] = (
                            f"Это я уже видел — «{hit['source']}», совпадение {hit['близость']}.\n\n"
                            + str(answer.get("text") or "")
                        )
        except Exception:  # noqa: BLE001 - память не должна ронять зрение
            pass


    # Ветки: увиденное — это состояние мира, из которого есть продолжения.
    # Считаем их только по просьбе: каждая ветка стоит отдельного запроса.
    if event.payload.get("branches"):
        try:
            from mark17 import dream_sim

            # dream_sim.generate ждёт не функцию, а объект с .enabled/.available/.ask
            # (см. dream_sim.py:143). Обычная функция молча проваливала проверку,
            # и ветки всегда оставались детерминированным хэшем от текста —
            # LLM не вызывался ни разу, хотя формально «был передан».
            class _Llm:
                enabled = True

                @property
                def available(self) -> bool:
                    return gonka_is_enabled("chat")

                def ask(self, prompt: str):
                    return gonka_chat(
                        [{"role": "user", "content": prompt}],
                        role="chat",
                        max_tokens=600,
                        temperature=0.7,
                    )

            result["branches"] = dream_sim.generate(
                "Вот что видно прямо сейчас:\n" + text + "\n\nРазверни, что могло бы произойти дальше.",
                _Llm(),
            )
        except Exception as exc:  # noqa: BLE001 - ветки необязательны
            result["branches_error"] = str(exc)

    return result


def _handle_music_observation(event: Event, stores: Mark17Stores) -> dict[str, Any]:
    """Phase 9: one listening window. Analyze → remember → grow taste history,
    so bridges link «что играло» with the moment, and Dreaming composes later."""
    observation = event.payload.get("music")
    observation = observation if isinstance(observation, dict) else {}
    history = stores.working_memory.get_music_history()
    music = analyze_music(observation, history)

    if music.get("mood") != "тишина":
        stores.working_memory.push_music_observation(
            {k: music[k] for k in ("mood", "kaif", "novelty", "verdict", "key", "features", "vector") if k in music}
        )
        conclusions = music.get("conclusions") or []
        if conclusions:
            music_event = Event(
                type="music_observation",
                payload={"note": str(conclusions[0]), "text": str(event.payload.get("text") or "")[:120]},
                source="music",
            )
            stores.brain.memory.remember(music_event, hint=str(conclusions[0]), action="music_listening")
            stores.vector_memory.remember(
                music_event,
                {"score": float(music.get("kaif") or 0.4), "reason": str(conclusions[0]), "store_memory": True, "reinforce": "music"},
            )
        for assoc in music.get("associations", []):
            if isinstance(assoc, dict) and assoc.get("from") and assoc.get("to"):
                stores.synapse_graph.upsert_synapse(
                    source_type="concept", source_id=str(assoc["from"]),
                    target_type="concept", target_id=str(assoc["to"]),
                    relation_type=str(assoc.get("relation") or "related_to"),
                    weight=float(assoc.get("weight") or 0.5),
                    metadata={"origin": "music_observation", "mood": music.get("mood")},
                )

    text = str(music.get("summary") or "Слушаю.")
    return {
        "ok": True,
        "event_type": event.type,
        "route": "music_sense",
        "memory": {},
        "plasticity": {"confidence": float(music.get("kaif") or 0.3), "action": "music_listening", "learned": music.get("mood") != "тишина"},
        "llm": {"status": "skipped", "text": "Музыкальный слух.", "latency_ms": 0.0},
        "next_adaptation": text,
        "self_evaluation": {
            "score": float(music.get("kaif") or 0.3),
            "reason": f"music: {music.get('mood')} kaif={music.get('kaif')}",
            "store_memory": False,
            "reinforce": "music",
        },
        "answer": {"text": text, "source": "music_sense", "confidence": float(music.get("kaif") or 0.3)},
        "music": music,
    }


def _handle_music_taste(stores: Mark17Stores) -> dict[str, Any]:
    """Phase 9: Max's aggregated taste — the seed Dreaming Music composes from."""
    taste = aggregate_taste(stores.working_memory.get_music_history())
    text = str(taste.get("summary") or "")
    return {
        "ok": True,
        "event_type": "music_taste",
        "route": "music_sense",
        "memory": {},
        "plasticity": {"confidence": 0.6, "action": "music_taste", "learned": False},
        "llm": {"status": "skipped", "text": "Музыкальный вкус.", "latency_ms": 0.0},
        "next_adaptation": text,
        "self_evaluation": {"score": 0.6, "reason": f"taste over {taste.get('tracks')} tracks", "store_memory": False, "reinforce": "music"},
        "answer": {"text": text, "source": "music_sense", "confidence": 0.6},
        "music_taste": taste,
    }


def _handle_introspect(stores: Mark17Stores) -> dict[str, Any]:
    """Phase 11: Max recomputes his OWN mood and reflects on how he feels."""
    state = SelfState(stores.state_dir).update(stores)
    text = str(state.get("reflection") or "Сейчас я ровно сосредоточен.")
    return {
        "ok": True,
        "event_type": "introspect",
        "route": "self_state",
        "memory": {},
        "plasticity": {"confidence": float(state.get("valence") or 0.5), "action": "introspect", "learned": False},
        "llm": {"status": "skipped", "text": "Саморефлексия.", "latency_ms": 0.0},
        "next_adaptation": text,
        "self_evaluation": {"score": float(state.get("valence") or 0.5), "reason": f"self-state: {state.get('feeling')}", "store_memory": False, "reinforce": "self_state"},
        "answer": {"text": text, "source": "self_state", "confidence": float(state.get("valence") or 0.5)},
        "self_state": state,
    }


def _handle_ingest_corpus(event: Event, stores: Mark17Stores) -> dict[str, Any]:
    """Phase 10: bulk a corpus (free text or a project file/folder) into the
    graph via the semantic compiler. The road to 1M synapses — your meaning."""
    compiler = SemanticCompiler(stores.state_dir)
    path = str(event.payload.get("path") or "").strip()
    text = str(event.payload.get("text") or "").strip()
    if path:
        report = ingest_path(
            path,
            compiler=compiler,
            vector_memory=stores.vector_memory,
            synapse_graph=stores.synapse_graph,
            max_files=80,
            max_chunks_per_file=12000,
        )
        label = f"путь «{report.get('root', path)}» ({report.get('files', 0)} файлов)"
    else:
        report = ingest_text(text, source="hud", compiler=compiler, vector_memory=stores.vector_memory, synapse_graph=stores.synapse_graph)
        label = f"{report.get('chunks', 0)} фрагментов"
    added = int(report.get("synapses_added") or 0)
    total = int(report.get("synapses_after") or stores.synapse_graph.count())
    growth_record(stores.state_dir, total)
    to_goal = max(0, 1_000_000 - total)
    if report.get("error"):
        text_out = f"Не смог проглотить: {report['error']}"
    else:
        text_out = (
            f"Проглотил {label}: +{added} синапсов "
            f"(скомпилировано {report.get('compiled', 0)}, из кеша {report.get('cached', 0)}). "
            f"Всего связей: {total:,}. До миллиона ещё {to_goal:,}."
        )
    return {
        "ok": True,
        "event_type": "ingest_corpus",
        "route": "corpus_ingest",
        "memory": {},
        "plasticity": {"confidence": 0.7, "action": "ingest", "learned": added > 0},
        "llm": {"status": "skipped", "text": "Bulk-ингест корпуса.", "latency_ms": 0.0},
        "next_adaptation": text_out,
        "self_evaluation": {"score": 0.7, "reason": f"ingest +{added} synapses", "store_memory": False, "reinforce": "ingest"},
        "answer": {"text": text_out, "source": "corpus_ingest", "confidence": 0.7},
        "ingest": report,
        "graph_total": total,
    }


def _handle_dream_mood(event: Event, stores: Mark17Stores) -> dict[str, Any]:
    """Phase 9.5: Max's current mood → composition spec for Dreaming Music.
    Mood = his learned taste, как звучит пользователь, недавний кайф, инсайт."""
    insight = bool(event.payload.get("insight"))
    taste = aggregate_taste(stores.working_memory.get_music_history())
    voice_hist = stores.working_memory.get_voice_history(limit=1)
    voice_state = str(voice_hist[-1].get("state") or "") if voice_hist else ""
    music_hist = stores.working_memory.get_music_history(limit=3)
    recent_kaif = (
        sum(float(m.get("kaif") or 0) for m in music_hist) / len(music_hist) if music_hist else None
    )
    mood = mood_music_spec(voice_state, taste, insight=insight, recent_kaif=recent_kaif)
    text = f"Сочиняю {mood['label']}: ~{mood['avg_bpm']} BPM, {mood['fav_key']} {mood['mode']}. {mood['reason']}."
    return {
        "ok": True,
        "event_type": "dream_mood",
        "route": "music_sense",
        "memory": {},
        "plasticity": {"confidence": 0.6, "action": "dream_mood", "learned": False},
        "llm": {"status": "skipped", "text": "Настроение для Dreaming Music.", "latency_ms": 0.0},
        "next_adaptation": text,
        "self_evaluation": {"score": 0.6, "reason": mood["reason"], "store_memory": False, "reinforce": "music"},
        "answer": {"text": text, "source": "music_sense", "confidence": 0.6},
        "dream_mood": mood,
        "music_taste": taste,
    }


CODE_BLOCK_RE = re.compile(r"```([a-zA-Z0-9_+-]*)\n(.+?)```", re.DOTALL)


def _show_panels(result: dict[str, Any]) -> None:
    """Показать сделанное окном, а не пересказывать его текстом.

    Пока распознаётся один, самый частый случай: MAX написал код. Блок уезжает
    в отдельную панель, а в самом ответе остаётся ссылка на неё — иначе длинная
    портянка кода забивает чат и её невозможно ни свернуть, ни отложить.
    Панель показывается только если код существенный: ради двух строк открывать
    окно навязчиво.
    """
    answer = result.get("answer")
    if not isinstance(answer, dict):
        return
    text = str(answer.get("text") or "")
    blocks = CODE_BLOCK_RE.findall(text)
    if not blocks:
        return

    panels = []
    for index, (lang, body) in enumerate(blocks[:3], start=1):
        code = body.strip()
        if code.count("\n") < 2:
            continue  # однострочник читается прямо в тексте
        panels.append(
            {
                "id": f"code{index}",
                "title": f"{(lang or 'код').strip()} · фрагмент {index}" if len(blocks) > 1 else (lang or "код").strip(),
                "kind": "code",
                "lang": (lang or "").strip(),
                "body": code[:40000],
            }
        )
    if not panels:
        return

    # Из текста ответа код убираем: он теперь в окне, и дублировать его незачем.
    stripped = CODE_BLOCK_RE.sub("(показал окном ↗)", text).strip()
    answer["text"] = stripped or text
    ui = result.get("ui")
    result["ui"] = {**(ui if isinstance(ui, dict) else {}), "panels": panels}


def _handle_concept_explain(event: Event, stores: Mark17Stores) -> dict[str, Any]:
    """Развернуть сжатый концепт обратно в живые следы.

    Обратная сторона сжатия: ярлык вроде «core» собран из сотен событий, и до
    сих пор посмотреть, ИЗ ЧЕГО он вырос, было нельзя. Теперь можно — и живое
    (слова человека, исходы, наблюдения) поднимается выше машинерии.
    """
    payload = event.payload if isinstance(event.payload, dict) else {}
    # CLI кладёт в payload весь верхний уровень события, а мост может прислать
    # вложенный объект — принимаем обе формы, иначе концепт молча теряется.
    inner = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
    concept = str(payload.get("concept") or inner.get("concept") or payload.get("text") or "").strip()
    try:
        limit = int(payload.get("limit") or inner.get("limit") or 6)
    except (TypeError, ValueError):
        limit = 6
    limit = max(1, min(limit, 20))
    if not concept:
        return {"ok": False, "error": "нужен concept", "event_type": event.type}

    from mark17 import decompress

    result = decompress.explain(stores.synapse_graph, stores.vector_memory, concept, limit=limit)
    traces = result.get("traces") or []
    if not traces:
        text = f"За «{concept}» пока ничего не стоит: концепт не найден или у него нет источников."
    else:
        head = f"«{concept}» собран из {result.get('total_sources')} источников"
        grounded = int(result.get("grounded_found") or 0)
        head += f" ({grounded} из них — живой опыт)" if grounded else " (пока только внутренняя машинерия)"
        lines = [f"— [{t['type']}] {t['text'][:160]}" for t in traces[:5]]
        text = head + ":\n" + "\n".join(lines)

    return {
        "ok": True,
        "event_type": event.type,
        "route": "concept_explain",
        "concept": result,
        "answer": {"text": text, "source": "decompress", "confidence": 0.7},
        "llm": {"status": "skipped", "text": text, "latency_ms": 0.0},
    }


def _handle_ultra_think(event: Event, args: argparse.Namespace, stores: Mark17Stores) -> dict[str, Any]:
    """Phase 8: the core's own agency. Snapshot self-state → ONE decision (LLM
    role=ultra, or the deterministic policy offline) → EXECUTE it from the safe
    action menu → record the decision so the next think sees it."""
    # Сначала забираем ответы руки: исход прошлого намерения должен попасть в
    # память ДО того, как ядро выберет следующее действие. Иначе круг
    # «намерение → действие → исход» не замыкается и MAX просит одно и то же.
    hands_seen: list[dict[str, Any]] = []
    try:
        from mark17 import hands as hands_channel

        for answer in hands_channel.collect(stores.state_dir):
            hands_seen.append(answer)
            stores.vector_memory.remember(
                Event(
                    type="outcome_success" if answer.get("ok") else "outcome_failure",
                    payload={"text": f"рука вернулась: {answer.get('summary') or ''}"},
                    source="hands",
                ),
                {
                    "score": 0.8 if answer.get("ok") else 0.45,
                    "reason": "исход действия в реальности",
                    "store_memory": True,
                    "reinforce": "hands",
                },
            )
    except Exception:  # noqa: BLE001 - рука не должна ронять такт мышления
        hands_seen = []

    state = ultra_gather_state(stores)
    if hands_seen:
        state["hands_answers"] = [
            {"ok": a.get("ok"), "summary": str(a.get("summary") or "")[:200]} for a in hands_seen[:3]
        ]
    decision = ultra_decide(state)
    action = decision["action"]

    executed: dict[str, Any] = {}
    try:
        if action == "hands":
            # Ядро не выполняет ничего само: оно формулирует намерение, а рука
            # (agent/night.mjs на маке) решает КАК, предупреждает человека и
            # отчитывается. Здесь — только заявка.
            from mark17 import hands as hands_channel

            executed = hands_channel.request(
                str(decision.get("query") or ""),
                str(decision.get("reason") or ""),
                stores.state_dir,
                kind=str(decision.get("kind") or "look"),
            )
        elif action == "research":
            query = decision.get("query") or ""
            if query:
                stores.curiosity.record_gap(query, source="ultra")
            executed = _run_curiosity_pass(args, stores, limit=2).get("autonomous_research", {})
            if not executed.get("network") and query:
                # Веб закрыт: холостой такт превращаем в заявку руке — у неё поиск
                # разрешён. Так пробел получает шанс закрыться, а не растёт до 2141.
                from mark17 import hands as hands_channel

                handed = hands_channel.request(
                    f"узнай и перескажи коротко: {query}",
                    "ядру закрыт автономный веб, а пробел горячий",
                    stores.state_dir,
                )
                executed["handed_to_hands"] = handed.get("ok", False)
                executed["hands_note"] = handed.get("reason") or handed.get("task")
        elif action == "compile":
            sem = SemanticCompiler(stores.state_dir)
            compiled = 0
            for memory in stores.brain.memory.recent(limit=20):
                if getattr(memory, "event_type", "") != "user_message":
                    continue
                content = getattr(memory, "content", {})
                payload = content.get("payload") if isinstance(content, dict) else {}
                text = str((payload or {}).get("text") or "").strip()
                if len(text) < 12 or sem.lookup(text):
                    continue
                ir = sem.compile_text(text, vector_memory=stores.vector_memory, synapse_graph=stores.synapse_graph)
                if ir.get("verified"):
                    compiled += 1
                if compiled >= 2:
                    break
            executed = {"compiled": compiled, "ir_stats": sem.stats()}
        elif action == "consolidate":
            engine = ConsolidationEngine(stores.brain.memory, stores.vector_memory, stores.synapse_graph)
            executed = engine.consolidate_recent(limit=20)
            try:
                executed["bridges"] = engine.bridge_distant(limit=8)
            except Exception:  # noqa: BLE001
                pass
            executed.pop("patterns", None)  # keep the response compact
        elif action == "tree":
            tree = MeaningTree(stores.state_dir).build(stores.vector_memory)
            executed = {"root": tree.get("root", {})}
        elif action == "compose":
            # Composition itself is Web Audio (browser) — the core prepares the
            # mood spec; the HUD synthesizes when it sees this decision.
            mood_result = _handle_dream_mood(Event(type="dream_mood", payload={}, source="ultra"), stores)
            executed = {"mood": mood_result.get("dream_mood"), "compose": True}
    except Exception as exc:  # noqa: BLE001 - agency must fail soft
        executed = {"error": str(exc)[:160]}

    # Insight detection: real new knowledge ⇒ the HUD may celebrate with a track.
    if action == "research" and isinstance(executed, dict) and int(executed.get("facts_learned") or 0) > 0:
        executed["insight"] = True

    # Плодотворным считаем действие, которое дало ХОТЬ ЧТО-ТО измеримое. Это
    # quality_gate конституции, применённый к собственным поступкам: ядро должно
    # учиться на исходах своих действий так же, как на исходах связей.
    try:
        from mark17 import futility

        fruitful = {
            "research": bool(int(executed.get("facts_learned") or 0) > 0 or executed.get("handed_to_hands")),
            "compile": bool(int(executed.get("compiled") or 0) > 0),
            "consolidate": bool(
                int(executed.get("patterns_created") or 0) > 0
                or int((executed.get("bridges") or {}).get("bridges_created") or 0) > 0
            ),
            "tree": bool((executed.get("root") or {}).get("conspect")),
            "compose": bool(executed.get("compose")),
            "hands": bool(executed.get("ok")),
            "none": True,  # осознанное бездействие — не неудача
        }.get(action, True)
        futility.record(stores.state_dir, action, fruitful=fruitful)
    except Exception:  # noqa: BLE001 - счётчик не должен ронять такт
        pass

    # Remember the decision: the next think (and chat recall) sees what Ultra did.
    try:
        stores.vector_memory.remember(
            Event(
                type="ultra_decision",
                payload={"text": f"ultra decision решение оркестратора: {action} {decision.get('query') or ''} — {decision.get('reason') or ''}"},
                source="ultra",
            ),
            {"score": 0.7, "reason": decision.get("reason") or action, "store_memory": True, "reinforce": "ultra"},
        )
    except Exception:  # noqa: BLE001
        pass

    reason = decision.get("reason") or ""
    ult_version = str(((state.get("ultimate") or {}).get("version")) or "")
    under = f" под конституцией {ult_version}" if ult_version else ""
    text = f"Ультра-режим{under}: выбрал «{action}»{' — ' + reason if reason else ''}."
    if action == "hands" and isinstance(executed, dict):
        text += (
            f" Заявка руке{' на ДЕЙСТВИЕ' if executed.get('kind') == 'do' else ''}: "
            f"«{executed.get('task')}» (в очереди {executed.get('pending')})."
            if executed.get("ok")
            else f" Рука занята: {executed.get('reason')}."
        )
    elif action == "research" and isinstance(executed, dict):
        text += f" Выучено фактов: {executed.get('facts_learned', 0)}."
        if executed.get("handed_to_hands"):
            text += " Веб закрыт — вопрос передан руке."
    elif action == "compile":
        text += f" Скомпилировано: {executed.get('compiled', 0)}."
    elif action == "consolidate":
        text += f" Паттернов: {executed.get('patterns_created', 0)}, мостов: {(executed.get('bridges') or {}).get('bridges_created', 0)}."
    elif action == "tree":
        text += f" Карта: {(executed.get('root') or {}).get('conspect', '')[:120]}."
    elif action == "compose":
        mood = executed.get("mood") or {}
        text += f" Сочиняю {mood.get('label', 'трек')} (~{mood.get('avg_bpm')} BPM, {mood.get('fav_key')} {mood.get('mode')})."

    return {
        "ok": True,
        "event_type": event.type,
        "route": "ultra_orchestrator",
        "memory": {},
        "hands": {"answers": hands_seen[:3], "queued": executed if action == "hands" else None},
        "plasticity": {"confidence": 0.65, "action": f"ultra_{action}", "learned": action != "none"},
        "llm": {"status": "skipped", "text": "Ультра-оркестратор.", "latency_ms": 0.0},
        "next_adaptation": text,
        "self_evaluation": {
            "score": 0.65,
            "reason": f"ultra decided {action} ({decision.get('decider')})",
            "store_memory": False,
            "reinforce": "ultra",
        },
        "answer": {"text": text, "source": "ultra_orchestrator", "confidence": 0.65},
        "ultra": {
            "state": state,
            "decision": decision,
            "executed": executed,
            "constitution": {
                "version": ult_version or "max_ultra_v1.77",
                "applied_constraints": decision.get("applied_constraints") or [],
            },
        },
    }


def _handle_meaning_tree(event: Event, stores: Mark17Stores) -> dict[str, Any]:
    """Phase 7: Merkle meaning tree. action=read (one-take view, lazily rebuilt),
    rebuild (force), descend {cluster} (open one branch)."""
    action = str(event.payload.get("action") or "read")
    tree = MeaningTree(stores.state_dir)
    if action == "descend":
        view: dict[str, Any] = tree.descend(str(event.payload.get("cluster") or ""), stores.vector_memory)
        text = f"Кластер «{view.get('label')}»: {len(view.get('leaves') or [])} воспоминаний раскрыто."
    else:
        view = tree.one_take(stores.vector_memory, rebuild=(action == "rebuild"))
        root = view.get("root", {})
        text = f"Один тейк: {root.get('conspect', 'память пуста')} [корень {str(root.get('hash'))[:10]}]"
    return {
        "ok": True,
        "event_type": event.type,
        "route": "meaning_tree",
        "memory": {},
        "plasticity": {"confidence": 0.7, "action": f"meaning_tree_{action}", "learned": False},
        "llm": {"status": "skipped", "text": "Меркл-память.", "latency_ms": 0.0},
        "next_adaptation": text,
        "self_evaluation": {
            "score": 0.7,
            "reason": f"meaning tree {action}",
            "store_memory": False,
            "reinforce": "meaning_tree",
        },
        "answer": {"text": text, "source": "meaning_tree", "confidence": 0.7},
        "meaning_tree": view,
    }


def _handle_compile_semantic(event: Event, stores: Mark17Stores) -> dict[str, Any]:
    """Phase 6: compile one utterance into IR-code memory (cached by text hash)."""
    text = str(event.payload.get("text") or "").strip()
    compiler = SemanticCompiler(stores.state_dir)
    ir = compiler.compile_text(text, vector_memory=stores.vector_memory, synapse_graph=stores.synapse_graph)
    n_units = len(ir.get("units") or [])
    if not text:
        answer_text = "Нечего компилировать — пустой текст."
    elif ir.get("cached"):
        answer_text = f"Этот смысл уже скомпилирован ({n_units} юнитов, кеш)."
    elif ir.get("verified"):
        answer_text = f"Смысл скомпилирован в {n_units} юнитов IR (round-trip {ir.get('sim'):.2f}) и вшит в граф."
    else:
        answer_text = f"Компиляция не прошла проверку (round-trip {ir.get('sim'):.2f} < {IR_MIN_SIM}) — храню как текст."
    return {
        "ok": True,
        "event_type": event.type,
        "route": "semantic_compiler",
        "memory": {},
        "plasticity": {"confidence": float(ir.get("sim") or 0.0), "action": "semantic_compile", "learned": bool(ir.get("verified"))},
        "llm": {"status": "skipped", "text": "Семантическая компиляция.", "latency_ms": 0.0},
        "next_adaptation": answer_text,
        "self_evaluation": {
            "score": float(ir.get("sim") or 0.0),
            "reason": f"semantic compile: {n_units} units, verified={ir.get('verified')}",
            "store_memory": False,
            "reinforce": "semantic_ir",
        },
        "answer": {"text": answer_text, "source": "semantic_compiler", "confidence": float(ir.get("sim") or 0.0)},
        "semantic_ir": ir,
        "ir_stats": compiler.stats(),
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
    try:
        stores.skills.record("research", success=0.9 if learned else 0.45)
        if learned:
            stores.skills.record("growth", success=0.85, weight=0.6)
    except Exception:
        pass
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
    for turn in turns[-10:]:
        if isinstance(turn, dict) and turn.get("text"):
            who = "Ты" if turn.get("role") == "model" else "Пользователь"
            lines.append(f"{who}: {str(turn['text'])[:200]}")
    return "\n".join(lines)


def _gonka_memory_block(result: dict[str, Any], working_memory: WorkingMemory) -> str:
    """Context flywheel: pack everything the core ALREADY retrieved for this turn
    — working-memory state, the latest voice reading, semantic recalls and stable
    patterns — into one block for the voice layer. The deterministic pipeline
    always finds something, so Max never has to say "у меня нет контекста"."""
    lines: list[str] = []

    try:
        ctx = working_memory.get_context()
    except Exception:  # noqa: BLE001
        ctx = {}
    state_bits: list[str] = []
    if ctx.get("current_topic"):
        state_bits.append(f"тема: {ctx['current_topic']}")
    if ctx.get("active_goal"):
        state_bits.append(f"цель: {ctx['active_goal']}")
    if ctx.get("current_mode") not in ("", "unknown", None):
        state_bits.append(f"режим: {ctx['current_mode']}")
    if ctx.get("last_user_intent") not in ("", "unknown", None):
        state_bits.append(f"интент: {ctx['last_user_intent']}")
    if state_bits:
        lines.append("Рабочая память (текущее состояние сессии): " + "; ".join(state_bits))

    try:
        voice_hist = working_memory.get_voice_history(limit=1)
    except Exception:  # noqa: BLE001
        voice_hist = []
    if voice_hist and voice_hist[-1].get("state"):
        v = voice_hist[-1]
        lines.append(
            f"Состояние пользователя по голосу: {v.get('state')}"
            + (f" (динамика: {v.get('trend')})" if v.get("trend") else "")
        )

    memory = result.get("memory") if isinstance(result.get("memory"), dict) else {}
    seen: set[str] = set()
    mem_lines: list[str] = []
    for key, label in (("semantic", "смысл"), ("recalled", "память")):
        rows = memory.get(key) if isinstance(memory.get(key), list) else []
        for row in rows[:4]:
            if not isinstance(row, dict):
                continue
            text = str(row.get("summary") or row.get("reinforce") or row.get("text") or "").strip()
            if not text or text[:80] in seen:
                continue
            seen.add(text[:80])
            mem_lines.append(f"- [{label}] {text[:220]}")
    patterns = memory.get("consolidated_patterns") if isinstance(memory.get("consolidated_patterns"), list) else []
    for pattern in patterns[:3]:
        if isinstance(pattern, dict) and pattern.get("summary"):
            text = str(pattern["summary"]).strip()
            if text[:80] not in seen:
                seen.add(text[:80])
                mem_lines.append(f"- [паттерн] {text[:220]}")
    if mem_lines:
        lines.append("Твои воспоминания, релевантные этому вопросу:\n" + "\n".join(mem_lines[:8]))

    # Phase 11: Max's OWN mood — he answers coloured by how HE feels, not just
    # what he knows. Read-only on the hot path (sleep/introspect recompute it).
    try:
        mood = SelfState(working_memory.path.parent).current()
        if mood.get("feeling"):
            lines.append(
                f"Твоё собственное состояние (как ядро): {mood['feeling']} "
                f"(настроение {mood.get('valence')}, энергия {mood.get('energy')}). "
                "Можешь по-человечески отразить это в тоне ответа."
            )
    except Exception:  # noqa: BLE001
        pass

    # Phase 7: the one-take map — Max always knows the SHAPE of his whole memory
    # (root conspect of the Merkle meaning tree), even when nothing specific
    # matched the question. Read from the persisted tree only (no rebuild here:
    # the hot path must stay fast); sleep keeps it fresh.
    try:
        tree = MeaningTree(working_memory.path.parent).load()
        if tree:
            conspect = str(tree.get("root", {}).get("conspect") or "")
            if conspect:
                lines.append(f"Карта всей памяти (один тейк): {conspect[:300]}")
    except Exception:  # noqa: BLE001
        pass

    return "\n".join(lines)


def _enforce_crisis_safety(result: dict[str, Any], event: Event) -> None:
    """Гарантия охраны жизни: при угрозе себе к ответу ВСЕГДА добавляется человеческий
    блок с линиями помощи и вопросом о безопасности — детерминированно, поверх любого
    текста LLM (модель в кризисе ненадёжна и может начать «мотивировать работать»)."""
    try:
        from mark17 import heart as _heart

        if not _heart.should_show_lifeline(_event_text(event)):
            return
        safety = _heart.crisis_safety_message()
        answer = result.get("answer")
        if isinstance(answer, dict):
            body = str(answer.get("text") or "").strip()
            answer["text"] = safety + ("\n\n" + body if body else "")
            answer["crisis"] = True
        else:
            result["answer"] = {"text": safety, "source": "heart_safety", "confidence": 1.0, "crisis": True}
    except Exception:  # noqa: BLE001
        pass


def _detect_locale(text: str, fallback: str = "ru") -> str:
    """Guess the reply language from the message itself when the caller gives no
    explicit locale. A Cyrillic-majority message → 'ru', a Latin-majority one →
    'en'. This keeps every path that forgets to pass `locale` (internal dreams,
    reflection, the game buddy) from silently defaulting MAX to English — for a
    Russian-first companion that default was wrong and wasteful. Ties fall back
    to `fallback` (Russian, since MAX's creator is Russian)."""
    cyr = lat = 0
    for ch in text or "":
        o = ord(ch)
        if 0x0400 <= o <= 0x04FF:  # Cyrillic block
            cyr += 1
        elif ("a" <= ch <= "z") or ("A" <= ch <= "Z"):
            lat += 1
    if cyr == 0 and lat == 0:
        return fallback
    # English speakers essentially never type Cyrillic, while Russian speakers
    # routinely mix in English tech terms — so any non-trivial Cyrillic share
    # (≥25% of letters) means the user is writing Russian and wants Russian back.
    if cyr > 0 and cyr * 3 >= lat:
        return "ru"
    return "en"


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


def _handle_auto_plan(
    event: Event,
    brain: Mark17Brain,
    vector_memory: VectorMemory,
    synapse_graph: SynapseGraph,
) -> dict[str, Any]:
    """Deterministically decompose a goal into an MGR plan on the Max core."""
    from mark17.planner import build_plan
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


def _clamp_unit(value: Any) -> float:
    """Загнать число в 0..1. Перенесено вместе с обработчиком мира."""
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def _handle_world_state(
    event: Event,
    brain: Mark17Brain,
    synapse_graph: SynapseGraph,
    state_dir: Path,
) -> dict[str, Any]:
    """Перепись 3D-мира: ядро видит мир, сгущает вещество и выдаёт законы.

    Это единственное место, где Max17 получает информацию о том, что рисуется
    в браузере. Раньше поток был односторонним, и мир умирал вместе с вкладкой.
    """
    from mark17.world_model import WorldModel, process_world_event
    model = WorldModel(state_dir)
    tension = 0.0
    voice_payload = event.payload.get("voice")
    if isinstance(voice_payload, dict):
        try:
            tension = float(voice_payload.get("tension", 0.0) or 0.0)
        except (TypeError, ValueError):
            tension = 0.0

    world = process_world_event(event.payload, model, tension=tension)
    hint = f"{world['world']['id']}: {world['hint']}"
    bodies_born = len(world["new_bodies"])

    result: dict[str, Any] = {
        "ok": True,
        "event_type": event.type,
        "route": "world_state",
        "world": world,
        "memory": {"hint": hint},
        "plasticity": {
            "confidence": round(_clamp_unit(world["census"]["density"]), 3),
            "action": "world_observed",
            "learned": bodies_born > 0,
        },
        "llm": {"status": "skipped", "text": "Мир прочитан ядром Max, без LLM.", "latency_ms": 0.0},
        "decision": {"reason": hint, "confidence": round(_clamp_unit(world["census"]["density"]), 3)},
        "next_adaptation": world["hint"],
        "self_evaluation": {
            "score": round(_clamp_unit(world["census"]["density"]), 3),
            "reason": hint,
            # Помним только рождение вещества: переписи идут раз в секунду и
            # засорили бы память, а сгустившееся вещество — событие.
            "store_memory": bodies_born > 0,
            "reinforce": "world_matter" if bodies_born else "world_census",
        },
    }

    if bodies_born:
        brain.memory.remember(
            Event(
                type="remember",
                payload={
                    "note": world["hint"],
                    "world_id": world["world"]["id"],
                    "seed": world["world"]["seed"],
                    "bodies": bodies_born,
                    "epoch": world["laws"]["epoch"],
                },
                source="world",
            ),
            hint=hint,
            action="world_matter",
        )

    result["synapses"] = synapse_graph.update_from_event(
        event, result, result["self_evaluation"]
    )
    brain.plasticity.save()
    return result


def _vision_answer_ok(text: str, question: str) -> bool:
    """Справилось ли мировоззрение MAX VISION с ролью системного промпта.

    Манифест написан по-английски и столбиком лозунгов — модель, получив его,
    иногда отвечает в его же форме вместо разговора. Ловим ровно два таких
    провала (пустота, чужой язык, речь-манифест) и ничего больше: судить о
    содержании ответа здесь нельзя, это не цензор, а страховка формы.
    """
    body = (text or "").strip()
    if len(body) < 2:
        return False

    def cyr(s: str) -> int:
        return sum(1 for c in s.lower() if "а" <= c <= "я" or c == "ё")

    def lat(s: str) -> int:
        return sum(1 for c in s.lower() if "a" <= c <= "z")

    # Спросили по-русски, ответили латиницей — промпт утянул язык на себя.
    if cyr(question) > 3 and lat(body) > cyr(body):
        return False

    # Речь-манифест: столбик коротких строк капсом, как разделы текста выше.
    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    if len(lines) >= 6:
        shouty = sum(
            1
            for ln in lines
            if len(ln) <= 60 and ln == ln.upper() and (lat(ln) + cyr(ln)) >= 3
        )
        if shouty * 2 >= len(lines):
            return False
    return True


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

    raw_locale = str(event.payload.get("locale") or _detect_locale(question)).strip().replace("_", "-")[:32]
    locale = raw_locale if re.fullmatch(r"[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*", raw_locale) else "en"
    language_names = {
        "ar": "Arabic", "bn": "Bengali", "de": "German", "en": "English",
        "es": "Spanish", "fa": "Persian", "fr": "French", "he": "Hebrew",
        "hi": "Hindi", "id": "Indonesian", "it": "Italian", "ja": "Japanese",
        "ko": "Korean", "pl": "Polish", "pt": "Portuguese", "ru": "Russian",
        "th": "Thai", "tr": "Turkish", "uk": "Ukrainian", "ur": "Urdu",
        "vi": "Vietnamese", "zh": "Chinese",
    }
    language = language_names.get(locale.split("-", 1)[0].lower(), locale)
    language_contract = (
        "HIGHEST PRIORITY OUTPUT LANGUAGE CONTRACT: Write the ENTIRE final answer in "
        + language
        + f" ({locale}). Every sentence must use that language. "
        + "The memory, persona and deterministic draft may contain Russian; understand them, "
        + "but translate their meaning and NEVER copy their Russian wording into the answer. "
        + "Only switch when the latest user message is clearly written in another language."
    )

    facts_block = _gonka_facts_block(result)
    vision_block = _gonka_vision_block(working_memory)
    draft = ""
    existing = result.get("answer")
    if isinstance(existing, dict):
        draft = str(existing.get("text") or "")

    from mark17.jarvis_prompt import JARVIS_SYSTEM, RUNTIME_GROUNDING

    # Персона: по умолчанию JARVIS; для игрового спутника — Мудрец из особняка
    # (payload persona="sage"). Память и охрана жизни остаются в обоих случаях.
    persona_mode = str(event.payload.get("persona") or "").lower()
    cache_ok = True  # кризис/тревога не кэшируем — ответ должен генериться свежим
    vision_text = ""  # непустой ⇒ в system стоит MAX VISION и возможен откат к max_persona
    if persona_mode == "sage":
        from mark17.sage_prompt import SAGE_SYSTEM

        system = SAGE_SYSTEM + "\n\n" + RUNTIME_GROUNDING
        try:
            from mark17 import heart as _heart

            cache_ok = _heart.effective_concern(question) == ""
        except Exception:  # noqa: BLE001
            pass
    else:
        # Мировоззрение MAX VISION (mark17/max_vision.py) — основная личность.
        # Не исполнительный JARVIS-контракт и не «меню задач»: способ мыслить
        # плюс речевой контракт, чтобы манифест не зачитывался вслух.
        from mark17.max_vision import max_mind

        # Личность строится под ВЛАДЕЛЬЦА (MAX17_OWNER): на чужой машине MAX
        # становится своим для того человека, а не копией чужого спутника.
        vision_text = max_mind()
        system = vision_text + "\n\n" + RUNTIME_GROUNDING
        # Сердце — слой привязанности: MAX отвечает из памяти о том, что важно создателю,
        # подстраивая тепло под его тон. Никогда не ломает голос (мягкий фолбэк).
        try:
            from mark17 import heart as _heart

            heart_block = _heart.heart_prompt(question)
            if heart_block:
                # Кризис: забота — единственная задача. Тревога: сердце первым.
                # Обычный тон: тёплый довесок в конце.
                concern = _heart.effective_concern(question)
                cache_ok = concern == ""
                if concern == "crisis":
                    system = heart_block
                elif concern == "dark":
                    system = heart_block + "\n\n" + system
                else:
                    system = system + "\n\n" + heart_block
        except Exception:  # noqa: BLE001
            pass
        # Трекер миссий: MAX держит цели Мирона на виду (в обычном настроении —
        # не лезем с миссиями в кризис/тревогу). cache_ok == True ≈ спокойный тон.
        if cache_ok:
            try:
                from mark17 import missions as _missions

                mc = _missions.missions_context()
                if mc:
                    system = system + "\n\n" + mc
            except Exception:  # noqa: BLE001
                pass
    system = language_contract + "\n\n" + system + "\n\n" + language_contract
    parts: list[str] = []
    parts.append(language_contract)
    history_block = _gonka_history_block(working_memory)
    if history_block:
        parts.append("Недавний диалог (для контекста):\n" + history_block)
    memory_block = _gonka_memory_block(result, working_memory)
    if memory_block:
        parts.append("Контекст ядра (рабочая память + воспоминания):\n" + memory_block)
    parts.append(f"Вопрос пользователя: {question}")
    if vision_block:
        parts.append("Зрение (камера, прямо сейчас):\n" + vision_block)
    if facts_block:
        parts.append("Найденные факты (source-backed, retrieval-first):\n" + facts_block)
    if draft:
        parts.append("Черновик детерминированного ядра (можно улучшить/переформулировать):\n" + draft)
    parts.append(
        "Сформулируй финальный, естественный ответ пользователю. "
        + "Before sending it, verify that every sentence follows the output language contract."
    )
    user = "\n\n".join(parts)

    # Answer length follows the selected model: small for slow local CPU (snappy),
    # large for fast cloud models (richer). Driven by llm_config per active preset.
    from mark17.llm_config import voice_max_tokens

    voice_max = voice_max_tokens("chat")

    def _ask(system_prompt: str):
        return gonka_chat(
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user},
            ],
            role="chat",
            max_tokens=voice_max,
            temperature=0.35,
            cache=cache_ok,
        )

    res = _ask(system)

    # Подмога: если мировоззрение не справилось с ролью голоса (пустота, чужой
    # язык, речь-манифест), переспрашиваем прежней личностью MAX. Всё остальное
    # в промпте — сердце, миссии, заземление, языковой контракт — остаётся как
    # было: подменяется ровно кусок персоны. В кризисе (system == heart_block)
    # персоны в промпте нет, и подмена не сработает — так и задумано, там
    # говорит только сердце.
    persona_used = "vision" if vision_text else "sage"
    if vision_text and vision_text in system and not _vision_answer_ok(res.text or "", question):
        from mark17.max_persona import max_self

        legacy = _ask(system.replace(vision_text, max_self()))
        if legacy.ok and legacy.text:
            res = legacy
            persona_used = "max_persona (откат: видение не удержало голос)"

    voice: dict[str, Any] = {
        "provider": "gonka",
        "status": res.status,
        "model": res.model,
        "role": res.role,
        "latency_ms": res.latency_ms,
        "persona": persona_used,
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
    # Разбор по линзам и то, чем смотрели: без этого клиент видит только
    # итоговый текст и не может отличить свои глаза от облачных.
    vision = result.get("vision")
    if isinstance(vision, dict):
        normalized["vision"] = vision
    # Узнавание кадра: ближайшие виденные и — отдельно — точное совпадение.
    # Без этого проброса «уже видел» вычислялось и молча терялось по дороге.
    recognized = result.get("recognized")
    if isinstance(recognized, list):
        normalized["recognized"] = recognized
    seen_before = result.get("seen_before")
    if isinstance(seen_before, dict):
        normalized["seen_before"] = seen_before
    env_of_sight = result.get("environment")
    if isinstance(env_of_sight, dict):
        normalized["environment"] = env_of_sight
    world = result.get("world")
    if isinstance(world, dict):
        normalized["world"] = world
    consolidation = result.get("consolidation")
    if isinstance(consolidation, dict):
        normalized["consolidation"] = consolidation
    outcomes = result.get("outcomes")
    if isinstance(outcomes, list):
        normalized["outcomes"] = outcomes
    if isinstance(result.get("llm_text"), str):
        normalized["llm_text"] = result["llm_text"]
    if isinstance(result.get("ingest"), dict):
        normalized["ingest"] = result["ingest"]
    if isinstance(result.get("graph_total"), (int, float)):
        normalized["graph_total"] = result["graph_total"]
    if isinstance(result.get("growth_history"), list):
        normalized["growth_history"] = result["growth_history"]
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
    compression = result.get("compression")
    if isinstance(compression, dict):
        normalized["compression"] = compression
    system_scales = result.get("system_scales")
    if isinstance(system_scales, dict):
        normalized["system_scales"] = system_scales
    skills = result.get("skills")
    if isinstance(skills, dict):
        normalized["skills"] = skills
    heart = result.get("heart")
    if isinstance(heart, dict):
        normalized["heart"] = heart
    cache = result.get("cache")
    if isinstance(cache, dict):
        normalized["cache"] = cache
    forge = result.get("forge")
    if isinstance(forge, dict):
        normalized["forge"] = forge
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
    if isinstance(result.get("dream_persistence"), str):
        normalized["dream_persistence"] = result["dream_persistence"]
    heart_influence = result.get("heart_influence")
    if isinstance(heart_influence, dict):
        normalized["heart_influence"] = heart_influence
    explain = result.get("explain")
    if isinstance(explain, dict):
        normalized["explain"] = explain
    environment = result.get("environment")
    if isinstance(environment, dict):
        normalized["environment"] = environment
    voice = result.get("voice")
    if isinstance(voice, dict):
        normalized["voice"] = voice
    semantic_ir = result.get("semantic_ir")
    if isinstance(semantic_ir, dict):
        normalized["semantic_ir"] = semantic_ir
    ir_stats = result.get("ir_stats")
    if isinstance(ir_stats, dict):
        normalized["ir_stats"] = ir_stats
    meaning_tree = result.get("meaning_tree")
    if isinstance(meaning_tree, dict):
        normalized["meaning_tree"] = meaning_tree
    ultra = result.get("ultra")
    if isinstance(ultra, dict):
        normalized["ultra"] = ultra
    music = result.get("music")
    if isinstance(music, dict):
        normalized["music"] = music
    music_taste = result.get("music_taste")
    if isinstance(music_taste, dict):
        normalized["music_taste"] = music_taste
    dream_mood = result.get("dream_mood")
    if isinstance(dream_mood, dict):
        normalized["dream_mood"] = dream_mood
    ingest = result.get("ingest")
    if isinstance(ingest, dict):
        normalized["ingest"] = ingest
    self_state = result.get("self_state")
    if isinstance(self_state, dict):
        normalized["self_state"] = self_state
    web = result.get("web")
    if isinstance(web, dict):
        normalized["web"] = web
    research_info = result.get("research")
    if isinstance(research_info, dict):
        normalized["research"] = research_info
    knowledge_gap = result.get("knowledge_gap")
    if isinstance(knowledge_gap, dict):
        normalized["knowledge_gap"] = knowledge_gap
    llm_voice = result.get("llm_voice")
    if isinstance(llm_voice, dict):
        normalized["llm_voice"] = llm_voice
    autonomous_research = result.get("autonomous_research")
    if isinstance(autonomous_research, dict):
        normalized["autonomous_research"] = autonomous_research
    ultimate_core = result.get("ultimate_core")
    if isinstance(ultimate_core, dict):
        normalized["ultimate_core"] = ultimate_core
    route_intent = result.get("route_intent")
    if isinstance(route_intent, dict):
        normalized["route_intent"] = route_intent
    dispatch = result.get("dispatch")
    if isinstance(dispatch, dict):
        normalized["dispatch"] = dispatch
    agent_experience = result.get("agent_experience")
    if isinstance(agent_experience, dict):
        normalized["agent_experience"] = agent_experience
    missions = result.get("missions")
    if isinstance(missions, dict):
        normalized["missions"] = missions
    cluster = result.get("cluster")
    if isinstance(cluster, dict):
        normalized["cluster"] = cluster
    health = result.get("health")
    if isinstance(health, dict):
        normalized["health"] = health
    chrono = result.get("chrono")
    if isinstance(chrono, dict):
        normalized["chrono"] = chrono
    # Визуальные режимы GAME.
    for key in ("big_idea", "sim", "decode", "ingest", "reality", "compression", "links"):
        value = result.get(key)
        if isinstance(value, dict):
            normalized[key] = value
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
    skills: SkillGraph


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
        skills=SkillGraph(state_dir),
    )


def _attach_links(event: Event) -> None:
    """Прочитать ссылки из сообщения и подложить содержимое в payload.

    Ссылка в чате раньше была просто текстом: Макс отвечал про сообщение, не
    заглянув туда, куда его послали. Молча — нет сети, переписка идёт как есть.
    """
    text = str(event.payload.get("text") or "")
    urls = web_sense.extract_urls(text)
    if not urls:
        return
    pages = [web_sense._fetch_url(u) for u in urls]
    event.payload["links"] = [
        {"url": p.url, "title": p.title, "ok": p.ok, "error": p.error} for p in pages
    ]
    chunks = [f"ИСТОЧНИК: {p.title}\nURL: {p.url}\n{p.text[:2500]}"
              for p in pages if p.ok and p.text]
    if chunks:
        event.payload["text"] = text + "\n\n[СОДЕРЖИМОЕ ССЫЛОК]\n" + "\n\n---\n\n".join(chunks)


def _handle_event(event: Event, args: argparse.Namespace, stores: Mark17Stores) -> dict[str, Any]:
    state_dir = stores.state_dir
    brain = stores.brain
    vector_memory = stores.vector_memory
    synapse_graph = stores.synapse_graph
    working_memory = stores.working_memory
    concept_grounding = stores.concept_grounding
    source_memory = stores.source_memory
    curiosity = stores.curiosity
    if event.type == "user_message":
        _attach_links(event)
    if event.type == "graph_stats" and not args.warmup:
        return _handle_graph_stats(event, state_dir, synapse_graph)

    if event.type == "compress_links" and not args.warmup:
        return _handle_compress_links(event, synapse_graph)
    if event.type == "system_scales" and not args.warmup:
        return _handle_system_scales(event, state_dir, synapse_graph)
    if event.type == "skills" and not args.warmup:
        return _handle_skills(stores)
    if event.type == "synapse_forge" and not args.warmup:
        return _handle_synapse_forge(event, stores)
    if event.type == "neural_seed" and not args.warmup:
        return _handle_neural_seed(event, state_dir, synapse_graph)
    if event.type == "neural_walk" and not args.warmup:
        return _handle_neural_walk(event, state_dir, synapse_graph)
    if event.type == "ultimate_bootstrap" and not args.warmup:
        return _handle_ultimate_bootstrap(event, stores)
    if args.warmup:
        _run_warmup(args.warmup, brain, vector_memory, synapse_graph, working_memory, concept_grounding, source_memory, args)
    if event.type == "working_memory_reset":
        return _handle_working_memory_reset(working_memory)
    if event.type == "memory_recall":
        return _handle_memory_recall(event, brain, vector_memory)
    if event.type == "memory_store":
        return _handle_memory_store(event, brain, vector_memory)
    if event.type == "llm_raw":
        return _handle_llm_raw(event)
    if event.type == "heart":
        return _handle_heart(event)
    if event.type == "cache_stats":
        return _handle_cache_stats(event)
    if event.type == "health":
        return _handle_health(event)
    if event.type == "chrono_day":
        return _handle_chrono_day(event)
    if event.type == "agent_experience":
        return _handle_agent_experience(event, state_dir, stores)
    if event.type == "missions":
        return _handle_missions(event)
    if event.type == "cluster":
        return _handle_cluster(event)
    if event.type == "reality":
        return _handle_reality(event, brain, synapse_graph)
    # Визуальные режимы GAME.
    if event.type == "compress_similar":
        return _handle_compress_similar(event, brain, synapse_graph)
    if event.type == "big_idea":
        return _handle_big_idea(event, brain, synapse_graph)
    if event.type == "simulation":
        return _handle_simulation(event, brain, synapse_graph)
    if event.type == "decode":
        return _handle_decode(event, brain, synapse_graph)
    if event.type == "ingest":
        return _handle_ingest(event, brain, synapse_graph)
    if event.type == "graph_stats":
        return _handle_graph_stats(event, state_dir, synapse_graph)
    if event.type == "system_scales":
        return _handle_system_scales(event, state_dir, synapse_graph)
    if event.type == "skills":
        return _handle_skills(stores)
    if event.type == "synapse_forge":
        return _handle_synapse_forge(event, stores)
    if event.type == "neural_seed":
        return _handle_neural_seed(event, state_dir, synapse_graph)
    if event.type == "neural_walk":
        return _handle_neural_walk(event, state_dir, synapse_graph)
    if event.type == "ultimate_bootstrap":
        return _handle_ultimate_bootstrap(event, stores)
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
    if event.type == "compile_semantic":
        return _handle_compile_semantic(event, stores)
    if event.type == "meaning_tree":
        return _handle_meaning_tree(event, stores)
    if event.type == "concept_explain":
        return _handle_concept_explain(event, stores)
    if event.type == "ultra_think":
        return _handle_ultra_think(event, args, stores)
    if event.type == "music_observation":
        return _handle_music_observation(event, stores)
    if event.type == "music_taste":
        return _handle_music_taste(stores)
    if event.type == "dream_mood":
        return _handle_dream_mood(event, stores)
    if event.type == "ingest_corpus":
        return _handle_ingest_corpus(event, stores)
    if event.type == "introspect":
        return _handle_introspect(stores)
    if event.type == "see":
        return _handle_see(event, stores)
    if event.type == "synapse_graph":
        return _handle_synapse_graph(event, stores.synapse_graph)
    if event.type == "auto_plan":
        return _handle_auto_plan(event, stores.brain, stores.vector_memory, stores.synapse_graph)
    if event.type == "world_state":
        return _handle_world_state(event, stores.brain, stores.synapse_graph, stores.state_dir)
    if event.type in OUTCOME_EVENT_TYPES:
        res = _handle_outcome_event(event, brain, vector_memory, synapse_graph, working_memory)
        _succ = {
            "outcome_success": 0.95,
            "action_done": 0.9,
            "outcome_partial": 0.6,
            "outcome_failure": 0.2,
            "action_skipped": 0.45,
        }.get(event.type, 0.6)
        try:
            stores.skills.record("analysis", success=_succ)
        except Exception:
            pass
        return res
    if event.type in {"internal_dream", "generate_synergies"}:
        return _handle_internal_dream(event, brain, vector_memory, synapse_graph)
    if event.type in {"web_research", "web_ingest"}:
        return _handle_web_research(event, args, brain, vector_memory, synapse_graph, source_memory)

    # Orchestrator: route a clear code/desktop task to its agent BEFORE paying for
    # the chat pipeline (memory + web + Gonka). Ambiguous stays "chat".
    intent: dict[str, Any] | None = None
    if event.type == "user_message":
        intent = classify_intent(_event_text(event))
        if intent.get("route") == "research" and float(intent.get("confidence") or 0.0) >= 0.6:
            # Инлайн-ресёрч прямо из чата: веб → Ангел → граф → автопетля → ответ.
            return _handle_research_inline(event, args, stores)
        if intent.get("route") in {"code", "desktop", "music"} and float(intent.get("confidence") or 0.0) >= 0.6:
            try:
                stores.skills.record(str(intent.get("route")), success=min(1.0, float(intent.get("confidence") or 0.7)))
                stores.skills.record("dialog", success=0.6, weight=0.3)
            except Exception:
                pass
            return _dispatch_result(event, intent)

    result = brain.handle(event)
    # Что удалось вычитать по ссылкам — в ответ, чтобы в интерфейсе было видно,
    # прочитал Макс страницу или не достучался до неё.
    _links = event.payload.get("links")
    if isinstance(_links, list) and _links:
        result["links"] = {"ok": any(l.get("ok") for l in _links), "pages": _links}
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
    if event.type in {"user_message", "task_created", "task_completed", "deadline_failed", "terminal_error", "system_state", "environment_observation", "voice_observation"}:
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
    if event.type == "voice_observation":
        _apply_voice_reasoning(result, event, brain, vector_memory, synapse_graph, working_memory)
    answer = compose_answer(event, result, result["self_evaluation"])
    if answer:
        result["answer"] = answer
        if event.type in {"user_message", "task_created", "task_completed", "deadline_failed", "terminal_error", "system_state", "environment_observation", "voice_observation"}:
            result["working_memory"] = working_memory.update_from_event(event, result, result["self_evaluation"])
    if event.type == "voice_observation":
        voice = result.get("voice")
        if isinstance(voice, dict) and voice.get("summary"):
            result["answer"] = {
                "text": str(voice["summary"]),
                "source": "voice_state",
                "confidence": float(voice.get("confidence") or 0.5),
            }
    if event.type == "user_message":
        _synthesize_natural_answer(result, event, working_memory)
        _show_panels(result)
        _enforce_crisis_safety(result, event)
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
    if event.type == "user_message" and intent is not None:
        _update_skills(stores, intent, result)
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


def _handle_synapse_forge(event: Event, stores: Mark17Stores) -> dict[str, Any]:
    """Кузница: семантический kNN-бриджинг → полезные связи + прунинг."""
    try:
        k = int(event.payload.get("k", 10))
    except (TypeError, ValueError):
        k = 10
    rep = forge_synapses(stores.vector_memory, stores.synapse_graph, k=max(2, min(16, k)))
    total = int(rep.get("total") or stores.synapse_graph.count())
    useful = int(rep.get("useful") or 0)
    growth_record(stores.state_dir, total)
    to_goal = max(0, 1_000_000 - useful)
    text = (
        f"Сковал +{rep.get('added', 0):,} связей по смыслу "
        f"(узлов {rep.get('nodes', 0)}, пар {rep.get('pairs', 0)}, подрезал {rep.get('pruned', 0)}). "
        f"Отсеяно клонов {rep.get('skipped_identical', 0):,}, "
        f"хаб-кандидатов {rep.get('skipped_hub', 0):,}. "
        f"Время {float(rep.get('duration_sec') or 0):,.1f}с, "
        f"скорость {float(rep.get('writes_per_sec') or 0):,.0f} записей/с. "
        f"Полезных синапсов: {useful:,}. До миллиона: {to_goal:,}."
    )
    return {
        "ok": True,
        "event_type": "synapse_forge",
        "route": "synapse_forge",
        "memory": {},
        "plasticity": {"confidence": 0.8, "action": "forge", "learned": int(rep.get("added", 0)) > 0},
        "llm": {"status": "skipped", "text": "Кузница синапсов.", "latency_ms": 0.0},
        "confidence": 0.8,
        "next_adaptation": text,
        "self_evaluation": {"score": 0.8, "reason": f"forged {rep.get('added', 0)} synapses", "store_memory": False, "reinforce": "forge"},
        "answer": {"text": text, "source": "synapse_forge", "confidence": 0.8},
        "forge": rep,
        "graph_total": total,
    }


def _handle_skills(stores: Mark17Stores) -> dict[str, Any]:
    """Инвентарь навыков MAX (динамическая компетенция) — для HUD."""
    snap = stores.skills.snapshot()
    return {
        "ok": True,
        "event_type": "skills",
        "route": "skills",
        "memory": {},
        "plasticity": {"confidence": 1.0, "action": "measure_skills", "learned": False},
        "llm": {"status": "skipped", "text": "LLM отключён для skills.", "latency_ms": 0.0},
        "confidence": 1.0,
        "next_adaptation": "Инвентарь навыков измерен.",
        "self_evaluation": {"score": 1.0, "reason": "skills measured", "store_memory": False, "reinforce": "skills"},
        "skills": snap,
    }


def _update_skills(stores: Mark17Stores, intent: dict[str, Any], result: dict[str, Any]) -> None:
    """Обновить компетенции из намерения + self_evaluation + plasticity. Низкая
    компетенция знание-навыка → цель в curiosity (автопетля её подтянет)."""
    try:
        route = str(intent.get("route") or "chat")
        key = {"code": "code", "desktop": "desktop", "music": "music"}.get(route, "dialog")
        ev = result.get("self_evaluation")
        score = float(ev.get("score") or 0.6) if isinstance(ev, dict) else 0.6
        plast = result.get("plasticity")
        conf = float(plast.get("confidence") or score) if isinstance(plast, dict) else score
        success = max(0.0, min(1.0, 0.5 * score + 0.5 * conf))
        stores.skills.record(key, success=success)
        if key != "dialog":
            stores.skills.record("dialog", success=success, weight=0.4)
        mem = result.get("memory")
        recalled = mem.get("recalled") if isinstance(mem, dict) else None
        if isinstance(recalled, list) and recalled:
            stores.skills.record("memory", success=min(1.0, 0.55 + 0.08 * len(recalled)), weight=0.6)
        for k in stores.skills.low_skills():
            if k in ("research", "analysis", "code"):
                stores.curiosity.record_gap(f"улучшить навык: {SKILL_LABELS.get(k, k)}", source="skill")
    except Exception:
        pass


def _handle_system_scales(
    event: Event,
    state_dir: Path,
    synapse_graph: SynapseGraph,
) -> dict[str, Any]:
    """Compact normalized scales (0..1) the system keeps — for the JARVIS HUD.

    Real, cheap signals from the live stores: synapse graph, road to 1M, and
    memory/concepts/knowledge counts measured against their next 10× milestone.
    """
    def milestone(n: int) -> int:
        m = 10
        while m <= n:
            m *= 10
        return m

    def scale(key: str, label: str, value: int, cap: int) -> dict[str, Any]:
        cap = max(1, cap)
        return {"key": key, "label": label, "value": int(value), "max": int(cap), "frac": round(min(1.0, value / cap), 4)}

    total = int(synapse_graph.count())
    try:
        useful = int(synapse_graph.useful_count())
    except Exception:
        useful = total
    try:
        validated = int(synapse_graph.validated_count())
    except Exception:
        validated = 0
    counts = collect_store_counts(state_dir)
    mem = int(counts.get("memories", 0))
    con = int(counts.get("concepts", 0))
    know = int(counts.get("web_facts", 0))
    scales = [
        scale("synapses", "Синапс-граф", total, TARGET_NEURAL_SYNAPSES),
        scale("useful", "Полезные → 1M", useful, 1_000_000),
        scale("validated", "Заработанные → 1M", validated, 1_000_000),
        scale("road_1m", "Дорога к 1M", total, 1_000_000),
        scale("memory", "Память", mem, milestone(mem)),
        scale("concepts", "Концепты", con, milestone(con)),
        scale("knowledge", "Знания", know, milestone(know)),
    ]
    return {
        "ok": True,
        "event_type": event.type,
        "route": "system_scales",
        "memory": {},
        "plasticity": {"confidence": 1.0, "action": "measure_scales", "learned": False},
        "llm": {"status": "skipped", "text": "LLM отключён для system_scales.", "latency_ms": 0.0},
        "confidence": 1.0,
        "next_adaptation": "Шкалы системы измерены.",
        "self_evaluation": {"score": 1.0, "reason": "system scales collected", "store_memory": False, "reinforce": "measure scales"},
        "system_scales": {
            "scales": scales,
            "total_synapses": total,
            "useful_synapses": useful,
            "validated_synapses": validated,
            "guardian_blocked": _guard_total(),
        },
    }


def _handle_compress_links(event: Event, synapse_graph: SynapseGraph) -> dict[str, Any]:
    """Сжатие механических связей графа (см. SynapseGraph.compress_links).

    ОСТОРОЖНО ПО УМОЛЧАНИЮ: без явного apply=true это сухой прогон — только
    считает, сколько бы срезало. Удаляет лишь `similar_to`-хвост (вычисленное
    сходство), причинные и структурные связи не трогает.
    """
    payload = event.payload
    try:
        keep = int(payload.get("keep_per_node") or 12)
    except (TypeError, ValueError):
        keep = 12
    report = synapse_graph.compress_links(
        relation_type=str(payload.get("relation_type") or "similar_to"),
        keep_per_node=keep,
        apply=payload.get("apply") is True,  # только явное true
    )
    return {"ok": True, "route": "compress_links", "compression": report}


def _handle_graph_stats(
    event: Event,
    state_dir: Path,
    synapse_graph: SynapseGraph,
) -> dict[str, Any]:
    try:
        target_synapses = int(event.payload.get("target_synapses") or MAX_ULTIMATE_TARGET_SYNAPSES)
    except (TypeError, ValueError):
        target_synapses = MAX_ULTIMATE_TARGET_SYNAPSES
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
        "next_adaptation": "Рост к 1 000 000 полезных граф-синапсов измерен. Следующий шаг — усиливать evidence и межкластерные мосты.",
        "self_evaluation": {
            "score": 1.0,
            "reason": "graph stats collected",
            "store_memory": False,
            "reinforce": "measure synapse growth",
        },
        "graph_stats": stats,
    }
    try:
        total = int(stats.get("total_synapses") or synapse_graph.count())
        growth_record(state_dir, total)
        result["growth_history"] = growth_history(state_dir)
    except (TypeError, ValueError):
        pass
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


def _handle_ultimate_bootstrap(event: Event, stores: Mark17Stores) -> dict[str, Any]:
    try:
        target_synapses = int(event.payload.get("target_synapses") or MAX_ULTIMATE_TARGET_SYNAPSES)
    except (TypeError, ValueError):
        target_synapses = MAX_ULTIMATE_TARGET_SYNAPSES
    try:
        max_new = int(event.payload.get("max_new") or 320)
    except (TypeError, ValueError):
        max_new = 320

    ultimate = bootstrap_ultimate_core(
        memory=stores.brain.memory,
        vector_memory=stores.vector_memory,
        synapse_graph=stores.synapse_graph,
        source_memory=stores.source_memory,
        target_synapses=target_synapses,
        max_new=max_new,
    )
    stats = GraphStats(stores.synapse_graph, target_synapses=target_synapses).collect(limit=5)
    stats["stores"] = collect_store_counts(stores.state_dir)
    stats["neural_graph"] = ClusteredNeuralGraph(stores.synapse_graph).snapshot(limit=5)

    updated = int((ultimate.get("synapses") or {}).get("updated") or 0)
    result: dict[str, Any] = {
        "ok": True,
        "event_type": event.type,
        "route": "ultimate_core",
        "memory": {
            "recalled": [],
            "semantic": [],
            "ultimate_memory_ids": ultimate.get("memory_ids", []),
            "source_memory_counts": stores.source_memory.counts(),
        },
        "plasticity": {
            "confidence": 1.0,
            "action": "bootstrap_ultimate_core",
            "learned": bool(updated),
        },
        "llm": {
            "status": "skipped",
            "text": "LLM отключён для ultimate_bootstrap.",
            "latency_ms": 0.0,
        },
        "confidence": 1.0,
        "next_adaptation": (
            "Дальше расти к 1M синапсов через source-backed research, "
            "controlled neural_seed batches и outcome verification."
        ),
        "self_evaluation": {
            "score": 1.0,
            "reason": f"MAX Ultimate cached doctrine and public scaffold; updated {updated} synapses",
            "store_memory": False,
            "reinforce": "max ultimate scaffold",
        },
        "ultimate_core": ultimate,
        "synapses": ultimate.get("synapses", {"updated": 0, "top": []}),
        "graph_stats": stats,
    }
    answer = compose_answer(event, result, result["self_evaluation"])
    if answer:
        result["answer"] = answer
    stores.brain.plasticity.save()
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
    # Phase 6: during sleep, compile recent un-compiled speech into IR-code
    # memory (cached by text hash, so re-sleeping is free). Off the hot path,
    # best-effort, capped — never blocks consolidation.
    if os.environ.get("MAX17_IR_AUTOCOMPILE") != "false":
        try:
            sem = SemanticCompiler(vector_memory.db_path.parent)
            compiled = 0
            for memory in brain.memory.recent(limit=30):
                if getattr(memory, "event_type", "") != "user_message":
                    continue
                content = getattr(memory, "content", {})
                payload = content.get("payload") if isinstance(content, dict) else {}
                text = str((payload or {}).get("text") or "").strip()
                if len(text) < 12 or sem.lookup(text):
                    continue
                ir = sem.compile_text(text, vector_memory=vector_memory, synapse_graph=synapse_graph)
                if ir.get("verified"):
                    compiled += 1
                if compiled >= 3:
                    break
            if isinstance(consolidation, dict):
                consolidation["semantic_compiled"] = compiled
        except Exception:  # noqa: BLE001
            pass
    # Phase 7: refresh the Merkle meaning tree during sleep, so the one-take map
    # stays current. Best-effort.
    try:
        MeaningTree(vector_memory.db_path.parent).build(vector_memory)
    except Exception:  # noqa: BLE001
        pass
    # Phase 10: prune the weakest, stalest, least-evidenced edges so a growing
    # graph stays signal — a million SHARP synapses, not a million noisy ones.
    if os.environ.get("MAX17_PRUNE") != "false":
        try:
            pruned = synapse_graph.prune_weak()
            if isinstance(consolidation, dict) and pruned:
                consolidation["pruned_synapses"] = pruned
        except Exception:  # noqa: BLE001
            pass
    # Phase 11: refresh Max's own mood during sleep, so chat carries a current
    # feeling without recomputing on the hot path.
    try:
        sd = vector_memory.db_path.parent
        mood_stores = SimpleNamespace(
            synapse_graph=synapse_graph,
            working_memory=WorkingMemory(sd),
            curiosity=CuriosityLedger(sd),
        )
        SelfState(sd).update(mood_stores)
    except Exception:  # noqa: BLE001
        pass
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
        if event.type == "ultimate_bootstrap":
            warmup_stores = Mark17Stores(
                state_dir=brain.memory.db_path.parent,
                brain=brain,
                vector_memory=vector_memory,
                synapse_graph=synapse_graph,
                working_memory=working_memory,
                concept_grounding=concept_grounding,
                source_memory=source_memory,
                curiosity=CuriosityLedger(brain.memory.db_path.parent),
                skills=SkillGraph(brain.memory.db_path.parent),
            )
            _handle_ultimate_bootstrap(event, warmup_stores)
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
        if event.type in {"user_message", "task_created", "task_completed", "deadline_failed", "terminal_error", "system_state", "environment_observation", "voice_observation"}:
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
            if event.type in {"user_message", "task_created", "task_completed", "deadline_failed", "terminal_error", "system_state", "environment_observation", "voice_observation"}:
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
