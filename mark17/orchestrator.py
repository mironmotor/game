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

import math
import os
import re

_TOKEN_RE = re.compile(r"[a-zа-яё0-9_.+#-]+", re.IGNORECASE)

# ——— Семантический дозор (опционально) ———
# Keyword-роутер быстрый и без затрат, но пропускает интент, выраженный без
# ключевых слов. Когда доступны НЕЙРО-эмбеддинги, дозор ловит такой интент по
# косинусу к эталонным векторам маршрутов. На хэш-эмбеддингах НЕ включается
# (косинус там почти случаен) — остаётся чистый keyword. Порог настраивается.
_SEM_THRESHOLD = float(os.environ.get("MAX17_SEMANTIC_ROUTE_THRESHOLD", "0.7"))
_ROUTE_SEEDS = {
    "code": [
        "напиши функцию на python", "исправь баг в коде", "создай файл и закоммить",
        "отрефактори этот класс", "добавь юнит-тест для модуля", "почини ошибку компиляции",
    ],
    "desktop": [
        "сделай скриншот экрана", "открой приложение", "какое окно сейчас активно",
        "кликни по кнопке", "что открыто на рабочем столе", "переключись на браузер",
    ],
    "chat": [
        "расскажи как у тебя дела", "что ты думаешь об этом", "давай просто поговорим",
        "объясни мне эту идею", "спасибо тебе большое", "как мне поступить",
    ],
}
_route_centroids: dict[str, list[float]] | None = None


def _unit(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def _semantic_route(text: str) -> tuple[str, float] | None:
    """(route, confidence) по косинусу к центроидам маршрутов. None, если нейро-
    эмбеддинги недоступны или ошибка — тогда работает keyword-путь (без регрессии)."""
    global _route_centroids
    try:
        from mark17 import embedder

        q = embedder.routing_embed(text)
        if not q:
            return None
        if _route_centroids is None:
            cents: dict[str, list[float]] = {}
            for route, seeds in _ROUTE_SEEDS.items():
                vecs = [v for v in (embedder.routing_embed(s) for s in seeds) if v]
                if not vecs:
                    return None
                dim = len(vecs[0])
                avg = [sum(v[i] for v in vecs) / len(vecs) for i in range(dim)]
                cents[route] = _unit(avg)
            _route_centroids = cents
        qn = _unit(q)
        sims = {r: sum(a * b for a, b in zip(qn, c)) for r, c in _route_centroids.items()}
        mx = max(sims.values())
        exps = {r: math.exp((s - mx) / 0.15) for r, s in sims.items()}  # softmax-уверенность
        z = sum(exps.values()) or 1.0
        probs = {r: e / z for r, e in exps.items()}
        top = max(probs, key=probs.get)
        return top, round(probs[top], 3)
    except Exception:  # noqa: BLE001 — любой сбой => keyword-fallback
        return None

_CODE_VERBS = (
    "напиш", "созда", "исправ", "почин", "отрефактор", "рефактор", "добав", "реализу",
    "сверст", "запрограммир", "доработа", "перепиш", "сгенерируй код", "напрог",
    "сделай", "сделат", "набросай", "накидай", "запили", "сгенерир", "доделай", "накодь", "напиши код",
    "write", "create", "fix", "refactor", "implement", "debug", "code", "coding",
)
_CODE_NOUNS = (
    "код", "функци", "класс", "метод", "переменн", "массив", "цикл", "баг", "ошибк в коде",
    "скрипт", "компонент", "endpoint", "эндпоинт", "api", "юнит-тест", "юнит тест", "тест",
    "регулярк", "алгоритм", "рефактор", "программ", "сниппет",
)
_CODE_LANGS = (
    "python", "питон", "пайтон", "javascript", "js", "джаваскрипт", "typescript", "ts", "тайпскрипт",
    "java", "джав", "kotlin", "котлин", "react", "next.js", "nextjs", "html", "css", "bash",
    "sql", "json", "fastapi", "flask", "node", "golang", "rust", "раст", "ruby", "руби", "php", "пхп",
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
# «Музыка» -> Режим 777: чат не умеет звучать, движок умеет. Сильные сигналы:
# музыкальное существительное само по себе, либо «музыка» + глагол сочинения,
# либо явное имя режима «777».
_MUSIC_NOUNS = (
    "трек", "песн", "мелоди", "саундтрек", "битмейк", "битак", "композици",
    "song", "melody", "soundtrack",
)
_MUSIC_VERBS = (
    "сочини", "напиш", "сделай", "набросай", "создай", "запили", "сгенери",
    "напой", "наиграй", "compose",
)
# Явные сигналы «иди в веб и исследуй» → инлайн web-ресёрч (через Ангела).
_RESEARCH_VERBS = (
    "найди", "найти", "поищи", "погугли", "загугли", "нагугли", "разузнай",
    "разведай", "исследуй", "исследовать", "ресёрч", "ресерч", "research",
    "узнай про", "узнай о", "узнай что", "сделай ресёрч", "сделай ресерч",
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

    music_hits: list[str] = []
    if _has(t, _MUSIC_NOUNS):
        music_hits.append("noun")
    if "музык" in t and _has(t, _MUSIC_VERBS):
        music_hits.append("music+verb")
    if "777" in t:
        music_hits.append("777")
    if music_hits:
        return {
            "route": "music",
            "confidence": round(min(0.95, 0.62 + 0.16 * len(music_hits)), 3),
            "reason": "сигналы музыки: " + ", ".join(music_hits),
            "matched": music_hits,
        }

    # Ресёрч-намерение (не перебивает явный код/десктоп).
    research_hits = _has(t, _RESEARCH_VERBS)
    if research_hits and code_score < 2 and desktop_score < 2:
        return {
            "route": "research",
            "confidence": round(min(0.95, 0.6 + 0.15 * len(research_hits)), 3),
            "reason": "сигналы ресёрча: " + ", ".join(research_hits),
            "matched": research_hits,
        }

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
    # Keyword не нашёл явных сигналов кода/десктопа → спросим семантику (только при
    # живых нейро-эмбеддингах). Ловит интент без ключевых слов, не перебивая матчи выше.
    sem = _semantic_route(raw)
    if sem and sem[0] in {"code", "desktop"} and sem[1] >= _SEM_THRESHOLD:
        return {"route": sem[0], "confidence": sem[1], "reason": "семантика (эмбеддинги)", "matched": ["semantic"]}
    return {"route": "chat", "confidence": 0.6, "reason": "обычный диалог/вопрос", "matched": []}
