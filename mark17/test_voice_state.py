"""Standalone tests for voice_state (run: python3 mark17/test_voice_state.py).

No pytest / numpy required — pure stdlib so it works anywhere the core does.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.voice_state import VoiceProfiles, analyze, note_of, process_voice_event

CALM = {"acoustics": {"f0": 110, "register": 0.25, "brightness": 0.4,
                      "jitter": 0.05, "energy": 0.5, "voiced": True}}
AGITATED = {"acoustics": {"f0": 150, "register": 0.55, "brightness": 0.7,
                          "jitter": 0.35, "energy": 0.8, "voiced": True}}


def _fresh() -> VoiceProfiles:
    return VoiceProfiles(Path(tempfile.mkdtemp(prefix="vs-test-")))


def test_note_of():
    assert note_of(440) == "A4"
    assert note_of(0) == "—"


def test_unvoiced_is_silence():
    prof = _fresh()
    r = process_voice_event("x", {"acoustics": {"voiced": False}}, prof)
    assert r["arousal"] == 0.0
    assert "тишина" in r["label"]


def test_baseline_warms_up_then_personalises():
    prof = _fresh()
    # First reading: warming up.
    r0 = process_voice_event("miron", CALM, prof, context="ровный диалог")
    assert r0["baseline"]["warming_up"] is True
    # Feed enough calm readings to establish a baseline.
    for _ in range(10):
        r = process_voice_event("miron", CALM, prof, context="ровный диалог")
    assert r["baseline"]["warming_up"] is False
    assert 100 <= r["baseline"]["f0"] <= 120  # baseline tracks calm F0
    assert r["tension"] < 0.4


def test_personal_deviation_flags_tension():
    prof = _fresh()
    for _ in range(10):
        process_voice_event("miron", CALM, prof)
    r = process_voice_event("miron", AGITATED, prof, context="опять не работает, бесит")
    assert r["tension"] > 0.6
    assert r["arousal"] > 0.6
    assert r["valence"] < 0.45                 # negative context pulls valence down
    assert r["deviation"]["f0"] > 0.5          # big personal pitch rise


def test_same_acoustics_different_people():
    prof = _fresh()
    for _ in range(10):
        process_voice_event("miron", CALM, prof)  # miron's norm is low/steady
    miron = process_voice_event("miron", AGITATED, prof)
    anya = process_voice_event("anya", AGITATED, prof)  # no history yet
    # Same acoustics, but miron deviates from his calm norm => more tension.
    assert miron["tension"] >= anya["tension"]
    assert anya["baseline"]["warming_up"] is True


def test_remembers_history():
    prof = _fresh()
    process_voice_event("miron", CALM, prof, context="привет")
    process_voice_event("miron", AGITATED, prof, context="злюсь")
    hist = prof.history("miron", limit=5)
    assert len(hist) == 2
    assert hist[0]["context"] == "злюсь"       # most recent first


def _run() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run())
