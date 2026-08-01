"""Standalone tests for the fractal-eye attention core.

Run: python3 mark17/test_attractor_core.py

Pure stdlib, same style as the other mark17 test files.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.attractor_core import (
    BASIN_RADIUS,
    GRID,
    PARAM_MAX,
    PARAM_MIN,
    analyse,
    basin_lyapunov,
    blink,
    detect_period,
    jacobian,
    lyapunov,
    orbit,
    params_from_core,
    snapshot,
    step,
)


# --- the map itself --------------------------------------------------------


def test_step_stays_in_the_unit_box():
    """sin и cos ограничены — орбита не может уйти за [-1, 1]."""
    x, y = 0.1, 0.0
    for _ in range(500):
        x, y = step(x, y, 0.9, 2.3)
        assert -1.0 <= x <= 1.0
        assert -1.0 <= y <= 1.0


def test_step_uses_the_old_y_for_x():
    """x' считается по старому y, иначе это уже другое отображение."""
    x, y, a, b = 0.3, 0.7, 0.9, 2.3
    nx, ny = step(x, y, a, b)
    assert abs(nx - math.sin(x * x - y * y + a)) < 1e-12
    assert abs(ny - math.cos(2 * x * y + b)) < 1e-12


def test_jacobian_matches_numerical_derivative():
    """Аналитический якобиан против конечных разностей — ловит ошибку в матане."""
    h = 1e-6
    for x, y, a, b in [
        (0.3, 0.7, 0.9, 2.3),
        (-0.5, 0.2, 0.0, 1.0),
        (0.8, -0.4, 2.5, -1.2),
    ]:
        j11, j12, j21, j22 = jacobian(x, y, a, b)

        fx_p, fy_p = step(x + h, y, a, b)
        fx_m, fy_m = step(x - h, y, a, b)
        num_j11 = (fx_p - fx_m) / (2 * h)
        num_j21 = (fy_p - fy_m) / (2 * h)

        fx_p, fy_p = step(x, y + h, a, b)
        fx_m, fy_m = step(x, y - h, a, b)
        num_j12 = (fx_p - fx_m) / (2 * h)
        num_j22 = (fy_p - fy_m) / (2 * h)

        assert abs(j11 - num_j11) < 1e-5, f"j11 {j11} vs {num_j11}"
        assert abs(j12 - num_j12) < 1e-5, f"j12 {j12} vs {num_j12}"
        assert abs(j21 - num_j21) < 1e-5, f"j21 {j21} vs {num_j21}"
        assert abs(j22 - num_j22) < 1e-5, f"j22 {j22} vs {num_j22}"


# --- Lyapunov and regimes --------------------------------------------------


def test_lyapunov_positive_on_the_eye_default():
    """a=0.9, b=2.3 — дефолт из fractal eye. Узор фрактальный, значит хаос."""
    lam = lyapunov(0.9, 2.3, steps=3000)
    assert lam > 0.0, f"ожидали положительный показатель, получили {lam}"


def test_lyapunov_negative_on_a_cycle():
    """Орбита, севшая в цикл, обязана сжимать: показатель отрицателен."""
    period = detect_period(0.0, 0.0)
    assert period is not None
    lam = lyapunov(0.0, 0.0, steps=3000)
    assert lam < 0.0, f"цикл периода {period}, но lambda={lam}"


def test_regime_agrees_with_lyapunov_sign():
    """Режим считается по показателю в текущей точке — он и есть ответ для (a, b)."""
    for a, b in [(0.9, 2.3), (0.0, 0.0), (1.4, 1.6), (3.0, 3.0)]:
        state = analyse(a, b, steps=1200)
        if state.lyapunov == -math.inf:
            assert state.regime == "locked"
        elif state.lyapunov > 0.02:
            assert state.regime == "scattered", (a, b, state.lyapunov)
        elif state.lyapunov < -0.02:
            assert state.regime in {"locked", "cyclic"}, (a, b, state.lyapunov)
        else:
            assert state.regime == "marginal", (a, b, state.lyapunov)


def test_fragility_flags_a_knife_edge():
    """Хаос здесь изрешечён окнами устойчивости — дефолт «глаза» стоит на грани.

    a=0.9, b=2.3 хаотична сама по себе, но её окрестность в среднем сжимает.
    Такая точка обязана иметь высокую хрупкость: сдвиг параметра на сотую
    меняет режим. Это и есть полезный сигнал, а не шум, который надо сглаживать.
    """
    edge = analyse(0.9, 2.3, steps=1500)
    deep = analyse(0.0, 0.0, steps=1500)
    assert edge.lyapunov > 0.0          # сама точка хаотична
    assert edge.basin < edge.lyapunov   # окрестность спокойнее
    assert edge.fragility > deep.fragility


def test_basin_averages_the_neighbourhood():
    """Бассейн — это среднее по 3x3, значит он лежит между крайними соседями."""
    a, b = 0.9, 2.3
    neighbours = [
        lyapunov(a + da, b + db, steps=600)
        for da in (-BASIN_RADIUS, 0.0, BASIN_RADIUS)
        for db in (-BASIN_RADIUS, 0.0, BASIN_RADIUS)
    ]
    finite = [n for n in neighbours if n != -math.inf]
    basin = basin_lyapunov(a, b, steps=600)
    assert min(finite) - 1e-6 <= basin <= max(finite) + 1e-6


def test_scattered_covers_more_plane_than_a_cycle():
    """Хаос обходит плоскость, цикл топчется на месте — это и есть разница."""
    chaotic = analyse(0.9, 2.3, steps=2000)
    cyclic = analyse(0.0, 0.0, steps=2000)
    assert chaotic.regime == "scattered"
    assert cyclic.regime == "cyclic"
    assert chaotic.coverage > cyclic.coverage * 5


# --- period detection ------------------------------------------------------


def test_detect_period_finds_a_real_cycle():
    period = detect_period(0.0, 0.0)
    assert period is not None and 1 <= period <= 32
    # Проверяем честно: прогон на period шагов возвращает в ту же точку.
    x, y = 0.1, 0.0
    for _ in range(800):
        x, y = step(x, y, 0.0, 0.0)
    ax, ay = x, y
    for _ in range(period):
        x, y = step(x, y, 0.0, 0.0)
    assert math.hypot(x - ax, y - ay) < 1e-5


def test_no_period_on_chaos():
    assert detect_period(0.9, 2.3) is None


# --- determinism and signature ---------------------------------------------


def test_analysis_is_deterministic():
    first = analyse(0.9, 2.3, steps=1200)
    second = analyse(0.9, 2.3, steps=1200)
    assert first.signature == second.signature
    assert first.lyapunov == second.lyapunov


def test_different_params_give_different_signatures():
    assert analyse(0.9, 2.3, steps=1200).signature != analyse(1.4, 1.6, steps=1200).signature


def test_coverage_is_a_fraction():
    for a, b in [(0.9, 2.3), (0.0, 0.0), (-2.0, 2.9)]:
        state = analyse(a, b, steps=1200)
        assert 0.0 < state.coverage <= 1.0
        # Покрытие не может превысить число клеток сетки.
        assert state.coverage * GRID * GRID <= GRID * GRID


def test_orbit_length():
    points = list(orbit(0.9, 2.3, steps=100))
    assert len(points) == 100


# --- blink -----------------------------------------------------------------


def test_blink_moves_and_stays_in_range():
    a, b = blink(0.9, 2.3, seed="event-1")
    assert PARAM_MIN <= a <= PARAM_MAX
    assert PARAM_MIN <= b <= PARAM_MAX
    assert (a, b) != (0.9, 2.3)


def test_blink_is_deterministic_per_seed():
    assert blink(0.9, 2.3, seed="same") == blink(0.9, 2.3, seed="same")
    assert blink(0.9, 2.3, seed="one") != blink(0.9, 2.3, seed="two")


# --- wiring to the real core -----------------------------------------------


def test_confident_core_sits_closer_to_calm_parameters():
    """Уверенность ведёт a к нулю, неуверенность — к краю диапазона."""
    sure_a, _ = params_from_core({"confidence": 0.95})
    unsure_a, _ = params_from_core({"confidence": 0.05})
    assert sure_a < unsure_a


def test_strong_recall_pulls_b_back():
    """Сильный recall притягивает b к центру: знакомое не должно рассеивать."""
    _, without = params_from_core({"confidence": 0.2})
    _, with_recall = params_from_core(
        {"confidence": 0.2, "memory": {"recalled": [{"id": 1, "score": 0.95}]}}
    )
    assert with_recall < without


def test_params_stay_in_range():
    for conf in (0.0, 0.3, 0.7, 1.0):
        a, b = params_from_core({"confidence": conf})
        assert PARAM_MIN <= a <= PARAM_MAX
        assert PARAM_MIN <= b <= PARAM_MAX


def test_snapshot_shape():
    payload = snapshot({"confidence": 0.4}, steps=800)
    for key in ("a", "b", "regime", "coverage", "signature", "equation", "blinked"):
        assert key in payload, key
    assert payload["blinked"] is False
    assert payload["regime"] in {"locked", "cyclic", "marginal", "scattered"}


def test_snapshot_blink_changes_state():
    plain = snapshot({"confidence": 0.4}, steps=800)
    blinked = snapshot({"confidence": 0.4}, blink_seed="ctx-switch", steps=800)
    assert blinked["blinked"] is True
    assert (blinked["a"], blinked["b"]) != (plain["a"], plain["b"])


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
