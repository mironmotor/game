"""ChronoSync «Фаза дня» — поведенческое ядро ChronoSync на рельсах MAX.

Не астрология-как-предсказание, а линза тайм-менеджмента: где ты в цикле месяца
(запуск / стабилизация / завершение), и что это значит для СЕГОДНЯ. Три действия
берутся из РЕАЛЬНЫХ миссий Мирона (mark17/missions), а фаза задаёт глагол и «стоп».
Луна и число дня — атмосфера/вкус (настоящая дешёвая астрономия), не предсказание.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# —— Фазы месяца (скелет ChronoSync: 1–10 / 11–20 / 21–30 → 3 / 6 / 9) ——
_PHASES: dict[str, dict[str, Any]] = {
    "launch": {
        "code": 3, "key": "launch", "label": "Запуск", "verb": "Запусти",
        "dont": "Не требуй сразу результата — фаза старта, хаос допустим.",
        "focus": "Начать одно ключевое дело.",
        "generic": [
            "Запусти один маленький проверяемый тест.",
            "Начни, не доводя до идеала — движение важнее.",
            "Сделай первый шаг по главной цели.",
        ],
    },
    "stabilize": {
        "code": 6, "key": "stabilize", "label": "Стабилизация", "verb": "Укрепи",
        "dont": "Не начинай новое — доводи начатое до устойчивости.",
        "focus": "Повторить и систематизировать.",
        "generic": [
            "Повтори то, что уже работает.",
            "Систематизируй один процесс.",
            "Доведи начатое до устойчивого результата.",
        ],
    },
    "close": {
        "code": 9, "key": "close", "label": "Завершение", "verb": "Закрой",
        "dont": "Не запускай новое — закрывай хвосты и фиксируй.",
        "focus": "Закрыть и подвести итог.",
        "generic": [
            "Закрой один открытый хвост.",
            "Зафиксируй результат или прибыль.",
            "Подведи итог и отпусти лишнее.",
        ],
    },
}

_DAY_NUMBER = {
    1: "старт", 2: "коммуникация", 3: "креатив", 4: "структура", 5: "движение",
    6: "ответственность", 7: "анализ", 8: "деньги", 9: "завершение",
}

# Опорное новолуние (UTC) + синодический месяц — для дешёвого расчёта фазы Луны.
_SYNODIC = 29.530588853
_REF_NEW_MOON = datetime(2000, 1, 6, 18, 14, tzinfo=timezone.utc)


def _now_local(payload: dict[str, Any]) -> datetime:
    d = payload.get("date")
    if d:
        try:
            dt = datetime.fromisoformat(str(d))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:  # noqa: BLE001
            pass
    return datetime.now().astimezone()


def _month_phase(day: int) -> dict[str, Any]:
    if day <= 10:
        p = _PHASES["launch"]
    elif day <= 20:
        p = _PHASES["stabilize"]
    else:
        p = _PHASES["close"]
    return {**p, "day": day}


def _day_number(now: datetime) -> dict[str, Any]:
    s = now.day
    while s > 9:
        s = sum(int(c) for c in str(s))
    return {"n": s, "label": _DAY_NUMBER.get(s, "")}


def _moon(now: datetime) -> dict[str, Any]:
    days = (now.astimezone(timezone.utc) - _REF_NEW_MOON).total_seconds() / 86400.0
    frac = (days % _SYNODIC) / _SYNODIC  # 0..1 внутри лунного месяца
    if frac < 0.03 or frac > 0.97:
        k, label, emoji = "new", "Новолуние", "🌑"
    elif frac < 0.22:
        k, label, emoji = "waxing_crescent", "Растущий серп", "🌒"
    elif frac < 0.28:
        k, label, emoji = "first_quarter", "Первая четверть", "🌓"
    elif frac < 0.47:
        k, label, emoji = "waxing_gibbous", "Растущая Луна", "🌔"
    elif frac < 0.53:
        k, label, emoji = "full", "Полнолуние", "🌕"
    elif frac < 0.72:
        k, label, emoji = "waning_gibbous", "Убывающая Луна", "🌖"
    elif frac < 0.78:
        k, label, emoji = "last_quarter", "Последняя четверть", "🌗"
    else:
        k, label, emoji = "waning_crescent", "Убывающий серп", "🌘"
    return {"key": k, "label": label, "emoji": emoji, "fraction": round(frac, 3)}


def _open_missions() -> dict[str, Any]:
    try:
        from mark17 import missions as _m
        snap = _m.snapshot()
        open_m = [
            m for m in snap.get("missions", [])
            if m.get("status") != "done" and not str(m.get("tag", "")).startswith("doctor:")
        ]
        active = snap.get("active")
        if active and str(active.get("tag", "")).startswith("doctor:"):
            active = None
        return {"active": active, "open": open_m}
    except Exception:  # noqa: BLE001
        return {"active": None, "open": []}


def _compose(mp: dict[str, Any], missions: dict[str, Any]) -> tuple[list[str], str, str]:
    verb = mp["verb"]
    actions: list[str] = []
    active = missions.get("active")
    open_m = missions.get("open", [])

    if active:
        step = active.get("next_step") or "сделай один шаг"
        actions.append(f"{verb}: {step} — по миссии «{active['title']}».")

    for m in open_m:
        if active and m.get("id") == active.get("id"):
            continue
        step = m.get("next_step") or "сделай один шаг"
        actions.append(f"{verb} по «{m['title']}»: {step}.")
        if len(actions) >= 3:
            break

    gi = 0
    while len(actions) < 3:
        actions.append(mp["generic"][gi % len(mp["generic"])])
        gi += 1

    focus = active["title"] if active else mp["focus"]
    return actions[:3], focus, mp["dont"]


def phase_of_day(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or {}
    now = _now_local(payload)
    mp = _month_phase(now.day)
    moon = _moon(now)
    dn = _day_number(now)
    missions = _open_missions()
    actions, focus, dont = _compose(mp, missions)
    line = (
        f"{moon['emoji']} Фаза месяца — {mp['label'].lower()} ({mp['code']}), "
        f"день числа {dn['n']} ({dn['label']}). {mp['focus']}"
    )
    return {
        "date": now.strftime("%Y-%m-%d"),
        "month_phase": mp,
        "moon": moon,
        "day_number": dn,
        "actions": actions,
        "focus": focus,
        "dont": dont,
        "line": line,
    }
