"""Big Idea generator on the Max17 core.

LLM path: builds a prompt for the configured LLM (Ollama/OpenRouter via
LlmBridge) and parses a JSON idea. Deterministic fallback: combinatorial
generator so the funnel works even with no LLM at all.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

SPARK_PATTERNS = [
    "{trend} для {audience} в мире {domain}",
    "убрать посредников между {audience} и {domain}",
    "{domain} как игра с уровнями и наградами",
    "невидимый ассистент: {trend} работает в фоне",
    "перевернуть {twist}: сделать это преимуществом",
    "микро-версия {domain} на 5 минут в день",
    "{audience} обучают друг друга — сеть, не сервис",
    "физический ритуал + {trend} — мост в реальность",
]

IDEA_FIELDS = ["name", "tagline", "problem", "solution", "whoFor", "whyNow", "magic", "firstStep"]


def _fill(pattern: str, seed: dict[str, str]) -> str:
    out = pattern
    for key, fallback in (
        ("domain", "повседневность"),
        ("audience", "занятые люди"),
        ("trend", "ИИ-агент"),
        ("twist", "ограничение"),
    ):
        out = out.replace("{" + key + "}", seed.get(key) or fallback)
    return out


def deterministic_sparks(seed: dict[str, str]) -> list[str]:
    return [_fill(p, seed) for p in SPARK_PATTERNS]


def deterministic_idea(seed: dict[str, str], sparks: list[str]) -> dict[str, Any]:
    domain = seed.get("domain") or "повседневность"
    audience = seed.get("audience") or "занятые люди"
    trend = seed.get("trend") or "ИИ-агент"
    twist = seed.get("twist") or ""
    h = int(hashlib.sha256(json.dumps(seed, sort_keys=True).encode()).hexdigest(), 16)
    name_bits = ["Pulse", "Nexus", "Форс", "Орбита", "Ядро", "Вектор", "Луч", "Сдвиг"]
    name = f"{name_bits[h % len(name_bits)]} {domain.split()[0].capitalize()}"

    return {
        "name": name,
        "tagline": f"{trend} превращает {domain} в игру, которую {audience} проходят каждый день",
        "problem": f"{audience.capitalize()} тонут в рутине вокруг «{domain}» — мотивация умирает быстрее, чем появляется результат.",
        "solution": f"Один экран: {trend} разбивает {domain} на короткие ходы с наградами и ведёт от хода к ходу{f', используя «{twist}» как фишку' if twist else ''}.",
        "whoFor": audience,
        "whyNow": f"{trend} стал дешёвым и работает на устройстве — год назад это было невозможно.",
        "magic": f"Каждое действие пользователя тренирует его личное ядро (память + синапсы) — продукт становится незаменимым через неделю.",
        "firstStep": f"За выходные: лендинг + один игровой цикл «{sparks[0] if sparks else domain}» — и показать 10 живым людям.",
        "boldness": 5 + (h % 4),
        "scale": 5 + ((h >> 3) % 4),
    }


def build_prompt(seed: dict[str, str]) -> str:
    parts = []
    if seed.get("domain"): parts.append(f"Сфера: {seed['domain']}")
    if seed.get("audience"): parts.append(f"Аудитория: {seed['audience']}")
    if seed.get("trend"): parts.append(f"Тренд/технология: {seed['trend']}")
    if seed.get("twist"): parts.append(f"Поворот/ограничение: {seed['twist']}")
    ctx = "\n".join(parts) or "Полная свобода — придумай дерзкое."
    fields = ", ".join(IDEA_FIELDS)
    return f"""Ты — генератор Big Idea для стартапов. Входные данные:
{ctx}

Верни СТРОГО валидный JSON-объект без markdown с полями:
{fields} (все строки на русском), boldness и scale (числа 1-10).
name — 1-3 слова; tagline — одна строка; остальное — 1-2 предложения."""


def parse_llm_idea(raw: str) -> dict[str, Any] | None:
    """Extract a JSON idea object from LLM output, or None."""
    text = raw.strip()
    text = re.sub(r"```json\s*|```\s*", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        obj = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(obj, dict) or not obj.get("name"):
        return None
    idea: dict[str, Any] = {k: str(obj.get(k, "")) for k in IDEA_FIELDS}
    for num_key in ("boldness", "scale"):
        try:
            idea[num_key] = max(1, min(10, int(float(obj.get(num_key, 5)))))
        except (TypeError, ValueError):
            idea[num_key] = 5
    return idea


def generate(seed: dict[str, str], llm) -> dict[str, Any]:
    """Full big-idea generation: sparks + idea, LLM when available."""
    sparks = deterministic_sparks(seed)
    source = "deterministic"
    idea = None
    if llm is not None and getattr(llm, "enabled", False) and llm.available:
        res = llm.ask(build_prompt(seed))
        if res.ok:
            idea = parse_llm_idea(res.text)
            if idea:
                source = f"llm:{res.model}"
    if idea is None:
        idea = deterministic_idea(seed, sparks)
    return {"ok": True, "sparks": sparks, "idea": idea, "source": source}
