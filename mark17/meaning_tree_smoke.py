#!/usr/bin/env python3
"""Offline smoke for the Merkle meaning tree (Phase 7). No LLM, no network.

Proves the crypto-borrowed properties hold:
  1. determinism: same memories ⇒ bit-identical root hash;
  2. Merkle property: ANY new meaning changes the root hash;
  3. one-take: root + cluster conspects are compact and readable;
  4. descend: a branch opens into its leaves.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

os.environ["MAX17_GONKA_ENABLED"] = "false"

from mark17.events import Event  # noqa: E402
from mark17.meaning_tree import MeaningTree  # noqa: E402
from mark17.vector_memory import VectorMemory  # noqa: E402


def _fail(msg: str) -> None:
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    raise SystemExit(1)


TEXTS = [
    ("user_message", "Марина моя подруга, у неё сын Матвей"),
    ("user_message", "Марина устала от неудачных отношений"),
    ("terminal_error", "ModuleNotFoundError no module named torch"),
    ("terminal_error", "SyntaxError unexpected token in app.py"),
    ("environment_observation", "камера активна, свет низкий, движение в комнате"),
    ("environment_observation", "камера: яркая комната, движения нет"),
    ("user_message", "развиваем ядро Max17 и синапс-граф"),
    ("user_message", "ядро растёт, память консолидируется"),
]


def _fill(vm: VectorMemory) -> None:
    for et, text in TEXTS:
        vm.remember(Event(type=et, payload={"text": text}))


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="max17-tree-a-") as da, tempfile.TemporaryDirectory(prefix="max17-tree-b-") as db:
        vma, vmb = VectorMemory(Path(da)), VectorMemory(Path(db))
        _fill(vma)
        _fill(vmb)
        ta, tb = MeaningTree(Path(da)), MeaningTree(Path(db))
        va = ta.one_take(vma, rebuild=True)
        vb = tb.one_take(vmb, rebuild=True)

        # 1) determinism across independent stores with identical content
        if va["root"]["hash"] != vb["root"]["hash"]:
            _fail(f"same content, different roots: {va['root']['hash']} vs {vb['root']['hash']}")
        if not va["clusters"]:
            _fail("no clusters built")

        # 2) Merkle property: one new meaning flips the root
        vma.remember(Event(type="user_message", payload={"text": "совершенно новая мысль про деплой на новый макбук"}))
        va2 = ta.one_take(vma, rebuild=True)
        if va2["root"]["hash"] == va["root"]["hash"]:
            _fail("root hash did not change after a new memory")

        # 3) one-take is compact + readable
        conspect = va2["root"]["conspect"]
        if "кластер" not in conspect or len(json.dumps(va2, ensure_ascii=False)) > 8000:
            _fail(f"one-take view malformed/bloated: {conspect[:80]}")

        # 4) descend opens leaves
        branch = ta.descend(va2["clusters"][0]["id"], vma)
        if not branch.get("leaves"):
            _fail(f"descend returned no leaves: {branch}")

        out = {
            "ok": True,
            "root": va2["root"]["hash"],
            "clusters": [(c["id"], c["size"], c["label"]) for c in va2["clusters"]],
            "conspect": conspect[:140],
            "descend_leaves": len(branch["leaves"]),
        }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
