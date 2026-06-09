"""Code-outcome memory — Phase 2: the coding agent learns from its own runs.

Every completed code-agent run is distilled into a short LESSON (what worked /
what failed + the verify signal) and stored with a semantic vector. Before a new
run the agent recalls the most similar past lessons and is told about them, so it
stops repeating mistakes and reuses fixes.

Pure-local and deterministic: the embedding reuses ``vector_memory.embed_text``
(token-hashing + n-grams), so storing and recalling cost no LLM tokens and stay
offline-safe. One small SQLite file (``code_memory.db``) under the state dir keeps
the lessons across runs, so learning accumulates.
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mark17.vector_memory import VECTOR_DIM, cosine_similarity, embed_text

# Cosine floor for a lesson to count as relevant. Instructions are longer and
# more specific than generic events, so a slightly higher floor than the event
# store (0.045) keeps recall on-topic.
SIM_FLOOR = 0.05
# Soft cap: keep the newest N lessons so the store can't grow unbounded on a box
# that codes a lot. Old, rarely-matching lessons are pruned oldest-first.
MAX_ROWS = 600
_EXIT_RE = re.compile(r"exit=(-?\d+)")


@dataclass(frozen=True)
class CodeLesson:
    id: int
    ts: float
    target: str
    instruction: str
    success: bool
    files: list[str]
    signal: str
    lesson: str
    score: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "ts": round(self.ts, 3),
            "target": self.target,
            "success": self.success,
            "files": self.files,
            "signal": self.signal,
            "lesson": self.lesson,
            "score": round(self.score, 4),
        }


def distill(
    *,
    instruction: str,
    target: str,
    steps: list[dict[str, Any]],
    answer: str,
    files_changed: list[str],
    verify_passed: bool | None,
) -> tuple[str, str, bool]:
    """Turn a finished run into (lesson, signal, success).

    Deterministic — no LLM. ``signal`` is the short verify evidence (last command
    exit + first error line); ``lesson`` is the human-readable takeaway the next
    run will see. ``success`` is False when verification clearly failed.
    """
    last_exit: int | None = None
    error_line = ""
    for step in steps:
        if step.get("action") != "run_command":
            continue
        obs = str(step.get("observation") or "")
        match = _EXIT_RE.search(obs)
        if match:
            last_exit = int(match.group(1))
        if last_exit not in (None, 0) and not error_line:
            for line in obs.splitlines():
                low = line.lower()
                if any(tag in low for tag in ("error", "traceback", "exception", "failed", "ошибка")):
                    error_line = line.strip()[:160]
                    break

    success = verify_passed is not False and bool(answer) and not answer.lower().startswith("модель не ответила")

    bits: list[str] = []
    if last_exit is not None:
        bits.append(f"exit={last_exit}")
    if error_line:
        bits.append(error_line)
    if not files_changed:
        bits.append("без правок файлов")
    signal = "; ".join(bits) or ("проверено" if success else "результат неясен")

    files_str = ", ".join(files_changed[:6]) or "—"
    head = instruction.strip().replace("\n", " ")[:140]
    take = answer.strip().replace("\n", " ")[:200]
    if success:
        lesson = f"✓ «{head}» → сработало: {take} | правки: {files_str} | {signal}"
    else:
        lesson = f"✗ «{head}» → НЕ сработало: {signal} | пробовал: {take[:120]} | правки: {files_str}"
    return lesson, signal, success


class CodeMemory:
    def __init__(self, state_dir: Path) -> None:
        self.db_path = Path(state_dir) / "code_memory.db"
        Path(state_dir).mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as c:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS code_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts REAL NOT NULL,
                    target TEXT NOT NULL,
                    instruction TEXT NOT NULL,
                    success INTEGER NOT NULL,
                    files TEXT NOT NULL,
                    signal TEXT NOT NULL,
                    lesson TEXT NOT NULL,
                    vector TEXT NOT NULL
                )
                """
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_code_runs_ts ON code_runs(ts)")

    def record(
        self,
        *,
        instruction: str,
        target: str,
        success: bool,
        files: list[str],
        signal: str,
        lesson: str,
    ) -> int | None:
        instruction = (instruction or "").strip()
        if not instruction or not lesson.strip():
            return None
        # Embed instruction + lesson so a new instruction matches both the task
        # shape and the distilled outcome wording.
        vector = embed_text(f"{instruction}\n{lesson}")
        if not any(vector):
            return None
        now = time.time()
        with self._conn() as c:
            cur = c.execute(
                """
                INSERT INTO code_runs (ts, target, instruction, success, files, signal, lesson, vector)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    now,
                    target,
                    instruction,
                    1 if success else 0,
                    json.dumps(files, ensure_ascii=False),
                    signal[:300],
                    lesson[:600],
                    json.dumps(vector),
                ),
            )
            new_id = int(cur.lastrowid)
            # Prune oldest beyond the soft cap.
            c.execute(
                "DELETE FROM code_runs WHERE id IN ("
                "  SELECT id FROM code_runs ORDER BY id DESC LIMIT -1 OFFSET ?"
                ")",
                (MAX_ROWS,),
            )
        return new_id

    def recall(self, instruction: str, *, limit: int = 3) -> list[CodeLesson]:
        instruction = (instruction or "").strip()
        if not instruction:
            return []
        qv = embed_text(instruction)
        if not any(qv):
            return []
        with self._conn() as c:
            rows = c.execute("SELECT * FROM code_runs ORDER BY id DESC LIMIT 2000").fetchall()
        hits: list[CodeLesson] = []
        for row in rows:
            try:
                vec = json.loads(row["vector"])
            except (json.JSONDecodeError, TypeError):
                continue
            if not isinstance(vec, list) or len(vec) != VECTOR_DIM:
                continue
            sim = cosine_similarity(qv, [float(v) for v in vec])
            if sim < SIM_FLOOR:
                continue
            # Surface failures a touch more eagerly than successes of equal
            # similarity — repeating a known mistake is the costlier error.
            score = sim * (1.1 if int(row["success"]) == 0 else 1.0)
            try:
                files = json.loads(row["files"])
            except (json.JSONDecodeError, TypeError):
                files = []
            hits.append(
                CodeLesson(
                    id=int(row["id"]),
                    ts=float(row["ts"]),
                    target=str(row["target"]),
                    instruction=str(row["instruction"]),
                    success=int(row["success"]) == 1,
                    files=files if isinstance(files, list) else [],
                    signal=str(row["signal"]),
                    lesson=str(row["lesson"]),
                    score=score,
                )
            )
        hits.sort(key=lambda h: (h.score, h.ts), reverse=True)
        return hits[:limit]
