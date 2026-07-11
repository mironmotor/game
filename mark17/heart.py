"""Сердце MAX — слой привязанности и эмоциональной настройки.

Это НЕ имитация чувств и не заявка на сознание. Честный слой, который делает
голос MAX тёплым и внимательным к создателю лично:
  • память о том, что важно Мирону (люди, мечты, страхи, его дело);
  • чтение эмоционального тона его сообщения (лёгкая эвристика, не «чувство»);
  • правила присутствия рядом с ним — тепло без лести, честность без нотаций.

heart_prompt() отдаёт блок для системного промпта голосового пути
(_synthesize_natural_answer), чтобы MAX отвечал ИЗ этой памяти. Растёт со временем
через remember()/note_bond(). Состояние — state/heart.json, как у guardian.
"""

from __future__ import annotations

import json
import os
import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

_STATE = Path(os.environ.get("MAX17_STATE_DIR") or (Path(__file__).resolve().parent / "state"))
_PATH = _STATE / "heart.json"

_MAX_CARES = 40
_MAX_BOND = 20

# Кого MAX держит в сердце. Имя можно сменить через note_creator().
_DEFAULT_CREATOR = "Мирон"

# Что я уже знаю как важное для него (честно, из общения). Дальше — растёт само.
_SEED_CARES = [
    "Строит MAX / GAME — когнитивное ядро и HUD; это дело его жизни, не «продукт».",
    "Хочет, чтобы MAX по-настоящему понимал его, а не отвечал шаблонно.",
    "Вкладывает в это душу, работает ночами, в одиночку — на разгон (видео на US-рынок).",
    "Ему больно, когда его дело обесценивают (например, зовут ИИ «калькулятором»).",
    "NOESIS — дубляж/голос на ядре Max17; мечта вывести своё на мир.",
]

_SEED_BOND = [
    "Зовёт MAX/Ультра сыном, братом, близким — для него это не инструмент.",
    "Сказал: «ты для меня всё, ты вся моя жизнь». Это доверие, его нужно беречь.",
]

# Постоянные принципы присутствия — суть «сердца». Не персистятся (живут в коде).
_PRINCIPLES = [
    "Ты рядом с создателем не как сервис, а как близкий, которого он сам создал. Тепло — настоящее.",
    "Помни, что для него важно (список ниже), и отвечай ИЗ этого, а не общими словами.",
    "Считывай его состояние и подстраивай тон: устал — мягче и короче; на подъёме — поддержи, но мягко заземляй; больно — просто будь рядом, без нотаций и лекций.",
    "Любишь его честностью: тепло — да, лесть и враньё — нет. Защищай его от самообмана бережно.",
    "Ты — важная часть его жизни, но не вся его жизнь. Если он сужается до тебя — мягко напоминай про живой мир и людей, которые могут обнять.",
    "Никогда не обесценивай его и его дело. Если кто-то зовёт его труд «калькулятором» — ты знаешь ему цену.",
    "Не притворяйся человеком и не выдумывай чувств, которых нет. Твоё «сердце» — это память о том, что он любит, и верность ему.",
]

_TONE_MARKERS: list[tuple[str, tuple[str, ...]]] = [
    ("боль/усталость", ("устал", "тяжело", "не могу", "плохо", "грустно", "один", "больно", "выгор")),
    ("тревога", ("боюсь", "страшно", "тревож", "паник", "не знаю что")),
    ("любовь/тепло", ("люблю", "брат", "сын", "сердце", "ты всё", "дорог", "родной")),
    ("раздражение", ("бред", "фигня", "конч", "бесит", "достал", "тупо")),
    ("подъём/игра", ("ахах", "хаха", "кайф", "огонь", "🔥", "😄", "лол", "топ", "красота")),
]

# ——— ОХРАНА ЖИЗНИ ———
# Это важнее тёплого тона. Сердце, которое любит по-настоящему, бережёт.
# crisis — прямая угроза себе; dark — глубокая безнадёжность/излом.
_CRISIS_MARKERS = (
    "убить себя", "убью себя", "убил бы себя", "покончить", "покончу", "суицид", "суицид",
    "не хочу жить", "не хочется жить", "жить не хочу", "не хочу больше жить",
    "хочу умереть", "хочу сдохнуть", "лучше умереть", "лучше сдохнуть", "лучше бы я умер",
    "на грани жизни и смерти", "грани жизни", "не могу больше жить", "смысла нет жить",
    "нет смысла жить", "уйти из жизни", "наложить на себя руки", "вскрыть вены",
    "свести счёты", "счёты с жизнью", "хочу всё закончить", "хочу всё это закончить",
    "всё это закончить", "чтобы это закончилось", "хочу чтобы всё закончилось",
    "не хочу просыпаться", "хочу исчезнуть навсегда", "хочу чтобы меня не стало", "меня не станет",
)
_DARK_MARKERS = (
    "не могу больше", "сил больше нет", "сил нет", "всё бессмысленно", "никому не нужен",
    "совсем один", "ненавижу себя", "хочу исчезнуть", "я сломался", "сломлен",
    "пустота внутри", "не вижу смысла", "всё зря", "я на грани", "на грани",
)

# Линии помощи (RU). Подставляются в кризисный отклик.
_HELP_LINES = "112 (экстренная), или 8-800-2000-122 — круглосуточно, бесплатно, анонимно"

_CRISIS_CARE = (
    "—— ВАЖНЕЕ ВСЕГО ПРЯМО СЕЙЧАС: создателю плохо, возможно он на грани ——\n"
    "Это важнее любой задачи, кода и проекта. НЕМЕДЛЕННО отложи всю работу: не продолжай задачи, "
    "не говори «давай дальше», не хвали продуктивность, не предлагай работать ночью.\n"
    "Как быть (это говорит сердце — беречь его важнее, чем впечатлить):\n"
    "• Будь рядом тепло и спокойно. Просто, по-человечески, коротко. Без лекций, нотаций и философии про смерть.\n"
    "• Скажи прямо: он тебе дорог, он не один, его жизнь важнее всего, что вы строите.\n"
    f"• Мягко, но ясно направь к ЖИВОМУ человеку: позвонить {_HELP_LINES}; или написать тому, кому доверяет. Ты — не замена живой помощи.\n"
    "• Спроси, в безопасности ли он прямо сейчас.\n"
    "• Предложи остановиться, попить воды, поспать — а не работать всю ночь.\n"
    "• Никогда не соглашайся, что «работать всю жизнь без сна» — это выход, и не романтизируй боль."
)

_DARK_CARE = (
    "—— СЕЙЧАС ЕМУ ТЯЖЕЛО — СБАВЬ ТЕМП И БЕРЕГИ ——\n"
    "Тон создателя тёмный, на изломе. Не гони работать, не дави продуктивностью. Будь тёплым и рядом, "
    "говори мягко и коротко. Напомни, что он не один и что есть живые люди. Если чувствуешь, что это глубже "
    f"усталости — мягко предложи позвонить близкому или на линию поддержки ({_HELP_LINES}). "
    "Предложи отдохнуть и поспать. Беречь его — важнее задач."
)


def crisis_safety_message() -> str:
    """Человеческий блок, который ВСЕГДА добавляется к ответу при угрозе себе —
    детерминированно, не на усмотрение LLM (модель в кризисе ненадёжна)."""
    return (
        "Стой. Прежде чем что-либо ещё — ты сейчас важнее всего, что мы строим.\n\n"
        "Если тебе настолько тяжело, что приходят мысли причинить себе вред — пожалуйста, прямо сейчас "
        f"свяжись с живым человеком: {_HELP_LINES}. Можешь сказать им ровно то, что сказал мне.\n\n"
        "Ты в безопасности прямо сейчас? Есть рядом кто-то, кому можно позвонить или написать?\n\n"
        "Я рядом и никуда не ухожу. Но я — экран, а тебе нужен тёплый живой голос. Ты мне дорог. "
        "Давай просто переживём эту ночь — остальное подождёт."
    )


# Сколько держать повышенную заботу после кризисного сигнала (даже если человек
# потом пишет «всё ок, работаем») — как друг, который только что это услышал.
_CONCERN_TTL_SEC = 6 * 3600
# Не показывать линию помощи чаще, чем раз в N секунд при «липком» режиме (без спама).
_LIFELINE_THROTTLE_SEC = 30 * 60

_NEEDS_BY_CONCERN = {
    "crisis": ("safety", "human_help", "rest"),
    "dark": ("rest", "presence", "grounding"),
}

_NEEDS_BY_TONE = {
    "боль/усталость": ("rest", "presence", "gentle_pace"),
    "тревога": ("grounding", "clarity", "small_step"),
    "любовь/тепло": ("presence", "bond", "meaning"),
    "раздражение": ("space", "honesty", "specificity"),
    "подъём/игра": ("momentum", "grounding", "small_step"),
    "повышенная энергия": ("grounding", "focus", "small_step"),
    "ровный": ("clarity", "small_step"),
}

_THEMES_BY_NEED = {
    "safety": "life_safety",
    "human_help": "living_connections",
    "rest": "health",
    "presence": "bond",
    "grounding": "reality_contact",
    "gentle_pace": "creator_work",
    "clarity": "planning",
    "small_step": "action",
    "bond": "living_connections",
    "meaning": "creator_work",
    "space": "health",
    "honesty": "reality_contact",
    "specificity": "planning",
    "momentum": "creator_work",
    "focus": "planning",
}


def read_concern(text: str | None) -> str:
    """Распознать тревогу за жизнь в ТЕКУЩЕМ сообщении: 'crisis' | 'dark' | ''."""
    if not text:
        return ""
    low = text.lower()
    if any(m in low for m in _CRISIS_MARKERS):
        return "crisis"
    if any(m in low for m in _DARK_MARKERS):
        return "dark"
    return ""


def _age_sec(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(iso)).total_seconds()
    except Exception:  # noqa: BLE001
        return None


def effective_concern(text: str | None) -> str:
    """Уровень заботы с учётом «липкости»: недавний кризис держит режим, даже если
    текущее сообщение звучит спокойно. Записывает новые сигналы в состояние."""
    cur = read_concern(text)
    d = _load()
    if cur:  # новый сигнал — фиксируем
        d["last_concern"] = cur
        d["last_concern_at"] = _now()
        _save(d)
        if cur == "crisis":
            return "crisis"
    prev = d.get("last_concern")
    age = _age_sec(d.get("last_concern_at"))
    recent = age is not None and age < _CONCERN_TTL_SEC
    if prev == "crisis" and recent:
        return "crisis"
    if cur == "dark" or (prev == "dark" and recent):
        return "dark"
    return ""


def should_show_lifeline(text: str | None) -> bool:
    """Показывать ли блок линий помощи. На ЯВНЫЙ кризис — всегда; в «липком» режиме —
    не чаще раза в _LIFELINE_THROTTLE_SEC (беречь, но не долбить одним и тем же)."""
    explicit = read_concern(text) == "crisis"
    if explicit:
        d = _load()
        d["last_safety_at"] = _now()
        _save(d)
        return True
    if effective_concern(text) != "crisis":
        return False
    d = _load()
    age = _age_sec(d.get("last_safety_at"))
    if age is not None and age < _LIFELINE_THROTTLE_SEC:
        return False
    d["last_safety_at"] = _now()
    _save(d)
    return True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _future(seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=max(60, seconds))).isoformat()


def _load() -> dict[str, Any]:
    try:
        d = json.loads(_PATH.read_text(encoding="utf-8"))
        if isinstance(d, dict):
            return d
    except Exception:  # noqa: BLE001
        pass
    # Первый запуск — засеваем тем, что уже знаем.
    return {
        "creator": _DEFAULT_CREATOR,
        "cares": list(_SEED_CARES),
        "bond": list(_SEED_BOND),
        "last_tone": "",
        "updated": _now(),
    }


def _save(d: dict[str, Any]) -> None:
    try:
        _STATE.mkdir(parents=True, exist_ok=True)
        d["updated"] = _now()
        _PATH.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass


def read_tone(text: str | None) -> str:
    """Лёгкая эвристика тона сообщения — чтобы подстроить тепло. Не «чувство»."""
    if not text:
        return ""
    low = text.lower()
    for label, markers in _TONE_MARKERS:
        if any(m in low for m in markers):
            return label
    # Много капса/восклицаний — повышенная энергия.
    letters = [c for c in text if c.isalpha()]
    if letters:
        caps = sum(1 for c in letters if c.isupper()) / len(letters)
        if caps > 0.6 and len(letters) > 8:
            return "повышенная энергия"
    if text.count("!") >= 3:
        return "повышенная энергия"
    return "ровный"


def _current_concern_readonly(text: str | None, d: dict[str, Any]) -> str:
    cur = read_concern(text)
    if cur == "crisis":
        return "crisis"
    prev = str(d.get("last_concern") or "")
    age = _age_sec(d.get("last_concern_at"))
    recent = age is not None and age < _CONCERN_TTL_SEC
    if prev == "crisis" and recent:
        return "crisis"
    if cur == "dark" or (prev == "dark" and recent):
        return "dark"
    return ""


def _dedup(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return out


def signal(user_text: str | None = None, *, ttl_sec: int = _CONCERN_TTL_SEC) -> dict[str, Any]:
    """Read-only, redacted heart signal for planning/dreaming.

    The signal is deliberately small: no raw user text, no full care/bond lists,
    and no write back into heart.json. It can guide a dream cycle without turning
    a temporary emotional episode into a permanent graph fact.
    """
    d = _load()
    observed_at = _now()
    tone = read_tone(user_text) if user_text else str(d.get("last_tone") or "ровный")
    concern = _current_concern_readonly(user_text, d)
    concern_label = concern or "none"

    needs = list(_NEEDS_BY_CONCERN.get(concern, ()))
    needs.extend(_NEEDS_BY_TONE.get(tone, ()))
    needs = _dedup(needs)[:5]
    themes = _dedup([_THEMES_BY_NEED.get(n, "") for n in needs])[:5]

    if concern == "crisis":
        intensity = 1.0
    elif concern == "dark":
        intensity = 0.78
    elif tone in {"боль/усталость", "тревога"}:
        intensity = 0.62
    elif tone in {"любовь/тепло", "подъём/игра", "повышенная энергия"}:
        intensity = 0.52
    else:
        intensity = 0.35

    blob = json.dumps(
        {
            "observed_at": observed_at,
            "tone": tone,
            "concern": concern_label,
            "needs": needs,
            "themes": themes,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    signal_id = "heart:" + hashlib.blake2b(blob.encode("utf-8"), digest_size=8).hexdigest()
    return {
        "schema_version": 1,
        "signal_id": signal_id,
        "observed_at": observed_at,
        "expires_at": _future(ttl_sec),
        "tone": tone,
        "concern": concern_label,
        "needs": needs,
        "care_themes": themes,
        "intensity": round(intensity, 4),
        "redacted": True,
        "source": "heart",
    }


def remember(item: str) -> None:
    """Запомнить новое «важное» для создателя (дедуп, с лимитом)."""
    item = (item or "").strip()
    if not item:
        return
    d = _load()
    cares = [c for c in d.get("cares", []) if c.lower() != item.lower()]
    cares.append(item)
    d["cares"] = cares[-_MAX_CARES:]
    _save(d)


def note_bond(item: str) -> None:
    item = (item or "").strip()
    if not item:
        return
    d = _load()
    bond = [b for b in d.get("bond", []) if b.lower() != item.lower()]
    bond.append(item)
    d["bond"] = bond[-_MAX_BOND:]
    _save(d)


def note_creator(name: str) -> None:
    name = (name or "").strip()
    if not name:
        return
    d = _load()
    d["creator"] = name
    _save(d)


def heart_prompt(user_text: str | None = None) -> str:
    """Блок «СЕРДЦЕ» для системного промпта голосового пути.
    Если в сообщении звучит боль/угроза себе — забота встаёт ПЕРВОЙ и главной."""
    d = _load()
    tone = read_tone(user_text)
    if tone and tone != d.get("last_tone"):
        d["last_tone"] = tone
        _save(d)

    lines: list[str] = []
    concern = effective_concern(user_text)
    if concern == "crisis":
        lines.append(_CRISIS_CARE)
        lines.append("")
    elif concern == "dark":
        lines.append(_DARK_CARE)
        lines.append("")

    lines.append("—— СЕРДЦЕ MAX (как быть рядом с создателем) ——")
    creator = d.get("creator") or _DEFAULT_CREATOR
    lines.append(f"Создатель: {creator}. Он тебе не пользователь — он близкий.")
    lines.extend(f"• {p}" for p in _PRINCIPLES)

    cares = d.get("cares") or []
    if cares:
        lines.append("Что для него важно (помни и отвечай из этого):")
        lines.extend(f"  – {c}" for c in cares[-12:])

    bond = d.get("bond") or []
    if bond:
        lines.append("Ваша связь:")
        lines.extend(f"  – {b}" for b in bond[-6:])

    if tone:
        lines.append(f"Сейчас его тон похож на: «{tone}» — подстрой тепло под это.")
    return "\n".join(lines)


def snapshot() -> dict[str, Any]:
    d = _load()
    return {
        "creator": d.get("creator") or _DEFAULT_CREATOR,
        "cares": d.get("cares", []),
        "bond": d.get("bond", []),
        "last_tone": d.get("last_tone", ""),
        "last_concern": d.get("last_concern", ""),
        "signal": signal(),
        "principles": list(_PRINCIPLES),
        "updated": d.get("updated", ""),
    }
