"""Prefrontal v0 — Ollama (локально), с таймаутом и fallback."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from .max_prompt import system_prompt


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

        # Provider selection: "ollama" (local), "openrouter" or "minimax" (hosted).
        self.provider = os.environ.get("MAX17_LLM_PROVIDER", "ollama").strip().lower()
        self.openrouter_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
        self.openrouter_url = "https://openrouter.ai/api/v1/chat/completions"

        # MiniMax — то, на чём думает Max Ultra (OpenAI-совместимый chatcompletion_v2).
        # Ключ и URL берём из env, чтобы можно было переключить международный/CN
        # эндпоинт и модель без правки кода.
        self.minimax_key = (
            os.environ.get("MINIMAX_API_KEY", "").strip()
            or os.environ.get("MAX17_LLM_API_KEY", "").strip()
        )
        self.minimax_url = (
            os.environ.get("MINIMAX_BASE_URL", "").strip()
            or "https://api.minimax.io/v1/text/chatcompletion_v2"
        )

        env_model = os.environ.get("MAX17_LLM_MODEL", "").strip()
        if env_model:
            self.model = env_model
        elif self.provider == "openrouter":
            self.model = "google/gemini-2.0-flash-exp:free"
        elif self.provider == "minimax":
            self.model = os.environ.get("MINIMAX_MODEL", "").strip() or "MiniMax-M2"

    def check(self) -> bool:
        if not self.enabled:
            self._available = False
            return False
        if self.provider == "openrouter":
            self._available = bool(self.openrouter_key)
            self._checked = True
            return self._available
        if self.provider == "minimax":
            self._available = bool(self.minimax_key)
            self._checked = True
            return self._available
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
        """Пользовательская часть запроса. Кто такой MAX — не здесь: это
        системная хартия из max_prompt.py, она уходит отдельной ролью."""
        mem = "\n".join(f"- {m}" for m in memory_snippets[:5]) if memory_snippets else "(нет)"
        return f"""Событие: {event_type}
Контекст: {context}

Память:
{mem}"""

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

        if self.provider == "openrouter":
            return self._ask_openai_compatible(
                self.openrouter_url, self.openrouter_key, prompt, label="OpenRouter"
            )
        if self.provider == "minimax":
            return self._ask_openai_compatible(
                self.minimax_url, self.minimax_key, prompt, label="MiniMax"
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
            "system": system_prompt(),
            "stream": False,
            # 256 токенов хватало на «проверь то-то и вот команда», но хартия
            # просит различать факт и допущение и называть неизвестное — на это
            # нужен воздух, иначе ответ обрывается на полуслове.
            "options": {"num_predict": 512, "temperature": 0.3},
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

    def _ask_openai_compatible(
        self, url: str, key: str, prompt: str, *, label: str
    ) -> LlmResponse:
        """OpenAI-совместимый chat/completions: OpenRouter и MiniMax (chatcompletion_v2)."""
        import time as _time

        if not key:
            return LlmResponse(
                ok=False,
                text=f"Нет ключа для {label} — LLM недоступен, идёт детерминированный fallback.",
                model=self.model,
                status="offline",
            )
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt()},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 512,
        }
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {key}",
            },
            method="POST",
        )
        t0 = _time.time()
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
                raw = json.loads(resp.read().decode())
            text = self._extract_content(raw)
            ms = (_time.time() - t0) * 1000
            if not text:
                # MiniMax при ошибке кладёт причину в base_resp.status_msg.
                base = raw.get("base_resp") if isinstance(raw, dict) else None
                if isinstance(base, dict) and base.get("status_code"):
                    return LlmResponse(
                        ok=False,
                        text=f"{label}: {base.get('status_msg', 'error')}",
                        model=self.model,
                        status="error",
                        latency_ms=round(ms, 1),
                    )
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
                text=f"{label} error: {e}",
                model=self.model,
                status="error",
                latency_ms=round((_time.time() - t0) * 1000, 1),
            )

    @staticmethod
    def _extract_content(raw: Any) -> str:
        """Достать текст ответа из OpenAI-совместимой структуры (choices[].message.content)."""
        if not isinstance(raw, dict):
            return ""
        choices = raw.get("choices")
        if isinstance(choices, list) and choices:
            msg = choices[0].get("message") if isinstance(choices[0], dict) else None
            if isinstance(msg, dict):
                content = msg.get("content")
                if isinstance(content, str):
                    return content.strip()
                # Некоторые модели отдают content списком блоков.
                if isinstance(content, list):
                    parts = [b.get("text", "") for b in content if isinstance(b, dict)]
                    return "".join(parts).strip()
            # старый формat MiniMax: choices[].text
            txt = choices[0].get("text") if isinstance(choices[0], dict) else None
            if isinstance(txt, str):
                return txt.strip()
        # ещё один вариант MiniMax v2: reply на верхнем уровне
        if isinstance(raw.get("reply"), str):
            return raw["reply"].strip()
        return ""
