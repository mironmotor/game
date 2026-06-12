#!/usr/bin/env python3
"""Offline smoke for music sense (Phase 9, Dreaming Music). No LLM, no network.

Feeds synthetic listening windows through the full pipeline and asserts: mood
classification, the КАЙФ score with novelty (a repeat is less novel), memory +
taste history, and the aggregated taste profile Dreaming Music composes from.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

os.environ["MAX17_GONKA_ENABLED"] = "false"

from mark17.json_cli import _as_event, _build_stores, _handle_event  # noqa: E402


def _fail(msg: str) -> None:
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    raise SystemExit(1)


def _args() -> argparse.Namespace:
    return argparse.Namespace(
        no_llm=True, warmup=None, plasticity_threshold=0.7,
        ollama_model="qwen2.5:0.5b", ollama_host="http://127.0.0.1:11434",
    )


DANCE = {"bpm": 126, "energy": 0.7, "bass": 0.6, "mid": 0.3, "treble": 0.1, "brightness": 0.55, "regularity": 0.7, "dynamics": 0.5, "key": "A", "minor_like": 0.6, "duration_sec": 20}
AMBIENT = {"bpm": 70, "energy": 0.25, "bass": 0.3, "mid": 0.4, "treble": 0.3, "brightness": 0.35, "regularity": 0.2, "dynamics": 0.2, "key": "D", "minor_like": 0.7, "duration_sec": 20}


def main() -> int:
    args = _args()
    with tempfile.TemporaryDirectory(prefix="max17-music-") as d:
        stores = _build_stores(args, Path(d))

        r1 = _handle_event(_as_event({"type": "music_observation", "music": DANCE}), args, stores)
        m1 = r1.get("music") or {}
        if m1.get("mood") != "танцевальный драйв":
            _fail(f"dance mood wrong: {m1.get('mood')}")
        if float(m1.get("novelty") or 0) < 0.9:
            _fail(f"first track must be novel: {m1.get('novelty')}")
        if not (r1.get("answer") or {}).get("text", "").startswith("Слушаю"):
            _fail("no listening answer")

        # Same track again — novelty must drop (Max recognizes the sound).
        r2 = _handle_event(_as_event({"type": "music_observation", "music": DANCE}), args, stores)
        m2 = r2.get("music") or {}
        if float(m2.get("novelty", 1.0)) > 0.2:
            _fail(f"repeat should not be novel: {m2.get('novelty')}")
        if float(m2.get("kaif") or 1) >= float(m1.get("kaif") or 0):
            _fail("kaif should drop on a repeat (novelty bonus gone)")

        r3 = _handle_event(_as_event({"type": "music_observation", "music": AMBIENT}), args, stores)
        m3 = r3.get("music") or {}
        if m3.get("mood") != "спокойный эмбиент":
            _fail(f"ambient mood wrong: {m3.get('mood')}")

        # Memory row exists (bridges feed off this).
        hits = stores.vector_memory.recall("трек танцевальный драйв кайф", limit=3)
        if not any(h.event_type == "music_observation" for h in hits):
            _fail(f"music not in vector memory: {[(h.event_type, h.summary[:40]) for h in hits]}")

        # Taste profile aggregates all three listens.
        rt = _handle_event(_as_event({"type": "music_taste"}), args, stores)
        taste = rt.get("music_taste") or {}
        if int(taste.get("tracks") or 0) != 3:
            _fail(f"taste should cover 3 tracks: {taste}")
        if not taste.get("avg_bpm") or not taste.get("fav_key"):
            _fail(f"taste profile incomplete: {taste}")

        out = {
            "ok": True,
            "dance": {"mood": m1["mood"], "kaif": m1["kaif"], "novelty": m1["novelty"]},
            "repeat": {"kaif": m2["kaif"], "novelty": m2["novelty"]},
            "ambient": {"mood": m3["mood"], "kaif": m3["kaif"]},
            "taste": {k: taste[k] for k in ("tracks", "avg_bpm", "fav_key", "mode", "avg_kaif")},
        }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
