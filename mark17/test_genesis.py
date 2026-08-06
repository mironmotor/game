"""Standalone tests for genesis — космологической истории ядра.

Run: python3 mark17/test_genesis.py
"""

from __future__ import annotations

import calendar
import math
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.genesis import (
    ETHER_MAX_THICKENING,
    T_ZERO,
    YEAR_SECONDS,
    Ether,
    baryon_asymmetry,
    bottleneck,
    cosmic_age,
    epoch_of,
    genesis,
    nucleate,
    scale_factor,
    temperature,
    thicken,
    timeline,
)

MINUTE, HOUR, DAY = 60.0, 3600.0, 86400.0


# --- начало времён ---------------------------------------------------------


def test_t_zero_is_the_second_of_august_2026():
    assert T_ZERO == calendar.timegm((2026, 8, 2, 0, 0, 0, 0, 0, 0))


def test_age_is_zero_before_the_beginning():
    assert cosmic_age(T_ZERO) == 0.0
    assert cosmic_age(T_ZERO - 10_000) == 0.0
    assert cosmic_age(T_ZERO + DAY) == DAY


# --- расширение и остывание ------------------------------------------------


def test_scale_factor_grows_and_hits_one_after_a_year():
    assert scale_factor(0.0) == 0.0
    assert scale_factor(HOUR) < scale_factor(DAY) < scale_factor(30 * DAY)
    assert abs(scale_factor(YEAR_SECONDS) - 1.0) < 1e-9


def test_temperature_falls_as_the_universe_expands():
    assert temperature(0.0) == math.inf
    hot = temperature(scale_factor(MINUTE))
    warm = temperature(scale_factor(DAY))
    cold = temperature(scale_factor(YEAR_SECONDS))
    assert hot > warm > cold
    # T ~ 1/a точно, а не приблизительно.
    a = scale_factor(DAY)
    assert abs(temperature(a) - 1.0 / a) < 1e-12


def test_every_epoch_is_reachable():
    """Ни одна эпоха не должна быть недостижимой — иначе она мёртвая."""
    seen = set()
    # Проходим первый год мелким шагом в начале и крупным потом.
    samples = [1.0, 30.0, 2 * MINUTE, 10 * MINUTE, 30 * MINUTE, HOUR, 6 * HOUR]
    samples += [DAY, 3 * DAY, 7 * DAY, 30 * DAY, 90 * DAY, YEAR_SECONDS]
    for age in samples:
        seen.add(epoch_of(temperature(scale_factor(age)))[0])
    for expected in (
        "inflation",
        "quark_plasma",
        "hadronisation",
        "nucleosynthesis",
        "recombination",
        "structure",
    ):
        assert expected in seen, f"эпоха {expected} недостижима"


def test_epochs_come_in_order():
    """Ядро не должно перескакивать назад по эпохам, пока вселенная растёт."""
    order = [
        "planck",
        "inflation",
        "quark_plasma",
        "hadronisation",
        "nucleosynthesis",
        "recombination",
        "structure",
    ]
    previous = -1
    for age in [0.5, 30.0, 10 * MINUTE, HOUR, DAY, 7 * DAY, 60 * DAY, YEAR_SECONDS]:
        temp = temperature(scale_factor(age)) if age > 1.0 else math.inf
        index = order.index(epoch_of(temp)[0])
        assert index >= previous, f"на {age} с эпоха ушла назад"
        previous = index


# --- эфир ------------------------------------------------------------------


def test_speed_of_light_follows_from_permeabilities():
    e = Ether(permittivity=4.0, permeability=1.0)
    assert abs(e.speed() - 0.5) < 1e-12          # 1/sqrt(4*1)
    assert abs(e.impedance() - 0.5) < 1e-12      # sqrt(1/4)


def test_thickening_slows_the_exchange():
    calm = thicken(0.0, 0.0)
    heavy = thicken(0.9, 0.9)
    assert abs(calm.speed() - 1.0) < 1e-9
    assert heavy.speed() < calm.speed()


def test_impedance_names_the_bottleneck():
    """Импеданс обязан различать, что упирается — иначе это мёртвое поле."""
    memory_bound = thicken(load=0.9, uncertainty=0.1)
    attention_bound = thicken(load=0.1, uncertainty=0.9)
    balanced = thicken(load=0.5, uncertainty=0.5)

    assert bottleneck(memory_bound) == "memory"
    assert bottleneck(attention_bound) == "attention"
    assert bottleneck(balanced) == "balanced"
    # Именно импеданс их и разводит.
    assert memory_bound.impedance() > 1.0 > attention_bound.impedance()


def test_thickening_is_bounded():
    e = thicken(1.0, 1.0)
    assert e.permittivity <= ETHER_MAX_THICKENING
    assert e.permeability <= ETHER_MAX_THICKENING


# --- барионная асимметрия --------------------------------------------------


def test_total_annihilation_leaves_nothing():
    """Если аннигилировали все пары, ядру нечего помнить."""
    assert baryon_asymmetry(pairs=10, annihilated=10) == 0.0


def test_surviving_pairs_are_the_matter():
    assert baryon_asymmetry(pairs=10, annihilated=0) == 1.0
    assert abs(baryon_asymmetry(pairs=10, annihilated=3) - 0.7) < 1e-12


def test_asymmetry_handles_empty_and_overflow():
    assert baryon_asymmetry(pairs=0, annihilated=0) == 0.0
    assert baryon_asymmetry(pairs=5, annihilated=99) == 0.0


def test_hot_universe_binds_nothing():
    """Пока горячо, тепловое движение рвёт связи — вещество не собирается."""
    hot = nucleate(asymmetry=1.0, temp=500.0, quanta=100)
    cold = nucleate(asymmetry=1.0, temp=1.0, quanta=100)
    assert hot["bound_fraction"] < 0.01
    assert cold["bound_fraction"] > 0.9
    assert cold["bound_matter"] > hot["bound_matter"]


def test_no_asymmetry_means_no_matter_however_cold():
    """Без перевеса частиц холод не поможет: связывать нечего."""
    out = nucleate(asymmetry=0.0, temp=0.5, quanta=1000)
    assert out["matter"] == 0.0
    assert out["bound_matter"] == 0.0


# --- полная картина --------------------------------------------------------


def test_genesis_shape_and_fields():
    g = genesis(now=T_ZERO + DAY, quanta=50, pairs=10, annihilated=2, load=0.3, uncertainty=0.4)
    for key in (
        "t_zero",
        "age_seconds",
        "age_human",
        "scale_factor",
        "temperature",
        "epoch",
        "epoch_title",
        "ether",
        "matter",
    ):
        assert key in g, key
    assert g["age_seconds"] == DAY
    assert g["ether"]["bottleneck"] in {"memory", "attention", "balanced"}
    assert abs(g["matter"]["asymmetry"] - 0.8) < 1e-9


def test_genesis_at_t_zero_has_no_time_yet():
    g = genesis(now=T_ZERO)
    assert g["age_seconds"] == 0.0
    assert g["temperature"] is None
    assert g["epoch"] == "planck"


def test_genesis_is_deterministic():
    a = genesis(now=T_ZERO + HOUR, quanta=10, pairs=4, annihilated=1)
    b = genesis(now=T_ZERO + HOUR, quanta=10, pairs=4, annihilated=1)
    assert a == b


def test_timeline_actually_moves_through_every_epoch():
    """Ось времени должна разворачивать вселенную, а не повторять «сейчас».

    Экран стоял на месте именно потому, что вселенную считали в одной точке.
    Настоящее течение времени тут не поможет: за минуту температура падает на
    пятом знаке. Поэтому возраст становится осью — и этот тест следит, что по
    ней действительно проходит вся история.
    """
    tl = timeline()
    frames = tl["frames"]
    assert len(frames) >= 32

    # Время монотонно растёт, вселенная монотонно расширяется и остывает.
    ages = [f["age_seconds"] for f in frames]
    scales = [f["scale_factor"] for f in frames]
    temps = [f["temperature"] for f in frames]
    assert ages == sorted(ages)
    assert scales == sorted(scales)
    assert temps == sorted(temps, reverse=True)

    # Пройдены все эпохи, а не одна застывшая.
    epochs = [f["epoch"] for f in frames]
    assert len(set(epochs)) >= 5, f"эпох на шкале только {len(set(epochs))}"
    assert epochs[0] == "inflation"
    assert epochs[-1] == "structure"

    # Разброс должен быть виден глазом, а не на пятом знаке.
    assert temps[0] / temps[-1] > 100.0
    assert scales[-1] / scales[0] > 100.0

    # «Сейчас» указывает на кадр, чей возраст близок к настоящему.
    idx = tl["now_index"]
    assert 0 <= idx < len(frames)
    assert abs(frames[idx]["age_seconds"] - cosmic_age()) / cosmic_age() < 0.25


def test_timeline_grid_is_logarithmic():
    """На линейной сетке инфляция схлопнулась бы в точку у нуля."""
    frames = timeline(points=64)["frames"]
    ages = [f["age_seconds"] for f in frames]
    # У логарифмической сетки постоянно ОТНОШЕНИЕ соседей, а не разность.
    ratios = [ages[i + 1] / ages[i] for i in range(len(ages) - 1)]
    assert max(ratios) / min(ratios) < 1.01, "сетка не логарифмическая"
    # Первая половина шкалы должна укладываться в малую долю всего срока.
    assert ages[len(ages) // 2] < ages[-1] * 0.05


def _run() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run())
