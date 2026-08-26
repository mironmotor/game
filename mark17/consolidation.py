"""Manual sleep/consolidation mode for Max17.

Compress recent memories and strong synapses into stable pattern memories.
This is deterministic and local: no background process, no external APIs.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
import re
from collections import defaultdict
from typing import Any

from mark17.events import Event
from mark17.concept_compression import compress_to_concept

TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_]+")
STOPWORDS = {
    "and",
    "the",
    "for",
    "with",
    "this",
    "that",
    "через",
    "пока",
    "этот",
    "такие",
    "событие",
    "события",
    "запрос",
    "задача",
    "task",
    "user_message",
    "remember",
    "session",
    "self",
    "evaluation",
    "self_evaluation",
    "evaluated",
    "evaluated_as",
    "as",
    "source",
    "route",
    "score",
    "status",
}

CONCEPTS = {
    "memory": {
        "memory",
        "semantic",
        "recall",
        "remember",
        "память",
        "памяти",
        "помнишь",
        "вспоминаю",
    },
    "pattern": {
        "pattern",
        "patterns",
        "consolidation",
        "паттерн",
        "паттерны",
        "связь",
        "связи",
    },
    "core": {
        "core",
        "brain",
        "kernel",
        "max17",
        "mark17",
        "ядро",
        "ядра",
        "мозг",
    },
    "development": {
        "development",
        "learning",
        "adaptive",
        "развитие",
        "обучение",
        "адаптация",
    },
    "task": {
        "task",
        "tasks",
        "completed",
        "failed",
        "deadline",
        "task_completed",
        "task_created",
        "deadline_failed",
        "задача",
        "квест",
        "дедлайн",
    },
}

CONCEPT_INDEX = {token: concept for concept, tokens in CONCEPTS.items() for token in tokens}


def _stable_id(text: str) -> str:
    return hashlib.blake2b(text.encode("utf-8"), digest_size=8).hexdigest()


# Собственный выхлоп ядра: в консолидацию он не возвращается.
SELF_OUTPUT_TYPES = frozenset({
    "consolidated_pattern",
    "compressed_concept",
    "ultra_decision",
    "semantic_ir",
    "system_state",
})

# Служебная лексика самого ядра. Она встречается в каждом втором тексте и
# всплывала «повторяющимся паттерном» тысячи раз, не неся смысла: «повторяющийся
# паттерн: goal (9 свидетельств)» — это не знание, это частота слова.
MACHINE_THEMES = frozenset({
    "goal", "action", "compress", "compressed", "concept", "pattern", "memory",
    "consolidation", "consolidated", "supports", "reinforces", "relates",
    "sleep", "ultra", "decision", "event", "state", "system", "core", "score",
    "leads", "relates", "intent", "plan", "adapted", "evaluated", "similar",
    "reinforce", "outcome", "synapse", "vector", "recall", "think",
    "дня", "день", "цель", "действие", "память", "паттерн", "решение", "ядро",
    "связь", "вектор", "опыт", "оценка",
    # Имена типов записей вшиты в сами тексты («web fact When confidence is
    # low…»), поэтому всплывают темами даже после вычитания event_type: одно
    # живое свидетельство тянет за собой десятки таких же из графа.
    "web fact", "user message", "voice observation", "environment observation",
    "task created", "task completed", "outcome success", "outcome failure",
    "memory store", "system state", "internal dream", "ultra decision",
    "consolidated pattern", "compressed concept", "semantic ir",
    # Разбитые на токены имена типов: тема «fact» приходила из каждой записи
    # web_fact, набирая 79 «свидетельств» на пустом месте.
    "web", "fact", "message", "observation", "usually", "также", "часто",
})

MIN_THEME_LEN = 4

# Паттерн с тем же смыслом не пишется заново, пока не остынет. Без этого
# консолидация складывала в память одну и ту же строку сотнями: «повторяющийся
# паттерн: compress» — 816 раз, «action» — 731. Память росла, знание — нет.
SEEN_FILE = "consolidation_seen.json"
SEEN_TTL_SEC = 7 * 24 * 3600


def _tokens(text: str) -> list[str]:
    tokens: list[str] = []
    for raw in TOKEN_RE.findall(text.casefold()):
        if len(raw) < 3 or raw in STOPWORDS:
            continue
        tokens.append(CONCEPT_INDEX.get(raw, raw))
    return tokens


def _memory_text(memory: Any) -> str:
    content = getattr(memory, "content", {})
    parts = [getattr(memory, "event_type", "")]
    if isinstance(content, dict):
        hint = content.get("hint")
        if hint:
            parts.append(str(hint))
        payload = content.get("payload")
        if isinstance(payload, dict):
            for key in ("note", "text", "line", "reinforce", "event_type"):
                value = payload.get(key)
                if value:
                    parts.append(str(value))
            task = payload.get("task")
            if isinstance(task, dict):
                for key in ("desc", "status", "mgr"):
                    value = task.get(key)
                    if value:
                        parts.append(str(value))
    return " ".join(parts)


def _synapse_text(synapse: dict[str, Any]) -> str:
    return " ".join(
        str(synapse.get(key, ""))
        for key in ("source_type", "target_type", "relation_type", "summary")
    )


class ConsolidationEngine:
    def __init__(self, hippocampus: Any, vector_memory: Any, synapse_graph: Any) -> None:
        self.hippocampus = hippocampus
        self.vector_memory = vector_memory
        self.synapse_graph = synapse_graph

    def consolidate_recent(self, limit: int = 50) -> dict[str, Any]:
        limit = max(5, min(int(limit or 50), 500))
        # Вход фильтруется по типу, и это главная правка v1.777. Раньше
        # hippocampus.recent() возвращал ВСЁ подряд, включая собственные
        # consolidated_pattern и compressed_concept, — консолидация жевала свой
        # же выхлоп и усиливала его. Замер на боевом: 11 980 паттернов, из них
        # уникальных 307; один «паттерн» записан 816 раз. Темы вроде «goal» и
        # «compress» рождались именно из служебных записей.
        memories = [
            m for m in self.hippocampus.recent(limit=limit * 3)
            if str(getattr(m, "event_type", "")) not in SELF_OUTPUT_TYPES
        ][:limit]
        synapses = self.synapse_graph.get_top_synapses(limit=min(limit, 50))

        buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for memory in memories:
            text = _memory_text(memory)
            # Тип записи попадает в её текст первым словом (_memory_text), и его
            # токены всплывали «паттернами»: «web fact (79 свидетельств)»,
            # «user message». Это метка, а не смысл, — из тем её вычитаем.
            type_tokens = set(_tokens(str(getattr(memory, "event_type", "")).replace("_", " ")))
            for token in set(_tokens(text)) - type_tokens:
                buckets[token].append(
                    {
                        "source": "memory",
                        "text": text,
                        "importance": float(getattr(memory, "importance", 0.5)),
                    }
                )

        for synapse in synapses:
            text = _synapse_text(synapse)
            for token in set(_tokens(text)):
                buckets[token].append(
                    {
                        "source": "synapse",
                        "text": text,
                        "importance": float(synapse.get("weight", 0.4) or 0.4),
                    }
                )

        patterns = [
            self._make_pattern(theme, evidence)
            for theme, evidence in buckets.items()
            # Три свидетельства вместо двух, тема не короче четырёх букв и не из
            # служебного словаря, а сами свидетельства — из РАЗНЫХ текстов:
            # раньше один и тот же текст, попавший в выборку дважды, уже давал
            # «повторяющийся паттерн».
            if len(evidence) >= 3
            and len(theme) >= MIN_THEME_LEN
            # Сравниваем по нормализованному виду: токенизатор оставляет
            # подчёркивания («web_fact»), а в тексте паттерна они превращаются в
            # пробелы («web fact») — стоп-лист иначе промахивается мимо.
            and theme.replace("_", " ") not in MACHINE_THEMES
            and theme not in MACHINE_THEMES
            and len({item["text"] for item in evidence}) >= 3
            # За паттерном должен стоять ЖИВОЙ опыт, а не структура графа.
            # Иначе темами становятся «leads to» и «compressed concept» — это
            # типы связей и имена служебных записей, а не то, что с нами было.
            and any(item["source"] == "memory" for item in evidence)
        ]
        patterns.sort(key=lambda item: (item["strength"], item["evidence_count"]), reverse=True)
        selected = patterns[:5]

        seen = self._load_seen()
        stored = []
        for pattern in selected:
            pid = str(pattern.get("pattern_id") or "")
            if pid and pid in seen:
                continue  # такой паттерн уже лежит в памяти — второй раз не пишем
            self._store_pattern(pattern)
            if pid:
                self._mark_seen(seen, pid)
            stored.append(pattern)

        return {
            "patterns_created": len(stored),
            "patterns_skipped_as_known": len(selected) - len(stored),
            "patterns": stored,
        }

    def bridge_distant(self, *, limit: int = 12, min_sim: float = 0.45, anchors: int = 40, k: int = 10) -> dict[str, Any]:
        """Phase 5 — cross-cluster bridges.

        Порог 0.45 вместо прежних 0.15: мост ищет НЕОЧЕВИДНОЕ сходство, поэтому
        планка ниже основной (0.7 в кузнице), но 0.15 на BGE-M3 — это уровень
        случайных пар, а такие связи попадают в ЗАРАБОТАННЫЕ и надувают дорогу к
        цели сильнее, чем similar_to, который из неё честно исключён. Wire associative "bridges" synapses
        between memories that are semantically close but live in DIFFERENT
        clusters (different event_type — e.g. a chat message and a camera/sound
        observation about the same thing). This is how distant context links into
        insight, and it generalises to any new sensory modality (audio state,
        vision) the moment it lands in vector memory.

        Deterministic and local: cosine over the in-memory matrix, one bridge per
        anchor, dedup by memory pair. Returns the bridges created.
        """
        import numpy as np

        vm = self.vector_memory
        vm._ensure_index()
        matrix = getattr(vm, "_matrix", None)
        meta = getattr(vm, "_meta", [])
        if matrix is None or matrix.shape[0] < 4:
            return {"bridges_created": 0, "bridges": []}

        order = sorted(range(len(meta)), key=lambda i: meta[i].get("importance", 0.0), reverse=True)[: max(4, anchors)]
        seen: set[tuple[int, int]] = set()
        bridges: list[dict[str, Any]] = []
        for i in order:
            sims = matrix @ matrix[i]
            for j in np.argsort(sims)[::-1][:k].tolist():
                j = int(j)
                sim = float(sims[j])
                if j == i or sim < min_sim:
                    continue
                a, b = meta[i], meta[j]
                if a.get("event_type") == b.get("event_type"):
                    continue  # same cluster — not a bridge
                pair = (min(a["id"], b["id"]), max(a["id"], b["id"]))
                if pair in seen:
                    continue
                seen.add(pair)
                a_sum = (a.get("summary") or a.get("text") or "")[:70]
                b_sum = (b.get("summary") or b.get("text") or "")[:70]
                sid, tid = _stable_id(a_sum + a["event_type"]), _stable_id(b_sum + b["event_type"])
                if sid == tid:
                    continue
                self.synapse_graph.upsert(
                    source_type="memory_bridge",
                    source_id=sid,
                    target_type="memory_bridge",
                    target_id=tid,
                    relation_type="bridges",
                    weight=min(1.0, sim * 1.5),
                    metadata={
                        "summary": f"мост: {a_sum} ⟷ {b_sum}",
                        "source": "consolidation_bridge",
                        "a_type": a["event_type"],
                        "b_type": b["event_type"],
                        "sim": round(sim, 3),
                    },
                )
                bridges.append({"a": a_sum, "b": b_sum, "a_type": a["event_type"], "b_type": b["event_type"], "sim": round(sim, 3)})
                break  # one bridge per anchor keeps it diverse
            if len(bridges) >= limit:
                break
        return {"bridges_created": len(bridges), "bridges": bridges}

    def _make_pattern(self, theme: str, evidence: list[dict[str, Any]]) -> dict[str, Any]:
        evidence_count = len(evidence)
        avg_importance = sum(item["importance"] for item in evidence) / evidence_count
        strength = min(1.0, avg_importance * 0.7 + min(evidence_count / 8, 1.0) * 0.3)
        examples = [item["text"] for item in evidence[:3]]
        summary = self._summary(theme, evidence_count, examples)
        compressed = compress_to_concept(" ".join([theme, summary, *examples]))
        primary = compressed.get("primary") if isinstance(compressed, dict) else {}
        primary = primary if isinstance(primary, dict) else {}
        return {
            "pattern_id": f"pattern:{_stable_id(theme + summary)}",
            "summary": summary,
            "evidence_count": evidence_count,
            "strength": round(strength, 4),
            "source": "consolidation",
            "concept": primary.get("concept"),
            "label": primary.get("label"),
            "concept_confidence": primary.get("confidence"),
        }

    def _summary(self, theme: str, evidence_count: int, examples: list[str]) -> str:
        readable = theme.replace("_", " ")
        if theme in CONCEPTS:
            readable = {
                "memory": "память и recall",
                "pattern": "паттерны и связи",
                "core": "развитие ядра",
                "development": "обучение и адаптация",
                "task": "задачи и результаты",
            }.get(theme, readable)

        return f"Повторяющийся паттерн: {readable} ({evidence_count} свидетельств)."

    def _seen_path(self) -> Path | None:
        try:
            return Path(self.vector_memory.db_path).parent / SEEN_FILE
        except Exception:  # noqa: BLE001 - без пути просто не дедуплицируем
            return None

    def _load_seen(self) -> dict[str, float]:
        path = self._seen_path()
        if path is None or not path.exists():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return {}
        if not isinstance(data, dict):
            return {}
        now = time.time()
        return {k: float(v) for k, v in data.items() if now - float(v or 0) < SEEN_TTL_SEC}

    def _mark_seen(self, seen: dict[str, float], pattern_id: str) -> None:
        path = self._seen_path()
        if path is None:
            return
        seen[pattern_id] = time.time()
        try:
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(seen), encoding="utf-8")
            tmp.replace(path)
        except Exception:  # noqa: BLE001 - дедуп не критичнее самой консолидации
            pass

    def _store_pattern(self, pattern: dict[str, Any]) -> None:
        event = Event(
            type="consolidated_pattern",
            payload=pattern,
            source="consolidation",
        )
        self.hippocampus.remember(
            event,
            hint=str(pattern["summary"]),
            action="consolidation",
        )
        self.vector_memory.remember(
            event,
            {
                "score": pattern["strength"],
                "reason": "sleep consolidation pattern",
                "reinforce": pattern["summary"],
            },
        )
        if pattern.get("concept") and pattern.get("label"):
            concept_event = Event(
                type="compressed_concept",
                payload={
                    "concept": pattern.get("concept"),
                    "label": pattern.get("label"),
                    "pattern_id": pattern.get("pattern_id"),
                    "summary": pattern.get("summary"),
                    "source": "consolidation",
                },
                source="consolidation",
            )
            self.hippocampus.remember(
                concept_event,
                hint=f"{pattern.get('label')}: {pattern.get('summary')}",
                action="concept_crystallization",
            )
            self.vector_memory.remember(
                concept_event,
                {
                    "score": pattern["strength"],
                    "reason": "concept crystallized during sleep consolidation",
                    "reinforce": str(pattern.get("label") or ""),
                },
            )
