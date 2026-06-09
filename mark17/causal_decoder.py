"""Causal decoder for Max17.

Translates an activated concept/synapse subgraph into short causal phrases in
Russian: "память → план → результат". It is deterministic and intentionally
modest — it explains the active wiring, it does not claim understanding.
"""

from __future__ import annotations

from typing import Any

from mark17.concept_codec import CANON_ORDER

# Phrase for an ordered pair of concepts: (relation, sentence).
PAIR_PHRASES: dict[tuple[str, str], tuple[str, str]] = {
    ("core", "memory"): ("опирается на", "Ядро опирается на память."),
    ("core", "action"): ("направляет", "Ядро направляет действие."),
    ("core", "planning"): ("задаёт", "Ядро задаёт направление плана."),
    ("memory", "planning"): ("усиливает", "Память помогает выбрать следующий шаг."),
    ("memory", "action"): ("подсказывает", "Память подсказывает действие."),
    ("memory", "outcome"): ("связана с", "Память связывает прошлый опыт с результатом."),
    ("synapse", "memory"): ("укрепляет", "Связи укрепляют память."),
    ("intuition", "memory"): ("черпает из", "Интуиция черпается из памяти."),
    ("intuition", "planning"): ("ускоряет", "Интуиция ускоряет выбор шага."),
    ("subconscious", "memory"): ("питает", "Подсознание питает память глубоким опытом."),
    ("debugging", "action"): ("требует", "Отладка требует конкретного действия."),
    ("performance", "core"): ("ускоряет", "Скорость ответа ускоряет работу ядра."),
    ("performance", "action"): ("требует", "Скорость требует горячего пути без холодных чтений."),
    ("planning", "action"): ("ведёт к", "План ведёт к действию."),
    ("planning", "outcome"): ("ведёт к", "План доводит до проверяемого результата."),
    ("action", "outcome"): ("даёт", "Действие даёт результат."),
    ("outcome", "memory"): ("обновляет", "Результат обновляет память."),
    ("agency", "action"): ("выбирает", "Агентность выбирает действие."),
    ("dream", "synapse"): ("создаёт", "Сон создаёт новые связи."),
    ("interface", "action"): ("показывает", "Интерфейс показывает действие пользователю."),
}

DEFAULT_RELATION = "связан с"


def _label_map(concepts: list[dict[str, Any]]) -> dict[str, str]:
    return {str(c.get("id")): str(c.get("label") or c.get("id")) for c in concepts if isinstance(c, dict)}


def _ordered_ids(concepts: list[dict[str, Any]], *, limit: int) -> list[str]:
    ids: list[str] = []
    for concept in concepts:
        cid = str(concept.get("id")) if isinstance(concept, dict) else ""
        if cid and cid not in ids:
            ids.append(cid)

    def key(cid: str) -> int:
        try:
            return CANON_ORDER.index(cid)
        except ValueError:
            return len(CANON_ORDER)

    return sorted(ids, key=key)[:limit]


def decode_causal_chain(
    active_graph: dict[str, Any],
    working_memory: dict[str, Any] | None = None,
    plan: dict[str, Any] | None = None,
    outcome: dict[str, Any] | None = None,
    *,
    limit: int = 4,
) -> dict[str, Any]:
    concepts = active_graph.get("activated_concepts") if isinstance(active_graph, dict) else None
    concepts = concepts if isinstance(concepts, list) else []
    labels = _label_map(concepts)
    ordered = _ordered_ids(concepts, limit=limit)

    causal_chain: list[dict[str, Any]] = []
    for left, right in zip(ordered, ordered[1:]):
        relation, text = PAIR_PHRASES.get(
            (left, right),
            (DEFAULT_RELATION, f"{labels.get(left, left)} связан с {labels.get(right, right)}."),
        )
        causal_chain.append(
            {
                "from": labels.get(left, left),
                "relation": relation,
                "to": labels.get(right, right),
                "text": text,
            }
        )

    chain_labels = [labels.get(cid, cid) for cid in ordered]
    if chain_labels:
        summary = "Сейчас активна связка: " + " → ".join(chain_labels) + "."
    else:
        summary = "Сейчас нет ярко активной концептной связки."

    answer_hint = _answer_hint(ordered, plan, outcome, working_memory)

    return {
        "summary": summary,
        "causal_chain": causal_chain,
        "answer_hint": answer_hint,
        "source": "causal_decoder_v0",
    }


def _answer_hint(
    ordered: list[str],
    plan: dict[str, Any] | None,
    outcome: dict[str, Any] | None,
    working_memory: dict[str, Any] | None,
) -> str:
    present = set(ordered)

    if "performance" in present:
        return (
            "Ускорить ответ можно через горячий путь: брать только активные концепты и "
            "top-K связи, а холодную память оставлять для sleep/consolidation."
        )

    if {"planning", "action", "outcome"} & present:
        if isinstance(plan, dict):
            actions = plan.get("actions")
            if isinstance(actions, list) and actions and isinstance(actions[0], dict):
                title = str(actions[0].get("title") or "").strip()
                if title:
                    return f"Следующий проверяемый шаг: {title}."
        step = ""
        if isinstance(working_memory, dict):
            step = str(working_memory.get("suggested_next_step") or "").strip()
        if step:
            return f"Следующий проверяемый шаг: {step}."
        return "Я использую прошлый контекст, чтобы предложить следующий проверяемый шаг."

    if isinstance(outcome, dict) and outcome.get("next_adjustment"):
        return f"Корректировка по результату: {outcome['next_adjustment']}"

    if "memory" in present:
        return "Я опираюсь на похожие смыслы из памяти, чтобы держать ответ в контексте."

    return "Я держу ответ в текущем контексте сессии."
