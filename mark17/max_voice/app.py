from __future__ import annotations

import os
import threading
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .engine import BusyError, MaxVoiceEngine, PROFILES


engine = MaxVoiceEngine()
app = FastAPI(title="MAX Voice", version="0.1.0")

origins = [
    item.strip()
    for item in os.getenv(
        "MAX17_TTS_CORS_ORIGINS",
        "http://127.0.0.1:3000,http://localhost:3000,https://game-ultra.vercel.app",
    ).split(",")
    if item.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["authorization", "content-type", "x-max17-tts-token"],
)


def require_token(
    authorization: Annotated[str | None, Header()] = None,
    x_max17_tts_token: Annotated[str | None, Header()] = None,
) -> None:
    expected = os.getenv("MAX17_TTS_TOKEN", "").strip()
    if not expected:
        return
    bearer = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if bearer != expected and (x_max17_tts_token or "").strip() != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


class SynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2500)
    persona: str = Field(default="jarvis", pattern="^(jarvis|friday)$")
    voice_id: str | None = None
    language: str = Field(default="ru", max_length=16)
    emotion: str = Field(default="", max_length=80)
    stability: float = Field(default=0.55, ge=0, le=1)
    similarity: float = Field(default=0.8, ge=0, le=1)
    style: float = Field(default=0.15, ge=0, le=1)
    speed: float = Field(default=0.96, ge=0.5, le=2)
    stream: bool = False


@app.on_event("startup")
def preload_model() -> None:
    if os.getenv("MAX17_VOICE_PRELOAD", "1") != "0":
        threading.Thread(target=engine.preload, name="max17-voice-preload", daemon=True).start()


@app.get("/health", dependencies=[Depends(require_token)])
def health() -> dict[str, object]:
    return {
        "ok": engine.available,
        "engine": engine.active_name,
        "model": engine.model,
        "device": engine.device,
        "mlx_installed": engine.mlx.installed,
        "model_loaded": engine.mlx.loaded,
        "last_engine": engine.last_engine or None,
        "last_error": engine.last_error or engine.mlx.last_error or None,
    }


@app.get("/voices", dependencies=[Depends(require_token)])
def voices() -> dict[str, object]:
    return {
        "voices": [
            {
                "voice_id": profile.voice_id,
                "name": profile.name,
                "labels": {
                    "gender": profile.gender,
                    "engine": engine.active_name,
                    "language": "ru",
                    "original": "true",
                },
            }
            for profile in PROFILES.values()
        ]
    }


@app.post("/synthesize", dependencies=[Depends(require_token)])
def synthesize(payload: SynthesisRequest) -> Response:
    text = " ".join(payload.text.split())
    try:
        if payload.stream:
            chunks, voice_id, sample_rate = engine.stream_pcm(
                text=text,
                persona=payload.persona,
                voice_id=payload.voice_id,
                language=payload.language,
                emotion=payload.emotion,
                speed=payload.speed,
            )
            return StreamingResponse(
                chunks,
                media_type=f"audio/pcm; rate={sample_rate}; channels=1",
                headers={
                    "Cache-Control": "no-store, no-transform",
                    "X-Accel-Buffering": "no",
                    "X-MAX17-Voice": voice_id,
                    "X-MAX17-Engine": engine.last_engine,
                    "X-MAX17-Stream": "1",
                    "X-MAX17-Audio-Format": "pcm_s16le",
                    "X-MAX17-Sample-Rate": str(sample_rate),
                    "X-MAX17-Channels": "1",
                },
            )
        audio, voice_id = engine.synthesize(
            text=text,
            persona=payload.persona,
            voice_id=payload.voice_id,
            language=payload.language,
            emotion=payload.emotion,
            speed=payload.speed,
        )
    except BusyError as error:
        raise HTTPException(status_code=429, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"voice_engine_failed:{type(error).__name__}") from error

    return Response(
        content=audio,
        media_type="audio/wav",
        headers={
            "Cache-Control": "no-store",
            "X-MAX17-Voice": voice_id,
            "X-MAX17-Engine": engine.last_engine,
        },
    )
