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
    return str(summary).strip().rstrip(".")[:220] if summary else ""


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
    return str(summary).strip().rstrip(".")[:220] if summary else ""


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
        relation = str(first.get("relation_type") or "related_to")
        return f"{relation}: {str(summary).strip().rstrip('.')[:180]}"
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

    if event.type != "user_message":
        return None

    user_text = str(event.payload.get("text") or "").strip()
    if _is_capability_question(user_text):
        return {
            "text": CAPABILITY_ANSWER,
            "source": "composer",
            "confidence": 0.95,
        }

    recalled = _first_recalled_summary(response)
    semantic = _first_semantic_summary(response)
    synapse = _first_synapse_summary(response)
    next_step = _next_adaptation(response, user_text)
    reason = _self_evaluation_reason(self_evaluation)

    parts = ["Я зафиксировал запрос."]
    if semantic:
        parts.append(f"Семантическая память нашла похожий смысл: {semantic}.")
    elif recalled:
        parts.append(f"Память нашла похожий след: {recalled}.")
    else:
        parts.append("В памяти пока нет близкого совпадения.")

    if synapse:
        parts.append(f"Связь усилилась: {synapse}.")

    parts.append(_confidence_tone(confidence))
    parts.append(f"Следующий шаг: {next_step}.")
    parts.append(REALITY_CONTACT_HINT)

    if reason:
        parts.append(f"Внутренняя оценка: {reason}.")

    return {
        "text": " ".join(parts),
        "source": "composer",
        "confidence": round(confidence, 4),
    }
