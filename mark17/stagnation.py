"""Метрика простоя: изменило ли ядро мир этим тактом.

Зачем. Ядро умеет отчитываться, что оно «подумало», но думание — не работа.
Сутки простоя в августе выглядели изнутри нормально: каждый такт ядро честно
выбирало действие и было собой довольно, а в мире не менялось ничего. Заметить
это мог только человек снаружи. Эта метрика делает простой видимым изнутри.

Дёшево по устройству. Замер — это три `SELECT COUNT` и длина файла: никакой
модели, никаких токенов, единицы миллисекунд. Поэтому его можно снимать сколько
угодно часто, а не раз в такт — ограничение не в цене замера, а в том, как часто
ядро вообще просыпается.

Что считается изменением мира: выросло число записей памяти, синапсов,
заработанных связей или ответов руки. Мысль, не оставившая следа ни в одном из
этих счётчиков, миром не считается — какой бы умной она ни была.
"""

from __future__ import annotations

import json
import time
from contextlib import closing
from pathlib import Path
from typing import Any

LOG_NAME = "stagnation.jsonl"
# Сколько тактов подряд без следа считаем застоем. Три — потому что один пустой
# такт бывает у любого (нечего делать), два — совпадение, три — уже система.
STAGNANT_AFTER = 3
# Хвост журнала: этого хватает и на счёт полосы, и на разбор «что было ночью».
KEEP_TACTS = 500


def _path(state_dir: Path | str) -> Path:
    return Path(state_dir) / LOG_NAME


def _read(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue  # битая строка не должна ронять счёт
    return rows


def _write(path: Path, rows: list[dict[str, Any]]) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
    tmp.replace(path)


def snapshot(stores: Any) -> dict[str, int]:
    """Слепок мира в числах. Каждый промах считаем нулём, а не падаем: метрика
    наблюдает за ядром и не имеет права его ронять."""
    out: dict[str, int] = {}

    try:
        with closing(stores.vector_memory._conn()) as c:  # noqa: SLF001 - только счётчик
            out["memories"] = int(c.execute("SELECT COUNT(*) FROM vector_memories").fetchone()[0])
    except Exception:  # noqa: BLE001
        out["memories"] = 0

    try:
        with closing(stores.synapse_graph._conn()) as c:  # noqa: SLF001
            row = c.execute(
                "SELECT COUNT(*), COALESCE(SUM(CASE WHEN origin != 'forge' THEN 1 ELSE 0 END), 0) FROM synapses"
            ).fetchone()
            out["synapses"] = int(row[0])
            out["earned"] = int(row[1])
    except Exception:  # noqa: BLE001
        out["synapses"] = 0
        out["earned"] = 0

    try:
        results = Path(stores.state_dir) / "hands_results.jsonl"
        out["hand_answers"] = sum(1 for line in results.read_text(encoding="utf-8").splitlines() if line.strip())
    except Exception:  # noqa: BLE001
        out["hand_answers"] = 0

    return out


def diff(before: dict[str, int], after: dict[str, int]) -> dict[str, int]:
    """Только выросшее. Убыль (чистка памяти, снос мусорных связей) — это не
    «изменение мира» в смысле работы, поэтому в дельту не идёт."""
    out: dict[str, int] = {}
    for key, value in after.items():
        delta = int(value) - int(before.get(key, 0))
        if delta > 0:
            out[key] = delta
    return out


def record(
    state_dir: Path | str,
    *,
    action: str,
    before: dict[str, int],
    after: dict[str, int],
    reason: str = "",
) -> dict[str, Any]:
    """Записать такт и вернуть его оценку вместе с текущей полосой простоя."""
    delta = diff(before, after)
    item = {
        "ts": time.time(),
        "action": str(action or "none")[:32],
        "delta": delta,
        "moved": bool(delta),
        "reason": " ".join(str(reason or "").split())[:200],
    }
    path = _path(state_dir)
    rows = _read(path)
    rows.append(item)
    _write(path, rows[-KEEP_TACTS:])

    item["idle_streak"] = _streak(rows)
    return item


def _streak(rows: list[dict[str, Any]]) -> int:
    streak = 0
    for row in reversed(rows):
        if row.get("moved"):
            break
        streak += 1
    return streak


def streak(state_dir: Path | str) -> int:
    """Сколько тактов подряд ядро не оставило следа."""
    return _streak(_read(_path(state_dir)))


def report(state_dir: Path | str) -> dict[str, Any]:
    """Сводка для снимка состояния: ядро должно видеть свой простой само."""
    rows = _read(_path(state_dir))
    idle = _streak(rows)
    last_move = next((r for r in reversed(rows) if r.get("moved")), None)
    tacts_today = [r for r in rows if time.time() - float(r.get("ts") or 0) < 86400]
    moved_today = sum(1 for r in tacts_today if r.get("moved"))

    return {
        "idle_streak": idle,
        "stagnant": idle >= STAGNANT_AFTER,
        "tacts_24h": len(tacts_today),
        "moved_24h": moved_today,
        # Доля тактов, оставивших след. Это и есть честный КПД ядра за сутки.
        "yield_24h": round(moved_today / len(tacts_today), 3) if tacts_today else None,
        "last_move_ago_min": round((time.time() - float(last_move["ts"])) / 60, 1) if last_move else None,
        "last_move_action": (last_move or {}).get("action"),
    }


def important_tacts(state_dir: Path | str, limit: int = 3) -> list[dict[str, Any]]:
    """Самые весомые такты за сутки — то, что стоит показать человеку.

    Вес такта — размер следа: сколько всего прибавилось в мире. Ответ руки
    весит больше записи в памяти, потому что это контакт с реальностью, а не
    внутренний оборот.
    """
    weights = {"hand_answers": 5, "earned": 3, "synapses": 1, "memories": 1}
    scored: list[tuple[int, dict[str, Any]]] = []
    for row in _read(_path(state_dir)):
        if not row.get("moved") or time.time() - float(row.get("ts") or 0) > 86400:
            continue
        delta = row.get("delta") or {}
        score = sum(int(v) * weights.get(k, 1) for k, v in delta.items())
        if score > 0:
            scored.append((score, row))
    scored.sort(key=lambda p: p[0], reverse=True)
    return [{**row, "weight": score} for score, row in scored[:limit]]
