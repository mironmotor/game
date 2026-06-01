"""Memory compression / concept crystallization for Max17.

The goal is to turn long experience fragments into short, explainable
semantic labels: many events -> one compact concept node.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_]+")

CONCEPT_RULES: tuple[dict[str, Any], ...] = (
    {
        "concept": "core",
        "label": "ядро",
        "aliases": ["Max17 core", "cognitive core", "ядро"],
        "triggers": ["max17", "mark17", "ядро", "cognitive core", "brain", "brain-like", "architecture", "архитектура"],
    },
    {
        "concept": "memory",
        "label": "память",
        "aliases": ["memory", "recall", "hippocampus", "память"],
        "triggers": ["memory", "память", "recall", "hippocampus", "vector", "semantic", "remember", "помнить", "вспомнить"],
    },
    {
        "concept": "synapse",
        "label": "связь",
        "aliases": ["synapse", "association", "graph", "синапс", "связь"],
        "triggers": ["synapse", "synapses", "синапс", "синапсы", "связь", "связи", "association", "graph", "weight", "вес"],
    },
    {
        "concept": "consolidation",
        "label": "сжатие",
        "aliases": ["sleep consolidation", "concept crystallization", "сжатие"],
        "triggers": ["sleep", "сон", "consolidation", "compress", "compression", "сжатие", "сжать", "pattern", "patterns", "паттерн", "паттерны", "кристаллизация"],
    },
    {
        "concept": "action",
        "label": "действие",
        "aliases": ["action", "execution", "task", "действие"],
        "triggers": ["action", "действие", "task", "задача", "done", "execute", "execution", "сделал", "выполнил", "делать"],
    },
    {
        "concept": "outcome",
        "label": "результат",
        "aliases": ["outcome", "result", "feedback", "результат"],
        "triggers": ["outcome", "result", "результат", "success", "failure", "feedback", "успех", "провал", "обратная связь"],
    },
    {
        "concept": "planning",
        "label": "план",
        "aliases": ["planner", "next step", "план"],
        "triggers": ["plan", "planner", "planning", "next step", "что дальше", "план", "следующий шаг", "дальше"],
    },
    {
        "concept": "interface",
        "label": "интерфейс",
        "aliases": ["Game HUD", "UI", "интерфейс"],
        "triggers": ["game", "hud", "ui", "interface", "localhost", "basepath", "route", "api", "интерфейс", "экран"],
    },
    {
        "concept": "debugging",
        "label": "отладка",
        "aliases": ["debugging", "terminal error", "отладка"],
        "triggers": ["error", "ошибка", "terminal", "build", "lint", "npm", "dependency", "torch", "numpy", "traceback", "зависимость", "терминал", "сборка"],
    },
    {
        "concept": "agency",
        "label": "агентность",
        "aliases": ["agency", "self-improvement", "агентность"],
        "triggers": ["goal", "цель", "autonomy", "agent", "агент", "decision", "self-improvement", "самоулучшение", "выбор"],
    },
)

STOPWORDS = {
    "and",
    "the",
    "for",
    "with",
    "this",
    "that",
    "это",
    "как",
    "что",
    "для",
    "или",
    "через",
    "после",
    "когда",
    "unknown",
}


def normalize_text(text: str) -> str:
    raw = str(text or "").casefold().replace("ё", "е")
    return " ".join(TOKEN_RE.findall(raw))


def extract_keywords(text: str) -> list[str]:
    tokens = [
        token
        for token in normalize_text(text).split()
        if len(token) >= 3 and token not in STOPWORDS
    ]
    counts = Counter(tokens)
    return [token for token, _ in counts.most_common(12)]


def _context_text(context: dict[str, Any] | None) -> str:
    if not isinstance(context, dict):
        return ""
    parts: list[str] = []
    for key in ("current_topic", "active_goal", "current_mode", "last_user_intent", "suggested_next_step"):
        value = context.get(key)
        if value:
            parts.append(str(value))
    return " ".join(parts)


def _trigger_hits(normalized: str, triggers: list[str]) -> list[str]:
    hits: list[str] = []
    padded = f" {normalized} "
    for trigger in triggers:
        normalized_trigger = normalize_text(trigger)
        if not normalized_trigger:
            continue
        if " " in normalized_trigger:
            if normalized_trigger in normalized:
                hits.append(trigger)
        elif f" {normalized_trigger} " in padded:
            hits.append(trigger)
    return hits


def _concept_record(rule: dict[str, Any], *, source_text: str, confidence: float, reason: str, hits: list[str]) -> dict[str, Any]:
    return {
        "concept": str(rule["concept"]),
        "label": str(rule["label"]),
        "source_text": source_text[:320],
        "confidence": round(max(0.0, min(1.0, confidence)), 4),
        "reason": reason,
        "aliases": [str(item) for item in rule.get("aliases", [])],
        "related_terms": hits[:8],
    }


def compress_to_concept(text: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
    source_text = " ".join(str(text or "").split())
    combined = f"{source_text} {_context_text(context)}".strip()
    normalized = normalize_text(combined)
    keywords = extract_keywords(combined)

    scored: list[tuple[float, dict[str, Any], list[str]]] = []
    for rule in CONCEPT_RULES:
        hits = _trigger_hits(normalized, [str(item) for item in rule["triggers"]])
        if not hits:
            continue
        score = len(hits) * 1.0
        if any(str(alias).casefold() in combined.casefold() for alias in rule.get("aliases", [])):
            score += 0.5
        scored.append((score, rule, hits))

    if not scored:
        fallback = {
            "concept": "context",
            "label": "контекст",
            "aliases": ["context", "контекст"],
            "triggers": [],
        }
        reason = "No dominant concept trigger found; kept as a generic context node."
        primary = _concept_record(fallback, source_text=source_text, confidence=0.18, reason=reason, hits=keywords[:5])
        return {
            "primary": primary,
            "related": [],
            "keywords": keywords,
            "source": "concept_compression_v0",
        }

    hit_concepts = {str(rule["concept"]) for _, rule, _ in scored}
    architecture_parts = {"memory", "synapse", "consolidation", "planning", "outcome", "action", "agency"}
    if "core" in hit_concepts and len(hit_concepts & architecture_parts) >= 3:
        boosted: list[tuple[float, dict[str, Any], list[str]]] = []
        for score, rule, hits in scored:
            if rule["concept"] == "core":
                boosted.append((score + 3.0, rule, [*hits, "architecture stack"]))
            else:
                boosted.append((score, rule, hits))
        scored = boosted

    scored.sort(key=lambda item: (item[0], len(item[2])), reverse=True)
    top_score, top_rule, top_hits = scored[0]
    second = scored[1] if len(scored) > 1 else None
    total_hits = sum(score for score, _, _ in scored)
    confidence = min(0.96, 0.35 + (top_score / max(total_hits, 1.0)) * 0.45 + min(top_score / 5, 1.0) * 0.16)

    primary_rule = top_rule
    primary_hits = top_hits
    if second and second[0] >= max(2.0, top_score * 0.72):
        _, second_rule, second_hits = second
        primary_rule = {
            "concept": f"{top_rule['concept']}-{second_rule['concept']}",
            "label": f"{top_rule['label']}-{second_rule['label']}",
            "aliases": [*top_rule.get("aliases", [])[:2], *second_rule.get("aliases", [])[:2]],
            "triggers": [],
        }
        primary_hits = [*top_hits, *second_hits]
        confidence = min(0.94, confidence + 0.06)

    reason = "Detected repeated terms: " + ", ".join(primary_hits[:8]) + "."
    primary = _concept_record(primary_rule, source_text=source_text, confidence=confidence, reason=reason, hits=primary_hits)
    related = [
        _concept_record(
            rule,
            source_text=source_text,
            confidence=min(0.9, 0.25 + score / max(total_hits, 1.0) * 0.6),
            reason="Related trigger hits: " + ", ".join(hits[:6]) + ".",
            hits=hits,
        )
        for score, rule, hits in scored[1:5]
    ]

    return {
        "primary": primary,
        "related": related,
        "keywords": keywords,
        "source": "concept_compression_v0",
    }


def _memory_summary(memory: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in ("summary", "text", "reinforce", "event_type", "reason"):
        value = memory.get(key)
        if value:
            parts.append(str(value))
    payload = memory.get("payload")
    if isinstance(payload, dict):
        for key in ("summary", "text", "note", "reinforce"):
            value = payload.get(key)
            if value:
                parts.append(str(value))
    return " ".join(parts)


def compress_memory_batch(memories: list[dict[str, Any]]) -> dict[str, Any]:
    text = " ".join(_memory_summary(memory) for memory in memories if isinstance(memory, dict))
    result = compress_to_concept(text)
    result["memory_count"] = len(memories)
    return result
