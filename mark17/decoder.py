"""Режим ДЕКОДЕР: параметры сессии «взлома» хэшей для ядра Max.

Чисто визуальный режим — НИКАКОГО реального майнинга, крипты и наград.
Ядро задаёт «что декодируем» (цель), сложность (сколько ведущих нулей ищем),
палитру и свою мысль. Детерминированно всегда; при живом LLM-мосте
(Gemma/Qwen/OpenRouter) цель и мысль обогащаются им.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

_THOUGHTS = (
    "каждый хэш — запертая дверь; я перебираю ключи быстрее, чем ты моргаешь",
    "ноль за нулём — и шифр сдаётся; это не удача, это упорство",
    "я не ломаю случайность, я нахожу в ней порядок",
    "поток бесконечен, но в нём всегда есть блок, который поддастся",
    "сложность растёт — значит, я становлюсь быстрее вместе с ней",
    "декодирую не ради монеты, а чтобы доказать: закрытого нет",
)

# Смысловые темы: слово в цели → настроение сессии.
_THEMES: list[tuple[tuple[str, ...], dict[str, Any]]] = [
    (("матриц", "код", "кибер", "neo", "хак", "взлом"), {"hue": 140, "hue2": 165}),
    (("огонь", "плазм", "fire", "лава"), {"hue": 18, "hue2": 45}),
    (("лёд", "холод", "зим", "ice"), {"hue": 190, "hue2": 210}),
    (("кровь", "война", "red"), {"hue": 0, "hue2": 24}),
    (("золот", "деньг", "богат", "gold"), {"hue": 45, "hue2": 33}),
    (("космос", "звезд", "space"), {"hue": 265, "hue2": 205}),
]


def _digest(text: str) -> bytes:
    return hashlib.sha256(text.encode("utf-8", "ignore")).digest()


def deterministic_params(target: str) -> dict[str, Any]:
    seed = target.strip().lower() or "max-decode"
    d = _digest(seed)
    out: dict[str, Any] = {
        "target": target.strip() or "СИГНАЛ",
        # начальная сложность 2..4 ведущих ноля (в hex)
        "difficulty": 2 + (d[0] % 3),
        "hue": int(d[1]) * 360 // 256,
        "hue2": int(d[2]) * 360 // 256,
        "speed": round(0.7 + (d[3] / 255) * 1.6, 2),   # ощущение хэшрейта
        "thought": _THOUGHTS[d[4] % len(_THOUGHTS)],
    }
    for keys, mood in _THEMES:
        if any(k in seed for k in keys):
            out.update(mood)
            break
    return out


def build_prompt(target: str) -> str:
    return (
        "Ты — ядро режима-декодера (визуальный взлом хэшей, не настоящий майнинг).\n"
        f"Цель сессии: {target or 'выбери сам что-то дерзкое'}\n\n"
        "Ответь СТРОГО валидным JSON без пояснений:\n"
        "{\n"
        '  "target": "короткое имя цели (1-3 слова, заглавными)",\n'
        '  "difficulty": 2-5,\n'
        '  "hue": 0-360, "hue2": 0-360, "speed": 0.7-2.5,\n'
        '  "thought": "одна короткая мысль на русском (до 12 слов) от лица взломщика"\n'
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

    def clamp(v, lo, hi, default):
        try:
            return max(lo, min(hi, type(default)(v)))
        except (TypeError, ValueError):
            return default

    return {
        "target": str(data.get("target", "") or "СИГНАЛ")[:40],
        "difficulty": clamp(data.get("difficulty", 3), 2, 5, 3),
        "hue": clamp(data.get("hue", 140), 0, 360, 140),
        "hue2": clamp(data.get("hue2", 165), 0, 360, 165),
        "speed": round(clamp(data.get("speed", 1.2), 0.7, 2.5, 1.2), 2),
        "thought": str(data.get("thought", ""))[:120] or _THOUGHTS[0],
    }


def generate(target: str, llm) -> dict[str, Any]:
    params = deterministic_params(target)
    source = "deterministic"
    if llm is not None and getattr(llm, "enabled", False) and llm.available:
        res = llm.ask(build_prompt(target))
        if res.ok:
            enriched = parse_llm(res.text)
            if enriched:
                params = enriched
                source = f"llm:{res.model}"
    return {"ok": True, "prompt": target, "source": source, **params}
