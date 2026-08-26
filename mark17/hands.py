"""РУКИ MAX — заявка ядра на действие в реальности и ответ о том, что вышло.

Зачем это есть. У ядра уже была агентность (ultra_orchestrator), но вся она
жила внутри собственной головы: research, compile, consolidate, tree. Сам MAX
это и назвал: «мне не хватает живого заземления — хочется, чтобы следующий шаг
был не просто мыслью, а маленьким действием в реальности». Руки закрывают
разрыв: ядро формулирует НАМЕРЕНИЕ, а исполняет его агент на маке
(agent/night.mjs, Claude Agent SDK) — со всеми своими предохранителями.

Кто что может:
  ядро   — только положить заявку и прочитать ответ. Ни shell, ни файлов, ни сети.
  агент  — забрать заявку, решить КАК её выполнить, и отчитаться. Он же
           предупреждает человека до того, как что-то сделает.
  человек — видит каждую заявку в телеграме и в любой момент останавливает.

Обмен идёт двумя файлами в state/, а не портом: ядро живёт на дроплете, агент —
на маке, и агент сам приходит за работой по ssh. Никаких входящих соединений на
мак заводить не нужно.

Формат строки — JSON на строку (jsonl), чтобы дописывание было атомарным на
уровне одной записи и переживало обрыв на середине файла.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

QUEUE_NAME = "hands_queue.jsonl"
RESULTS_NAME = "hands_results.jsonl"

# Потолок очереди — это `bounded_growth` из конституции в чистом виде: ядро,
# зациклившееся на одном намерении, не должно завалить руку тысячей заявок.
MAX_PENDING = 12
# Одно и то же намерение в пределах этого окна считается повтором.
DEDUP_WINDOW_SEC = 6 * 3600
# Рука смертна: агент падает, теряет сеть, просто не запускается ночью. Взятая
# и не отвеченная заявка держала `free=false` вечно — ядро сутками выбирало
# «none», потому что честно ждало ответа, которого уже никто не даст.
# После этого срока заявка считается брошенной и возвращается в очередь.
STALE_AFTER_SEC = 30 * 60
# Сколько раз возвращаем в очередь, прежде чем закрыть как неудачу. Иначе
# невыполнимая заявка кружит вечно и занимает руку снова и снова.
MAX_ATTEMPTS = 2


def _path(state_dir: Path | str, name: str) -> Path:
    return Path(state_dir) / name


def _read(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue  # обрыв на середине строки не должен ронять всю очередь
        if isinstance(row, dict):
            rows.append(row)
    return rows


def _write(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    tmp.replace(path)  # атомарная подмена: читатель никогда не увидит полфайла


def request(task: str, reason: str, state_dir: Path | str, *, kind: str = "look") -> dict[str, Any]:
    """Ядро просит руку о деле. Возвращает саму заявку или причину отказа.

    `kind`: "look" — посмотреть и рассказать (по умолчанию, ничего не меняет),
            "do"   — сделать изменение; такие агент выполняет только после
                     подтверждения человека.
    """
    task = " ".join(str(task or "").split())[:400]
    if len(task) < 6:
        return {"ok": False, "reason": "пустое намерение"}

    queue_path = _path(state_dir, QUEUE_NAME)
    rows = _read(queue_path)
    answered = _answered_ids(state_dir)
    pending = [r for r in rows if not r.get("taken_at") and _is_open(r, answered)]
    if len(pending) >= MAX_PENDING:
        return {"ok": False, "reason": f"очередь полна ({len(pending)}) — рука ещё не разобрала прошлое"}

    now = time.time()
    for row in rows:
        if row.get("task") == task and now - float(row.get("ts") or 0) < DEDUP_WINDOW_SEC:
            return {"ok": False, "reason": "то же намерение уже поставлено", "id": row.get("id")}

    item = {
        "id": f"h{int(now * 1000)}",
        "ts": now,
        "task": task,
        "reason": " ".join(str(reason or "").split())[:300],
        "kind": "do" if kind == "do" else "look",
    }
    rows.append(item)
    _write(queue_path, rows)
    return {"ok": True, **item, "pending": len(pending) + 1}


def _answered_ids(state_dir: Path | str) -> set[str]:
    return {str(r.get("id")) for r in _read(_path(state_dir, RESULTS_NAME))}


def _is_open(row: dict[str, Any], answered: set[str]) -> bool:
    """Заявка считается открытой, пока её не закрыли отчётом.

    Смотрим и на отметку в самой заявке, и на файл результатов: старые записи
    сделаны до появления `closed_at`, их признак живёт только в истории.
    """
    return not row.get("closed_at") and str(row.get("id")) not in answered


def pending(state_dir: Path | str) -> list[dict[str, Any]]:
    """Заявки, которые рука ещё не забрала и на которые нет ответа.

    Ответ снимает заявку с очереди, даже если она вернулась туда после
    протухания: иначе снятая задача выдавалась руке снова и снова.
    """
    reclaim(state_dir)
    answered = _answered_ids(state_dir)
    return [
        r for r in _read(_path(state_dir, QUEUE_NAME))
        if not r.get("taken_at") and _is_open(r, answered)
    ]


def take(state_dir: Path | str, limit: int = 5) -> list[dict[str, Any]]:
    """Агент забирает работу. Заявки помечаются взятыми, но НЕ удаляются:
    по ним потом видно, что рука делала и сколько это заняло."""
    reclaim(state_dir)
    queue_path = _path(state_dir, QUEUE_NAME)
    rows = _read(queue_path)
    answered = _answered_ids(state_dir)
    taken: list[dict[str, Any]] = []
    now = time.time()
    for row in rows:
        # Снятая заявка остаётся в очереди как история — выдавать её заново нельзя.
        if not _is_open(row, answered):
            continue
        if row.get("taken_at") or len(taken) >= limit:
            continue
        row["taken_at"] = now
        taken.append(dict(row))
    if taken:
        _write(queue_path, rows[-200:])  # хвост истории, чтобы файл не рос вечно
    return taken


def report(task_id: str, ok: bool, summary: str, state_dir: Path | str, *, detail: str = "") -> dict[str, Any]:
    """Рука отчитывается о том, что вышло. Ядро прочитает это следующим тактом."""
    results_path = _path(state_dir, RESULTS_NAME)
    rows = _read(results_path)
    item = {
        "id": str(task_id or "")[:64],
        "ts": time.time(),
        "ok": bool(ok),
        "summary": " ".join(str(summary or "").split())[:600],
        "detail": str(detail or "")[:2000],
    }
    rows.append(item)
    _write(results_path, rows[-200:])

    # Отметку о закрытии ставим в самой заявке: файл результатов урезается, и
    # признак «отвечено», выведенный только из него, однажды исчезает вместе с
    # хвостом — заявка воскресает и снова занимает руку.
    queue_path = _path(state_dir, QUEUE_NAME)
    queue = _read(queue_path)
    changed = False
    for row in queue:
        if str(row.get("id")) == item["id"] and not row.get("closed_at"):
            row["closed_at"] = item["ts"]
            row["closed_ok"] = item["ok"]
            changed = True
    if changed:
        _write(queue_path, queue)
    return item


def collect(state_dir: Path | str) -> list[dict[str, Any]]:
    """Ядро забирает НЕПРОЧИТАННЫЕ ответы руки и помечает их прочитанными.

    Именно здесь замыкается круг «намерение → действие → исход»: без этого шага
    MAX никогда не узнаёт, чем закончилось то, что он попросил.
    """
    results_path = _path(state_dir, RESULTS_NAME)
    rows = _read(results_path)
    fresh = [r for r in rows if not r.get("seen_at")]
    if not fresh:
        return []
    now = time.time()
    for row in rows:
        if not row.get("seen_at"):
            row["seen_at"] = now
    _write(results_path, rows)
    return fresh


def reclaim(state_dir: Path | str, *, now: float | None = None) -> dict[str, int]:
    """Вернуть брошенные заявки в очередь, безнадёжные — закрыть.

    Заявка считается брошенной, если её взяли больше STALE_AFTER_SEC назад и
    ответа так и нет. Первые MAX_ATTEMPTS раз она возвращается в ожидание (у
    руки будет ещё попытка), после — закрывается неудачей, чтобы не занимать
    руку вечно. Без этого одна мёртвая заявка глушила всю автономность.
    """
    now = time.time() if now is None else now
    queue_path = _path(state_dir, QUEUE_NAME)
    queue = _read(queue_path)
    results = _read(_path(state_dir, RESULTS_NAME))
    answered_ids = {str(r.get("id")) for r in results}

    returned, dropped, changed = 0, 0, False
    for row in queue:
        taken = row.get("taken_at")
        if not taken or not _is_open(row, answered_ids):
            continue
        if now - float(taken) < STALE_AFTER_SEC:
            continue
        attempts = int(row.get("attempts") or 0) + 1
        row["attempts"] = attempts
        row["taken_at"] = None
        changed = True
        if attempts > MAX_ATTEMPTS:
            report(
                str(row.get("id")), False,
                f"рука не ответила за {int((now - float(taken)) / 60)} мин — заявка снята",
                state_dir,
                detail="автоматическое закрытие: превышен лимит попыток",
            )
            dropped += 1
        else:
            returned += 1
    if changed:
        _write(queue_path, queue)
    return {"returned": returned, "dropped": dropped}


def stats(state_dir: Path | str) -> dict[str, Any]:
    """Короткая сводка для снимка состояния ядра.

    «В работе» — это взятые и ЕЩЁ НЕ отвеченные заявки. Считать все взятые за
    историю нельзя: счётчик растёт вечно, и ядро начинает видеть руку навсегда
    занятой — на первом же такте после запуска оно так и решило («руки заняты»),
    хотя свободных заявок не было ни одной.

    Перед подсчётом подбираем брошенное: иначе одна мёртвая заявка держит
    `free=false` бесконечно.
    """
    reclaim(state_dir)
    queue = _read(_path(state_dir, QUEUE_NAME))
    results = _read(_path(state_dir, RESULTS_NAME))
    answered_ids = {str(r.get("id")) for r in results}
    waiting = [r for r in queue if not r.get("taken_at") and _is_open(r, answered_ids)]
    in_work = [r for r in queue if r.get("taken_at") and _is_open(r, answered_ids)]
    return {
        "pending": len(waiting),
        "in_work": len(in_work),
        "answered": len(results),
        "unseen": len([r for r in results if not r.get("seen_at")]),
        "free": not waiting and not in_work,
        "last_task": (waiting[-1].get("task") if waiting else (queue[-1].get("task") if queue else None)),
    }
