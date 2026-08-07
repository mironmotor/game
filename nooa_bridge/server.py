#!/usr/bin/env python3
"""Мозг автономного Макса на NOOA (NVIDIA-labs OO Agents).

Отдельный процесс со своим окружением: NOOA требует Python ≥3.12, а ядро
Макса живёт на 3.9. Здесь только принятие решений — руки остаются в
`mark17/hands.py`, со своим белым списком и границами проекта.

Протокол: POST /decide с наблюдением и списком доступных действий → ответ с
выбранным действием. Имя действия ядро всё равно перепроверит по своему
списку, поэтому даже испорченный ответ модели не превращается в выполнение
чего попало.

Запуск — см. README.md рядом.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("NOOA_HOST", "127.0.0.1")
PORT = int(os.environ.get("NOOA_PORT", "8791"))
MODEL = os.environ.get("NOOA_MODEL", "ollama_chat/qwen3:1.7b")
API_BASE = os.environ.get("NOOA_API_BASE", "http://localhost:11434")
MAX_BODY = 512_000

_agent = None
_load_error = ""


def _build_agent():
    """Собрать агента NOOA. Ошибку не глотаем — она нужна в /health."""
    global _agent, _load_error
    if _agent is not None or _load_error:
        return _agent
    try:
        from nooa import Agent
        from nooa.unifiedllm.registry import get_llm_client

        llm = get_llm_client(MODEL, api_base=API_BASE) if API_BASE else get_llm_client(MODEL)

        class MaxDecider(Agent, llm=llm):
            """Ты — ядро Max: решаешь, что сделать следующим шагом.

            Выбирай ТОЛЬКО из переданного списка доступных действий. Никаких
            своих команд: руки у Макса свои и чужого не примут.
            """

            async def choose(self, situation: str) -> str:
                """Верни JSON: {"action": ключ, "params": {...}, "why": "...", "expect": "..."}"""
                ...

        _agent = MaxDecider()
    except Exception as exc:  # noqa: BLE001
        _load_error = f"{type(exc).__name__}: {exc}"
        _agent = None
    return _agent


def _decide(payload: dict) -> dict:
    agent = _build_agent()
    if agent is None:
        return {"ok": False, "error": _load_error or "NOOA не собран",
                "hint": "проверь установку: .venv/bin/pip install nooa (нужен Python ≥3.12)"}

    can_do = payload.get("can_do") or []
    situation = (
        f"ЦЕЛЬ: {payload.get('goal') or 'предложи полезный следующий шаг'}\n"
        f"СОСТОЯНИЕ: {json.dumps(payload.get('state') or {}, ensure_ascii=False)}\n"
        f"НЕДАВНО: {json.dumps(payload.get('recent') or [], ensure_ascii=False)}\n"
        f"ДОСТУПНЫЕ ДЕЙСТВИЯ: {json.dumps(can_do, ensure_ascii=False)}\n\n"
        "Выбери ровно одно действие из списка."
    )
    try:
        raw = asyncio.run(agent.choose(situation))
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"NOOA не ответил: {exc}"}
    return {"ok": True, "raw": str(raw), "model": MODEL}


class Handler(BaseHTTPRequestHandler):
    server_version = "MaxNooaBridge/1.0"

    def _send(self, code: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:
        sys.stderr.write("[nooa] " + (args[0] % args[1:]) + "\n")

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            agent = _build_agent()
            self._send(200, {"ok": agent is not None, "service": "max-nooa-bridge",
                             "model": MODEL, "api_base": API_BASE,
                             "error": _load_error or ""})
            return
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/decide":
            self._send(404, {"ok": False, "error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
            if length > MAX_BODY:
                self._send(413, {"ok": False, "error": "тело слишком большое"})
                return
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            if not isinstance(payload, dict):
                raise ValueError("ожидался JSON-объект")
        except Exception as exc:  # noqa: BLE001
            self._send(400, {"ok": False, "error": f"плохой запрос: {exc}"})
            return
        self._send(200, _decide(payload))


def main() -> int:
    if sys.version_info < (3, 12):
        sys.stderr.write(
            f"[nooa] нужен Python ≥3.12, запущен {sys.version.split()[0]}.\n"
            "[nooa] см. README.md рядом: создай venv на python3.12.\n"
        )
        return 1
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    sys.stderr.write(f"[nooa] мозг Макса на {MODEL} → http://{HOST}:{PORT}\n")
    if _build_agent() is None:
        sys.stderr.write(f"[nooa] ВНИМАНИЕ: агент не собрался — {_load_error}\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
