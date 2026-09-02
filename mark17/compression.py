"""Сжатие похожего: много близких записей → одна с весом.

То, ради чего это есть: память и граф синапсов копят почти-дубли. «починил
мост», «мост опять упал», «перезапустил мост» — три записи об одном. По
отдельности они занимают место и размывают поиск, вместе — один узел с весом 3
и понятной сутью.

Похожесть меряется пересечением основ слов, а не смыслом: «мост упал» и «мост
перезапустил» слипнутся, а «пробежал 5 км» и «бегал 3 километра» — нет, общих
слов у них нет. Это честный потолок метода; зато он не выдумывает связей
там, где их нет, и объясним — всегда видно, по каким словам склеилось.

Алгоритм жадный и детерминированный: идём от самых весомых записей, каждую
следующую либо подселяем к близкому кластеру, либо заводим новый. Без внешних
зависимостей и без обучения — одинаковый вход всегда даёт одинаковый выход.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

# Похожесть считаем прямым пересечением основ (коэффициент Дайса), а не
# косинусом хешированных векторов из vector_memory. Замер на живых записях
# показал, почему: у хеш-эмбеддинга на коротких текстах бывают коллизии, и
# «Firebase выдаёт unauthorized-domain» слипалось с «оплатил интернет» на 0.354
# — при нулевом пересечении слов. Дайс на тех же парах даёт ровно 0.
#
# Порог измерен, а не угадан: верные пары дают 0.22–0.57, посторонние — 0.00.
# 0.20 стоит с запасом ниже верных и заведомо выше нуля.
DEFAULT_THRESHOLD = 0.20

# Насколько два текста должны совпасть по основам, чтобы считаться «про одно».
# Дайс 0.6 — это «две трети значимых слов общие»: «поднять доход» и «поднять
# доход в этом месяце» сливаются, «привет» и «пока» — нет. Один порог на всё
# ядро: узнавание паттернов и кеш ответов обязаны считать одинаково, иначе
# ядро узнаёт вопрос, а кеш — нет.
TOPIC_MATCH = 0.6
MIN_TEXT_CHARS = 8

# Эмбеддинг в vector_memory чисто словесный: «хэшами» и «хэшей» для него разные
# слова, поэтому две записи об одном давали сходство 0.000. Порогом это не
# лечится — нужно свести словоформы к общей основе. Грубого отсечения окончаний
# достаточно и оно не требует зависимостей. Правим только вход кластеризации,
# не сам vector_memory: там та же нормализация изменила бы поведение поиска.
#
# Глагольные окончания идут в этом же списке и раньше коротких: глагол обычно и
# есть ядро темы, а вид у него человек меняет свободно. «Поднять» отсекалось до
# «подня», «поднимать» — до «поднима», и один и тот же разговор о доходе
# расходился на два паттерна из-за вида глагола. Оба должны давать «подн».
_ENDINGS = (
    "ениями", "ениям", "ениях", "ением", "ования", "ование", "ований",
    "ывать", "ивать", "евать", "овать", "имать", "инать",
    "нуть", "ять", "ать", "еть", "ить", "уть", "ыть",
    "ами", "ями", "ого", "его", "ому", "ему", "ыми", "ими", "ей", "ой",
    "ах", "ях", "ов", "ев", "ый", "ий", "ая", "яя", "ое", "ее", "ые", "ие",
    "ом", "ем", "ам", "ям", "ть", "ся", "ла", "ли", "ло", "ил", "ыл",
    "а", "я", "о", "е", "ы", "и", "й", "ь", "у", "ю",
)
_STOP = {
    "и", "в", "во", "не", "на", "по", "с", "со", "а", "но", "или", "как", "что",
    "это", "для", "от", "до", "за", "же", "бы", "ещё", "еще", "the", "a", "an",
    "of", "to", "in", "on", "for", "and", "or", "is", "are", "at", "it",
    # Местоимения, указательные и вводные. Без них «как мне поднять доход в
    # этом месяце» и «поднять доход» расходились по похожести на «мне» и
    # «этом» — словах, которые о теме разговора не говорят ничего.
    "мне", "меня", "мной", "мой", "моя", "мои", "моё", "мое",
    "тебе", "тебя", "твой", "твоя", "твои",
    "себе", "себя", "свой", "своя", "свои", "сам", "сама",
    "этом", "этот", "эта", "эти", "этих", "того", "тот", "та", "те",
    "там", "тут", "здесь", "куда", "где", "когда", "чтобы", "если",
    "надо", "нужно", "хочу", "хочешь", "очень", "просто", "вообще",
    "можно", "мочь", "быть", "есть", "уже", "тоже", "также",
    "my", "me", "you", "your", "this", "that", "these", "those",
    "here", "there", "what", "when", "where", "how", "can", "want",
    "need", "just", "very", "be", "was", "were", "with", "from",
}
_TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9]+")


def _stem(word: str) -> str:
    """Грубая основа слова: отсекаем самое длинное известное окончание."""
    w = word.lower().replace("ё", "е")
    if len(w) <= 4:
        return w
    for end in _ENDINGS:
        if w.endswith(end) and len(w) - len(end) >= 3:
            return w[: -len(end)]
    return w


def normalize_for_similarity(text: str) -> str:
    """Свести текст к основам слов — чтобы словоформы не считались разными."""
    stems = [_stem(t) for t in _TOKEN_RE.findall(str(text or ""))]
    return " ".join(s for s in stems if s and s not in _STOP)


def stems_of(text: str) -> set[str]:
    return set(normalize_for_similarity(text).split())


def similarity(a: str | set[str], b: str | set[str]) -> float:
    """Коэффициент Дайса по основам: 2·|общее| / (|A|+|B|)."""
    sa = a if isinstance(a, set) else stems_of(a)
    sb = b if isinstance(b, set) else stems_of(b)
    if not sa or not sb:
        return 0.0
    return 2 * len(sa & sb) / (len(sa) + len(sb))


def _clean(text: Any) -> str:
    return " ".join(str(text or "").split())


def cluster_similar(
    items: list[dict[str, Any]],
    *,
    threshold: float = DEFAULT_THRESHOLD,
    text_key: str = "text",
    weight_key: str = "weight",
) -> list[dict[str, Any]]:
    """Сгруппировать близкие записи. Возвращает кластеры, сильные — первыми."""
    threshold = max(0.0, min(1.0, float(threshold)))

    prepared: list[dict[str, Any]] = []
    for it in items:
        text = _clean(it.get(text_key))
        if len(text) < MIN_TEXT_CHARS:
            continue
        try:
            weight = float(it.get(weight_key, 1) or 1)
        except (TypeError, ValueError):
            weight = 1.0
        prepared.append({"item": it, "text": text, "weight": weight,
                         "stems": stems_of(text)})

    # Тяжёлые записи идут первыми: представителем кластера станет значимая
    # формулировка, а не случайная короткая.
    prepared.sort(key=lambda p: (p["weight"], len(p["text"])), reverse=True)

    clusters: list[dict[str, Any]] = []
    for p in prepared:
        best: dict[str, Any] | None = None
        best_sim = 0.0
        for c in clusters:
            sim = similarity(p["stems"], c["_stems"])
            if sim > best_sim:
                best_sim, best = sim, c
        if best is not None and best_sim >= threshold:
            best["members"].append({"text": p["text"], "similarity": round(best_sim, 3),
                                    "source": p["item"]})
            best["weight"] += p["weight"]
            best["size"] += 1
        else:
            clusters.append({
                "label": p["text"][:120],
                "text": p["text"],
                "weight": p["weight"],
                "size": 1,
                "members": [],
                "_stems": p["stems"],
                "source": p["item"],
            })

    for c in clusters:
        c.pop("_stems", None)
        c["weight"] = round(c["weight"], 3)
    clusters.sort(key=lambda c: (c["size"], c["weight"]), reverse=True)
    return clusters


def compress(
    items: list[dict[str, Any]],
    *,
    threshold: float = DEFAULT_THRESHOLD,
    text_key: str = "text",
    weight_key: str = "weight",
) -> dict[str, Any]:
    """Сжать список и отчитаться, сколько удалось выиграть."""
    items = list(items or [])
    clusters = cluster_similar(items, threshold=threshold,
                               text_key=text_key, weight_key=weight_key)
    before = sum(1 for it in items if len(_clean(it.get(text_key))) >= MIN_TEXT_CHARS)
    after = len(clusters)
    merged = [c for c in clusters if c["size"] > 1]

    return {
        "ok": True,
        "threshold": threshold,
        "before": before,
        "after": after,
        "saved": max(0, before - after),
        "ratio": round(after / before, 3) if before else 1.0,
        "merged_groups": len(merged),
        "clusters": [
            {
                "label": c["label"],
                "size": c["size"],
                "weight": c["weight"],
                "members": [m["text"][:100] for m in c["members"][:5]],
            }
            for c in clusters[:40]
        ],
        "verdict": _verdict(before, after, len(merged)),
    }


def _verdict(before: int, after: int, merged: int) -> str:
    if before == 0:
        return "Нечего сжимать — записей нет."
    if merged == 0:
        return f"{before} записей, похожих нет — всё разное."
    saved = before - after
    pct = round(saved * 100 / before)
    return (f"{before} → {after}: свернул {merged} групп похожего, "
            f"освободил {saved} записей ({pct}%).")


def compress_texts(texts: Iterable[str], *, threshold: float = DEFAULT_THRESHOLD) -> dict[str, Any]:
    """Удобная обёртка для простого списка строк."""
    return compress([{"text": t} for t in texts], threshold=threshold)
