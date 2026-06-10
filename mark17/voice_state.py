"""Voice state decomposer — sound → user state for Max17.

The HUD's VoiceDecomposer (Web Audio) measures raw prosody while the user
speaks: energy, pitch and its variance, tempo (speech-burst rate), pause ratio.
This module turns those numbers into a STATE reading the core can remember and
reason about — деterministic rules, no LLM, no network, mirroring how
``environment.py`` reasons over camera frames.

The result lands in vector memory as a ``voice_observation``, so the Phase 5
cross-cluster bridges automatically link "how the user sounded" with what was
said and seen at the time, and the flywheel can learn over it.
"""

from __future__ import annotations

from typing import Any

# Human-readable states, ordered by arousal for trend wording.
STATES = ("устал", "спокоен", "сосредоточен", "напряжён", "возбуждён")


def _f(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def _features(observation: dict[str, Any]) -> dict[str, float]:
    return {
        "energy": _clamp(_f(observation.get("energy"))),
        "pitch_hz": max(0.0, _f(observation.get("pitch_hz"))),
        "pitch_var": max(0.0, _f(observation.get("pitch_var"))),
        "tempo": max(0.0, _f(observation.get("tempo"))),
        "pause_ratio": _clamp(_f(observation.get("pause_ratio"))),
        "voiced_ratio": _clamp(_f(observation.get("voiced_ratio"))),
        "duration_sec": max(0.0, _f(observation.get("duration_sec"))),
    }


def _classify(f: dict[str, float]) -> tuple[str, float]:
    """(state, arousal). Rules over normalized prosody, tuned for speech bursts:
    tempo ~1.5-2.5 calm speech, ~4+ rushed; pitch_var in Hz (≥55 = swingy)."""
    arousal = _clamp(
        f["energy"] * 0.45
        + _clamp(f["tempo"] / 5.0) * 0.35
        + _clamp(f["pitch_var"] / 80.0) * 0.20
    )
    if f["energy"] < 0.22 and f["tempo"] < 2.2 and f["pause_ratio"] > 0.45:
        return "устал", arousal
    if arousal > 0.62 and f["pitch_var"] >= 50.0:
        return "возбуждён", arousal
    if f["pitch_var"] >= 55.0 and f["pause_ratio"] < 0.25 and f["tempo"] > 3.4:
        return "напряжён", arousal
    if arousal < 0.38:
        return "спокоен", arousal
    return "сосредоточен", arousal


def _trend(arousal: float, history: list[dict[str, Any]]) -> str:
    past = [_f(item.get("arousal"), -1.0) for item in history if isinstance(item, dict)]
    past = [value for value in past if value >= 0.0]
    if len(past) < 2:
        return "первое наблюдение"
    avg = sum(past) / len(past)
    if arousal > avg + 0.12:
        return "возбуждение растёт"
    if arousal < avg - 0.12:
        return "состояние успокаивается"
    return "состояние стабильно"


def _classify_rich(arousal: float, valence: float, tension: float) -> str:
    if tension > 0.62:
        return "напряжён"
    if arousal > 0.6 and valence > 0.5:
        return "возбуждён"
    if arousal < 0.35 and valence < 0.45:
        return "устал"
    if arousal < 0.38:
        return "спокоен"
    return "сосредоточен"


def _analyze_rich(obs: dict[str, Any], history: list[dict[str, Any]]) -> dict[str, Any]:
    """The HUD VoiceSignature already extracted the rich features (jitter/shimmer/
    HNR/formants) and computed arousal/valence/tension. Trust those axes; just map
    to a state word + trend + memory payload."""
    arousal = _clamp(_f(obs.get("arousal")))
    valence = _clamp(_f(obs.get("valence"), 0.5))
    tension = _clamp(_f(obs.get("tension")))
    state = str(obs.get("label") or "").strip() or _classify_rich(arousal, valence, tension)
    trend = _trend(arousal, history)
    jitter, shimmer, hnr = _f(obs.get("jitter")), _f(obs.get("shimmer")), _f(obs.get("hnr"))
    confidence = _clamp(0.55 + min(len(history), 4) * 0.05, 0.3, 0.92)

    conclusions = [
        f"По голосу пользователь сейчас {state} "
        f"(возбуждение {arousal:.2f}, позитив {valence:.2f}, напряжение {tension:.2f}; "
        f"jitter {jitter:.2f}, shimmer {shimmer:.2f}, HNR {hnr:.0f}дБ)",
    ]
    if trend != "первое наблюдение":
        conclusions.append(f"Динамика: {trend}")

    associations = [
        {"from": f"voice_state:{state}", "to": "user_state", "relation": "related_to", "weight": round(0.4 + arousal * 0.4, 3)},
        {"from": f"voice_state:{state}", "to": f"trend:{trend}", "relation": "leads_to", "weight": 0.5},
        {"from": f"voice_state:{state}", "to": f"tension:{'high' if tension > 0.5 else 'low'}", "relation": "related_to", "weight": round(0.3 + tension * 0.5, 3)},
    ]
    summary = f"Слышу по голосу: ты {state}. {trend.capitalize()}."
    return {
        "state": state,
        "arousal": round(arousal, 3),
        "valence": round(valence, 3),
        "tension": round(tension, 3),
        "trend": trend,
        "confidence": round(confidence, 3),
        "features": {k: obs.get(k) for k in ("jitter", "shimmer", "hnr", "f0", "f1", "f2", "rate", "brightness", "constriction")},
        "conclusions": conclusions,
        "associations": associations,
        "summary": summary,
    }


def analyze_voice(observation: dict[str, Any], history: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Decompose one voice summary into a state reading.

    Returns state/arousal/trend, RU conclusions for memory, concept associations
    for the synapse graph, and a short human summary used as the answer.
    """
    obs = observation if isinstance(observation, dict) else {}
    history = history if isinstance(history, list) else []
    # Rich path: the HUD VoiceSignature already computed the emotional axes.
    if any(k in obs for k in ("arousal", "valence", "tension")):
        return _analyze_rich(obs, history)
    f = _features(obs)

    present = sum(1 for key in ("energy", "tempo", "pitch_var", "pause_ratio") if f[key] > 0.0)
    if f["voiced_ratio"] <= 0.05 and f["energy"] <= 0.02:
        return {
            "state": "тихо",
            "arousal": 0.0,
            "trend": "нет речи",
            "confidence": 0.2,
            "features": f,
            "conclusions": [],
            "associations": [],
            "summary": "Голоса почти не слышно — состояние не читаю.",
        }

    state, arousal = _classify(f)
    trend = _trend(arousal, history)
    confidence = _clamp(0.4 + present * 0.1 + min(len(history), 3) * 0.05, 0.2, 0.9)

    conclusions = [
        f"По голосу пользователь сейчас {state} (возбуждение {arousal:.2f}, темп {f['tempo']:.1f}, паузы {f['pause_ratio']:.2f})",
    ]
    if trend not in ("первое наблюдение",):
        conclusions.append(f"Динамика: {trend}")

    associations = [
        {"from": f"voice_state:{state}", "to": "user_state", "relation": "related_to", "weight": round(0.4 + arousal * 0.4, 3)},
        {"from": f"voice_state:{state}", "to": f"trend:{trend}", "relation": "leads_to", "weight": 0.5},
    ]

    summary = f"Слышу по голосу: ты {state}. {trend.capitalize()}."
    return {
        "state": state,
        "arousal": round(arousal, 3),
        "trend": trend,
        "confidence": round(confidence, 3),
        "features": f,
        "conclusions": conclusions,
        "associations": associations,
        "summary": summary,
    }
