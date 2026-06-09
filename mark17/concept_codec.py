"""Concept codec for Max17 — the front door of the hot path.

Turns raw text / event payloads into a few compact concept "neurons":

    {"id", "label", "confidence", "source_terms", "aliases"}

This runs purely in memory (no SQLite, no scan), so the downstream hot-path
modules (active_graph, causal_decoder, intuitive_memory) can reason over a tiny
activated structure instead of cold-reading the whole graph on every request.

It reuses the deterministic dictionary from concept_compression.py and extends
it with the Max17-specific concepts the brain talks about: intuition,
subconscious, dream and performance.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from mark17.concept_compression import CONCEPT_RULES

TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_]+")

CONTEXT_KEYS = (
    "current_topic",
    "active_goal",
    "current_mode",
    "last_user_intent",
    "suggested_next_step",
)

# Concepts beyond concept_compression.CONCEPT_RULES. Kept separate so the
# existing concept_compression_v0 output stays byte-stable.
EXTRA_RULES: tuple[dict[str, Any], ...] = (
    {
        "concept": "intuition",
        "label": "интуиция",
        "aliases": ["intuition", "fast recall", "интуиция", "чутьё"],
        "triggers": [
            "intuition", "интуиция", "чутье", "чутьё", "догадка", "instinct",
            "felt sense", "ощущение", "интуитивно",
        ],
    },
    {
        "concept": "subconscious",
        "label": "подсознание",
        "aliases": ["subconscious", "deep memory", "подсознание"],
        "triggers": [
            "subconscious", "подсознание", "deep memory", "глубокая память",
            "cold memory", "холодная память", "background", "фон", "фоновый",
        ],
    },
    {
        "concept": "dream",
        "label": "сон",
        "aliases": ["dream", "internal thought", "сон", "сновидение"],
        "triggers": [
            "dream", "сон", "сновидение", "internal_dream", "synergy", "синергия",
            "ассоциаци", "фантаз", "reverie", "размышлен",
        ],
    },
    {
        "concept": "performance",
        "label": "скорость",
        "aliases": ["performance", "latency", "hot path", "скорость"],
        "triggers": [
            "performance", "latency", "латентн", "ускор", "скорост", "быстр",
            "медлен", "тормоз", "секунд", "оптимиз", "optimize", "hot path",
            "cold read", "холодн", "throughput", "ms", "миллисекунд",
        ],
    },
)

# Order used for chaining; lower index = closer to the "cause" end.
CANON_ORDER: tuple[str, ...] = (
    "core",
    "memory",
    "synapse",
    "intuition",
    "subconscious",
    "debugging",
    "performance",
    "interface",
    "consolidation",
    "planning",
    "action",
    "outcome",
    "agency",
    "dream",
)

CODEC_RULES: tuple[dict[str, Any], ...] = (*CONCEPT_RULES, *EXTRA_RULES)


def normalize_text(text: Any) -> str:
    raw = str(text or "").casefold().replace("ё", "е")
    return " ".join(TOKEN_RE.findall(raw))


def context_text(context: dict[str, Any] | None) -> str:
    if not isinstance(context, dict):
        return ""
    parts: list[str] = []
    for key in CONTEXT_KEYS:
        value = context.get(key)
        if value:
            parts.append(str(value))
    return " ".join(parts)


def _trigger_hits(normalized: str, triggers: list[str]) -> list[str]:
    padded = f" {normalized} "
    hits: list[str] = []
    for trigger in triggers:
        norm = normalize_text(trigger)
        if not norm:
            continue
        if " " in norm:
            if norm in normalized:
                hits.append(trigger)
        elif f" {norm} " in padded:
            hits.append(trigger)
    return hits


def extract_keywords(text: str, *, limit: int = 12) -> list[str]:
    tokens = [token for token in normalize_text(text).split() if len(token) >= 3]
    return [token for token, _ in Counter(tokens).most_common(limit)]


def extract_concepts(
    text: str,
    working_memory: dict[str, Any] | None = None,
    *,
    limit: int = 6,
) -> list[dict[str, Any]]:
    """Activate concept neurons for a request. Pure in-memory, no DB."""
    combined = f"{str(text or '')} {context_text(working_memory)}".strip()
    normalized = normalize_text(combined)
    if not normalized:
        return []

    scored: list[tuple[dict[str, Any], list[str]]] = []
    total_hits = 0
    for rule in CODEC_RULES:
        hits = _trigger_hits(normalized, [str(t) for t in rule["triggers"]])
        if not hits:
            continue
        scored.append((rule, hits))
        total_hits += len(hits)

    concepts: list[dict[str, Any]] = []
    for rule, hits in scored:
        confidence = min(
            0.95,
            0.4 + (len(hits) / max(total_hits, 1)) * 0.4 + min(len(hits) / 4, 1.0) * 0.15,
        )
        concepts.append(
            {
                "id": str(rule["concept"]),
                "label": str(rule["label"]),
                "confidence": round(confidence, 4),
                "source_terms": hits[:6],
                "aliases": [str(a) for a in rule.get("aliases", [])],
            }
        )

    concepts.sort(key=lambda c: (-float(c["confidence"]), _canon_index(c["id"]), c["id"]))
    return concepts[:limit]


def _canon_index(concept_id: str) -> int:
    try:
        return CANON_ORDER.index(concept_id)
    except ValueError:
        return len(CANON_ORDER)


def compress_text_to_concepts(
    text: str,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compress text into a primary concept + the activated concept set."""
    concepts = extract_concepts(text, context)
    keywords = extract_keywords(f"{str(text or '')} {context_text(context)}")
    primary = (
        concepts[0]
        if concepts
        else {
            "id": "context",
            "label": "контекст",
            "confidence": 0.18,
            "source_terms": keywords[:5],
            "aliases": ["context", "контекст"],
        }
    )
    return {
        "primary": primary,
        "concepts": concepts,
        "keywords": keywords,
        "source": "concept_codec_v0",
    }
