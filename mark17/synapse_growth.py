"""Self-seeded synapse growth — Phase 3 autonomous flywheel for Max17.

The Phase 2 flywheel can only learn topics the USER hit a wall on (gaps queued in
the CuriosityLedger). Phase 3 lets the core ask its OWN questions: it reads the
most salient nodes already in its synapse graph and proposes NEW topics to learn
about. Those are queued as self-sourced gaps and learned by the same proven
pipeline (web_research → distil facts → grow synapses), so the graph keeps
growing from real sources even while the user is away — gated by MAX17_AUTO_WEB.

Seed proposal here is pure, local and deterministic (no network): it only mines
readable terms out of the graph's strongest edges. The actual learning stays in
json_cli's curiosity pass, so nothing leaves the machine from this module.
"""

from __future__ import annotations

import re
from typing import Any

from mark17.curiosity import _STOP, _TOKEN_RE, _topic_key
from mark17.synapse_graph import SynapseGraph

# Structural vocabulary the growth loop writes into edge summaries and uses for
# node types — scaffolding, never an interesting thing to go learn about.
_STRUCTURAL = frozenset(
    {
        "concept", "topic", "goal", "intent", "mode", "route", "event", "answer",
        "plan", "action", "memory", "scene", "sensory", "channel", "adaptation",
        "supports", "grounded", "reinforces", "related", "leads", "updates",
        "produced", "human", "readable", "near", "runs", "creates", "suggests",
        "usually", "routes", "routed", "context", "expresses", "belongs",
        "semantic", "compressed", "node", "nodes", "max17", "mark17", "unknown",
        "general", "chat", "game", "hud", "session", "idle", "self", "evaluation",
    }
)

# 16-hex = a _stable_id() node (event/goal/answer/plan/action) — not readable.
_HEX16 = re.compile(r"^[0-9a-f]{16}$")


def _readable(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text or _HEX16.match(text):
        return None
    return text


def _phrase_from(text: str) -> str:
    """Reduce a node id / edge summary to a salient 1–3 word topic phrase.

    Edge summaries put the meaningful label after the last ': ' (e.g. 'event
    grounded in concept: webrtc' → 'webrtc'), so prefer that tail, then strip
    stopwords and structural scaffolding.
    """
    if ": " in text:
        text = text.rsplit(": ", 1)[1]
    tokens = [
        token
        for token in _TOKEN_RE.findall(text.casefold().replace("ё", "е"))
        if len(token) >= 3 and token not in _STOP and token not in _STRUCTURAL and not token.isdigit()
    ]
    return " ".join(tokens[:3])


def propose_seeds(
    synapse_graph: SynapseGraph,
    *,
    limit: int = 3,
    scan: int = 80,
    avoid: set[str] | frozenset[str] | tuple[str, ...] = (),
) -> list[str]:
    """Propose NEW topics to learn, mined from the graph's strongest edges.

    Returns readable web-research queries ranked by how central they are (edge
    weight × evidence). Skips structural scaffolding, hex node ids and anything
    whose topic-key is already in ``avoid`` (the ledger's known keys), so the
    core doesn't re-ask what it already learned. Deterministic and offline.
    """
    avoid_set = set(avoid)
    scored: dict[str, float] = {}   # topic_key -> accumulated salience
    display: dict[str, str] = {}    # topic_key -> best readable phrase
    best_weight: dict[str, float] = {}

    rows = synapse_graph.get_top_synapses(limit=max(scan, limit * 8))
    for syn in rows:
        weight = float(syn.get("weight") or 0.0)
        evidence = int(syn.get("evidence_count") or 1)
        salience = weight * (1.0 + min(evidence, 10) * 0.05)
        for raw in (syn.get("source_id"), syn.get("target_id"), syn.get("summary")):
            readable = _readable(raw)
            if not readable:
                continue
            phrase = _phrase_from(readable)
            if not phrase:
                continue
            key = _topic_key(phrase)
            if not key or key in avoid_set:
                continue
            scored[key] = scored.get(key, 0.0) + salience
            if salience >= best_weight.get(key, -1.0):
                best_weight[key] = salience
                display[key] = phrase

    ranked = sorted(scored, key=lambda k: (scored[k], k), reverse=True)
    return [display[key] for key in ranked[: max(1, limit)]]
