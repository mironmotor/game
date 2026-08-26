"""Разжатие: концепт → живые следы, из которых он собран.

Сжатие в ядре работало в одну сторону. `compression.py` склеивает похожие
записи, `concept_compression.py` кристаллизует их в короткие ярлыки — «core»,
«consolidation», «interface», — и в граф честно пишется путь назад: 3999 связей
ведут в compressed_concept, у «core» их 1935. Но развернуть ярлык обратно было
нечем, а recall вдобавок прячет сжатое как служебное. Знание сжималось и
исчезало из виду в обе стороны сразу.

Здесь недостающая половина: по концепту поднимаются его источники (граф), а по
источникам — их настоящие тексты (векторная память). Сначала ярлык, за ним по
требованию — то, из чего он вырос. Хранить сжатое, разворачивать при нужде.
"""

from __future__ import annotations

from typing import Any

# Типы источников, чей текст лежит в векторной памяти и поднимается по id.
_TEXT_SOURCES = {"memory", "semantic_memory"}

# Заземлённое: слова человека, исходы дел, наблюдения о нём. Закон
# grounded_over_self (конституция v1.77) требует поднимать это выше собственных
# размышлений — иначе за концептом видно только другие ярлыки, а первый живой
# след тонет на десятом месте.
_GROUNDED = {
    "user_message",
    "task_completed",
    "task_created",
    "outcome_success",
    "outcome_failure",
    "outcome_partial",
    "remember",
    "voice_observation",
    "environment_observation",
    "web_fact",
}
# Чистая машинерия: полезна как связка, но не как ответ на «из чего это выросло».
_MACHINERY = {"compressed_concept", "consolidated_pattern", "ultra_decision", "semantic_ir", "pattern"}


def _texts_by_id(vector_memory: Any, ids: list[str]) -> dict[str, dict[str, str]]:
    """Тексты оригиналов одним запросом: по id хождение в БД по одному дорого."""
    numeric = []
    for raw in ids:
        try:
            numeric.append(int(raw))
        except (TypeError, ValueError):
            continue
    if not numeric:
        return {}
    placeholders = ",".join("?" for _ in numeric)
    try:
        with vector_memory._conn() as c:  # noqa: SLF001 - свой же слой памяти
            rows = c.execute(
                f"SELECT id, event_type, text, summary FROM vector_memories WHERE id IN ({placeholders})",
                numeric,
            ).fetchall()
    except Exception:  # noqa: BLE001 - память могла быть недоступна; вернём что есть
        return {}
    return {
        str(row["id"]): {
            "event_type": str(row["event_type"]),
            "text": str(row["text"]),
            "summary": str(row["summary"] or ""),
        }
        for row in rows
    }


def explain(
    synapse_graph: Any,
    vector_memory: Any,
    concept_id: str,
    *,
    limit: int = 6,
    text_chars: int = 220,
) -> dict[str, Any]:
    """Что стоит за концептом: сколько всего источников и первые из них живьём."""
    concept_id = str(concept_id or "").strip()
    if not concept_id:
        return {"concept": "", "total_sources": 0, "traces": []}

    # Берём с запасом: отбор идёт после подъёма текстов, потому что тип связи
    # («memory») ещё не говорит, живой ли это след или очередной ярлык.
    sources = synapse_graph.expand_concept(concept_id, limit=max(limit * 4, 12))
    total = synapse_graph.concept_sources_count(concept_id)

    lookup = _texts_by_id(
        vector_memory,
        [s["source_id"] for s in sources if s.get("source_type") in _TEXT_SOURCES],
    )

    traces: list[dict[str, Any]] = []
    for item in sources:
        found = lookup.get(str(item.get("source_id")))
        # Текст оригинала — лучшее, что можно показать. Если его нет (событие,
        # паттерн, вложенный концепт), берём summary связи: он писался при сжатии
        # и объясняет, почему источник вообще привязан к этому концепту.
        text = (found or {}).get("text") or item.get("summary") or ""
        traces.append(
            {
                "type": (found or {}).get("event_type") or item.get("source_type"),
                "weight": round(float(item.get("weight") or 0), 3),
                "evidence": int(item.get("evidence") or 0),
                "text": " ".join(str(text).split())[:text_chars],
                "nested": len(item.get("sources") or []),
            }
        )

    # Живое вперёд, машинерия следом; внутри групп — по весу и свидетельствам.
    def rank(t: dict[str, Any]) -> tuple[int, float]:
        kind = str(t.get("type") or "")
        tier = 0 if kind in _GROUNDED else (2 if kind in _MACHINERY else 1)
        return (tier, -(float(t.get("weight") or 0) * max(1, int(t.get("evidence") or 0))))

    traces.sort(key=rank)
    grounded = sum(1 for t in traces if str(t.get("type")) in _GROUNDED)
    traces = traces[:limit]
    return {
        "concept": concept_id,
        "total_sources": total,
        "shown": len(traces),
        "grounded_found": grounded,
        "traces": traces,
    }
