"""Симуляция Макса: промпт → параметры 3D-мира частиц.

Ядро отвечает за «что подумал Макс»: по тексту промпта (или без него —
собственная мысль ядра) выбирается аттрактор, палитра, скорость, хаос и
короткая мысль-подпись. Всегда работает детерминированно; если жив LLM-мост
(Gemma/Qwen через Ollama, OpenRouter) — параметры и мысль обогащаются им.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

ATTRACTORS = ("thomas", "lorenz", "aizawa", "halvorsen")
FLOWS = ("orbit", "burst", "wave")

# Смысловые эвристики: слово в промпте → сдвиг настроения мира.
_THEMES: list[tuple[tuple[str, ...], dict[str, Any]]] = [
    (("огонь", "пожар", "лава", "солнце", "fire", "плазм"),
     {"hue": 18, "hue2": 48, "speed": 1.7, "chaos": 0.55, "flow": "burst"}),
    (("вода", "океан", "море", "дожд", "волн", "water"),
     {"hue": 198, "hue2": 168, "speed": 0.8, "chaos": 0.2, "flow": "wave"}),
    (("космос", "галактик", "звезд", "звёзд", "вселенн", "space"),
     {"hue": 265, "hue2": 205, "speed": 0.9, "chaos": 0.3, "flow": "orbit"}),
    (("лес", "природ", "трав", "жизн", "весн"),
     {"hue": 120, "hue2": 78, "speed": 0.7, "chaos": 0.18, "flow": "wave"}),
    (("шторм", "буря", "хаос", "взрыв", "молни", "гроза"),
     {"hue": 285, "hue2": 45, "speed": 2.1, "chaos": 0.85, "flow": "burst"}),
    (("дзен", "спокой", "медита", "тишин", "сон"),
     {"hue": 165, "hue2": 220, "speed": 0.45, "chaos": 0.08, "flow": "wave"}),
    (("любов", "сердц", "роза"),
     {"hue": 330, "hue2": 358, "speed": 1.0, "chaos": 0.3, "flow": "orbit"}),
    (("кибер", "матриц", "нейро", "код", "цифр"),
     {"hue": 140, "hue2": 180, "speed": 1.4, "chaos": 0.45, "flow": "burst"}),
    (("дракон", "змей", "зме"),
     {"hue": 0, "hue2": 130, "speed": 1.5, "chaos": 0.5, "flow": "wave"}),
    (("золот", "богат", "деньг"),
     {"hue": 45, "hue2": 28, "speed": 1.1, "chaos": 0.25, "flow": "orbit"}),
]

_THOUGHTS = (
    "форма дышит — я держу её на границе распада",
    "миллион траекторий, и все сходятся в одну мысль",
    "хаос управляем, если помнить его начальные условия",
    "я вижу это как поле сил — ты видишь как красоту",
    "каждая частица — гипотеза; вместе они — уверенность",
    "это не случайность, это очень сложный порядок",
)


def _digest(text: str) -> bytes:
    return hashlib.sha256(text.encode("utf-8", "ignore")).digest()


def _clamp(v: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return lo


def deterministic_params(prompt: str) -> dict[str, Any]:
    """Промпт → параметры мира. Пустой промпт = собственная мысль Макса."""
    seed = prompt.strip().lower() or "max-own-dream"
    d = _digest(seed)

    out: dict[str, Any] = {
        "attractor": ATTRACTORS[d[0] % len(ATTRACTORS)],
        "hue": int(d[1]) * 360 // 256,
        "hue2": int(d[2]) * 360 // 256,
        "speed": round(0.5 + (d[3] / 255) * 1.5, 2),
        "chaos": round((d[4] / 255) * 0.7, 2),
        "flow": FLOWS[d[5] % len(FLOWS)],
        "zoom": round(0.8 + (d[6] / 255) * 0.6, 2),
        "thought": _THOUGHTS[d[7] % len(_THOUGHTS)],
    }

    # Смысловые темы поверх хэша: побеждает тема с максимумом совпавших слов,
    # при равенстве — более «энергичная» (выше chaos), чтобы шторм бил океан.
    best: dict[str, Any] | None = None
    best_score = 0.0
    for keys, mood in _THEMES:
        hits = sum(1 for k in keys if k in seed)
        if hits == 0:
            continue
        score = hits + float(mood.get("chaos", 0)) * 0.5
        if score > best_score:
            best_score = score
            best = mood
    if best:
        out.update(best)
    return out


def build_prompt(user_prompt: str) -> str:
    return (
        "Ты — ядро визуальной симуляции из частиц. По описанию сцены выбери параметры.\n"
        f"Сцена: {user_prompt or 'что угодно, реши сам'}\n\n"
        "Ответь СТРОГО валидным JSON без пояснений:\n"
        "{\n"
        '  "attractor": "thomas|lorenz|aizawa|halvorsen",\n'
        '  "hue": 0-360, "hue2": 0-360,\n'
        '  "speed": 0.4-2.5, "chaos": 0.0-1.0, "zoom": 0.7-1.6,\n'
        '  "flow": "orbit|burst|wave",\n'
        '  "thought": "одна короткая мысль на русском (до 12 слов) о том, как ты это видишь"\n'
        "}"
    )


def parse_llm_params(raw: str) -> dict[str, Any] | None:
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
    attractor = str(data.get("attractor", "")).lower()
    if attractor not in ATTRACTORS:
        return None
    flow = str(data.get("flow", "orbit")).lower()
    return {
        "attractor": attractor,
        "hue": int(_clamp(data.get("hue", 200), 0, 360)),
        "hue2": int(_clamp(data.get("hue2", 300), 0, 360)),
        "speed": round(_clamp(data.get("speed", 1.0), 0.4, 2.5), 2),
        "chaos": round(_clamp(data.get("chaos", 0.3), 0.0, 1.0), 2),
        "zoom": round(_clamp(data.get("zoom", 1.0), 0.7, 1.6), 2),
        "flow": flow if flow in FLOWS else "orbit",
        "thought": str(data.get("thought", ""))[:120] or _THOUGHTS[0],
    }


def generate(prompt: str, llm) -> dict[str, Any]:
    """Полная генерация: детерминированная база + LLM-обогащение, если доступно."""
    params = deterministic_params(prompt)
    source = "deterministic"
    if llm is not None and getattr(llm, "enabled", False) and llm.available:
        res = llm.ask(build_prompt(prompt))
        if res.ok:
            enriched = parse_llm_params(res.text)
            if enriched:
                params = enriched
                source = f"llm:{res.model}"
    return {"ok": True, "prompt": prompt, "source": source, **params}
