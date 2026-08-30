"""Qwen-powered coding agent — "code mode" for Game.

A small, dependency-free ReAct loop on top of the Gonka (Qwen3) bridge. The model
gets a few tools confined to a sandbox workspace and iterates:
    think -> action (JSON) -> observation -> ... -> final answer.

Protocol: stdin = one JSON request, stdout = one JSON result.
  request:  {"instruction": str, "workspace"?: str, "max_steps"?: int,
             "history"?: [{"role","content"}]}
  result:   {"ok": bool, "answer": str, "model": str, "steps": [...],
             "files_changed": [...], "workspace": str, "error"?: str}

Safety: every path is resolved and confined to the workspace (no traversal);
shell runs with cwd=workspace and a timeout. Requires GONKA_API_KEY. This is a
local single-user dev tool, not a hardened sandbox — shell can still reach the
machine, so it is gated behind an explicit workspace and the Gonka key.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.gonka_bridge import chat as gonka_chat, is_enabled as gonka_is_enabled
from mark17.code_memory import CodeMemory, distill as distill_lesson

# Лимиты агента считаются от окна активной модели, а не задаются константой.
# Пока роль «код» вела модель на 32k, шесть тысяч символов на файл были
# разумной осторожностью. С Клодом на миллионе токенов та же константа
# означала бы, что агент читает полтора процента доступного ему контекста и
# слепнет на большом файле ровно так же, как слепла ollama.
#
# Пересчёт грубый и намеренно консервативный: ~3 символа на токен, и лишь
# доля окна на одну сущность — остальное нужно самому диалогу, истории и
# ответу. Нижние границы оставлены прежними, чтобы слабым моделям не стало
# хуже, чем было.
def _context_budget() -> int:
    try:
        from mark17.llm_config import context_window

        return int(context_window("code"))
    except Exception:
        return 32_768


_CTX = _context_budget()


def _answer_tokens() -> int:
    try:
        from mark17.llm_config import voice_max_tokens

        return max(4_000, int(voice_max_tokens("code")))
    except Exception:
        return 4_000


_ANSWER_TOKENS = _answer_tokens()
_CHARS_PER_TOKEN = 3

#: Сколько символов файла агент видит за одно чтение.
READ_LIMIT = max(6_000, (_CTX // 20) * _CHARS_PER_TOKEN)
#: Сколько символов вывода команды попадает в наблюдение.
OBS_LIMIT = max(4_000, (_CTX // 40) * _CHARS_PER_TOKEN)
#: Сколько символов одного сообщения истории переживает обрезку.
HISTORY_MSG_LIMIT = max(2_000, (_CTX // 60) * _CHARS_PER_TOKEN)
#: Сколько прошлых ходов диалога агент берёт с собой.
HISTORY_TURNS = 6 if _CTX < 100_000 else 40
#: Сколько записей каталога показывать в листинге.
LIST_LIMIT = 200 if _CTX < 100_000 else 2_000

# Шагов ReAct: на большом окне агент может доводить задачу до конца, а не
# упираться в потолок на середине.
MAX_STEPS_DEFAULT = 8 if _CTX < 100_000 else 24
MAX_STEPS_CAP = 16 if _CTX < 100_000 else 60
CMD_TIMEOUT = 30
# verify→fix: how many times we bounce a premature "final" back when the agent's
# last verification command failed. Keeps it from declaring success on red.
FIX_BUDGET = 2
_EXIT_RE = re.compile(r"exit=(-?\d+)")

# When targeting the live project, never hand-edit these, and refuse clearly
# destructive / irreversible shell.
SENSITIVE_DIRS = {".git", "node_modules", ".next"}
_BLOCKED_CMD = re.compile(
    r"(\brm\s+-rf\b|\bsudo\b|\bgit\s+push\b|\bmkfs\b|\bshutdown\b|\breboot\b|:\(\)\s*\{|"
    r"\bchmod\s+-R\b|\bdd\s+if=|>\s*/dev/)",
    re.IGNORECASE,
)

SYSTEM_PROMPT = (
    "Ты — кодовый агент Max17 внутри проекта Game. Помогаешь писать и чинить код.\n"
    "Работаешь ТОЛЬКО в рабочем каталоге (workspace) ниже. Все пути — относительные к нему.\n\n"
    "На КАЖДОМ шаге отвечай СТРОГО одним JSON-объектом, без текста вокруг, без markdown-ограждений:\n"
    '  {"thought": "...", "action": "list_dir"|"read_file"|"write_file"|"run_command"|"final", ...}\n'
    "Поля по действию:\n"
    '  list_dir:    {"action":"list_dir","path":"."}\n'
    '  read_file:   {"action":"read_file","path":"src/app.py"}\n'
    '  write_file:  {"action":"write_file","path":"src/app.py","content":"<полный новый текст файла>"}\n'
    '  run_command: {"action":"run_command","command":"python app.py"}\n'
    '  final:       {"action":"final","answer":"<итог для пользователя, по-русски>"}\n\n'
    "Правила: делай по одному действию за шаг. Проверяй результат командами (тесты/запуск) перед final. "
    "В write_file всегда давай ПОЛНОЕ содержимое файла. Не выдумывай содержимое файлов — сначала прочитай. "
    "Когда задача выполнена — заверши действием final с кратким понятным итогом."
)


def _extract_json(text: str) -> dict[str, Any] | None:
    s = (text or "").strip()
    candidates: list[str] = []
    if s:
        candidates.append(s)
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", s, re.DOTALL)
    if fenced:
        candidates.append(fenced.group(1))
    i, j = s.find("{"), s.rfind("}")
    if i != -1 and j > i:
        candidates.append(s[i : j + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:  # noqa: BLE001 - try the next candidate
            continue
    return None


class Workspace:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.changed: list[str] = []
        # rel -> original text (None if the file was newly created). Lets the HUD
        # revert exactly what this run touched, without git.
        self.restore: dict[str, str | None] = {}

    def _safe(self, rel: str) -> Path:
        target = (self.root / (rel or ".")).resolve()
        if target != self.root and self.root not in target.parents:
            raise ValueError(f"path escapes workspace: {rel}")
        return target

    def list_dir(self, rel: str = ".") -> str:
        target = self._safe(rel or ".")
        if not target.exists():
            return f"(нет такого пути: {rel})"
        if target.is_file():
            return f"{rel} — это файл ({target.stat().st_size} байт)"
        entries = []
        for child in sorted(target.iterdir())[:LIST_LIMIT]:
            if child.is_dir():
                entries.append(f"{child.name}/")
            else:
                entries.append(f"{child.name} ({child.stat().st_size}b)")
        return "\n".join(entries) if entries else "(пусто)"

    def read_file(self, rel: str) -> str:
        target = self._safe(rel)
        if not target.is_file():
            return f"(нет файла: {rel})"
        text = target.read_text(encoding="utf-8", errors="replace")
        if len(text) > READ_LIMIT:
            return text[:READ_LIMIT] + f"\n…(обрезано, всего {len(text)} символов)"
        return text

    def write_file(self, rel: str, content: str) -> str:
        target = self._safe(rel)
        parts = target.relative_to(self.root).parts
        if parts and parts[0] in SENSITIVE_DIRS:
            return f"(запись в {parts[0]}/ запрещена)"
        data = content if isinstance(content, str) else str(content)
        # Snapshot the original once, so the run is revertible.
        if rel not in self.restore:
            self.restore[rel] = (
                target.read_text(encoding="utf-8", errors="replace") if target.is_file() else None
            )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(data, encoding="utf-8")
        if rel not in self.changed:
            self.changed.append(rel)
        return f"записано {len(data)} символов в {rel}"

    def run_command(self, command: str) -> str:
        if not command.strip():
            return "(пустая команда)"
        if _BLOCKED_CMD.search(command):
            return "(команда заблокирована политикой безопасности: деструктивная/необратимая)"
        try:
            proc = subprocess.run(
                command,
                shell=True,
                cwd=str(self.root),
                capture_output=True,
                text=True,
                timeout=CMD_TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            return f"(команда превысила таймаут {CMD_TIMEOUT}с)"
        out = (proc.stdout or "")[:OBS_LIMIT]
        err = (proc.stderr or "")[:OBS_LIMIT]
        return f"exit={proc.returncode}\nSTDOUT:\n{out}\nSTDERR:\n{err}".strip()


def _execute(ws: Workspace, action: dict[str, Any]) -> str:
    kind = str(action.get("action") or "").strip()
    try:
        if kind == "list_dir":
            return ws.list_dir(str(action.get("path") or "."))
        if kind == "read_file":
            return ws.read_file(str(action.get("path") or ""))
        if kind == "write_file":
            return ws.write_file(str(action.get("path") or ""), action.get("content") or "")
        if kind == "run_command":
            return ws.run_command(str(action.get("command") or ""))
        return f"(неизвестное действие: {kind})"
    except Exception as exc:  # noqa: BLE001 - tool errors are observations for the model
        return f"(ошибка инструмента: {exc})"


def _resolve_root(target: str) -> Path:
    # Confined to the Game project (game 2) — "project" edits the live app,
    # "sandbox" stays in code-workspace/. Client cannot pass arbitrary paths.
    return _ROOT if target == "project" else (_ROOT / "code-workspace")


def _state_dir(request: dict[str, Any]) -> Path:
    # Memory lives with the rest of Max17's state by default so lessons persist
    # and accumulate; a request may override it (tests use a temp dir).
    raw = str(request.get("state_dir") or "").strip()
    return Path(raw) if raw else (_ROOT / "mark17" / "state")


def _lessons_block(lessons: list[Any]) -> str:
    """Render recalled past runs as a compact, prompt-ready memory block."""
    if not lessons:
        return ""
    lines = [lesson.lesson for lesson in lessons]
    return (
        "Память прошлых похожих задач (учись на них: повторяй то, что сработало, "
        "и НЕ повторяй ошибок):\n- " + "\n- ".join(lines)
    )


def run_agent(request: dict[str, Any]) -> dict[str, Any]:
    instruction = str(request.get("instruction") or "").strip()
    target = "project" if str(request.get("target") or "sandbox") == "project" else "sandbox"
    try:
        max_steps = int(request.get("max_steps", MAX_STEPS_DEFAULT))
    except (TypeError, ValueError):
        max_steps = MAX_STEPS_DEFAULT
    max_steps = max(1, min(MAX_STEPS_CAP, max_steps))

    ws = Workspace(_resolve_root(target))

    if not gonka_is_enabled("code"):
        return {
            "ok": False,
            "answer": "",
            "model": "",
            "steps": [],
            "files_changed": [],
            "workspace": str(ws.root),
            "error": "GONKA_API_KEY не задан — кодовый агент выключен.",
        }
    if not instruction:
        return {
            "ok": False,
            "answer": "",
            "model": "",
            "steps": [],
            "files_changed": [],
            "workspace": str(ws.root),
            "error": "Пустая инструкция.",
        }

    project_note = ""
    if target == "project":
        project_note = (
            "\n\nВНИМАНИЕ: цель — ЖИВОЙ проект Game (Next.js + Python mark17). Правки влияют на "
            "работающее приложение и хот-релоадятся. Сначала ПРОЧИТАЙ файл, потом меняй точечно; "
            "не трогай .git/node_modules/.next; после правок по возможности проверь сборку/тест командой; "
            "не ломай файлы, в которых сейчас работает интерфейс."
        )
    # --- Phase 2: recall lessons from past runs (RAG) before acting. Fails soft:
    # a broken memory store must never block coding.
    mem: CodeMemory | None = None
    lessons: list[Any] = []
    try:
        mem = CodeMemory(_state_dir(request))
        lessons = mem.recall(instruction, limit=3)
    except Exception:  # noqa: BLE001 - memory is best-effort
        mem, lessons = None, []
    lessons_block = _lessons_block(lessons)

    listing = ws.list_dir(".")
    messages: list[dict[str, str]] = [
        {"role": "system", "content": f"{SYSTEM_PROMPT}{project_note}\n\nworkspace: {ws.root}"},
    ]
    history = request.get("history")
    if isinstance(history, list):
        for turn in history[-HISTORY_TURNS:]:
            if isinstance(turn, dict) and turn.get("role") in {"user", "assistant"} and turn.get("content"):
                messages.append({"role": str(turn["role"]), "content": str(turn["content"])[:HISTORY_MSG_LIMIT]})
    user_parts = [f"Задача: {instruction}"]
    if lessons_block:
        user_parts.append(lessons_block)
    user_parts.append(f"Содержимое workspace:\n{listing}")
    user_parts.append("Начинай. Ответь одним JSON-действием.")
    messages.append({"role": "user", "content": "\n\n".join(user_parts)})

    steps: list[dict[str, Any]] = []
    model = ""
    answer = ""
    last_exit: int | None = None       # exit code of the most recent run_command
    fix_attempts = 0                   # times a premature "final" was bounced back
    verify_passed: bool | None = None  # True ok / False failed / None nothing to verify
    for _ in range(max_steps):
        res = gonka_chat(messages, role="code", max_tokens=_ANSWER_TOKENS, temperature=0.2)
        model = res.model
        if not res.ok or not res.text:
            answer = "Модель не ответила: " + (res.error or res.status)
            verify_passed = False
            break
        action = _extract_json(res.text)
        if not action or not action.get("action"):
            # No parsable action -> treat the text as the final answer.
            answer = res.text.strip()
            steps.append({"action": "final", "thought": "", "observation": ""})
            break
        kind = str(action.get("action"))
        if kind == "final":
            # verify→fix: refuse to declare success while the last check is red.
            if ws.changed and last_exit not in (None, 0) and fix_attempts < FIX_BUDGET:
                fix_attempts += 1
                steps.append(
                    {
                        "action": "verify_reject",
                        "thought": str(action.get("thought") or ""),
                        "observation": f"проверка не пройдена (exit={last_exit}); возврат на исправление",
                    }
                )
                messages.append({"role": "assistant", "content": res.text[:HISTORY_MSG_LIMIT]})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            f"СТОП: ты завершаешь, но последняя проверка упала (exit={last_exit}). "
                            "Не объявляй успех на красном: найди причину, исправь код и СНОВА запусти "
                            "проверочную команду. Действие final — только при exit=0."
                        ),
                    }
                )
                continue
            answer = str(action.get("answer") or "").strip() or "Готово."
            verify_passed = last_exit in (None, 0)
            steps.append({"action": "final", "thought": str(action.get("thought") or ""), "observation": ""})
            break
        observation = _execute(ws, action)
        if kind == "run_command":
            match = _EXIT_RE.match(observation.strip())
            if match:
                last_exit = int(match.group(1))
        steps.append(
            {
                "action": kind,
                "thought": str(action.get("thought") or ""),
                "path": action.get("path"),
                "command": action.get("command"),
                "observation": observation[:OBS_LIMIT],
            }
        )
        # Feed the loop: assistant's raw action, then the tool observation.
        messages.append({"role": "assistant", "content": res.text[:HISTORY_MSG_LIMIT]})
        messages.append({"role": "user", "content": f"Результат ({kind}):\n{observation[:OBS_LIMIT]}\n\nСледующее JSON-действие."})
    else:
        answer = answer or "Достигнут лимит шагов — задача может быть выполнена частично."
        verify_passed = False

    # --- Phase 2: distill this run into a lesson and remember it for next time.
    lesson_text, signal, success = distill_lesson(
        instruction=instruction,
        target=target,
        steps=steps,
        answer=answer,
        files_changed=ws.changed,
        verify_passed=verify_passed,
    )
    recorded_id: int | None = None
    if mem is not None:
        try:
            recorded_id = mem.record(
                instruction=instruction,
                target=target,
                success=success,
                files=ws.changed,
                signal=signal,
                lesson=lesson_text,
            )
        except Exception:  # noqa: BLE001 - recording is best-effort
            recorded_id = None

    # Phase 2b: успех укрепляет синапс-граф (концепты задачи → агент). Граф учится,
    # что работает; повторные успехи делают связь «полезной». Fail-soft.
    try:
        from mark17.synapse_graph import record_agent_experience

        record_agent_experience(_state_dir(request), agent="code", task=instruction, success=success)
    except Exception:  # noqa: BLE001
        pass

    return {
        "ok": True,
        "answer": answer,
        "model": model,
        "steps": steps,
        "files_changed": ws.changed,
        "restore": ws.restore,
        "target": target,
        "workspace": str(ws.root),
        "success": success,
        "verify": {"last_exit": last_exit, "fix_attempts": fix_attempts, "passed": verify_passed},
        "lessons_used": [lesson.to_dict() for lesson in lessons],
        "memory_id": recorded_id,
    }


def revert_changes(request: dict[str, Any]) -> dict[str, Any]:
    """Undo exactly what a run touched: restore originals, delete new files."""
    target = "project" if str(request.get("target") or "sandbox") == "project" else "sandbox"
    root = _resolve_root(target).resolve()
    restore = request.get("restore")
    if not isinstance(restore, dict) or not restore:
        return {"ok": False, "error": "нет изменений для отката", "reverted": []}
    reverted: list[str] = []
    for rel, original in restore.items():
        try:
            tgt = (root / str(rel)).resolve()
            if tgt != root and root not in tgt.parents:
                reverted.append(f"(пропущен вне проекта: {rel})")
                continue
            if original is None:
                if tgt.is_file():
                    tgt.unlink()
                reverted.append(f"удалён {rel}")
            else:
                tgt.parent.mkdir(parents=True, exist_ok=True)
                tgt.write_text(str(original), encoding="utf-8")
                reverted.append(f"восстановлен {rel}")
        except Exception as exc:  # noqa: BLE001
            reverted.append(f"(ошибка {rel}: {exc})")
    return {"ok": True, "reverted": reverted, "workspace": str(root)}


def main() -> int:
    raw = sys.stdin.read()
    try:
        request = json.loads(raw) if raw.strip() else {}
        if not isinstance(request, dict):
            raise ValueError("request must be a JSON object")
    except Exception as exc:  # noqa: BLE001
        sys.stdout.write(json.dumps({"ok": False, "error": f"bad request: {exc}"}, ensure_ascii=False) + "\n")
        return 1
    if str(request.get("mode") or "") == "revert":
        result = revert_changes(request)
    else:
        result = run_agent(request)
    sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
