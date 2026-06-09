"""Environment reasoning for Max17.

Turns a stream of camera frame-statistics observations into a small, persistent
"environment model". It compares the current frame to recent ones, detects
transitions (light up/down, motion appeared/stopped, scene changed), infers
whether the user is present, and accumulates short conclusions.

It is deterministic and intentionally modest: it does **not** do object/face
recognition and uploads no images. It reasons only over the local frame
statistics the HUD already computes (brightness, motion_score, scene_mode, …),
so it stays on the hot path with no extra database scans. The orchestrator is
responsible for persisting the rolling history and reinforcing the concept
associations this module proposes.
"""

from __future__ import annotations

from typing import Any

HISTORY_LIMIT = 8
BRIGHTNESS_STEP = 0.08
MOTION_STILL = {"still", "unknown", ""}
MOTION_ACTIVE = {"subtle", "moving"}

LIGHT_RU = {"low": "слабый", "medium": "средний", "high": "яркий", "unknown": "неизвестный"}
MOTION_RU = {
    "still": "почти неподвижно",
    "subtle": "лёгкое движение",
    "moving": "заметное движение",
    "unknown": "неизвестно",
}
SCENE_RU = {
    "dark": "темно",
    "bright": "светло",
    "active": "есть движение в кадре",
    "calm": "спокойно, движения почти нет",
    "unknown": "неизвестно",
}


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _camera_payload(event: Any) -> dict[str, Any]:
    payload = getattr(event, "payload", None)
    if not isinstance(payload, dict):
        return {}
    camera = payload.get("camera")
    return camera if isinstance(camera, dict) else payload


def extract_observation(event: Any) -> dict[str, Any]:
    """Pull a small, normalized frame snapshot out of a camera event."""

    camera = _camera_payload(event)
    vision = camera.get("vision_summary")
    vision = vision if isinstance(vision, dict) else {}
    active = camera.get("active")
    if active is None:
        active = True
    faces_raw = camera.get("faces")
    if faces_raw is None:
        faces_raw = vision.get("faces")
    # faces: int when the detector ran (0 = none seen), None when unavailable.
    faces = int(faces_raw) if isinstance(faces_raw, (int, float)) else None
    person_raw = camera.get("person")
    if person_raw is None:
        person_raw = vision.get("person")
    person = bool(person_raw) if isinstance(person_raw, bool) else None
    return {
        "active": bool(active),
        "brightness": round(_num(camera.get("brightness")), 3),
        "motion_score": round(_num(camera.get("motion_score")), 3),
        "stability": round(_num(camera.get("stability") or vision.get("stability")), 3),
        "light_level": str(camera.get("light_level") or vision.get("light_level") or "unknown"),
        "motion_level": str(camera.get("motion_level") or vision.get("motion_level") or "unknown"),
        "scene_mode": str(camera.get("scene_mode") or vision.get("scene_mode") or "unknown"),
        "dominant_tone": str(camera.get("dominant_tone") or "unknown"),
        "faces": faces,
        "person": person,
        "face_coverage": round(_num(camera.get("face_coverage") or vision.get("face_coverage")), 3),
    }


def _presence(motion_level: str, scene_mode: str) -> str:
    if motion_level in MOTION_ACTIVE:
        return "present"
    if scene_mode == "dark" and motion_level in MOTION_STILL:
        return "away"
    return "uncertain"


def _stable_streak(history: list[dict[str, Any]], scene_mode: str) -> int:
    streak = 1
    for past in reversed(history):
        if isinstance(past, dict) and str(past.get("scene_mode")) == scene_mode:
            streak += 1
        else:
            break
    return streak


def analyze_environment(
    observation: dict[str, Any],
    history: list[dict[str, Any]] | None,
    *,
    limit: int = HISTORY_LIMIT,
) -> dict[str, Any]:
    """Reason about the current frame in the context of recent ones."""

    history = [h for h in (history or []) if isinstance(h, dict)][-limit:]
    prev = history[-1] if history else None

    if not observation.get("active", True):
        return {
            "state": {"active": False, "presence": "away"},
            "transitions": [],
            "conclusions": ["Камера выключена — я перестал наблюдать за средой."],
            "presence": "away",
            "observations_count": len(history),
            "associations": [],
            "confidence": 0.3,
            "source": "environment_v0",
        }

    scene = str(observation.get("scene_mode") or "unknown")
    light = str(observation.get("light_level") or "unknown")
    motion = str(observation.get("motion_level") or "unknown")
    brightness = _num(observation.get("brightness"))

    transitions: list[dict[str, Any]] = []
    conclusions: list[str] = []

    presence = _presence(motion, scene)

    if prev:
        prev_motion = str(prev.get("motion_level") or "unknown")
        prev_scene = str(prev.get("scene_mode") or "unknown")
        prev_brightness = _num(prev.get("brightness"))

        delta = brightness - prev_brightness
        if abs(delta) >= BRIGHTNESS_STEP:
            direction = "светлее" if delta > 0 else "темнее"
            transitions.append({"kind": "light", "direction": direction, "delta": round(delta, 3)})
            conclusions.append(f"Стало {direction}, чем в прошлом кадре (на {abs(round(delta * 100))}%).")

        if prev_motion in MOTION_STILL and motion in MOTION_ACTIVE:
            transitions.append({"kind": "motion", "direction": "appeared"})
            conclusions.append("Появилось движение — похоже, ты вернулся или рядом.")
            presence = "present"
        elif prev_motion in MOTION_ACTIVE and motion in MOTION_STILL:
            transitions.append({"kind": "motion", "direction": "stopped"})
            conclusions.append("Движение стихло — возможно, ты отошёл или замер.")

        if prev_scene != scene:
            transitions.append({"kind": "scene", "from": prev_scene, "to": scene})
            conclusions.append(
                f"Сцена сменилась: {SCENE_RU.get(prev_scene, prev_scene)} → {SCENE_RU.get(scene, scene)}."
            )

    streak = _stable_streak(history, scene)
    if streak >= 3 and not transitions:
        conclusions.append(
            f"Среда устойчива: {SCENE_RU.get(scene, scene)} держится уже {streak} наблюдений подряд."
        )

    if not conclusions:
        conclusions.append(
            f"Среда стабильна: {SCENE_RU.get(scene, scene)}, свет {LIGHT_RU.get(light, light)}, {MOTION_RU.get(motion, motion)}."
        )

    # Concept associations to reinforce — this is the "learning" signal the
    # orchestrator writes into the SynapseGraph.
    weight = round(min(0.9, 0.45 + 0.05 * min(len(history), 6)), 4)
    associations = [
        {"from": "environment", "to": "vision", "relation": "activates", "weight": weight},
        {"from": "vision", "to": "memory", "relation": "leads_to", "weight": weight},
    ]
    if presence == "present":
        associations.append({"from": "environment", "to": "agency", "relation": "related_to", "weight": weight})
    if scene == "desk":
        associations.append({"from": "environment", "to": "performance", "relation": "related_to", "weight": weight})

    confidence = round(min(0.85, 0.4 + 0.05 * len(history) + (0.1 if transitions else 0.0)), 4)

    return {
        "state": {
            "active": True,
            "scene_mode": scene,
            "light_level": light,
            "motion_level": motion,
            "brightness": round(brightness, 3),
            "stability": round(_num(observation.get("stability")), 3),
            "dominant_tone": str(observation.get("dominant_tone") or "unknown"),
            "presence": presence,
            "stable_streak": streak,
        },
        "transitions": transitions,
        "conclusions": conclusions,
        "presence": presence,
        "observations_count": len(history) + 1,
        "associations": associations,
        "confidence": confidence,
        "source": "environment_v0",
    }
