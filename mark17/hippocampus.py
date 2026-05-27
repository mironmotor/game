"""Hippocampus v0 — локальная память (SQLite), без embedding'ов."""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mark17.events import Event

DECAY_FACTOR = 0.995
IMPORTANCE_BOOST = 0.08
MIN_IMPORTANCE = 0.05


@dataclass
class MemoryHit:
    id: int
    event_type: str
    signature: str
    content: dict[str, Any]
    importance: float
    score: float


class Hippocampus:
    def __init__(self, state_dir: Path) -> None:
        self.db_path = state_dir / "memory.db"
        state_dir.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as c:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS memories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    signature TEXT NOT NULL,
                    content TEXT NOT NULL,
                    importance REAL DEFAULT 0.5,
                    hits INTEGER DEFAULT 0,
                    created_at REAL NOT NULL,
                    last_used REAL NOT NULL
                )
                """
            )
            c.execute(
                "CREATE INDEX IF NOT EXISTS idx_sig ON memories(signature)"
            )
            c.execute(
                "CREATE INDEX IF NOT EXISTS idx_type ON memories(event_type)"
            )

    def remember(self, event: Event, *, hint: str = "", action: str = "") -> int:
        content = {
            "payload": event.payload,
            "hint": hint,
            "action": action,
        }
        sig = event.signature()
        now = time.time()
        with self._conn() as c:
            row = c.execute(
                "SELECT id, importance, hits FROM memories WHERE signature = ?",
                (sig,),
            ).fetchone()
            if row:
                imp = min(1.0, row["importance"] + IMPORTANCE_BOOST)
                hits = row["hits"] + 1
                c.execute(
                    """
                    UPDATE memories
                    SET importance = ?, hits = ?, last_used = ?, content = ?
                    WHERE id = ?
                    """,
                    (imp, hits, now, json.dumps(content, ensure_ascii=False), row["id"]),
                )
                return int(row["id"])

            cur = c.execute(
                """
                INSERT INTO memories (event_type, signature, content, importance, hits, created_at, last_used)
                VALUES (?, ?, ?, 0.5, 1, ?, ?)
                """,
                (event.type, sig, json.dumps(content, ensure_ascii=False), now, now),
            )
            return int(cur.lastrowid)

    def recall(self, query: str, *, limit: int = 5) -> list[MemoryHit]:
        q = query.strip().lower()
        if not q:
            return []

        tokens = [t for t in q.split() if len(t) > 2]
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM memories ORDER BY importance DESC, last_used DESC LIMIT 200"
            ).fetchall()

        hits: list[MemoryHit] = []
        for row in rows:
            content = json.loads(row["content"])
            blob = json.dumps(content, ensure_ascii=False).lower()
            sig = row["signature"].lower()
            score = 0.0
            if q in blob or q in sig:
                score += 2.0
            for tok in tokens:
                if tok in blob or tok in sig:
                    score += 1.0
            if score <= 0:
                continue
            score *= float(row["importance"])
            hits.append(
                MemoryHit(
                    id=row["id"],
                    event_type=row["event_type"],
                    signature=row["signature"],
                    content=content,
                    importance=row["importance"],
                    score=score,
                )
            )

        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:limit]

    def recent(self, *, limit: int = 50) -> list[MemoryHit]:
        """Return recent memories without changing their score or hit counters."""
        with self._conn() as c:
            rows = c.execute(
                """
                SELECT *
                FROM memories
                ORDER BY last_used DESC, created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        return [
            MemoryHit(
                id=row["id"],
                event_type=row["event_type"],
                signature=row["signature"],
                content=json.loads(row["content"]),
                importance=row["importance"],
                score=row["importance"],
            )
            for row in rows
        ]

    def decay_all(self) -> int:
        """Synaptic scaling: редкие воспоминания слабеют."""
        removed = 0
        with self._conn() as c:
            rows = c.execute("SELECT id, importance FROM memories").fetchall()
            for row in rows:
                imp = row["importance"] * DECAY_FACTOR
                if imp < MIN_IMPORTANCE:
                    c.execute("DELETE FROM memories WHERE id = ?", (row["id"],))
                    removed += 1
                else:
                    c.execute(
                        "UPDATE memories SET importance = ? WHERE id = ?",
                        (imp, row["id"]),
                    )
        return removed

    def stats(self) -> dict[str, Any]:
        with self._conn() as c:
            n = c.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
            top = c.execute(
                "SELECT event_type, importance FROM memories ORDER BY importance DESC LIMIT 3"
            ).fetchall()
        return {
            "memories": n,
            "top": [{"type": r[0], "importance": round(r[1], 3)} for r in top],
        }
