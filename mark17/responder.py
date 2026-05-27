"""Deterministic response composer for Max17.

This module gives the cognitive telemetry a small human-readable voice.
It does not call external APIs and does not pretend to be a full LLM.
"""

from __future__ import annotations

from typing import Any

from mark17.events import Event
from mark17.principles import REALITY_CONTACT_HINT

CAPABILITY_TRIGGERS = (
    "что умеешь",
    "что еще умеешь",
    "что ты умеешь",
    "что можешь",
    "что ты можешь",
    "какие функции",
    "возможности",
    "who are you",
    "what can you do",
)

MEMORY_QUESTION_TRIGGERS = (
    "что ты помнишь",
    "что помнишь",
    "что в памяти",
    "после sleep",
    "после сна",
    "после консолидации",
    "sleep consolidation",
    "what do you remember",
    "memory status",
)

DEBUG_TRIGGERS = (
    "покажи debug",
    "покажи дебаг",
    "покажи телеметрию",
    "почему ты так ответил",
    "show debug",
    "show telemetry",
    "why did you answer",
)

CAPABILITY_ANSWER = (
    "Я Max17, когнитивное ядро Game в текущей v0.4. Сейчас я принимаю сообщения из HUD, "
    "маршрутизирую события через meta-controller, запоминаю важные события в SQLite memory, "
    "вспоминаю похожие события, оцениваю свои реакции через critic/self-evaluation, "
    "отслеживаю задачи created/completed/failed и показываю когнитивный статус в HUD. "
    "Gemini без ключа не использую; этот ответ собран deterministic composer. "
    f"{REALITY_CONTACT_HINT}"
)


def _clamp_confidence(value: Any) -> float:
    if isinstance(value, (int, float)):
        return max(0.0, min(1.0, float(value)))
    return 0.0


def _confidence(result: dict[str, Any]) -> float:
    plasticity = result.get("plasticity")
    if isinstance(plasticity, dict):
        return _clamp_confidence(plasticity.get("confidence"))

    decision = result.get("decision")
    if isinstance(decision, dict):
        return _clamp_confidence(decision.get("confidence"))

    return 0.0


def _clean_public_text(value: Any, *, limit: int = 220) -> str:
    text = str(value or "").strip().replace("\n", " ")
    if not text:
        return ""

    low = text.casefold()
    blocked = (
        "routed to llm",
        "handled through",
        "resolved by memory route",
        "reinforced through plasticity",
        "self evaluation",
        "evaluated as",
        "llm with status",
        "route:",
        "recalled_with",
        "similar_to",
        "routed_to",
        "evaluated_as",
        "adapted_by",
    )
    if any(phrase in low for phrase in blocked):
        return ""

    for prefix in (
        "task_completed: ",
        "task_created: ",
        "deadline_failed: ",
        "user_message: ",
        "consolidated_pattern: ",
    ):
        if text.startswith(prefix):
            text = text[len(prefix) :]

    return " ".join(text.split()).rstrip(".")[:limit]


def _first_recalled_summary(result: dict[str, Any]) -> str:
    memory = result.get("memory")
    if not isinstance(memory, dict):
        return ""

    recalled = memory.get("recalled")
    if not isinstance(recalled, list) or not recalled:
        return ""

    first = recalled[0]
    if not isinstance(first, dict):
        return ""

    summary = first.get("summary") or first.get("reinforce") or first.get("event_type")
    return _clean_public_text(summary) if summary else ""


def _first_semantic_summary(result: dict[str, Any]) -> str:
    memory = result.get("memory")
    if not isinstance(memory, dict):
        return ""

    semantic = memory.get("semantic")
    if not isinstance(semantic, list) or not semantic:
        return ""

    first = semantic[0]
    if not isinstance(first, dict):
        return ""

    summary = first.get("summary") or first.get("reinforce") or first.get("text")
    return _clean_public_text(summary) if summary else ""


def _first_synapse_summary(result: dict[str, Any]) -> str:
    synapses = result.get("synapses")
    if not isinstance(synapses, dict):
        return ""

    top = synapses.get("top")
    if not isinstance(top, list) or not top:
        return ""

    first = None
    preferred_relations = {"similar_to", "recalled_with", "completed_after", "failed_after", "reinforces"}
    for candidate in top:
        if isinstance(candidate, dict) and candidate.get("relation_type") in preferred_relations:
            first = candidate
            break
    if first is None:
        first = top[0]

    if not isinstance(first, dict):
        return ""

    summary = first.get("summary")
    if summary:
        return _clean_public_text(summary, limit=180)
    return ""


def _next_adaptation(result: dict[str, Any], user_text: str) -> str:
    adaptation = result.get("next_adaptation")
    if not adaptation:
        plasticity = result.get("plasticity")
        if isinstance(plasticity, dict):
            adaptation = plasticity.get("hint")

    text = str(adaptation or "").strip()
    if not text:
        return "продолжить копить контекст и проверять повторяющиеся паттерны"

    if user_text and text.lower() == user_text.lower():
        return "закрепить этот запрос как новый паттерн и связать его с будущими результатами"

    return text.rstrip(".")[:220]


def _confidence_tone(confidence: float) -> str:
    percent = round(confidence * 100)
    if confidence < 0.35:
        return f"Уверенность пока низкая ({percent}%), поэтому это осторожный вывод ядра."
    if confidence < 0.7:
        return f"Уверенность средняя ({percent}%): паттерн уже виден, но ему нужен контекст."
    return f"Уверенность высокая ({percent}%): паттерн выглядит устойчивым."


def _self_evaluation_reason(self_evaluation: dict[str, Any] | None) -> str:
    if not isinstance(self_evaluation, dict):
        return ""
    reason = self_evaluation.get("reason")
    return str(reason).strip().rstrip(".")[:180] if reason else ""


def _is_capability_question(user_text: str) -> bool:
    normalized = user_text.casefold()
    if any(trigger in normalized for trigger in CAPABILITY_TRIGGERS):
        return True
    return "что" in normalized and ("умеешь" in normalized or "можешь" in normalized)


def _is_memory_question(user_text: str) -> bool:
    normalized = user_text.casefold()
    if any(trigger in normalized for trigger in MEMORY_QUESTION_TRIGGERS):
        return True
    return "помн" in normalized and ("что" in normalized or "memory" in normalized)


def _is_debug_question(user_text: str) -> bool:
    normalized = user_text.casefold()
    return any(trigger in normalized for trigger in DEBUG_TRIGGERS)


def _memory_entries(result: dict[str, Any], key: str, *, limit: int = 3) -> list[str]:
    memory = result.get("memory")
    if not isinstance(memory, dict):
        return []

    rows = memory.get(key)
    if not isinstance(rows, list):
        return []

    entries: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        summary = (
            row.get("summary")
            or row.get("reinforce")
            or row.get("text")
            or row.get("event_type")
        )
        cleaned = _clean_public_text(summary)
        if cleaned and cleaned not in entries:
            entries.append(cleaned)
        if len(entries) >= limit:
            break
    return entries


def _consolidation_patterns(result: dict[str, Any], *, limit: int = 4) -> list[str]:
    patterns: list[str] = []

    consolidation = result.get("consolidation")
    if isinstance(consolidation, dict):
        rows = consolidation.get("patterns")
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, dict):
                    summary = _clean_public_text(row.get("summary"))
                    if summary and summary not in patterns:
                        patterns.append(summary)
                if len(patterns) >= limit:
                    return patterns

    for summary in _memory_entries(result, "consolidated_patterns", limit=limit):
        if summary not in patterns:
            patterns.append(summary)
        if len(patterns) >= limit:
            break

    return patterns


def _memory_question_answer(event: Event, result: dict[str, Any]) -> dict[str, Any]:
    patterns = _consolidation_patterns(result)
    semantic = _memory_entries(result, "semantic", limit=2)
    recalled = _memory_entries(result, "recalled", limit=2)
    synapse = _first_synapse_summary(result)
    confidence = _confidence(result)

    parts: list[str] = []
    if patterns:
        parts.append(
            "После последней консолидации я помню несколько устойчивых паттернов: "
            + "; ".join(patterns[:4])
            + "."
        )
    else:
        parts.append(
            "В этом ответе я не вижу сохранённых консолидированных паттернов, "
            "но могу опереться на текущую память и semantic recall."
        )

    if semantic:
        parts.append("Ближайшие смыслы в semantic memory: " + "; ".join(semantic[:2]) + ".")
    elif recalled:
        parts.append("Ближайшие следы в SQLite memory/recall: " + "; ".join(recalled[:2]) + ".")

    if synapse:
        parts.append(f"По ассоциациям видно усиление связи: {synapse}.")
    else:
        parts.append("Synapse Graph уже хранит ассоциации, но для этого запроса сильная связь пока не выделилась.")

    parts.append(
        "Пока это ранняя память: я не понимаю её как полноценный LLM, "
        "но уже могу находить похожие смыслы, сохранять паттерны и усиливать связи."
    )

    return {
        "text": " ".join(parts),
        "source": "composer",
        "confidence": round(confidence, 4),
    }


def _debug_answer(result: dict[str, Any], self_evaluation: dict[str, Any] | None) -> dict[str, Any]:
    llm = result.get("llm") if isinstance(result.get("llm"), dict) else {}
    synapses = result.get("synapses") if isinstance(result.get("synapses"), dict) else {}
    reason = _self_evaluation_reason(self_evaluation)
    text = (
        "Debug: "
        f"route={result.get('route', 'unknown')}; "
        f"confidence={_confidence(result):.2f}; "
        f"llm_status={llm.get('status', 'unknown')}; "
        f"synapses_updated={synapses.get('updated', 0)}"
    )
    if reason:
        text += f"; self_evaluation={reason}"
    return {
        "text": text + ".",
        "source": "composer_debug",
        "confidence": round(_confidence(result), 4),
    }


def _consolidation_answer(response: dict[str, Any]) -> dict[str, Any]:
    consolidation = response.get("consolidation")
    if not isinstance(consolidation, dict):
        return {
            "text": "Я запустил режим сна, но устойчивые паттерны пока не выделились.",
            "source": "composer",
            "confidence": 0.0,
        }

    patterns = consolidation.get("patterns")
    if not isinstance(patterns, list) or not patterns:
        return {
            "text": (
                "Я обработал последние события, но пока не увидел повторяющихся паттернов. "
                f"{REALITY_CONTACT_HINT}"
            ),
            "source": "composer",
            "confidence": 0.0,
        }

    summaries = [
        str(pattern.get("summary", "")).strip().rstrip(".")
        for pattern in patterns[:2]
        if isinstance(pattern, dict) and pattern.get("summary")
    ]
    text = (
        f"Я обработал последние события и выделил {len(patterns)} устойчивых паттернов. "
        f"Главное: {'; '.join(summaries)}. "
        f"{REALITY_CONTACT_HINT}"
    )
    confidence = 0.0
    strengths = [
        float(pattern.get("strength", 0.0))
        for pattern in patterns
        if isinstance(pattern, dict) and isinstance(pattern.get("strength"), (int, float))
    ]
    if strengths:
        confidence = sum(strengths) / len(strengths)
    return {
        "text": text,
        "source": "composer",
        "confidence": round(confidence, 4),
    }


def compose_answer(
    event: Event,
    response: dict[str, Any],
    self_evaluation: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Turn Max17 telemetry into a short, honest answer.

    The composer is intentionally deterministic: it summarizes what Max17
    received, remembered, and suggests next.
    """

    confidence = _confidence(response)

    if event.type == "sleep_consolidation":
        return _consolidation_answer(response)

    if event.type != "user_message":
        return None

    user_text = str(event.payload.get("text") or "").strip()
    if _is_debug_question(user_text):
        return _debug_answer(response, self_evaluation)

    if _is_capability_question(user_text):
        return {
            "text": CAPABILITY_ANSWER,
            "source": "composer",
            "confidence": 0.95,
        }

    if _is_memory_question(user_text):
        return _memory_question_answer(event, response)

    recalled = _first_recalled_summary(response)
    semantic = _first_semantic_summary(response)
    next_step = _next_adaptation(response, user_text)

    parts = ["Я понял запрос."]
    if semantic:
        parts.append(f"В памяти есть похожий смысл: {semantic}.")
    elif recalled:
        parts.append(f"В памяти есть похожий след: {recalled}.")
    else:
        parts.append("Близкого воспоминания пока нет.")

    parts.append(_confidence_tone(confidence))
    if next_step:
        parts.append(f"Полезный следующий шаг: {next_step}.")
    parts.append(REALITY_CONTACT_HINT)

    return {
        "text": " ".join(parts),
        "source": "composer",
        "confidence": round(confidence, 4),
    }
