from __future__ import annotations

import json
import os
import time
import urllib.request
from pathlib import Path


BASE_URL = os.getenv("MAX17_TTS_URL", "http://127.0.0.1:8017").rstrip("/")
TOKEN = os.getenv("MAX17_TTS_TOKEN", "")
HEADERS = {"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}


def get_json(path: str) -> dict:
    request = urllib.request.Request(f"{BASE_URL}{path}", headers=HEADERS)
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def main() -> None:
    health = get_json("/health")
    voices = get_json("/voices")
    if not health.get("ok"):
        raise SystemExit(f"MAX Voice is not ready: {health}")
    if len(voices.get("voices", [])) < 2:
        raise SystemExit(f"Voice catalog is incomplete: {voices}")

    body = json.dumps(
        {
            "text": "MAX на связи. Локальное голосовое ядро работает.",
            "persona": "jarvis",
            "language": "ru",
        }
    ).encode()
    request = urllib.request.Request(
        f"{BASE_URL}/synthesize",
        data=body,
        method="POST",
        headers={**HEADERS, "Content-Type": "application/json", "Accept": "audio/wav"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        audio = response.read()
        if not response.headers.get("Content-Type", "").startswith("audio/"):
            raise SystemExit("Synthesis did not return audio")

    stream_body = json.dumps(
        {
            "text": "Потоковый голос MAX готов.",
            "persona": "friday",
            "voice_id": "friday",
            "language": "ru",
            "stream": True,
        }
    ).encode()
    stream_request = urllib.request.Request(
        f"{BASE_URL}/synthesize",
        data=stream_body,
        method="POST",
        headers={**HEADERS, "Content-Type": "application/json", "Accept": "audio/pcm"},
    )
    started = time.perf_counter()
    with urllib.request.urlopen(stream_request, timeout=120) as response:
        first_chunk = response.read(4096)
        first_audio_ms = round((time.perf_counter() - started) * 1000)
        stream_audio = first_chunk + response.read()
        if response.headers.get("X-MAX17-Audio-Format") != "pcm_s16le":
            raise SystemExit("Streaming synthesis did not return pcm_s16le")
        if not first_chunk or len(stream_audio) % 2:
            raise SystemExit("Streaming synthesis returned invalid PCM")

    output = Path(__file__).resolve().parents[1] / "output" / "max17-voice-smoke.wav"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(audio)
    print(
        json.dumps(
            {
                "ok": True,
                "engine": health.get("engine"),
                "model_loaded": health.get("model_loaded"),
                "bytes": len(audio),
                "stream_bytes": len(stream_audio),
                "first_audio_ms": first_audio_ms,
                "output": str(output),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
