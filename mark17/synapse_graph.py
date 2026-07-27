"""Experimental weighted association graph for Max17.

This is the first "synapse" layer: deterministic SQLite associations between
events, memories, routes, evaluations, tasks, states, and adaptations.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mark17.events import Event

RELATION_TYPES = frozenset(
    {
        "similar_to",
        "caused_by",
        "reinforces",
        "weakens",
        "leads_to",
        "routed_to",
        "evaluated_as",
        "related_to",
        "bridges",
        "recalled_with",
        "completed_after",
        "failed_after",
        "adapted_by",
        "compressed_as",
        "contains",
        "bridges_to",
        "grounds",
        "activates",
        "synergy_with",
        "supports",
        "contradicts",
        "part_of",
        "instance_of",
        "same_as",
        "before",
        "after",
        "goal_of",
        "blocks",
        "enables",
        "emotion_of",
        "action_result",
        "alias_of",
        "duplicate_of",
        "validated_by",
    }
)

RELATION_CONFIDENCE_WEIGHT: dict[str, float] = {
    "similar_to": 0.78,
    "related_to": 0.82,
    "recalled_with": 0.88,
    "supports": 0.94,
    "part_of": 0.96,
    "instance_of": 0.96,
    "before": 0.96,
    "after": 0.96,
    "goal_of": 0.98,
    "blocks": 1.0,
    "enables": 1.0,
    "caused_by": 1.0,
    "leads_to": 1.0,
    "action_result": 1.0,
    "contradicts": 1.0,
    "validated_by": 1.0,
}


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _stable_id(*parts: Any) -> str:
    raw = json.dumps(parts, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.blake2b(raw.encode("utf-8"), digest_size=8).hexdigest()


def _event_id(event: Event) -> str:
    return _stable_id(event.type, event.signature())


def _confidence(result: dict[str, Any]) -> float:
    plasticity = result.get("plasticity")
    if isinstance(plasticity, dict) and isinstance(plasticity.get("confidence"), (int, float)):
        return _clamp(float(plasticity["confidence"]))

    decision = result.get("decision")
    if isinstance(decision, dict) and isinstance(decision.get("confidence"), (int, float)):
        return _clamp(float(decision["confidence"]))

    return 0.0


def _evaluation_score(evaluation: dict[str, Any] | None) -> float:
    if isinstance(evaluation, dict) and isinstance(evaluation.get("score"), (int, float)):
        return _clamp(float(evaluation["score"]))
    return 0.0


def _base_weight(result: dict[str, Any], evaluation: dict[str, Any] | None) -> float:
    confidence = _confidence(result)
    score = _evaluation_score(evaluation)
    return _clamp(0.1 + confidence * 0.45 + score * 0.45)


def _event_text(event: Event) -> str:
    payload = event.payload
    if isinstance(payload.get("text"), str):
        return str(payload["text"]).strip()
    if isinstance(payload.get("line"), str):
        return str(payload["line"]).strip()
    task = payload.get("task")
    if isinstance(task, dict) and task.get("desc"):
        return str(task["desc"]).strip()
    return event.type


def _compact(value: Any, limit: int = 180) -> str:
    return str(value or "").strip()[:limit]


def _edge_confidence(row: sqlite3.Row, metadata: dict[str, Any]) -> float:
    weight = _clamp(float(row["weight"]))
    evidence = max(1, int(row["evidence_count"]))
    evidence_factor = 0.58 + 0.42 * min(1.0, math.log1p(evidence) / math.log(6.0))
    relation_factor = RELATION_CONFIDENCE_WEIGHT.get(str(row["relation_type"]), 0.9)
    age_days = max(0.0, (time.time() - float(row["updated_at"])) / 86400.0)
    recency_factor = 0.88 + 0.12 * math.exp(-age_days / 90.0)
    try:
        source_trust = _clamp(float(metadata.get("source_trust", 1.0)), 0.2, 1.0)
    except (TypeError, ValueError):
        source_trust = 1.0
    try:
        hub_degree = max(
            int(metadata.get("source_degree", 0) or 0),
            int(metadata.get("target_degree", 0) or 0),
        )
    except (TypeError, ValueError):
        hub_degree = 0
    hub_penalty = 1.0 if hub_degree <= 40 else 1.0 / math.sqrt(hub_degree / 40.0)
    return _clamp(
        weight * evidence_factor * relation_factor * recency_factor * source_trust * hub_penalty
    )


@dataclass(frozen=True)
class BulkRecord:
    """Single synapse record for batch upsert via SynapseGraph.bulk_upsert()."""
    source_type: str
    source_id: str
    target_type: str
    target_id: str
    relation_type: str
    weight: float
    metadata: dict[str, Any] | None = None


class SynapseGraph:
    def __init__(self, db_path: str | Path) -> None:
        path = Path(db_path)
        self.db_path = path if path.suffix == ".db" else path / "synapse_graph.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_db(self) -> None:
        with self._conn() as c:
            c.execute("PRAGMA journal_mode=WAL")
            c.execute("PRAGMA synchronous=NORMAL")
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS synapses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_type TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    target_type TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    relation_type TEXT NOT NULL,
                    weight REAL NOT NULL,
                    evidence_count INTEGER NOT NULL,
                    last_used REAL NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    metadata_json TEXT NOT NULL
                )
                """
            )
            c.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_synapse_unique
                ON synapses(source_type, source_id, target_type, target_id, relation_type)
                """
            )
            c.execute(
                "CREATE INDEX IF NOT EXISTS idx_synapse_weight ON synapses(weight, evidence_count)"
            )
            c.execute(
                "CREATE INDEX IF NOT EXISTS idx_synapse_target ON synapses(target_type, target_id)"
            )
            c.execute(
                "CREATE INDEX IF NOT EXISTS idx_synapse_relation ON synapses(relation_type)"
            )
            c.execute(
                "CREATE INDEX IF NOT EXISTS idx_synapse_evidence ON synapses(evidence_count)"
            )

    def upsert_synapse(
        self,
        *,
        source_type: str,
        source_id: str,
        target_type: str,
        target_id: str,
        relation_type: str,
        weight: float,
        metadata: dict[str, Any] | None = None,
    ) -> int:
        if relation_type not in RELATION_TYPES:
            relation_type = "related_to"

        now = time.time()
        incoming_weight = _clamp(weight)
        metadata_json = json.dumps(metadata or {}, ensure_ascii=False, sort_keys=True)
        with self._conn() as c:
            row = c.execute(
                """
                SELECT id, weight, evidence_count
                FROM synapses
                WHERE source_type = ?
                  AND source_id = ?
                  AND target_type = ?
                  AND target_id = ?
                  AND relation_type = ?
                """,
                (source_type, source_id, target_type, target_id, relation_type),
            ).fetchone()
            if row:
                old_weight = float(row["weight"])
                if incoming_weight > old_weight:
                    new_weight = old_weight + (incoming_weight - old_weight) * 0.25
                else:
                    new_weight = old_weight + incoming_weight * 0.02
                c.execute(
                    """
                    UPDATE synapses
                    SET weight = ?,
                        evidence_count = ?,
                        last_used = ?,
                        updated_at = ?,
                        metadata_json = ?
                    WHERE id = ?
                    """,
                    (
                        _clamp(new_weight),
                        int(row["evidence_count"]) + 1,
                        now,
                        now,
                        metadata_json,
                        int(row["id"]),
                    ),
                )
                return int(row["id"])

            cur = c.execute(
                """
                INSERT INTO synapses
                (source_type, source_id, target_type, target_id, relation_type, weight,
                 evidence_count, last_used, created_at, updated_at, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                """,
                (
                    source_type,
                    source_id,
                    target_type,
                    target_id,
                    relation_type,
                    incoming_weight,
                    now,
                    now,
                    now,
                    metadata_json,
                ),
            )
            return int(cur.lastrowid)

    def upsert(
        self,
        *,
        source_type: str,
        source_id: str,
        target_type: str,
        target_id: str,
        relation_type: str,
        weight: float,
        metadata: dict[str, Any] | None = None,
    ) -> int:
        return self.upsert_synapse(
            source_type=source_type,
            source_id=source_id,
            target_type=target_type,
            target_id=target_id,
            relation_type=relation_type,
            weight=weight,
            metadata=metadata,
        )

    def bulk_upsert(self, records: list[BulkRecord]) -> int:
        """Batch upsert: single transaction for all records.

        1. Deduplicate repeated keys inside the incoming batch.
        2. Pre-fetch existing rows matching the unique key in one SELECT.
        3. Compute blended weights in Python (same formula as upsert_synapse).
        4. INSERT new + UPDATE existing via two executemany calls in one commit.

        Returns total number of rows written.
        """
        if not records:
            return 0

        now = time.time()

        # Normalize and collapse duplicate undirected kNN pairs. Without this,
        # two identical new records in one executemany violate idx_synapse_unique;
        # duplicate updates also lose evidence because each starts from the same
        # pre-fetched evidence_count. Keep the strongest observation per key.
        normalized_by_key: dict[
            tuple[str, str, str, str, str],
            tuple[str, str, str, str, str, float, str],
        ] = {}
        for rec in records:
            rt = rec.relation_type if rec.relation_type in RELATION_TYPES else "related_to"
            key = (rec.source_type, rec.source_id, rec.target_type, rec.target_id, rt)
            normalized = (
                rec.source_type, rec.source_id, rec.target_type, rec.target_id,
                rt, _clamp(rec.weight),
                json.dumps(rec.metadata or {}, ensure_ascii=False, sort_keys=True),
            )
            previous = normalized_by_key.get(key)
            if previous is None or normalized[5] > previous[5]:
                normalized_by_key[key] = normalized

        norm_records = list(normalized_by_key.values())

        with self._conn() as c:
            # 1. Batch SELECT — fetch all existing rows matching our keys
            unique_keys = list(dict.fromkeys(k for r in norm_records for k in [r[:5]]))
            placeholders = ",".join("(?,?,?,?,?)" for _ in unique_keys)
            flat_keys: list[str] = []
            for k in unique_keys:
                flat_keys.extend(k)

            existing: dict[tuple[str, str, str, str, str], tuple[int, float, int]] = {}
            if flat_keys:
                rows = c.execute(
                    f"SELECT id, source_type, source_id, target_type, target_id, relation_type, weight, evidence_count "
                    f"FROM synapses WHERE (source_type, source_id, target_type, target_id, relation_type) IN ({placeholders})",
                    flat_keys,
                ).fetchall()
                for row in rows:
                    ekey = (row[1], row[2], row[3], row[4], row[5])
                    existing[ekey] = (int(row[0]), float(row[6]), int(row[7]))

            # 2. Split into inserts and updates
            inserts: list[tuple[str, str, str, str, str, float, int, float, float, float, str]] = []
            updates: list[tuple[float, int, float, float, str, int]] = []

            for st, si, tt, ti, rt, w, mj in norm_records:
                key = (st, si, tt, ti, rt)
                if key in existing:
                    old_id, old_weight, old_evidence = existing[key]
                    # Same blend formula as upsert_synapse
                    if w > old_weight:
                        new_weight = old_weight + (w - old_weight) * 0.25
                    else:
                        new_weight = old_weight + w * 0.02
                    updates.append((
                        _clamp(new_weight),
                        old_evidence + 1,
                        now, now, mj, old_id,
                    ))
                else:
                    inserts.append((
                        st, si, tt, ti, rt, w,
                        1, now, now, now, mj,
                    ))

            # 3. executemany in single transaction
            if inserts:
                c.executemany(
                    """INSERT INTO synapses
                       (source_type, source_id, target_type, target_id, relation_type, weight,
                        evidence_count, last_used, created_at, updated_at, metadata_json)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    inserts,
                )
            if updates:
                c.executemany(
                    """UPDATE synapses
                       SET weight=?, evidence_count=?, last_used=?, updated_at=?, metadata_json=?
                       WHERE id=?""",
                    updates,
                )
            c.commit()

        return len(inserts) + len(updates)

    def count(self) -> int:
        with self._conn() as c:
            row = c.execute("SELECT COUNT(*) AS n FROM synapses").fetchone()
        return int(row["n"]) if row else 0

    def useful_count(self, *, min_weight: float = 0.2) -> int:
        """ПОЛЕЗНЫЕ синапсы: вес ≥ порога И есть подтверждение (evidence ≥ 1).
        По ним честно мерим дорогу к 1M, а не по сырому счётчику."""
        with self._conn() as c:
            row = c.execute(
                "SELECT COUNT(*) AS n FROM synapses WHERE weight >= ? AND evidence_count >= 1",
                (min_weight,),
            ).fetchone()
        return int(row["n"]) if row else 0

    def validated_count(self) -> int:
        """ЗАРАБОТАННЫЕ синапсы — подтверждённые реальным исходом (relation
        'validated_by'). Растёт ТОЛЬКО через успех агента/действия, не через
        массовый forge. Это и есть честное «useful, который реально пригодился»."""
        with self._conn() as c:
            row = c.execute(
                "SELECT COUNT(*) AS n FROM synapses WHERE relation_type = 'validated_by'"
            ).fetchone()
        return int(row["n"]) if row else 0

    def agent_experience_to_graph(
        self,
        *,
        agent: str,
        request_text: str,
        concepts: list[str] | None = None,
        ok: bool = True,
        score: float = 0.9,
        weight_boost: float = 1.2,
    ) -> dict[str, Any]:
        """Записать ОПЫТ агента в граф. Успех → заработанный, validated синапс:
        задача→исход(success) помечается 'validated_by' (её считает validated_count),
        а концепты, приведшие к успеху, усиливаются (с boost). Провал → слабая
        связь 'failed_after' (учимся на нём, но в «заработанные» не идёт).

        Один писатель (демон) — без гонок по SQLite."""
        text = " ".join(str(request_text or "").split())[:200]
        status = "success" if ok else "failure"
        base = max(0.05, min(1.0, float(score)))
        weight = min(1.0, base * (weight_boost if ok else 1.0))
        intent_id = _stable_id("intent", agent, text)
        outcome_id = _stable_id("agent_outcome", agent, text, status)
        meta = {"agent": agent, "status": status, "validated": ok, "summary": text[:120], "source_trust": 1.0}
        written = 0

        # Задача → исход. Успех = validated_by (заработано), провал = failed_after.
        self.upsert(
            source_type="intent", source_id=intent_id,
            target_type="outcome", target_id=outcome_id,
            relation_type="validated_by" if ok else "failed_after",
            weight=weight, metadata=meta,
        )
        written += 1

        # Концепты задачи усиливаются ТОЛЬКО при успехе (заработаны исходом).
        concs = [c for c in (concepts or []) if c][:8]
        if ok and concs:
            for c in concs:
                self.upsert(
                    source_type="concept", source_id=_stable_id("concept", c),
                    target_type="intent", target_id=intent_id,
                    relation_type="enables", weight=weight,
                    metadata={"concept": c, "agent": agent, "validated": True},
                )
                written += 1
            for i in range(len(concs) - 1):
                self.upsert(
                    source_type="concept", source_id=_stable_id("concept", concs[i]),
                    target_type="concept", target_id=_stable_id("concept", concs[i + 1]),
                    relation_type="reinforces", weight=weight * 0.9,
                    metadata={"validated": True, "agent": agent},
                )
                written += 1

        return {"written": written, "status": status, "weight": round(weight, 3)}

    def working_count(self, *, min_weight: float = 0.2, min_evidence: int = 2) -> int:
        with self._conn() as c:
            row = c.execute(
                "SELECT COUNT(*) AS n FROM synapses WHERE weight >= ? AND evidence_count >= ?",
                (float(min_weight), int(min_evidence)),
            ).fetchone()
        return int(row["n"]) if row else 0

    def memory_similarity_index(self) -> tuple[set[int], dict[int, int]]:
        """Return packed undirected memory-pair keys and current node degrees."""
        pairs: set[int] = set()
        degrees: dict[int, int] = {}
        with self._conn() as c:
            rows = c.execute(
                """
                SELECT source_id, target_id
                FROM synapses
                WHERE source_type = 'memory'
                  AND target_type = 'memory'
                  AND relation_type = 'similar_to'
                """
            )
            for row in rows:
                try:
                    a, b = int(row[0]), int(row[1])
                except (TypeError, ValueError):
                    continue
                lo, hi = (a, b) if a < b else (b, a)
                pairs.add((lo << 32) | hi)
                degrees[a] = degrees.get(a, 0) + 1
                degrees[b] = degrees.get(b, 0) + 1
        return pairs, degrees

    def prune_weak(self, *, weight_below: float = 0.12, max_evidence: int = 1, min_age_sec: float = 86400.0, limit: int = 5000) -> int:
        """Forget the weakest, least-evidenced, stale edges so a million-edge graph
        stays signal, not noise. Conservative: only edges below the weight floor
        AND with ≤max_evidence AND not touched for min_age. Returns rows pruned."""
        import time as _t

        cutoff = _t.time() - max(0.0, min_age_sec)
        with self._conn() as c:
            cur = c.execute(
                """
                DELETE FROM synapses
                WHERE id IN (
                    SELECT id FROM synapses
                    WHERE weight < ? AND evidence_count <= ? AND last_used < ?
                    ORDER BY weight ASC, last_used ASC
                    LIMIT ?
                )
                """,
                (float(weight_below), int(max_evidence), cutoff, int(limit)),
            )
            return int(cur.rowcount or 0)

    def compress_links(
        self,
        *,
        relation_type: str = "similar_to",
        keep_per_node: int = 12,
        apply: bool = False,
    ) -> dict[str, Any]:
        """Сжатие механических связей: у каждого узла оставить только K сильнейших
        соседей, длинный хвост забыть.

        Зачем: `similar_to` — это ВЫЧИСЛЕННОЕ косинусное сходство, а не выученное
        знание. Оно плодится веером (на узле находили до 444 связей при среднем
        13), раздувая граф и топя настоящие причинные связи. Сильнейшие соседи
        несут почти весь сигнал, хвост — балласт.

        Осторожно по умолчанию:
          • трогает ТОЛЬКО указанный relation_type (причинные/структурные не тронет);
          • `apply=False` — сухой прогон: считает, но НЕ удаляет;
          • оставляет сильнейшие по (weight, evidence_count).
        Возвращает отчёт: сколько было, сколько останется, сколько срезано.
        """
        rel = str(relation_type or "similar_to")
        keep = max(1, int(keep_per_node))
        with self._conn() as c:
            total = int(c.execute("SELECT COUNT(*) FROM synapses").fetchone()[0])
            before = int(
                c.execute("SELECT COUNT(*) FROM synapses WHERE relation_type = ?", (rel,)).fetchone()[0]
            )
            # id связей, НЕ попавших в топ-K своего узла
            doomed_sql = """
                SELECT id FROM (
                    SELECT id, ROW_NUMBER() OVER (
                        PARTITION BY source_type || ':' || source_id
                        ORDER BY weight DESC, evidence_count DESC, id ASC
                    ) AS rn
                    FROM synapses WHERE relation_type = ?
                ) WHERE rn > ?
            """
            doomed = int(
                c.execute(f"SELECT COUNT(*) FROM ({doomed_sql})", (rel, keep)).fetchone()[0]
            )
            removed = 0
            if apply and doomed:
                cur = c.execute(f"DELETE FROM synapses WHERE id IN ({doomed_sql})", (rel, keep))
                removed = int(cur.rowcount or 0)

        return {
            "relation_type": rel,
            "keep_per_node": keep,
            "applied": bool(apply),
            "total_before": total,
            "relation_before": before,
            "candidates": doomed,
            "removed": removed,
            "relation_after": before - removed,
            "total_after": total - removed,
            "percent_of_relation": round(100.0 * doomed / before, 1) if before else 0.0,
        }

    def get_top_synapses(self, limit: int = 5) -> list[dict[str, Any]]:
        with self._conn() as c:
            rows = c.execute(
                """
                SELECT *
                FROM synapses
                ORDER BY weight DESC, evidence_count DESC, updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [self._row_to_dict(row) for row in rows]

    def update_from_event(
        self,
        event: Event,
        result: dict[str, Any],
        evaluation: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        event_node = _event_id(event)
        base = _base_weight(result, evaluation)
        touched: list[int] = []

        def touch(
            source_type: str,
            source_id: str,
            target_type: str,
            target_id: str,
            relation_type: str,
            weight: float,
            metadata: dict[str, Any] | None = None,
        ) -> None:
            touched.append(
                self.upsert(
                    source_type=source_type,
                    source_id=source_id,
                    target_type=target_type,
                    target_id=target_id,
                    relation_type=relation_type,
                    weight=weight,
                    metadata=metadata,
                )
            )

        route = str(result.get("route") or "unknown")
        if event.type == "user_message":
            touch(
                "user_message",
                event_node,
                "route",
                route,
                "routed_to",
                base,
                {
                    "summary": f"user_message leads to route:{route}",
                    "event_text": _compact(_event_text(event)),
                    "confidence": round(_confidence(result), 4),
                },
            )

        memory = result.get("memory")
        if isinstance(memory, dict):
            for hit in memory.get("recalled") or []:
                if not isinstance(hit, dict) or hit.get("id") is None:
                    continue
                score = hit.get("score") if isinstance(hit.get("score"), (int, float)) else 0.0
                touch(
                    "event",
                    event_node,
                    "memory",
                    str(hit["id"]),
                    "recalled_with",
                    _clamp(base * 0.7 + min(float(score), 1.0) * 0.3),
                    {
                        "summary": _compact(hit.get("summary") or hit.get("reinforce")),
                        "event_type": event.type,
                        "memory_score": score,
                    },
                )

            for hit in memory.get("semantic") or []:
                if not isinstance(hit, dict) or hit.get("id") is None:
                    continue
                score = hit.get("score") if isinstance(hit.get("score"), (int, float)) else 0.0
                touch(
                    "event",
                    event_node,
                    "semantic_memory",
                    str(hit["id"]),
                    "similar_to",
                    _clamp(base * 0.65 + min(float(score), 1.0) * 0.35),
                    {
                        "summary": _compact(hit.get("summary") or hit.get("reinforce")),
                        "event_type": event.type,
                        "memory_score": score,
                    },
                )

        task = event.payload.get("task")
        if isinstance(task, dict) and task.get("id"):
            status = str(task.get("status") or event.type)
            relation = "related_to"
            if event.type == "task_completed" or status == "completed":
                relation = "completed_after"
            elif event.type == "deadline_failed" or status == "failed":
                relation = "failed_after"
            touch(
                "task",
                str(task["id"]),
                "status",
                status,
                relation,
                _clamp(base + 0.12),
                {
                    "summary": _compact(task.get("desc") or status),
                    "event_type": event.type,
                },
            )

        if isinstance(evaluation, dict):
            reason = str(evaluation.get("reason") or "self_evaluation")
            score = _evaluation_score(evaluation)
            evaluation_id = _stable_id(reason, round(score, 2))
            touch(
                "event",
                event_node,
                "self_evaluation",
                evaluation_id,
                "evaluated_as",
                _clamp(score or base),
                {
                    "summary": _compact(reason),
                    "score": round(score, 4),
                    "event_type": event.type,
                },
            )
            touch(
                "route",
                route,
                "self_evaluation",
                evaluation_id,
                "evaluated_as",
                _clamp(score or base),
                {
                    "summary": _compact(reason),
                    "score": round(score, 4),
                    "event_type": event.type,
                },
            )

        adaptation = str(result.get("next_adaptation") or "").strip()
        if adaptation:
            touch(
                "adaptation",
                _stable_id(adaptation),
                "event",
                event_node,
                "adapted_by",
                _clamp(base * 0.85),
                {
                    "summary": _compact(adaptation),
                    "event_type": event.type,
                },
            )

        return {
            "updated": len(touched),
            "top": self._fetch_synapses(touched, limit=3),
        }

    def _fetch_synapses(self, ids: list[int], *, limit: int = 3) -> list[dict[str, Any]]:
        if not ids:
            return []

        unique_ids = sorted(set(ids))
        placeholders = ",".join("?" for _ in unique_ids)
        with self._conn() as c:
            rows = c.execute(
                f"""
                SELECT *
                FROM synapses
                WHERE id IN ({placeholders})
                ORDER BY weight DESC, evidence_count DESC, updated_at DESC
                LIMIT ?
                """,
                (*unique_ids, limit),
            ).fetchall()

        top: list[dict[str, Any]] = []
        for row in rows:
            try:
                metadata = json.loads(row["metadata_json"])
            except json.JSONDecodeError:
                metadata = {}
            top.append(
                {
                    **self._row_to_dict(row, metadata=metadata),
                }
            )
        return top

    def _row_to_dict(
        self,
        row: sqlite3.Row,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if metadata is None:
            try:
                metadata = json.loads(row["metadata_json"])
            except json.JSONDecodeError:
                metadata = {}
        return {
            "id": int(row["id"]),
            "source_type": row["source_type"],
            "source_id": row["source_id"],
            "target_type": row["target_type"],
            "target_id": row["target_id"],
            "relation_type": row["relation_type"],
            "weight": round(float(row["weight"]), 4),
            "evidence_count": int(row["evidence_count"]),
            "confidence": round(_edge_confidence(row, metadata), 4),
            "last_used": round(float(row["last_used"]), 3),
            "created_at": round(float(row["created_at"]), 3),
            "updated_at": round(float(row["updated_at"]), 3),
            "summary": _compact(metadata.get("summary")),
        }


# ——— Опыт агентов → граф ———
# Успешное действие агента укрепляет связи (концепт→агент routed_to, концепт↔концепт
# reinforces, агент→исход action_result). Так граф учится, ЧТО работает: повторные
# успехи поднимают вес и evidence → связь становится «полезной» (useful_count).
_AGENT_STOP = {
    "the", "and", "for", "with", "that", "this",
    "и", "в", "на", "с", "по", "что", "как", "для", "это", "же", "бы", "ну", "да",
    "нет", "мне", "мы", "ты", "он", "она", "они", "все", "уже", "там", "тут", "или",
    "но", "сделай", "нужно", "надо",
}


def _task_keywords(text: str, k: int = 6) -> list[str]:
    """Лёгкое извлечение ключевых слов задачи (без тяжёлых зависимостей)."""
    toks = re.findall(r"[A-Za-zА-Яа-яЁё0-9_]{3,}", str(text or "").lower())
    seen: list[str] = []
    for t in toks:
        if t in _AGENT_STOP or t in seen:
            continue
        seen.append(t)
        if len(seen) >= k:
            break
    return seen


def agent_experience_to_graph(
    graph: SynapseGraph,
    *,
    agent: str,
    task: str,
    success: bool,
    concepts: list[str] | None = None,
    weight_boost: float = 1.2,
) -> dict[str, Any]:
    """Записать опыт агента в граф. Успех усиливает (вес × weight_boost), провал —
    слабый след (для избегания). Возвращает сводку."""
    kws = [c for c in (concepts or []) if c] or _task_keywords(task)
    if not kws:
        return {"ok": False, "edges": 0, "reason": "no concepts"}
    agent_node = f"agent:{agent}"
    outcome = "success" if success else "failure"
    w = _clamp(0.45 * weight_boost if success else 0.15)
    meta = {"agent": agent, "success": success, "summary": str(task or "")[:120]}
    edges = 0
    for kw in kws:  # концепт → агент: этот тип задач ведёт к этому агенту
        graph.upsert(source_type="concept", source_id=kw, target_type="agent",
                     target_id=agent_node, relation_type="routed_to", weight=w, metadata=meta)
        edges += 1
    for a, b in zip(kws, kws[1:]):  # со-встречаемость концептов в успешной задаче
        graph.upsert(source_type="concept", source_id=a, target_type="concept",
                     target_id=b, relation_type="reinforces", weight=_clamp(w * 0.8), metadata=meta)
        edges += 1
    graph.upsert(source_type="agent", source_id=agent_node, target_type="outcome",  # агент → исход
                 target_id=outcome, relation_type="action_result", weight=w, metadata=meta)
    edges += 1
    return {"ok": True, "edges": edges, "concepts": kws, "weight": round(w, 3), "outcome": outcome}


def record_agent_experience(
    state_dir: str | Path,
    *,
    agent: str,
    task: str,
    success: bool,
    weight_boost: float = 1.2,
) -> dict[str, Any]:
    """Обёртка для агентов (отдельный процесс): открыть граф (WAL-safe), записать
    опыт, залогировать learning-событие. Fail-soft — никогда не роняет агента."""
    try:
        graph = SynapseGraph(state_dir)
        res = agent_experience_to_graph(graph, agent=agent, task=task, success=success, weight_boost=weight_boost)
        try:
            from mark17 import growth_log

            growth_log.record_event(Path(state_dir), {
                "kind": "agent_experience", "agent": agent, "success": success,
                "edges": res.get("edges", 0), "useful": graph.useful_count(),
            })
        except Exception:  # noqa: BLE001
            pass
        return res
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "edges": 0, "error": str(exc)}
