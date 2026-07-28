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

Flood protection (the tunnel is reachable from the whole internet, so the
bridge must survive being hit; defaults are sane for one person + prod):
  MAX17_RATE_PER_IP        requests/min per IP        (default 60)
  MAX17_RATE_GLOBAL        requests/min total         (default 240)
  MAX17_MAX_CONCURRENT     simultaneous events        (default 16)
  MAX17_MAX_BODY_KB        max request body in KB     (default 256)
  MAX17_AUTH_FAILURES      failed auths before ban    (default 8)
  MAX17_BAN_SECONDS        ban duration               (default 600)
"""

from __future__ import annotations

import hmac
import json
import os
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17 import json_cli  # reuse the exact event handlers
from mark17.fluid_flow import FluidHud, telemetry_from_result
from mark17.ratelimit import Guard, client_ip

STATE_DIR = Path(os.environ.get("MAX17_STATE_DIR", str(_ROOT / "mark17" / "state")))
TOKEN = os.environ.get("MAX17_BRIDGE_TOKEN", "").strip()
LLM_ENABLED = os.environ.get("MAX17_LLM_ENABLED", "").strip().lower() == "true"


def _int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, "") or default))
    except ValueError:
        return default


MAX_BODY = _int_env("MAX17_MAX_BODY_KB", 256) * 1024
MAX_CONCURRENT = _int_env("MAX17_MAX_CONCURRENT", 16)

GUARD = Guard(
    per_ip_limit=_int_env("MAX17_RATE_PER_IP", 60),
    global_limit=_int_env("MAX17_RATE_GLOBAL", 240),
    max_auth_failures=_int_env("MAX17_AUTH_FAILURES", 8),
    ban_seconds=_int_env("MAX17_BAN_SECONDS", 600),
)

# Ядро тяжёлое: больше N событий одновременно Мак просто не тянет — лучше
# честно ответить 503, чем захлебнуться потоками и уйти в своп.
_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT)


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


# Navier-Stokes: the viscous layer between the core and the HUD. This lives in
# the server rather than in json_cli because smoothing needs continuity — the
# CLI is one-shot and has no consecutive frames to integrate across, while the
# bridge is a long-running process where every event is the next frame.
# ThreadingHTTPServer handles requests concurrently, so the flow is serialised:
# integrating a stream from two threads at once would corrupt the velocity.
_HUD = FluidHud()
_HUD_LOCK = threading.Lock()


def handle_event(payload: dict) -> dict:
    event = json_cli._as_event(payload)
    args = _build_args()
    args.state_dir.mkdir(parents=True, exist_ok=True)
    result = json_cli._handle_event(event, args, args.state_dir)
    normalized = json_cli.normalize(result)
    with _HUD_LOCK:
        normalized["hud"] = _HUD.step(telemetry_from_result(normalized))
    return normalized


class Handler(BaseHTTPRequestHandler):
    server_version = "Max17Bridge/1.0"

    def _send(self, code: int, obj: dict, retry_after: int = 0) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if retry_after:
            self.send_header("Retry-After", str(retry_after))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _ip(self) -> str:
        return client_ip(self.headers, self.client_address[0] if self.client_address else "?")

    def _throttled(self) -> bool:
        """Проверка лимитов до любой работы. True — запрос уже отклонён."""
        ok, retry, why = GUARD.check(self._ip())
        if ok:
            return False
        self._send(429, {"ok": False, "error": why, "retry_after": retry}, retry_after=retry)
        return True

    def _authorized(self) -> bool:
        if not TOKEN:
            return True
        header = self.headers.get("Authorization", "")
        # Сравнение постоянного времени: токен не должен утекать по таймингу.
        expected = f"Bearer {TOKEN}"
        if len(header) == len(expected) and hmac.compare_digest(header, expected):
            GUARD.ban.record_success(self._ip())
            return True
        GUARD.ban.record_failure(self._ip())
        return False

    def log_message(self, *args) -> None:  # quieter logs
        sys.stderr.write("[max17-bridge] " + (args[0] % args[1:]) + "\n")

    def do_OPTIONS(self) -> None:  # CORS preflight
        self._send(204, {})

    def do_GET(self) -> None:
        if self._throttled():
            return
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
        if self._throttled():
            return
        if self.path.rstrip("/") != "/event":
            self._send(404, {"ok": False, "error": "not found"})
            return
        if not self._authorized():
            self._send(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
            if length > MAX_BODY:
                # Отвергаем ДО чтения: иначе гигантское тело съест память Мака.
                self._send(413, {"ok": False, "error": f"body too large (max {MAX_BODY // 1024} KB)"})
                return
            raw = self.rfile.read(length) if length else b""
            payload = json.loads(raw.decode("utf-8") or "{}")
            if not isinstance(payload, dict):
                raise ValueError("body must be a JSON object")
        except Exception as exc:  # noqa: BLE001
            self._send(400, {"ok": False, "route": "error", "error": f"bad request: {exc}"})
            return

        if not _SLOTS.acquire(blocking=False):
            self._send(
                503,
                {"ok": False, "error": "bridge saturated, try again", "retry_after": 2},
                retry_after=2,
            )
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
        finally:
            _SLOTS.release()


def main() -> int:
    port = int(os.environ.get("PORT", "8000"))
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    sys.stderr.write(
        f"[max17-bridge] listening on :{port} · state={STATE_DIR} · "
        f"llm={'on' if LLM_ENABLED else 'off'} · auth={'on' if TOKEN else 'off'} · "
        f"limits={GUARD.per_ip.limit}/ip/min, {GUARD.global_.limit}/min total, "
        f"{MAX_CONCURRENT} parallel, {MAX_BODY // 1024}KB body\n"
    )
    if not TOKEN:
        sys.stderr.write(
            "[max17-bridge] ВНИМАНИЕ: MAX17_BRIDGE_TOKEN не задан — мост открыт "
            "всем, кто знает адрес. Задай токен перед выходом наружу.\n"
        )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
