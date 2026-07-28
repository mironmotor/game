"""Experimental weighted association graph for Max17.

This is the first "synapse" layer: deterministic SQLite associations between
events, memories, routes, evaluations, tasks, states, and adaptations.

Поиск по графу голографический. Формула Бекенштейна-Хокинга

    S = k * A / (4 * l_p^2)

утверждает, что энтропия чёрной дыры пропорциональна **площади** горизонта, а
не объёму. Отсюда голографический принцип: всё, что происходит внутри
области, полностью закодировано на её границе.

Для графа связей это буквально практический выигрыш. Граф растёт как объём —
число рёбер, — но информация о нём живёт на границе: на узлах-хабах, через
которые проходят все пути между кластерами. Спроецировав граф на этот экран
один раз (O(E)), каждый последующий обход стоит O(A), где A — площадь
горизонта, а не O(V) по всему объёму. Чем плотнее граф, тем сильнее выигрыш:
объём растёт кубически, площадь — квадратично.

Заодно формула даёт температуру Хокинга T = 1/(8 pi M): маленький, лёгкий
граф «горячий» и быстро испаряется, тяжёлый граф холоден и стабилен.
"""

from __future__ import annotations

import hashlib
import json
import math
import sqlite3
import time
from pathlib import Path
from typing import Any

from mark17.events import Event

# --- Bekenstein-Hawking constants ------------------------------------------
# Planck length of the graph: the smallest link that can still be resolved.
PLANCK_LENGTH = 1.0
# Fraction of nodes, ranked by degree, that make up the horizon. The hubs are
# the screen everything else is projected onto.
BOUNDARY_FRACTION = 0.25
# A horizon needs a minimum area before projection means anything.
MIN_BOUNDARY = 4

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
        "recalled_with",
        "completed_after",
        "failed_after",
        "adapted_by",
    }
)


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


class SynapseGraph:
    def __init__(self, db_path: str | Path) -> None:
        path = Path(db_path)
        self.db_path = path if path.suffix == ".db" else path / "synapse_graph.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as c:
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

    def get_graph(self, limit: int = 400) -> dict[str, Any]:
        """Export the real synapse graph as nodes + edges for visualization."""
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
            total = c.execute("SELECT COUNT(*) AS n FROM synapses").fetchone()["n"]

        nodes: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []

        def node(ntype: str, nid: str) -> str:
            key = f"{ntype}:{nid}"
            n = nodes.get(key)
            if n is None:
                nodes[key] = {"id": key, "type": ntype, "label": nid[:16], "degree": 1}
            else:
                n["degree"] += 1
            return key

        for row in rows:
            d = self._row_to_dict(row)
            src = node(d["source_type"], d["source_id"])
            dst = node(d["target_type"], d["target_id"])
            edges.append(
                {
                    "source": src,
                    "target": dst,
                    "relation": d["relation_type"],
                    "weight": d["weight"],
                    "evidence": d["evidence_count"],
                    "summary": d["summary"],
                }
            )

        return {
            "nodes": list(nodes.values()),
            "edges": edges,
            "stats": {
                "total_synapses": int(total),
                "shown_synapses": len(edges),
                "nodes": len(nodes),
            },
        }

    # -- Holography ---------------------------------------------------------

    def horizon(self, *, limit: int = 2000) -> dict[str, Any]:
        """Project the graph onto its boundary and measure the horizon.

        One O(E) aggregation builds the screen; every search afterwards is
        bounded by the area of that screen rather than the volume of the graph.
        """
        with self._conn() as c:
            rows = c.execute(
                """
                SELECT node, COUNT(*) AS degree, SUM(w) AS mass
                FROM (
                    SELECT source_type || ':' || source_id AS node, weight AS w
                    FROM synapses
                    UNION ALL
                    SELECT target_type || ':' || target_id AS node, weight AS w
                    FROM synapses
                )
                GROUP BY node
                ORDER BY degree DESC, mass DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            edges = c.execute("SELECT COUNT(*) AS n FROM synapses").fetchone()["n"]

        nodes = [
            {
                "node": str(row["node"]),
                "degree": int(row["degree"]),
                "mass": round(float(row["mass"] or 0.0), 4),
            }
            for row in rows
        ]

        volume = len(nodes)
        if volume == 0:
            return {
                "boundary": [],
                "area": 0,
                "volume": 0,
                "edges": int(edges),
                "mass": 0.0,
                "entropy": 0.0,
                "temperature": 0.0,
                "information_bits": 0.0,
                "compression": 1.0,
                "equation": "S = k A / (4 l_p^2)",
            }

        area = max(MIN_BOUNDARY, int(volume * BOUNDARY_FRACTION))
        boundary = nodes[:area]
        area = len(boundary)

        # M — total mass-energy bound in the graph.
        mass = sum(node["mass"] for node in nodes)

        # S = A / 4 in natural units (k = l_p = 1).
        entropy = area / (4.0 * PLANCK_LENGTH**2)
        # Hawking temperature T = 1/(8 pi M): a light graph runs hot.
        temperature = 1.0 / (8.0 * math.pi * mass) if mass > 0 else 0.0

        return {
            "boundary": boundary,
            "area": area,
            "volume": volume,
            "edges": int(edges),
            "mass": round(mass, 4),
            "entropy": round(entropy, 4),
            "temperature": round(temperature, 6),
            # Bekenstein bound: the most information the interior can hold.
            "information_bits": round(entropy / math.log(2.0), 4),
            # How much of the volume the screen spares us from scanning.
            "compression": round(volume / area, 4) if area else 1.0,
            "equation": "S = k A / (4 l_p^2)",
        }

    def holographic_search(
        self,
        seed: str,
        *,
        limit: int = 8,
        screen: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Walk the graph across its boundary only — O(A), not O(V).

        ``seed`` is a ``"type:id"`` node key. Results are the strongest links
        from the seed that land on the horizon; interior nodes are skipped,
        because whatever they encode is already projected onto the screen.
        """
        screen = screen or self.horizon()
        boundary = {node["node"] for node in screen.get("boundary") or []}
        if not boundary:
            return {"seed": seed, "neighbours": [], "area": 0, "scanned": 0}

        with self._conn() as c:
            rows = c.execute(
                """
                SELECT
                    source_type || ':' || source_id AS src,
                    target_type || ':' || target_id AS dst,
                    relation_type,
                    weight,
                    evidence_count,
                    metadata_json
                FROM synapses
                WHERE source_type || ':' || source_id = ?
                   OR target_type || ':' || target_id = ?
                ORDER BY weight DESC, evidence_count DESC
                LIMIT ?
                """,
                (seed, seed, limit * 4),
            ).fetchall()

        neighbours: list[dict[str, Any]] = []
        scanned = 0
        for row in rows:
            scanned += 1
            other = str(row["dst"]) if str(row["src"]) == seed else str(row["src"])
            if other not in boundary:
                # Interior node: its information is already on the screen.
                continue
            try:
                metadata = json.loads(row["metadata_json"])
            except json.JSONDecodeError:
                metadata = {}
            neighbours.append(
                {
                    "node": other,
                    "relation": str(row["relation_type"]),
                    "weight": round(float(row["weight"]), 4),
                    "evidence": int(row["evidence_count"]),
                    "summary": _compact(metadata.get("summary")),
                }
            )
            if len(neighbours) >= limit:
                break

        return {
            "seed": seed,
            "neighbours": neighbours,
            "area": screen.get("area", 0),
            "volume": screen.get("volume", 0),
            "scanned": scanned,
            "on_horizon": seed in boundary,
        }

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
            "last_used": round(float(row["last_used"]), 3),
            "created_at": round(float(row["created_at"]), 3),
            "updated_at": round(float(row["updated_at"]), 3),
            "summary": _compact(metadata.get("summary")),
        }
