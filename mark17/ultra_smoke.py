#!/usr/bin/env python3
"""Offline smoke for the Ultra orchestrator (Phase 8). No LLM, no network.

Proves the agency loop works deterministically without the LLM: state snapshot →
fallback-policy decision → execution from the safe menu → the decision recorded
to memory (so the NEXT think sees it).
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
os.environ.pop("MAX17_AUTO_WEB", None)

from mark17.json_cli import _as_event, _build_stores, _handle_event  # noqa: E402
from mark17.ultra_orchestrator import ALLOWED_ACTIONS  # noqa: E402


def _fail(msg: str) -> None:
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    raise SystemExit(1)


def _args() -> argparse.Namespace:
    return argparse.Namespace(
        no_llm=True, warmup=None, plasticity_threshold=0.7,
        ollama_model="qwen2.5:0.5b", ollama_host="http://127.0.0.1:11434",
    )


def main() -> int:
    args = _args()
    with tempfile.TemporaryDirectory(prefix="max17-ultra-") as d:
        stores = _build_stores(args, Path(d))
        # Seed some speech so compile/consolidate have material.
        for text in (
            "Марина моя подруга, у неё сын Матвей и ей нужна поддержка",
            "развиваем ядро Max17, семантическую память и мосты",
        ):
            _handle_event(_as_event({"type": "user_message", "text": text}), args, stores)

        # Think #1: deterministic policy must pick a valid action and execute it.
        r1 = _handle_event(_as_event({"type": "ultra_think"}), args, stores)
        u1 = r1.get("ultra") or {}
        d1 = u1.get("decision") or {}
        if d1.get("action") not in ALLOWED_ACTIONS:
            _fail(f"invalid action: {d1}")
        if d1.get("decider") != "policy":
            _fail(f"expected fallback policy decider, got {d1.get('decider')}")
        if not (r1.get("answer") or {}).get("text", "").startswith("Ультра"):
            _fail(f"no ultra answer: {r1.get('answer')}")
        if "executed" not in u1:
            _fail("nothing executed")

        # Конституция v1.77 обязана быть в снимке состояния исполнителя…
        ult = (u1.get("state") or {}).get("ultimate") or {}
        if ult.get("version") != "max_ultra_v1.77":
            _fail(f"ultimate version not in state: {ult.get('version')}")
        if int(ult.get("target_synapses") or 0) != 1_000_000:
            _fail(f"ultimate target wrong: {ult.get('target_synapses')}")
        for key in ("principles", "constraints", "clusters", "life_game_domains", "knowledge_pack_strategy", "roadmap", "progress"):
            if key not in ult:
                _fail(f"ultimate state missing {key}")
        # …and the decision must declare which constitution it acted under.
        con = u1.get("constitution") or {}
        if con.get("version") != "max_ultra_v1.77":
            _fail(f"constitution version missing: {con}")
        if not con.get("applied_constraints"):
            _fail("no applied_constraints on the decision")

        # The decision must be remembered…
        # include_plumbing=True обязателен: ultra_decision входит в PLUMBING_TYPES и
        # из обычной выдачи исключён намеренно. Тест проверяет, что решение ЗАПИСАНО,
        # а не что оно всплывает в ответах пользователю.
        hits = stores.vector_memory.recall(
            "ultra decision решение оркестратора", limit=2, include_plumbing=True
        )
        if not hits or hits[0].event_type != "ultra_decision":
            _fail(f"decision not recorded: {[(h.event_type, h.summary[:40]) for h in hits]}")

        # …and think #2 must SEE the previous decision in its state snapshot.
        r2 = _handle_event(_as_event({"type": "ultra_think"}), args, stores)
        s2 = (r2.get("ultra") or {}).get("state") or {}
        if "last_decision" not in s2:
            _fail(f"second think does not see the last decision: {list(s2)}")

        out = {
            "ok": True,
            "think1": {"action": d1.get("action"), "reason": d1.get("reason"), "decider": d1.get("decider")},
            "think2": {"action": ((r2.get("ultra") or {}).get("decision") or {}).get("action"), "saw_last": True},
            "ultimate_version": ult.get("version"),
            "target_synapses": ult.get("target_synapses"),
            "applied_constraints": con.get("applied_constraints"),
        }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
