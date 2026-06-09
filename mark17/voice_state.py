"""Voice state analysis for Max17.

Reads acoustic features of a voice (pitch, register, brightness, jitter,
energy) plus dialogue context and infers a human state — arousal, valence
and tension — using transparent rules (no external APIs, fully offline).

The module also keeps a per-person baseline ("так этот человек звучит
обычно") so the same acoustics are interpreted relative to that person:
F0 of 150 Hz is calm for one speaker and agitated for another.

Designed to plug into the mark17 event pipeline as the ``voice_state``
event. State and baselines are persisted in a small SQLite file inside the
shared state dir, next to the hippocampus memory.
"""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# EMA factor for updating a person's baseline. Small => baseline moves slowly,
# so a single shout does not redefine "normal" for that speaker.
BASELINE_ALPHA = 0.05
# Below this many observations the baseline is still "warming up" and we lean
# on absolute heuristics rather than personal deviation.
WARMUP_OBS = 8

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def note_of(freq: float) -> str:
    """Nearest musical note name for a frequency in Hz (e.g. 146 -> 'D3')."""
    if freq <= 0:
        return "—"
    import math

    midi = round(12 * math.log2(freq / 440.0) + 69)
    return NOTE_NAMES[midi % 12] + str(midi // 12 - 1)


@dataclass
class Acoustics:
    """Normalised acoustic snapshot of a voice over a short window."""

    f0: float = 0.0           # fundamental frequency, Hz (0 = unvoiced)
    register: float = 0.0     # 0..1 position low->high within voice range
    brightness: float = 0.0   # 0..1 spectral centroid / overtone energy
    jitter: float = 0.0       # 0..1 pitch instability (tremor)
    energy: float = 0.0       # 0..1 loudness
    voiced: bool = False      # whether a real voice was detected

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "Acoustics":
        ac = payload.get("acoustics") if isinstance(payload.get("acoustics"), dict) else payload
        f0 = float(ac.get("f0", 0) or 0)
        return cls(
            f0=f0,
            register=_clamp(float(ac.get("register", 0) or 0)),
            brightness=_clamp(float(ac.get("brightness", 0) or 0)),
            jitter=_clamp(float(ac.get("jitter", 0) or 0)),
            energy=_clamp(float(ac.get("energy", 0) or 0)),
            voiced=bool(ac.get("voiced", f0 > 0)),
        )


@dataclass
class VoiceState:
    user_id: str
    acoustics: Acoustics
    arousal: float            # 0..1 спокойствие -> возбуждение
    valence: float            # 0..1 негатив -> позитив
    tension: float            # 0..1 расслабление -> напряжение
    label: str                # короткий человекочитаемый вердикт
    note: str                 # музыкальная нота основного тона
    deviation: dict[str, float] = field(default_factory=dict)  # отклонение от нормы
    baseline_obs: int = 0
    context: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "note": self.note,
            "arousal": round(self.arousal, 3),
            "valence": round(self.valence, 3),
            "tension": round(self.tension, 3),
            "label": self.label,
            "deviation": {k: round(v, 3) for k, v in self.deviation.items()},
            "baseline_obs": self.baseline_obs,
            "context": self.context,
            "acoustics": {
                "f0": round(self.acoustics.f0, 1),
                "register": round(self.acoustics.register, 3),
                "brightness": round(self.acoustics.brightness, 3),
                "jitter": round(self.acoustics.jitter, 3),
                "energy": round(self.acoustics.energy, 3),
                "voiced": self.acoustics.voiced,
            },
        }


class VoiceProfiles:
    """Per-person acoustic baselines persisted in SQLite."""

    def __init__(self, state_dir: Path) -> None:
        self.db_path = state_dir / "voice_profiles.db"
        state_dir.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as c:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS profiles (
                    user_id TEXT PRIMARY KEY,
                    obs INTEGER NOT NULL DEFAULT 0,
                    f0 REAL NOT NULL DEFAULT 0,
                    register REAL NOT NULL DEFAULT 0,
                    brightness REAL NOT NULL DEFAULT 0,
                    jitter REAL NOT NULL DEFAULT 0,
                    energy REAL NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL,
                    last_used REAL NOT NULL
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS voice_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    ts REAL NOT NULL,
                    arousal REAL, valence REAL, tension REAL,
                    label TEXT, context TEXT, f0 REAL
                )
                """
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_vh_user ON voice_history(user_id)")

    def get(self, user_id: str) -> dict[str, Any] | None:
        with self._conn() as c:
            row = c.execute(
                "SELECT * FROM profiles WHERE user_id = ?", (user_id,)
            ).fetchone()
        return dict(row) if row else None

    def update(self, user_id: str, ac: Acoustics) -> dict[str, Any]:
        """Fold a new (voiced) observation into the person's baseline via EMA."""
        now = time.time()
        prof = self.get(user_id)
        if prof is None:
            with self._conn() as c:
                c.execute(
                    """
                    INSERT INTO profiles (user_id, obs, f0, register, brightness, jitter, energy, created_at, last_used)
                    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, ac.f0, ac.register, ac.brightness, ac.jitter, ac.energy, now, now),
                )
            return self.get(user_id) or {}

        a = BASELINE_ALPHA
        new = {
            "obs": prof["obs"] + 1,
            "f0": prof["f0"] * (1 - a) + ac.f0 * a,
            "register": prof["register"] * (1 - a) + ac.register * a,
            "brightness": prof["brightness"] * (1 - a) + ac.brightness * a,
            "jitter": prof["jitter"] * (1 - a) + ac.jitter * a,
            "energy": prof["energy"] * (1 - a) + ac.energy * a,
        }
        with self._conn() as c:
            c.execute(
                """
                UPDATE profiles
                SET obs = ?, f0 = ?, register = ?, brightness = ?, jitter = ?, energy = ?, last_used = ?
                WHERE user_id = ?
                """,
                (new["obs"], new["f0"], new["register"], new["brightness"],
                 new["jitter"], new["energy"], now, user_id),
            )
        return self.get(user_id) or {}

    def log_state(self, state: VoiceState) -> None:
        with self._conn() as c:
            c.execute(
                """
                INSERT INTO voice_history (user_id, ts, arousal, valence, tension, label, context, f0)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (state.user_id, time.time(), state.arousal, state.valence,
                 state.tension, state.label, state.context, state.acoustics.f0),
            )

    def history(self, user_id: str, *, limit: int = 10) -> list[dict[str, Any]]:
        with self._conn() as c:
            rows = c.execute(
                """
                SELECT ts, arousal, valence, tension, label, context, f0
                FROM voice_history WHERE user_id = ?
                ORDER BY ts DESC LIMIT ?
                """,
                (user_id, limit),
            ).fetchall()
        return [dict(r) for r in rows]


# --- context cues: light keyword layer over the dialogue text ----------------
_NEG_CUES = (
    "не могу", "опять", "бесит", "проблема", "ошибка", "плохо", "устал",
    "злюсь", "достало", "тревож", "страшно", "паника", "не работает",
)
_POS_CUES = (
    "круто", "класс", "отлично", "супер", "получилось", "спасибо",
    "рад", "люблю", "кайф", "красиво", "работает", "вектор",
)


def _context_bias(context: str) -> float:
    """Return valence bias in [-0.2, 0.2] from dialogue context keywords."""
    if not context:
        return 0.0
    low = context.lower()
    score = 0
    for cue in _NEG_CUES:
        if cue in low:
            score -= 1
    for cue in _POS_CUES:
        if cue in low:
            score += 1
    return _clamp(score * 0.07, -0.2, 0.2)


def analyze(
    user_id: str,
    payload: dict[str, Any],
    profiles: VoiceProfiles,
    *,
    context: str = "",
) -> VoiceState:
    """Core: acoustics + personal baseline + context -> human state.

    Rules (transparent):
      * arousal  ~ register + brightness + energy, lifted by personal F0 rise
      * tension  ~ jitter (tremor) + sustained high pitch + loudness spikes
      * valence  ~ moderate brightness & steadiness positive; tremor & very
                   high tense pitch negative; nudged by context keywords
    """
    ac = Acoustics.from_payload(payload)
    context = context or str(payload.get("context") or "")

    prof = profiles.get(user_id)
    obs = int(prof["obs"]) if prof else 0
    warming = obs < WARMUP_OBS

    # Deviation from the person's own normal (z-like, but bounded & simple).
    deviation: dict[str, float] = {}
    if prof and obs > 0:
        base_f0 = prof["f0"] or ac.f0 or 1.0
        deviation = {
            "f0": _clamp((ac.f0 - prof["f0"]) / max(40.0, base_f0 * 0.4), -1, 1),
            "brightness": _clamp(ac.brightness - prof["brightness"], -1, 1),
            "jitter": _clamp(ac.jitter - prof["jitter"], -1, 1),
            "energy": _clamp(ac.energy - prof["energy"], -1, 1),
        }

    if not ac.voiced:
        state = VoiceState(
            user_id=user_id, acoustics=ac, arousal=0.0, valence=0.5, tension=0.0,
            label="🔇 тишина / не голос", note="—", deviation=deviation,
            baseline_obs=obs, context=context,
        )
        return state

    # --- arousal ---
    arousal = 0.4 * ac.register + 0.3 * ac.brightness + 0.3 * ac.energy
    if not warming:
        # personal pitch rise is a strong arousal signal
        arousal += 0.35 * max(0.0, deviation.get("f0", 0.0))
        arousal += 0.15 * max(0.0, deviation.get("energy", 0.0))
    arousal = _clamp(arousal)

    # --- tension ---
    tension = 0.55 * ac.jitter + 0.25 * ac.register + 0.20 * ac.energy
    if not warming:
        tension += 0.3 * max(0.0, deviation.get("jitter", 0.0))
        tension += 0.2 * max(0.0, deviation.get("f0", 0.0))
    tension = _clamp(tension)

    # --- valence ---
    # steady, mid-bright, not-too-tense voice reads as positive
    valence = 0.5 + 0.25 * (ac.brightness - 0.5) - 0.4 * ac.jitter - 0.25 * (tension - 0.5)
    valence += _context_bias(context)
    valence = _clamp(valence)

    label = _label(arousal, valence, tension)

    return VoiceState(
        user_id=user_id, acoustics=ac, arousal=arousal, valence=valence,
        tension=tension, label=label, note=note_of(ac.f0),
        deviation=deviation, baseline_obs=obs, context=context,
    )


def _label(arousal: float, valence: float, tension: float) -> str:
    if tension > 0.66:
        return "😬 напряжённый, на взводе"
    if arousal > 0.66 and valence > 0.55:
        return "🤩 воодушевлён, энергичен"
    if arousal > 0.6 and valence <= 0.45:
        return "😤 взволнован, на эмоциях"
    if arousal < 0.35 and valence >= 0.5:
        return "😌 спокоен, расслаблен"
    if arousal < 0.35 and valence < 0.45:
        return "😔 тихий, подавленный"
    if valence > 0.6:
        return "🙂 ровный, позитивный"
    return "😐 нейтральный"


def process_voice_event(
    user_id: str,
    payload: dict[str, Any],
    profiles: VoiceProfiles,
    *,
    context: str = "",
    learn: bool = True,
) -> dict[str, Any]:
    """End-to-end: analyse, update the person's baseline, log history.

    Returns a JSON-ready dict for the mark17 bridge result.
    """
    state = analyze(user_id, payload, profiles, context=context)
    if learn and state.acoustics.voiced:
        profiles.update(user_id, state.acoustics)
        profiles.log_state(state)

    prof_after = profiles.get(user_id) or {}
    result = state.to_dict()
    result["baseline"] = {
        "obs": int(prof_after.get("obs", 0)),
        "f0": round(float(prof_after.get("f0", 0.0)), 1),
        "note": note_of(float(prof_after.get("f0", 0.0))),
        "warming_up": int(prof_after.get("obs", 0)) < WARMUP_OBS,
    }
    result["recent"] = profiles.history(user_id, limit=5)
    return result
