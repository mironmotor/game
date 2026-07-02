#!/usr/bin/env python3
"""HTTP bridge for the Max17 (mark17) core.

Exposes the exact same event handling as mark17/json_cli.py over HTTP, so it can
be hosted (Railway / Fly / a VPS) and called from a serverless frontend (Vercel)
where spawning python3 is impossible.

Endpoints:
  GET  /health         -> {"ok": true, "service": "max17-bridge", ...}
  POST /event          -> same JSON shape as json_cli (normalize()) for one event

Auth (optional): if MAX17_BRIDGE_TOKEN is set, requests must send
  Authorization: Bearer <token>

Env:
  PORT                 (default 8000)
  MAX17_STATE_DIR      persistent state dir (default mark17/state)
  MAX17_BRIDGE_TOKEN   optional shared secret
  MAX17_LLM_ENABLED    "true" to enable the LLM (default off -> deterministic)
  MAX17_LLM_PROVIDER   "openrouter" | "ollama"
  OPENROUTER_API_KEY   key when provider=openrouter
  MAX17_LLM_MODEL      model override
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17 import json_cli  # reuse the exact event handlers

STATE_DIR = Path(os.environ.get("MAX17_STATE_DIR", str(_ROOT / "mark17" / "state")))
TOKEN = os.environ.get("MAX17_BRIDGE_TOKEN", "").strip()
LLM_ENABLED = os.environ.get("MAX17_LLM_ENABLED", "").strip().lower() == "true"


def _build_args() -> SimpleNamespace:
    return SimpleNamespace(
        state_dir=STATE_DIR,
        ephemeral=False,
        warmup=None,
        plasticity_threshold=float(os.environ.get("MAX17_PLASTICITY_THRESHOLD", "0.7")),
        ollama_model=os.environ.get("MAX17_LLM_MODEL", "qwen2.5:0.5b"),
        ollama_host=os.environ.get("MAX17_OLLAMA_HOST", "http://127.0.0.1:11434"),
        no_llm=not LLM_ENABLED,
    )


def handle_event(payload: dict) -> dict:
    event = json_cli._as_event(payload)
    args = _build_args()
    args.state_dir.mkdir(parents=True, exist_ok=True)
    result = json_cli._handle_event(event, args, args.state_dir)
    return json_cli.normalize(result)


class Handler(BaseHTTPRequestHandler):
    server_version = "Max17Bridge/1.0"

    def _send(self, code: int, obj: dict) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        if not TOKEN:
            return True
        header = self.headers.get("Authorization", "")
        return header == f"Bearer {TOKEN}"

    def log_message(self, *args) -> None:  # quieter logs
        sys.stderr.write("[max17-bridge] " + (args[0] % args[1:]) + "\n")

    def do_OPTIONS(self) -> None:  # CORS preflight
        self._send(204, {})

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            self._send(200, {
                "ok": True,
                "service": "max17-bridge",
                "llm_enabled": LLM_ENABLED,
                "provider": os.environ.get("MAX17_LLM_PROVIDER", "ollama"),
                "state_dir": str(STATE_DIR),
            })
            return
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/event":
            self._send(404, {"ok": False, "error": "not found"})
            return
        if not self._authorized():
            self._send(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length) if length else b""
            payload = json.loads(raw.decode("utf-8") or "{}")
            if not isinstance(payload, dict):
                raise ValueError("body must be a JSON object")
        except Exception as exc:  # noqa: BLE001
            self._send(400, {"ok": False, "route": "error", "error": f"bad request: {exc}"})
            return
        try:
            self._send(200, handle_event(payload))
        except Exception as exc:  # noqa: BLE001
            self._send(
                502,
                {
                    "ok": False,
                    "route": "error",
                    "error": str(exc),
                    "trace": traceback.format_exc(),
                    "memory": {},
                    "plasticity": {},
                    "llm": {},
                    "confidence": 0.0,
                    "next_adaptation": "Bridge error.",
                },
            )


def main() -> int:
    port = int(os.environ.get("PORT", "8000"))
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    sys.stderr.write(
        f"[max17-bridge] listening on :{port} · state={STATE_DIR} · "
        f"llm={'on' if LLM_ENABLED else 'off'} · auth={'on' if TOKEN else 'off'}\n"
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
