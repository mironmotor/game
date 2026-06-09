"""Intent orchestrator for Max17 — the "single brain" router.

Given a user message, decide which capability should handle it:
  - "code"    : a programming task  -> code agent
  - "desktop" : control the Mac/apps -> desktop agent
  - "chat"    : a question / talk / web lookup -> normal Max17 pipeline (memory +
                retrieval-first web + Gonka voice)

Deterministic and local (keyword/pattern scoring) so it adds no latency or cost
and keeps the parity contract stable. Conservative on purpose: it only routes to
code/desktop on at least two independent signals; everything ambiguous stays
"chat" (the safe default, and the user can still open a mode manually).
"""

from __future__ import annotations

import re

_TOKEN_RE = re.compile(r"[a-zа-яё0-9_.+#-]+", re.IGNORECASE)

_CODE_VERBS = (
    "напиш", "созда", "исправ", "почин", "отрефактор", "рефактор", "добав", "реализу",
    "сверст", "запрограммир", "доработа", "перепиш", "сгенерируй код", "напрог",
    "write", "create", "fix", "refactor", "implement", "debug",
)
_CODE_NOUNS = (
    "код", "функци", "класс", "метод", "переменн", "массив", "цикл", "баг", "ошибк в коде",
    "скрипт", "компонент", "endpoint", "эндпоинт", "api", "юнит-тест", "юнит тест", "тест",
    "регулярк", "алгоритм", "рефактор",
)
_CODE_LANGS = (
    "python", "питон", "javascript", "js", "typescript", "ts", "react", "next.js", "nextjs",
    "html", "css", "bash", "sql", "json", "fastapi", "flask", "node",
)
_CODE_EXT_RE = re.compile(r"\.(py|ts|tsx|js|jsx|json|sh|md|css|html|sql|yml|yaml)\b", re.IGNORECASE)

_DESKTOP_VERBS = (
    "открой", "открыть", "закрой", "закрыть", "сверни", "свернуть", "разверни", "активир",
    "переключ", "запусти приложение", "набери", "напечатай", "вставь", "скопируй в",
    "сделай скрин", "скриншот", "нажми", "кликни", "перемести окно",
)
_DESKTOP_APPS = (
    "safari", "chrome", "notes", "заметк", "finder", "файндер", "terminal", "терминал",
    "telegram", "телеграм", "mail", "почт", "calendar", "календар", "spotify", "music",
    "музык", "preview", "просмотр", "system preferences", "настройк", "vs code", "vscode",
    "слак", "slack", "discord", "zoom",
)
_DESKTOP_HINTS = (
    "приложени", "окно", "окне", "рабочий стол", "рабочем стол", "буфер обмена", "на экране",
    "с экрана", "мышк", "клавиш", "горячие клавиш", "сочетани клавиш",
)
_DESKTOP_READ_RE = re.compile(
    r"(как(ое|ая|ие)|что).*(приложени|окн|экран|открыт|актив)", re.IGNORECASE
)


def _has(text: str, needles: tuple[str, ...]) -> list[str]:
    return [n for n in needles if n in text]


def classify(text: str) -> dict:
    """Return {route, confidence, reason, matched}. route in chat|code|desktop."""
    raw = str(text or "").strip()
    t = raw.lower().replace("ё", "е")
    if not t:
        return {"route": "chat", "confidence": 0.5, "reason": "пусто", "matched": []}

    code_hits: list[str] = []
    if _has(t, _CODE_VERBS):
        code_hits.append("verb")
    if _has(t, _CODE_NOUNS):
        code_hits.append("noun")
    if _has(t, _CODE_LANGS):
        code_hits.append("lang")
    if _CODE_EXT_RE.search(t):
        code_hits.append("file")
    code_score = len(code_hits)

    desk_hits: list[str] = []
    if _has(t, _DESKTOP_VERBS):
        desk_hits.append("verb")
    if _has(t, _DESKTOP_APPS):
        desk_hits.append("app")
    if _has(t, _DESKTOP_HINTS):
        desk_hits.append("hint")
    desktop_score = len(desk_hits)
    # "какое приложение сейчас активно" / "что открыто на экране" -> desktop read.
    if _DESKTOP_READ_RE.search(t):
        desktop_score = max(desktop_score, 2)
        if "read" not in desk_hits:
            desk_hits.append("read")
    # A screenshot request is an unambiguous desktop action on its own.
    if re.search(r"скриншот|screenshot|снимок экран", t):
        desktop_score = max(desktop_score, 2)
        if "screenshot" not in desk_hits:
            desk_hits.append("screenshot")

    if code_score >= 2 and code_score >= desktop_score:
        return {
            "route": "code",
            "confidence": round(min(0.95, 0.5 + 0.18 * code_score), 3),
            "reason": "сигналы кода: " + ", ".join(code_hits),
            "matched": code_hits,
        }
    if desktop_score >= 2 and desktop_score > code_score:
        return {
            "route": "desktop",
            "confidence": round(min(0.95, 0.5 + 0.18 * desktop_score), 3),
            "reason": "сигналы рабочего стола: " + ", ".join(desk_hits),
            "matched": desk_hits,
        }
    return {"route": "chat", "confidence": 0.6, "reason": "обычный диалог/вопрос", "matched": []}
