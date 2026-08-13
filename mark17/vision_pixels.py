"""Детерминированное зрение MAX: кадр разбирается математикой, а не моделью.

Нейросеть — не единственный способ видеть, и для ядра Max17 не первый: она
требует чужих весов, гигабайтов памяти и десятков секунд на кадр, а на
дроплете с двумястами мегабайтами свободной памяти невозможна в принципе.
Здесь зрение считается numpy прямо из пикселей — быстро, всюду одинаково и
без единого внешнего вызова.

Это не «хуже нейросети», это про другое. Модель угадывает смысл («человек у
окна»), пиксельный разбор измеряет факт: где масса света, какая палитра,
насколько кадр резкий, есть ли симметрия, какая пространственная частота
задаёт ритм, что именно сдвинулось между кадрами. Такие ответы проверяемы —
их можно пересчитать и получить то же самое.

РАЗМАТЫВАНИЕ ЧЕРЕЗ ЧАСТОТЫ. Кадр раскладывается двумерным Фурье: изображение
перестаёт быть сеткой точек и становится набором волн — крупные формы в
низких частотах, фактура и шум в высоких. По спектру видно то, чего в самих
пикселях не видно: периодичность (сетка, полоса, узор), преобладающее
направление, соотношение «форма против фактуры». Потом всё сходится обратно
в одно описание.

Нейро-слой (vision_core) остаётся сверху как усиление, когда глаза есть.
Пиксельный слой работает всегда — в этом и смысл.
"""

from __future__ import annotations  # `str | None` на Python 3.9 (системный на Mac)

from pathlib import Path
from typing import Any

import numpy as np

# Кадр ужимается перед разбором: для статистики света, палитры и частот
# двухсот пикселей по длинной стороне достаточно, а считается это мгновенно
# даже на слабом сервере. Оригинал при этом не трогаем.
WORK_SIDE = 256

# Названия цветов по тону. Границы — обычные секторы цветового круга (в
# градусах), без претензии на колориметрию: задача назвать оттенок словом,
# понятным человеку, а не попасть в стандарт.
HUE_NAMES: list[tuple[float, str]] = [
    (15, "красный"),
    (45, "оранжевый"),
    (70, "жёлтый"),
    (160, "зелёный"),
    (200, "бирюзовый"),
    (255, "синий"),
    (290, "фиолетовый"),
    (330, "розовый"),
    (360, "красный"),
]


def _load(path: str | Path, side: int = WORK_SIDE) -> np.ndarray:
    """Кадр как массив float 0..1, ужатый до рабочего размера.

    Размер параметром, потому что разным измерениям нужна разная детальность:
    свету и палитре хватает мелкой копии, а строки текста на ней исчезают.
    """
    from PIL import Image

    img = Image.open(path).convert("RGB")
    img.thumbnail((side, side))
    return np.asarray(img, dtype=np.float32) / 255.0


def _luma(rgb: np.ndarray) -> np.ndarray:
    """Яркость по восприятию: глаз считает зелёный много светлее синего."""
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def _hue_name(r: float, g: float, b: float) -> str:
    mx, mn = max(r, g, b), min(r, g, b)
    span = mx - mn
    if mx < 0.12:
        return "чёрный"
    if span < 0.08:
        return "белый" if mx > 0.85 else ("серый" if mx > 0.35 else "тёмно-серый")
    if mx == r:
        hue = (60 * ((g - b) / span)) % 360
    elif mx == g:
        hue = 60 * ((b - r) / span) + 120
    else:
        hue = 60 * ((r - g) / span) + 240
    for edge, name in HUE_NAMES:
        if hue < edge:
            return name
    return "красный"


# ── измерения ────────────────────────────────────────────────────────────────
def palette(rgb: np.ndarray, top: int = 4) -> list[dict[str, Any]]:
    """Доминирующие цвета: куб RGB режется на 4³ ячеек и считается заселённость.

    Грубая сетка нарочно: тонкое квантование расщепляет один и тот же оттенок
    на соседние ячейки и вместо «преобладает синий» выдаёт пять почти
    одинаковых синих.
    """
    q = np.clip((rgb * 3.999), 0, 3).astype(np.int8)
    keys = q[..., 0] * 16 + q[..., 1] * 4 + q[..., 2]
    flat = keys.reshape(-1)
    counts = np.bincount(flat, minlength=64)
    total = float(flat.size)

    # Ячейки, попавшие в один и тот же оттенок, сливаются: иначе в списке
    # оказывается «бирюзовый 1%, бирюзовый 0%» — формально разные ячейки куба,
    # а на словах одно и то же.
    merged: dict[str, dict[str, Any]] = {}
    for idx in np.argsort(counts)[::-1]:
        n = int(counts[idx])
        if n == 0:
            continue
        mask = keys == idx
        mean = rgb[mask].mean(axis=0)
        name = _hue_name(float(mean[0]), float(mean[1]), float(mean[2]))
        share = n / total
        if name in merged:
            merged[name]["доля"] += share
        else:
            merged[name] = {
                "цвет": name,
                "rgb": [int(round(float(c) * 255)) for c in mean],
                "доля": share,
            }
        if len(merged) >= top and share < 0.01:
            break
    out = sorted(merged.values(), key=lambda c: c["доля"], reverse=True)[:top]
    for c in out:
        c["доля"] = round(c["доля"], 3)
    return out


def light(rgb: np.ndarray) -> dict[str, Any]:
    """Свет: сколько его, насколько он ровный и не выбит ли кадр."""
    y = _luma(rgb)
    lo = float((y < 0.04).mean())
    hi = float((y > 0.96).mean())
    return {
        "яркость": round(float(y.mean()), 3),
        "контраст": round(float(y.std()), 3),
        "тени_в_ноль": round(lo, 3),
        "света_в_белое": round(hi, 3),
        "тон": "тёмный" if y.mean() < 0.35 else ("светлый" if y.mean() > 0.65 else "средний"),
    }


def composition(rgb: np.ndarray) -> dict[str, Any]:
    """Куда смещена световая масса и держится ли кадр симметрично.

    Центр масс считается по яркости: где светлее — туда и смотрит глаз.
    Симметрия — прямое сравнение половин, без поиска осей: цель не измерить
    геометрию, а заметить, что кадр построен зеркально.
    """
    y = _luma(rgb)
    h, w = y.shape
    total = float(y.sum()) or 1.0
    cx = float((y.sum(axis=0) * np.arange(w)).sum() / total / w)
    cy = float((y.sum(axis=1) * np.arange(h)).sum() / total / h)
    left, right = y[:, : w // 2], np.fliplr(y[:, w - w // 2 :])
    top, bottom = y[: h // 2, :], np.flipud(y[h - h // 2 :, :])
    sym_lr = 1.0 - float(np.abs(left - right).mean())
    sym_tb = 1.0 - float(np.abs(top - bottom).mean())
    where_x = "слева" if cx < 0.42 else ("справа" if cx > 0.58 else "по центру")
    where_y = "вверху" if cy < 0.42 else ("внизу" if cy > 0.58 else "по центру")
    return {
        "центр_масс": [round(cx, 3), round(cy, 3)],
        "смещение": f"{where_x}, {where_y}",
        "симметрия_лево_право": round(sym_lr, 3),
        "симметрия_верх_низ": round(sym_tb, 3),
    }


def detail(rgb: np.ndarray) -> dict[str, Any]:
    """Резкость и насыщенность деталями — по перепадам соседних пикселей.

    Градиент считается разностями, а не свёрткой Собеля: без scipy это то же
    самое по сути, но без лишней зависимости ради одного числа.
    """
    y = _luma(rgb)
    gx = np.diff(y, axis=1)
    gy = np.diff(y, axis=0)
    mag = float(np.abs(gx).mean() + np.abs(gy).mean()) / 2
    edges = float((np.abs(gx) > 0.08).mean())
    hist, _ = np.histogram(y, bins=32, range=(0.0, 1.0))
    p = hist / max(1, hist.sum())
    entropy = float(-(p[p > 0] * np.log2(p[p > 0])).sum())
    return {
        "детализация": round(mag, 4),
        "доля_контуров": round(edges, 3),
        "энтропия": round(entropy, 2),
        "резкость": "мягкий" if mag < 0.02 else ("резкий" if mag > 0.06 else "обычный"),
    }


def rhythm(rgb: np.ndarray) -> dict[str, Any]:
    """Ритм кадра через двумерное Фурье: форма против фактуры.

    Спектр делится на кольца по радиусу: центр — крупные формы, край —
    мелкая фактура и шум. Соотношение энергий говорит, чем кадр держится.
    Отдельно ищется самый сильный пик вне центра — если он заметно выше фона,
    в кадре есть настоящая периодичность: сетка, полосы, повторяющийся узор.
    """
    y = _luma(rgb)
    y = y - y.mean()
    spec = np.abs(np.fft.fftshift(np.fft.fft2(y)))
    h, w = spec.shape
    cy, cx = h // 2, w // 2
    yy, xx = np.ogrid[:h, :w]
    radius = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
    rmax = float(radius.max()) or 1.0
    low = float(spec[radius < rmax * 0.15].sum())
    mid = float(spec[(radius >= rmax * 0.15) & (radius < rmax * 0.5)].sum())
    high = float(spec[radius >= rmax * 0.5].sum())
    total = low + mid + high or 1.0

    # Самый яркий пик вне центральной зоны — кандидат в периодичность.
    masked = spec.copy()
    masked[radius < rmax * 0.06] = 0.0
    peak_idx = int(np.argmax(masked))
    py, px = divmod(peak_idx, w)
    peak = float(masked[py, px])
    background = float(masked[masked > 0].mean()) if (masked > 0).any() else 1.0
    ratio = peak / (background or 1.0)
    period_px = float(rmax / max(1.0, np.hypot(py - cy, px - cx)))

    return {
        "крупные_формы": round(low / total, 3),
        "средние": round(mid / total, 3),
        "фактура": round(high / total, 3),
        "держится_на": "крупных формах" if low > mid + high else ("фактуре" if high > low else "средних деталях"),
        "периодичность": round(ratio, 1),
        "шаг_узора_px": round(period_px, 1) if ratio > 6 else None,
        "узор": bool(ratio > 6),
    }


def kind(rgb: np.ndarray) -> dict[str, Any]:
    """Что это вообще: снимок, скриншот, рисунок, текст.

    Различие держится на статистике, а не на догадках. У фотографии много
    уникальных оттенков и мягкий шум; у скриншота палитра бедная, зато края
    идеально прямые и повторяются по вертикали; текст даёт частые
    горизонтальные перепады при почти пустом фоне.
    """
    y = _luma(rgb)
    q = np.clip(rgb * 31.999, 0, 31).astype(np.int16)
    keys = q[..., 0] * 1024 + q[..., 1] * 32 + q[..., 2]
    unique = float(np.unique(keys).size) / keys.size

    gx = np.abs(np.diff(y, axis=1))
    gy = np.abs(np.diff(y, axis=0))
    # Идеально вертикальные и горизонтальные границы — признак интерфейса:
    # в природе прямых линий такой длины почти не бывает.
    col_edges = float((gx.mean(axis=0) > 0.12).mean())
    row_edges = float((gy.mean(axis=1) > 0.12).mean())
    flat = float((np.abs(y - np.median(y)) < 0.03).mean())

    # Пороги откалиброваны по 90 реальным кадрам с этой машины, а не взяты из
    # головы. Замеренное распределение уникальности: минимум 0.001, медиана
    # 0.020, максимум 0.070. Прежний порог «фотография при unique > 0.15» был
    # недостижим в принципе — ветка не срабатывала НИ РАЗУ, и рендер игры
    # попадал в «смешанный кадр» наравне со скриншотом редактора.
    # Уникальность считается на копии 256 px: там соседние оттенки сливаются,
    # поэтому доли процента — это норма, а не признак бедной картинки.
    if unique >= 0.030 and flat < 0.55:
        verdict = "фотография или игровой рендер"
    elif unique < 0.004 and flat > 0.85:
        verdict = "рисунок или график"
    elif unique < 0.012 and (col_edges > 0.05 or row_edges > 0.05 or flat > 0.5):
        verdict = "скриншот или интерфейс"
    else:
        verdict = "смешанный кадр"
    return {
        "тип": verdict,
        "уникальных_оттенков": round(unique, 4),
        "ровный_фон": round(flat, 3),
        "прямых_границ": round(max(col_edges, row_edges), 3),
    }


def text_lines(rgb: np.ndarray) -> dict[str, Any]:
    """Есть ли в кадре строки текста и сколько их.

    Текст виден по профилю: если сложить перепады яркости по строкам, у текста
    получается гребёнка — узкие всплески на пустом фоне, повторяющиеся с
    примерно равным шагом. Это не чтение букв, а обнаружение самого факта,
    что в кадре есть written-строки: ядру важно знать, что тут «есть текст».
    """
    y = _luma(rgb)
    profile = np.abs(np.diff(y, axis=1)).mean(axis=1)
    if profile.size < 8:
        return {"строк": 0, "есть_текст": False}
    thr = float(profile.mean() + profile.std())
    peaks = profile > thr
    # Считаем группы подряд идущих активных строк — это и есть строки текста.
    count, prev = 0, False
    gaps: list[int] = []
    last_end = -1
    for i, active in enumerate(peaks):
        if active and not prev:
            count += 1
            if last_end >= 0:
                gaps.append(i - last_end)
        if not active and prev:
            last_end = i
        prev = bool(active)
    step = float(np.median(gaps)) if gaps else 0.0
    # Равномерность — признак сплошного абзаца, а не условие существования
    # текста. Настоящий экран состоит из заголовков, кнопок и списков с
    # разными интервалами, и строгая проверка «шаг всюду одинаковый» браковала
    # очевидные скриншоты интерфейса. Оставляем её как отдельное наблюдение.
    regular = bool(len(gaps) >= 2 and np.std(gaps) < max(2.0, step))
    # Текст считаем найденным по факту: несколько строк с человеческим
    # межстрочным интервалом. Слишком частые полосы — это фактура или узор,
    # слишком редкие — просто крупные объекты, а не строки.
    plausible_step = bool(step and 2.0 <= step <= 40.0)
    return {
        "строк": int(count),
        "шаг_строк_px": round(step, 1) if step else None,
        "равномерные": regular,
        "есть_текст": bool(count >= 3 and plausible_step),
    }


def zones(rgb: np.ndarray) -> list[dict[str, Any]]:
    """Кадр по девяти зонам: где светлее, где гуще детали, какого цвета.

    Это и есть разматывание по углам, только считанное: общий план говорит
    «в среднем темно», а по зонам видно, что низ пустой, а вся жизнь наверху
    слева. Модели для этого не нужно.
    """
    y = _luma(rgb)
    h, w = y.shape
    names = [
        "верх-слева", "верх-центр", "верх-справа",
        "центр-слева", "центр", "центр-справа",
        "низ-слева", "низ-центр", "низ-справа",
    ]
    out: list[dict[str, Any]] = []
    for gy in range(3):
        for gx in range(3):
            ys, ye = h * gy // 3, h * (gy + 1) // 3
            xs, xe = w * gx // 3, w * (gx + 1) // 3
            cell = rgb[ys:ye, xs:xe]
            cy = y[ys:ye, xs:xe]
            if cell.size == 0:
                continue
            mean = cell.reshape(-1, 3).mean(axis=0)
            grad = float(np.abs(np.diff(cy, axis=1)).mean()) if cy.shape[1] > 1 else 0.0
            out.append(
                {
                    "зона": names[gy * 3 + gx],
                    "яркость": round(float(cy.mean()), 3),
                    "цвет": _hue_name(float(mean[0]), float(mean[1]), float(mean[2])),
                    "детали": round(grad, 4),
                    "пусто": bool(grad < 0.01),
                }
            )
    return out


def geometry(rgb: np.ndarray, grid: int = 48) -> dict[str, Any]:
    """Направления линий и точка схода — грубое 3D без всякой нейросети.

    Перспектива выдаёт себя тем, что параллельные в мире линии на картинке
    сходятся в одну точку. Найти её можно голосованием: каждая кромка кадра
    подсказывает, что точка схода лежит где-то вдоль её продолжения, и там,
    где подсказки сходятся, накапливается максимум.

    Голосование, а не подгонка методом наименьших квадратов, — принципиально.
    МНК усредняет сигнал вместе с шумом и всегда возвращает какую-нибудь
    точку, даже когда перспективы в кадре нет вовсе (первый прототип давал так
    невязку в полсотни пикселей и не мог об этом сообщить). Голоса же дают
    вместе с точкой её честность: если максимум едва выше медианы, значит
    линии никуда не сходятся — и лучше сказать это прямо.
    """
    y = _luma(rgb)
    h, w = y.shape
    gy, gx = np.gradient(y)
    mag = np.hypot(gx, gy)
    if mag.max() <= 0:
        return {"есть_перспектива": False, "почему": "кадр без перепадов"}

    # Берём только заметные кромки: слабые перепады — это шум, и в голосовании
    # они лишь размывают максимум.
    thr = float(np.percentile(mag, 92))
    ys, xs = np.nonzero(mag >= thr)
    if ys.size < 40:
        return {"есть_перспектива": False, "почему": "слишком мало кромок"}

    # Направление самой линии перпендикулярно градиенту яркости.
    ang = (np.degrees(np.arctan2(gy[ys, xs], gx[ys, xs])) + 90.0) % 180.0
    weights = mag[ys, xs]

    hist, _ = np.histogram(ang, bins=18, range=(0.0, 180.0), weights=weights)
    hist = hist / (hist.sum() or 1.0)
    order = np.argsort(hist)[::-1]
    dominant = float(order[0] * 10 + 5)
    # Вертикали и горизонтали (0°, 90°) — это архитектура и интерфейс, а не
    # перспектива. Сходятся именно косые линии, их и считаем отдельно.
    axis_share = float(hist[0] + hist[9] + hist[17] + hist[8])
    peaks = int((hist > hist.mean() + hist.std()).sum())

    diag = np.abs(np.sin(np.radians(2 * ang))) > 0.35
    if diag.sum() < 30:
        return {
            "есть_перспектива": False,
            "почему": "только вертикали и горизонтали",
            "главное_направление": dominant,
            "доля_осевых": round(axis_share, 3),
            "пиков_направлений": peaks,
        }

    # Голосование. Чтобы не строить матрицу «все кромки × все кандидаты»,
    # берём выборку самых сильных косых кромок — точность от этого не страдает,
    # а память и время падают на порядок.
    dys, dxs, dang, dmag = ys[diag], xs[diag], ang[diag], weights[diag]
    if dys.size > 1200:
        pick = np.argsort(dmag)[::-1][:1200]
        dys, dxs, dang, dmag = dys[pick], dxs[pick], dang[pick], dmag[pick]

    dir_x = np.cos(np.radians(dang))
    dir_y = np.sin(np.radians(dang))
    # Кандидаты ищем и за границами кадра: у дороги, уходящей вбок, точка схода
    # часто лежит вне видимого поля.
    cand_x = np.linspace(-0.5 * w, 1.5 * w, grid)
    cand_y = np.linspace(-0.5 * h, 1.5 * h, max(8, grid * h // max(1, w)))
    cx_grid, cy_grid = np.meshgrid(cand_x, cand_y)
    cxf, cyf = cx_grid.reshape(-1), cy_grid.reshape(-1)

    vx = cxf[None, :] - dxs[:, None]
    vy = cyf[None, :] - dys[:, None]
    norm = np.hypot(vx, vy) + 1e-6
    align = np.abs(dir_x[:, None] * vx + dir_y[:, None] * vy) / norm
    votes = (align ** 8 * dmag[:, None]).sum(axis=0)

    best = int(np.argmax(votes))
    peak, median = float(votes[best]), float(np.median(votes))
    confidence = peak / (median or 1.0)
    vx_best, vy_best = float(cxf[best]), float(cyf[best])

    # Порог подобран по замерам на игровых кадрах: уверенный сход даёт
    # превышение над медианой в разы, а ровный интерфейс — считанные проценты.
    real = bool(confidence > 1.6)
    return {
        "есть_перспектива": real,
        "точка_схода": [round(vx_best / w, 3), round(vy_best / h, 3)] if real else None,
        "уверенность": round(confidence, 2),
        "главное_направление": dominant,
        "доля_осевых": round(axis_share, 3),
        "пиков_направлений": peaks,
        "кромок_в_голосовании": int(dys.size),
    }


def depth_cue(rgb: np.ndarray) -> dict[str, Any]:
    """Порядковая глубина по фактуре: ближе — крупнее зерно, дальше — мельче.

    Признак старый и надёжный: одна и та же поверхность вблизи даёт крупный
    рисунок, а вдали — мелкий. Считается это тем же спектром, что уже стоит в
    rhythm(), только по каждой из девяти зон: центроид спектра по радиусу и
    есть «мелкость» зоны.

    Метров тут не будет никогда — у игрового рендера нет ни оптики, ни
    интринсик, любые «метры» были бы выдуманы. Порядок же — что ближе, что
    дальше — измерим честно.
    """
    y = _luma(rgb)
    h, w = y.shape
    fine = np.full((3, 3), np.nan, dtype=np.float32)
    energy = np.zeros((3, 3), dtype=np.float32)
    for gy in range(3):
        for gx in range(3):
            cell = y[h * gy // 3 : h * (gy + 1) // 3, w * gx // 3 : w * (gx + 1) // 3]
            if cell.size < 64:
                continue
            c = cell - cell.mean()
            energy[gy, gx] = float(np.abs(np.diff(c, axis=1)).mean()) if c.shape[1] > 1 else 0.0
            spec = np.abs(np.fft.fftshift(np.fft.fft2(c)))
            ch, cw = spec.shape
            yy, xx = np.ogrid[:ch, :cw]
            radius = np.sqrt((yy - ch // 2) ** 2 + (xx - cw // 2) ** 2)
            total = float(spec.sum()) or 1.0
            # Центроид по радиусу: чем он дальше от центра, тем мельче фактура.
            fine[gy, gx] = float((spec * radius).sum() / total / (radius.max() or 1.0))

    # Гладкая зона — это не «близкая», это зона без фактуры: небо, стена, туман.
    # Первый замер этого не учитывал, и небо вверху кадра уверенно объявлялось
    # ближайшим планом. Судить о глубине можно только там, где есть по чему
    # судить, поэтому пустые зоны выпадают из сравнения, а не притворяются
    # передним планом.
    weak = energy < max(0.004, float(np.median(energy)) * 0.35)
    fine[weak] = np.nan
    blank = int(weak.sum())

    with np.errstate(invalid="ignore"):
        rows = np.nanmean(fine, axis=1)
    if np.isnan(rows).all():
        return {"глубина_определима": False, "почему": "в кадре нет фактуры", "пустых_зон": blank}
    rows = np.where(np.isnan(rows), float(np.nanmean(rows)), rows)
    # Растёт ли мелкость снизу вверх — то есть уходит ли сцена вдаль.
    recedes = bool(rows[0] > rows[1] > rows[2]) or bool(rows[0] > rows[2] and rows[0] - rows[2] > 0.02)
    # Горизонт ищем как самый резкий перелом между рядами: там кончается земля.
    jumps = np.abs(np.diff(rows))
    horizon_row = int(np.argmax(jumps)) if jumps.size else 0
    # nanmax/nanmin, а не max/min: пустые зоны помечены как nan, и обычные
    # max/min из-за них возвращали nan в самом ответе.
    spread = float(np.nanmax(fine) - np.nanmin(fine))

    names = ["верх", "середина", "низ"]
    order = sorted(range(3), key=lambda i: rows[i], reverse=True)

    # Вывод о глубине делается ТОЛЬКО при согласованной картине: фактура должна
    # убывать сверху вниз, как у сцены, уходящей к горизонту. Замер показал,
    # почему это важно: на игровых кадрах с интерфейсом, зданиями и небом ряды
    # часто идут вразнобой, и признак уверенно называл ближним планом верх
    # кадра — то есть небо. Само измерение остаётся в ответе всегда, а
    # «ближе-дальше» появляется, только когда есть чему верить.
    monotone = bool(rows[0] > rows[1] > rows[2])
    decisive = bool(monotone and spread > 0.012)
    out: dict[str, Any] = {
        "глубина_определима": decisive,
        "мелкость_рядов": [round(float(v), 4) for v in rows],
        "разброс": round(float(spread), 4),
        "пустых_зон": blank,
    }
    if decisive:
        out.update(
            {
                "дальше_всего": names[order[0]],
                "ближе_всего": names[order[-1]],
                "сцена_уходит_вдаль": True,
                "горизонт_между": f"{names[horizon_row]} и {names[horizon_row + 1]}" if spread > 0.015 else None,
            }
        )
    else:
        out["почему"] = "фактура рядов идёт вразнобой — глубина по ней не читается"
    return out


def motion(a: np.ndarray, b: np.ndarray) -> dict[str, Any]:
    """Что изменилось между двумя кадрами — по разнице яркости.

    Здесь пиксельный разбор сильнее модели: он не гадает и не выдумывает, а
    показывает, какая доля кадра изменилась и куда сместился центр движения.
    """
    ya, yb = _luma(a), _luma(b)
    if ya.shape != yb.shape:
        side = (min(ya.shape[0], yb.shape[0]), min(ya.shape[1], yb.shape[1]))
        ya, yb = ya[: side[0], : side[1]], yb[: side[0], : side[1]]
    diff = np.abs(yb - ya)
    changed = float((diff > 0.08).mean())
    h, w = diff.shape
    total = float(diff.sum()) or 1.0
    mx = float((diff.sum(axis=0) * np.arange(w)).sum() / total / w)
    my = float((diff.sum(axis=1) * np.arange(h)).sum() / total / h)
    return {
        "доля_изменений": round(changed, 3),
        "сила": round(float(diff.mean()), 4),
        "очаг": [round(mx, 3), round(my, 3)],
        "вердикт": "почти статично" if changed < 0.02 else ("сменилась сцена" if changed > 0.5 else "есть движение"),
    }


# ── сборка обратно ───────────────────────────────────────────────────────────
def describe(measures: dict[str, Any]) -> str:
    """Собрать измерения в человеческую фразу.

    Без модели: числа переводятся в слова напрямую, поэтому описание всегда
    соответствует тому, что реально посчитано, и не может ничего выдумать.
    """
    pal = measures.get("палитра") or []
    lig = measures.get("свет") or {}
    comp = measures.get("композиция") or {}
    det = measures.get("детали") or {}
    rhy = measures.get("ритм") or {}

    parts: list[str] = []
    what = measures.get("что_это") or {}
    if what.get("тип"):
        parts.append(f"Похоже на {what['тип']}.")
    txt = measures.get("текст") or {}
    if txt.get("есть_текст"):
        parts.append(f"В кадре текст: примерно {txt.get('строк')} строк с шагом ~{txt.get('шаг_строк_px')} px.")
    zs = measures.get("зоны") or []
    if zs:
        busy = sorted(zs, key=lambda z: z.get("детали") or 0, reverse=True)[:2]
        empty = [z["зона"] for z in zs if z.get("пусто")]
        if busy:
            parts.append("Гуще всего: " + ", ".join(z["зона"] for z in busy) + ".")
        if len(empty) >= 3:
            parts.append(f"Пустых зон: {len(empty)} из 9.")
    if pal:
        top = ", ".join(f"{c['цвет']} ({int(c['доля'] * 100)}%)" for c in pal[:3])
        parts.append(f"Палитра: {top}.")
    if lig:
        note = f"Свет {lig.get('тон')}, контраст {lig.get('контраст')}"
        if float(lig.get("света_в_белое") or 0) > 0.05:
            note += ", света местами выбиты"
        if float(lig.get("тени_в_ноль") or 0) > 0.15:
            note += ", тени глухие"
        parts.append(note + ".")
    if comp:
        parts.append(
            f"Масса кадра {comp.get('смещение')}, "
            f"симметрия по горизонтали {comp.get('симметрия_лево_право')}."
        )
    if det:
        parts.append(f"Кадр {det.get('резкость')}, контуров {int(float(det.get('доля_контуров') or 0) * 100)}%.")
    if rhy:
        note = f"Держится на {rhy.get('держится_на')}"
        if rhy.get("узор"):
            note += f", есть повтор с шагом ~{rhy.get('шаг_узора_px')} px"
        parts.append(note + ".")
    if measures.get("движение"):
        mo = measures["движение"]
        parts.append(f"Движение: {mo.get('вердикт')}, изменилось {int(float(mo.get('доля_изменений') or 0) * 100)}% кадра.")
    return " ".join(parts)


def measure(path: str | Path) -> dict[str, Any]:
    """Полный пиксельный разбор одного кадра."""
    rgb = _load(path)
    measures: dict[str, Any] = {
        "что_это": kind(rgb),
        "палитра": palette(rgb),
        "свет": light(rgb),
        "композиция": composition(rgb),
        "детали": detail(rgb),
        # Текст ищем на копии покрупнее: на 256 px строки интерфейса
        # схлопываются в ровную заливку, и текста «не оказывается» там,
        # где он занимает пол-экрана.
        "текст": text_lines(_load(path, side=512)),
        "зоны": zones(rgb),
        "ритм": rhythm(rgb),
        "размер": [int(rgb.shape[1]), int(rgb.shape[0])],
    }
    measures["text"] = describe(measures)
    return measures


def measure_pair(path_a: str | Path, path_b: str | Path) -> dict[str, Any]:
    """Разбор двух кадров плюс то, что между ними изменилось."""
    a, b = _load(path_a), _load(path_b)
    measures = measure(path_b)
    measures["движение"] = motion(a, b)
    measures["text"] = describe(measures)
    return measures


def measure_arrays(frames: list[np.ndarray]) -> dict[str, Any]:
    """Разбор последовательности кадров, уже загруженных в память (видео)."""
    if not frames:
        return {"text": ""}
    norm = [f.astype(np.float32) / 255.0 if f.dtype != np.float32 else f for f in frames]
    measures: dict[str, Any] = {
        "палитра": palette(norm[0]),
        "свет": light(norm[0]),
        "композиция": composition(norm[0]),
        "детали": detail(norm[0]),
        "ритм": rhythm(norm[0]),
    }
    if len(norm) > 1:
        steps = [motion(norm[i], norm[i + 1]) for i in range(len(norm) - 1)]
        measures["движение"] = motion(norm[0], norm[-1])
        measures["движение"]["по_шагам"] = [s["доля_изменений"] for s in steps]
    measures["text"] = describe(measures)
    return measures
