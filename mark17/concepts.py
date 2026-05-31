"""Local concept grounding for Max17.

This module is intentionally small and deterministic. It gives Max17 a first
grounded concept map: basic words are linked to sensory primitives, relations,
and practical summaries. It does not claim human understanding.
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Any

from mark17.events import Event

TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_]+")


BASE_CONCEPTS: tuple[dict[str, Any], ...] = (
    {
        "id": "father",
        "label": "отец / папа",
        "aliases": ["отец", "папа", "батя", "father", "dad"],
        "category": "social_bond",
        "summary": "забота, происхождение, защита и передача опыта",
        "sensory_grounding": ["voice", "presence", "touch", "social_context"],
        "relations": ["care", "family", "growth", "safety"],
    },
    {
        "id": "mother",
        "label": "мать / мама",
        "aliases": ["мать", "мама", "mother", "mom"],
        "category": "social_bond",
        "summary": "рождение, тепло, забота, безопасность и первичная связь",
        "sensory_grounding": ["warmth", "voice", "touch", "presence", "safety"],
        "relations": ["care", "family", "love", "growth"],
    },
    {
        "id": "sun",
        "label": "солнце",
        "aliases": ["солнце", "sun"],
        "category": "natural_world",
        "summary": "источник света, тепла, дневного ритма и ориентации во времени",
        "sensory_grounding": ["vision_light", "warmth", "circadian_rhythm"],
        "relations": ["light", "body", "reality_contact"],
    },
    {
        "id": "light",
        "label": "свет",
        "aliases": ["свет", "light", "яркость", "фотон", "фотоны"],
        "category": "sensory_primitive",
        "summary": "визуальный сигнал: яркость, контраст и возможность видеть среду",
        "sensory_grounding": ["vision_light", "camera"],
        "relations": ["vision", "sun", "environment"],
    },
    {
        "id": "body",
        "label": "тело",
        "aliases": ["тело", "body", "телесность", "организм"],
        "category": "embodiment",
        "summary": "энергия, усталость, движение, дыхание и контакт с реальностью",
        "sensory_grounding": ["touch", "proprioception", "energy", "breath"],
        "relations": ["reality_contact", "safety", "action"],
    },
    {
        "id": "voice",
        "label": "голос / звук",
        "aliases": ["голос", "звук", "слышать", "слух", "voice", "sound", "hearing"],
        "category": "sensory_primitive",
        "summary": "звуковой канал: речь, тон, сигнал присутствия и обратная связь",
        "sensory_grounding": ["audio", "speech", "rhythm"],
        "relations": ["communication", "presence", "care"],
    },
    {
        "id": "vision",
        "label": "зрение",
        "aliases": ["зрение", "видеть", "камера", "глаза", "vision", "camera", "see"],
        "category": "sensory_primitive",
        "summary": "канал наблюдения среды через свет, движение и сцену",
        "sensory_grounding": ["camera", "vision_light", "motion"],
        "relations": ["environment", "light", "reality_contact"],
    },
    {
        "id": "touch",
        "label": "касание",
        "aliases": ["касание", "трогать", "тепло", "холод", "давление", "touch"],
        "category": "sensory_primitive",
        "summary": "контакт, температура, давление и границы тела",
        "sensory_grounding": ["touch", "temperature", "pressure"],
        "relations": ["body", "safety", "reality_contact"],
    },
    {
        "id": "memory",
        "label": "память",
        "aliases": ["память", "помнить", "вспомнить", "memory", "remember", "recall"],
        "category": "cognitive_process",
        "summary": "сохранение опыта, похожих смыслов, паттернов и результатов",
        "sensory_grounding": ["time", "association", "context"],
        "relations": ["learning", "growth", "synapse"],
    },
    {
        "id": "learning",
        "label": "обучение",
        "aliases": ["обучение", "учиться", "развитие", "learning", "development"],
        "category": "cognitive_process",
        "summary": "изменение поведения через опыт, результат и обратную связь",
        "sensory_grounding": ["feedback", "memory", "action"],
        "relations": ["growth", "outcome", "synapse"],
    },
    {
        "id": "care",
        "label": "забота",
        "aliases": ["забота", "заботиться", "care"],
        "category": "value",
        "summary": "действие, которое поддерживает жизнь, безопасность и развитие",
        "sensory_grounding": ["presence", "touch", "voice", "safety"],
        "relations": ["love", "family", "reality_contact"],
    },
    {
        "id": "love",
        "label": "любовь",
        "aliases": ["любовь", "любить", "love"],
        "category": "value",
        "summary": "живая связь, внимание, забота и ответственность перед другим",
        "sensory_grounding": ["presence", "body", "voice", "care"],
        "relations": ["care", "family", "reality_contact"],
    },
    {
        "id": "growth",
        "label": "рост",
        "aliases": ["рост", "расти", "развивать", "развитие", "growth"],
        "category": "process",
        "summary": "накопление полезных связей, навыков и устойчивых паттернов",
        "sensory_grounding": ["time", "feedback", "effort"],
        "relations": ["learning", "memory", "synapse"],
    },
    {
        "id": "reality_contact",
        "label": "контакт с реальностью",
        "aliases": ["реальность", "реальный", "действовать", "создавать", "reality"],
        "category": "principle",
        "summary": "связь ответа с телом, действием, работой, деньгами, людьми и результатом",
        "sensory_grounding": ["body", "environment", "action", "social_context"],
        "relations": ["body", "care", "outcome"],
    },
    {
        "id": "synapse",
        "label": "синапс",
        "aliases": ["синапс", "синапсы", "связь", "связи", "synapse"],
        "category": "association",
        "summary": "взвешенная связь между событием, памятью, понятием, планом и результатом",
        "sensory_grounding": ["association", "memory", "feedback"],
        "relations": ["memory", "learning", "growth"],
    },
)


def _normalize(text: Any) -> str:
    raw = str(text or "").casefold().replace("ё", "е")
    return " ".join(TOKEN_RE.findall(raw))


def _event_text(event: Event) -> str:
    if isinstance(event.payload.get("text"), str):
        return str(event.payload["text"]).strip()
    if isinstance(event.payload.get("line"), str):
        return str(event.payload["line"]).strip()
    if event.payload:
        return json.dumps(event.payload, ensure_ascii=False, sort_keys=True)[:500]
    return event.type


class ConceptGrounding:
    """SQLite-backed local concept map for deterministic grounding."""

    def __init__(self, db_path: str | Path) -> None:
        path = Path(db_path)
        self.db_path = path if path.suffix == ".db" else path / "concepts.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        self.seed_defaults()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as c:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS concepts (
                    id TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    aliases_json TEXT NOT NULL,
                    category TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    sensory_grounding_json TEXT NOT NULL,
                    relations_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                )
                """
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_concepts_category ON concepts(category)")

    def seed_defaults(self) -> None:
        now = time.time()
        with self._conn() as c:
            for concept in BASE_CONCEPTS:
                c.execute(
                    """
                    INSERT INTO concepts
                    (id, label, aliases_json, category, summary, sensory_grounding_json,
                     relations_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        label = excluded.label,
                        aliases_json = excluded.aliases_json,
                        category = excluded.category,
                        summary = excluded.summary,
                        sensory_grounding_json = excluded.sensory_grounding_json,
                        relations_json = excluded.relations_json,
                        updated_at = excluded.updated_at
                    """,
                    (
                        concept["id"],
                        concept["label"],
                        json.dumps(concept["aliases"], ensure_ascii=False),
                        concept["category"],
                        concept["summary"],
                        json.dumps(concept["sensory_grounding"], ensure_ascii=False),
                        json.dumps(concept["relations"], ensure_ascii=False),
                        now,
                        now,
                    ),
                )

    def all_concepts(self) -> list[dict[str, Any]]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM concepts ORDER BY id").fetchall()
        return [self._row_to_dict(row) for row in rows]

    def match_event(self, event: Event, *, limit: int = 8) -> dict[str, Any]:
        text = _event_text(event)
        normalized = f" {_normalize(text)} "
        if not normalized.strip():
            return {
                "matches": [],
                "sensory_channels": [],
                "summary": "",
                "count": 0,
                "source": "concept_grounding_v0",
            }

        matches: list[dict[str, Any]] = []
        for concept in self.all_concepts():
            aliases = concept.get("aliases")
            aliases = aliases if isinstance(aliases, list) else []
            matched_aliases = [
                alias
                for alias in aliases
                if f" {_normalize(alias)} " in normalized
            ]
            if not matched_aliases:
                continue
            positions = [
                normalized.find(f" {_normalize(alias)} ")
                for alias in matched_aliases
                if normalized.find(f" {_normalize(alias)} ") >= 0
            ]
            first_position = min(positions) if positions else 999_999
            score = min(1.0, 0.55 + len(matched_aliases) * 0.12)
            row = {
                "id": concept["id"],
                "label": concept["label"],
                "category": concept["category"],
                "summary": concept["summary"],
                "sensory_grounding": concept["sensory_grounding"],
                "relations": concept["relations"],
                "matched_aliases": matched_aliases[:3],
                "score": round(score, 3),
                "position": first_position,
            }
            matches.append(row)

        matches.sort(key=lambda item: (int(item["position"]), -float(item["score"]), str(item["id"])))
        matches = matches[:limit]
        channels: list[str] = []
        for concept in matches:
            sensory = concept.get("sensory_grounding")
            if not isinstance(sensory, list):
                continue
            for channel in sensory:
                if channel not in channels:
                    channels.append(str(channel))
        labels = [str(item["label"]) for item in matches[:4]]
        return {
            "matches": matches,
            "sensory_channels": channels[:12],
            "summary": ", ".join(labels),
            "count": len(matches),
            "source": "concept_grounding_v0",
        }

    def _row_to_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        def parse_list(raw: Any) -> list[str]:
            try:
                data = json.loads(str(raw or "[]"))
            except json.JSONDecodeError:
                return []
            return [str(item) for item in data] if isinstance(data, list) else []

        return {
            "id": str(row["id"]),
            "label": str(row["label"]),
            "aliases": parse_list(row["aliases_json"]),
            "category": str(row["category"]),
            "summary": str(row["summary"]),
            "sensory_grounding": parse_list(row["sensory_grounding_json"]),
            "relations": parse_list(row["relations_json"]),
        }
