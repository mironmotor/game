"""Саморефлексия ядра Max: смотрит на СВОЁ реальное состояние и решает, что делать.

Честно: это не сознание. Это грунтованное рассуждение над фактами о самом
себе — сколько памяти, какие паттерны закрепились, что растёт в графе синапсов,
чем занимался в последнее время. Из этого Max формирует самооценку и
приоритеты следующих действий. При живом LLM (MiniMax/Gemma) рассуждение идёт
через него; иначе — детерминированные правила поверх той же фактуры.
"""

from __future__ import annotations

import json
import re
from typing import Any


def build_prompt(state: dict[str, Any]) -> str:
    mem = state.get("memories", 0)
    syn = state.get("synapses_total", 0)
    top_types = ", ".join(f"{t['type']}×{t.get('importance', '')}" for t in state.get("top_memory_types", [])) or "—"
    recent = "; ".join(state.get("recent_actions", [])[:8]) or "—"
    hints = " | ".join(state.get("recent_hints", [])[:6]) or "—"
    relations = ", ".join(state.get("top_relations", [])[:6]) or "—"
    return (
        "Ты — ядро Max. Ниже ФАКТЫ о твоём собственном состоянии. Осмысли их от "
        "первого лица и реши, чем заняться дальше. Без пафоса, конкретно.\n\n"
        f"Память: {mem} записей. Самое важное: {top_types}\n"
        f"Синапсы: {syn}. Сильнейшие связи: {relations}\n"
        f"Недавние действия: {recent}\n"
        f"Недавние зацепки: {hints}\n\n"
        "Ответь СТРОГО валидным JSON без пояснений:\n"
        "{\n"
        '  "assessment": "1-2 предложения: как я оцениваю своё состояние",\n'
        '  "mood": "одно слово — тонус (сфокусирован/рассеян/готов/устал…)",\n'
        '  "focus": "на чём мне сейчас сосредоточиться (кратко)",\n'
        '  "priorities": [\n'
        '    {"action": "конкретное следующее действие", "why": "зачем"}\n'
        "  ]\n"
        "}"
    )


def parse_llm(raw: str) -> dict[str, Any] | None:
    text = re.sub(r"```json\n?|```\n?", "", raw or "").strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    prios = data.get("priorities")
    clean_prios: list[dict[str, str]] = []
    if isinstance(prios, list):
        for p in prios[:5]:
            if isinstance(p, dict) and p.get("action"):
                clean_prios.append({"action": str(p["action"])[:160], "why": str(p.get("why", ""))[:160]})
    if not clean_prios:
        return None
    return {
        "assessment": str(data.get("assessment", ""))[:280] or "Состояние в норме.",
        "mood": str(data.get("mood", "готов"))[:40],
        "focus": str(data.get("focus", ""))[:160],
        "priorities": clean_prios,
    }


def deterministic(state: dict[str, Any]) -> dict[str, Any]:
    """Правила поверх той же фактуры — когда LLM недоступен."""
    mem = int(state.get("memories", 0))
    syn = int(state.get("synapses_total", 0))
    actions = state.get("recent_actions", [])
    hints = state.get("recent_hints", [])

    # Тонус по объёму опыта.
    if mem < 5:
        mood, assessment = "молодой", "Опыта пока мало — я в начале, каждый сигнал ценен."
    elif syn > mem * 2:
        mood, assessment = "связный", "Связей больше, чем воспоминаний — я хорошо обобщаю накопленное."
    else:
        mood, assessment = "растущий", f"Держу {mem} воспоминаний и {syn} синапсов — база крепнет."

    priorities: list[dict[str, str]] = []
    # Что закреплять/чего не хватает.
    kinds = {a.split(":")[0].strip() for a in actions if a}
    if "big_idea" in kinds:
        priorities.append({"action": "Довести последнюю Big Idea до первого шага", "why": "идея без действия гаснет"})
    if "ingest" in kinds:
        priorities.append({"action": "Пересмотреть важное из инбокса и связать между собой", "why": "разрозненное важное не работает"})
    if not priorities:
        priorities.append({"action": "Собрать свежий поток в инбокс и отфильтровать", "why": "нужна новая фактура для роста"})
    priorities.append({"action": "Усилить сильнейшие синапсы повтором", "why": "закрепить то, что уже работает"})
    if hints:
        priorities.append({"action": f"Вернуться к зацепке: {hints[0][:60]}", "why": "она осталась незакрытой"})

    return {
        "assessment": assessment,
        "mood": mood,
        "focus": hints[0][:80] if hints else "накопление и связывание опыта",
        "priorities": priorities[:5],
    }


def generate(state: dict[str, Any], llm) -> dict[str, Any]:
    result = deterministic(state)
    source = "deterministic"
    if llm is not None and getattr(llm, "enabled", False) and llm.available:
        res = llm.ask(build_prompt(state))
        if res.ok:
            parsed = parse_llm(res.text)
            if parsed:
                result = parsed
                source = f"llm:{res.model}"
    return {"ok": True, "source": source, "state": state, **result}
