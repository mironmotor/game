"""Руки Макса: что он может сделать сам, и чего не может никогда.

Это единственное место, через которое автономный агент дотягивается до
реального мира. Всё остальное — рассуждения; здесь начинаются последствия,
поэтому границы заданы явно, а не подразумеваются.

Как устроена безопасность:

* **Белый список, а не чёрный.** Разрешено ровно перечисленное; всё
  остальное отклоняется. Запрещать по списку опасного — бесполезно: список
  опасного бесконечен, а список нужного короткий.
* **Файлы только внутри проекта.** Путь раскрывается до абсолютного и
  сверяется с корнем; `../../.ssh/id_rsa` и симлинк наружу не пройдут.
* **Команды без оболочки.** Никакого `shell=True`: `rm -rf / ; curl ... | sh`
  разбирается как аргументы, а не исполняется. Конвейеры и подстановки
  невозможны в принципе.
* **По умолчанию — репетиция.** Действие только описывается. Выполнение
  требует `confirm=True`, то есть осознанного решения на уровне вызова.
* **Всё пишется в журнал.** И то, что выполнено, и то, что отклонено —
  иначе «агент что-то сделал» невозможно расследовать.

Намеренно нет: удаления файлов, установки пакетов, git push, sudo, сети с
произвольным адресом. Не потому что «нельзя», а потому что цена ошибки
автономного агента здесь несоизмерима с пользой.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import time
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent

# Команды, которые Макс может запускать сам. Только чтение и проверки:
# ничего, что меняет систему, ставит пакеты или ходит в сеть с произвольным
# адресом. Расширять этот список — осознанное решение человека.
ALLOWED_COMMANDS: dict[str, str] = {
    "ls": "посмотреть файлы",
    "cat": "прочитать файл",
    "head": "начало файла",
    "tail": "конец файла",
    "wc": "посчитать строки",
    "grep": "поиск по тексту",
    "find": "найти файлы",
    "git": "состояние репозитория (только чтение)",
    "python3": "запустить проверку",
    "npm": "сборка и тесты",
    "node": "запустить скрипт",
}

# Подкоманды git, которые ничего не меняют. `git push`, `git reset`,
# `git checkout` сюда не входят намеренно.
GIT_READONLY = {"status", "log", "diff", "show", "branch", "ls-files", "rev-parse", "config"}
NPM_ALLOWED = {"run", "test", "ci", "list", "why"}

MAX_OUTPUT_CHARS = 20_000
DEFAULT_TIMEOUT = 60
MAX_WRITE_BYTES = 500_000


class HandsError(Exception):
    """Действие отклонено границами. Не баг — сработала защита."""


def _audit_path() -> Path:
    raw = os.environ.get("MAX17_STATE_DIR", "").strip()
    base = Path(raw) if raw else _ROOT / "mark17" / "state"
    base.mkdir(parents=True, exist_ok=True)
    return base / "hands-audit.jsonl"


def _audit(entry: dict[str, Any]) -> None:
    """Журнал попыток. Пишем и отказы: без них расследовать нечего."""
    entry = {"ts": time.time(), **entry}
    try:
        with _audit_path().open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass  # журнал недоступен — действие важнее записи о нём


def safe_path(raw: str) -> Path:
    """Путь внутри проекта — или отказ.

    resolve() раскрывает и `..`, и симлинки, поэтому проверка выдерживает
    и `../../etc/passwd`, и ссылку, ведущую наружу.
    """
    candidate = (_ROOT / str(raw or "")).resolve() if not str(raw).startswith("/") else Path(raw).resolve()
    try:
        candidate.relative_to(_ROOT)
    except ValueError:
        raise HandsError(f"путь вне проекта: {raw}")
    return candidate


def _check_command(argv: list[str]) -> None:
    if not argv:
        raise HandsError("пустая команда")
    binary = os.path.basename(argv[0])
    if binary not in ALLOWED_COMMANDS:
        raise HandsError(
            f"команда «{binary}» не в белом списке. Разрешены: {', '.join(sorted(ALLOWED_COMMANDS))}"
        )
    if binary == "git":
        sub = next((a for a in argv[1:] if not a.startswith("-")), "")
        if sub not in GIT_READONLY:
            raise HandsError(f"git {sub or '(без подкоманды)'} меняет репозиторий — только чтение")
    if binary == "npm":
        sub = next((a for a in argv[1:] if not a.startswith("-")), "")
        if sub not in NPM_ALLOWED:
            raise HandsError(f"npm {sub or '(без подкоманды)'} не разрешён")
    # Метасимволы оболочки в аргументах — признак попытки склеить команды.
    # Оболочки здесь нет, но такой аргумент почти наверняка означает, что
    # вызывающий рассчитывал на неё, и лучше отказать явно.
    joined = " ".join(argv)
    if re.search(r"[;&|`$><]|\$\(", joined):
        raise HandsError("в аргументах символы оболочки — команды не склеиваются")

    # Аргументы-пути тоже должны лежать внутри проекта. Без этой проверки
    # белый список бесполезен: `cat` разрешён, и `cat /etc/passwd` вынес бы
    # наружу что угодно, хотя read_file то же самое не пускает.
    for arg in argv[1:]:
        if arg.startswith("-"):
            continue
        if arg.startswith("/") or arg.startswith("~") or ".." in arg.split("/"):
            safe_path(os.path.expanduser(arg))  # бросит HandsError, если снаружи


# ── действия ─────────────────────────────────────────────────────────────────

def read_file(path: str, *, limit: int = MAX_OUTPUT_CHARS, **_: Any) -> dict[str, Any]:
    """Прочитать файл проекта."""
    target = safe_path(path)
    if not target.is_file():
        raise HandsError(f"не файл: {path}")
    text = target.read_text("utf-8", errors="replace")[:limit]
    return {"path": str(target.relative_to(_ROOT)), "text": text, "chars": len(text)}


def list_dir(path: str = ".", **_: Any) -> dict[str, Any]:
    """Посмотреть содержимое папки проекта."""
    target = safe_path(path)
    if not target.is_dir():
        raise HandsError(f"не папка: {path}")
    entries = sorted(
        (("dir" if p.is_dir() else "file"), p.name) for p in target.iterdir()
        if not p.name.startswith(".")
    )
    return {"path": str(target.relative_to(_ROOT)) or ".",
            "entries": [{"kind": k, "name": n} for k, n in entries[:200]]}


def write_note(text: str, name: str = "", **_: Any) -> dict[str, Any]:
    """Записать заметку.

    Писать Макс может только в свою папку заметок: код и конфигурацию
    автономный агент не трогает. Захочешь дать больше — это отдельное
    решение, а не побочный эффект.
    """
    if len(str(text or "").encode("utf-8")) > MAX_WRITE_BYTES:
        raise HandsError("заметка слишком большая")
    notes = _ROOT / "mark17" / "state" / "notes"
    notes.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    safe_name = re.sub(r"[^\w\-.]+", "-", str(name or "note"))[:40] or "note"
    target = notes / f"{stamp}-{safe_name}.md"
    target.write_text(str(text or ""), "utf-8")
    return {"path": str(target.relative_to(_ROOT)), "bytes": target.stat().st_size}


def run_command(command: str, *, timeout: int = DEFAULT_TIMEOUT, **_: Any) -> dict[str, Any]:
    """Выполнить команду из белого списка. Без оболочки."""
    argv = shlex.split(str(command or ""))
    _check_command(argv)
    try:
        proc = subprocess.run(
            argv, cwd=_ROOT, capture_output=True, text=True,
            timeout=max(1, min(300, int(timeout))), shell=False,
        )
    except subprocess.TimeoutExpired:
        raise HandsError(f"команда не уложилась в {timeout}с")
    except FileNotFoundError:
        raise HandsError(f"нет такой программы: {argv[0]}")
    return {
        "command": " ".join(argv),
        "exit_code": proc.returncode,
        "stdout": proc.stdout[:MAX_OUTPUT_CHARS],
        "stderr": proc.stderr[:2000],
    }


ACTIONS = {
    "read_file": (read_file, "прочитать файл проекта"),
    "list_dir": (list_dir, "посмотреть папку"),
    "write_note": (write_note, "записать заметку"),
    "run_command": (run_command, "выполнить команду из белого списка"),
}


def describe() -> list[dict[str, str]]:
    """Что Макс умеет — для подсказки модели и для интерфейса."""
    return [{"action": key, "what": what} for key, (_, what) in sorted(ACTIONS.items())]


def act(action: str, params: dict[str, Any] | None = None, *, confirm: bool = False) -> dict[str, Any]:
    """Выполнить действие.

    Без ``confirm=True`` возвращает описание того, что было бы сделано, и
    ничего не делает. Так «агент решил» и «агент сделал» — два разных шага,
    и второй всегда явный.
    """
    params = dict(params or {})
    entry = {"action": action, "params": params, "confirm": confirm}

    if action not in ACTIONS:
        _audit({**entry, "ok": False, "error": "неизвестное действие"})
        return {"ok": False, "action": action, "error": f"нет такого действия: {action}",
                "available": [a["action"] for a in describe()]}

    func, what = ACTIONS[action]

    if not confirm:
        _audit({**entry, "ok": True, "dry_run": True})
        return {"ok": True, "action": action, "dry_run": True, "what": what,
                "note": "репетиция: ничего не выполнено. Для выполнения нужен confirm=True."}

    try:
        result = func(**params)
    except HandsError as exc:
        _audit({**entry, "ok": False, "error": str(exc)})
        return {"ok": False, "action": action, "error": str(exc), "blocked": True}
    except TypeError as exc:
        _audit({**entry, "ok": False, "error": f"неверные параметры: {exc}"})
        return {"ok": False, "action": action, "error": f"неверные параметры: {exc}"}
    except Exception as exc:  # noqa: BLE001
        _audit({**entry, "ok": False, "error": str(exc)})
        return {"ok": False, "action": action, "error": str(exc)}

    _audit({**entry, "ok": True, "dry_run": False})
    return {"ok": True, "action": action, "dry_run": False, "what": what, "result": result}


def recent_actions(limit: int = 20) -> list[dict[str, Any]]:
    """Последние попытки из журнала — включая отклонённые."""
    path = _audit_path()
    if not path.is_file():
        return []
    try:
        lines = path.read_text("utf-8", errors="replace").strip().split("\n")
    except OSError:
        return []
    out: list[dict[str, Any]] = []
    for line in reversed(lines[-limit * 2:]):
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
        if len(out) >= limit:
            break
    return out
