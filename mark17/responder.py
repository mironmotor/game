"""Deterministic response composer for Max17.

This module gives the cognitive telemetry a small human-readable voice.
It does not call external APIs and does not pretend to be a full LLM.
"""

from __future__ import annotations

import re
from typing import Any

from mark17.compression import similarity
from mark17.events import Event
from mark17.planner import build_plan, _detect_domain
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
    "дальше",
    "next",
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


# Насколько «воспоминание» должно совпасть с текущим вопросом, чтобы считаться
# его эхом. Выше этого — ядро собирается пересказать человеку его же реплику.
ECHO_MATCH = 0.85


def _is_echo(user_text: Any, memory_text: Any) -> bool:
    """Не воспоминание, а эхо: та же реплика, вернувшаяся из памяти.

    Каждое сообщение попадает в память, поэтому на повторный вопрос ядро
    находило ближайшим совпадением сам этот вопрос и отвечало «в памяти есть
    похожий смысл: <ровно то, что ты сейчас спросил>». Формально верно,
    практически — пустой ход, который выглядел как непонимание.
    """
    return similarity(str(user_text or ""), str(memory_text or "")) >= ECHO_MATCH


def _public_memory_summary(row: dict[str, Any], user_text: str, *, limit: int = 220) -> str:
    for key in ("summary", "reinforce", "text", "event_type"):
        value = row.get(key)
        if value and is_memory_relevant(user_text, value):
            cleaned = _clean_public_text(value, limit=limit)
            # Эхо проверяем ПОСЛЕ очистки: служебный префикс «user_message: »
            # добавляет свои основы и разбавляет похожесть настолько, что
            # дословный повтор вопроса перестаёт выглядеть дословным.
            if cleaned and not _is_echo(user_text, cleaned):
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
        # Совет должен согласовываться с уверенностью в том же предложении.
        # На устойчивом паттерне «закрепить как новый» звучало прямым
        # самопротиворечием: «уверенность 100%… закрепить как новый».
        if _confidence(result) >= 0.8:
            return (
                "перейти от разговора к результату: этот запрос повторяется, "
                "пора не уточнять его, а сделать по нему один шаг"
            )
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
    return is_debug_request(user_text)


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


def _vague_status_answer(confidence: float) -> dict[str, Any]:
    return {
        "text": (
            "Я на связи в Game. Могу принять сообщение, вспомнить релевантную память, "
            "обновить ассоциации и предложить следующий маленький шаг. "
            "Сформулируй задачу или вопрос чуть конкретнее, и я отвечу по делу."
        ),
        "source": "composer",
        "confidence": round(confidence, 4),
    }


def _plan_answer(user_text: str, confidence: float) -> dict[str, Any] | None:
    """Ответ по существу для вопроса про действие — своими силами, без сети.

    До сих пор на «как поднять доход» ядро отвечало «Я понял запрос. Близкого
    воспоминания пока нет. Уверенность средняя» — отчётом о маршрутизации, а не
    ответом. Своего содержания у него не было, поэтому за содержанием всегда
    шли к LLM, и каждый ответ начинался с ожидания сети.

    Между тем разбор цели на шаги в ядре уже есть — `planner.build_plan`, с
    интегралом по траекториям и проверкой реальностью на каждом шаге. Он просто
    был заперт в режиме /autoplan. Здесь он отвечает в чате.

    Срабатывает только когда планировщик уверенно узнал область (деньги, тело,
    учёба, дело, люди). На «default» ответа нет: выдавать план на любую реплику
    значило бы делать вид, что понял, — а это ровно то, чем LLM и грешит.
    """
    goal = user_text.strip()
    if len(goal) < 8:
        return None
    if _detect_domain(goal.lower()) == "default":
        return None

    plan = build_plan(goal)
    tasks = [t for t in plan.get("tasks", []) if t.get("desc")]
    if not tasks:
        return None

    steps = "\n".join(
        f"{i}. {t['desc']} ({t.get('mgr', 'MGR-1')}, {t.get('scheduledTime', '')})".rstrip(" ,")
        for i, t in enumerate(tasks[:4], 1)
    )
    check = next((t.get("reality_check") for t in tasks if t.get("reality_check")), "")

    text = (
        f"Разбираю это как цель. Первый шаг: {plan.get('first_move', '—')}.\n\n"
        f"{steps}\n\n"
        f"{check}"
    ).strip()

    return {
        "text": text,
        "source": "composer_plan",
        # Уверенность паттерна тут не при чём: план собран разбором цели, а не
        # узнаванием. Отдаём уверенность разбора, не занижая и не завышая.
        "confidence": round(max(confidence, 0.6), 4),
        "domain": plan.get("domain"),
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

    if _is_vague_input(user_text):
        return _vague_status_answer(confidence)

    # Сначала пробуем ответить по существу своими силами. Получилось — за
    # содержанием не нужно идти в сеть вообще.
    planned = _plan_answer(user_text, confidence)
    if planned:
        return planned

    recalled = _first_recalled_summary(response, user_text)
    semantic = _first_semantic_summary(response, user_text)
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
