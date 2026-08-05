"""World Model: у ядра Max17 появляется информация о 3D-мире.

До этого модуля поток был строго односторонним: эфир (голос) → браузер рисует
частицы → всё гаснет вместе с вкладкой. Ядро не знало о мире ни одного бита.
Здесь мир перестаёт быть картинкой и становится данными.

ПЕРЕПИСЬ. Браузер не шлёт частицы — их десятки тысяч, это бессмысленный
трафик. Он шлёт перепись (``WorldCensus``): два десятка чисел о том, каким
мир стал за последнюю секунду — сколько живых, сколько родилось и погасло,
радиус и плотность облака, закрутка рукавов, доминирующий оттенок. Этого
достаточно, чтобы ядро *видело* то, что породило.

СЕМЯ. Мир — это ``(seed, лента переписей)``, а не сессия. Идентификатор
детерминированно выводится из семени, поэтому мир можно закрыть и открыть
завтра, переслать ссылкой, показать другому. Это и есть первый настоящий
признак метавселенной, а не красивой заставки.

ВЕЩЕСТВО. Частицы гаснут по ``e^(−t/τ)`` и сами по себе не оставляют ничего.
Мир начинается там, где часть перестаёт гаснуть. Ответ, почему во вселенной
ядра вообще что-то остаётся, уже написан: ``critic`` аннигилирует пары оценок
с антиоценками, а ``genesis.baryon_asymmetry`` считает перевес выживших. Здесь
это переносится буквально — рождения за интервал считаются парами, гашения
аннигиляциями, — а ``genesis.nucleate`` говорит, какая доля перевеса смогла
связаться при нынешней температуре вселенной ядра. Связавшееся вещество
записывается в мир навсегда и переживает перезагрузку страницы.

ЗАКОНЫ. Обратно ядро отвечает не текстом, а физикой следующего интервала.
Эфир из ``genesis`` — не метафора: скорость ``c = 1/sqrt(eps*mu)`` задаёт, как
быстро возмущение расходится по полю частиц, а импеданс ``Z = sqrt(mu/eps)``
прямо говорит, насколько тяжело излучить в среду, то есть сколько стоит
рождение материи. Густой эфир — скупой мир.

Детерминировано и на стандартной библиотеке: ни ML, ни внешних вызовов.
"""

from __future__ import annotations

import hashlib
import math
import random
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from mark17.genesis import genesis

# Сколько тел максимум может сконденсироваться за одну перепись: даже в очень
# плотном мире вещество должно нарастать постепенно, а не пачками.
MAX_BODIES_PER_CENSUS = 3

# Ниже этой доли связанного вещества конденсат вообще не копится — мир слишком
# горяч или слишком разрежен, чтобы удержать структуру.
CONDENSATE_FLOOR = 0.02

# Сколько переписей хранить на мир (кольцо истории).
CENSUS_HISTORY = 400


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _as_float(payload: dict[str, Any], key: str, default: float = 0.0) -> float:
    try:
        return float(payload.get(key, default) or 0.0)
    except (TypeError, ValueError):
        return default


def _as_int(payload: dict[str, Any], key: str, default: int = 0) -> int:
    try:
        return int(payload.get(key, default) or 0)
    except (TypeError, ValueError):
        return default


def world_id_from_seed(seed: int) -> str:
    """Детерминированный короткий адрес мира. Одно семя — один и тот же мир."""
    digest = hashlib.sha256(f"max17-world:{seed}".encode()).hexdigest()
    return f"w-{digest[:12]}"


# SQLite хранит знаковое 64-битное целое, поэтому семя живёт в 63 битах.
SEED_MASK = (1 << 63) - 1


def seed_from_text(text: str) -> int:
    """Семя из произвольного текста — чтобы мир можно было назвать словом."""
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") & SEED_MASK


@dataclass
class WorldCensus:
    """Перепись 3D-мира за последний интервал. Это всё, что видит ядро."""

    alive: int = 0          # живых частиц сейчас
    born: int = 0           # родилось за интервал (пары)
    died: int = 0           # погасло за интервал (аннигиляции)
    radius: float = 0.0     # радиус облака, условные единицы мира
    density: float = 0.0    # 0..1 насколько мир заполнен
    spiral_b: float = 0.0   # закрутка логарифмической спирали
    arms: int = 0           # число рукавов
    hue: float = 0.0        # доминирующий оттенок, градусы
    symmetry: float = 0.0   # 0..1 насколько мир симметричен
    energy: float = 0.0     # 0..1 энергия звука, питавшего интервал
    dt: float = 1.0         # секунд с прошлой переписи

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "WorldCensus":
        src = payload.get("census") if isinstance(payload.get("census"), dict) else payload
        return cls(
            alive=max(0, _as_int(src, "alive")),
            born=max(0, _as_int(src, "born")),
            died=max(0, _as_int(src, "died")),
            radius=max(0.0, _as_float(src, "radius")),
            density=_clamp(_as_float(src, "density")),
            spiral_b=_as_float(src, "spiral_b"),
            arms=max(0, _as_int(src, "arms")),
            hue=_as_float(src, "hue") % 360.0,
            symmetry=_clamp(_as_float(src, "symmetry")),
            energy=_clamp(_as_float(src, "energy")),
            dt=max(0.01, _as_float(src, "dt", 1.0)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "alive": self.alive,
            "born": self.born,
            "died": self.died,
            "radius": round(self.radius, 3),
            "density": round(self.density, 3),
            "spiral_b": round(self.spiral_b, 3),
            "arms": self.arms,
            "hue": round(self.hue, 1),
            "symmetry": round(self.symmetry, 3),
            "energy": round(self.energy, 3),
            "dt": round(self.dt, 3),
        }


@dataclass
class Body:
    """Связавшееся вещество: то, что пережило гашение и осталось в мире."""

    world_id: str
    index: int
    mass: float
    x: float
    y: float
    z: float
    hue: float
    epoch: str
    born_at: float
    label: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "mass": round(self.mass, 3),
            "x": round(self.x, 4),
            "y": round(self.y, 4),
            "z": round(self.z, 4),
            "hue": round(self.hue, 1),
            "epoch": self.epoch,
            "born_at": round(self.born_at, 1),
            "label": self.label,
        }


@dataclass
class WorldLaws:
    """Физика следующего интервала: чем ядро отвечает браузеру."""

    emission_scale: float   # во сколько раз дешевле/дороже рождать материю
    lifetime_scale: float   # во сколько раз дольше живёт частица
    propagation: float      # c — скорость расхождения возмущения по полю
    impedance: float        # Z — тяжесть излучения в среду
    can_condense: bool      # способен ли мир сейчас удерживать структуру
    epoch: str
    epoch_title: str
    temperature: float | None
    bottleneck: str
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "emission_scale": round(self.emission_scale, 4),
            "lifetime_scale": round(self.lifetime_scale, 4),
            "propagation": round(self.propagation, 4),
            "impedance": round(self.impedance, 4),
            "can_condense": self.can_condense,
            "epoch": self.epoch,
            "epoch_title": self.epoch_title,
            "temperature": self.temperature,
            "bottleneck": self.bottleneck,
            "law": "c = 1/sqrt(eps mu) ; N_bound = asymmetry * N * exp(-T / T_bind)",
            **self.extra,
        }


class WorldModel:
    """Модель 3D-мира в ядре: миры, их переписи и связавшееся вещество."""

    def __init__(self, state_dir: Path) -> None:
        self.db_path = Path(state_dir) / "world_model.db"
        Path(state_dir).mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as c:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS worlds (
                    id TEXT PRIMARY KEY,
                    seed INTEGER NOT NULL,
                    user_id TEXT NOT NULL DEFAULT 'anon',
                    title TEXT NOT NULL DEFAULT '',
                    created_at REAL NOT NULL,
                    last_seen REAL NOT NULL,
                    census_count INTEGER NOT NULL DEFAULT 0,
                    peak_alive INTEGER NOT NULL DEFAULT 0,
                    total_born INTEGER NOT NULL DEFAULT 0,
                    total_died INTEGER NOT NULL DEFAULT 0,
                    condensate REAL NOT NULL DEFAULT 0,
                    body_count INTEGER NOT NULL DEFAULT 0,
                    matter_mass REAL NOT NULL DEFAULT 0,
                    epoch TEXT NOT NULL DEFAULT ''
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS census (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    world_id TEXT NOT NULL,
                    ts REAL NOT NULL,
                    alive INTEGER, born INTEGER, died INTEGER,
                    radius REAL, density REAL, spiral_b REAL, arms INTEGER,
                    hue REAL, symmetry REAL, energy REAL,
                    asymmetry REAL, bound_matter REAL, epoch TEXT
                )
                """
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_census_world ON census(world_id, ts)")
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS matter (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    world_id TEXT NOT NULL,
                    idx INTEGER NOT NULL,
                    ts REAL NOT NULL,
                    mass REAL NOT NULL,
                    x REAL, y REAL, z REAL,
                    hue REAL, epoch TEXT, label TEXT
                )
                """
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_matter_world ON matter(world_id, idx)")

    # --- миры ------------------------------------------------------------

    def ensure_world(self, seed: int, *, user_id: str = "anon", title: str = "") -> dict[str, Any]:
        """Найти мир по семени или родить его. Одно семя — всегда один мир."""
        wid = world_id_from_seed(seed)
        now = time.time()
        existing = self.get(wid)
        if existing:
            return existing
        with self._conn() as c:
            c.execute(
                """
                INSERT INTO worlds (id, seed, user_id, title, created_at, last_seen)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (wid, int(seed), user_id, title, now, now),
            )
        return self.get(wid) or {}

    def get(self, world_id: str) -> dict[str, Any] | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM worlds WHERE id = ?", (world_id,)).fetchone()
        return dict(row) if row else None

    def recent_worlds(self, *, limit: int = 10) -> list[dict[str, Any]]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM worlds ORDER BY last_seen DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    def bodies(self, world_id: str, *, limit: int = 200) -> list[dict[str, Any]]:
        """Вещество мира — то, ради чего мир вообще стоит открывать заново."""
        with self._conn() as c:
            rows = c.execute(
                """
                SELECT idx, ts, mass, x, y, z, hue, epoch, label
                FROM matter WHERE world_id = ? ORDER BY idx DESC LIMIT ?
                """,
                (world_id, limit),
            ).fetchall()
        return [
            {
                "index": r["idx"],
                "mass": round(r["mass"], 3),
                "x": round(r["x"], 4),
                "y": round(r["y"], 4),
                "z": round(r["z"], 4),
                "hue": round(r["hue"], 1),
                "epoch": r["epoch"],
                "born_at": round(r["ts"], 1),
                "label": r["label"] or "",
            }
            for r in rows
        ]

    def history(self, world_id: str, *, limit: int = 20) -> list[dict[str, Any]]:
        with self._conn() as c:
            rows = c.execute(
                """
                SELECT ts, alive, born, died, density, radius, epoch, bound_matter
                FROM census WHERE world_id = ? ORDER BY ts DESC LIMIT ?
                """,
                (world_id, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    # --- главное: наблюдение мира ----------------------------------------

    def observe(
        self,
        world_id: str,
        census: WorldCensus,
        *,
        tension: float = 0.0,
        now: float | None = None,
    ) -> dict[str, Any]:
        """Принять перепись, сгустить вещество, вернуть законы следующего интервала.

        Плотность мира — это нагрузка на среду, а напряжение человека (из
        ``voice_state``) — неуверенность. Ровно эти две ручки уже загущают эфир
        в ``genesis.thicken``, поэтому здесь ничего изобретать не нужно:
        встревоженный человек в плотном мире получает густую скупую среду.
        """
        now = time.time() if now is None else now
        world = self.get(world_id)
        if world is None:
            raise KeyError(f"unknown world: {world_id}")

        # Вселенная ядра на этот момент: эпоха, температура, эфир, вещество.
        # Пары — это рождения за интервал, аннигиляции — гашения.
        cosmos = genesis(
            now=now,
            quanta=census.alive,
            pairs=census.born,
            annihilated=census.died,
            load=census.density,
            uncertainty=_clamp(tension),
        )
        ether = cosmos["ether"]
        matter = cosmos["matter"]
        epoch = str(cosmos["epoch"])

        # Сколько вещества связалось за этот интервал. Ниже пола не копим.
        bound = float(matter["bound_matter"])
        gain = 0.0
        if census.alive > 0 and bound > 0:
            share = bound / max(1.0, float(census.alive))
            if share >= CONDENSATE_FLOOR:
                gain = share * census.dt

        condensate = float(world["condensate"]) + gain
        body_count = int(world["body_count"])
        new_bodies: list[Body] = []
        while condensate >= 1.0 and len(new_bodies) < MAX_BODIES_PER_CENSUS:
            condensate -= 1.0
            body = self._nucleate_body(
                world_id=world_id,
                seed=int(world["seed"]),
                index=body_count + len(new_bodies),
                census=census,
                epoch=epoch,
                mass=bound / max(1.0, float(census.alive)) * 100.0,
                now=now,
            )
            new_bodies.append(body)

        laws = self._laws(ether, cosmos, census)
        self._persist(world, census, cosmos, condensate, new_bodies, now)

        return {
            "world_id": world_id,
            "seed": int(world["seed"]),
            "census": census.to_dict(),
            "cosmos": {
                "age_human": cosmos["age_human"],
                "epoch": epoch,
                "epoch_title": cosmos["epoch_title"],
                "epoch_note": cosmos["epoch_note"],
                "temperature": cosmos["temperature"],
                "ether": ether,
                "matter": matter,
            },
            "laws": laws.to_dict(),
            "condensate": round(condensate, 4),
            "new_bodies": [b.to_dict() for b in new_bodies],
            "body_count": body_count + len(new_bodies),
            "hint": self.describe(census, laws, len(new_bodies)),
        }

    def _nucleate_body(
        self,
        *,
        world_id: str,
        seed: int,
        index: int,
        census: WorldCensus,
        epoch: str,
        mass: float,
        now: float,
    ) -> Body:
        """Родить тело. Положение выводится из семени — мир воспроизводим."""
        rng = random.Random(f"{seed}:{index}")
        # Тело садится на тот же радиус, где сейчас живёт облако.
        r = max(0.1, census.radius) * (0.35 + rng.random() * 0.85)
        theta = rng.random() * math.tau
        # Диск: по вертикали заметно тоньше, чем в плоскости.
        height = (rng.random() - 0.5) * max(0.1, census.radius) * 0.28
        return Body(
            world_id=world_id,
            index=index,
            mass=max(0.01, mass),
            x=r * math.cos(theta),
            y=height,
            z=r * math.sin(theta),
            hue=(census.hue + (rng.random() - 0.5) * 24.0) % 360.0,
            epoch=epoch,
            born_at=now,
            label=f"тело-{index + 1}",
        )

    def _laws(
        self, ether: dict[str, Any], cosmos: dict[str, Any], census: WorldCensus
    ) -> WorldLaws:
        """Перевести физику вселенной ядра в законы отрисовки мира."""
        impedance = float(ether["impedance"])
        speed = float(ether["speed"])

        # Z — тяжесть излучения в среду, значит прямо цена рождения материи.
        # Густой эфир: рождать дорого, зато рождённое живёт дольше — среда его
        # держит. Оба множителя ограничены, чтобы мир не срывался в крайности.
        emission_scale = _clamp(1.0 / impedance if impedance > 0 else 1.0, 0.25, 2.5)
        lifetime_scale = _clamp(0.6 + impedance * 0.5, 0.5, 2.5)

        temp = cosmos["temperature"]
        # Связывание вообще возможно, только когда остыло ниже адронизации.
        can_condense = float(cosmos["matter"]["bound_fraction"]) > 0.1

        return WorldLaws(
            emission_scale=emission_scale,
            lifetime_scale=lifetime_scale,
            propagation=speed,
            impedance=impedance,
            can_condense=can_condense,
            epoch=str(cosmos["epoch"]),
            epoch_title=str(cosmos["epoch_title"]),
            temperature=temp,
            bottleneck=str(ether.get("bottleneck", "balanced")),
            extra={"bound_fraction": cosmos["matter"]["bound_fraction"]},
        )

    def _persist(
        self,
        world: dict[str, Any],
        census: WorldCensus,
        cosmos: dict[str, Any],
        condensate: float,
        new_bodies: list[Body],
        now: float,
    ) -> None:
        wid = world["id"]
        mass_gain = sum(b.mass for b in new_bodies)
        with self._conn() as c:
            c.execute(
                """
                UPDATE worlds SET
                    last_seen = ?, census_count = census_count + 1,
                    peak_alive = MAX(peak_alive, ?),
                    total_born = total_born + ?, total_died = total_died + ?,
                    condensate = ?, body_count = body_count + ?,
                    matter_mass = matter_mass + ?, epoch = ?
                WHERE id = ?
                """,
                (
                    now, census.alive, census.born, census.died,
                    condensate, len(new_bodies), mass_gain,
                    str(cosmos["epoch"]), wid,
                ),
            )
            c.execute(
                """
                INSERT INTO census (world_id, ts, alive, born, died, radius, density,
                                    spiral_b, arms, hue, symmetry, energy,
                                    asymmetry, bound_matter, epoch)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    wid, now, census.alive, census.born, census.died, census.radius,
                    census.density, census.spiral_b, census.arms, census.hue,
                    census.symmetry, census.energy,
                    cosmos["matter"]["asymmetry"], cosmos["matter"]["bound_matter"],
                    str(cosmos["epoch"]),
                ),
            )
            for b in new_bodies:
                c.execute(
                    """
                    INSERT INTO matter (world_id, idx, ts, mass, x, y, z, hue, epoch, label)
                    VALUES (?,?,?,?,?,?,?,?,?,?)
                    """,
                    (wid, b.index, b.born_at, b.mass, b.x, b.y, b.z, b.hue, b.epoch, b.label),
                )
            # Кольцо истории: старые переписи не нужны, вещество вечно.
            c.execute(
                """
                DELETE FROM census WHERE world_id = ? AND id NOT IN (
                    SELECT id FROM census WHERE world_id = ? ORDER BY ts DESC LIMIT ?
                )
                """,
                (wid, wid, CENSUS_HISTORY),
            )

    @staticmethod
    def describe(census: WorldCensus, laws: WorldLaws, born_bodies: int) -> str:
        """Одна фраза о том, что сейчас с миром — её Макс и произносит."""
        if census.alive == 0:
            return "Мир пуст: эфир молчит, рождаться нечему."
        if born_bodies:
            return (
                f"Сгустилось вещество ({born_bodies}) — эпоха «{laws.epoch_title}», "
                f"оно останется в мире и после закрытия."
            )
        if not laws.can_condense:
            return (
                f"Слишком горячо для структуры (эпоха «{laws.epoch_title}») — "
                "частицы живут и гаснут, вещество пока не связывается."
            )
        if census.density < 0.15:
            return "Мир разреженный — возьми громче или выше, он сгустится."
        if laws.bottleneck == "memory":
            return "Эфир густой со стороны памяти: рождать дорого, зато рождённое живёт дольше."
        if laws.bottleneck == "attention":
            return "Эфир густой со стороны внимания: мир торопится, структура не успевает встать."
        return f"Мир держится ровно: {census.alive} живых, эпоха «{laws.epoch_title}»."


def process_world_event(
    payload: dict[str, Any],
    model: WorldModel,
    *,
    tension: float = 0.0,
    now: float | None = None,
) -> dict[str, Any]:
    """Сквозной путь: перепись → мир → вещество → законы. JSON-готовый ответ."""
    user_id = str(payload.get("user_id") or "anon")
    title = str(payload.get("title") or "")

    seed_raw = payload.get("seed")
    if seed_raw is None or seed_raw == "":
        # Без семени мир всё равно должен быть адресуемым: выводим его из
        # имени и человека, чтобы «тот же мир» открывался тем же.
        seed = seed_from_text(f"{user_id}:{title}")
    elif isinstance(seed_raw, str) and not seed_raw.lstrip("-").isdigit():
        seed = seed_from_text(seed_raw)
    else:
        # Чужое семя тоже должно влезать в хранилище, каким бы большим ни пришло.
        seed = abs(int(seed_raw)) & SEED_MASK

    world = model.ensure_world(seed, user_id=user_id, title=title)
    census = WorldCensus.from_payload(payload)
    result = model.observe(world["id"], census, tension=tension, now=now)

    result["world"] = {
        "id": world["id"],
        "seed": int(world["seed"]),
        "title": world["title"],
        "created_at": round(float(world["created_at"]), 1),
        "census_count": int(world["census_count"]) + 1,
        "peak_alive": max(int(world["peak_alive"]), census.alive),
    }
    result["bodies"] = model.bodies(world["id"], limit=64)
    return result
