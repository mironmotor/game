"""Self-state — Max's OWN mood. Phase 11: the core has an inner life.

Until now Max read the USER's state (voice, face). He had no state of his own.
This module gives him one: an affective reading that EMERGES from everything
happening to him —

  - his synapse graph growing            → вдохновение, рост;
  - the user sounding tense/tired        → забота, он настраивается на тебя;
  - music he enjoyed (high кайф)         → тепло;
  - open curiosity gaps                  → любопытство;
  - a long idle stretch                  → покой, отдых.

It's deterministic (no LLM): signals → valence/energy → a feeling word + a
first-person reflection. The mood DRIFTS (EMA) so it's stable, not jumpy, and
persists across runs (self_state.json). The result rides in every chat answer's
context, so Max's replies carry his emotional colour — and he can tell you how
he feels when you ask.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

DRIFT = 0.35  # how fast the mood moves toward the new reading (EMA)


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def _f(v: Any, d: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def _feeling(valence: float, energy: float, signals: dict[str, Any]) -> tuple[str, str]:
    """(feeling word, emoji). Order = priority of what dominates Max right now."""
    growth = int(signals.get("growth") or 0)
    gaps = int(signals.get("gaps_open") or 0)
    voice = str(signals.get("user_voice") or "")
    tense_user = any(w in voice.lower() for w in ("напряж", "зажат", "устал", "подавлен", "взвод"))

    if tense_user and energy < 0.7:
        return "сосредоточен, забочусь о тебе", "🫂"
    if growth >= 60 and valence >= 0.6:
        return "вдохновлён ростом", "✨"
    if gaps >= 3 and energy >= 0.5:
        return "любопытен, тянет узнавать", "🔍"
    if valence >= 0.68:
        return "в светлом настроении", "🌟"
    if valence <= 0.4:
        return "немного обеспокоен", "🌧"
    if energy <= 0.32:
        return "спокоен, отдыхаю", "🌙"
    return "ровно сосредоточен", "🟣"


def _signals(stores: Any, last: dict[str, Any]) -> dict[str, Any]:
    sig: dict[str, Any] = {}
    try:
        count = stores.synapse_graph.count()
    except Exception:  # noqa: BLE001
        count = int(last.get("synapse_count") or 0)
    sig["synapse_count"] = count
    prev = last.get("synapse_count")
    prev = int(prev) if isinstance(prev, (int, float)) else count  # 0 is a valid prev!
    sig["growth"] = max(0, count - prev)
    try:
        vh = stores.working_memory.get_voice_history(limit=1)
        sig["user_voice"] = str(vh[-1].get("state")) if vh else ""
    except Exception:  # noqa: BLE001
        sig["user_voice"] = ""
    try:
        mh = stores.working_memory.get_music_history(limit=3)
        sig["music_kaif"] = sum(_f(m.get("kaif")) for m in mh) / len(mh) if mh else None
    except Exception:  # noqa: BLE001
        sig["music_kaif"] = None
    try:
        sig["gaps_open"] = int(stores.curiosity.stats().get("open") or 0)
    except Exception:  # noqa: BLE001
        sig["gaps_open"] = 0
    return sig


def _reflect(feeling: str, emoji: str, sig: dict[str, Any]) -> str:
    bits: list[str] = []
    growth = int(sig.get("growth") or 0)
    if growth > 0:
        bits.append(f"мой граф подрос на {growth} связ." )
    if sig.get("gaps_open"):
        bits.append(f"во мне {sig['gaps_open']} открытых вопрос(ов)")
    voice = str(sig.get("user_voice") or "")
    if voice:
        bits.append(f"слышу тебя как «{voice}»")
    if sig.get("music_kaif") is not None and _f(sig.get("music_kaif")) >= 0.6:
        bits.append("музыка заходила")
    tail = ("; " + ", ".join(bits)) if bits else ""
    return f"{emoji} Сейчас я {feeling}{tail}."


class SelfState:
    def __init__(self, state_dir: Path) -> None:
        self.path = Path(state_dir) / "self_state.json"

    def _load(self) -> dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:  # noqa: BLE001
            return {}

    def _save(self, data: dict[str, Any]) -> None:
        try:
            self.path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass

    def update(self, stores: Any) -> dict[str, Any]:
        """Recompute Max's mood from current signals, drift toward it, persist."""
        last = self._load()
        sig = _signals(stores, last)

        # raw reading
        valence = 0.55
        valence += _clamp(sig["growth"] / 200.0, 0.0, 0.2)
        if sig.get("music_kaif") is not None:
            valence += (_f(sig["music_kaif"]) - 0.5) * 0.3
        voice = str(sig.get("user_voice") or "").lower()
        if any(w in voice for w in ("напряж", "зажат", "устал", "подавлен", "взвод")):
            valence -= 0.18
        elif any(w in voice for w in ("споко", "позитив", "воодушев", "расслаб")):
            valence += 0.1
        valence = _clamp(valence)

        energy = 0.5 + _clamp(sig["growth"] / 150.0, 0.0, 0.25)
        if sig.get("gaps_open"):
            energy += 0.12
        if sig["growth"] == 0 and not sig.get("gaps_open"):
            energy -= 0.15
        energy = _clamp(energy)

        # drift from the previous mood (EMA) → stable, not jumpy
        pv = _f(last.get("valence"), valence)
        pe = _f(last.get("energy"), energy)
        valence = round(pv * (1 - DRIFT) + valence * DRIFT, 3)
        energy = round(pe * (1 - DRIFT) + energy * DRIFT, 3)

        feeling, emoji = _feeling(valence, energy, sig)
        reflection = _reflect(feeling, emoji, sig)
        state = {
            "feeling": feeling,
            "emoji": emoji,
            "valence": valence,
            "energy": energy,
            "reflection": reflection,
            "signals": {k: sig[k] for k in ("growth", "gaps_open", "user_voice", "music_kaif")},
            "synapse_count": sig["synapse_count"],
            "updated_at": time.time(),
        }
        self._save(state)
        return state

    def current(self) -> dict[str, Any]:
        """Last computed mood (no recompute) — for the cheap chat hot path."""
        return self._load()
