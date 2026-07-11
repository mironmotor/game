"""Доктор — свип здоровья GAME + MAX и безопасные авто-фиксы.

Находит поломки (кэш, миссии, стейт, голос LLM, клиентские ошибки браузера),
заводит каждую как квест в доске миссий (тег ``doctor:<id>``) и чинит то, что
безопасно чинится в процессе ядра. Перезапуск Python-демона делает TS-сторона
(демоном владеет Node) — здесь это только помечается как issue с fix_action.

Часть сигналов (живость демона) домешивает эндпоинт /api/health и передаёт их
сюда в payload["daemon"]; клиентские ошибки прилетают в payload["client_errors"].
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

_STATE = Path(os.environ.get("MAX17_STATE_DIR") or (Path(__file__).resolve().parent / "state"))

# Безопасный whitelist авто-фиксов, которые ядро выполняет прямо в процессе.
# rewarm_daemon сюда НЕ входит — им владеет Node (см. /api/health).
FIXES = {"clear_cache", "reseed_missions", "voice_fallback"}

_SEVERITY_PENALTY = {"critical": 40, "high": 25, "warn": 10, "info": 3}


def _issue(iid: str, title: str, severity: str, area: str, detail: str = "",
           fixable: bool = False, fix_action: str = "") -> dict[str, Any]:
    return {
        "id": iid, "title": title, "severity": severity, "area": area,
        "detail": detail, "fixable": bool(fixable), "fix_action": fix_action,
    }


def _cache_signal(issues: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        from mark17 import gonka_bridge as _gb
        c = _gb.cache_stats()
    except Exception as exc:  # noqa: BLE001
        issues.append(_issue("cache_down", "Кэш LLM недоступен", "warn", "max", str(exc)))
        return {"ok": False, "error": str(exc)}
    size = int(c.get("size", 0) or 0)
    cap = int(c.get("max_size", 0) or 0)
    if cap and size >= cap:
        issues.append(_issue("cache_full", "Кэш LLM переполнен", "info", "max",
                             f"{size}/{cap}", True, "clear_cache"))
    return c


def _missions_signal(issues: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        from mark17 import missions as _m
        snap = _m.snapshot()
        return {"ok": True, "open": snap.get("open_count", 0), "done": snap.get("done_count", 0)}
    except Exception as exc:  # noqa: BLE001
        issues.append(_issue("missions_corrupt", "Доска миссий не читается", "high", "max",
                             str(exc), True, "reseed_missions"))
        return {"ok": False, "error": str(exc)}


def _cluster_signal(issues: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        from mark17 import cluster as _c
        s = _c.status()
        return {"ok": True, "worker_url": s.get("worker_url", ""), "alive": bool(s.get("alive"))}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


def _state_signal(issues: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        if not _STATE.exists():
            issues.append(_issue("state_missing", "Каталог state отсутствует", "warn", "max", str(_STATE)))
            return {"ok": False, "path": str(_STATE)}
        probe = _STATE / ".doctor_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return {"ok": True, "path": str(_STATE)}
    except Exception as exc:  # noqa: BLE001
        issues.append(_issue("state_ro", "Каталог state не пишется", "high", "max", str(exc)))
        return {"ok": False, "error": str(exc)}


def _llm_signal(issues: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        from mark17 import llm_config as _lc
    except Exception as exc:  # noqa: BLE001
        issues.append(_issue("llm_config", "LLM-конфиг не грузится", "warn", "max", str(exc)))
        return {"ok": False, "error": str(exc)}
    try:
        active = _lc.resolve_preset_id("chat")
        ok = bool(_lc.available_for_role("chat"))
    except Exception as exc:  # noqa: BLE001
        return {"ok": True, "active": None, "note": str(exc)}
    if not ok:
        issues.append(_issue("voice_down", "Голос MAX (chat LLM) недоступен", "high", "max",
                             f"активный пресет: {active}", True, "voice_fallback"))
    return {"ok": ok, "active": active}


def _client_errors_signal(issues: list[dict[str, Any]], client_errors: Any) -> dict[str, Any]:
    errs = [e for e in (client_errors or []) if e]
    n = len(errs)
    if n:
        sev = "high" if n >= 5 else "warn"
        sample = str(errs[-1])[:200]
        issues.append(_issue("client_errors", f"Ошибки в браузере GAME: {n}", sev, "game", sample))
    return {"count": n}


def health_sweep(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = payload or {}
    issues: list[dict[str, Any]] = []

    cache = _cache_signal(issues)
    missions = _missions_signal(issues)
    cluster = _cluster_signal(issues)
    state = _state_signal(issues)
    llm = _llm_signal(issues)
    client = _client_errors_signal(issues, payload.get("client_errors"))

    # Живость демона MAX домешивает TS (/api/health) — сюда прилетает готовый статус.
    daemon = payload.get("daemon") if isinstance(payload.get("daemon"), dict) else {}
    if daemon and daemon.get("alive") is False:
        issues.append(_issue("daemon_down", "Python-демон MAX не отвечает", "critical",
                             "max", "", True, "rewarm_daemon"))

    score = 100
    for it in issues:
        score -= _SEVERITY_PENALTY.get(str(it.get("severity")), 3)
    score = max(0, min(100, score))

    # Проблемы → квесты в доске миссий (идемпотентно, дедуп по тегу).
    try:
        issues_to_quests(issues)
    except Exception:  # noqa: BLE001
        pass

    return {
        "ok": True,
        "score": score,
        "game": {"client_errors": client["count"], "daemon": daemon},
        "max": {"cache": cache, "missions": missions, "cluster": cluster, "state": state, "llm": llm},
        "issues": issues,
    }


def issues_to_quests(issues: list[dict[str, Any]]) -> None:
    """Синхронизирует доску миссий с текущими issue: заводит новые квесты
    (тег doctor:<id>), переоткрывает вернувшиеся, авто-закрывает решённые."""
    from mark17 import missions as _m
    snap = _m.snapshot()
    existing: dict[str, dict[str, Any]] = {}
    for m in snap.get("missions", []):
        tag = str(m.get("tag") or "")
        if tag.startswith("doctor:"):
            existing[tag[len("doctor:"):]] = m

    current_ids: set[str] = set()
    for it in issues:
        iid = str(it.get("id") or "")
        if not iid:
            continue
        current_ids.add(iid)
        m = existing.get(iid)
        title = f"🩺 {it.get('title', iid)}"
        step = ("Починить: " + str(it.get("fix_action"))) if it.get("fixable") else "Требует внимания"
        if not m:
            _m.add(title, why=str(it.get("detail") or ""), next_step=step, tag=f"doctor:{iid}")
        elif m.get("status") == "done":
            _m.update(m["id"], status="active", progress=0)

    for iid, m in existing.items():
        if iid not in current_ids and m.get("status") != "done":
            _m.complete(m["id"])


def apply_fix(action: str) -> dict[str, Any]:
    action = (action or "").strip()
    if action not in FIXES:
        return {"ok": False, "action": action, "error": "неизвестный или не-ядровый фикс"}
    try:
        if action == "clear_cache":
            from mark17 import gonka_bridge as _gb
            _gb.cache_clear()
            return {"ok": True, "action": action, "result": _gb.cache_stats()}
        if action == "reseed_missions":
            p = _STATE / "missions.json"
            try:
                if p.exists():
                    p.unlink()
            except Exception:  # noqa: BLE001
                pass
            from mark17 import missions as _m
            return {"ok": True, "action": action, "result": _m.snapshot()}
        if action == "voice_fallback":
            res = _voice_fallback()
            return {"ok": bool(res.get("ok")), "action": action, "result": res}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "action": action, "error": str(exc)}
    return {"ok": False, "action": action, "error": "no-op"}


def _voice_fallback() -> dict[str, Any]:
    """Переключить роль chat на первый доступный пресет (surgical: только chat)."""
    try:
        from mark17 import llm_config as _lc
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
    current = None
    try:
        current = _lc.resolve_preset_id("chat")
    except Exception:  # noqa: BLE001
        pass
    for pid, preset in _lc.PRESETS.items():
        try:
            if _lc._preset_available(pid, preset):  # noqa: SLF001
                if pid != current:
                    _lc.set_role_active("chat", pid)
                return {"ok": True, "switched_to": pid, "from": current}
        except Exception:  # noqa: BLE001
            continue
    return {"ok": False, "error": "нет доступного пресета в лестнице"}
