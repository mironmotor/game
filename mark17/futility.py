"""Счётчик бесплодности действий: что ядро повторяет впустую.

Зачем. Замер по живой памяти: из 6162 решений оркестратора 3578 — это
`research`, и КАЖДОЕ вернуло ноль фактов, потому что автономный веб выключен
двумя флагами сразу (`MAX17_WEB_ENABLED` + `MAX17_AUTO_WEB`). Пробел «улучшить
навык: Веб-исследование» набрал 2141 обращение и остался самым горячим — ядро
видит его первым, снова выбирает research, снова получает ноль. Петля кормит
сама себя: неудача не запоминалась нигде, поэтому следующий такт начинался с
чистого листа.

Здесь хранится ровно одно: сколько раз подряд действие дало пустой результат.
Ядро видит эти цифры в снимке состояния и может выбрать другое, а жёсткий
предохранитель в decide() не даёт выбрать заведомо мёртвое в четвёртый раз.

Обучение на исходе — это `quality_gate` из конституции, применённый к самому
себе: не только связи проходят проверку полезностью, но и собственные действия.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

FILE_NAME = "ultra_futility.json"

# Три пустых подряд — это уже не случайность, а стена.
FUTILE_AFTER = 3
# Через сутки даём действию новый шанс: мир мог измениться (включили веб,
# подняли сервис), и вечная блокировка была бы такой же слепотой, как петля.
RESET_AFTER_SEC = 24 * 3600


def _path(state_dir: Path | str) -> Path:
    return Path(state_dir) / FILE_NAME


def _load(state_dir: Path | str) -> dict[str, Any]:
    try:
        data = json.loads(_path(state_dir).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001 - нет файла или он битый: начинаем с чистого
        return {}


def _save(state_dir: Path | str, data: dict[str, Any]) -> None:
    try:
        path = _path(state_dir)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except Exception:  # noqa: BLE001 - счётчик не критичен, такт важнее
        pass


def record(state_dir: Path | str, action: str, *, fruitful: bool) -> int:
    """Запомнить исход действия. Возвращает текущую серию пустых подряд."""
    action = str(action or "").strip()
    if not action:
        return 0
    data = _load(state_dir)
    row = data.get(action) if isinstance(data.get(action), dict) else {}
    streak = 0 if fruitful else int(row.get("zero_streak") or 0) + 1
    data[action] = {
        "zero_streak": streak,
        "last_ts": time.time(),
        "last_fruitful_ts": time.time() if fruitful else row.get("last_fruitful_ts"),
    }
    _save(state_dir, data)
    return streak


def streaks(state_dir: Path | str) -> dict[str, int]:
    """Серии пустых подряд по действиям — для снимка состояния."""
    now = time.time()
    out: dict[str, int] = {}
    for action, row in _load(state_dir).items():
        if not isinstance(row, dict):
            continue
        if now - float(row.get("last_ts") or 0) > RESET_AFTER_SEC:
            continue  # давняя неудача больше не приговор
        streak = int(row.get("zero_streak") or 0)
        if streak:
            out[str(action)] = streak
    return out


def is_futile(state_dir: Path | str, action: str) -> bool:
    """Действие упёрлось в стену: пора выбрать другое."""
    return streaks(state_dir).get(str(action), 0) >= FUTILE_AFTER
