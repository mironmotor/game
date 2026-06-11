"""Deterministic response composer for Max17.

This module gives the cognitive telemetry a small human-readable voice.
It does not call external APIs and does not pretend to be a full LLM.
"""

from __future__ import annotations

import re
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

TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_]+")

TECHNICAL_TERMS = (
    "torch",
    "numpy",
    "pip",
    "pip install",
    "modulenotfounderror",
    "module not found",
    "module",
    "dependency",
    "dependencies",
    "traceback",
    "terminal",
    "terminal_error",
    "build",
    "lint",
    "npm",
    "error",
    "ошибка",
    "модуль",
    "зависимость",
    "зависимости",
    "терминал",
    "сборка",
)

VAGUE_INPUTS = {
    "game",
    "привет",
    "hello",
    "hi",
    "ок",
    "окей",
    "ok",
    "что дальше",
    "что делать",
    "давай дальше",
    "дальше",
    "next",
    "next step",
    "what should i do",
}

RELEVANCE_STOPWORDS = {
    "что",
    "как",
    "это",
    "ты",
    "мне",
    "для",
    "про",
    "the",
    "and",
    "for",
    "with",
    "after",
}

RELEVANCE_CONCEPTS = {
    "memory": {"memory", "recall", "remember", "память", "памяти", "помнишь", "вспомни"},
    "pattern": {"pattern", "patterns", "consolidation", "sleep", "паттерн", "паттерны", "связь", "связи"},
    "core": {"core", "kernel", "brain", "max17", "mark17", "ядро", "ядра", "мозг"},
    "development": {"development", "learning", "adaptive", "развитие", "обучение", "адаптация"},
    "task": {"task", "tasks", "задача", "задачи", "квест", "дедлайн"},
    "technical": set(TECHNICAL_TERMS),
}

RELEVANCE_CONCEPT_INDEX = {
    token: concept
    for concept, tokens in RELEVANCE_CONCEPTS.items()
    for token in tokens
}

CAPABILITY_ANSWER = (
    "Я Max17, когнитивное ядро Game в текущей v0.4. Сейчас я принимаю сообщения из HUD, "
    "маршрутизирую события через meta-controller, запоминаю важные события в SQLite memory, "
    "вспоминаю похожие события, оцениваю свои реакции через critic/self-evaluation, "
    "отслеживаю задачи created/completed/failed, принимаю первые camera-observation события "
    "и строю первый локальный concept-grounding слой для базовых смыслов и сенсорных опор. "
    "Ещё у меня есть экспериментальный Web Sense: я могу принять web_research событие, "
    "сохранить source-backed факты отдельно от личной памяти и связать их с графом. "
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


def normalize_text(text: Any) -> str:
    """Normalize text for deterministic intent/relevance checks."""
    raw = str(text or "").casefold().replace("ё", "е")
    return " ".join(TOKEN_RE.findall(raw))


def _relevance_tokens(text: Any) -> set[str]:
    tokens: set[str] = set()
    for token in normalize_text(text).split():
        if len(token) < 2 or token in RELEVANCE_STOPWORDS:
            continue
        tokens.add(RELEVANCE_CONCEPT_INDEX.get(token, token))
    return tokens


def _has_technical_terms(text: Any) -> bool:
    normalized = normalize_text(text)
    compact = normalized.replace(" ", "")
    return any(term in normalized or term.replace(" ", "") in compact for term in TECHNICAL_TERMS)


def _is_vague_input(text: Any) -> bool:
    normalized = normalize_text(text)
    if not normalized:
        return True
    if _has_technical_terms(normalized):
        return False
    if normalized in VAGUE_INPUTS:
        return True
    tokens = normalized.split()
    return len(tokens) == 1 and len(normalized) <= 12


def is_memory_relevant(user_text: Any, memory_summary: Any) -> bool:
    """Decide whether a memory is useful enough to mention in answer.text."""
    summary = normalize_text(memory_summary)
    if not summary:
        return False

    user_is_technical = _has_technical_terms(user_text)
    memory_is_technical = _has_technical_terms(summary)
    if memory_is_technical and not user_is_technical:
        return False

    if _is_vague_input(user_text):
        return False

    user_tokens = _relevance_tokens(user_text)
    memory_tokens = _relevance_tokens(summary)
    if not user_tokens or not memory_tokens:
        return False

    overlap = user_tokens & memory_tokens
    if overlap:
        return True

    if user_is_technical and memory_is_technical:
        technical_user = {token for token in user_tokens if token == "technical" or token in TECHNICAL_TERMS}
        technical_memory = {token for token in memory_tokens if token == "technical" or token in TECHNICAL_TERMS}
        return bool(technical_user and technical_memory)

    return False


def is_debug_request(user_text: Any) -> bool:
    normalized = str(user_text or "").casefold()
    return any(trigger in normalized for trigger in DEBUG_TRIGGERS)


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
        "terminal_error: ",
        "user_message: ",
        "consolidated_pattern: ",
    ):
        if text.startswith(prefix):
            text = text[len(prefix) :]

    return " ".join(text.split()).rstrip(".")[:limit]


def _public_memory_summary(row: dict[str, Any], user_text: str, *, limit: int = 220) -> str:
    for key in ("summary", "reinforce", "text", "event_type"):
        value = row.get(key)
        if value and is_memory_relevant(user_text, value):
            cleaned = _clean_public_text(value, limit=limit)
            if cleaned:
                return cleaned
    return ""


def _first_recalled_summary(result: dict[str, Any], user_text: str) -> str:
    memory = result.get("memory")
    if not isinstance(memory, dict):
        return ""

    recalled = memory.get("recalled")
    if not isinstance(recalled, list) or not recalled:
        return ""

    for row in recalled:
        if isinstance(row, dict):
            summary = _public_memory_summary(row, user_text)
            if summary:
                return summary
    return ""


def _first_semantic_summary(result: dict[str, Any], user_text: str) -> str:
    memory = result.get("memory")
    if not isinstance(memory, dict):
        return ""

    semantic = memory.get("semantic")
    if not isinstance(semantic, list) or not semantic:
        return ""

    for row in semantic:
        if isinstance(row, dict):
            summary = _public_memory_summary(row, user_text)
            if summary:
                return summary
    return ""


def _first_synapse_summary(result: dict[str, Any], user_text: str = "") -> str:
    synapses = result.get("synapses")
    if not isinstance(synapses, dict):
        return ""

    top = synapses.get("top")
    if not isinstance(top, list) or not top:
        return ""

    first = None
    preferred_relations = {"similar_to", "recalled_with", "completed_after", "failed_after", "reinforces"}
    for candidate in top:
        if not isinstance(candidate, dict) or candidate.get("relation_type") not in preferred_relations:
            continue
        summary = candidate.get("summary")
        if user_text and not is_memory_relevant(user_text, summary):
            continue
        if _clean_public_text(summary, limit=180):
            first = candidate
            break
    if first is None:
        for candidate in top:
            if not isinstance(candidate, dict):
                continue
            summary = candidate.get("summary")
            if user_text and not is_memory_relevant(user_text, summary):
                continue
            if _clean_public_text(summary, limit=180):
                first = candidate
                break

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


def _is_next_action_request(user_text: str) -> bool:
    normalized = normalize_text(user_text)
    triggers = (
        "что дальше",
        "давай дальше",
        "что делать",
        "следующий шаг",
        "куда дальше",
        "next",
        "next step",
        "what should i do",
    )
    return any(trigger in normalized for trigger in triggers)


def _is_debug_question(user_text: str) -> bool:
    return is_debug_request(user_text)


def _is_family_identity_question(user_text: str) -> bool:
    normalized = normalize_text(user_text)
    has_family = (
        ("отец" in normalized or "папа" in normalized or "father" in normalized)
        and ("мать" in normalized or "мама" in normalized or "mother" in normalized)
    )
    return has_family or "родители" in normalized or "parents" in normalized


def _raw_memory_rows(result: dict[str, Any]) -> list[dict[str, Any]]:
    memory = result.get("memory")
    if not isinstance(memory, dict):
        return []
    rows: list[dict[str, Any]] = []
    for key in ("recalled", "semantic", "consolidated_patterns"):
        value = memory.get(key)
        if isinstance(value, list):
            rows.extend(row for row in value if isinstance(row, dict))
    return rows


def _family_identity_answer(result: dict[str, Any]) -> dict[str, Any] | None:
    rows = _raw_memory_rows(result)
    blob_parts: list[str] = []
    for row in rows:
        for key in ("summary", "reinforce", "text"):
            value = row.get(key)
            if value:
                blob_parts.append(str(value))
    blob = " ".join(blob_parts)
    normalized = normalize_text(blob)

    father = "Мирон" if "мирон" in normalized else ""
    mother = "Сиджи" if "сиджи" in normalized else ""
    if not father and not mother:
        return None

    if father and mother:
        text = f"В текущей памяти Max17: отец — {father}, мать — {mother}."
    elif father:
        text = f"В текущей памяти Max17: отец — {father}. Мать пока не выделена в найденной памяти."
    else:
        text = f"В текущей памяти Max17: мать — {mother}. Отец пока не выделен в найденной памяти."
    return {
        "text": text,
        "source": "composer",
        "confidence": round(max(_confidence(result), 0.82), 4),
    }


def _memory_entries(
    result: dict[str, Any],
    key: str,
    *,
    limit: int = 3,
    user_text: str = "",
) -> list[str]:
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
        if user_text:
            cleaned = _public_memory_summary(row, user_text)
        else:
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


def _concept_matches(result: dict[str, Any], *, limit: int = 5) -> list[dict[str, Any]]:
    concepts = result.get("concepts")
    if not isinstance(concepts, dict):
        return []
    matches = concepts.get("matches")
    if not isinstance(matches, list):
        return []
    return [item for item in matches[:limit] if isinstance(item, dict)]


def _concept_grounding_answer(event: Event, result: dict[str, Any]) -> dict[str, Any] | None:
    matches = _concept_matches(result)
    if not matches:
        return None

    confidence = _confidence(result)
    phrases: list[str] = []
    channels: list[str] = []
    for concept in matches[:4]:
        label = str(concept.get("label") or concept.get("id") or "").strip()
        summary = str(concept.get("summary") or "").strip().rstrip(".")
        if label and summary:
            phrases.append(f"{label} — {summary}")
        sensory = concept.get("sensory_grounding")
        if isinstance(sensory, list):
            for channel in sensory:
                channel_text = str(channel)
                if channel_text and channel_text not in channels:
                    channels.append(channel_text)

    if not phrases:
        return None

    text = (
        "Я не чувствую это как человек, но теперь держу эти слова как заземлённые понятия, "
        "а не просто строки текста. "
        + "; ".join(phrases[:4])
        + "."
    )
    if channels:
        text += " Сенсорные опоры: " + ", ".join(channels[:6]) + "."
    text += (
        " Я буду связывать такие понятия с памятью, действиями, результатами и будущими наблюдениями среды."
    )

    return {
        "text": text,
        "source": "composer",
        "confidence": round(max(confidence, 0.62), 4),
    }


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
    user_text = str(event.payload.get("text") or "")
    patterns = _consolidation_patterns(result)
    semantic = _memory_entries(result, "semantic", limit=2, user_text=user_text)
    recalled = _memory_entries(result, "recalled", limit=2, user_text=user_text)
    synapse = _first_synapse_summary(result, user_text)
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

    labels = _active_concept_labels(result, limit=4)
    if labels:
        parts.append("Сейчас активны смысловые узлы: " + ", ".join(labels) + ".")

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


def _working_memory_context(result: dict[str, Any]) -> dict[str, Any]:
    context = result.get("working_memory")
    return context if isinstance(context, dict) else {}


def _causal_block(result: dict[str, Any]) -> dict[str, Any]:
    block = result.get("causal_decoder")
    return block if isinstance(block, dict) else {}


def _active_graph_block(result: dict[str, Any]) -> dict[str, Any]:
    block = result.get("active_graph")
    return block if isinstance(block, dict) else {}


def _causal_summary(result: dict[str, Any]) -> str:
    summary = str(_causal_block(result).get("summary") or "").strip()
    # Skip the "nothing active" placeholder — it adds no signal.
    if not summary or summary.startswith("Сейчас нет"):
        return ""
    return summary


def _causal_hint(result: dict[str, Any]) -> str:
    return str(_causal_block(result).get("answer_hint") or "").strip()


def _active_concept_labels(result: dict[str, Any], *, limit: int = 4) -> list[str]:
    concepts = _active_graph_block(result).get("activated_concepts")
    labels: list[str] = []
    if isinstance(concepts, list):
        for concept in concepts:
            if not isinstance(concept, dict):
                continue
            label = str(concept.get("label") or concept.get("id") or "").strip()
            if label and label not in labels:
                labels.append(label)
            if len(labels) >= limit:
                break
    return labels


def _intuition_text(result: dict[str, Any]) -> str:
    block = result.get("intuition")
    if not isinstance(block, dict):
        return ""
    return str(block.get("intuition") or "").strip()


def _plan_answer(result: dict[str, Any], confidence: float) -> dict[str, Any] | None:
    plan = result.get("plan")
    if not isinstance(plan, dict):
        return None
    actions = plan.get("actions")
    if not isinstance(actions, list) or not actions:
        return None

    goal = str(plan.get("goal") or "").strip()
    mode = str(plan.get("mode") or "unknown").strip()
    parts: list[str] = []
    if goal:
        parts.append(f"Дальше по цели «{goal}» я предлагаю:")
    else:
        parts.append("Дальше я предлагаю:")

    for index, action in enumerate(actions[:3], start=1):
        if not isinstance(action, dict):
            continue
        title = str(action.get("title") or "").strip()
        expected = str(action.get("expected_result") or "").strip().rstrip(".")
        effort = str(action.get("effort") or "").strip()
        if not title:
            continue
        line = f"{index}. {title}"
        details: list[str] = []
        if effort:
            details.append(f"усилие: {effort}")
        if expected:
            details.append(f"результат: {expected}")
        if details:
            line += " — " + "; ".join(details)
        parts.append(line + ".")

    if len(parts) == 1:
        return None
    parts.append(f"Режим: {mode}.")
    return {
        "text": " ".join(parts),
        "source": "composer",
        "confidence": round(confidence, 4),
    }


def _working_memory_next_answer(result: dict[str, Any], confidence: float) -> dict[str, Any] | None:
    context = _working_memory_context(result)
    topic = str(context.get("current_topic") or "").strip()
    goal = str(context.get("active_goal") or "").strip()
    next_step = str(context.get("suggested_next_step") or "").strip()
    mode = str(context.get("current_mode") or "").strip()

    if not any((topic, goal, next_step)):
        return None

    if topic == "Max17 core development":
        step = (next_step or "закрепить Working Memory и проверить её на HUD-сообщениях").rstrip(".")
        text = (
            "Мы сейчас развиваем Max17 core. "
            f"Текущий фокус: {goal or 'удерживать контекст сессии и улучшать ядро'}. "
            f"Следующий логичный шаг — {step}."
        )
    elif topic:
        step = (next_step or "сформулировать одно проверяемое действие").rstrip(".")
        text = (
            f"Сейчас контекст сессии: {topic}. "
            f"Цель: {goal or 'уточнить ближайшее действие'}. "
            f"Следующий шаг: {step}."
        )
    else:
        step = (next_step or goal or "сформулировать одно проверяемое действие").rstrip(".")
        text = (
            f"Контекст сессии пока держится в режиме {mode or 'unknown'}. "
            f"Следующий шаг: {step}."
        )

    return {
        "text": text,
        "source": "composer",
        "confidence": round(confidence, 4),
    }


def _causal_next_answer(result: dict[str, Any], confidence: float) -> dict[str, Any] | None:
    causal = _causal_summary(result)
    hint = _causal_hint(result)
    if not hint:
        return None
    parts: list[str] = []
    if causal:
        parts.append(causal)
    parts.append(hint)
    return {
        "text": " ".join(parts),
        "source": "composer",
        "confidence": round(confidence, 4),
    }


def _vague_status_answer(result: dict[str, Any], confidence: float) -> dict[str, Any]:
    causal = _causal_summary(result)
    labels = _active_concept_labels(result, limit=3)
    hint = _causal_hint(result)

    contextual = _working_memory_next_answer(result, confidence)
    if contextual:
        prefix_parts: list[str] = []
        if causal:
            prefix_parts.append(causal)
        elif labels:
            prefix_parts.append("Сейчас в фокусе: " + ", ".join(labels) + ".")
        if prefix_parts:
            contextual["text"] = " ".join(prefix_parts) + " " + contextual["text"]
        return contextual

    if causal or labels:
        parts: list[str] = []
        if causal:
            parts.append(causal)
        elif labels:
            parts.append("Сейчас в фокусе: " + ", ".join(labels) + ".")
        parts.append(hint or "Сформулируй задачу чуть конкретнее, и я предложу следующий маленький шаг.")
        return {
            "text": " ".join(parts),
            "source": "composer",
            "confidence": round(confidence, 4),
        }

    return {
        "text": (
            "Я на связи в Game. Могу принять сообщение, вспомнить релевантную память, "
            "обновить ассоциации и предложить следующий маленький шаг. "
            "Сформулируй задачу или вопрос чуть конкретнее, и я отвечу по делу."
        ),
        "source": "composer",
        "confidence": round(confidence, 4),
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
    labels: list[str] = []
    for pattern in patterns:
        if isinstance(pattern, dict) and pattern.get("label"):
            label = str(pattern["label"])
            if label not in labels:
                labels.append(label)
        if len(labels) >= 3:
            break
    text = (
        f"Я обработал последние события и выделил {len(patterns)} устойчивых паттернов. "
        f"Главное: {'; '.join(summaries)}. "
    )
    if labels:
        text += f"Я сжал их в смысловые узлы: {', '.join(labels)}. "
    text += REALITY_CONTACT_HINT
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


def _compression_answer(response: dict[str, Any]) -> dict[str, Any]:
    concepts = response.get("concepts")
    concepts = concepts if isinstance(concepts, dict) else {}
    primary = concepts.get("primary")
    primary = primary if isinstance(primary, dict) else {}
    label = str(primary.get("label") or primary.get("concept") or "контекст")
    reason = str(primary.get("reason") or "").strip()
    confidence = _clamp_confidence(primary.get("confidence")) or _confidence(response)
    text = f"Я сжал этот фрагмент в смысловой узел: {label}."
    if reason:
        text += f" Причина: {reason}"
    text += " Теперь этот узел можно связывать с памятью, планами, действиями и результатами."
    return {
        "text": text,
        "source": "composer",
        "confidence": round(confidence, 4),
    }


def _graph_stats_answer(response: dict[str, Any]) -> dict[str, Any]:
    stats = response.get("graph_stats")
    if not isinstance(stats, dict):
        return {
            "text": "Я попытался измерить SynapseGraph, но статистика пока недоступна.",
            "source": "composer",
            "confidence": 0.2,
        }
    total = int(stats.get("total_synapses") or 0)
    target = int(stats.get("target_synapses") or 10_000)
    percent = float(stats.get("progress_percent") or 0.0)
    nodes = int(stats.get("unique_nodes") or 0)
    evidence = int(stats.get("total_evidence") or 0)
    top_concepts = stats.get("top_concepts")
    concept_text = ""
    if isinstance(top_concepts, list) and top_concepts:
        names = [
            str(item.get("concept"))
            for item in top_concepts[:3]
            if isinstance(item, dict) and item.get("concept")
        ]
        if names:
            concept_text = f" Самые активные узлы: {', '.join(names)}."
    return {
        "text": (
            f"Сейчас в SynapseGraph {total} связей из цели {target} ({percent:.2f}%). "
            f"Уникальных узлов: {nodes}, evidence-счётчик: {evidence}."
            f"{concept_text} Следующий шаг — растить только полезные связи, которые влияют на recall, план и outcome."
        ),
        "source": "composer",
        "confidence": 1.0,
    }


def _neural_graph_seed_answer(response: dict[str, Any]) -> dict[str, Any]:
    neural = response.get("neural_graph")
    neural = neural if isinstance(neural, dict) else {}
    seed = neural.get("seed")
    seed = seed if isinstance(seed, dict) else {}
    snapshot = neural.get("snapshot")
    snapshot = snapshot if isinstance(snapshot, dict) else {}
    target = int(seed.get("target_synapses") or snapshot.get("target_synapses") or 100_000)
    before = int(seed.get("before") or 0)
    after = int(seed.get("after") or 0)
    added = int(seed.get("added_synapses") or seed.get("created_or_updated") or 0)
    clusters = int(seed.get("clusters") or snapshot.get("clusters") or 0)
    nodes = int(seed.get("cluster_nodes") or snapshot.get("cluster_nodes") or 0)
    status = str(seed.get("status") or "seeded")
    return {
        "text": (
            f"Я развернул кластерный neural graph для Max17: {clusters} кластеров, "
            f"{nodes} базовых узлов и {after} граф-синапсов из цели {target}. "
            f"За этот проход добавлено {added} связей; до прохода было {before}. "
            "Теперь можно проверять межкластерные маршруты через neural_walk: например мама -> тело -> память -> действие. "
            f"Статус: {status}."
        ),
        "source": "composer",
        "confidence": 1.0,
    }


def _neural_graph_walk_answer(response: dict[str, Any]) -> dict[str, Any]:
    neural = response.get("neural_graph")
    neural = neural if isinstance(neural, dict) else {}
    walk = neural.get("walk")
    walk = walk if isinstance(walk, dict) else {}
    steps = walk.get("steps")
    steps = steps if isinstance(steps, list) else []
    query = str(walk.get("query") or "").strip()
    if not steps:
        return {
            "text": (
                "Путь активации в neural graph пока не найден. "
                "Сначала нужно заполнить кластерные связи командой neural_seed."
            ),
            "source": "composer",
            "confidence": 0.35,
        }

    route_parts: list[str] = []
    start = walk.get("start")
    if isinstance(start, dict):
        label = str(start.get("label") or start.get("id") or "").strip()
        if label:
            route_parts.append(label)
    for step in steps[:6]:
        if isinstance(step, dict):
            label = str(step.get("to_label") or step.get("target_id") or "").strip()
            if label and label not in route_parts:
                route_parts.append(label)
    clusters = walk.get("visited_clusters")
    cluster_labels: list[str] = []
    if isinstance(clusters, list):
        for cluster in clusters[:5]:
            if isinstance(cluster, dict) and cluster.get("label"):
                cluster_labels.append(str(cluster["label"]))
    cluster_text = f" Кластеры: {', '.join(cluster_labels)}." if cluster_labels else ""
    return {
        "text": (
            f"Я прошёл путь активации по neural graph для запроса «{query or 'контекст'}»: "
            + " -> ".join(route_parts[:7])
            + "."
            + cluster_text
            + " Это не сознание, а проверяемый маршрут связей между смысловыми кластерами."
        ),
        "source": "composer",
        "confidence": round(_confidence(response) or 0.9, 4),
    }


def _outcome_answer(response: dict[str, Any]) -> dict[str, Any]:
    outcome = response.get("outcome")
    if not isinstance(outcome, dict):
        return {
            "text": "Я зафиксировал результат, но пока не смог оценить его связь с текущей целью.",
            "source": "composer",
            "confidence": 0.35,
        }

    status = str(outcome.get("status") or "unknown")
    confidence = _clamp_confidence(outcome.get("score"))
    adjustment = str(outcome.get("next_adjustment") or "").strip()

    if status == "success":
        text = (
            "Отлично. Я зафиксировал успешный результат и усилил связь между целью, "
            "действием и результатом."
        )
    elif status == "partial":
        text = "Я зафиксировал частичный результат. Следующий шаг — сузить масштаб и проверить меньший вариант."
    elif status == "failure":
        text = "Я зафиксировал, что действие не сработало. Следующий шаг — уменьшить масштаб и проверить более простой вариант."
    elif status == "skipped":
        text = "Я зафиксировал, что действие было пропущено. Следующий шаг — выбрать меньший и более ясный вариант."
    else:
        text = "Я зафиксировал результат и свяжу его с текущей целью."

    if adjustment and adjustment not in text:
        text += f" Настройка: {adjustment}"

    return {
        "text": text,
        "source": "composer",
        "confidence": round(confidence, 4),
    }


def _environment_observation_answer(event: Event, response: dict[str, Any]) -> dict[str, Any]:
    camera = event.payload.get("camera")
    camera = camera if isinstance(camera, dict) else event.payload
    vision_summary = camera.get("vision_summary")
    vision_summary = vision_summary if isinstance(vision_summary, dict) else {}
    light_map = {
        "low": "слабый",
        "medium": "средний",
        "high": "яркий",
        "unknown": "неизвестный",
    }
    tone_map = {
        "neutral": "нейтральный",
        "warm": "тёплый",
        "red": "красный",
        "yellow-green": "жёлто-зелёный",
        "green": "зелёный",
        "violet-blue": "сине-фиолетовый",
        "cool-blue": "холодный синий",
        "unknown": "неизвестный",
    }
    motion_map = {
        "still": "почти неподвижно",
        "subtle": "небольшое движение",
        "moving": "заметное движение",
        "unknown": "неизвестно",
    }
    scene_map = {
        "dark": "тёмная среда",
        "desk": "стабильное рабочее место",
        "screen-facing": "похоже на экран или рабочее место",
        "bright-room": "яркая комната",
        "active-room": "активная среда с движением",
        "room": "обычная комната",
        "unknown": "неизвестная среда",
    }
    raw_scene = str(camera.get("scene_mode") or vision_summary.get("scene_mode") or "unknown")
    raw_light = str(camera.get("light_level") or vision_summary.get("light_level") or "unknown")
    raw_tone = str(camera.get("dominant_tone") or "unknown")
    raw_motion = str(camera.get("motion_level") or vision_summary.get("motion_level") or "unknown")
    light = light_map.get(raw_light, raw_light)
    tone = tone_map.get(raw_tone, raw_tone)
    motion = motion_map.get(raw_motion, raw_motion)
    scene = scene_map.get(raw_scene, raw_scene)
    brightness = camera.get("brightness")
    stability = camera.get("stability") or vision_summary.get("stability")
    summary = str(camera.get("summary") or vision_summary.get("summary") or "").strip()
    brightness_text = ""
    if isinstance(brightness, (int, float)):
        brightness_text = f" Яркость кадра примерно {round(float(brightness) * 100)}%."
    stability_text = ""
    if isinstance(stability, (int, float)):
        stability_text = f" Стабильность около {round(float(stability) * 100)}%, движение: {motion}."

    environment = response.get("environment")
    environment = environment if isinstance(environment, dict) else {}
    conclusions = environment.get("conclusions")
    conclusions = conclusions if isinstance(conclusions, list) else []
    presence = str(environment.get("presence") or "")
    count = environment.get("observations_count")

    presence_text = {
        "present": " Похоже, ты рядом.",
        "away": " Похоже, тебя сейчас нет в кадре.",
    }.get(presence, "")

    if conclusions:
        reasoning = " ".join(str(c) for c in conclusions[:2])
        memory_text = ""
        if isinstance(count, int) and count > 1:
            memory_text = f" Я держу в памяти последние {min(count, 8)} наблюдений и сравниваю их."
        text = (
            f"Vision Summary v0.1: {scene}. Свет — {light}, движение — {motion}. "
            f"{reasoning}{presence_text}{memory_text} "
            "Я не распознаю объекты как vision-модель, но уже думаю над средой во времени "
            "и связываю выводы с памятью."
        )
    else:
        text = (
            f"Vision Summary v0.1: {scene}. Свет — {light}, общий тон — {tone}."
            f"{brightness_text}{stability_text}"
            f"{f' Сводка: {summary}.' if summary else ''}{presence_text} "
            "Пока я не распознаю объекты как vision-модель, "
            "но уже могу сохранять такие наблюдения в память и связывать их с контекстом."
        )

    env_confidence = environment.get("confidence")
    confidence = float(env_confidence) if isinstance(env_confidence, (int, float)) else _confidence(response)
    return {
        "text": text,
        "source": "composer",
        "confidence": round(confidence, 4),
    }


def _web_research_answer(response: dict[str, Any]) -> dict[str, Any]:
    web = response.get("web")
    if not isinstance(web, dict):
        return {
            "text": "Я получил web_research, но блок источников пока пустой.",
            "source": "composer",
            "confidence": 0.2,
        }

    facts = web.get("facts")
    facts = facts if isinstance(facts, list) else []
    sources = web.get("sources")
    sources = sources if isinstance(sources, list) else []
    status = str(web.get("status") or "unknown")
    query = str(web.get("query") or "").strip()
    stored = int(web.get("stored_facts") or 0)
    network = bool(web.get("network_enabled"))
    target = int(web.get("target_web_synapses") or 1_000_000)

    claims: list[str] = []
    for fact in facts[:3]:
        if not isinstance(fact, dict):
            continue
        claim = _clean_public_text(fact.get("claim"), limit=180)
        if claim and claim not in claims:
            claims.append(claim)

    source_names: list[str] = []
    for source in sources[:2]:
        if not isinstance(source, dict):
            continue
        title = str(source.get("title") or source.get("domain") or source.get("url") or "").strip()
        mode = str(source.get("mode") or status)
        if title:
            source_names.append(f"{title} ({mode})")

    if claims:
        text = (
            f"Я обработал web research по запросу «{query or 'контекст'}» "
            f"и сохранил {stored} source-backed фактов. "
            "Главное: "
            + "; ".join(claims[:3])
            + "."
        )
    else:
        text = (
            f"Я запустил web research по запросу «{query or 'контекст'}», "
            "но полезные факты пока не выделились."
        )

    if source_names:
        text += " Источники: " + "; ".join(source_names) + "."
    text += (
        f" Сеть {'включена' if network else 'выключена'}; цель слоя — расти к {target} "
        "проверяемым web-синапсам, не смешивая источники с личной памятью."
    )

    return {
        "text": text,
        "source": "composer",
        "confidence": round(_confidence(response) or 0.62, 4),
    }


def _ultimate_core_answer(response: dict[str, Any]) -> dict[str, Any]:
    ultimate = response.get("ultimate_core")
    ultimate = ultimate if isinstance(ultimate, dict) else {}
    target = int(ultimate.get("target_synapses") or 1_000_000)
    cached = int(ultimate.get("facts_cached") or 0)
    doctrine = int(ultimate.get("doctrine_cached") or 0)
    synapses = ultimate.get("synapses")
    synapses = synapses if isinstance(synapses, dict) else {}
    updated = int(synapses.get("updated") or 0)
    clusters = ultimate.get("clusters")
    cluster_names: list[str] = []
    if isinstance(clusters, list):
        for cluster in clusters[:4]:
            if isinstance(cluster, dict) and cluster.get("id"):
                cluster_names.append(str(cluster["id"]))
    cluster_text = f" Активные каркасы: {', '.join(cluster_names)}." if cluster_names else ""
    return {
        "text": (
            "MAX Ultimate v0.1 поднят как слой над текущим Max17, без переписывания ядра. "
            f"Я закешировал {doctrine} внутренних принципов и {cached} source-backed фактов, "
            f"добавил/усилил {updated} связей и поставил цель {target} полезных синапсов. "
            "Главный принцип: Mythos-урок берём не как магию модели, а как scaffold — "
            "источники, инструменты, проверка, память, граф и ограниченный рост."
            f"{cluster_text} Следующий шаг — растить граф батчами и проверять каждую новую ветку через outcome."
        ),
        "source": "composer",
        "confidence": 1.0,
    }


def _knowledge_gap_answer(response: dict[str, Any], confidence: float) -> dict[str, Any] | None:
    gap = response.get("knowledge_gap")
    if not isinstance(gap, dict) or not gap.get("needed"):
        return None
    markers = gap.get("markers")
    if not isinstance(markers, list) or not markers:
        return None

    # Retrieval-first: prefer to answer with source-backed facts that were
    # gathered (by meaning) before this composer ran. We only keep facts that
    # actually overlap the question, so an offline curated fallback never gets
    # presented as if it were about the asked topic.
    web = response.get("web") if isinstance(response.get("web"), dict) else {}
    facts = web.get("facts") if isinstance(web.get("facts"), list) else []
    query = str(web.get("query") or "").strip()
    network = bool(web.get("network_enabled"))
    query_tokens = _relevance_tokens(query)

    # A curated domain anchor whose triggers matched the question is on-topic by
    # construction, so it is accepted even with no surface-token overlap (an
    # English MDN claim answering a Russian question). Take those first so the
    # authoritative source leads, then fill with live facts that overlap the
    # question by meaning.
    def _ordered(items: list[Any]) -> list[dict[str, Any]]:
        anchors = [f for f in items if isinstance(f, dict) and f.get("mode") == "curated_match"]
        rest = [f for f in items if isinstance(f, dict) and f.get("mode") != "curated_match"]
        return anchors + rest

    claims: list[str] = []
    source_names: list[str] = []
    for fact in _ordered(facts):
        claim = _clean_public_text(fact.get("claim"), limit=180)
        if not claim or claim in claims:
            continue
        is_anchor = fact.get("mode") == "curated_match"
        if not is_anchor and query_tokens and not (query_tokens & _relevance_tokens(claim)):
            continue
        claims.append(claim)
        title = str(fact.get("title") or fact.get("domain") or fact.get("url") or "").strip()
        if title and title not in source_names:
            source_names.append(title)
        if len(claims) >= 3:
            break

    if claims:
        text = "Сначала поискал по смыслам в источниках, потом отвечаю. Нашёл: " + "; ".join(claims) + "."
        if source_names:
            text += " Источники: " + "; ".join(source_names[:2]) + "."
        text += " Сохранил это как source-backed знание и связал с графом, отдельно от личной памяти."
        return {
            "text": text,
            "source": "composer",
            "confidence": round(max(confidence, 0.6), 4),
        }

    if network:
        text = (
            "Поискал по смыслам в источниках, но релевантных фактов пока не выделилось. "
            "Уточни запрос или дай ссылку — переотправлю web_research и закрою пробел источником."
        )
    else:
        text = (
            "Здесь нужен источник, а не догадка, а web-доступ сейчас выключен. "
            "Включи MAX17_WEB_ENABLED=true — "
            "я найду по смыслам и сохраню source-backed факты в SynapseGraph."
        )
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

    if event.type == "graph_stats":
        return _graph_stats_answer(response)

    if event.type == "neural_seed":
        return _neural_graph_seed_answer(response)

    if event.type == "neural_walk":
        return _neural_graph_walk_answer(response)

    if event.type == "compress_memory":
        return _compression_answer(response)

    if event.type == "sleep_consolidation":
        return _consolidation_answer(response)

    if event.type in {"outcome_success", "outcome_failure", "outcome_partial", "action_done", "action_skipped"}:
        return _outcome_answer(response)

    if event.type == "environment_observation":
        return _environment_observation_answer(event, response)

    if event.type in {"web_research", "web_ingest"}:
        return _web_research_answer(response)

    if event.type == "ultimate_bootstrap":
        return _ultimate_core_answer(response)

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

    if _is_family_identity_question(user_text):
        family = _family_identity_answer(response)
        if family:
            return family

    if _is_next_action_request(user_text):
        planned = _plan_answer(response, confidence)
        if planned:
            return planned
        contextual = _working_memory_next_answer(response, confidence)
        if contextual:
            causal = _causal_summary(response)
            if causal:
                contextual["text"] = causal + " " + contextual["text"]
            return contextual
        causal_next = _causal_next_answer(response, confidence)
        if causal_next:
            return causal_next

    gap_answer = _knowledge_gap_answer(response, confidence)
    if gap_answer:
        return gap_answer

    concept_answer = _concept_grounding_answer(event, response)
    if concept_answer:
        return concept_answer

    if _is_vague_input(user_text):
        return _vague_status_answer(response, confidence)

    working_memory = _working_memory_context(response)
    if working_memory.get("last_user_intent") == "asks_next_step":
        planned = _plan_answer(response, confidence)
        if planned:
            return planned
        contextual = _working_memory_next_answer(response, confidence)
        if contextual:
            return contextual
        causal_next = _causal_next_answer(response, confidence)
        if causal_next:
            return causal_next

    recalled = _first_recalled_summary(response, user_text)
    semantic = _first_semantic_summary(response, user_text)
    next_step = _next_adaptation(response, user_text)

    causal = _causal_summary(response)
    parts = [causal] if causal else ["Я понял запрос."]
    if semantic:
        parts.append(f"В памяти есть похожий смысл: {semantic}.")
    elif recalled:
        parts.append(f"В памяти есть похожий след: {recalled}.")
    else:
        parts.append("Близкого воспоминания пока нет.")

    parts.append(_confidence_tone(confidence))
    if next_step:
        parts.append(f"Полезный следующий шаг: {next_step}.")
    else:
        hint = _causal_hint(response)
        if hint:
            parts.append(hint)
    parts.append(REALITY_CONTACT_HINT)

    return {
        "text": " ".join(parts),
        "source": "composer",
        "confidence": round(confidence, 4),
    }
