"""macOS desktop agent (Tier 1, confirm-before-act) for Game.

Qwen3 proposes ONE desktop action at a time; the user approves write-actions in
the HUD before they run (read-actions auto-run as observations). Tools use only
built-in macOS automation — `osascript`/AppleScript, `pbpaste`/`pbcopy`,
`open`, `screencapture` — so nothing needs installing.

Stateless protocol (one JSON in, one JSON out) so the client can drive the
approve loop:
  request:  {"mode":"propose"|"execute", "instruction"?, "messages"?, "approved_action"?}
  response: {"ok", "proposal":{action,risk,summary,...}, "observation"?, "messages",
             "model", "done", "error"?}

SAFETY: the backend NEVER acts in `propose` mode — it only runs a tool in
`execute` mode on the action the client sends after the user approved it. Shell
and keystrokes are real machine control, so this is a local single-user tool and
requires the user to grant macOS Accessibility / Automation / Screen Recording.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.code_agent import _extract_json
from mark17.gonka_bridge import chat as gonka_chat, is_enabled as gonka_is_enabled

OBS_LIMIT = 1500
CMD_TIMEOUT = 30
READ_ACTIONS = {"observe", "screen_text", "get_clipboard", "list_apps"}
# Auto-mode: these write-actions are safe/reversible enough to run without asking.
# Everything else (shell, quitting apps, destructive key combos) still needs a
# confirmation even in auto-mode.
SAFE_WRITE = {"open_app", "activate_app", "set_clipboard", "type_text"}
DANGER_KEYS = {"q", "w", "delete", "forwarddelete"}


def _needs_confirm(action: dict[str, Any]) -> bool:
    """Server-side risk classifier: True => ask the user before running.

    Authoritative (not trusting the model's self-reported risk). In auto-mode the
    client runs everything where this is False and only prompts where it is True.
    """
    kind = str(action.get("action") or "")
    if kind in READ_ACTIONS or kind == "final":
        return False
    if kind in SAFE_WRITE:
        return False
    if kind == "key_combo":
        parts = [p.strip().lower() for p in str(action.get("keys") or "").split()]
        has_cmd = any(p in {"command", "cmd"} for p in parts)
        if has_cmd and any(p in DANGER_KEYS for p in parts):
            return True
        return any(p in {"delete", "forwarddelete"} for p in parts)
    # run_shell, quit_app, and anything unknown -> confirm.
    return True

SYSTEM_PROMPT = (
    "Ты — desktop-агент Max17 на macOS (Monterey). Управляешь компьютером пользователя ОДНИМ "
    "действием за шаг. Ты текстовый — экран «видишь» только через observe/screen_text (текст).\n\n"
    "Отвечай СТРОГО одним JSON-объектом, без markdown:\n"
    '  {"thought":"...","action":"<tool>","risk":"read"|"write","summary":"коротко что и зачем",...}\n'
    "Инструменты:\n"
    '  observe        (read)  — активное приложение, окно, буфер обмена\n'
    '  screen_text    (read)  — текст с экрана (скриншот+OCR, может быть недоступен)\n'
    '  get_clipboard  (read)  — содержимое буфера\n'
    '  list_apps      (read)  — запущенные приложения\n'
    '  open_app       (write) {"app":"Safari"}    — открыть/запустить приложение\n'
    '  activate_app   (write) {"app":"Notes"}     — вывести приложение на передний план\n'
    '  quit_app       (write) {"app":"Safari"}    — закрыть приложение\n'
    '  type_text      (write) {"text":"привет"}   — набрать текст в активном поле\n'
    '  key_combo      (write) {"keys":"command t"}— нажать сочетание (модификаторы + клавиша)\n'
    '  set_clipboard  (write) {"text":"..."}      — положить текст в буфер\n'
    '  run_shell      (write) {"command":"ls ~"}  — команда в shell (домашний каталог)\n'
    '  final          (read)  {"answer":"итог по-русски"}\n\n'
    "Правила: ставь risk честно. Сначала наблюдай (observe) если нужно понять контекст. "
    "Делай минимально достаточные шаги. Когда задача выполнена — action \"final\" с кратким итогом."
)


def _run(cmd: list[str], *, timeout: int = CMD_TIMEOUT, shell: bool = False) -> str:
    try:
        proc = subprocess.run(
            cmd if not shell else cmd[0],
            shell=shell,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(Path.home()),
        )
    except subprocess.TimeoutExpired:
        return f"(таймаут {timeout}с)"
    except Exception as exc:  # noqa: BLE001
        return f"(ошибка: {exc})"
    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    if proc.returncode != 0 and err:
        return f"(код {proc.returncode}) {err}"[:OBS_LIMIT]
    return (out or err or "ok")[:OBS_LIMIT]


def _osa(script: str) -> str:
    return _run(["osascript", "-e", script])


def _frontmost() -> str:
    return _osa('tell application "System Events" to get name of first process whose frontmost is true')


def _front_window() -> str:
    return _osa(
        'tell application "System Events" to tell (first process whose frontmost is true) '
        'to try\nget name of front window\non error\nreturn ""\nend try'
    )


def _observe() -> str:
    app = _frontmost()
    win = _front_window()
    clip = _run(["pbpaste"])
    return f"Активное приложение: {app}\nОкно: {win}\nБуфер: {clip[:200]}"


def _escape_as(text: str) -> str:
    return str(text).replace("\\", "\\\\").replace('"', '\\"')


def _key_combo(keys: str) -> str:
    parts = [p.strip().lower() for p in str(keys or "").split() if p.strip()]
    if not parts:
        return "(пустое сочетание)"
    mod_map = {
        "command": "command down",
        "cmd": "command down",
        "option": "option down",
        "alt": "option down",
        "control": "control down",
        "ctrl": "control down",
        "shift": "shift down",
    }
    mods = [mod_map[p] for p in parts[:-1] if p in mod_map]
    key = parts[-1]
    if mods:
        return _osa(f'tell application "System Events" to keystroke "{_escape_as(key)}" using {{{", ".join(mods)}}}')
    return _osa(f'tell application "System Events" to keystroke "{_escape_as(key)}"')


def _screen_text() -> str:
    shot = "/tmp/max17_desktop_shot.png"
    cap = _run(["screencapture", "-x", shot])
    if cap.startswith("(код") or cap.startswith("(ошибка"):
        return f"скриншот не сделан: {cap}"
    # Best-effort OCR via a user Shortcut named "OCR" (image -> text). Optional.
    ocr = _run(["shortcuts", "run", "OCR", "--input-path", shot, "--output-type", "public.plain-text"])
    if ocr.startswith("(код") or ocr.startswith("(ошибка") or not ocr:
        return f"скриншот сохранён в {shot}; OCR недоступен (нужен Shortcut «OCR»). {ocr}"
    return f"Текст с экрана:\n{ocr}"


def _execute(action: dict[str, Any]) -> str:
    kind = str(action.get("action") or "")
    try:
        if kind == "observe":
            return _observe()
        if kind == "screen_text":
            return _screen_text()
        if kind == "get_clipboard":
            return _run(["pbpaste"]) or "(буфер пуст)"
        if kind == "list_apps":
            return _osa('tell application "System Events" to get name of every process whose background only is false')
        if kind == "open_app":
            return _run(["open", "-a", str(action.get("app") or "")])
        if kind == "activate_app":
            return _osa(f'tell application "{_escape_as(action.get("app") or "")}" to activate')
        if kind == "quit_app":
            return _osa(f'tell application "{_escape_as(action.get("app") or "")}" to quit')
        if kind == "type_text":
            return _osa(f'tell application "System Events" to keystroke "{_escape_as(action.get("text") or "")}"')
        if kind == "key_combo":
            return _key_combo(str(action.get("keys") or ""))
        if kind == "set_clipboard":
            text = str(action.get("text") or "")
            try:
                proc = subprocess.run(["pbcopy"], input=text, text=True, timeout=10)
                return "буфер обновлён" if proc.returncode == 0 else "(не удалось)"
            except Exception as exc:  # noqa: BLE001
                return f"(ошибка: {exc})"
        if kind == "run_shell":
            return _run([str(action.get("command") or "")], shell=True)
        return f"(неизвестное действие: {kind})"
    except Exception as exc:  # noqa: BLE001
        return f"(ошибка инструмента: {exc})"


def _step(messages: list[dict[str, str]]) -> tuple[dict[str, Any], str]:
    res = gonka_chat(messages, role="desktop", max_tokens=1200, temperature=0.2)
    if not res.ok or not res.text:
        return {"action": "final", "risk": "read", "answer": f"Модель не ответила: {res.error or res.status}"}, res.model
    action = _extract_json(res.text)
    if not isinstance(action, dict) or not action.get("action"):
        action = {"action": "final", "risk": "read", "answer": res.text.strip()}
    return action, res.model


def run(request: dict[str, Any]) -> dict[str, Any]:
    if not gonka_is_enabled("desktop"):
        return {"ok": False, "error": "GONKA_API_KEY не задан — desktop-агент выключен.", "messages": []}

    mode = str(request.get("mode") or "propose")
    messages = request.get("messages")
    messages = messages if isinstance(messages, list) else []

    if mode == "execute" and request.get("approved_action") and messages:
        approved = request.get("approved_action")
        approved = approved if isinstance(approved, dict) else {}
        messages = messages + [{"role": "assistant", "content": json.dumps(approved, ensure_ascii=False)}]
        observation = _execute(approved)
        messages.append(
            {
                "role": "user",
                "content": f"Результат ({approved.get('action')}):\n{observation[:OBS_LIMIT]}\n\nПредложи следующее ОДНО действие (JSON) или final.",
            }
        )
        proposal, model = _step(messages)
        proposal["needs_confirm"] = _needs_confirm(proposal)
        return {
            "ok": True,
            "observation": observation,
            "proposal": proposal,
            "messages": messages[-24:],
            "model": model,
            "done": str(proposal.get("action")) == "final",
        }

    # propose (or first turn)
    instruction = str(request.get("instruction") or "").strip()
    if not messages:
        if not instruction:
            return {"ok": False, "error": "Пустая инструкция.", "messages": []}
        context = _observe()
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Задача: {instruction}\n\nТекущий контекст:\n{context}\n\nПредложи ОДНО следующее действие (JSON).",
            },
        ]
    proposal, model = _step(messages)
    proposal["needs_confirm"] = _needs_confirm(proposal)
    return {
        "ok": True,
        "proposal": proposal,
        "messages": messages[-24:],
        "model": model,
        "done": str(proposal.get("action")) == "final",
    }


def main() -> int:
    raw = sys.stdin.read()
    try:
        request = json.loads(raw) if raw.strip() else {}
        if not isinstance(request, dict):
            raise ValueError("request must be a JSON object")
    except Exception as exc:  # noqa: BLE001
        sys.stdout.write(json.dumps({"ok": False, "error": f"bad request: {exc}"}, ensure_ascii=False) + "\n")
        return 1
    sys.stdout.write(json.dumps(run(request), ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
