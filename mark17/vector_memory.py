"""Experimental semantic memory for Max17.

This is a lightweight local prototype: no external APIs, no transformers,
just deterministic token hashing with a small domain synonym layer.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sqlite3
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import numpy as np

from mark17.ann_index import ANN_MIN_ROWS, AnnIndex, HNSW_MIN_ROWS, HnswIndex
from mark17.events import Event
from mark17 import embedder

# Hash-space width (local fallback). The ACTIVE dim is set by the embedder: a
# neural provider (Ollama nomic-embed / Gemini) returns 768 and stored vectors of
# a different length are re-embedded on load (see VectorMemory._ensure_index).
_HASH_DIM = 256
VECTOR_DIM = embedder.active_dim(_HASH_DIM)
NGRAM_SIZES = (3, 4)
# Живой рекол держим на последних N записях (свежие + важные): строить мету с
# concepts для десятков тысяч строк = тяжело. Корпус целиком живёт в графе/БД,
# кузница (forge_vectors) грузит всё. Tunable: MAX17_RECALL_CAP.
try:
    RECALL_CAP = max(1000, int(os.environ.get("MAX17_RECALL_CAP", "8000")))
except (TypeError, ValueError):
    RECALL_CAP = 8000
TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_]+")

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
    # --- Life-game domains: cluster the user's real goals by meaning, not words. ---
    "sales": {
        "sales", "sale", "deal", "lead", "leads", "client", "clients", "customer", "call", "calls", "cold",
        "продажа", "продажи", "продать", "сделка", "сделки", "клиент", "клиенты", "клиентов",
        "лид", "лиды", "обзвон", "звонок", "звонки", "воронка",
    },
    "marketing": {
        "marketing", "promote", "promotion", "reach", "audience", "traffic", "ads", "campaign", "offer",
        "маркетинг", "продвижение", "продвинуть", "реклама", "охват", "охваты", "аудитория",
        "трафик", "кампания", "оффер",
    },
    "content": {
        "content", "reels", "reel", "video", "post", "posts", "story", "stories", "clip", "shoot", "edit",
        "контент", "рилс", "рилз", "видео", "ролик", "пост", "посты", "сторис", "клип", "съёмка", "съемка", "монтаж",
    },
    "product": {
        "product", "feature", "landing", "site", "website", "app", "application", "mvp", "release", "onboarding",
        "продукт", "фича", "функция", "лендинг", "сайт", "приложение", "релиз", "онбординг",
    },
    "code": {
        "code", "coding", "bug", "refactor", "api", "endpoint", "component", "deploy", "build",
        "script", "backend", "frontend",
        "код", "баг", "рефактор", "апи", "компонент", "деплой", "сборка", "скрипт", "бэкенд", "фронтенд",
    },
    "money": {
        "money", "income", "profit", "revenue", "payment", "price", "budget",
        "деньги", "доход", "прибыль", "выручка", "оплата", "цена", "бюджет", "заработок",
    },
    "body": {
        "body", "sport", "gym", "workout", "training", "sleep", "energy", "health",
        "circadian", "caffeine", "fatigue", "tired", "tiredness", "recovery", "rest", "stress", "stimulation",
        "тело", "спорт", "зал", "тренировка", "сон", "энергия", "здоровье", "бег",
        "усталость", "устал", "уставший", "сонливость", "недосып", "кофеин", "кофе",
        "циркадный", "ритм", "восстановление", "отдых", "стресс", "перегруз", "стимуляция",
    },
    "relationship": {
        "meeting", "partner", "people", "network", "networking",
        "встреча", "встречи", "партнёр", "партнер", "люди", "общение", "нетворкинг",
    },
    "focus": {
        "goal", "goals", "priority", "priorities", "focus", "today",
        "цель", "цели", "приоритет", "приоритеты", "фокус", "сегодня",
    },
}

SYNONYM_INDEX = {
    token: concept for concept, tokens in SYNONYM_GROUPS.items() for token in tokens
}
_SYNONYM_TOKENS = sorted(SYNONYM_INDEX.items())  # deterministic prefix scan

# Cosine relevance gate. n-gram cosines are graded (a related sentence lands
# ~0.05–0.25, not ~1), so we gate on similarity itself and let importance only
# affect ranking — otherwise importance weighting sinks real matches below a
# raw score threshold.
SIM_FLOOR = 0.045

# ─── Заземление памяти ──────────────────────────────────────────────────────
# Внутренняя машинерия ядра (IR-компиляция, консолидация сна, сжатие концептов,
# решения оркестратора) — это ПЛУМБИНГ, а не знание о мире. Она нужна ядру, но в
# recall забивала выдачу: замер до фильтра дал 81% служебного мусора на реальных
# вопросах («что просил починить» → доки golang). Из БД ничего не удаляем —
# только исключаем из выдачи; internal-вызовы могут просить include_plumbing=True.
PLUMBING_TYPES = frozenset({
    "semantic_ir",
    "compressed_concept",
    "consolidated_pattern",
    "ultra_decision",
})

# Заземлённое в реальности: слова человека, исходы дел, факты из веба.
# Это то, ради чего память вообще существует — ранжируем выше.
GROUNDED_TYPES = frozenset({
    "user_message",
    "task_completed",
    "task_created",
    "outcome_success",
    "outcome_failure",
    "outcome_partial",
    "remember",
    "web_fact",
    "action_done",
})
GROUNDED_BOOST = 1.6


def _dedup_key(text: str) -> str:
    """Ключ схлопывания почти-дублей (одно наблюдение писалось десятки раз)."""
    return " ".join(str(text or "").lower().split())[:70]


def _rank_hits(hits: list["VectorHit"], limit: int, include_plumbing: bool) -> list["VectorHit"]:
    """Общий пост-фильтр обоих путей recall: убрать плумбинг, поднять
    заземлённое, схлопнуть дубли, отдать topN."""
    out: list[VectorHit] = []
    seen: set[str] = set()
    for h in hits:
        if not include_plumbing and h.event_type in PLUMBING_TYPES:
            continue
        key = _dedup_key(h.summary or h.text)
        if key in seen:
            continue
        seen.add(key)
        # VectorHit заморожен — новый объект вместо мутации.
        out.append(replace(h, score=h.score * GROUNDED_BOOST) if h.event_type in GROUNDED_TYPES else h)
    out.sort(key=lambda hit: (hit.score, hit.id), reverse=True)
    return out[:limit]


def _shared_prefix_len(a: str, b: str) -> int:
    limit = min(len(a), len(b))
    i = 0
    while i < limit and a[i] == b[i]:
        i += 1
    return i


def _concept_for(token: str) -> str | None:
    """Map a token to its synonym concept — exact match, or a ≥5-char shared
    prefix so morphological variants ('квесты'→'квест', 'миссию'→'миссия') still
    land on the same concept."""
    concept = SYNONYM_INDEX.get(token)
    if concept:
        return concept
    if len(token) < 5:
        return None
    for syn, syn_concept in _SYNONYM_TOKENS:
        if len(syn) >= 5 and _shared_prefix_len(token, syn) >= 5:
            return syn_concept
    return None


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
        }


def _tokens(text: str) -> list[str]:
    raw_tokens = [token.casefold() for token in TOKEN_RE.findall(text)]
    tokens: list[str] = []
    for token in raw_tokens:
        if len(token) < 2:
            continue
        tokens.append(token)
        concept = _concept_for(token)
        if concept:
            tokens.append(f"concept:{concept}")
    return tokens


def _concepts(text: str) -> set[str]:
    return {
        concept
        for token in TOKEN_RE.findall(text)
        if (concept := _concept_for(token.casefold()))
    }


def _ngrams(token: str, sizes: tuple[int, ...] = NGRAM_SIZES) -> list[str]:
    """Padded character n-grams so morphological variants overlap:
    'камера'/'камеру'/'камеры' all share 'кам','аме','мер'…"""
    padded = f"#{token}#"
    grams: list[str] = []
    for n in sizes:
        if len(padded) < n:
            continue
        for i in range(len(padded) - n + 1):
            grams.append(padded[i : i + n])
    return grams


def _features(text: str) -> list[tuple[str, float]]:
    """Weighted feature stream: whole words + concept synonyms (full weight) and
    character n-grams (half weight, for fuzzy/morphological matching)."""
    feats: list[tuple[str, float]] = []
    for token in _tokens(text):
        if token.startswith("concept:"):
            feats.append((token, 1.0))
            continue
        feats.append((f"w:{token}", 1.0))
        for gram in _ngrams(token):
            feats.append((f"g:{gram}", 0.5))
    return feats


def _hash_bucket(feature: str, dim: int) -> tuple[int, float]:
    """Signed hashing: a bucket index plus a +/-1 sign to reduce collision bias."""
    digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
    idx = int.from_bytes(digest[:4], "big") % dim
    sign = 1.0 if (digest[4] & 1) == 0 else -1.0
    return idx, sign


def _hash_embed(text: str, dim: int) -> list[float]:
    vector = [0.0] * dim
    for feature, weight in _features(text):
        idx, sign = _hash_bucket(feature, dim)
        vector[idx] += sign * weight

    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def embed_text(text: str, *, dim: int | None = None) -> list[float]:
    """Real neural embedding (Ollama → Gemini) when available, else the local
    token-hash. The neural path fixes its own dim; the hash path honours `dim`."""
    target = VECTOR_DIM if dim is None else dim
    vec = embedder.neural_embed(text)
    if vec is not None and len(vec) == target:
        return vec
    return _hash_embed(text, target)


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return sum(a * b for a, b in zip(left, right))


def importance_for_event(event: Event, evaluation: dict[str, Any] | None = None) -> float:
    base = {
        "task_completed": 0.82,
        "deadline_failed": 0.9,
        "task_created": 0.68,
        "terminal_error": 0.62,
        "user_message": 0.55,
        "system_state": 0.25,
        "environment_observation": 0.5,
        "consolidated_pattern": 0.88,
        "outcome_success": 0.86,
        "action_done": 0.84,
        "outcome_partial": 0.66,
        "outcome_failure": 0.74,
        "action_skipped": 0.52,
        "compressed_concept": 0.82,
        "voice_observation": 0.6,
        "semantic_ir": 0.78,
        "ultra_decision": 0.7,
        "music_observation": 0.65,
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

    camera = payload.get("camera")
    if isinstance(camera, dict):
        vision_summary = camera.get("vision_summary")
        if isinstance(vision_summary, dict):
            for key in ("scene_mode", "summary", "motion_level", "stability", "method"):
                value = vision_summary.get(key)
                if value is not None:
                    chunks.append(f"{key}:{value}")
        for key in (
            "scene_mode",
            "summary",
            "light_level",
            "dominant_tone",
            "brightness",
            "contrast",
            "motion_score",
            "stability",
            "width",
            "height",
        ):
            value = camera.get(key)
            if value is not None:
                chunks.append(f"{key}:{value}")

    state = payload.get("state")
    if isinstance(state, str) and state.strip():
        chunks.append(f"state:{state.strip()}")

    voice = payload.get("voice")
    if isinstance(voice, dict):
        for key in ("state", "trend", "summary"):
            value = voice.get(key)
            if isinstance(value, str) and value.strip():
                chunks.append(value.strip())
        for key in ("arousal", "tempo", "energy", "pause_ratio", "pitch_hz"):
            value = voice.get(key)
            if value is not None:
                chunks.append(f"{key}:{value}")

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
        # In-memory semantic index, built lazily once and reused across events
        # (the daemon keeps one VectorMemory), so recall is a single vectorized
        # cosine over ALL memories instead of a per-row Python loop capped at 500.
        # float32 (not 64) halves RAM — ~1GB instead of 2GB at 1M×256.
        self._matrix: np.ndarray | None = None  # (N, VECTOR_DIM) float32, L2-normed rows
        self._meta: list[dict[str, Any]] = []
        # Phase 4: IVF coarse-quantizer for sub-linear recall at scale. Stays None
        # (exact full scan) below ANN_MIN_ROWS, so small stores are unchanged.
        self._ann: AnnIndex | None = None
        self._ann_path = state_dir / "vector_ann.npz"
        # Полнокорпусный HNSW-индекс: ищет по ВСЕМ векторам (не по капу), мету тянет
        # только для top-k. Снимает потолок RECALL_CAP для поиска. Опционально:
        # нет hnswlib / любая ошибка → фолбэк на точный путь по матрице.
        self._hnsw: HnswIndex | None = None
        self._hnsw_tried = False
        self._hnsw_path = state_dir / "vector_hnsw.bin"
        self._hnsw_meta = state_dir / "vector_hnsw.json"
        # Бинарный кэш матрицы: np.load вместо парса десятков тысяч JSON-векторов
        # на старте демона (без него _ensure_index на 40k строк = десятки секунд).
        self._mat_cache = state_dir / "vector_matrix.npy"
        self._mat_meta = state_dir / "vector_matrix.json"

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _meta_from_row(self, row: sqlite3.Row) -> dict[str, Any]:
        text = str(row["text"])
        return {
            "id": int(row["id"]),
            "timestamp": float(row["timestamp"]),
            "event_type": str(row["event_type"]),
            "text": text,
            "summary": str(row["summary"]),
            "reinforce": str(row["reinforce"]),
            "importance": float(row["importance"]),
            "concepts": _concepts(text),
        }

    def _ensure_index(self) -> None:
        if self._matrix is not None:
            return
        with self._conn() as c:
            tot = c.execute("SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM vector_memories").fetchone()
            n = int(tot["n"])
            max_id = int(tot["m"])
            # Только последние RECALL_CAP строк (мета с concepts дорогая на 10k+).
            rows = c.execute(
                "SELECT id, timestamp, event_type, text, summary, reinforce, importance "
                "FROM vector_memories ORDER BY id DESC LIMIT ?",
                (RECALL_CAP,),
            ).fetchall()
        rows = list(reversed(rows))  # id-возрастание → совпадает с хвостом матрицы
        meta = [self._meta_from_row(r) for r in rows]

        M = self._load_matrix_cache(n, max_id)
        if M is None:
            M = self._rebuild_matrix(n, max_id)
        # Хвост матрицы (последние len(meta)) совпадает с выбранными строками.
        if M.shape[0] > len(meta):
            M = np.ascontiguousarray(M[-len(meta):])
        self._matrix = M
        self._meta = meta
        self._refresh_ann()

    def forge_vectors(self) -> tuple[np.ndarray, list[int], list[float], list[str]]:
        """Полная матрица + id/важность/тип для кузницы (без recall-капа)."""
        with self._conn() as c:
            tot = c.execute("SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM vector_memories").fetchone()
            n = int(tot["n"])
            max_id = int(tot["m"])
            rows = c.execute(
                "SELECT id, importance, event_type FROM vector_memories ORDER BY id"
            ).fetchall()
        M = self._load_matrix_cache(n, max_id)
        if M is None:
            M = self._rebuild_matrix(n, max_id)
        ids = [int(r["id"]) for r in rows]
        imp = [float(r["importance"]) for r in rows]
        event_types = [str(r["event_type"]) for r in rows]
        return M, ids, imp, event_types

    def _load_matrix_cache(self, n: int, max_id: int) -> np.ndarray | None:
        try:
            if not self._mat_cache.exists() or not self._mat_meta.exists():
                return None
            hdr = json.loads(self._mat_meta.read_text(encoding="utf-8"))
            if hdr.get("n") != n or hdr.get("max_id") != max_id or hdr.get("dim") != VECTOR_DIM:
                return None
            M = np.load(self._mat_cache)
            if int(M.shape[0]) != n or (n > 0 and int(M.shape[1]) != VECTOR_DIM):
                return None
            return M.astype(np.float32, copy=False)
        except Exception:
            return None

    def _save_matrix_cache(self, M: np.ndarray, n: int, max_id: int) -> None:
        try:
            np.save(self._mat_cache, M)
            self._mat_meta.write_text(json.dumps({"n": n, "max_id": max_id, "dim": VECTOR_DIM}), encoding="utf-8")
        except Exception:
            pass

    def _rebuild_matrix(self, n: int, max_id: int) -> np.ndarray:
        """Медленный путь (раз): парс векторов из БД + миграция размерности + кэш."""
        vectors: list[list[float]] = []
        stale: list[tuple[str, int]] = []
        with self._conn() as c:
            rows = c.execute("SELECT id, vector, text FROM vector_memories ORDER BY id").fetchall()
            for row in rows:
                try:
                    parsed = json.loads(row["vector"])
                except (json.JSONDecodeError, TypeError):
                    parsed = None
                if isinstance(parsed, list) and len(parsed) == VECTOR_DIM:
                    vectors.append([float(v) for v in parsed])
                else:
                    v = _hash_embed(str(row["text"]), VECTOR_DIM)
                    vectors.append(v)
                    stale.append((json.dumps(v), int(row["id"])))
            if stale:
                c.executemany("UPDATE vector_memories SET vector = ? WHERE id = ?", stale)
        M = np.asarray(vectors, dtype=np.float32) if vectors else np.zeros((0, VECTOR_DIM), dtype=np.float32)
        self._save_matrix_cache(M, n, max_id)
        return M

    def reembed_all(self) -> int:
        """Recompute every stored vector with the current embed_text — run after the
        semantic ontology changes. Keeps old + new records in the same feature space
        so cosine recall stays consistent."""
        with self._conn() as c:
            rows = c.execute("SELECT id, text FROM vector_memories").fetchall()
            updates = [(json.dumps(embed_text(str(row["text"]))), int(row["id"])) for row in rows]
            if updates:
                c.executemany("UPDATE vector_memories SET vector = ? WHERE id = ?", updates)
        # Drop caches so the next recall rebuilds from the refreshed vectors.
        self._matrix = None
        self._meta = []
        self._ann = None
        try:
            if self._ann_path.exists():
                self._ann_path.unlink()
        except OSError:
            pass
        return len(updates)

    def _refresh_ann(self) -> None:
        """Build/load the IVF index above the threshold; drop it below. Best-effort:
        any failure just falls back to the exact full-scan path."""
        if self._matrix is None:
            return
        n = int(self._matrix.shape[0])
        if n < ANN_MIN_ROWS:
            self._ann = None
            return
        try:
            ann = AnnIndex.load(self._ann_path)
            if ann is None or ann.is_stale(n, dim=VECTOR_DIM):
                ann = AnnIndex.build(self._matrix)
                if ann is not None:
                    ann.save(self._ann_path)
            self._ann = ann
        except Exception:  # noqa: BLE001 - scale path must never break recall
            self._ann = None

    def _ensure_hnsw(self) -> None:
        """Lazily build/load the full-corpus HNSW index (once per process).
        Best-effort: any failure leaves self._hnsw=None → recall uses the exact
        capped-matrix path. Loads the persisted index and catches up new rows
        incrementally; full rebuild only if the gap since build is large."""
        if self._hnsw is not None or self._hnsw_tried:
            return
        self._hnsw_tried = True
        if not HnswIndex.available():
            return
        try:
            with self._conn() as c:
                tot = c.execute(
                    "SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM vector_memories"
                ).fetchone()
                n = int(tot["n"])
                max_id = int(tot["m"])
                if n < HNSW_MIN_ROWS:
                    return
                hdr: dict[str, Any] = {}
                try:
                    if self._hnsw_meta.exists():
                        hdr = json.loads(self._hnsw_meta.read_text(encoding="utf-8"))
                except Exception:  # noqa: BLE001
                    hdr = {}
                built_max = int(hdr.get("max_id") or 0)
                # Reuse persisted index if dims match and it isn't too far behind.
                if (
                    self._hnsw_path.exists()
                    and hdr.get("dim") == VECTOR_DIM
                    and (max_id - built_max) <= 5000
                ):
                    idx = HnswIndex.load(self._hnsw_path, VECTOR_DIM, n, built_max)
                    if idx is not None:
                        if max_id > built_max:
                            new_rows = c.execute(
                                "SELECT id, vector FROM vector_memories WHERE id > ? ORDER BY id",
                                (built_max,),
                            ).fetchall()
                            for r in new_rows:
                                try:
                                    idx.add(json.loads(r["vector"]), int(r["id"]))
                                except Exception:  # noqa: BLE001
                                    pass
                        self._hnsw = idx
                        return
            # Fresh build from the full corpus (uses the cached matrix).
            M, ids, _imp, _types = self.forge_vectors()
            if M.shape[0] == 0:
                return
            idx = HnswIndex.build(M, ids, max_id)
            if idx is not None:
                idx.save(self._hnsw_path)
                try:
                    self._hnsw_meta.write_text(
                        json.dumps({"n": n, "max_id": max_id, "dim": VECTOR_DIM}), encoding="utf-8"
                    )
                except Exception:  # noqa: BLE001
                    pass
                self._hnsw = idx
        except Exception:  # noqa: BLE001 - scale path must never break recall
            self._hnsw = None

    def _fetch_meta_by_ids(self, ids: list[int]) -> dict[int, dict[str, Any]]:
        if not ids:
            return {}
        placeholders = ",".join("?" * len(ids))
        with self._conn() as c:
            rows = c.execute(
                f"SELECT id, timestamp, event_type, text, summary, reinforce, importance "
                f"FROM vector_memories WHERE id IN ({placeholders})",
                ids,
            ).fetchall()
        return {int(r["id"]): self._meta_from_row(r) for r in rows}

    def _init_db(self) -> None:
        with self._conn() as c:
            c.execute("PRAGMA journal_mode=WAL")
            c.execute("PRAGMA synchronous=NORMAL")
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
            new_id = int(cur.lastrowid)

        # Keep the full-corpus HNSW index current (incremental add, best-effort).
        if self._hnsw is not None:
            self._hnsw.add(vector, new_id)

        # Keep the in-memory index in sync if it has already been built.
        if self._matrix is not None:
            row_vec = np.asarray(vector, dtype=np.float32).reshape(1, -1)
            self._matrix = (
                row_vec if self._matrix.shape[0] == 0 else np.vstack([self._matrix, row_vec])
            )
            self._meta.append(
                {
                    "id": new_id,
                    "timestamp": now,
                    "event_type": event.type,
                    "text": text,
                    "summary": summary,
                    "reinforce": reinforce,
                    "importance": importance,
                    "concepts": _concepts(text),
                }
            )
            # New rows past the ANN build are always scanned as candidates; once
            # the store has grown enough, rebuild the centroids (rare, amortized).
            n = int(self._matrix.shape[0])
            if self._ann is not None:
                if self._ann.is_stale(n, dim=VECTOR_DIM):
                    self._refresh_ann()
            elif n >= ANN_MIN_ROWS:
                self._refresh_ann()
        return new_id

    def recall(self, query: str, *, limit: int = 3, include_plumbing: bool = False) -> list[VectorHit]:
        """Вспомнить по смыслу. По умолчанию отдаёт только ЗНАНИЕ: внутренняя
        машинерия (PLUMBING_TYPES) исключена, дубли схлопнуты, заземлённое
        (слова человека, исходы дел) ранжируется выше. include_plumbing=True —
        для внутренних вызовов, которым нужен сырой корпус."""
        query = query.strip()
        if not query:
            return []

        query_vector = embed_text(query)
        if not any(query_vector):
            return []

        # Full-corpus HNSW: search ALL memories (past RECALL_CAP), fetch meta only
        # for the top-k. Falls through to the exact capped-matrix path on miss/error.
        self._ensure_hnsw()
        if self._hnsw is not None:
            try:
                # Пул кандидатов шире: пост-фильтр отсеивает плумбинг и дубли
                # (на реальном корпусе это ~80%), иначе выдача схлопнется в ноль.
                pool = max(limit * 8, 48) if include_plumbing else max(limit * 40, 400)
                ids, sims = self._hnsw.query(query_vector, pool)
                pairs = [(i, s) for i, s in zip(ids, sims) if s >= SIM_FLOOR]
                if pairs:
                    metas = self._fetch_meta_by_ids([i for i, _ in pairs])
                    qconc = _concepts(query)
                    hh: list[VectorHit] = []
                    for i, sim in pairs:
                        m = metas.get(i)
                        if not m:
                            continue
                        score = float(sim) * m["importance"]
                        if qconc and m["concepts"]:
                            overlap = len(qconc & m["concepts"]) / len(qconc)
                            score += overlap * m["importance"] * 0.25
                        hh.append(
                            VectorHit(
                                id=m["id"], timestamp=m["timestamp"], event_type=m["event_type"],
                                text=m["text"][:240], summary=m["summary"][:180],
                                reinforce=m["reinforce"][:180], importance=m["importance"], score=score,
                            )
                        )
                    ranked = _rank_hits(hh, limit, include_plumbing)
                    if ranked:
                        return ranked
            except Exception:  # noqa: BLE001 - scale path must never break recall
                pass

        self._ensure_index()
        if self._matrix is None or self._matrix.shape[0] == 0:
            return []

        q = np.asarray(query_vector, dtype=np.float32)
        # Rows are L2-normed, so the dot product is cosine similarity. Below the
        # ANN threshold we score the WHOLE memory at once (exact, no row cap);
        # above it the IVF index narrows to the nearest clusters' rows first, so
        # the exact cosine runs over a small candidate set instead of all N.
        if self._ann is not None:
            cand = self._ann.candidates(q, int(self._matrix.shape[0]))
            if cand.size == 0:
                return []
            cand_sims = self._matrix[cand] @ q
            keep = cand_sims >= SIM_FLOOR
            relevant = cand[keep]
            relevant_sims = cand_sims[keep]
        else:
            sims = self._matrix @ q
            relevant = np.nonzero(sims >= SIM_FLOOR)[0]
            relevant_sims = sims[relevant]
        if relevant.size == 0:
            return []

        query_concepts = _concepts(query)
        hits: list[VectorHit] = []
        for idx, sim in zip(relevant.tolist(), relevant_sims.tolist()):
            meta = self._meta[idx]
            score = float(sim) * meta["importance"]
            if query_concepts and meta["concepts"]:
                overlap = len(query_concepts & meta["concepts"]) / len(query_concepts)
                score += overlap * meta["importance"] * 0.25
            hits.append(
                VectorHit(
                    id=meta["id"],
                    timestamp=meta["timestamp"],
                    event_type=meta["event_type"],
                    text=meta["text"][:240],
                    summary=meta["summary"][:180],
                    reinforce=meta["reinforce"][:180],
                    importance=meta["importance"],
                    score=score,
                )
            )

        return _rank_hits(hits, limit, include_plumbing)
