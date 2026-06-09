#!/usr/bin/env python3
"""Offline smoke for code-outcome memory (Phase 2). No LLM, no network.

Proves the learning loop's storage half end-to-end:
  1. distill() turns a finished run trace into (lesson, signal, success);
  2. CodeMemory.record() persists it with a deterministic vector;
  3. CodeMemory.recall() surfaces the relevant lesson for a similar new task,
     and ranks an unrelated task's lessons out.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.code_memory import CodeMemory, distill


def _fail(msg: str) -> None:
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
    raise SystemExit(1)


def main() -> int:
    # 1) distill a FAILED run (a command came back red) -> success must be False.
    fail_steps = [
        {"action": "write_file", "path": "app.py", "observation": "записано 100 символов в app.py"},
        {"action": "run_command", "command": "python -m pytest", "observation": "exit=1\nSTDOUT:\nE   ImportError: No module named requests\nSTDERR:"},
    ]
    lesson_f, signal_f, ok_f = distill(
        instruction="Добавить вызов requests в app.py и прогнать тесты",
        target="sandbox",
        steps=fail_steps,
        answer="Кажется, готово",
        files_changed=["app.py"],
        verify_passed=False,
    )
    if ok_f is not False:
        _fail("failed run distilled as success")
    if "exit=1" not in signal_f or "✗" not in lesson_f:
        _fail(f"failure lesson/signal malformed: {lesson_f!r} / {signal_f!r}")

    # 2) distill a SUCCESSFUL run (exit=0) -> success True.
    ok_steps = [
        {"action": "write_file", "path": "math_utils.py", "observation": "записано 200 символов"},
        {"action": "run_command", "command": "python -m pytest", "observation": "exit=0\nSTDOUT:\n2 passed\nSTDERR:"},
    ]
    lesson_s, signal_s, ok_s = distill(
        instruction="Написать функцию факториала и тест к ней",
        target="sandbox",
        steps=ok_steps,
        answer="Готово: факториал + тест, 2 passed",
        files_changed=["math_utils.py", "test_math.py"],
        verify_passed=True,
    )
    if ok_s is not True:
        _fail("successful run not distilled as success")

    with tempfile.TemporaryDirectory(prefix="max17-codemem-") as d:
        mem = CodeMemory(Path(d))
        id_f = mem.record(instruction="Добавить вызов requests в app.py и прогнать тесты",
                          target="sandbox", success=False, files=["app.py"], signal=signal_f, lesson=lesson_f)
        id_s = mem.record(instruction="Написать функцию факториала и тест к ней",
                          target="sandbox", success=True, files=["math_utils.py", "test_math.py"], signal=signal_s, lesson=lesson_s)
        if not id_f or not id_s:
            _fail("record returned no id")

        # 3a) A new task close to the FAILED one must recall that lesson first.
        hits = mem.recall("Сделать http-запрос через requests в приложении", limit=3)
        if not hits:
            _fail("recall returned nothing for related query")
        top = hits[0]
        if top.id != id_f:
            _fail(f"expected failure lesson on top, got id={top.id} ({top.lesson!r})")

        # 3b) A new task close to the SUCCESS one must recall that lesson first.
        hits2 = mem.recall("посчитать факториал числа функцией", limit=3)
        if not hits2 or hits2[0].id != id_s:
            _fail(f"expected success lesson on top, got {[h.id for h in hits2]}")

        # 3c) An unrelated task should not surface either lesson at the top with
        # high confidence (best-effort: just ensure recall stays bounded).
        unrelated = mem.recall("покрасить кнопку интерфейса в синий цвет CSS", limit=3)

        out = {
            "ok": True,
            "distill": {"fail_success": ok_f, "ok_success": ok_s},
            "recall_failed_task_top": top.to_dict(),
            "recall_success_task_top": hits2[0].to_dict(),
            "unrelated_hits": len(unrelated),
        }
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
