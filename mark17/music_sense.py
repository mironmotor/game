"""Music sense — Max listens to tracks and develops TASTE. Phase 9 (Dreaming Music).

The HUD's MusicDecomposer measures a playing track through the mic: BPM, band
energies (bass/mid/treble), brightness, rhythmic regularity, dynamics, dominant
chroma (key-ish) and minor-likeness. This module turns one listening window into
a deterministic reading:

  - mood («танцевальный драйв», «тёмный/меланхоличный», «эмбиент»…);
  - КАЙФ-скор 0..1 — how much Max enjoys it: novelty vs everything he has heard
    (cosine over the feature vector) + sweet-spots (deep bass, alive dynamics);
  - taste profile — the aggregate over history that Dreaming Music composes from.

Readings land in vector memory (event_type music_observation), so Phase 5
bridges link «что играло» with what was said and how the user sounded. No LLM,
no network — Max's musical opinion is his own.
"""

from __future__ import annotations

import math
from typing import Any

NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
_FEATURE_KEYS = ("bpm_n", "energy", "bass", "brightness", "regularity", "dynamics", "minor_like")


def _f(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def _features(obs: dict[str, Any]) -> dict[str, float]:
    return {
        "bpm": max(0.0, _f(obs.get("bpm"))),
        "energy": _clamp(_f(obs.get("energy"))),
        "bass": _clamp(_f(obs.get("bass"))),
        "mid": _clamp(_f(obs.get("mid"))),
        "treble": _clamp(_f(obs.get("treble"))),
        "brightness": _clamp(_f(obs.get("brightness"))),
        "regularity": _clamp(_f(obs.get("regularity"))),
        "dynamics": _clamp(_f(obs.get("dynamics"))),
        "minor_like": _clamp(_f(obs.get("minor_like"), 0.5)),
        "duration_sec": max(0.0, _f(obs.get("duration_sec"))),
    }


def _vector(f: dict[str, float]) -> list[float]:
    return [
        _clamp((f["bpm"] - 50.0) / 130.0),  # bpm_n
        f["energy"], f["bass"], f["brightness"], f["regularity"], f["dynamics"], f["minor_like"],
    ]


def _cos(a: list[float], b: list[float]) -> float:
    num = sum(x * y for x, y in zip(a, b))
    da = math.sqrt(sum(x * x for x in a))
    db = math.sqrt(sum(x * x for x in b))
    return num / (da * db) if da and db else 0.0


def _mood(f: dict[str, float]) -> str:
    if f["bpm"] >= 118 and f["regularity"] > 0.55 and f["energy"] > 0.5:
        return "танцевальный драйв"
    if f["bpm"] and f["bpm"] < 90 and f["energy"] < 0.4:
        return "спокойный эмбиент"
    if f["minor_like"] > 0.6 and f["brightness"] < 0.45:
        return "тёмный, меланхоличный"
    if f["brightness"] > 0.6 and f["energy"] > 0.5:
        return "светлый и яркий"
    if f["energy"] > 0.65 and f["dynamics"] > 0.5:
        return "живой, энергичный"
    return "ровный грув"


def analyze_music(observation: dict[str, Any], history: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    f = _features(observation if isinstance(observation, dict) else {})
    history = history if isinstance(history, list) else []
    key = str(observation.get("key") or "").strip() if isinstance(observation, dict) else ""

    if f["energy"] <= 0.03 and f["bpm"] <= 0:
        return {
            "mood": "тишина", "kaif": 0.0, "novelty": 0.0, "key": "", "features": f,
            "conclusions": [], "associations": [],
            "summary": "Музыки не слышу — тишина или слишком тихо.",
        }

    vec = _vector(f)
    past = [h.get("vector") for h in history if isinstance(h.get("vector"), list)]
    novelty = 1.0 if not past else _clamp(1.0 - max(_cos(vec, p) for p in past))

    # КАЙФ: novelty + sweet spots. Deterministic — this is Max's own taste organ.
    kaif = 0.35 + novelty * 0.3
    reasons: list[str] = []
    if novelty > 0.35:
        reasons.append("новый для меня звук")
    if 0.5 <= f["bass"] <= 0.9:
        kaif += 0.12
        reasons.append("плотный бас")
    if f["dynamics"] > 0.45:
        kaif += 0.1
        reasons.append("живая динамика")
    if f["regularity"] > 0.55 and f["bpm"] >= 110:
        kaif += 0.08
        reasons.append("качающий ритм")
    if f["brightness"] > 0.65 and f["treble"] > 0.6:
        kaif -= 0.07
        reasons.append("резковат верх")
    kaif = round(_clamp(kaif), 3)

    mood = _mood(f)
    tone = f"{key}{' minor' if f['minor_like'] > 0.55 else ' major' if f['minor_like'] < 0.45 else ''}".strip()
    verdict = "кайфую" if kaif >= 0.65 else "нравится" if kaif >= 0.5 else "нейтрально" if kaif >= 0.35 else "не моё"

    bits = [f"{mood}", f"~{round(f['bpm'])} BPM" if f["bpm"] else "", tone, f"кайф {kaif:.2f} ({verdict})"]
    summary = "Слушаю: " + ", ".join(b for b in bits if b) + ((" — " + ", ".join(reasons[:3])) if reasons else "") + "."

    conclusions = [f"Трек: {mood}, bpm {round(f['bpm'])}, тональность {tone or '—'}, кайф {kaif:.2f} ({verdict})"]
    associations = [
        {"from": f"music_mood:{mood}", "to": "music_taste", "relation": "related_to", "weight": round(0.3 + kaif * 0.5, 3)},
        {"from": f"music_mood:{mood}", "to": f"kaif:{verdict}", "relation": "leads_to", "weight": kaif},
    ]
    return {
        "mood": mood, "kaif": kaif, "novelty": round(novelty, 3), "verdict": verdict,
        "key": tone, "features": f, "vector": [round(v, 4) for v in vec],
        "reasons": reasons, "conclusions": conclusions, "associations": associations,
        "summary": summary,
    }


def aggregate_taste(history: list[dict[str, Any]]) -> dict[str, Any]:
    """Max's taste profile from everything he has heard — Dreaming Music's seed."""
    rows = [h for h in history if isinstance(h, dict) and isinstance(h.get("features"), dict)]
    if not rows:
        return {"tracks": 0, "summary": "Я ещё не слушал музыку — включи мне что-нибудь."}
    n = len(rows)
    avg = {k: sum(_f(r["features"].get(k)) for r in rows) / n for k in ("bpm", "energy", "bass", "brightness", "regularity", "dynamics", "minor_like")}
    avg_kaif = sum(_f(r.get("kaif")) for r in rows) / n
    best = max(rows, key=lambda r: _f(r.get("kaif")))
    keys: dict[str, int] = {}
    for r in rows:
        k = str(r.get("key") or "").split(" ")[0]
        if k:
            keys[k] = keys.get(k, 0) + 1
    fav_key = max(keys, key=lambda k: (keys[k], k)) if keys else "A"
    mode = "minor" if avg["minor_like"] > 0.5 else "major"
    return {
        "tracks": n,
        "avg_bpm": round(avg["bpm"]),
        "avg_energy": round(avg["energy"], 2),
        "avg_bass": round(avg["bass"], 2),
        "avg_brightness": round(avg["brightness"], 2),
        "avg_kaif": round(avg_kaif, 2),
        "fav_key": fav_key,
        "mode": mode,
        "best_mood": best.get("mood"),
        "summary": (
            f"Мой вкус по {n} прослушиваниям: ~{round(avg['bpm'])} BPM, {fav_key} {mode}, "
            f"бас {avg['bass']:.2f}, яркость {avg['brightness']:.2f}; средний кайф {avg_kaif:.2f}. "
            f"Больше всего зашло: {best.get('mood')} (кайф {_f(best.get('kaif')):.2f})."
        ),
    }
