"""Реальность-гейт: что считается блоком, а что — перебором nonce.

Механика ДЕКОДЕРА, применённая к работе. В proof-of-work миллиарды хэшей не
считаются достижением — они перебор. Блок засчитан только когда нули РЕАЛЬНО
оказались в хэше: подделать нельзя, уговорить себя нельзя.

Здесь так же. Построенная фича, написанный код, потраченный час — это nonce.
Блок — это сигнал ИЗВНЕ, который нельзя выдумать сидя за ноутбуком:
заплатили, вернулись, ответили, отказали.

Зачем: outcome.py ставит статус «успех» по типу события, то есть система
считает успехом собственную активность. Это подкрепляет стройку ради стройки.
Реальность-гейт разделяет одно от другого и показывает честное отношение.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

# Сигналы, которые нельзя произвести за своим же ноутбуком.
# Отказ — тоже блок: это настоящая информация из мира, часто ценнее похвалы.
SIGNAL_KINDS = {
    "payment": "заплатили",
    "user_returned": "человек вернулся",
    "user_signup": "новый человек пришёл",
    "reply": "живой ответ на предложение",
    "rejection": "отказали",
}

# Перебор: всё, что происходит внутри мастерской.
EFFORT_KINDS = {
    "build": "построено",
    "refactor": "переделано",
    "research": "изучено",
    "deploy": "выкачено",
}


def _state_dir() -> Path:
    raw = os.environ.get("MAX17_STATE_DIR", "").strip()
    base = Path(raw) if raw else Path(__file__).resolve().parent / "state"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _ledger_path() -> Path:
    return _state_dir() / "reality.json"


def _load() -> dict[str, Any]:
    try:
        data = json.loads(_ledger_path().read_text("utf-8"))
        if isinstance(data, dict) and isinstance(data.get("entries"), list):
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {"entries": []}


def _save(data: dict[str, Any]) -> None:
    try:
        _ledger_path().write_text(json.dumps(data, ensure_ascii=False), "utf-8")
    except OSError:
        pass  # журнал недоступен — не роняем ядро из-за него


def record(kind: str, note: str = "", amount: float = 0.0, source: str = "") -> dict[str, Any]:
    """Записать событие. Тип сам решает, блок это или перебор."""
    kind = str(kind or "").strip().lower()
    is_block = kind in SIGNAL_KINDS
    entry = {
        "kind": kind,
        "block": is_block,
        "note": str(note or "")[:200],
        "amount": round(float(amount or 0), 2),
        "source": str(source or "")[:60],
        "ts": time.time(),
    }
    data = _load()
    data["entries"].append(entry)
    data["entries"] = data["entries"][-2000:]
    _save(data)
    return entry


def stats() -> dict[str, Any]:
    """Честная сводка: сколько перебрано и сколько блоков реально найдено."""
    entries = _load()["entries"]
    blocks = [e for e in entries if e.get("block")]
    effort = [e for e in entries if not e.get("block")]
    now = time.time()

    last_block = max((e["ts"] for e in blocks), default=None)
    effort_since_block = sum(1 for e in effort if last_block is None or e["ts"] > last_block)
    earned = round(sum(float(e.get("amount", 0)) for e in blocks if e.get("kind") == "payment"), 2)

    # «Сложность»: сколько перебора приходится на один блок. Растёт, когда
    # строишь много, а сигналов нет — ровно как сложность в майнинге.
    difficulty = round(len(effort) / len(blocks), 1) if blocks else float(len(effort))

    return {
        "blocks": len(blocks),
        "effort": len(effort),
        "effort_since_last_block": effort_since_block,
        "difficulty": difficulty,
        "earned": earned,
        "days_since_last_block": round((now - last_block) / 86400, 1) if last_block else None,
        "last_blocks": [
            {"kind": e["kind"], "label": SIGNAL_KINDS.get(e["kind"], e["kind"]),
             "note": e["note"], "amount": e["amount"]}
            for e in sorted(blocks, key=lambda x: x["ts"], reverse=True)[:5]
        ],
    }


def verdict(s: dict[str, Any] | None = None) -> str:
    """Одна честная строка. Без утешения — как хэш, который либо есть, либо нет."""
    s = s or stats()
    if s["blocks"] == 0:
        if s["effort"] == 0:
            return "Журнал пуст. Ни перебора, ни блоков."
        return (
            f"{s['effort']} единиц работы, блоков — 0. "
            "Это чистый перебор: ни один сигнал извне пока не пришёл."
        )
    parts = [f"Блоков: {s['blocks']}"]
    if s["earned"]:
        parts.append(f"получено {s['earned']:g}")
    if s["days_since_last_block"] is not None:
        parts.append(f"последний {s['days_since_last_block']:g} дн. назад")
    if s["effort_since_last_block"]:
        parts.append(f"после него {s['effort_since_last_block']} ед. перебора без сигнала")
    return " · ".join(parts) + "."


def gate_progress(requested: int, current: int = 0) -> tuple[int, str]:
    """Пропустить прогресс миссии только при наличии свежего блока.

    Разговор и стройка прогресс не двигают: без сигнала извне возвращаем
    текущее значение и причину. Это и есть гейт.
    """
    s = stats()
    if s["blocks"] == 0:
        return current, "прогресс не засчитан: нет ни одного сигнала извне"
    if s["days_since_last_block"] is not None and s["days_since_last_block"] > 14:
        return current, (
            f"прогресс не засчитан: последний сигнал {s['days_since_last_block']:g} дн. назад"
        )
    return max(current, min(100, int(requested))), "засчитано по реальному сигналу"
