"""Graph statistics and 100k synapse growth tracker for Max17."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from mark17.synapse_graph import SynapseGraph

TARGET_SYNAPSES = 100_000


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
        progress = min(1.0, total_synapses / self.target_synapses)
        remaining = max(0, self.target_synapses - total_synapses)
        return {
            "target_synapses": self.target_synapses,
            "total_synapses": total_synapses,
            "remaining_to_target": remaining,
            "progress": round(progress, 4),
            "progress_percent": round(progress * 100, 2),
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
