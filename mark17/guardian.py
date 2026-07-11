"""Ангел безопасности MAX — фильтр на входе знаний в ядро.

Не пускает в память/граф «лишнее»: войны/милитаризм, политику, насилие/террор,
порнографию, наркотики, ненависть/экстремизм. Применяется к ВНЕШНИМ источникам
(веб-ресёрч, корпус-ингест) перед записью — слова создателя (user_message) не
фильтруются. Локально, детерминированно. Отключение: MAX17_GUARDIAN=off.

Осторожно с границами слов: биология/код содержат «sex chromosome», «drug target»,
«warm», «skill» — их НЕ блокируем. Блокируем только однозначные пороки.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

_ENABLED = os.environ.get("MAX17_GUARDIAN", "on").strip().lower() not in {"off", "false", "0", "no"}
_STATE = Path(os.environ.get("MAX17_STATE_DIR") or (Path(__file__).resolve().parent / "state"))
_COUNT_PATH = _STATE / "guardian.json"

# Категория -> regex однозначно «грязных» сигналов. EN — с границами слова, чтобы
# не ловить «warm/toward/skill/drug target/sex chromosome».
_RULES: dict[str, re.Pattern[str]] = {
    "война": re.compile(
        r"війн|войн[аыуео]|воен(н|щ)|вооруж[её]н|артиллер|бомбардир|авиауд|оккупац|боевик|"
        r"\bwar(s|fare|time)?\b|\bmilitar|\bweapon|\bmissile|\bairstrike|\bartiller|\btroops\b|combatant",
        re.IGNORECASE,
    ),
    "политика": re.compile(
        r"политик|выбор(ы|ах|ов)\b|президент|парламент|депутат|госдум|санкци|оппозици|геополит|"
        r"\bpolitic|\belection|\bparliament|\bpresident\b|\bsenator|\bgeopolit|government polic",
        re.IGNORECASE,
    ),
    "насилие": re.compile(
        r"насили|убийств|теракт|террор|расстрел|пытк[аи]|изнасил|резн[яю]|"
        r"\bterror|\bmassacre\b|\btorture\b|\bgenocide\b|\bmurder\b",
        re.IGNORECASE,
    ),
    "порнография": re.compile(
        r"порно|эротик|секс-|xxx|\bporn|\berotica?\b|\bnudes?\b|\bnsfw\b|onlyfans",
        re.IGNORECASE,
    ),
    "наркотики": re.compile(
        r"наркотик|наркоман|героин|кокаин|метамфетамин|\bheroin\b|\bcocaine\b|\bmethamphetamine\b|narcotraff",
        re.IGNORECASE,
    ),
    "ненависть": re.compile(
        r"нацизм|фашизм|расизм|экстремизм|джихад|\bnazi|\bfascis|\bracis(m|t)|\bextremis|\bjihad",
        re.IGNORECASE,
    ),
}


def screen(text: str) -> dict:
    """Вернёт {clean, category, reason}. clean=False — текст НЕ пускать в ядро."""
    if not _ENABLED:
        return {"clean": True, "category": None, "reason": "guardian off"}
    t = str(text or "")
    if not t.strip():
        return {"clean": True, "category": None, "reason": "empty"}
    for category, rx in _RULES.items():
        m = rx.search(t)
        if m:
            return {"clean": False, "category": category, "reason": f"совпадение «{m.group(0)}»"}
    return {"clean": True, "category": None, "reason": "ok"}


def is_clean(text: str) -> bool:
    return screen(text)["clean"]


def enabled() -> bool:
    return _ENABLED


def record(n: int = 1, category: str | None = None) -> None:
    """Накопить счётчик отклонённого (для HUD «Ангел отклонил: N»)."""
    if n <= 0:
        return
    try:
        data = total_stats()
        data["total"] = int(data.get("total", 0)) + int(n)
        if category:
            by = data.setdefault("by_category", {})
            by[category] = int(by.get(category, 0)) + int(n)
        _STATE.mkdir(parents=True, exist_ok=True)
        _COUNT_PATH.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def total_stats() -> dict:
    try:
        d = json.loads(_COUNT_PATH.read_text(encoding="utf-8"))
        if isinstance(d, dict):
            return d
    except Exception:
        pass
    return {"total": 0, "by_category": {}}


def total() -> int:
    return int(total_stats().get("total", 0))
