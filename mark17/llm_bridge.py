"""Prefrontal v0 — Ollama (локально), с таймаутом и fallback."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


# MBA 2015 ~8GB RAM: qwen2.5:0.5b (~400MB). phi3:mini ~2.3GB — если хватает памяти.
DEFAULT_MODEL = "qwen2.5:0.5b"
DEFAULT_HOST = "http://127.0.0.1:11434"
TIMEOUT_SEC = 45


@dataclass
class LlmResponse:
    ok: bool
    text: str
    model: str
    status: str  # ok | offline | error | skipped
    latency_ms: float = 0.0


class LlmBridge:
    def __init__(
        self,
        *,
        host: str = DEFAULT_HOST,
        model: str = DEFAULT_MODEL,
        enabled: bool = True,
    ) -> None:
        self.host = host.rstrip("/")
        self.model = model
        self.enabled = enabled
        self._checked = False
        self._available = False

    def check(self) -> bool:
        if not self.enabled:
            self._available = False
            return False
        try:
            req = urllib.request.Request(f"{self.host}/api/tags", method="GET")
            with urllib.request.urlopen(req, timeout=3) as resp:
                self._available = resp.status == 200
        except (urllib.error.URLError, TimeoutError, OSError):
            self._available = False
        self._checked = True
        return self._available

    @property
    def available(self) -> bool:
        if not self._checked:
            self.check()
        return self._available

    def build_prompt(self, event_type: str, context: str, memory_snippets: list[str]) -> str:
        mem = "\n".join(f"- {m}" for m in memory_snippets[:5]) if memory_snippets else "(нет)"
        return f"""Ты — локальный ассистент Mark 17 на MacBook Air (слабое железо, CPU).
Событие: {event_type}
Контекст: {context}

Память:
{mem}

Дай короткий ответ (до 6 предложений): что проверить и 1–3 конкретные команды shell."""

    def ask(
        self,
        prompt: str,
        *,
        force: bool = False,
    ) -> LlmResponse:
        if not self.enabled and not force:
            return LlmResponse(
                ok=False,
                text="LLM отключён (--no-llm). Используй plasticity hint.",
                model=self.model,
                status="skipped",
            )

        if not self.available and not force:
            return LlmResponse(
                ok=False,
                text=(
                    "Ollama недоступна. Запусти: ollama serve && ollama pull phi3:mini\n"
                    "Или продолжай с plasticity hint."
                ),
                model=self.model,
                status="offline",
            )

        import time as _time

        body = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {"num_predict": 256, "temperature": 0.3},
        }
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{self.host}/api/generate",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        t0 = _time.time()
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
                raw = json.loads(resp.read().decode())
            text = str(raw.get("response", "")).strip()
            ms = (_time.time() - t0) * 1000
            return LlmResponse(
                ok=bool(text),
                text=text or "(пустой ответ)",
                model=self.model,
                status="ok",
                latency_ms=round(ms, 1),
            )
        except Exception as e:
            return LlmResponse(
                ok=False,
                text=f"Ollama error: {e}",
                model=self.model,
                status="error",
                latency_ms=round((_time.time() - t0) * 1000, 1),
            )
