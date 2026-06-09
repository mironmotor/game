"""Autonomous curiosity ledger — phase 2 self-learning for Max17.

When the user hits a knowledge gap that local memory could not satisfy, the topic
is recorded here. Later, on idle / sleep (or an explicit ``autonomous_research``
event), a curiosity pass picks the most-wanted open gaps, researches them on its
own, distills the facts into memory + the synapse graph, and marks them learned —
so the next time the question comes up it is answered from memory, offline.

The ledger itself is deterministic and local (SQLite). The actual web fetch in
the pass is gated by ``MAX17_AUTO_WEB`` (read in json_cli), so nothing leaves the
machine unless explicitly enabled.
"""

from __future__ import annotations

import re
import sqlite3
import time
from pathlib import Path
from typing import Any

_TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_]+")
# Question scaffolding stripped from a topic key so "найди что такое webrtc" and
# "что такое webrtc подробнее" collapse to the same gap.
_STOP = frozenset(
    {
        "что", "такое", "как", "почему", "зачем", "где", "когда", "кто", "это",
        "найди", "найти", "поищи", "посмотри", "расскажи", "объясни", "пожалуйста",
        "про", "для", "мне", "ты", "и", "а", "в", "на", "с", "по",
        "what", "is", "the", "how", "why", "who", "find", "search", "about", "tell",
        "me", "please", "explain", "and", "for", "of", "a", "an",
    }
)


def _topic_key(query: str) -> str:
    tokens = [t for t in _TOKEN_RE.findall(str(query or "").casefold().replace("ё", "е")) if t not in _STOP and len(t) >= 3]
    return " ".join(tokens[:10])


class CuriosityLedger:
    def __init__(self, state_dir: Path) -> None:
        self.db_path = state_dir / "curiosity.db"
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
                CREATE TABLE IF NOT EXISTS gaps (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    topic_key TEXT UNIQUE NOT NULL,
                    query TEXT NOT NULL,
                    hits INTEGER NOT NULL DEFAULT 1,
                    status TEXT NOT NULL DEFAULT 'open',
                    facts_learned INTEGER NOT NULL DEFAULT 0,
                    first_seen REAL NOT NULL,
                    last_seen REAL NOT NULL,
                    resolved_at REAL
                )
                """
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_gaps_status ON gaps(status)")

    def record_gap(self, query: str, *, source: str = "user") -> bool:
        """Record/refresh an unmet gap. Returns False if the query is too thin."""
        key = _topic_key(query)
        if not key:
            return False
        now = time.time()
        with self._conn() as c:
            c.execute(
                """
                INSERT INTO gaps (topic_key, query, hits, status, first_seen, last_seen)
                VALUES (?, ?, 1, 'open', ?, ?)
                ON CONFLICT(topic_key) DO UPDATE SET
                    hits = hits + 1,
                    last_seen = excluded.last_seen,
                    query = excluded.query
                """,
                (key, str(query).strip(), now, now),
            )
        return True

    def top_open(self, *, limit: int = 3) -> list[dict[str, Any]]:
        with self._conn() as c:
            rows = c.execute(
                """
                SELECT topic_key, query, hits FROM gaps
                WHERE status = 'open'
                ORDER BY hits DESC, last_seen DESC
                LIMIT ?
                """,
                (max(1, int(limit)),),
            ).fetchall()
        return [{"topic_key": r["topic_key"], "query": r["query"], "hits": int(r["hits"])} for r in rows]

    def mark(self, topic_key: str, *, status: str, facts_learned: int = 0) -> None:
        with self._conn() as c:
            c.execute(
                """
                UPDATE gaps
                SET status = ?, facts_learned = facts_learned + ?, resolved_at = ?
                WHERE topic_key = ?
                """,
                (status, max(0, int(facts_learned)), time.time(), topic_key),
            )

    def stats(self) -> dict[str, int]:
        with self._conn() as c:
            rows = c.execute("SELECT status, COUNT(*) AS n FROM gaps GROUP BY status").fetchall()
        out = {str(r["status"]): int(r["n"]) for r in rows}
        out["total"] = sum(out.values())
        return out

    def known_keys(self) -> set[str]:
        """Every topic_key the ledger has ever seen (open or resolved). Used by
        the Phase 3 self-seeder to avoid re-proposing what it already learned."""
        with self._conn() as c:
            rows = c.execute("SELECT topic_key FROM gaps").fetchall()
        return {str(r["topic_key"]) for r in rows}
