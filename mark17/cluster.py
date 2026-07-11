"""MAX GOD — кластер-слой. Связь первичной ноды (M3) с воркером (i5) по LAN.

Первичный шлёт воркеру задания (events) на его /api/max17 и забирает результат —
так тяжёлая фоновая работа (ресёрч, forge, ингест) уходит на вторую машину.
Полное слияние мозгов (синапсы через bulk_upsert) — фаза 2; пока воркер = удалённый
вычислитель, результаты возвращаются данными. Fail-soft: воркер недоступен → ok=False,
первичный продолжает сам.

Адрес воркера: state/cluster.json (или env MAX17_WORKER_URL), вид:
  http://192.168.1.X:3000/game/api/max17
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_STATE = Path(os.environ.get("MAX17_STATE_DIR") or (Path(__file__).resolve().parent / "state"))
_PATH = _STATE / "cluster.json"
try:
    _TIMEOUT = float(os.environ.get("MAX17_CLUSTER_TIMEOUT", "120"))
except (TypeError, ValueError):
    _TIMEOUT = 120.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load() -> dict[str, Any]:
    try:
        d = json.loads(_PATH.read_text(encoding="utf-8"))
        if isinstance(d, dict):
            return d
    except Exception:  # noqa: BLE001
        pass
    return {"worker_url": os.environ.get("MAX17_WORKER_URL", "").strip(), "last_alive": "", "last_seen": ""}


def _save(d: dict[str, Any]) -> None:
    try:
        _STATE.mkdir(parents=True, exist_ok=True)
        _PATH.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass


def worker_url() -> str:
    return str(_load().get("worker_url", "") or "")


def set_worker(url: str) -> dict[str, Any]:
    d = _load()
    d["worker_url"] = (url or "").strip()
    _save(d)
    return d


def _post(url: str, event: dict[str, Any], timeout: float | None = None) -> dict[str, Any]:
    body = json.dumps(event).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout or _TIMEOUT) as r:  # noqa: S310 - LAN peer
        return json.loads(r.read().decode("utf-8", errors="replace"))


def ping(url: str | None = None) -> bool:
    """Жив ли воркер (лёгкий heart, короткий таймаут)."""
    url = url or worker_url()
    if not url:
        return False
    try:
        res = _post(url, {"type": "heart"}, timeout=8)
        if bool(res.get("ok")):
            d = _load()
            d["last_alive"] = _now()
            _save(d)
            return True
        return False
    except Exception:  # noqa: BLE001
        return False


def dispatch(event: dict[str, Any], url: str | None = None) -> dict[str, Any]:
    """Отдать задание воркеру, вернуть его результат. Fail-soft."""
    url = url or worker_url()
    if not url:
        return {"ok": False, "error": "воркер не настроен (нет worker_url)"}
    try:
        res = _post(url, event)
        d = _load()
        d["last_seen"] = _now()
        _save(d)
        return res
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"воркер недоступен: {str(exc)[:160]}"}


def status() -> dict[str, Any]:
    d = _load()
    url = str(d.get("worker_url", "") or "")
    return {
        "worker_url": url,
        "alive": ping(url) if url else False,
        "last_alive": d.get("last_alive", ""),
        "last_seen": d.get("last_seen", ""),
    }
