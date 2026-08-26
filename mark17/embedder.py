"""Neural embeddings for Max17 — Gonka/Ollama → Gemini (fallback) → None.

The caller (vector_memory.embed_text) falls back to local token-hashing when this
returns None, so the core never hard-depends on a model being up. The active
embedding dimension is probed once and fixes the vector space for the process;
switch spaces with a re-embed + daemon restart.

Config (env, all optional):
  MAX17_EMBED_NEURAL   on|off            default on
  MAX17_EMBED_PROVIDER gonka|ollama|gemini|off default ollama (rest are the fallback)
  MAX17_EMBED_MODEL    Ollama model      default nomic-embed-text
  MAX17_OLLAMA_HOST    base url          default http://127.0.0.1:11434
  MAX17_EMBED_GONKA_MODEL                default BAAI/bge-m3 (1024 dims, $0.01/1M)
  GONKA_API_KEY / GONKA_BASE_URL         enable the broker path (works without Ollama)
  GEMINI_API_KEY       Google key        enables the Gemini path
  MAX17_EMBED_GEMINI_MODEL                default text-embedding-004
  MAX17_EMBED_TIMEOUT  seconds           default 6
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import urllib.request
from pathlib import Path

# Opt-in: ON только когда среда явно включает (.env.local). Так bare-python
# (parity_check, скрипты) остаётся детерминированным на хэше без передачи env,
# а живой app активирует нейро через загруженный .env.
_NEURAL = os.environ.get("MAX17_EMBED_NEURAL", "false").strip().lower() in {"1", "true", "yes", "on"}
_PROVIDER = os.environ.get("MAX17_EMBED_PROVIDER", "ollama").strip().lower()
_OLLAMA_HOST = os.environ.get("MAX17_OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
_OLLAMA_MODEL = os.environ.get("MAX17_EMBED_MODEL", "nomic-embed-text").strip()
_GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
# Брокер Gonka отдаёт BGE-M3 по OpenAI-совместимому /v1/embeddings за $0.01/млн.
# Это единственный настоящий эмбеддер, доступный дроплету: своей Ollama там нет,
# а Gemini на бесплатном тарифе отдаёт 429 ровно тогда, когда память растёт.
_GONKA_KEY = os.environ.get("GONKA_API_KEY", "").strip()
_GONKA_BASE = (os.environ.get("GONKA_BASE_URL") or "https://proxy.gonkabroker.com/v1").strip().rstrip("/")
_GONKA_MODEL = os.environ.get("MAX17_EMBED_GONKA_MODEL", "BAAI/bge-m3").strip()
try:
    _GONKA_MAX_CHARS = int(os.environ.get("MAX17_EMBED_MAX_CHARS", "8000"))
except ValueError:
    _GONKA_MAX_CHARS = 8000
_GEMINI_MODEL = os.environ.get("MAX17_EMBED_GEMINI_MODEL", "gemini-embedding-001").strip()
try:
    _EMBED_DIM = int(os.environ.get("MAX17_EMBED_DIM", "768"))  # paritet с Ollama nomic (768)
except ValueError:
    _EMBED_DIM = 768
try:
    _TIMEOUT = float(os.environ.get("MAX17_EMBED_TIMEOUT", "6"))
except ValueError:
    _TIMEOUT = 6.0

_STATE = Path(os.environ.get("MAX17_STATE_DIR") or (Path(__file__).resolve().parent / "state"))


def _post_json(url: str, payload: dict, headers: dict | None = None, timeout: float | None = None) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout or _TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _normalize(vec: list[float]) -> list[float]:
    norm = sum(x * x for x in vec) ** 0.5
    return [x / norm for x in vec] if norm else vec


def _ollama_embed(text: str) -> list[float] | None:
    try:
        out = _post_json(f"{_OLLAMA_HOST}/api/embeddings", {"model": _OLLAMA_MODEL, "prompt": text})
        vec = out.get("embedding")
        return [float(x) for x in vec] if isinstance(vec, list) and vec else None
    except Exception:
        return None


def _gonka_embed(text: str) -> list[float] | None:
    if not _GONKA_KEY:
        return None
    vecs = _gonka_embed_batch([text])
    return vecs[0] if vecs else None


def _gonka_embed_batch(texts: list[str]) -> list[list[float]] | None:
    """Пачка за один запрос — /v1/embeddings принимает массив input.

    Нужно для переэмбеддинга: 33 тыс. записей по одной = часы, пачками по сотне
    = минуты. Порядок ответа брокер помечает полем index, по нему и раскладываем,
    а не по позиции в data.
    """
    if not _GONKA_KEY or not texts:
        return None
    # У BGE-M3 контекст 8192 токена; длинный лог памяти его перебивает и роняет
    # ВСЮ пачку, а не одну запись. Режем по символам — смысл живёт в начале.
    texts = [t[:_GONKA_MAX_CHARS] for t in texts]
    try:
        out = _post_json(
            f"{_GONKA_BASE}/embeddings",
            {"model": _GONKA_MODEL, "input": texts},
            {"Authorization": f"Bearer {_GONKA_KEY}"},
            # Пачка считается дольше одиночного вызова: 6-секундный дефолт её рубит.
            timeout=max(_TIMEOUT, 15.0 + 0.5 * len(texts)),
        )
        data = out.get("data")
        if not isinstance(data, list) or len(data) != len(texts):
            return None
        vecs: list[list[float]] = [[] for _ in texts]
        for item in data:
            idx = int(item.get("index", -1))
            emb = item.get("embedding")
            if not isinstance(emb, list) or not emb or not (0 <= idx < len(texts)):
                return None
            vecs[idx] = [float(x) for x in emb]
        return vecs if all(vecs) else None
    except Exception:
        return None


def _gemini_embed(text: str) -> list[float] | None:
    if not _GEMINI_KEY:
        return None
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{_GEMINI_MODEL}:embedContent?key={_GEMINI_KEY}"
        out = _post_json(
            url,
            {
                "model": f"models/{_GEMINI_MODEL}",
                "content": {"parts": [{"text": text}]},
                "outputDimensionality": _EMBED_DIM,
            },
        )
        vec = (out.get("embedding") or {}).get("values")
        return [float(x) for x in vec] if isinstance(vec, list) and vec else None
    except Exception:
        return None


def _chain() -> list:
    if not _NEURAL or _PROVIDER == "off":
        return []
    if _PROVIDER == "gonka":
        return [_gonka_embed, _gemini_embed, _ollama_embed]
    if _PROVIDER == "gemini":
        return [_gemini_embed, _gonka_embed, _ollama_embed]
    return [_ollama_embed, _gonka_embed, _gemini_embed]


_cache_conn: sqlite3.Connection | None = None


def _cache() -> sqlite3.Connection | None:
    global _cache_conn
    if _cache_conn is None:
        try:
            _STATE.mkdir(parents=True, exist_ok=True)
            _cache_conn = sqlite3.connect(str(_STATE / "embed_cache.db"))
            _cache_conn.execute("CREATE TABLE IF NOT EXISTS emb (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
        except Exception:
            return None
    return _cache_conn


def _key(text: str) -> str:
    return hashlib.sha256(f"{_PROVIDER}|{_OLLAMA_MODEL}|{_GEMINI_MODEL}|{_GONKA_MODEL}|{text}".encode("utf-8")).hexdigest()


def neural_embed(text: str) -> list[float] | None:
    """A real embedding vector, or None to signal the hash fallback."""
    text = (text or "").strip()
    if not text:
        return None
    chain = _chain()
    if not chain:
        return None
    k = _key(text)
    conn = _cache()
    if conn is not None:
        try:
            row = conn.execute("SELECT v FROM emb WHERE k = ?", (k,)).fetchone()
            if row:
                vec = json.loads(row[0])
                if isinstance(vec, list) and vec:
                    return vec
        except Exception:
            pass
    for fn in chain:
        vec = fn(text)
        if vec:
            vec = _normalize(vec)  # unit-norm → cosine_similarity (dot product) корректен
            if conn is not None:
                try:
                    conn.execute("INSERT OR REPLACE INTO emb(k, v) VALUES (?, ?)", (k, json.dumps(vec)))
                    conn.commit()
                except Exception:
                    pass
            return vec
    return None


def _routing_chain() -> list:
    """Provider chain for ROUTING embeddings — НЕЗАВИСИМО от MAX17_EMBED_NEURAL.
    Позволяет семантическому роутеру использовать настоящие эмбеддинги, пока
    vector_memory остаётся на хэше (без глобального переэмбеддинга). Пусто, если
    провайдер недоступен → роутер падает на keyword.

    Низкая латентность критична: если есть Gemini-ключ, ходим в него ПЕРВЫМ —
    Ollama требует локального сервера, которого может не быть, и его 6-сек таймаут
    вешал бы каждый новый запрос. Ollama-first — только когда явно выбран и нет
    Gemini-ключа."""
    if _PROVIDER == "off":
        return []
    if _PROVIDER == "gonka" and _GONKA_KEY:
        return [_gonka_embed, _gemini_embed, _ollama_embed]
    if _GEMINI_KEY:
        return [_gemini_embed, _gonka_embed, _ollama_embed]
    return [_ollama_embed, _gonka_embed, _gemini_embed]


def routing_embed(text: str) -> list[float] | None:
    """Нейро-эмбеддинг ТОЛЬКО для маршрутизации (короткие запросы, кэш). None, если
    провайдер недоступен → оркестратор работает на ключевых словах. Не трогает
    размерность памяти (vector_memory)."""
    text = (text or "").strip()
    if not text:
        return None
    chain = _routing_chain()
    if not chain:
        return None
    k = _key(text)
    conn = _cache()
    if conn is not None:
        try:
            row = conn.execute("SELECT v FROM emb WHERE k = ?", (k,)).fetchone()
            if row:
                vec = json.loads(row[0])
                if isinstance(vec, list) and vec:
                    return vec
        except Exception:
            pass
    for fn in chain:
        vec = fn(text)
        if vec:
            vec = _normalize(vec)
            if conn is not None:
                try:
                    conn.execute("INSERT OR REPLACE INTO emb(k, v) VALUES (?, ?)", (k, json.dumps(vec)))
                    conn.commit()
                except Exception:
                    pass
            return vec
    return None


_active_dim: int | None = None
_neural_ok = False


def active_dim(default: int = 256) -> int:
    """Probe the provider once; the result fixes the vector space for the process."""
    global _active_dim, _neural_ok
    if _active_dim is not None:
        return _active_dim
    if not _chain():
        _active_dim = default
        return _active_dim
    probe = neural_embed("инициализация семантического ядра max17")
    if probe:
        _active_dim = len(probe)
        _neural_ok = True
    else:
        _active_dim = default
    return _active_dim


def is_neural() -> bool:
    return _neural_ok


def info() -> dict:
    return {
        "enabled": _NEURAL,
        "provider": _PROVIDER,
        "ollama_model": _OLLAMA_MODEL,
        "gemini": bool(_GEMINI_KEY),
        "gonka_model": _GONKA_MODEL if _GONKA_KEY else None,
        "active_dim": active_dim(),
        "neural_ok": _neural_ok,
    }
