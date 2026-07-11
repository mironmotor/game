#!/usr/bin/env python3
"""Smoke checks for HeartSignal -> internal dream integration."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
JSON_CLI = ROOT / "mark17" / "json_cli.py"


def _run(event: dict[str, Any]) -> dict[str, Any]:
    proc = subprocess.run(
        [sys.executable, str(JSON_CLI), "--no-llm", "--ephemeral"],
        cwd=ROOT,
        input=json.dumps(event, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"json_cli failed:\n{proc.stdout}\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    guided = _run(
        {
            "type": "internal_dream",
            "limit": 3,
            "heart_signal": {
                "schema_version": 1,
                "signal_id": "heart:test-guided",
                "tone": "боль/усталость",
                "concern": "dark",
                "needs": ["rest", "presence", "gentle_pace"],
                "care_themes": ["health", "bond", "creator_work"],
                "intensity": 0.78,
                "redacted": True,
            },
        }
    )
    _assert(guided.get("route") == "internal_dream", "guided dream should route")
    dream = guided.get("dream")
    _assert(isinstance(dream, dict), "guided dream should expose dream")
    synergies = dream.get("synergies")
    _assert(isinstance(synergies, list) and synergies, "guided dream should create synergies")
    _assert(any(bool(s.get("heart_guided")) for s in synergies if isinstance(s, dict)), "heart should guide at least one synergy")
    influence = guided.get("heart_influence")
    _assert(isinstance(influence, dict) and influence.get("active"), "heart influence should be exposed")
    explain = guided.get("explain")
    _assert(isinstance(explain, dict) and explain.get("nodes"), "guided dream should expose explain graph")

    proposal_only = _run(
        {
            "type": "internal_dream",
            "limit": 2,
            "persist": False,
            "heart_signal": {
                "schema_version": 1,
                "signal_id": "heart:test-proposal",
                "tone": "тревога",
                "concern": "none",
                "needs": ["grounding", "clarity", "small_step"],
                "care_themes": ["reality_contact", "planning", "action"],
                "intensity": 0.55,
                "redacted": True,
            },
        }
    )
    _assert(proposal_only.get("dream_persistence") == "proposal_only", "persist=false should be proposal-only")
    _assert((proposal_only.get("memory") or {}).get("dream_synergies_stored") == 0, "proposal-only should not store")
    _assert((proposal_only.get("memory") or {}).get("dream_synergies_proposed", 0) >= 1, "proposal-only should still propose")

    blocked = _run(
        {
            "type": "internal_dream",
            "limit": 3,
            "heart_signal": {
                "schema_version": 1,
                "signal_id": "heart:test-crisis",
                "tone": "боль/усталость",
                "concern": "crisis",
                "needs": ["safety", "human_help", "rest"],
                "care_themes": ["life_safety", "living_connections", "health"],
                "intensity": 1.0,
                "redacted": True,
            },
        }
    )
    blocked_dream = blocked.get("dream")
    _assert(isinstance(blocked_dream, dict) and blocked_dream.get("blocked") is True, "crisis should block dreaming")
    _assert((blocked.get("memory") or {}).get("dream_synergies_stored") == 0, "crisis should not store dream synergies")
    _assert((blocked.get("plasticity") or {}).get("learned") is False, "crisis should not mark dream learned")

    print(
        json.dumps(
            {
                "ok": True,
                "cases": [
                    {
                        "name": "heart_guided_dream",
                        "top": str(synergies[0].get("title") or ""),
                        "stored": (guided.get("memory") or {}).get("dream_synergies_stored"),
                    },
                    {
                        "name": "heart_dream_proposal_only",
                        "proposed": (proposal_only.get("memory") or {}).get("dream_synergies_proposed"),
                        "stored": (proposal_only.get("memory") or {}).get("dream_synergies_stored"),
                    },
                    {
                        "name": "heart_crisis_blocks_dream",
                        "stored": (blocked.get("memory") or {}).get("dream_synergies_stored"),
                    },
                ],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
