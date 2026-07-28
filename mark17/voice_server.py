#!/usr/bin/env python3
"""MAX локальный голос — крошечный TTS-сервер на macOS `say`.

Полностью офлайн, без зависимостей и без скачиваний: оборачивает нативный
`say` (голос Milena для русского) в HTTP, который уже понимает фронтенд
(app/api/tts/providers.ts → провайдер `max-local`).

Эндпоинты, которых ждёт приложение:
  GET  /health      -> {"model","device","ok"}
  GET  /voices      -> {"voices":[{"voice_id","name","labels"}]}
  POST /synthesize  -> audio/wav (тело: {"text","voice_id","persona","language","speed",...})

Запуск:  python3 mark17/voice_server.py            # 127.0.0.1:8017
Безопасность: слушает только loopback; текст уходит в `say` как отдельный
argv (не через shell) — инъекция невозможна.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.ratelimit import Guard, client_ip

HOST = os.environ.get("MAX17_TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("MAX17_TTS_PORT", "8017"))
SAMPLE_RATE = 22050
MAX_CHARS = 1200  # защита от гигантских запросов


def _int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, "") or default))
    except ValueError:
        return default


# Каждый /synthesize порождает подпроцесс `say`. Без потолка зациклившийся
# клиент (или открытый наружу MAX17_TTS_HOST) исчерпает процессы на Маке —
# поэтому лимитируем частоту и число одновременных синтезов.
MAX_BODY = _int_env("MAX17_TTS_MAX_BODY_KB", 64) * 1024
MAX_CONCURRENT = _int_env("MAX17_TTS_MAX_CONCURRENT", 3)
GUARD = Guard(
    per_ip_limit=_int_env("MAX17_TTS_RATE_PER_IP", 60),
    global_limit=_int_env("MAX17_TTS_RATE_GLOBAL", 120),
)
_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT)

# Курируемый набор голосов (что реально стоит в macOS на этой машине).
RU_VOICE = "Milena (Enhanced)"
VOICES = [
    {"voice_id": RU_VOICE, "name": "Милена", "labels": {"language": "ru", "gender": "female"}},
    {"voice_id": "Samantha", "name": "Samantha", "labels": {"language": "en", "gender": "female"}},
    {"voice_id": "Daniel", "name": "Daniel", "labels": {"language": "en", "gender": "male"}},
]
_VOICE_NAMES = {v["voice_id"] for v in VOICES}


def _installed_voices() -> set[str]:
    """Реально доступные голоса macOS (чтобы не звать несуществующий)."""
    try:
        out = subprocess.run(["say", "-v", "?"], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return set()
    names = set()
    for line in out.splitlines():
        m = re.match(r"^(.+?)\s{2,}[a-z]{2}_[A-Z]{2}", line)
        if m:
            names.add(m.group(1).strip())
    return names


_AVAILABLE = _installed_voices()


def resolve_voice(voice_id: str | None, persona: str | None, language: str | None) -> str:
    """persona ('jarvis'/'friday') или явное имя голоса -> реальный голос say."""
    vid = (voice_id or "").strip()
    if vid.startswith("max-local:"):
        vid = vid[len("max-local:"):]
    if vid and vid not in ("jarvis", "friday") and (not _AVAILABLE or vid in _AVAILABLE):
        return vid
    lang = (language or "en").lower().split("-")[0].split("_")[0]
    if lang == "ru":
        return RU_VOICE if (not _AVAILABLE or RU_VOICE in _AVAILABLE) else "Milena"
    if persona == "friday" or vid == "friday":
        return "Samantha"
    return "Daniel"


def synth_wav(text: str, voice: str, speed: float) -> bytes:
    rate = max(100, min(320, round(175 * (speed or 1.0))))
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        path = tmp.name
    try:
        subprocess.run(
            ["say", "-v", voice, "-r", str(rate), "-o", path,
             "--data-format=LEI16@%d" % SAMPLE_RATE, "--", text],
            check=True, capture_output=True, timeout=45,
        )
        with open(path, "rb") as fh:
            return fh.read()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_a):  # тихо
        pass

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _throttled(self) -> bool:
        """Лимиты до любой работы. True — запрос уже отклонён."""
        ip = client_ip(self.headers, self.client_address[0] if self.client_address else "?")
        ok, retry, why = GUARD.check(ip)
        if ok:
            return False
        body = json.dumps({"error": "rate_limited", "detail": why, "retry_after": retry}).encode()
        self.send_response(429)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Retry-After", str(retry))
        self.end_headers()
        self.wfile.write(body)
        return True

    def do_GET(self) -> None:
        if self._throttled():
            return
        if self.path.rstrip("/") == "/health":
            self._json(200, {"ok": True, "model": "macos-say", "device": "cpu",
                             "voices": len(VOICES)})
        elif self.path.rstrip("/") == "/voices":
            self._json(200, {"voices": VOICES})
        else:
            self._json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if self._throttled():
            return
        if self.path.rstrip("/") != "/synthesize":
            self._json(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                # Отвергаем ДО чтения, иначе гигантское тело съест память.
                self._json(413, {"error": "body_too_large", "max_kb": MAX_BODY // 1024})
                return
            data = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except Exception:
            self._json(400, {"error": "bad_json"})
            return
        text = str(data.get("text") or "").strip()[:MAX_CHARS]
        if not text:
            self._json(400, {"error": "empty_text"})
            return
        voice = resolve_voice(data.get("voice_id"), data.get("persona"), data.get("language"))
        try:
            speed = float(data.get("speed") or 1.0)
        except (TypeError, ValueError):
            speed = 1.0
        # Один синтез = один подпроцесс `say`. Держим их число под потолком:
        # лучше честный 503, чем сотня форков и Мак в свопе.
        if not _SLOTS.acquire(timeout=10):
            self._json(503, {"error": "busy", "detail": "too many concurrent synthesis jobs",
                             "retry_after": 2})
            return
        try:
            audio = synth_wav(text, voice, speed)
        except subprocess.CalledProcessError as exc:
            self._json(502, {"error": "say_failed", "detail": (exc.stderr or b"").decode()[:200]})
            return
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"error": "synth_error", "detail": str(exc)[:200]})
            return
        finally:
            _SLOTS.release()
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(audio)))
        self.send_header("X-Max17-Voice", voice)
        self.end_headers()
        self.wfile.write(audio)


def main() -> None:
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"MAX voice (macOS say) → http://{HOST}:{PORT}  voices={sorted(_VOICE_NAMES)}")
    print(f"  лимиты: {GUARD.per_ip.limit}/ip/мин, {GUARD.global_.limit}/мин всего, "
          f"{MAX_CONCURRENT} одновременно, тело ≤{MAX_BODY // 1024}KB")
    if HOST not in ("127.0.0.1", "localhost", "::1"):
        print(f"  ВНИМАНИЕ: слушаю {HOST} — не только localhost, а авторизации здесь нет.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
