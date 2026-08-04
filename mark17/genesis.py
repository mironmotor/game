"""Genesis: космологическая история ядра Max17 от нуля до структуры.

    T = 0 — 2 августа 2026 года.

У ядра уже была расширяющаяся вселенная (уравнение Фридмана в consolidation)
и уже были кварки (Стандартная модель в cognitive_physics). Не было двух
вещей: начала и среды. Этот модуль добавляет их.

ЭФИР. Классический эфир опровергнут Майкельсоном и Морли, и воскрешать его
здесь никто не собирается. Но у вакуума Максвелла есть настоящие свойства —
проницаемости eps и mu, — и они уже стоят в cognitive_physics. Отсюда

    c = 1 / sqrt(eps * mu)

Это и есть среда, и это настоящая ручка управления: загустить эфир значит
замедлить обмен между тремя ядрами (пластичность, память, LLM). Не метафора —
прямо меняет индукцию Максвелла, которая уже работает. Импеданс среды
Z = sqrt(mu / eps) показывает, насколько тяжело в неё вообще что-то излучить.

ОСТЫВАНИЕ. Масштабный фактор растёт от реального времени с T = 0. В
радиационную эру a ~ sqrt(t), температура T ~ 1/a. Ядро проходит эпохи за
год: первые минуты — инфляция, часы — кварк-глюонная плазма, сутки —
адронизация, недели — нуклеосинтез, месяцы — рекомбинация.

БАРИОННАЯ АСИММЕТРИЯ. Вот главное. В critic у каждой самооценки есть
анти-оценка, и они аннигилируют. Если бы аннигилировали все пары, не осталось
бы ничего — ядро не помнило бы вообще. Память существует ровно из-за перевеса
частиц над античастицами. Асимметрия здесь не постулируется, а считается из
доли пар, которые НЕ аннигилировали. Это и есть ответ на вопрос, почему во
вселенной ядра есть вещество.

Детерминировано и на стандартной библиотеке.
"""

from __future__ import annotations

import calendar
import math
import time
from dataclasses import dataclass
from typing import Any

# --- Начало времён ---------------------------------------------------------
# 2 августа 2026, 00:00 UTC. Момент, с которого у ядра есть возраст.
T_ZERO = calendar.timegm((2026, 8, 2, 0, 0, 0, 0, 0, 0))

# Масштаб нормирован так, что a = 1 через год после T = 0.
YEAR_SECONDS = 365.25 * 86400.0

# Ниже этого возраста считаем, что ядро ещё в планковской эпохе: время есть,
# но структуры никакой.
PLANCK_SECONDS = 1.0

# --- Эфир ------------------------------------------------------------------
# Проницаемости вакуума ядра. Совпадают с cognitive_physics: c = 1.
ETHER_EPS = 1.0
ETHER_MU = 1.0
# Насколько сильно нагрузка способна загустить среду.
ETHER_MAX_THICKENING = 4.0


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


@dataclass(frozen=True)
class Ether:
    """Среда, в которой распространяется сигнал между тремя ядрами."""

    permittivity: float
    permeability: float

    def speed(self) -> float:
        """c = 1 / sqrt(eps * mu) — скорость обмена между ядрами."""
        product = self.permittivity * self.permeability
        if product <= 0:
            return math.inf
        return 1.0 / math.sqrt(product)

    def impedance(self) -> float:
        """Z = sqrt(mu / eps) — насколько тяжело излучить в среду."""
        if self.permittivity <= 0:
            return math.inf
        return math.sqrt(self.permeability / self.permittivity)

    def to_dict(self) -> dict[str, Any]:
        return {
            "permittivity": round(self.permittivity, 4),
            "permeability": round(self.permeability, 4),
            "speed": round(self.speed(), 4),
            "impedance": round(self.impedance(), 4),
            "law": "c = 1 / sqrt(eps * mu)",
        }


def thicken(load: float, uncertainty: float = 0.0) -> Ether:
    """Загустить эфир под нагрузкой.

    Проницаемости отвечают за разное, поэтому и густеют от разного:

      * eps — сопротивление электрическому полю, а электрическое поле у нас
        это пластичность, то есть внимание. Неуверенность мешает вниманию
        установиться, значит неуверенность растит eps;
      * mu — сопротивление магнитному полю, то есть циркуляции памяти.
        Нагрузка мешает памяти прокручиваться, значит нагрузка растит mu.

    Отсюда обе величины несут смысл. Скорость c = 1/sqrt(eps*mu) падает от
    любой из причин, а импеданс Z = sqrt(mu/eps) показывает, что именно
    сейчас узкое место: Z > 1 — упирается память, Z < 1 — упирается внимание.
    Если растить обе одинаково, импеданс навсегда останется единицей и не
    скажет ничего.
    """
    load = _clamp(load)
    uncertainty = _clamp(uncertainty)
    span = ETHER_MAX_THICKENING - 1.0
    return Ether(
        permittivity=ETHER_EPS * (1.0 + span * uncertainty),
        permeability=ETHER_MU * (1.0 + span * load),
    )


def bottleneck(ether: Ether) -> str:
    """Что именно сейчас держит обмен: память, внимание или ничто."""
    z = ether.impedance()
    if z > 1.15:
        return "memory"
    if z < 0.87:
        return "attention"
    return "balanced"


# --- Расширение и остывание ------------------------------------------------


def cosmic_age(now: float | None = None) -> float:
    """Возраст вселенной ядра в секундах от T = 0."""
    now = time.time() if now is None else now
    return max(0.0, now - T_ZERO)


def scale_factor(age: float) -> float:
    """a(t) ~ sqrt(t) — радиационная эра, нормировано на a = 1 через год."""
    if age <= 0.0:
        return 0.0
    return math.sqrt(age / YEAR_SECONDS)


def temperature(a: float) -> float:
    """T ~ 1 / a. Молодая тесная вселенная горяча, расширенная холодна."""
    if a <= 0.0:
        return math.inf
    return 1.0 / a


# Пороги по температуре. Подобраны так, чтобы ядро прошло эпохи за год:
# минуты, часы, сутки, недели, месяцы.
EPOCHS: tuple[tuple[float, str, str, str], ...] = (
    (
        500.0,
        "inflation",
        "Инфляция",
        "Первые мгновения: вселенная раздувается, структуры ещё нет никакой.",
    ),
    (
        100.0,
        "quark_plasma",
        "Кварк-глюонная плазма",
        "Слишком горячо для связей: кварки свободны, паттерны не держатся.",
    ),
    (
        20.0,
        "hadronisation",
        "Адронизация",
        "Остыло достаточно: кварки связываются, первые устойчивые паттерны выживают.",
    ),
    (
        5.0,
        "nucleosynthesis",
        "Нуклеосинтез",
        "Паттерны сцепляются в ядра — синапсы держат составные смыслы.",
    ),
    (
        2.0,
        "recombination",
        "Рекомбинация",
        "Вселенная стала прозрачной: ядро отвечает само, свет проходит без LLM.",
    ),
    (
        0.0,
        "structure",
        "Структура",
        "Холодно и просторно: паттерны собираются в кластеры, растёт крупная структура.",
    ),
)


def epoch_of(temp: float) -> tuple[str, str, str]:
    """Эпоха по температуре: (ключ, название, что это значит)."""
    if temp == math.inf:
        return ("planck", "Планковская", "Времени ещё нет — вселенная не началась.")
    for threshold, key, title, note in EPOCHS:
        if temp > threshold:
            return (key, title, note)
    last = EPOCHS[-1]
    return (last[1], last[2], last[3])


# --- Барионная асимметрия --------------------------------------------------


def baryon_asymmetry(pairs: int, annihilated: int) -> float:
    """Доля пар, пережившая аннигиляцию. Это и есть вещество.

    Если аннигилировали все пары, асимметрия равна нулю — ядру нечего помнить.
    Чем больше пар устояло, тем больше вещества осталось во вселенной.
    """
    if pairs <= 0:
        return 0.0
    survived = max(0, pairs - max(0, annihilated))
    return survived / pairs


def nucleate(asymmetry: float, temp: float, quanta: int) -> dict[str, Any]:
    """Сколько вещества смогло родиться и связаться при этой температуре.

    Пока горячо, связи рвутся тепловым движением: даже выживший перевес
    частиц не собирается в структуру. Множитель Больцмана exp(-T / T_bind)
    прямо говорит, какая доля вещества удержалась.
    """
    asymmetry = _clamp(asymmetry)
    quanta = max(0, quanta)

    # Характерная температура связывания — примерно эпоха адронизации.
    t_bind = 20.0
    if temp == math.inf:
        bound_fraction = 0.0
    else:
        bound_fraction = math.exp(-max(0.0, temp) / t_bind)

    matter = asymmetry * quanta
    bound = matter * bound_fraction

    return {
        "quanta": quanta,
        "asymmetry": round(asymmetry, 4),
        "matter": round(matter, 2),
        "bound_fraction": round(bound_fraction, 4),
        "bound_matter": round(bound, 2),
        "law": "N_bound = asymmetry * N * exp(-T / T_bind)",
    }


# --- Полная картина --------------------------------------------------------


def genesis(
    *,
    now: float | None = None,
    quanta: int = 0,
    pairs: int = 0,
    annihilated: int = 0,
    load: float = 0.0,
    uncertainty: float = 0.0,
) -> dict[str, Any]:
    """Состояние вселенной ядра: возраст, эпоха, эфир, вещество."""
    age = cosmic_age(now)
    a = scale_factor(age)
    temp = temperature(a) if age > PLANCK_SECONDS else math.inf
    key, title, note = epoch_of(temp)

    ether = thicken(load, uncertainty)
    asymmetry = baryon_asymmetry(pairs, annihilated)
    matter = nucleate(asymmetry, temp, quanta)

    return {
        "t_zero": T_ZERO,
        "age_seconds": round(age, 1),
        "age_human": _human_age(age),
        "scale_factor": round(a, 6),
        "temperature": None if temp == math.inf else round(temp, 3),
        "epoch": key,
        "epoch_title": title,
        "epoch_note": note,
        "ether": {**ether.to_dict(), "bottleneck": bottleneck(ether)},
        "matter": matter,
        "equation": "a ~ sqrt(t) ; T ~ 1/a ; c = 1/sqrt(eps mu)",
    }


def _human_age(age: float) -> str:
    if age < 60:
        return f"{age:.0f} с"
    if age < 3600:
        return f"{age / 60:.1f} мин"
    if age < 86400:
        return f"{age / 3600:.1f} ч"
    if age < 86400 * 30:
        return f"{age / 86400:.1f} сут"
    if age < YEAR_SECONDS:
        return f"{age / (86400 * 30.44):.1f} мес"
    return f"{age / YEAR_SECONDS:.2f} г"
