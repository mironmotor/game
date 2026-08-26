"""Graph statistics and 100k synapse growth tracker for Max17."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from mark17.synapse_graph import SynapseGraph

TARGET_SYNAPSES = 1_000_000


def _round(value: Any, digits: int = 4) -> float:
    if isinstance(value, (int, float)):
        return round(float(value), digits)
    return 0.0


class GraphStats:
    def __init__(self, synapse_graph: SynapseGraph, *, target_synapses: int = TARGET_SYNAPSES) -> None:
        self.synapse_graph = synapse_graph
        self.target_synapses = max(1, int(target_synapses or TARGET_SYNAPSES))

    def collect(self, *, limit: int = 5) -> dict[str, Any]:
        with self.synapse_graph._conn() as c:
            totals = c.execute(
                """
                SELECT
                    COUNT(*) AS total_synapses,
                    COUNT(*) FILTER (WHERE weight >= 0.2 AND evidence_count >= 1) AS useful_synapses,
                    COUNT(*) FILTER (WHERE weight >= 0.2 AND evidence_count >= 2) AS working_synapses,
                    COUNT(*) FILTER (WHERE weight >= 0.2 AND evidence_count >= 3) AS reinforced_synapses,
                    COUNT(*) FILTER (WHERE weight >= 0.2 AND evidence_count >= 5) AS strong_synapses,
                    -- ЧЕСТНАЯ ЛЕСТНИЦА. 'similar_to' — это вычисленное косинусное
                    -- сходство (арифметика, не знание), 'ir_node' — служебные узлы
                    -- IR-компиляции. Они раздували счёт до 674k при 3k выученных.
                    COUNT(*) FILTER (
                        WHERE relation_type != 'similar_to' AND source_type != 'ir_node'
                    ) AS structural_synapses,
                    COUNT(*) FILTER (
                        WHERE relation_type != 'similar_to' AND source_type != 'ir_node'
                          AND weight >= 0.2 AND evidence_count >= 2
                    ) AS earned_synapses,
                    COUNT(*) FILTER (WHERE relation_type = 'leads_to') AS causal_synapses,
                    COALESCE(SUM(evidence_count), 0) AS total_evidence,
                    COALESCE(AVG(weight), 0) AS avg_weight,
                    COALESCE(MAX(weight), 0) AS max_weight
                FROM synapses
                """
            ).fetchone()
            unique_nodes = c.execute(
                """
                SELECT COUNT(*)
                FROM (
                    SELECT source_type || ':' || source_id AS node FROM synapses
                    UNION
                    SELECT target_type || ':' || target_id AS node FROM synapses
                )
                """
            ).fetchone()[0]
            relation_rows = c.execute(
                """
                SELECT relation_type, COUNT(*) AS count, COALESCE(AVG(weight), 0) AS avg_weight
                FROM synapses
                GROUP BY relation_type
                ORDER BY count DESC, avg_weight DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            type_rows = c.execute(
                """
                SELECT node_type, COUNT(*) AS count
                FROM (
                    SELECT source_type AS node_type FROM synapses
                    UNION ALL
                    SELECT target_type AS node_type FROM synapses
                )
                GROUP BY node_type
                ORDER BY count DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            concept_rows = c.execute(
                """
                SELECT concept, COUNT(*) AS count
                FROM (
                    SELECT source_id AS concept FROM synapses
                    WHERE source_type IN ('concept', 'compressed_concept')
                    UNION ALL
                    SELECT target_id AS concept FROM synapses
                    WHERE target_type IN ('concept', 'compressed_concept')
                )
                GROUP BY concept
                ORDER BY count DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        total_synapses = int(totals["total_synapses"])
        useful_synapses = int(totals["useful_synapses"])
        structural_synapses = int(totals["structural_synapses"])
        earned_synapses = int(totals["earned_synapses"])
        # Путь к 1M считаем по ЗАРАБОТАННЫМ: связь засчитывается, только если она
        # не механическое сходство и подтверждена опытом больше одного раза.
        earned_progress = min(1.0, earned_synapses / self.target_synapses)
        # ГЛАВНЫЙ progress теперь тоже по заработанным. Раньше он считался по
        # useful_synapses, куда входит similar_to, — а замер показал, что 90.5%
        # этих связей натянуты между служебными записями ядра (дубликатами
        # собственных паттернов). Прогресс к цели измерялся объёмом собственного
        # шума. Прежняя величина осталась под именем useful_progress: она честно
        # называется тем, что есть, и ничего не обещает.
        progress = earned_progress
        remaining = max(0, self.target_synapses - earned_synapses)
        useful_progress = min(1.0, useful_synapses / self.target_synapses)
        return {
            "target_synapses": self.target_synapses,
            "total_synapses": total_synapses,
            "useful_synapses": useful_synapses,
            "structural_synapses": structural_synapses,
            "earned_synapses": earned_synapses,
            "causal_synapses": int(totals["causal_synapses"]),
            "earned_progress": round(earned_progress, 5),
            "earned_percent": round(earned_progress * 100, 3),
            "earned_remaining": max(0, self.target_synapses - earned_synapses),
            "working_synapses": int(totals["working_synapses"]),
            "reinforced_synapses": int(totals["reinforced_synapses"]),
            "strong_synapses": int(totals["strong_synapses"]),
            "remaining_to_target": remaining,
            "progress": round(progress, 4),
            "progress_percent": round(progress * 100, 2),
            "useful_progress": round(useful_progress, 4),
            "useful_percent": round(useful_progress * 100, 2),
            "unique_nodes": int(unique_nodes),
            "total_evidence": int(totals["total_evidence"]),
            "avg_weight": _round(totals["avg_weight"]),
            "max_weight": _round(totals["max_weight"]),
            "top_relations": [
                {
                    "relation_type": str(row["relation_type"]),
                    "count": int(row["count"]),
                    "avg_weight": _round(row["avg_weight"]),
                }
                for row in relation_rows
            ],
            "top_node_types": [
                {
                    "node_type": str(row["node_type"]),
                    "count": int(row["count"]),
                }
                for row in type_rows
            ],
            "top_concepts": [
                {
                    "concept": str(row["concept"]),
                    "count": int(row["count"]),
                }
                for row in concept_rows
            ],
            "top_synapses": self.synapse_graph.get_top_synapses(limit=limit),
        }


def collect_store_counts(state_dir: Path) -> dict[str, int]:
    tables = {
        "memories": ("memory.db", "memories"),
        "vector_memories": ("vector_memory.db", "vector_memories"),
        "concepts": ("concepts.db", "concepts"),
        "web_sources": ("source_memory.db", "web_sources"),
        "web_facts": ("source_memory.db", "web_facts"),
    }
    counts: dict[str, int] = {}
    for key, (db_name, table) in tables.items():
        db_path = state_dir / db_name
        if not db_path.exists():
            counts[key] = 0
            continue
        with sqlite3.connect(db_path) as conn:
            counts[key] = int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    return counts
