"""Агент: первый автономный житель мира Max17.

Всё, что ядро умело до сих пор, — реагировать. Браузер присылал событие, ядро
отвечало. Никто внутри не действовал сам. Агент — первый, кто действует: он
смотрит на мир, хочет от мира определённого, выбирает, чем его подтолкнуть, и
на следующем такте проверяет, вышло ли задуманное.

Выбор подчиняется свободной энергии Гельмгольца

    F = E - T * S

  * E — энергия рассогласования: насколько мир не такой, каким агенту нужно.
    Складывается из четырёх влечений, у каждого своя уставка;
  * S — энтропия мира: сколько в нём ещё осталось неопределённости. Считается
    по Шеннону от огрублённого описания мира;
  * T — температура агента: возбуждение человека и энергия звука, поделённые
    на густоту эфира. Горячий агент терпит беспорядок ради разнообразия
    (член -T*S тянет вниз), холодный вылизывает структуру.

Одна формула закрывает разведку и эксплуатацию. Не два режима с переключателем,
а одна величина: пока человек разогнан и эфир жидкий, агент рискует; когда всё
успокоилось, он наводит порядок. Это видно снаружи и это не декорация.

Учится агент на ошибке предсказания. У каждого действия есть заявленный эффект;
агент записывает, каким ждёт мир, а на следующем такте сверяет с тем, каким мир
стал. Расхождение снижает доверие к действию, совпадение поднимает. Доверие
масштабирует эффект при следующем выборе — действие, которое врёт, перестаёт
выигрывать. Никакого ML: тот же вход и то же состояние дают тот же выбор.
"""

from __future__ import annotations

import json
import math
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# --- Свободная энергия ------------------------------------------------------
# Во сколько раз цена действия весит против выигрыша по свободной энергии.
# Достаточно мала, чтобы не запирать агента, и достаточно велика, чтобы он не
# дёргал мир, когда тот и так близок к уставкам.
COST_LAMBDA = 0.35
# Температура агента в покое: даже у молчащего человека остаётся чуть-чуть
# разведки, иначе агент навсегда замирает в первом же локальном минимуме.
BASE_TEMPERATURE = 0.10
AROUSAL_HEAT = 0.75
ENERGY_HEAT = 0.30
# Эфир не может ускорить агента, только остудить: c = 1 — это его потолок.
MIN_PROPAGATION = 0.25
MAX_PROPAGATION = 1.0

# --- Обучение ---------------------------------------------------------------
# Насколько сильно один такт двигает доверие. 0.25 — примерно четыре такта на
# полный разворот мнения о действии.
TRUST_RATE = 0.25
TRUST_START = 0.6
TRUST_FLOOR = 0.15
TRUST_CEIL = 1.0
# Агент — не единственная сила в мире: голос человека двигает его на порядок
# сильнее. Требовать от агента угадать, каким мир станет, значит требовать
# угадать человека, и тогда доверие ко всем действиям падает в пол независимо
# от того, работают они или нет (проверено на живом мире: точность 0% у всего).
# Поэтому меряется не попадание в точку, а направление: подтолкнул ли агент мир
# туда, куда обещал. Шум даёт около 0.5 — «ничего не узнали», и доверие стоит.
#
# Ниже этого мир считается неподвижным. Нужно для «наблюдения», у которого
# обещание — что мир не поедет сам, и направление у такого обещания отсутствует.
STILLNESS = 0.02

# --- Хранилище --------------------------------------------------------------
JOURNAL_LIMIT = 240
JOURNAL_TRIM_EVERY = 40

OBSERVABLES = ("density", "symmetry", "change", "calm")


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _as_float(source: Any, key: str, default: float = 0.0) -> float:
    if not isinstance(source, dict):
        return default
    try:
        value = float(source.get(key, default))
    except (TypeError, ValueError):
        return default
    return value if math.isfinite(value) else default


def _binary_entropy(p: float) -> float:
    """Шеннон для одного огрублённого канала, в битах: 0 или 1 — 0, ½ — 1."""
    p = _clamp(p)
    if p <= 0.0 or p >= 1.0:
        return 0.0
    return -(p * math.log2(p) + (1.0 - p) * math.log2(1.0 - p))


# --- Влечения ---------------------------------------------------------------


@dataclass(frozen=True)
class DriveSpec:
    """Одно влечение: за какой наблюдаемой следит, чего хочет, насколько."""

    key: str
    title: str
    observable: str
    target: float
    weight: float
    starved: str   # что агент говорит, когда именно это влечение голодает
    sated: str


# Уставки не выдуманы, а сняты с живого мира «Эфира» (25 переписей, реальный
# звук в микрофон): плотность ходит 0.35..0.84, угловая симметрия 0.92..0.95,
# оборот частиц держится около 0.10 — это change ≈ 0.07..0.12.
#
# Уставка вне достижимого диапазона превращает влечение в постоянный перекос:
# агент вечно голоден по одной оси и выбирает одно и то же действие независимо
# от того, что происходит в мире. Ровно это и было на первых замерах — три
# влечения из четырёх упирались в край шкалы, и агент час подряд перекрашивал
# мир. Замер громкий, с непрерывным тоном; живая речь с паузами даёт меньше,
# поэтому уставки стоят ближе к нижней половине наблюдённых полос.
DRIVES: tuple[DriveSpec, ...] = (
    DriveSpec(
        key="care",
        title="Забота",
        observable="calm",
        target=0.85,
        weight=1.25,
        starved="ты напряжён — увожу мир в спокойное",
        sated="тебе ровно",
    ),
    DriveSpec(
        key="growth",
        title="Рост",
        observable="density",
        target=0.55,
        weight=1.0,
        starved="мир пустоват, ему нужно вещество",
        sated="плотность в самый раз",
    ),
    DriveSpec(
        key="order",
        title="Порядок",
        observable="symmetry",
        # Канал долго был мёртвым: рукава размазывало дифференциальным
        # вращением, и симметрия стояла на 0.99 при любой музыке. После
        # перехода на волну плотности она ходит 0.92..0.95 — узко, но живо.
        # Вес ниже остальных именно поэтому: полоса узкая, доверия к ней меньше.
        target=0.93,
        weight=0.55,
        starved="мир расползается, свожу его",
        sated="структура держится",
    ),
    DriveSpec(
        key="novelty",
        title="Новизна",
        observable="change",
        target=0.20,
        weight=0.7,
        starved="мир застыл, мне скучно",
        sated="мир движется",
    ),
)


# --- Действия ---------------------------------------------------------------


@dataclass(frozen=True)
class ActionSpec:
    """Что агент умеет сделать с миром и чего от этого ждёт.

    ``effect`` — предсказание в тех же наблюдаемых, что и влечения. Именно оно
    проверяется на следующем такте и именно оно взвешивается доверием.
    ``knobs`` — то, что уезжает в браузер и реально меняет отрисовку.
    """

    key: str
    title: str
    effect: dict[str, float]
    cost: float
    knobs: dict[str, float]
    note: str


ACTIONS: tuple[ActionSpec, ...] = (
    ActionSpec(
        key="bloom",
        title="Цветение",
        effect={"density": 0.14, "symmetry": -0.05, "change": 0.16, "calm": -0.01},
        cost=0.10,
        knobs={"emission": 1.50, "lifetime": 1.00, "arms": 0.0, "spiral": 0.0, "hue": 0.0},
        note="раскрываю эфир: рождений больше",
    ),
    ActionSpec(
        key="hush",
        title="Затишье",
        effect={"density": -0.12, "symmetry": 0.07, "change": 0.03, "calm": 0.07},
        cost=0.08,
        knobs={"emission": 0.55, "lifetime": 1.00, "arms": 0.0, "spiral": 0.0, "hue": 0.0},
        note="сбавляю рождения, даю миру выдохнуть",
    ),
    ActionSpec(
        key="weave",
        title="Свивание",
        effect={"density": 0.02, "symmetry": 0.16, "change": 0.06, "calm": 0.02},
        cost=0.09,
        knobs={"emission": 1.05, "lifetime": 1.15, "arms": -1.0, "spiral": -0.12, "hue": 0.0},
        note="стягиваю рукава, свожу мир к оси",
    ),
    ActionSpec(
        key="scatter",
        title="Рассеяние",
        effect={"density": 0.03, "symmetry": -0.14, "change": 0.20, "calm": -0.02},
        cost=0.11,
        knobs={"emission": 1.15, "lifetime": 0.90, "arms": 1.0, "spiral": 0.14, "hue": 0.0},
        note="разбрасываю рукава, пускаю мир вширь",
    ),
    ActionSpec(
        key="tint",
        title="Перекрас",
        effect={"density": 0.0, "symmetry": 0.02, "change": 0.12, "calm": 0.03},
        cost=0.05,
        # Сдвиг оттенка держим маленьким: браузер догоняет цель плавно, и
        # частый перекрас должен читаться как течение, а не как стробоскоп.
        knobs={"emission": 1.00, "lifetime": 1.00, "arms": 0.0, "spiral": 0.0, "hue": 30.0},
        note="увожу цвет — самое дешёвое, чем можно удивить",
    ),
    ActionSpec(
        key="hold",
        title="Удержание",
        effect={"density": 0.04, "symmetry": 0.09, "change": -0.08, "calm": 0.05},
        cost=0.07,
        knobs={"emission": 0.95, "lifetime": 1.60, "arms": 0.0, "spiral": -0.04, "hue": 0.0},
        note="держу рождённое дольше — пусть свяжется в вещество",
    ),
    ActionSpec(
        key="watch",
        title="Наблюдение",
        effect={},
        cost=0.0,
        knobs={"emission": 1.00, "lifetime": 1.00, "arms": 0.0, "spiral": 0.0, "hue": 0.0},
        note="не трогаю мир, просто смотрю",
    ),
)

ACTION_BY_KEY = {a.key: a for a in ACTIONS}


# --- Наблюдение -------------------------------------------------------------


@dataclass
class Observation:
    """Мир, огрублённый до четырёх чисел — ровно того, что агенту нужно."""

    density: float = 0.0
    symmetry: float = 0.0
    change: float = 0.0
    calm: float = 1.0
    # Сырьё, из которого посчитан change: нужно, чтобы сравнить со следующим тактом.
    hue: float = 0.0
    radius: float = 0.0

    def vector(self) -> dict[str, float]:
        return {
            "density": self.density,
            "symmetry": self.symmetry,
            "change": self.change,
            "calm": self.calm,
        }

    def to_dict(self) -> dict[str, float]:
        """Округлённый вид — для ответа наружу, где лишние знаки только мешают."""
        out = {k: round(v, 4) for k, v in self.vector().items()}
        out["hue"] = round(self.hue, 1)
        out["radius"] = round(self.radius, 4)
        return out

    def to_state(self) -> dict[str, float]:
        """Полная точность — для хранения.

        Округлять нельзя: на следующем такте по этим числам считается, куда
        поехал мир, и обрезанный четвёртый знак превращается в еле заметное
        движение с вполне определённым направлением. Агент принимал такой шум
        за подтверждение своего предсказания и поднимал доверие на ровном месте.
        """
        out = dict(self.vector())
        out["hue"] = self.hue
        out["radius"] = self.radius
        return out


def observe_world(
    census: dict[str, Any],
    *,
    tension: float = 0.0,
    previous: Observation | None = None,
) -> Observation:
    """Свернуть перепись мира и состояние человека в четыре наблюдаемые.

    ``change`` — единственная величина, которой нет в переписи напрямую: мир
    может быть плотным и симметричным, но при этом мёртвым. Она собирается из
    оборота частиц и того, насколько мир сдвинулся с прошлого такта.
    """
    alive = max(0.0, _as_float(census, "alive"))
    born = max(0.0, _as_float(census, "born"))
    died = max(0.0, _as_float(census, "died"))

    turnover = 0.0
    if alive + born + died > 0:
        turnover = _clamp((born + died) / (alive + born + died))

    hue = _as_float(census, "hue") % 360.0
    radius = max(0.0, _as_float(census, "radius"))

    drift = 0.0
    if previous is not None:
        # Оттенок кольцевой: 350° и 10° — соседи, а не противоположности.
        d_hue = abs(hue - previous.hue) % 360.0
        d_hue = min(d_hue, 360.0 - d_hue) / 180.0
        span = max(0.35, previous.radius, radius)
        d_rad = abs(radius - previous.radius) / span
        drift = _clamp(0.65 * d_hue + 0.45 * d_rad)

    # Каналы не делят единицу между собой: мир, который только перекрасился,
    # изменился по-настоящему, даже если ни одна частица не родилась.
    return Observation(
        density=_clamp(_as_float(census, "density")),
        symmetry=_clamp(_as_float(census, "symmetry")),
        change=_clamp(0.7 * turnover + 0.5 * drift),
        calm=_clamp(1.0 - _clamp(tension)),
        hue=hue,
        radius=radius,
    )


# --- Термодинамика выбора ---------------------------------------------------


def energy(vector: dict[str, float]) -> float:
    """E — сумма квадратов рассогласований по влечениям, со своими весами."""
    total = 0.0
    for spec in DRIVES:
        deficit = spec.target - _clamp(vector.get(spec.observable, 0.0))
        total += spec.weight * deficit * deficit
    return total


def entropy(vector: dict[str, float]) -> float:
    """S — сколько неопределённости мир ещё держит, в битах на канал.

    Три независимых огрублённых канала: беспорядок, оборот, заполненность.
    Полностью пустой и полностью забитый мир одинаково скучны — у обоих S = 0,
    и это ровно то, что энтропия и должна говорить.
    """
    channels = (
        1.0 - _clamp(vector.get("symmetry", 0.0)),
        _clamp(vector.get("change", 0.0)),
        _clamp(vector.get("density", 0.0)),
    )
    return sum(_binary_entropy(p) for p in channels) / len(channels)


def temperature(*, arousal: float, sound_energy: float, propagation: float) -> float:
    """T — насколько агент сейчас склонен рисковать.

    Возбуждение человека и энергия звука греют. Густой эфир (малое c) остужает:
    в тяжёлой среде дальние затеи не доходят, и агент это учитывает.
    """
    heat = BASE_TEMPERATURE + AROUSAL_HEAT * _clamp(arousal) + ENERGY_HEAT * _clamp(sound_energy)
    medium = _clamp(propagation, MIN_PROPAGATION, MAX_PROPAGATION)
    return heat * medium


def free_energy(vector: dict[str, float], temp: float) -> tuple[float, float, float]:
    """F = E - T*S. Возвращает (F, E, S)."""
    e = energy(vector)
    s = entropy(vector)
    return e - temp * s, e, s


def predict(obs_vector: dict[str, float], action: ActionSpec, trust: float) -> dict[str, float]:
    """Каким агент ждёт мир после действия. Доверие гасит заявленный эффект."""
    return {
        key: _clamp(obs_vector.get(key, 0.0) + trust * action.effect.get(key, 0.0))
        for key in OBSERVABLES
    }


# --- Агент ------------------------------------------------------------------


@dataclass
class Decision:
    action: ActionSpec
    free_energy: float
    predicted: dict[str, float]
    considered: list[dict[str, Any]] = field(default_factory=list)


def decide(
    obs: Observation,
    temp: float,
    trust: dict[str, float],
) -> Decision:
    """Выбрать действие с наименьшей предсказанной свободной энергией.

    Ничего случайного: при равенстве побеждает то, что раньше в ``ACTIONS``.
    Разведка берётся не из шума, а из члена -T*S.
    """
    vector = obs.vector()
    scored: list[tuple[float, ActionSpec, dict[str, float], float, float]] = []
    for spec in ACTIONS:
        t = trust.get(spec.key, TRUST_START)
        predicted = predict(vector, spec, t)
        f, e, s = free_energy(predicted, temp)
        scored.append((f + COST_LAMBDA * spec.cost, spec, predicted, e, s))

    scored.sort(key=lambda row: (round(row[0], 9), ACTIONS.index(row[1])))
    best_f, best_spec, best_pred, _, _ = scored[0]

    considered = [
        {
            "key": spec.key,
            "title": spec.title,
            "free_energy": round(f, 4),
            "trust": round(trust.get(spec.key, TRUST_START), 3),
            "chosen": spec.key == best_spec.key,
        }
        for f, spec, _, _, _ in scored
    ]
    return Decision(action=best_spec, free_energy=best_f, predicted=best_pred, considered=considered)


def mood_of(obs: Observation, temp: float, drives: list[dict[str, Any]]) -> str:
    """Одно слово о том, в каком состоянии агент. Читается прямо в HUD."""
    hungriest = max(drives, key=lambda d: d["deficit"])
    if hungriest["deficit"] < 0.08:
        return "разогнан" if temp > 0.75 else "доволен"
    base = {
        "care": "тревожен",
        "growth": "голоден",
        "order": "собран",
        "novelty": "скучает",
    }.get(hungriest["key"], "занят")
    if temp > 0.8:
        return f"{base}, разогнан"
    if temp < 0.2:
        return f"{base}, остыл"
    return base


class Agent:
    """Автономный агент, живущий в одном мире и помнящий себя между сессиями."""

    def __init__(self, state_dir: Path) -> None:
        self.db_path = Path(state_dir) / "agent.db"
        Path(state_dir).mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS agents (
                    agent_id  TEXT PRIMARY KEY,
                    world_id  TEXT NOT NULL,
                    born_at   REAL NOT NULL,
                    ticks     INTEGER NOT NULL DEFAULT 0,
                    last_ts   REAL NOT NULL DEFAULT 0,
                    pending   TEXT NOT NULL DEFAULT '',
                    last_obs  TEXT NOT NULL DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS action_stats (
                    agent_id  TEXT NOT NULL,
                    action    TEXT NOT NULL,
                    uses      INTEGER NOT NULL DEFAULT 0,
                    trust     REAL NOT NULL DEFAULT 0.6,
                    error     REAL NOT NULL DEFAULT 0.0,
                    last_used REAL NOT NULL DEFAULT 0,
                    PRIMARY KEY (agent_id, action)
                );

                CREATE TABLE IF NOT EXISTS journal (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    agent_id    TEXT NOT NULL,
                    ts          REAL NOT NULL,
                    tick        INTEGER NOT NULL,
                    action      TEXT NOT NULL,
                    free_energy REAL NOT NULL,
                    temperature REAL NOT NULL,
                    mood        TEXT NOT NULL,
                    note        TEXT NOT NULL DEFAULT ''
                );

                CREATE INDEX IF NOT EXISTS idx_journal_agent
                    ON journal (agent_id, id DESC);
                """
            )

    # -- адресация ---------------------------------------------------------

    @staticmethod
    def agent_id_for(world_id: str) -> str:
        """У каждого мира ровно один агент, и его адрес выводится из мира."""
        tail = "".join(ch for ch in str(world_id) if ch.isalnum())[-12:] or "void"
        return f"a-{tail}"

    def ensure(self, world_id: str, *, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        agent_id = self.agent_id_for(world_id)
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM agents WHERE agent_id = ?", (agent_id,)
            ).fetchone()
            if row is not None:
                return dict(row)
            conn.execute(
                "INSERT INTO agents (agent_id, world_id, born_at, ticks, last_ts) "
                "VALUES (?, ?, ?, 0, 0)",
                (agent_id, str(world_id), now),
            )
            for spec in ACTIONS:
                conn.execute(
                    "INSERT OR IGNORE INTO action_stats (agent_id, action, trust) VALUES (?, ?, ?)",
                    (agent_id, spec.key, TRUST_START),
                )
            row = conn.execute(
                "SELECT * FROM agents WHERE agent_id = ?", (agent_id,)
            ).fetchone()
        return dict(row)

    # -- доверие -----------------------------------------------------------

    def trust_table(self, agent_id: str) -> dict[str, dict[str, Any]]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT action, uses, trust, error, last_used FROM action_stats "
                "WHERE agent_id = ?",
                (agent_id,),
            ).fetchall()
        table = {
            spec.key: {"trust": TRUST_START, "uses": 0, "error": 0.0, "last_used": 0.0}
            for spec in ACTIONS
        }
        for row in rows:
            if row["action"] in table:
                table[row["action"]] = {
                    "trust": float(row["trust"]),
                    "uses": int(row["uses"]),
                    "error": float(row["error"]),
                    "last_used": float(row["last_used"]),
                }
        return table

    def _learn(
        self,
        conn: sqlite3.Connection,
        agent_id: str,
        pending: dict[str, Any],
        actual: dict[str, float],
        before: dict[str, float],
    ) -> dict[str, Any] | None:
        """Сверить прошлое обещание с тем, куда мир поехал, и подвинуть доверие."""
        action_key = str(pending.get("action") or "")
        spec = ACTION_BY_KEY.get(action_key)
        predicted = pending.get("predicted")
        if spec is None or not isinstance(predicted, dict):
            return None

        # Проверяем только то, что действие обещало сдвинуть. Для «наблюдения»
        # обещание — что мир не поедет сам, и это тоже проверяемо.
        keys: tuple[str, ...] = tuple(spec.effect.keys()) or OBSERVABLES
        claim = pending.get("claim") if isinstance(pending.get("claim"), dict) else {}

        promised = [float(claim.get(k, 0.0) or 0.0) for k in keys]
        moved = [actual.get(k, 0.0) - before.get(k, 0.0) for k in keys]
        error = sum(
            abs(actual.get(k, 0.0) - float(predicted.get(k, 0.0))) for k in keys
        ) / max(1, len(keys))

        norm_p = math.sqrt(sum(p * p for p in promised))
        norm_m = math.sqrt(sum(m * m for m in moved))

        if norm_p <= 1e-9:
            # «Наблюдение»: обещания-вектора нет, есть обещание неподвижности.
            accuracy = _clamp(1.0 - norm_m / (STILLNESS * math.sqrt(len(keys))))
        elif norm_m < STILLNESS:
            # Мир не шелохнулся, хотя действие обещало движение — это промах,
            # и неважно, в какую сторону смотрит оставшийся шум.
            accuracy = 0.0
        else:
            # Косинус между обещанным и случившимся: +1 — попал в направление,
            # -1 — толкнул ровно в обратную сторону, 0 — узнали ничего.
            cosine = sum(p * m for p, m in zip(promised, moved)) / (norm_p * norm_m)
            accuracy = _clamp((cosine + 1.0) / 2.0)

        row = conn.execute(
            "SELECT trust, error, uses FROM action_stats WHERE agent_id = ? AND action = ?",
            (agent_id, action_key),
        ).fetchone()
        trust_before = float(row["trust"]) if row else TRUST_START
        prev_error = float(row["error"]) if row else 0.0
        uses = int(row["uses"]) if row else 0

        after = _clamp(
            trust_before + TRUST_RATE * (accuracy - trust_before), TRUST_FLOOR, TRUST_CEIL
        )
        mean_error = error if uses <= 1 else prev_error + (error - prev_error) / min(uses, 20)

        conn.execute(
            "UPDATE action_stats SET trust = ?, error = ? WHERE agent_id = ? AND action = ?",
            (after, mean_error, agent_id, action_key),
        )
        return {
            "action": action_key,
            "title": spec.title,
            "predicted": {k: round(float(predicted.get(k, 0.0)), 4) for k in keys},
            "actual": {k: round(actual.get(k, 0.0), 4) for k in keys},
            "promised": {k: round(p, 4) for k, p in zip(keys, promised)},
            "moved": {k: round(m, 4) for k, m in zip(keys, moved)},
            "error": round(error, 4),
            "accuracy": round(accuracy, 4),
            "trust_before": round(trust_before, 4),
            "trust_after": round(after, 4),
        }

    # -- такт --------------------------------------------------------------

    def tick(
        self,
        world_id: str,
        census: dict[str, Any],
        *,
        laws: dict[str, Any] | None = None,
        tension: float = 0.0,
        arousal: float = 0.0,
        now: float | None = None,
    ) -> dict[str, Any]:
        """Один шаг жизни: посмотреть, доучиться на прошлом, выбрать, записать."""
        now = time.time() if now is None else now
        record = self.ensure(world_id, now=now)
        agent_id = str(record["agent_id"])

        previous = _load_observation(record.get("last_obs"))
        obs = observe_world(census, tension=tension, previous=previous)
        vector = obs.vector()

        propagation = _as_float(laws or {}, "propagation", 1.0)
        temp = temperature(
            arousal=arousal,
            sound_energy=_as_float(census, "energy"),
            propagation=propagation,
        )

        with self._conn() as conn:
            learned = None
            pending = _load_json(record.get("pending"))
            if pending and previous is not None:
                learned = self._learn(conn, agent_id, pending, vector, previous.vector())

            trust = {
                row["action"]: float(row["trust"])
                for row in conn.execute(
                    "SELECT action, trust FROM action_stats WHERE agent_id = ?",
                    (agent_id,),
                ).fetchall()
            }
            decision = decide(obs, temp, trust)

            f_now, e_now, s_now = free_energy(vector, temp)
            drives = [
                {
                    "key": spec.key,
                    "title": spec.title,
                    "value": round(_clamp(vector[spec.observable]), 4),
                    "target": spec.target,
                    "deficit": round(max(0.0, spec.target - _clamp(vector[spec.observable])), 4),
                    "weight": spec.weight,
                    "note": (
                        spec.starved
                        if spec.target - _clamp(vector[spec.observable]) > 0.12
                        else spec.sated
                    ),
                }
                for spec in DRIVES
            ]
            mood = mood_of(obs, temp, drives)
            tick_no = int(record["ticks"]) + 1

            conn.execute(
                "UPDATE agents SET ticks = ?, last_ts = ?, pending = ?, last_obs = ? "
                "WHERE agent_id = ?",
                (
                    tick_no,
                    now,
                    json.dumps(
                        {
                            "action": decision.action.key,
                            "predicted": decision.predicted,
                            # Обещание в чистом виде: по нему на следующем
                            # такте меряется, много агент промахнулся или мало.
                            "claim": {
                                key: round(
                                    trust.get(decision.action.key, TRUST_START)
                                    * decision.action.effect.get(key, 0.0),
                                    6,
                                )
                                for key in OBSERVABLES
                            },
                        },
                        ensure_ascii=False,
                    ),
                    json.dumps(obs.to_state(), ensure_ascii=False),
                    agent_id,
                ),
            )
            conn.execute(
                "UPDATE action_stats SET uses = uses + 1, last_used = ? "
                "WHERE agent_id = ? AND action = ?",
                (now, agent_id, decision.action.key),
            )
            say = self.describe(decision.action, drives, mood, learned)
            conn.execute(
                "INSERT INTO journal (agent_id, ts, tick, action, free_energy, temperature, mood, note) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (agent_id, now, tick_no, decision.action.key, f_now, temp, mood, say),
            )
            if tick_no % JOURNAL_TRIM_EVERY == 0:
                conn.execute(
                    "DELETE FROM journal WHERE agent_id = ? AND id NOT IN ("
                    "  SELECT id FROM journal WHERE agent_id = ? ORDER BY id DESC LIMIT ?"
                    ")",
                    (agent_id, agent_id, JOURNAL_LIMIT),
                )

            trust_table = self.trust_table(agent_id)
            journal = self._journal(conn, agent_id, limit=12)

        return {
            "agent_id": agent_id,
            "world_id": str(world_id),
            "tick": tick_no,
            "born_at": round(float(record["born_at"]), 1),
            "age_ticks": tick_no,
            "mood": mood,
            "say": say,
            "action": {
                "key": decision.action.key,
                "title": decision.action.title,
                "note": decision.action.note,
                "knobs": dict(decision.action.knobs),
                "cost": decision.action.cost,
                "trust": round(trust.get(decision.action.key, TRUST_START), 4),
            },
            "thermo": {
                "free_energy": round(f_now, 4),
                "energy": round(e_now, 4),
                "entropy": round(s_now, 4),
                "temperature": round(temp, 4),
                "predicted_free_energy": round(decision.free_energy, 4),
                "law": "F = E - T*S",
            },
            "observation": obs.to_dict(),
            "drives": drives,
            "considered": decision.considered,
            "trust": {k: {kk: round(vv, 4) for kk, vv in v.items()} for k, v in trust_table.items()},
            "learned": learned,
            "journal": journal,
        }

    # -- чтение ------------------------------------------------------------

    def state(self, world_id: str, *, journal_limit: int = 24) -> dict[str, Any] | None:
        """Прочитать агента, ничего не меняя: для панели и для отладки."""
        agent_id = self.agent_id_for(world_id)
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM agents WHERE agent_id = ?", (agent_id,)
            ).fetchone()
            if row is None:
                return None
            journal = self._journal(conn, agent_id, limit=journal_limit)
        pending = _load_json(row["pending"])
        return {
            "agent_id": agent_id,
            "world_id": str(row["world_id"]),
            "born_at": round(float(row["born_at"]), 1),
            "tick": int(row["ticks"]),
            "last_ts": round(float(row["last_ts"]), 1),
            "observation": _load_json(row["last_obs"]),
            "intent": pending.get("action") if pending else None,
            "trust": {
                k: {kk: round(vv, 4) for kk, vv in v.items()}
                for k, v in self.trust_table(agent_id).items()
            },
            "journal": journal,
        }

    @staticmethod
    def _journal(conn: sqlite3.Connection, agent_id: str, *, limit: int) -> list[dict[str, Any]]:
        rows = conn.execute(
            "SELECT ts, tick, action, free_energy, temperature, mood, note FROM journal "
            "WHERE agent_id = ? ORDER BY id DESC LIMIT ?",
            (agent_id, max(1, limit)),
        ).fetchall()
        return [
            {
                "ts": round(float(r["ts"]), 1),
                "tick": int(r["tick"]),
                "action": r["action"],
                "free_energy": round(float(r["free_energy"]), 4),
                "temperature": round(float(r["temperature"]), 4),
                "mood": r["mood"],
                "note": r["note"],
            }
            for r in rows
        ]

    @staticmethod
    def describe(
        action: ActionSpec,
        drives: list[dict[str, Any]],
        mood: str,
        learned: dict[str, Any] | None,
    ) -> str:
        """Фраза от первого лица: почему именно это действие именно сейчас."""
        hungriest = max(drives, key=lambda d: d["deficit"])
        reason = hungriest["note"] if hungriest["deficit"] > 0.08 else "мир близок к тому, каким я его хочу"
        tail = ""
        if learned and learned["trust_after"] < learned["trust_before"] - 0.01:
            tail = f" (в прошлый раз «{learned['title']}» соврало, доверяю меньше)"
        elif learned and learned["trust_after"] > learned["trust_before"] + 0.01:
            tail = f" (в прошлый раз «{learned['title']}» сработало как обещало)"
        return f"{reason} → {action.title.lower()}: {action.note}{tail} [{mood}]"


def _load_json(raw: Any) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _load_observation(raw: Any) -> Observation | None:
    data = _load_json(raw)
    if not data:
        return None
    return Observation(
        density=_clamp(_as_float(data, "density")),
        symmetry=_clamp(_as_float(data, "symmetry")),
        change=_clamp(_as_float(data, "change")),
        calm=_clamp(_as_float(data, "calm", 1.0)),
        hue=_as_float(data, "hue") % 360.0,
        radius=max(0.0, _as_float(data, "radius")),
    )


def process_agent_event(
    payload: dict[str, Any],
    agent: Agent,
    *,
    now: float | None = None,
) -> dict[str, Any]:
    """Сквозной путь для события ``agent_tick`` из браузера."""
    world_id = str(payload.get("world_id") or payload.get("world") or "").strip()
    if not world_id:
        raise ValueError("agent_tick requires world_id")

    census = payload.get("census") if isinstance(payload.get("census"), dict) else {}
    voice = payload.get("voice") if isinstance(payload.get("voice"), dict) else {}
    laws = payload.get("laws") if isinstance(payload.get("laws"), dict) else {}

    return agent.tick(
        world_id,
        census,
        laws=laws,
        tension=_clamp(_as_float(voice, "tension")),
        arousal=_clamp(_as_float(voice, "arousal")),
        now=now,
    )
