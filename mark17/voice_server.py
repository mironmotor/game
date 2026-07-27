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
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("MAX17_TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("MAX17_TTS_PORT", "8017"))
SAMPLE_RATE = 22050
MAX_CHARS = 1200  # защита от гигантских запросов

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

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            self._json(200, {"ok": True, "model": "macos-say", "device": "cpu",
                             "voices": len(VOICES)})
        elif self.path.rstrip("/") == "/voices":
            self._json(200, {"voices": VOICES})
        else:
            self._json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/synthesize":
            self._json(404, {"error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
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
        try:
            audio = synth_wav(text, voice, speed)
        except subprocess.CalledProcessError as exc:
            self._json(502, {"error": "say_failed", "detail": (exc.stderr or b"").decode()[:200]})
            return
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"error": "synth_error", "detail": str(exc)[:200]})
            return
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(audio)))
        self.send_header("X-Max17-Voice", voice)
        self.end_headers()
        self.wfile.write(audio)


def main() -> None:
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"MAX voice (macOS say) → http://{HOST}:{PORT}  voices={sorted(_VOICE_NAMES)}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()
