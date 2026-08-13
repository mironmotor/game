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


def params_from_measures(measures: dict[str, Any]) -> dict[str, Any]:
    """Параметры мира прямо из измерений кадра, минуя слова.

    До сих пор сон строился так: текст описания → хэш → совпадение со списком
    тем. Из-за этого кадр Cyberpunk окрашивался в зелёно-бирюзовый — не потому
    что он такой, а потому что в описании попадалось слово «кибер», а в теме
    «кибер» записаны hue 140/180. Мир красился в цвет СЛОВА.

    Здесь всё берётся из самого кадра: тон — из доминирующего цвета, хаос — из
    энтропии, скорость — из силы движения, характер потока — из того, на чём
    кадр держится, аттрактор — из формы гистограммы направлений. Слов в этой
    цепочке нет вообще, поэтому сон повторяет то, что видно, а не то, что
    сказано.
    """
    pal = measures.get("палитра") or []
    det = measures.get("детали") or {}
    rhy = measures.get("ритм") or {}
    mot = measures.get("движение") or {}
    comp = measures.get("композиция") or {}
    geo = measures.get("геометрия") or {}

    # Цвет сна берётся из НАСЫЩЕННЫХ оттенков, а не из доминирующего. В тёмном
    # кадре доминирует чёрный, у него разница каналов на уровне шума — и тон
    # мира определялся бы случайностью. Цвет сцене задают акценты: неон, огонь,
    # небо, даже когда занимают три процента кадра.
    def _vivid() -> list[int]:
        out: list[int] = []
        for entry in pal:
            rgb = entry.get("rgb") or [0, 0, 0]
            r, g, b = (float(c) / 255.0 for c in rgb)
            mx, mn = max(r, g, b), min(r, g, b)
            span = mx - mn
            if span < 0.12 or mx < 0.12:
                continue  # серое, чёрное или белое — тона не несёт
            if mx == r:
                hue = (60 * ((g - b) / span)) % 360
            elif mx == g:
                hue = 60 * ((b - r) / span) + 120
            else:
                hue = 60 * ((r - g) / span) + 240
            out.append(int(hue) % 360)
        return out

    vivid = _vivid()

    def hue_of(idx: int, fallback: int) -> int:
        if idx < len(vivid):
            return vivid[idx]
        # Нет ни одного насыщенного цвета — кадр действительно серый, и врать
        # про его тон не надо: берём запасной, а не шум почти-чёрного.
        return vivid[0] if vivid else fallback

    # Энтропия по 32 корзинам упирается в пять — делим на неё, а не на глаз.
    chaos = _clamp(float(det.get("энтропия") or 0.0) / 5.0, 0.05, 0.9)
    speed = _clamp(0.4 + float(mot.get("сила") or 0.0) * 12.0, 0.4, 2.5)

    holds = str(rhy.get("держится_на") or "")
    flow = "wave" if "крупных" in holds else ("burst" if "фактуре" in holds else "orbit")

    center = comp.get("центр_масс") or [0.5, 0.5]
    off = abs(float(center[0]) - 0.5) + abs(float(center[1]) - 0.5)
    zoom = round(_clamp(1.4 - off * 1.2, 0.8, 1.4), 2)

    # Аттрактор по тому, сколько направлений держат кадр: два сильных — сцена
    # с осями, один — поток, размазанные — мягкий вихрь.
    peaks = int(geo.get("пиков_направлений") or 0)
    if peaks >= 4:
        attractor = "halvorsen"
    elif peaks == 3:
        attractor = "thomas"
    elif peaks == 2:
        attractor = "lorenz"
    else:
        attractor = "aizawa"

    return {
        "attractor": attractor,
        "hue": hue_of(0, 210),
        "hue2": hue_of(1, 280),
        "speed": round(speed, 2),
        "chaos": round(chaos, 2),
        "flow": flow,
        "zoom": zoom,
        "thought": _THOUGHTS[int(round(chaos * 100)) % len(_THOUGHTS)],
        "source": "measures",
    }


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
