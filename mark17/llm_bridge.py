"""Prefrontal v0 — Ollama (локально), с таймаутом и fallback."""

from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .compression import TOPIC_MATCH, similarity
from .events import topic_key
from .max_prompt import system_prompt


# MBA 2015 ~8GB RAM: qwen2.5:0.5b (~400MB). phi3:mini ~2.3GB — если хватает памяти.
DEFAULT_MODEL = "qwen2.5:0.5b"
DEFAULT_HOST = "http://127.0.0.1:11434"

# Сколько ждать провайдера. Было 45 секунд — столько человек и стоял перед
# пустым экраном, если провайдер тупил: детерминированный ответ ядра готов за
# миллисекунды, но выдавался только после того, как ожидание сети закончится.
# 20 секунд хватает любому нормальному ответу; всё, что дольше, — это уже не
# «медленно», а «не приехало», и честнее отдать ответ ядра.
TIMEOUT_SEC = max(3, int(os.environ.get("MAX17_LLM_TIMEOUT_SEC", "20") or 20))

# Кеш ответов провайдера. Неделя — компромисс: за это время ответ на «как
# поднять доход» не протухает, а сдвиг в проекте успевает до кеша дойти.
CACHE_TTL_SEC = 7 * 24 * 3600
CACHE_LIMIT = 500

# Порядок выбора модели на OpenRouter. Раньше здесь стояла одна бесплатная
# gemini-flash: быстрая и болтливая, но она проваливает ровно то, ради чего
# LLM тут вообще нужен — держать инструкцию на несколько шагов, не терять
# формат и не выдумывать вызовы. Список отсортирован по агентности, а не по
# цене и не по скорости: первый пункт — то, чем Макс думает по умолчанию,
# остальные идут запасными, если первый недоступен.
#
# MAX17_LLM_MODEL по-прежнему главнее всего списка.
OPENROUTER_AGENTIC = (
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-5-mini",
    "google/gemini-2.5-flash",
    "google/gemini-2.0-flash-exp:free",
)


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
        state_dir: Path | None = None,
    ) -> None:
        self.host = host.rstrip("/")
        # Где лежит кеш ответов. Не задан — кеш просто не работает, и это
        # законно: ядро обязано отвечать и без него.
        self.state_dir = state_dir
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
            self.model = OPENROUTER_AGENTIC[0]
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

    def _cache_path(self) -> Path | None:
        return (self.state_dir / "llm_cache.json") if self.state_dir else None

    def _cache_key(self, prompt: str) -> str:
        # Модель входит в ключ: ответы разных моделей смешивать нельзя.
        return hashlib.sha256(f"{self.model}|{topic_key(prompt)}".encode()).hexdigest()[:24]

    def _cache_get(self, prompt: str) -> str:
        """Найти прошлый ответ на этот же по смыслу вопрос.

        Точного ключа мало по той же причине, по какой его не хватало
        паттернам: «как поднять доход» и «как мне поднять доход в этом месяце»
        дают разные хеши, а поход в сеть за ними один и тот же. Поэтому здесь
        не поиск по ключу, а перебор с той же мерой похожести. Записей не
        больше CACHE_LIMIT, так что перебор дешевле одного запроса к сети на
        три порядка.
        """
        path = self._cache_path()
        if not path or not path.exists():
            return ""
        try:
            raw = json.loads(path.read_text())
        except (OSError, ValueError):
            return ""
        if not isinstance(raw, dict):
            return ""

        topic = topic_key(prompt)
        now = time.time()
        best_text, best_score = "", 0.0
        for row in raw.values():
            if not isinstance(row, dict) or row.get("model") != self.model:
                continue
            if now - float(row.get("ts", 0)) > CACHE_TTL_SEC:
                continue
            score = similarity(topic, str(row.get("topic") or ""))
            if score > best_score:
                best_text, best_score = str(row.get("text") or ""), score
        return best_text if best_score >= TOPIC_MATCH else ""

    def _cache_put(self, prompt: str, text: str) -> None:
        path = self._cache_path()
        if not path or not text.strip():
            return
        try:
            raw = json.loads(path.read_text()) if path.exists() else {}
            if not isinstance(raw, dict):
                raw = {}
        except (OSError, ValueError):
            raw = {}
        raw[self._cache_key(prompt)] = {
            "text": text,
            "ts": time.time(),
            "topic": topic_key(prompt),
            "model": self.model,
        }
        if len(raw) > CACHE_LIMIT:
            # Выкидываем самые старые: кеш — это ускорение, а не архив.
            keep = sorted(raw.items(), key=lambda kv: kv[1].get("ts", 0), reverse=True)
            raw = dict(keep[:CACHE_LIMIT])
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(raw, ensure_ascii=False))
        except OSError:
            pass  # кеш не обязан работать, чтобы работал ответ

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

        # Тот же по смыслу вопрос второй раз в сеть не идёт.
        cached = self._cache_get(prompt)
        if cached:
            return LlmResponse(
                ok=True, text=cached, model=self.model, status="cached", latency_ms=0.0
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
            if text:
                self._cache_put(prompt, text)
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
            if text:
                self._cache_put(prompt, text)
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
