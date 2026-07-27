from __future__ import annotations

import io
import os
import shutil
import subprocess
import tempfile
import threading
import wave
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Iterator
from typing import Any

import numpy as np


DEFAULT_MODEL = "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit"


@dataclass(frozen=True)
class VoiceProfile:
    voice_id: str
    name: str
    gender: str
    speaker: str
    instruction: str
    system_voice: str


PROFILES = {
    "jarvis": VoiceProfile(
        voice_id="jarvis",
        name="MAX · Стратег",
        gender="male",
        speaker="Ryan",
        instruction=(
            "Speak in a calm, deep, precise and confident cinematic assistant voice. "
            "Keep pronunciation clear and natural in the requested language. Do not imitate a real person."
        ),
        system_voice="Alex",
    ),
    "friday": VoiceProfile(
        voice_id="friday",
        name="MAX · Пятница",
        gender="female",
        speaker="Serena",
        instruction=(
            "Speak in a warm, intelligent, energetic and reassuring assistant voice. "
            "Keep pronunciation clear and natural in the requested language. Do not imitate a real person."
        ),
        system_voice="Milena (Enhanced)",
    ),
}

LANGUAGE_NAMES = {
    "ru": "Russian",
    "en": "English",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "it": "Italian",
    "pt": "Portuguese",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese",
}


def language_name(value: str | None) -> str:
    base = (value or "en").strip().lower().replace("_", "-").split("-", 1)[0]
    return LANGUAGE_NAMES.get(base, "English")


def profile_for(value: str | None, persona: str) -> VoiceProfile:
    voice_id = (value or persona or "jarvis").strip().lower()
    return PROFILES.get(voice_id, PROFILES["jarvis"])


def _to_pcm(audio: Any, *, normalize: bool = False) -> bytes:
    samples = np.asarray(audio, dtype=np.float32).squeeze()
    if samples.ndim != 1 or samples.size == 0:
        raise RuntimeError("model returned empty audio")
    samples = np.nan_to_num(samples)
    if normalize:
        peak = float(np.max(np.abs(samples)))
        if peak > 1.0:
            samples = samples / peak
    return (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


def _to_wav(audio: Any, sample_rate: int) -> bytes:
    pcm = _to_pcm(audio, normalize=True)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return output.getvalue()


class SystemSayEngine:
    name = "macos-say"
    model = "macOS Speech"
    device = "Apple Speech"

    @property
    def available(self) -> bool:
        return bool(shutil.which("say") and shutil.which("afconvert"))

    def synthesize(self, text: str, profile: VoiceProfile, speed: float, **_: Any) -> bytes:
        if not self.available:
            raise RuntimeError("macOS say/afconvert is unavailable")
        rate = max(100, min(320, round(185 * speed)))
        with tempfile.TemporaryDirectory(prefix="max17-voice-") as directory:
            root = Path(directory)
            aiff = root / "voice.aiff"
            wav = root / "voice.wav"
            command = ["say", "-v", profile.system_voice, "-r", str(rate), "-o", str(aiff), text]
            result = subprocess.run(command, capture_output=True, text=True, timeout=90, check=False)
            if result.returncode != 0 and profile.system_voice != "Milena":
                command[2] = "Milena"
                result = subprocess.run(command, capture_output=True, text=True, timeout=90, check=False)
            if result.returncode != 0:
                raise RuntimeError("macOS speech generation failed")
            converted = subprocess.run(
                ["afconvert", str(aiff), "-f", "WAVE", "-d", "LEI16@24000", str(wav)],
                capture_output=True,
                text=True,
                timeout=90,
                check=False,
            )
            if converted.returncode != 0 or not wav.exists():
                raise RuntimeError("macOS speech conversion failed")
            return wav.read_bytes()


class MlxQwenEngine:
    name = "mlx-qwen3-tts"
    device = "Apple Silicon · MLX"

    def __init__(self) -> None:
        self.model = os.getenv("MAX17_VOICE_MODEL", DEFAULT_MODEL)
        self._instance: Any | None = None
        self._load_lock = threading.Lock()
        self._generation_lock = threading.Lock()
        self.last_error = ""

    @property
    def installed(self) -> bool:
        try:
            import mlx_audio  # noqa: F401

            return True
        except ImportError:
            return False

    @property
    def loaded(self) -> bool:
        return self._instance is not None

    def load(self) -> Any:
        if self._instance is not None:
            return self._instance
        with self._load_lock:
            if self._instance is not None:
                return self._instance
            try:
                from mlx_audio.tts.utils import load_model

                self._instance = load_model(self.model)
                self.last_error = ""
            except Exception as error:
                self.last_error = f"{type(error).__name__}: {error}"[:240]
                raise
        return self._instance

    def synthesize(
        self,
        text: str,
        profile: VoiceProfile,
        language: str,
        emotion: str,
        **_: Any,
    ) -> bytes:
        if not self.installed:
            raise RuntimeError("mlx-audio is not installed")
        if not self._generation_lock.acquire(blocking=False):
            raise BusyError("MAX Voice is already generating speech")
        try:
            model = self.load()
            instruction = profile.instruction
            if emotion:
                instruction = f"{instruction} Current delivery: {emotion}."
            # The upstream default (4096 audio tokens) is suitable for long-form
            # studio output but can hallucinate minutes of speech on a short HUD
            # line. At 12.5 Hz this cap still leaves generous room for the text.
            max_tokens = max(96, min(768, len(text) * 4))
            results = list(
                model.generate_custom_voice(
                    text=text,
                    speaker=profile.speaker,
                    language=language_name(language),
                    instruct=instruction,
                    temperature=0.7,
                    max_tokens=max_tokens,
                    top_k=30,
                    top_p=0.9,
                    repetition_penalty=1.15,
                )
            )
            if not results:
                raise RuntimeError("model returned no audio")
            result = results[0]
            sample_rate = int(
                getattr(result, "sample_rate", 0)
                or getattr(model, "sample_rate", 0)
                or getattr(model, "sr", 0)
                or 24000
            )
            return _to_wav(result.audio, sample_rate)
        except Exception as error:
            self.last_error = f"{type(error).__name__}: {error}"[:240]
            raise
        finally:
            self._generation_lock.release()

    def stream_pcm(
        self,
        text: str,
        profile: VoiceProfile,
        language: str,
        emotion: str,
        **_: Any,
    ) -> tuple[Iterator[bytes], int]:
        if not self.installed:
            raise RuntimeError("mlx-audio is not installed")
        if not self._generation_lock.acquire(blocking=False):
            raise BusyError("MAX Voice is already generating speech")

        try:
            model = self.load()
            instruction = profile.instruction
            if emotion:
                instruction = f"{instruction} Current delivery: {emotion}."
            max_tokens = max(64, min(512, round(len(text) * 2.5)))
            interval = max(0.16, min(0.96, float(os.getenv("MAX17_VOICE_STREAM_INTERVAL", "0.24"))))
            results = model.generate_custom_voice(
                text=text,
                speaker=profile.speaker,
                language=language_name(language),
                instruct=instruction,
                temperature=0.45,
                max_tokens=max_tokens,
                top_k=20,
                top_p=0.9,
                repetition_penalty=1.12,
                stream=True,
                streaming_interval=interval,
            )
            sample_rate = int(
                getattr(model, "sample_rate", 0)
                or getattr(model, "sr", 0)
                or 24000
            )
        except Exception as error:
            self.last_error = f"{type(error).__name__}: {error}"[:240]
            self._generation_lock.release()
            raise

        def chunks() -> Iterator[bytes]:
            produced_audio = False
            try:
                for result in results:
                    pcm = _to_pcm(result.audio)
                    if pcm:
                        produced_audio = True
                        yield pcm
                if not produced_audio:
                    raise RuntimeError("model returned no streaming audio")
                self.last_error = ""
            except Exception as error:
                self.last_error = f"{type(error).__name__}: {error}"[:240]
                raise
            finally:
                close = getattr(results, "close", None)
                try:
                    if callable(close):
                        close()
                finally:
                    self._generation_lock.release()

        return chunks(), sample_rate


class BusyError(RuntimeError):
    pass


class MaxVoiceEngine:
    def __init__(self) -> None:
        self.mode = os.getenv("MAX17_VOICE_ENGINE", "auto").strip().lower()
        self.mlx = MlxQwenEngine()
        self.system = SystemSayEngine()
        self.last_engine = ""
        self.last_error = ""

    @property
    def active_name(self) -> str:
        if self.mode == "system":
            return self.system.name
        if self.mlx.loaded or self.mlx.installed:
            return self.mlx.name
        return self.system.name

    @property
    def model(self) -> str:
        return self.mlx.model if self.active_name == self.mlx.name else self.system.model

    @property
    def device(self) -> str:
        return self.mlx.device if self.active_name == self.mlx.name else self.system.device

    @property
    def available(self) -> bool:
        if self.mode == "mlx":
            return self.mlx.installed
        if self.mode == "system":
            return self.system.available
        return self.mlx.installed or self.system.available

    def preload(self) -> None:
        if self.mode == "system" or not self.mlx.installed:
            return
        try:
            self.mlx.load()
        except Exception as error:
            self.last_error = f"{type(error).__name__}: {error}"[:240]

    def synthesize(
        self,
        *,
        text: str,
        persona: str,
        voice_id: str | None,
        language: str,
        emotion: str,
        speed: float,
    ) -> tuple[bytes, str]:
        profile = profile_for(voice_id, persona)
        use_mlx = self.mode != "system" and self.mlx.installed
        if use_mlx:
            try:
                audio = self.mlx.synthesize(
                    text=text,
                    profile=profile,
                    language=language,
                    emotion=emotion,
                    speed=speed,
                )
                self.last_engine = self.mlx.name
                self.last_error = ""
                return audio, profile.voice_id
            except BusyError:
                raise
            except Exception as error:
                self.last_error = f"{type(error).__name__}: {error}"[:240]
                language_base = (language or "en").lower().replace("_", "-").split("-", 1)[0]
                if (
                    self.mode == "mlx"
                    or language_base not in {"ru", "en"}
                    or os.getenv("MAX17_VOICE_SYSTEM_FALLBACK", "1") == "0"
                ):
                    raise

        audio = self.system.synthesize(text=text, profile=profile, speed=speed)
        self.last_engine = self.system.name
        return audio, profile.voice_id

    def stream_pcm(
        self,
        *,
        text: str,
        persona: str,
        voice_id: str | None,
        language: str,
        emotion: str,
        speed: float,
    ) -> tuple[Iterator[bytes], str, int]:
        profile = profile_for(voice_id, persona)
        if self.mode == "system" or not self.mlx.installed:
            raise RuntimeError("streaming requires the MLX voice engine")
        chunks, sample_rate = self.mlx.stream_pcm(
            text=text,
            profile=profile,
            language=language,
            emotion=emotion,
            speed=speed,
        )
        self.last_engine = self.mlx.name
        self.last_error = ""
        return chunks, profile.voice_id, sample_rate
