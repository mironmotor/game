"""Gonka bridge — OpenAI-compatible chat completions for natural answers.

Max17 stays a local, deterministic memory/graph core. This bridge is an optional
"voice" layer: it turns the source-backed facts gathered retrieval-first plus the
deterministic draft into a natural reply using a remote Qwen3 model served over an
OpenAI-compatible endpoint (Gonka).

It is deliberately conservative:
- configured purely from environment variables,
- fails soft (never raises; on any error returns ok=False),
- a no-op when no API key is present, so offline / parity / smoke runs are
  unaffected and the deterministic composer stays the grounded fallback.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass, replace
from typing import Any

from mark17 import llm_config
from mark17.web_sense import _SSL_CONTEXT  # verified TLS context (certifi-backed)

DEFAULT_BASE_URL = "https://proxy.gonkabroker.com/v1"
DEFAULT_MODEL = "MiniMaxAI/MiniMax-M2.7"
DEFAULT_TIMEOUT_SEC = 25

_THINK_RE = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
# Ризонеры (Kimi/MiniMax) часто отдают незакрытый <think> или висячий </think>:
# режем открытый блок до конца и подчищаем одиночные теги, чтобы они не текли в ответ.
_THINK_OPEN_RE = re.compile(r"<think>.*\Z", re.IGNORECASE | re.DOTALL)
_THINK_TAG_RE = re.compile(r"</?think>", re.IGNORECASE)


@dataclass
class GonkaResponse:
    ok: bool
    text: str
    model: str
    status: str  # ok | disabled | error
    role: str = "chat"
    latency_ms: float = 0.0
    error: str = ""
    cached: bool = False


# ——— Fast-path LRU cache ———
# Вход LLM большой (системный промпт ~6 КБ) и дёргается на каждый месседж.
# Ключ — хэш РЕАЛЬНОГО запроса (role + messages + параметры), поэтому кэш
# самоинвалидируется: меняется память/история/тон сердца → меняется промпт →
# другой ключ → промах. Отдельная инвалидация по графу не нужна. TTL добивает
# устаревание. Кризис/тревога НЕ кэшируются вызывающей стороной (cache=False).
_CACHE_MAX = 256
_CACHE_TTL_SEC = 3600.0
_cache: "OrderedDict[str, tuple[float, GonkaResponse]]" = OrderedDict()
_cache_stats = {"hits": 0, "misses": 0, "stored": 0, "skipped": 0}


def _cache_key(
    role: str,
    messages: list[dict[str, str]],
    max_tokens: int,
    temperature: float,
    response_format: dict[str, Any] | None,
) -> str:
    blob = json.dumps(
        {"r": role, "mt": max_tokens, "t": temperature, "rf": response_format, "m": messages},
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _cache_get(key: str) -> GonkaResponse | None:
    item = _cache.get(key)
    if item is None:
        return None
    ts, resp = item
    if time.time() - ts > _CACHE_TTL_SEC:
        _cache.pop(key, None)
        return None
    _cache.move_to_end(key)  # LRU touch
    return resp


def _cache_put(key: str, resp: GonkaResponse) -> None:
    _cache[key] = (time.time(), resp)
    _cache.move_to_end(key)
    while len(_cache) > _CACHE_MAX:
        _cache.popitem(last=False)


def cache_stats() -> dict[str, Any]:
    total = _cache_stats["hits"] + _cache_stats["misses"]
    return {
        **_cache_stats,
        "size": len(_cache),
        "max_size": _CACHE_MAX,
        "ttl_sec": int(_CACHE_TTL_SEC),
        "hit_rate": round(_cache_stats["hits"] / total, 3) if total else 0.0,
    }


def cache_clear() -> None:
    _cache.clear()
    for k in _cache_stats:
        _cache_stats[k] = 0


def is_enabled(role: str = "chat") -> bool:
    """True when an LLM backend resolves to a usable key (and not disabled).

    Backend is chosen at runtime by llm_config (HUD model selector) with the
    GONKA_* env as fallback.
    """
    if os.environ.get("MAX17_GONKA_ENABLED") == "false":
        return False
    return llm_config.available_for_role(role)


_RETRYABLE = {408, 409, 425, 429, 500, 502, 503, 529}


# ── Anthropic (Claude Fable / Opus) ──────────────────────────────────────────
# Единственный бэкенд в лестнице, который НЕ говорит по OpenAI-совместимому
# протоколу: у него свой путь (/messages), свои заголовки (x-api-key +
# anthropic-version), system отдельным полем и ответ блоками в content[].
_ANTHROPIC_HOST = "api.anthropic.com"
_ANTHROPIC_VERSION = "2023-06-01"


def _is_anthropic(base_url: str) -> bool:
    return _ANTHROPIC_HOST in str(base_url or "")


def _anthropic_request(
    base_url: str,
    key: str,
    model: str,
    messages: list[dict[str, str]],
    *,
    max_tokens: int,
    response_format: dict[str, Any] | None,
) -> tuple[str, dict[str, str], bytes]:
    """Собрать запрос к Messages API. Возвращает (url, заголовки, тело)."""
    # system у Anthropic — отдельное поле, а не роль в списке сообщений.
    system_parts = [str(m.get("content") or "") for m in messages if m.get("role") == "system"]
    turns = [
        {"role": ("assistant" if m.get("role") == "assistant" else "user"), "content": str(m.get("content") or "")}
        for m in messages
        if m.get("role") != "system" and str(m.get("content") or "").strip()
    ]
    if not turns:  # разговор из одного system: Anthropic требует хотя бы один ход
        turns = [{"role": "user", "content": system_parts.pop() if system_parts else "."}]

    system = "\n\n".join(p for p in system_parts if p.strip())
    if response_format is not None:
        # Строгий JSON у Anthropic задаётся иначе; для короткого решения ядра
        # достаточно требования в system — оно работает на всех моделях.
        system = (system + "\n\nОтвечай СТРОГО одним JSON-объектом, без пояснений и без markdown.").strip()

    payload: dict[str, Any] = {"model": model, "max_tokens": max_tokens, "messages": turns}
    if system:
        payload["system"] = system
    # temperature/top_p/top_k у Fable 5 и Opus 5 УДАЛЕНЫ и дают 400 — поэтому
    # сюда они не попадают вообще, в отличие от OpenAI-совместимой ветки.
    headers = {
        "x-api-key": key,
        "anthropic-version": _ANTHROPIC_VERSION,
        "Content-Type": "application/json",
    }
    return f"{str(base_url).rstrip('/')}/messages", headers, json.dumps(payload).encode("utf-8")


def _anthropic_text(raw: dict[str, Any]) -> tuple[str, str]:
    """Текст ответа и причина остановки. Отказ модели — это HTTP 200 с пустым
    content и stop_reason='refusal': без разбора он выглядел бы как «пустой
    ответ», и лестница молча ушла бы к следующему бэкенду."""
    blocks = raw.get("content") or []
    text = "".join(
        str(b.get("text") or "") for b in blocks if isinstance(b, dict) and b.get("type") == "text"
    ).strip()
    return text, str(raw.get("stop_reason") or "")


def _chat_once(
    base_url: str,
    key: str,
    model: str,
    messages: list[dict[str, str]],
    *,
    role: str,
    max_tokens: int,
    temperature: float,
    timeout: float,
    response_format: dict[str, Any] | None,
) -> GonkaResponse:
    """One backend attempt (with same-provider 429/5xx retry). Fails soft."""
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }
    # Strict-JSON mode (OpenAI-compatible; Gemini/most providers honor it). Falls
    # back gracefully if the provider ignores it.
    if response_format is not None:
        payload["response_format"] = response_format
    anthropic = _is_anthropic(base_url)
    if anthropic:
        url, headers, body = _anthropic_request(
            base_url, key, model, messages, max_tokens=max_tokens, response_format=response_format
        )
    else:
        body = json.dumps(payload).encode("utf-8")
        url = f"{base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    last_error = "no response"
    started = time.time()
    # Free-tier Gemini throws transient 429/503 ("overloaded") on heavier calls —
    # retry a couple of times with backoff so it doesn't surface as a hard error.
    for attempt in range(3):
        started = time.time()
        request = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=_SSL_CONTEXT) as response:  # noqa: S310
                raw = json.loads(response.read().decode("utf-8", errors="replace"))
            if anthropic:
                text, stop_reason = _anthropic_text(raw)
                if stop_reason == "refusal":
                    ms = round((time.time() - started) * 1000, 1)
                    return GonkaResponse(
                        ok=False, text="", model=model, status="refusal", role=role,
                        latency_ms=ms, error="модель отказалась отвечать",
                    )
            else:
                choices = raw.get("choices") or []
                text = ""
                if choices and isinstance(choices[0], dict):
                    text = str((choices[0].get("message") or {}).get("content") or "").strip()
            text = _THINK_RE.sub("", text).strip()
            # Висячий </think> без открывающего: всё до него — рассуждения модели.
            lowered = text.lower()
            close_at = lowered.rfind("</think>")
            if close_at != -1 and "<think>" not in lowered:
                text = text[close_at + len("</think>") :].strip()
            # Незакрытый <think>: рассуждения тянутся до конца ответа.
            text = _THINK_OPEN_RE.sub("", text).strip()
            text = _THINK_TAG_RE.sub("", text).strip()
            ms = round((time.time() - started) * 1000, 1)
            if not text:
                return GonkaResponse(ok=False, text="", model=model, status="error", role=role, latency_ms=ms, error="empty response")
            return GonkaResponse(ok=True, text=text, model=model, status="ok", role=role, latency_ms=ms)
        except urllib.error.HTTPError as exc:
            last_error = f"HTTP {exc.code}"
            if exc.code in _RETRYABLE and attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            break
        except Exception as exc:  # noqa: BLE001 - network/parse failures fail soft.
            # Do NOT retry generic failures (e.g. timeouts): on a slow local model
            # that would just multiply an already-long wait. Only HTTP 429/5xx retry.
            last_error = str(exc)[:200]
            break
    return GonkaResponse(
        ok=False,
        text="",
        model=model,
        status="error",
        role=role,
        latency_ms=round((time.time() - started) * 1000, 1),
        error=last_error,
    )


def chat(
    messages: list[dict[str, str]],
    *,
    role: str = "chat",
    max_tokens: int = 400,
    temperature: float = 0.3,
    timeout: float = DEFAULT_TIMEOUT_SEC,
    response_format: dict[str, Any] | None = None,
    cache: bool = True,
) -> GonkaResponse:
    """Resolve the role's backend ladder and try each until one answers.

    The resolved primary is attempted first (so the happy path is unchanged); if
    it fails (disabled / 401 / timeout / empty), the next AVAILABLE backend in the
    role chain is tried. Only when every candidate fails do we return the last
    error, and the caller falls back to the deterministic core. A single provider
    dying no longer takes the feature dark.
    """
    if os.environ.get("MAX17_GONKA_ENABLED") == "false":
        _, _, model = llm_config.resolve(role)
        return GonkaResponse(ok=False, text="", model=model, status="disabled", role=role)

    candidates = llm_config.resolve_chain(role)
    candidates = [c for c in candidates if c[1]]  # drop keyless (defensive)
    if not candidates:
        _, _, model = llm_config.resolve(role)
        return GonkaResponse(ok=False, text="", model=model, status="disabled", role=role)

    # Fast path: identical prompt within TTL -> instant, no network/cost.
    key = _cache_key(role, messages, max_tokens, temperature, response_format) if cache else None
    if key is not None:
        hit = _cache_get(key)
        if hit is not None:
            _cache_stats["hits"] += 1
            return replace(hit, cached=True, latency_ms=0.0)
        _cache_stats["misses"] += 1
    elif not cache:
        _cache_stats["skipped"] += 1

    last = GonkaResponse(ok=False, text="", model=candidates[0][2], status="error", role=role)
    for base_url, key_, model in candidates:
        last = _chat_once(
            base_url, key_, model, messages,
            role=role, max_tokens=max_tokens, temperature=temperature,
            timeout=timeout, response_format=response_format,
        )
        if last.ok:
            if key is not None:
                _cache_put(key, last)
                _cache_stats["stored"] += 1
            return last
    return last
