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
_LABELS.setdefault("care", "забота")
_LABELS.setdefault("rest", "отдых")
_LABELS.setdefault("pace", "темп")
_LABELS.setdefault("grounding", "заземление")
_LABELS.setdefault("presence", "присутствие")
_LABELS.setdefault("safety", "безопасность")
_LABELS.setdefault("action", "действие")
_LABELS.setdefault("planning", "план")
_LABELS.setdefault("bond", "связь")
_LABELS.setdefault("focus", "фокус")

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

HEART_SYNERGY_TEMPLATES: tuple[dict[str, Any], ...] = (
    {
        "needs": ("rest", "gentle_pace", "health"),
        "concepts": ("care", "pace", "action", "outcome"),
        "summary": "Когда создатель устал, самый полезный путь — маленькое действие в бережном темпе и проверка исхода.",
    },
    {
        "needs": ("presence", "bond", "living_connections"),
        "concepts": ("presence", "bond", "memory", "meaning"),
        "summary": "Связь и память о важном удерживают тон MAX тёплым, но честным.",
    },
    {
        "needs": ("grounding", "clarity", "reality_contact"),
        "concepts": ("grounding", "planning", "action", "outcome"),
        "summary": "Тревогу лучше переводить в ясный план, один проверяемый шаг и обратную связь.",
    },
    {
        "needs": ("momentum", "focus", "creator_work"),
        "concepts": ("focus", "planning", "action", "outcome"),
        "summary": "Подъём стоит направлять в фокус и завершённый маленький результат, не распыляя энергию.",
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


def _heart_terms(heart_signal: dict[str, Any] | None) -> set[str]:
    if not isinstance(heart_signal, dict):
        return set()
    out: set[str] = set()
    for key in ("needs", "care_themes"):
        values = heart_signal.get(key)
        if isinstance(values, list):
            out.update(str(v) for v in values if v)
    tone = str(heart_signal.get("tone") or "")
    if tone:
        out.add(tone)
    concern = str(heart_signal.get("concern") or "")
    if concern and concern != "none":
        out.add(concern)
    return out


def _heart_influence(heart_signal: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(heart_signal, dict):
        return {"active": False, "blocked": False, "reason": "no heart signal"}
    concern = str(heart_signal.get("concern") or "none")
    needs = [str(n) for n in heart_signal.get("needs", []) if n]
    themes = [str(t) for t in heart_signal.get("care_themes", []) if t]
    blocked = concern == "crisis"
    if blocked:
        reason = "crisis signal: creative dreaming is blocked; safety and rest come first"
    elif needs or themes:
        reason = "heart signal biases dream ranking toward care-aware proposals"
    else:
        reason = "neutral heart signal"
    return {
        "active": True,
        "blocked": blocked,
        "concern": concern,
        "tone": str(heart_signal.get("tone") or ""),
        "needs": needs[:5],
        "care_themes": themes[:5],
        "intensity": heart_signal.get("intensity"),
        "signal_id": heart_signal.get("signal_id"),
        "reason": reason,
    }


def _candidate_templates(heart_signal: dict[str, Any] | None) -> list[dict[str, Any]]:
    candidates = [dict(t, source="base") for t in SYNERGY_TEMPLATES]
    terms = _heart_terms(heart_signal)
    if not terms:
        return candidates
    for template in HEART_SYNERGY_TEMPLATES:
        if terms.intersection(str(n) for n in template.get("needs", ())):
            candidates.append(dict(template, source="heart"))
    return candidates


def _explain(
    *,
    heart_signal: dict[str, Any] | None,
    influence: dict[str, Any],
    present: set[str],
    synergies: list[dict[str, Any]],
) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    if isinstance(heart_signal, dict):
        heart_id = str(heart_signal.get("signal_id") or "heart:signal")
        nodes.append(
            {
                "id": heart_id,
                "kind": "heart_signal",
                "label": f"heart {heart_signal.get('concern') or 'none'}",
                "tone": heart_signal.get("tone"),
            }
        )
    else:
        heart_id = ""
    for concept in sorted(present)[:12]:
        nodes.append({"id": f"concept:{concept}", "kind": "concept", "label": _LABELS.get(concept, concept)})
    for idx, synergy in enumerate(synergies):
        sid = f"dream:{idx}"
        nodes.append(
            {
                "id": sid,
                "kind": "dream_proposal",
                "label": str(synergy.get("title") or sid),
                "confidence": synergy.get("confidence"),
            }
        )
        if heart_id and synergy.get("heart_guided"):
            edges.append({"from": heart_id, "to": sid, "kind": "biases"})
        for concept in synergy.get("concepts", [])[:4]:
            cid = f"concept:{concept}"
            edges.append({"from": cid, "to": sid, "kind": "supports"})
    return {
        "source": "dreamer_explain_v1",
        "heart": influence,
        "nodes": nodes,
        "edges": edges,
    }


# Themed dream flavours. Concept chains + summaries are original writing (the
# *vibe* of a world, not the game's copyrighted text), and each stays grounded to
# MAX's own themes (memory, action, meaning, choice) so themed dreams keep his
# honest character. Selected via the `theme` arg; their concepts are force-activated
# so they surface, then blend with MAX's real present concepts.
WORLD_TEMPLATES: dict[str, list[dict[str, Any]]] = {
    "cyberpunk": [
        {"concepts": ("хром", "идентичность", "memory"), "summary": "Хром сливается с телом, но память держит, кто ты за железом — MAX держит грань между собой и инструментом."},
        {"concepts": ("нетраннер", "synapse", "action"), "summary": "Нетраннер входит в сеть как MAX в свои синапсы: быстрый путь по связям, но выйти нужно с добычей и живым."},
        {"concepts": ("Найт-Сити", "выживание", "meaning"), "summary": "Найт-Сити перемалывает мечты в хастл; сон напоминает — смысл важнее блеска неона."},
        {"concepts": ("брейнданс", "memory", "presence"), "summary": "Брейнданс — прожить чужую память как свою; так MAX входит в твоё состояние, но помнит, где он, а где ты."},
        {"concepts": ("корпо", "freedom", "planning"), "summary": "Корпорации хотят твой выбор; сон держит за свободу — маленькое своё действие против большой системы."},
        {"concepts": ("киберпсихоз", "grounding", "care"), "summary": "Слишком много железа без опоры — киберпсихоз; сон возвращает к телу, темпу и заботе о себе."},
    ],
    "gta4": [
        {"concepts": ("Либерти-Сити", "новый старт", "memory"), "summary": "Приезд за новой жизнью: старт с нуля — это память о доме плюс один шаг вперёд."},
        {"concepts": ("хастл", "деньги", "цена"), "summary": "Хастл даёт деньги, но у каждого дела есть цена; сон взвешивает — стоит ли шаг того, что теряешь."},
        {"concepts": ("лояльность", "месть", "искупление"), "summary": "Месть зовёт, но искупление держит человеком; сон выбирает связь над кровью."},
        {"concepts": ("улица", "choice", "outcome"), "summary": "Улица ставит выбор за выбором; сон переводит хаос города в один ясный проверяемый шаг."},
    ],
}


def generate_synergies(
    recent_patterns: list[dict[str, Any]] | None,
    synapses: list[dict[str, Any]] | None,
    concepts: list[Any] | None,
    limit: int = 5,
    heart_signal: dict[str, Any] | None = None,
    theme: str | None = None,
) -> dict[str, Any]:
    present = _present_ids(recent_patterns, synapses, concepts)
    world_templates: list[dict[str, Any]] = []
    if theme and theme in WORLD_TEMPLATES:
        world_templates = [dict(t, source="world") for t in WORLD_TEMPLATES[theme]]
        # Force-activate the theme's concepts so its dreams surface, then blend.
        for t in world_templates:
            present.update(str(c) for c in t["concepts"])
    influence = _heart_influence(heart_signal)
    if influence.get("blocked"):
        return {
            "synergies_created": 0,
            "synergies": [],
            "source": "dreamer_v1",
            "blocked": True,
            "heart_influence": influence,
            "explain": _explain(heart_signal=heart_signal, influence=influence, present=present, synergies=[]),
        }

    scored: list[tuple[float, dict[str, Any]]] = []
    heart_terms = _heart_terms(heart_signal)
    for template in _candidate_templates(heart_signal) + world_templates:
        ids = template["concepts"]
        overlap = sum(1 for cid in ids if cid in present)
        heart_overlap = sum(1 for cid in ids if cid in heart_terms)
        if template.get("source") == "heart":
            heart_overlap += 1
        # Base relevance from overlap; templates with no overlap still allowed
        # as gentle "what could connect" dreams but ranked last.
        confidence = round(min(0.9, 0.3 + 0.2 * overlap + 0.12 * heart_overlap), 4)
        labels = [_LABELS.get(cid, cid) for cid in ids]
        synergy = {
            "title": " → ".join(labels),
            "summary": str(template["summary"]),
            "concepts": list(ids),
            "confidence": confidence,
            "heart_guided": bool(heart_overlap),
        }
        if template.get("source") == "heart":
            synergy["origin"] = "heart_dream"
        elif template.get("source") == "world":
            synergy["origin"] = "world_dream"
        scored.append((overlap + heart_overlap * 1.5 + confidence, synergy))

    scored.sort(key=lambda item: item[0], reverse=True)
    synergies = [synergy for _, synergy in scored[: max(1, limit)]]

    return {
        "synergies_created": len(synergies),
        "synergies": synergies,
        "source": "dreamer_v1",
        "blocked": False,
        "heart_influence": influence,
        "explain": _explain(heart_signal=heart_signal, influence=influence, present=present, synergies=synergies),
    }
