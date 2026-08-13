"""MAX VISION — зрение ядра: фото и видео, а не только поток с камеры.

Камера в HUD даёт сенсорику (свет, движение, лица) и одну фразу на кадр —
этого хватает игровому компаньону и не хватает, чтобы что-то ПОНЯТЬ. Здесь
зрение устроено иначе: кадр не описывается одним взглядом, а разбирается
несколькими независимыми линзами, и только потом собирается обратно.

    кадр ──┬── сцена: что происходит
           ├── предметы и текст: что конкретно в кадре
           ├── свет и форма: цвет, композиция, настроение кадра
           ├── резонанс: что повторяется, что выбивается
           └── (видео) движение: что изменилось между кадрами
                        │
                        └──→ сплетение → память ядра → ветки реальности

Каждая линза — отдельный вопрос к сетчатке, и вопросы разные по существу:
модель, которую спрашивают «что тут происходит», и модель, которую спрашивают
«какой здесь свет», возвращают разное — а вместе они дают объём, которого у
одного описания нет.

СЕТЧАТКА двухслойная. Свои глаза (Ollama, qwen2.5vl:3b) доступны всегда и
ничего не отправляют наружу; облако (Gemini) подключается, когда нужно больше
качества. Если облака нет — MAX всё равно видит, просто скромнее.

ЧЕСТНО О СКОРОСТИ: линзы запускаются параллельно, но ускоряет это только
облачный слой. Ollama на одной машине выполняет запросы по очереди, поэтому
локально пять линз — это пять проходов подряд. Отсюда глубина `quick` по
умолчанию для локальных глаз и `full` для облачных: смысла ставить машину
в очередь на минуту ради одного кадра нет.
"""

from __future__ import annotations  # `str | None` на Python 3.9 (системный на Mac)

import base64
import json
import os
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

OLLAMA_URL = (os.environ.get("MAX17_OLLAMA_URL") or "http://127.0.0.1:11434").rstrip("/")
OLLAMA_VLM = os.environ.get("MAX17_VLM_MODEL") or "qwen2.5vl:3b"
GEMINI_MODEL = os.environ.get("MAX17_VISION_MODEL") or "gemini-2.5-flash"

# Сколько ждать взгляда. Локальная модель на 8 ГБ думает над кадром долго,
# облако отвечает за пару секунд — таймауты у них разные не случайно.
LOCAL_TIMEOUT = float(os.environ.get("MAX17_VLM_TIMEOUT") or 180)
CLOUD_TIMEOUT = 45.0

# Держать модель в памяти между кадрами. Без этого на 8 ГБ, где рядом живёт
# dev-сервер, Ollama выгружает VLM сразу после ответа и грузит заново на
# следующий кадр — разбор видео из-за этого растягивался в разы и падал по
# таймауту на последних кадрах.
KEEP_ALIVE = os.environ.get("MAX17_VLM_KEEP_ALIVE") or "10m"


def _workers(prefer: str, count: int) -> int:
    """Сколько взглядов запускать разом.

    Для облака — сколько угодно: там запросы действительно идут параллельно.
    Для своих глаз — строго по одному, и это не перестраховка. Ollama считает
    запросы по очереди, а таймаут у отправленных тикает с момента отправки:
    пошли три кадра сразу — третий простоит в очереди всё время работы первых
    двух и умрёт, не начав считаться. Именно так видео и падало целиком,
    сваливаясь в облако, которого может не быть.
    """
    if prefer == "cloud":
        return min(4, max(1, count))
    if prefer == "local" or local_eye_ready():
        return 1
    return min(4, max(1, count))


# ── линзы ────────────────────────────────────────────────────────────────────
# Порядок важен: первая — самая содержательная, и при depth="quick" работает
# только она. Формулировки просят факты, а не впечатления: додумывать будет
# ядро, у которого есть память, а сетчатка обязана оставаться сетчаткой.
LENSES: dict[str, str] = {
    "scene": (
        "Опиши, что происходит на изображении: место, люди, действие, контекст. "
        "Только то, что видно. 2–4 предложения, по-русски."
    ),
    "objects": (
        "Перечисли конкретные предметы в кадре и весь читаемый текст (надписи, вывески, "
        "экраны, документы) дословно. Если текста нет — так и скажи. По-русски."
    ),
    "light": (
        "Опиши свет, цвет и построение кадра: откуда свет, какая палитра, что в центре "
        "внимания, какое настроение создаёт композиция. 2–3 предложения, по-русски."
    ),
    "resonance": (
        "Что в этом кадре повторяется (формы, ритм, узор), и что из общего строя выбивается "
        "— необычное, неуместное, странное? Если ничего — скажи прямо. По-русски."
    ),
    # Формулировка нарочито жёсткая: маленькая локальная модель, получив два
    # кадра, охотно смешивает их в один и дописывает несуществующее. Явная
    # разметка «первое — начало, второе — конец» и запрет на догадки заметно
    # сокращают выдумки, хотя полностью их не убирают.
    "motion": (
        "Тебе даны РОВНО два кадра одного ролика: первое изображение — НАЧАЛО, "
        "второе — КОНЕЦ. Сравни их и назови только реальные отличия: что сдвинулось, "
        "что появилось, что исчезло. Не описывай кадры по отдельности. Если чего-то "
        "не видно — не выдумывай. 1–2 предложения, по-русски."
    ),
}

QUICK_LENSES = ("scene",)
FULL_LENSES = ("scene", "objects", "light", "resonance")


@dataclass
class Sight:
    """Один разобранный кадр."""

    lenses: dict[str, str] = field(default_factory=dict)
    woven: str = ""
    via: str = ""
    model: str = ""
    errors: list[str] = field(default_factory=list)
    source: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "lenses": self.lenses,
            "text": self.woven,
            "via": self.via,
            "model": self.model,
            "errors": self.errors,
            "source": self.source,
        }


# ── сетчатка ─────────────────────────────────────────────────────────────────
def _post_json(url: str, payload: dict[str, Any], timeout: float, headers: dict[str, str] | None = None) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def local_eye_ready() -> bool:
    """Подняты ли свои глаза и загружена ли в них зрячая модель."""
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=2) as resp:
            data = json.loads(resp.read())
    except Exception:  # noqa: BLE001 - глаз просто нет, это не ошибка
        return False
    names = [str(m.get("name") or "") for m in data.get("models", [])]
    return any(n.split(":")[0] == OLLAMA_VLM.split(":")[0] for n in names)


def _see_local(image_b64: str, prompt: str) -> str:
    data = _post_json(
        f"{OLLAMA_URL}/api/generate",
        {"model": OLLAMA_VLM, "prompt": prompt, "images": [image_b64], "stream": False, "keep_alive": KEEP_ALIVE},
        LOCAL_TIMEOUT,
    )
    return str(data.get("response") or "").strip()


def _see_cloud(image_b64: str, prompt: str, mime: str) -> str:
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("нет GEMINI_API_KEY")
    data = _post_json(
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={key}",
        {
            "contents": [{"parts": [{"inline_data": {"mime_type": mime, "data": image_b64}}, {"text": prompt}]}],
            "generationConfig": {"temperature": 0.4, "maxOutputTokens": 400},
        },
        CLOUD_TIMEOUT,
    )
    parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    return "".join(str(p.get("text") or "") for p in parts).strip()


def _see_local_many(images_b64: list[str], prompt: str) -> str:
    data = _post_json(
        f"{OLLAMA_URL}/api/generate",
        {"model": OLLAMA_VLM, "prompt": prompt, "images": images_b64, "stream": False, "keep_alive": KEEP_ALIVE},
        LOCAL_TIMEOUT,
    )
    return str(data.get("response") or "").strip()


def _see_cloud_many(images_b64: list[str], prompt: str, mime: str) -> str:
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("нет GEMINI_API_KEY")
    parts: list[dict[str, Any]] = [{"inline_data": {"mime_type": mime, "data": b}} for b in images_b64]
    parts.append({"text": prompt})
    data = _post_json(
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={key}",
        {"contents": [{"parts": parts}], "generationConfig": {"temperature": 0.4, "maxOutputTokens": 400}},
        CLOUD_TIMEOUT,
    )
    out = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
    return "".join(str(p.get("text") or "") for p in out).strip()


def see_many(images_b64: list[str], prompt: str, mime: str = "image/jpeg", prefer: str = "auto") -> tuple[str, str]:
    """Взгляд сразу на несколько кадров — так видно изменение, а не состояние."""
    order = ["local"] if prefer == "local" else (["cloud", "local"] if prefer == "cloud" else ["local", "cloud"])
    last = ""
    for eye in order:
        try:
            if eye == "local":
                if not local_eye_ready():
                    last = "свои глаза не подняты"
                    continue
                text = _see_local_many(images_b64, prompt)
            else:
                text = _see_cloud_many(images_b64, prompt, mime)
            if text:
                return text, eye
            last = f"{eye}: пустой ответ"
        except Exception as exc:  # noqa: BLE001
            last = f"{eye}: {exc}"
    raise RuntimeError(last or "сетчатка недоступна")


def see(image_b64: str, prompt: str, mime: str = "image/jpeg", prefer: str = "auto") -> tuple[str, str]:
    """Один взгляд. Возвращает (текст, чем смотрели).

    prefer='local' — только свои глаза, наружу не уходит ничего.
    prefer='cloud' — сразу облако (для сложного кадра).
    prefer='auto'  — свои, а если их нет, облако.
    """
    order: list[str] = []
    if prefer == "local":
        order = ["local"]
    elif prefer == "cloud":
        order = ["cloud", "local"]
    else:
        order = ["local", "cloud"]

    last = ""
    for eye in order:
        try:
            if eye == "local":
                if not local_eye_ready():
                    last = "свои глаза не подняты"
                    continue
                text = _see_local(image_b64, prompt)
            else:
                text = _see_cloud(image_b64, prompt, mime)
            if text:
                return text, eye
            last = f"{eye}: пустой ответ"
        except Exception as exc:  # noqa: BLE001 - слепота одного глаза не должна ронять зрение
            last = f"{eye}: {exc}"
    raise RuntimeError(last or "сетчатка недоступна")


# ── разматывание и сплетение ─────────────────────────────────────────────────
def unwrap(image_b64: str, lenses: tuple[str, ...], mime: str = "image/jpeg", prefer: str = "auto") -> Sight:
    """Развести кадр по линзам и собрать обратно.

    Линзы независимы, поэтому идут через пул. Для облака это честная
    параллельность; для локальной модели пул только упорядочивает очередь —
    Ollama всё равно считает по одной.
    """
    sight = Sight()
    if not lenses:
        lenses = QUICK_LENSES

    def look(name: str) -> tuple[str, str, str]:
        try:
            text, via = see(image_b64, LENSES[name], mime=mime, prefer=prefer)
            return name, text, via
        except Exception as exc:  # noqa: BLE001
            return name, "", str(exc)

    with ThreadPoolExecutor(max_workers=_workers(prefer, len(lenses))) as pool:
        for name, text, via_or_err in pool.map(look, lenses):
            if text:
                sight.lenses[name] = text
                if not sight.via:
                    sight.via = via_or_err
            else:
                sight.errors.append(f"{name}: {via_or_err}")

    sight.model = OLLAMA_VLM if sight.via == "local" else GEMINI_MODEL
    sight.woven = weave(sight.lenses)
    return sight


def weave(lenses: dict[str, str]) -> str:
    """Сплести линзы в одно восприятие.

    Намеренно без вызова модели: сшивать должен тот, у кого есть память и
    контекст, то есть само ядро. Здесь только честная раскладка увиденного,
    чтобы ядру было из чего думать.
    """
    if not lenses:
        return ""
    titles = {
        "scene": "Происходит",
        "objects": "В кадре",
        "light": "Свет и форма",
        "resonance": "Ритм и странности",
        "motion": "Изменилось",
    }
    return "\n".join(f"{titles.get(k, k)}: {v}" for k, v in lenses.items() if v)


# ── входы ────────────────────────────────────────────────────────────────────
def _read_image(path: str | Path) -> tuple[str, str]:
    p = Path(path)
    raw = p.read_bytes()
    ext = p.suffix.lower().lstrip(".")
    mime = {"png": "image/png", "webp": "image/webp", "gif": "image/gif"}.get(ext, "image/jpeg")
    return base64.b64encode(raw).decode("ascii"), mime


def _auto_depth(prefer: str) -> tuple[str, ...]:
    """Глубина по силе глаза: облаку не жалко пяти вопросов, локальной модели жалко."""
    if prefer == "cloud":
        return FULL_LENSES
    if prefer == "local":
        return QUICK_LENSES
    return FULL_LENSES if not local_eye_ready() else QUICK_LENSES


def perceive(path: str | Path, depth: str = "auto", prefer: str = "auto") -> dict[str, Any]:
    """Увидеть фотографию.

    depth: 'quick' — одна линза; 'full' — все; 'auto' — по силе глаза.
    """
    image_b64, mime = _read_image(path)
    if depth == "quick":
        lenses = QUICK_LENSES
    elif depth == "full":
        lenses = FULL_LENSES
    else:
        lenses = _auto_depth(prefer)
    sight = unwrap(image_b64, lenses, mime=mime, prefer=prefer)
    sight.source = str(path)
    return sight.to_dict()


# ── по уголкам: пространственное разматывание ────────────────────────────────
def _tiles(path: str | Path, grid: int = 2, keep_whole: bool = True) -> list[tuple[str, str]]:
    """Разрезать кадр на сетку grid×grid. Возвращает [(имя угла, base64)].

    Целое остаётся первым: угол показывает детали, которые в общем плане
    теряются, но без общего плана углы не сложить обратно — по одному
    фрагменту непонятно, часть чего это.
    """
    from PIL import Image  # локальный импорт: без Pillow зрение работает, просто без углов

    import io

    out: list[tuple[str, str]] = []
    img = Image.open(path).convert("RGB")
    if keep_whole:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=88)
        out.append(("целое", base64.b64encode(buf.getvalue()).decode("ascii")))
    w, h = img.size
    names = {(0, 0): "левый верх", (1, 0): "правый верх", (0, 1): "левый низ", (1, 1): "правый низ"}
    for gy in range(grid):
        for gx in range(grid):
            box = (w * gx // grid, h * gy // grid, w * (gx + 1) // grid, h * (gy + 1) // grid)
            buf = io.BytesIO()
            img.crop(box).save(buf, format="JPEG", quality=88)
            out.append((names.get((gx, gy), f"угол {gy}·{gx}"), base64.b64encode(buf.getvalue()).decode("ascii")))
    return out


def perceive_corners(path: str | Path, grid: int = 2, prefer: str = "auto") -> dict[str, Any]:
    """Разобрать кадр по углам и собрать обратно.

    Это про детали, а не про сцену: мелкий текст, лицо в глубине, предмет на
    периферии — то, что модель пропускает, когда описывает кадр целиком.
    """
    pieces = _tiles(path, grid=grid)
    prompt = "Опиши, что именно видно на этом фрагменте, включая мелкие детали и любой текст. Кратко, по-русски."

    def look(piece: tuple[str, str]) -> tuple[str, str]:
        name, b64 = piece
        try:
            text, _ = see(b64, prompt, prefer=prefer)
            return name, text
        except Exception as exc:  # noqa: BLE001
            return name, f"(не разглядел: {exc})"

    with ThreadPoolExecutor(max_workers=_workers(prefer, len(pieces))) as pool:
        parts = list(pool.map(look, pieces))

    return {
        "source": str(path),
        "corners": {name: text for name, text in parts},
        "text": "\n".join(f"{name}: {text}" for name, text in parts),
    }


# ── видео ────────────────────────────────────────────────────────────────────
def _video_frames(path: str | Path, count: int = 6) -> list[str]:
    """Достать `count` опорных кадров, равномерно по всей длине.

    Равномерно, а не подряд с начала: у ролика важна дуга целиком, а первые
    секунды часто одинаковы и ничего о нём не говорят.
    """
    import io

    import imageio.v3 as iio
    from PIL import Image

    # Плагин не указываем: imageio сам возьмёт тот, что стоит в системе
    # (обычно ffmpeg из imageio-ffmpeg). Жёсткий pyav ронял бы чтение там,
    # где его просто нет.
    frames = list(iio.imiter(str(path)))
    if not frames:
        return []
    total = len(frames)
    step = max(1, total // max(1, count))
    picked = frames[::step][:count]
    out: list[str] = []
    for arr in picked:
        buf = io.BytesIO()
        img = Image.fromarray(arr).convert("RGB")
        img.thumbnail((768, 768))  # кадр 4K в сетчатке не нужен, а время съедает
        img.save(buf, format="JPEG", quality=85)
        out.append(base64.b64encode(buf.getvalue()).decode("ascii"))
    return out


def perceive_video(path: str | Path, count: int = 6, prefer: str = "auto") -> dict[str, Any]:
    """Увидеть видео: опорные кадры плюс то, что между ними изменилось.

    Видео — это не набор картинок, а изменение. Поэтому кадры описываются
    коротко, а главное считывается на стыках: что двигалось, появилось, ушло.
    """
    frames = _video_frames(path, count=count)
    if not frames:
        return {"source": str(path), "error": "не удалось прочитать кадры", "text": ""}

    shot_prompt = "Опиши одной фразой, что на этом кадре. По-русски, только факты."

    def look(item: tuple[int, str]) -> tuple[int, str]:
        i, b64 = item
        try:
            text, _ = see(b64, shot_prompt, prefer=prefer)
            return i, text
        except Exception as exc:  # noqa: BLE001
            return i, f"(кадр не прочитан: {exc})"

    with ThreadPoolExecutor(max_workers=_workers(prefer, len(frames))) as pool:
        shots = dict(pool.map(look, list(enumerate(frames))))

    timeline = [shots[i] for i in sorted(shots)]
    body = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(timeline))

    # Шов: первый и последний кадр одним взглядом. Ролик — это про изменение,
    # а список описаний его как раз и теряет. Один запрос вместо прохода по
    # всем стыкам: на локальных глазах каждый стык стоит ~15 секунд.
    motion = ""
    if len(frames) >= 2:
        try:
            motion, _ = see_many([frames[0], frames[-1]], LENSES["motion"], prefer=prefer)
        except Exception as exc:  # noqa: BLE001 - без шва видео всё равно прочитано
            motion = f"(изменение не считано: {exc})"

    text = f"Опорные кадры ({len(frames)}):\n{body}"
    if motion:
        text += f"\n\nИзменилось за ролик: {motion}"
    return {
        "source": str(path),
        "frames": len(frames),
        "timeline": timeline,
        "motion": motion,
        "text": text,
    }
