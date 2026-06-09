"""Source memory for Max17 web knowledge.

This is separate from Hippocampus on purpose: web knowledge needs provenance.
Every useful fact should keep where it came from, when it was fetched, and how
trustworthy the source looked before it becomes a normal graph association.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


def _stable_hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.blake2b(raw.encode("utf-8"), digest_size=12).hexdigest()


def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc.lower()
    except ValueError:
        return ""


def _trust_score(url: str) -> float:
    domain = _domain(url)
    if not domain:
        return 0.35
    if domain.endswith((".gov", ".edu")):
        return 0.9
    if any(part in domain for part in ("developer.mozilla.org", "w3.org", "github.com", "nextjs.org", "react.dev", "python.org")):
        return 0.82
    if any(part in domain for part in ("docs", "developer", "learn", "support")):
        return 0.68
    return 0.5


class SourceMemory:
    def __init__(self, db_path: str | Path) -> None:
        path = Path(db_path)
        self.db_path = path if path.suffix == ".db" else path / "source_memory.db"
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
                CREATE TABLE IF NOT EXISTS web_sources (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    url TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    trust_score REAL NOT NULL,
                    fetched_at REAL NOT NULL,
                    raw_hash TEXT NOT NULL,
                    metadata_json TEXT NOT NULL
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS web_facts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_id INTEGER NOT NULL,
                    claim TEXT NOT NULL,
                    topic TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    extracted_at REAL NOT NULL,
                    metadata_json TEXT NOT NULL,
                    UNIQUE(source_id, claim),
                    FOREIGN KEY(source_id) REFERENCES web_sources(id)
                )
                """
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_web_facts_topic ON web_facts(topic)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_web_facts_confidence ON web_facts(confidence)")

    def remember_source(
        self,
        *,
        url: str,
        title: str,
        summary: str,
        raw_text: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> int:
        now = time.time()
        clean_url = str(url or "").strip()
        domain = _domain(clean_url)
        trust = _trust_score(clean_url)
        raw_hash = _stable_hash(raw_text or summary or clean_url)
        metadata_json = json.dumps(metadata or {}, ensure_ascii=False, sort_keys=True)
        with self._conn() as c:
            c.execute(
                """
                INSERT INTO web_sources
                (url, title, domain, summary, trust_score, fetched_at, raw_hash, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(url) DO UPDATE SET
                    title = excluded.title,
                    summary = excluded.summary,
                    trust_score = excluded.trust_score,
                    fetched_at = excluded.fetched_at,
                    raw_hash = excluded.raw_hash,
                    metadata_json = excluded.metadata_json
                """,
                (
                    clean_url,
                    str(title or "")[:240],
                    domain,
                    str(summary or "")[:1200],
                    trust,
                    now,
                    raw_hash,
                    metadata_json,
                ),
            )
            row = c.execute("SELECT id FROM web_sources WHERE url = ?", (clean_url,)).fetchone()
        return int(row["id"])

    def remember_fact(
        self,
        *,
        source_id: int,
        claim: str,
        topic: str,
        confidence: float,
        metadata: dict[str, Any] | None = None,
    ) -> int:
        now = time.time()
        metadata_json = json.dumps(metadata or {}, ensure_ascii=False, sort_keys=True)
        with self._conn() as c:
            c.execute(
                """
                INSERT INTO web_facts
                (source_id, claim, topic, confidence, extracted_at, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_id, claim) DO UPDATE SET
                    topic = excluded.topic,
                    confidence = MAX(web_facts.confidence, excluded.confidence),
                    extracted_at = excluded.extracted_at,
                    metadata_json = excluded.metadata_json
                """,
                (
                    int(source_id),
                    str(claim or "")[:1000],
                    str(topic or "general")[:120],
                    max(0.0, min(1.0, float(confidence))),
                    now,
                    metadata_json,
                ),
            )
            row = c.execute(
                "SELECT id FROM web_facts WHERE source_id = ? AND claim = ?",
                (int(source_id), str(claim or "")[:1000]),
            ).fetchone()
        return int(row["id"])

    def recent_facts(self, *, limit: int = 5, topic: str | None = None) -> list[dict[str, Any]]:
        params: list[Any] = []
        where = ""
        if topic:
            where = "WHERE f.topic = ?"
            params.append(topic)
        params.append(max(1, int(limit)))
        with self._conn() as c:
            rows = c.execute(
                f"""
                SELECT f.*, s.url, s.title, s.domain, s.trust_score
                FROM web_facts f
                JOIN web_sources s ON s.id = f.source_id
                {where}
                ORDER BY f.confidence DESC, f.extracted_at DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
        return [self._fact_row(row) for row in rows]

    def counts(self) -> dict[str, int]:
        with self._conn() as c:
            sources = int(c.execute("SELECT COUNT(*) FROM web_sources").fetchone()[0])
            facts = int(c.execute("SELECT COUNT(*) FROM web_facts").fetchone()[0])
        return {"web_sources": sources, "web_facts": facts}

    def _fact_row(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": int(row["id"]),
            "source_id": int(row["source_id"]),
            "claim": str(row["claim"]),
            "topic": str(row["topic"]),
            "confidence": round(float(row["confidence"]), 4),
            "url": str(row["url"]),
            "title": str(row["title"]),
            "domain": str(row["domain"]),
            "trust_score": round(float(row["trust_score"]), 4),
            "extracted_at": round(float(row["extracted_at"]), 3),
        }
