"""Experimental semantic memory for Max17.

This is a lightweight local prototype: no external APIs, no transformers,
just deterministic token hashing with a small domain synonym layer.

Recall is relativistic. Einstein's field equation

    G_uv + Lambda * g_uv = (8 pi G / c^4) * T_uv

says mass-energy curves the metric. Here *importance is mass*: an important
memory curves the recall metric around itself, so a query that would have
missed it is bent toward it — gravitational lensing. Two consequences fall
straight out of the same geometry and both are load-bearing:

  * magnification — a query passing near a massive memory is amplified by the
    point-mass lens formula, so heavy memories catch queries that only
    glance at them;
  * time dilation — proper time runs slower deep in a gravity well, so
    important memories age more slowly than trivial ones. This is what stops
    a critical failure from decaying at the same rate as a heartbeat.

Lambda (the cosmological constant) supplies the opposing term: space between
memories expands, gently pushing everything apart as it gets older.
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

VECTOR_DIM = 128
TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_]+")

# --- Relativistic recall constants -----------------------------------------
# Coupling between importance (mass) and the curvature of the recall metric.
GRAVITY_G = 0.18
# Signal speed through memory space. Kept at 1 so the formulas stay readable.
LIGHT_C = 1.0
# Cosmological constant: slow expansion of the space between memories.
LAMBDA = 0.015
# Lensing cannot amplify without bound — the weak-field approximation breaks
# down long before this, and inside the horizon the memory simply captures.
MAX_MAGNIFICATION = 4.0
# Half-life of an unimportant memory's relevance, in seconds (one week).
RECALL_HALF_LIFE = 7 * 86400.0

SYNONYM_GROUPS = {
    "memory": {
        "memory",
        "memories",
        "recall",
        "remember",
        "remembered",
        "recalled",
        "память",
        "памяти",
        "помнишь",
        "вспомни",
        "вспоминать",
        "вспоминаю",
    },
    "pattern": {
        "pattern",
        "patterns",
        "паттерн",
        "паттерны",
        "шаблон",
        "сигнал",
        "связь",
        "связи",
    },
    "core": {
        "core",
        "kernel",
        "brain",
        "ядро",
        "ядра",
        "мозг",
        "max17",
        "mark17",
    },
    "development": {
        "development",
        "develop",
        "growth",
        "learning",
        "развитие",
        "развивать",
        "обучение",
        "улучшение",
        "адаптация",
    },
    "task": {
        "task",
        "tasks",
        "mission",
        "missions",
        "задача",
        "задачи",
        "миссия",
        "квест",
    },
}

SYNONYM_INDEX = {
    token: concept for concept, tokens in SYNONYM_GROUPS.items() for token in tokens
}


@dataclass(frozen=True)
class VectorHit:
    id: int
    timestamp: float
    event_type: str
    text: str
    summary: str
    reinforce: str
    importance: float
    score: float
    magnification: float = 1.0
    dilation: float = 1.0
    horizon: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": round(self.timestamp, 3),
            "event_type": self.event_type,
            "text": self.text,
            "summary": self.summary,
            "reinforce": self.reinforce,
            "importance": round(self.importance, 3),
            "score": round(self.score, 4),
            "magnification": round(self.magnification, 4),
            "dilation": round(self.dilation, 4),
            "horizon": self.horizon,
        }


def _tokens(text: str) -> list[str]:
    raw_tokens = [token.casefold() for token in TOKEN_RE.findall(text)]
    tokens: list[str] = []
    for token in raw_tokens:
        if len(token) < 2:
            continue
        tokens.append(token)
        concept = SYNONYM_INDEX.get(token)
        if concept:
            tokens.append(f"concept:{concept}")
    return tokens


def _concepts(text: str) -> set[str]:
    return {
        concept
        for token in TOKEN_RE.findall(text)
        if (concept := SYNONYM_INDEX.get(token.casefold()))
    }


def embed_text(text: str, *, dim: int = VECTOR_DIM) -> list[float]:
    vector = [0.0] * dim
    for token in _tokens(text):
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        idx = int.from_bytes(digest[:4], "big") % dim
        vector[idx] += 1.0

    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return sum(a * b for a, b in zip(left, right))


def schwarzschild_radius(mass: float) -> float:
    """r_s = 2GM/c^2 — inside this radius the memory captures the query."""
    return 2.0 * GRAVITY_G * max(0.0, mass) / (LIGHT_C**2)


def einstein_radius(mass: float) -> float:
    """theta_E = sqrt(4GM/c^2) — the natural angular scale of the lens."""
    return math.sqrt(4.0 * GRAVITY_G * max(0.0, mass) / (LIGHT_C**2))


def magnification(mass: float, impact: float) -> float:
    """Point-mass lens magnification: mu = (u^2 + 2) / (u * sqrt(u^2 + 4)).

    ``impact`` is the impact parameter — how far the query's geodesic passes
    from the memory (1 - semantic similarity). As the query moves away the
    magnification tends to 1 and the lens stops mattering, which is exactly
    the behaviour we want: light memories never distort recall.
    """
    theta_e = einstein_radius(mass)
    if theta_e <= 0.0:
        return 1.0
    u = max(impact / theta_e, 1e-3)
    mu = (u * u + 2.0) / (u * math.sqrt(u * u + 4.0))
    return min(mu, MAX_MAGNIFICATION)


def time_dilation(mass: float, impact: float) -> float:
    """Gravitational time dilation: dtau/dt = sqrt(1 - r_s/r).

    Returns the fraction of coordinate time that elapses as *proper* time for
    a memory this deep in its own gravity well. A heavy memory close to the
    query ages slowly; a trivial one ages at wall-clock speed.
    """
    r_s = schwarzschild_radius(mass)
    r = max(impact, r_s * 1.0001, 1e-3)
    return math.sqrt(max(0.0, 1.0 - r_s / r))


def importance_for_event(event: Event, evaluation: dict[str, Any] | None = None) -> float:
    base = {
        "task_completed": 0.82,
        "deadline_failed": 0.9,
        "task_created": 0.68,
        "terminal_error": 0.62,
        "user_message": 0.55,
        "system_state": 0.25,
        "consolidated_pattern": 0.88,
    }.get(event.type, 0.45)

    if event.type == "system_state":
        payload = event.payload
        focus = payload.get("focus")
        energy = payload.get("energy")
        if isinstance(focus, (int, float)) and focus < 45:
            base += 0.15
        if isinstance(energy, (int, float)) and energy < 45:
            base += 0.15

    if isinstance(evaluation, dict):
        score = evaluation.get("score")
        if isinstance(score, (int, float)):
            base = (base * 0.75) + (max(0.0, min(1.0, float(score))) * 0.25)

    return max(0.05, min(1.0, base))


def text_from_event(event: Event, evaluation: dict[str, Any] | None = None) -> str:
    payload = event.payload
    chunks: list[str] = [event.type.replace("_", " ")]

    for key in ("text", "message", "content", "line", "note", "desc"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            chunks.append(value.strip())

    task = payload.get("task")
    if isinstance(task, dict):
        for key in ("desc", "mgr", "status", "deadline"):
            value = task.get(key)
            if value:
                chunks.append(str(value))

    if isinstance(evaluation, dict):
        for key in ("reason", "reinforce"):
            value = evaluation.get(key)
            if isinstance(value, str) and value.strip():
                chunks.append(value.strip())

    return " ".join(chunks).strip()


def summary_from_event(event: Event, text: str, evaluation: dict[str, Any] | None = None) -> str:
    if isinstance(evaluation, dict):
        reinforce = evaluation.get("reinforce")
        if isinstance(reinforce, str) and reinforce.strip():
            return f"{event.type}: {reinforce.strip()[:180]}"
        reason = evaluation.get("reason")
        if isinstance(reason, str) and reason.strip():
            return reason.strip()[:180]
    return text[:180]


class VectorMemory:
    def __init__(self, state_dir: Path) -> None:
        self.db_path = state_dir / "vector_memory.db"
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
                CREATE TABLE IF NOT EXISTS vector_memories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp REAL NOT NULL,
                    event_type TEXT NOT NULL,
                    text TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    reinforce TEXT NOT NULL,
                    importance REAL NOT NULL,
                    vector TEXT NOT NULL
                )
                """
            )
            c.execute(
                "CREATE INDEX IF NOT EXISTS idx_vector_event_type ON vector_memories(event_type)"
            )
            c.execute(
                "CREATE INDEX IF NOT EXISTS idx_vector_importance ON vector_memories(importance)"
            )

    def remember(self, event: Event, evaluation: dict[str, Any] | None = None) -> int | None:
        text = text_from_event(event, evaluation)
        if not text:
            return None

        summary = summary_from_event(event, text, evaluation)
        reinforce = ""
        if isinstance(evaluation, dict) and evaluation.get("reinforce"):
            reinforce = str(evaluation["reinforce"])

        vector = embed_text(text)
        if not any(vector):
            return None

        now = time.time()
        importance = importance_for_event(event, evaluation)
        with self._conn() as c:
            cur = c.execute(
                """
                INSERT INTO vector_memories
                (timestamp, event_type, text, summary, reinforce, importance, vector)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    now,
                    event.type,
                    text,
                    summary,
                    reinforce,
                    importance,
                    json.dumps(vector),
                ),
            )
            return int(cur.lastrowid)

    def recall(
        self,
        query: str,
        *,
        limit: int = 3,
        relativistic: bool = True,
        now: float | None = None,
    ) -> list[VectorHit]:
        """Recall along curved geodesics.

        With ``relativistic=False`` this is the flat-space baseline: pure
        semantic similarity weighted by importance, with no lensing and no
        ageing. That path is kept so the curvature can be measured against it.
        """
        query = query.strip()
        if not query:
            return []

        query_vector = embed_text(query)
        if not any(query_vector):
            return []
        query_concepts = _concepts(query)
        now = time.time() if now is None else now

        with self._conn() as c:
            rows = c.execute(
                """
                SELECT * FROM vector_memories
                ORDER BY importance DESC, timestamp DESC
                LIMIT 500
                """
            ).fetchall()

        hits: list[VectorHit] = []
        for row in rows:
            try:
                vector = json.loads(row["vector"])
            except json.JSONDecodeError:
                continue
            if not isinstance(vector, list):
                continue

            semantic = max(0.0, cosine_similarity(query_vector, [float(v) for v in vector]))
            if semantic <= 0:
                continue
            importance = float(row["importance"])
            score = semantic * importance
            if query_concepts:
                row_concepts = _concepts(str(row["text"]))
                overlap = len(query_concepts & row_concepts) / len(query_concepts)
                score += overlap * importance * 0.25

            mu = 1.0
            dilation = 1.0
            horizon = False
            if relativistic:
                # Impact parameter: how far the query's geodesic passes from
                # this memory. A perfect match passes straight through it.
                impact = max(1e-3, 1.0 - semantic)
                mu = magnification(importance, impact)
                dilation = time_dilation(importance, impact)
                horizon = impact <= schwarzschild_radius(importance)

                age = max(0.0, now - float(row["timestamp"]))
                # The memory ages by its own proper time, not ours.
                proper_age = age * dilation
                recency = math.exp(-proper_age * math.log(2.0) / RECALL_HALF_LIFE)
                # Lambda term: space between memories expands with age.
                recency /= 1.0 + LAMBDA * (age / RECALL_HALF_LIFE)

                score *= mu * (0.55 + 0.45 * recency)
                if horizon:
                    # Nothing escapes from inside the horizon: this memory
                    # owns the query outright.
                    score = max(score, importance)

            if score <= 0.05:
                continue
            hits.append(
                VectorHit(
                    id=int(row["id"]),
                    timestamp=float(row["timestamp"]),
                    event_type=str(row["event_type"]),
                    text=str(row["text"])[:240],
                    summary=str(row["summary"])[:180],
                    reinforce=str(row["reinforce"])[:180],
                    importance=importance,
                    score=score,
                    magnification=mu,
                    dilation=dilation,
                    horizon=horizon,
                )
            )

        hits.sort(key=lambda hit: hit.score, reverse=True)
        return hits[:limit]
