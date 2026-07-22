"""Инбокс Макса: поток инфы + промпт-критерий важности → фильтр.

Ядро решает, что из потока важно ПО ЗАДАННОМУ ПРОМПТУ: релевантное
оставляем (и кладём в память/синапсы), шум отбрасываем. Всегда работает
детерминированно (ключевые слова + сигналы); если жив LLM-мост
(Gemma/Qwen/OpenRouter) — оценка релевантности идёт через него.
"""

from __future__ import annotations

import json
import re
from typing import Any

_STOP = {
    "и", "в", "во", "не", "на", "по", "с", "со", "а", "но", "или", "как", "что",
    "это", "для", "от", "до", "за", "the", "a", "an", "of", "to", "in", "on",
    "for", "and", "or", "is", "are", "мне", "меня", "я", "ты", "он", "она",
}

# Сигналы важности: числа, деньги, даты, дедлайны, имена собственные и т.п.
_SIGNAL_RE = re.compile(
    r"(\d[\d.,]*\s*(?:%|\$|€|₽|руб|k|к|млн|тыс)|дедлайн|срочно|важн|"
    r"сегодня|завтра|встреч|оплат|контракт|клиент|запуск|deadline|urgent|asap)",
    re.IGNORECASE,
)


def _keywords(prompt: str) -> list[str]:
    words = re.findall(r"[\wёЁ]+", prompt.lower())
    out: list[str] = []
    for w in words:
        if len(w) < 3 or w in _STOP:
            continue
        out.append(w[:5])  # грубый стем: первые 5 символов
    return list(dict.fromkeys(out))


def score_item(text: str, keywords: list[str]) -> tuple[float, str]:
    """Релевантность 0..1 и короткая причина (детерминированно)."""
    low = text.lower()
    if not keywords:
        # Без критерия фильтровать нечем — держим всё как «важное по умолчанию».
        sig = bool(_SIGNAL_RE.search(text))
        return (0.6 if sig else 0.5, "нет критерия — принято по умолчанию")

    hits = [k for k in keywords if k in low]
    base = len(hits) / max(1, len(keywords))
    signal = bool(_SIGNAL_RE.search(text))

    if hits and signal:
        score = min(1.0, 0.7 + base * 0.3)
        reason = f"по теме ({', '.join(hits[:3])}) + сигнал важности"
    elif hits:
        score = min(0.9, 0.4 + base * 0.5)
        reason = f"по теме: {', '.join(hits[:3])}"
    elif signal:
        # Сигнал важности сам по себе (деньги, дедлайн, встреча, клиент, запуск)
        # — держим выше порога: это и есть «важное», даже без лексики промпта.
        score = 0.45
        reason = "сигнал важности (деньги/дедлайн/встреча/клиент)"
    else:
        score = round(base * 0.3, 2)
        reason = "не по теме промпта"
    return (round(score, 2), reason)


def build_prompt(interest: str, items: list[str]) -> str:
    numbered = "\n".join(f"{i}. {t}" for i, t in enumerate(items))
    return (
        "Ты — фильтр входящей информации. Оставляй только то, что важно по интересу.\n"
        f"ИНТЕРЕС (критерий важности): {interest or 'любая объективно важная информация'}\n\n"
        f"ЭЛЕМЕНТЫ:\n{numbered}\n\n"
        "Для КАЖДОГО элемента верни СТРОГО валидный JSON-массив без пояснений:\n"
        '[{"i": индекс, "keep": true|false, "score": 0.0-1.0, '
        '"why": "одна короткая причина на русском"}]'
    )


def parse_llm(raw: str, n: int) -> list[dict[str, Any]] | None:
    text = re.sub(r"```json\n?|```\n?", "", raw or "").strip()
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, list):
        return None
    verdicts: dict[int, dict[str, Any]] = {}
    for row in data:
        if not isinstance(row, dict):
            continue
        try:
            i = int(row.get("i"))
        except (TypeError, ValueError):
            continue
        if 0 <= i < n:
            verdicts[i] = {
                "score": max(0.0, min(1.0, float(row.get("score", 0.5)))),
                "keep": bool(row.get("keep", False)),
                "why": str(row.get("why", ""))[:120],
            }
    return [verdicts.get(i, {"score": 0.0, "keep": False, "why": ""}) for i in range(n)] if verdicts else None


def split_stream(raw: str) -> list[str]:
    """Разбить сырой поток на элементы: по строкам (пустые строки — разделитель)."""
    parts = re.split(r"\n\s*\n|\r?\n", raw or "")
    return [p.strip() for p in parts if p.strip()]


def generate(interest: str, items: list[str], llm, threshold: float = 0.34) -> dict[str, Any]:
    """Полная фильтрация: детерминированная база + LLM-оценка, если доступна."""
    items = [t for t in items if t and t.strip()][:50]
    source = "deterministic"
    verdicts: list[dict[str, Any]] | None = None

    if items and llm is not None and getattr(llm, "enabled", False) and llm.available:
        res = llm.ask(build_prompt(interest, items))
        if res.ok:
            parsed = parse_llm(res.text, len(items))
            if parsed:
                verdicts = parsed
                source = f"llm:{res.model}"

    keywords = _keywords(interest)
    kept: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []

    for idx, text in enumerate(items):
        if verdicts is not None:
            v = verdicts[idx]
            score = v["score"]
            keep = v["keep"] or score >= 0.5
            reason = v["why"] or ("важно по интересу" if keep else "не по интересу")
        else:
            score, reason = score_item(text, keywords)
            keep = score >= threshold

        entry = {"text": text, "score": score, "reason": reason}
        (kept if keep else dropped).append(entry)

    kept.sort(key=lambda e: e["score"], reverse=True)
    return {
        "ok": True,
        "interest": interest,
        "source": source,
        "total": len(items),
        "kept": kept,
        "dropped": dropped,
        "kept_count": len(kept),
        "dropped_count": len(dropped),
    }
