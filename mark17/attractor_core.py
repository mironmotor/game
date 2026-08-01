"""Fractal-eye attractor as the attention dynamics of the Max17 core.

    x_{n+1} = sin(x^2 - y^2 + a)
    y_{n+1} = cos(2xy + b)

Это не украшение. Заметь, что x^2 - y^2 и 2xy — это в точности Re(z^2) и
Im(z^2) для z = x + iy. То есть отображение — комплексный квадрат, обёрнутый
в тригонометрию:

    z_{n+1} = sin(Re z^2 + a) + i * cos(Im z^2 + b)

У такой системы есть настоящая динамика, а у динамики — измеримые величины.
Именно они и делают из картинки когнитивный модуль:

  * показатель Ляпунова — сходится внимание или разбегается. lambda < 0
    означает, что близкие состояния слипаются: ядро сфокусировано. lambda > 0
    означает экспоненциальное расхождение: внимание рассеяно, и любая мелочь
    уводит его в сторону. Это не метафора — это скорость потери информации о
    начальном состоянии, посчитанная по якобиану;
  * период орбиты — залипло ли внимание в цикле (навязчивое повторение) или
    движется свободно;
  * покрытие плоскости — сколько пространства состояний ядро реально
    обходит, а не сколько раз топчется на месте.

Параметры a и b берутся не с потолка, а из настоящего состояния ядра:
уверенность ведёт a, новизна ведёт b. Моргание (blink) — это скачок в новую
точку (a, b), то есть смена контекста, после которой узор внимания другой.

Детерминировано и на голой стандартной библиотеке, как и весь mark17.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Any, Iterator

# Диапазон параметров — тот же, что у ползунков в fractal eye.
PARAM_MIN = -math.pi
PARAM_MAX = math.pi

# Сколько шагов выбрасываем, пока орбита садится на аттрактор.
TRANSIENT = 200
# Длина рабочей орбиты.
ORBIT_STEPS = 2000
# Сетка для оценки покрытия плоскости.
GRID = 32
# Максимальный период, который ищем.
MAX_PERIOD = 32
# Допуск при поиске цикла.
PERIOD_EPS = 1e-6
# Ниже этого |lambda| считаем показатель нулевым — граница режима.
MARGINAL_BAND = 0.02
# Радиус окрестности в пространстве (a, b), по которой усредняем показатель.
# Хаос у этого отображения лежит вкраплениями: точечный замер скачет от
# микроскопического сдвига параметров и потому бесполезен как сигнал о
# состоянии ядра. Усреднение по окрестности меряет бассейн, а не точку.
BASIN_RADIUS = 0.12


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def step(x: float, y: float, a: float, b: float) -> tuple[float, float]:
    """Один шаг отображения. Порядок важен: x' считается по старому y."""
    nx = math.sin(x * x - y * y + a)
    ny = math.cos(2.0 * x * y + b)
    return nx, ny


def jacobian(x: float, y: float, a: float, b: float) -> tuple[float, float, float, float]:
    """Якобиан отображения в точке (x, y).

    u = x^2 - y^2 + a,  v = 2xy + b
        dx'/dx =  cos(u) * 2x      dx'/dy = -cos(u) * 2y
        dy'/dx = -sin(v) * 2y      dy'/dy = -sin(v) * 2x
    """
    cu = math.cos(x * x - y * y + a)
    sv = math.sin(2.0 * x * y + b)
    return (cu * 2.0 * x, -cu * 2.0 * y, -sv * 2.0 * y, -sv * 2.0 * x)


def orbit(
    a: float,
    b: float,
    *,
    x0: float = 0.1,
    y0: float = 0.0,
    steps: int = ORBIT_STEPS,
    transient: int = TRANSIENT,
) -> Iterator[tuple[float, float]]:
    """Орбита после того, как переходный процесс улёгся."""
    x, y = x0, y0
    for _ in range(max(0, transient)):
        x, y = step(x, y, a, b)
    for _ in range(max(1, steps)):
        x, y = step(x, y, a, b)
        yield x, y


def lyapunov(
    a: float,
    b: float,
    *,
    x0: float = 0.1,
    y0: float = 0.0,
    steps: int = ORBIT_STEPS,
    transient: int = TRANSIENT,
) -> float:
    """Старший показатель Ляпунова через касательный вектор.

    Ведём вдоль орбиты касательный вектор, на каждом шаге умножаем его на
    якобиан, копим логарифм роста и перенормируем. Среднее по шагам и есть
    скорость экспоненциального разбегания близких состояний.
    """
    x, y = x0, y0
    for _ in range(max(0, transient)):
        x, y = step(x, y, a, b)

    # Начальный касательный вектор единичной длины.
    vx, vy = 1.0, 0.0
    total = 0.0
    counted = 0

    for _ in range(max(1, steps)):
        j11, j12, j21, j22 = jacobian(x, y, a, b)
        nvx = j11 * vx + j12 * vy
        nvy = j21 * vx + j22 * vy
        norm = math.hypot(nvx, nvy)

        if norm <= 1e-300:
            # Касательный вектор схлопнулся: сжатие абсолютное, орбита села
            # в точку. Дальше логарифм считать нечего.
            return -math.inf
        total += math.log(norm)
        counted += 1
        vx, vy = nvx / norm, nvy / norm

        x, y = step(x, y, a, b)

    return total / counted if counted else 0.0


def detect_period(
    a: float,
    b: float,
    *,
    x0: float = 0.1,
    y0: float = 0.0,
    transient: int = TRANSIENT * 4,
    max_period: int = MAX_PERIOD,
    eps: float = PERIOD_EPS,
) -> int | None:
    """Период цикла, если орбита в него села. None — цикла не нашли."""
    x, y = x0, y0
    for _ in range(max(0, transient)):
        x, y = step(x, y, a, b)

    anchor = (x, y)
    px, py = x, y
    for period in range(1, max(1, max_period) + 1):
        px, py = step(px, py, a, b)
        if math.hypot(px - anchor[0], py - anchor[1]) < eps:
            return period
    return None


def _sign(lam: float) -> int:
    """Знак показателя с учётом полосы марginality: -1 сжатие, +1 хаос, 0 грань."""
    if lam > MARGINAL_BAND:
        return 1
    if lam < -MARGINAL_BAND:
        return -1
    return 0


def basin_profile(
    a: float,
    b: float,
    *,
    radius: float = BASIN_RADIUS,
    steps: int = ORBIT_STEPS // 2,
) -> tuple[float, float]:
    """Окрестность 3x3 вокруг (a, b): средний показатель и доля несогласных.

    Множество хаоса у этого отображения изрешечено окнами устойчивости.
    Поэтому важен не только показатель в точке, но и то, разделяют ли соседи
    её режим. Доля соседей с другим знаком — это и есть риск, что сдвиг
    параметров на сотую переключит внимание в другой режим.
    """
    centre = lyapunov(a, b, steps=steps)
    centre_sign = _sign(-5.0 if centre == -math.inf else centre)

    total = 0.0
    counted = 0
    disagree = 0
    neighbours = 0

    for da in (-radius, 0.0, radius):
        for db in (-radius, 0.0, radius):
            lam = lyapunov(
                max(PARAM_MIN, min(PARAM_MAX, a + da)),
                max(PARAM_MIN, min(PARAM_MAX, b + db)),
                steps=steps,
            )
            if lam == -math.inf:
                # Схлопнувшаяся точка: вклад максимального сжатия, но конечный,
                # иначе одна вырожденная точка утащит всё среднее в -inf.
                lam = -5.0
            total += lam
            counted += 1
            if da == 0.0 and db == 0.0:
                continue
            neighbours += 1
            if _sign(lam) != centre_sign:
                disagree += 1

    mean = total / counted if counted else 0.0
    fragility = disagree / neighbours if neighbours else 0.0
    return mean, fragility


def basin_lyapunov(
    a: float,
    b: float,
    *,
    radius: float = BASIN_RADIUS,
    steps: int = ORBIT_STEPS // 2,
) -> float:
    """Средний показатель Ляпунова по окрестности (a, b)."""
    return basin_profile(a, b, radius=radius, steps=steps)[0]


@dataclass(frozen=True)
class Attention:
    """Состояние внимания ядра как точка динамической системы."""

    a: float
    b: float
    x: float
    y: float
    lyapunov: float        # показатель в текущей точке — по нему и режим
    basin: float           # средний показатель по окрестности
    fragility: float       # |точка - окрестность|: насколько режим на грани
    regime: str            # "locked" | "cyclic" | "marginal" | "scattered"
    period: int | None
    coverage: float        # доля обойденных клеток плоскости, 0..1
    radius: float          # средний радиус орбиты
    dispersion: float      # разброс радиуса
    signature: str         # устойчивый отпечаток состояния
    note: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "a": round(self.a, 4),
            "b": round(self.b, 4),
            "x": round(self.x, 4),
            "y": round(self.y, 4),
            "lyapunov": (
                None if self.lyapunov == -math.inf else round(self.lyapunov, 4)
            ),
            "basin": round(self.basin, 4),
            "fragility": round(self.fragility, 4),
            "regime": self.regime,
            "period": self.period,
            "coverage": round(self.coverage, 4),
            "radius": round(self.radius, 4),
            "dispersion": round(self.dispersion, 4),
            "signature": self.signature,
            "note": self.note,
            "equation": "x' = sin(x^2 - y^2 + a) ; y' = cos(2xy + b)",
        }


def _classify(lam: float, period: int | None) -> tuple[str, str]:
    if lam == -math.inf:
        return "locked", "Внимание схлопнулось в точку — ядро смотрит в одно место."
    if period is not None and lam < -MARGINAL_BAND:
        return (
            "cyclic",
            f"Внимание залипло в цикле периода {period} — ядро ходит по кругу.",
        )
    if lam < -MARGINAL_BAND:
        return "locked", "Внимание сходится: близкие состояния слипаются, фокус держится."
    if lam > MARGINAL_BAND:
        return (
            "scattered",
            f"Внимание разбегается (lambda={lam:.3f}) — любая мелочь уводит ядро в сторону.",
        )
    return "marginal", "Внимание на границе устойчивости — ядро на грани срыва в хаос."


def analyse(
    a: float,
    b: float,
    *,
    x0: float = 0.1,
    y0: float = 0.0,
    steps: int = ORBIT_STEPS,
) -> Attention:
    """Полный разбор режима внимания при данных (a, b)."""
    a = max(PARAM_MIN, min(PARAM_MAX, float(a)))
    b = max(PARAM_MIN, min(PARAM_MAX, float(b)))

    cells: set[int] = set()
    radii: list[float] = []
    last = (x0, y0)

    for x, y in orbit(a, b, x0=x0, y0=y0, steps=steps):
        last = (x, y)
        radii.append(math.hypot(x, y))
        # Значения отображения лежат в [-1, 1] — раскладываем по сетке.
        gx = min(GRID - 1, max(0, int((x + 1.0) * 0.5 * GRID)))
        gy = min(GRID - 1, max(0, int((y + 1.0) * 0.5 * GRID)))
        cells.add(gy * GRID + gx)

    lam = lyapunov(a, b, x0=x0, y0=y0, steps=steps)
    basin, fragility = basin_profile(a, b, steps=max(300, steps // 2))
    period = detect_period(a, b, x0=x0, y0=y0)
    # Классифицируем по точке: для текущего (a, b) это и есть правильный ответ.
    # Бассейн идёт отдельно — как мера того, насколько режим устойчив к сдвигу.
    regime, note = _classify(lam, period)

    mean_r = sum(radii) / len(radii) if radii else 0.0
    if len(radii) > 1:
        var = sum((r - mean_r) ** 2 for r in radii) / len(radii)
        dispersion = math.sqrt(var)
    else:
        dispersion = 0.0

    # Отпечаток: занятые клетки сетки — устойчивая подпись узора внимания.
    digest = hashlib.blake2b(
        ",".join(str(c) for c in sorted(cells)).encode("utf-8"), digest_size=6
    ).hexdigest()

    return Attention(
        a=a,
        b=b,
        x=last[0],
        y=last[1],
        lyapunov=lam,
        basin=basin,
        # Доля соседей, у которых режим другой. Высокая хрупкость означает,
        # что внимание держится на волоске: сдвиг параметров на сотую — и
        # режим переключится.
        fragility=fragility,
        regime=regime,
        period=period,
        coverage=len(cells) / float(GRID * GRID),
        radius=mean_r,
        dispersion=dispersion,
        signature=f"eye:{digest}",
        note=note,
    )


def params_from_core(result: dict[str, Any]) -> tuple[float, float]:
    """Снять (a, b) с настоящего состояния ядра.

    Уверенность ведёт a: чем увереннее ядро, тем ближе a к нулю, где
    отображение спокойнее. Новизна ведёт b: незнакомое событие толкает b к
    краю диапазона, где начинается хаос.
    """
    confidence = 0.0
    value = result.get("confidence")
    if isinstance(value, (int, float)):
        confidence = _clamp(float(value))
    else:
        plasticity = result.get("plasticity")
        if isinstance(plasticity, dict) and isinstance(
            plasticity.get("confidence"), (int, float)
        ):
            confidence = _clamp(float(plasticity["confidence"]))

    # Новизна — то, чего ядро про событие ещё не знает.
    novelty = 1.0 - confidence

    memory = result.get("memory")
    recall_strength = 0.0
    if isinstance(memory, dict):
        scores: list[float] = []
        for key in ("recalled", "semantic", "hits"):
            hits = memory.get(key)
            if isinstance(hits, list):
                for hit in hits:
                    if isinstance(hit, dict) and isinstance(hit.get("score"), (int, float)):
                        scores.append(float(hit["score"]))
        if scores:
            recall_strength = _clamp(max(scores))

    # a: уверенное ядро сидит около нуля, неуверенное уходит к краю.
    a = PARAM_MAX * (1.0 - confidence) * 0.85
    # b: сильный recall притягивает обратно к центру, новизна отталкивает.
    b = PARAM_MAX * _clamp(novelty - recall_strength * 0.5, 0.0, 1.0) * 0.9
    return a, b


def blink(a: float, b: float, *, seed: str = "") -> tuple[float, float]:
    """Моргание: скачок в новую точку параметров.

    Веко закрылось — контекст сменился — открылось, и узор внимания другой.
    Детерминировано по seed, поэтому одно и то же событие даёт один и тот же
    новый режим.
    """
    digest = hashlib.blake2b(
        f"{a:.6f}|{b:.6f}|{seed}".encode("utf-8"), digest_size=8
    ).digest()
    # Два независимых 32-битных числа из хэша -> сдвиги в пределах диапазона.
    ra = int.from_bytes(digest[:4], "big") / 0xFFFFFFFF
    rb = int.from_bytes(digest[4:], "big") / 0xFFFFFFFF
    return (
        PARAM_MIN + ra * (PARAM_MAX - PARAM_MIN),
        PARAM_MIN + rb * (PARAM_MAX - PARAM_MIN),
    )


def snapshot(
    result: dict[str, Any],
    *,
    blink_seed: str | None = None,
    steps: int = ORBIT_STEPS,
) -> dict[str, Any]:
    """Состояние внимания ядра для одного обработанного события."""
    a, b = params_from_core(result)
    blinked = False
    if blink_seed is not None:
        a, b = blink(a, b, seed=blink_seed)
        blinked = True

    attention = analyse(a, b, steps=steps)
    payload = attention.to_dict()
    payload["blinked"] = blinked
    return payload
