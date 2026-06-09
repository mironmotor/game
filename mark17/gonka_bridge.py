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

import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from mark17 import llm_config
from mark17.web_sense import _SSL_CONTEXT  # verified TLS context (certifi-backed)

DEFAULT_BASE_URL = "https://proxy.gonkabroker.com/v1"
DEFAULT_MODEL = "Qwen/Qwen3-235B-A22B-Instruct-2507-FP8"
DEFAULT_TIMEOUT_SEC = 25

_THINK_RE = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)


@dataclass
class GonkaResponse:
    ok: bool
    text: str
    model: str
    status: str  # ok | disabled | error
    role: str = "chat"
    latency_ms: float = 0.0
    error: str = ""


def is_enabled(role: str = "chat") -> bool:
    """True when an LLM backend resolves to a usable key (and not disabled).

    Backend is chosen at runtime by llm_config (HUD model selector) with the
    GONKA_* env as fallback.
    """
    if os.environ.get("MAX17_GONKA_ENABLED") == "false":
        return False
    _, key, _ = llm_config.resolve(role)
    return bool(key)


_RETRYABLE = {408, 409, 425, 429, 500, 502, 503, 529}


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
            choices = raw.get("choices") or []
            text = ""
            if choices and isinstance(choices[0], dict):
                text = str((choices[0].get("message") or {}).get("content") or "").strip()
            text = _THINK_RE.sub("", text).strip()
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

    last = GonkaResponse(ok=False, text="", model=candidates[0][2], status="error", role=role)
    for base_url, key, model in candidates:
        last = _chat_once(
            base_url, key, model, messages,
            role=role, max_tokens=max_tokens, temperature=temperature,
            timeout=timeout, response_format=response_format,
        )
        if last.ok:
            return last
    return last
