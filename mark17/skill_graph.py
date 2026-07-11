"""Skill inventory with dynamic competence — measurable abilities of Max17.

Each skill is a competence value (0..1) grown from successful activity (EMA) and
slowly faded when idle, so the autonomous loop has a reason to practice. XP is
cumulative; level is derived (RPG feel). Local + deterministic (JSON state).

Навык = взвешенный по компетенции домен деятельности. Сигнал успеха приходит из
self_evaluation + plasticity (см. _update_skills в json_cli). Падает компетенция —
ставится цель в curiosity, и автономная петля её подтягивает.
"""

from __future__ import annotations

import json
import math
import time
from pathlib import Path
from typing import Any

SKILLS: dict[str, str] = {
    "dialog": "Диалог",
    "code": "Код",
    "desktop": "Рабочий стол",
    "music": "Музыка",
    "memory": "Память",
    "research": "Веб-исследование",
    "analysis": "Анализ",
    "growth": "Рост графа",
}

LOW = 0.35  # порог низкой компетенции
DECAY_PER_DAY = 0.05  # медленное забывание неиспользуемого
SEED = 0.2


def _clamp(v: float) -> float:
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def _level(xp: float) -> int:
    return 1 + int(math.sqrt(max(0.0, xp)) / 5)


class SkillGraph:
    def __init__(self, state_dir: Path) -> None:
        self.path = Path(state_dir) / "skills.json"
        self.data: dict[str, dict[str, Any]] = self._load()

    def _load(self) -> dict[str, dict[str, Any]]:
        try:
            raw = json.loads(self.path.read_text("utf-8"))
            if isinstance(raw, dict):
                return raw
        except Exception:
            pass
        return {}

    def _save(self) -> None:
        try:
            self.path.write_text(json.dumps(self.data, ensure_ascii=False), "utf-8")
        except Exception:
            pass

    def _ensure(self, key: str) -> dict[str, Any]:
        s = self.data.get(key)
        if s is None:
            s = {"competence": SEED, "xp": 0.0, "uses": 0, "successes": 0, "ts": time.time()}
            self.data[key] = s
        return s

    def _decay(self, s: dict[str, Any], now: float) -> None:
        last = float(s.get("ts") or now)
        days = (now - last) / 86400.0
        if days > 0:
            s["competence"] = max(0.08, float(s["competence"]) - DECAY_PER_DAY * days)
            s["ts"] = now

    def record(self, key: str, *, success: float, weight: float = 1.0) -> dict[str, Any]:
        if key not in SKILLS:
            key = "dialog"
        now = time.time()
        s = self._ensure(key)
        self._decay(s, now)
        a = 0.16 * weight
        s["competence"] = _clamp(float(s["competence"]) * (1 - a) + _clamp(success) * a)
        s["xp"] = float(s.get("xp") or 0.0) + max(0.0, success) * 10.0 * weight
        s["uses"] = int(s.get("uses") or 0) + 1
        if success >= 0.6:
            s["successes"] = int(s.get("successes") or 0) + 1
        s["ts"] = now
        self._save()
        return s

    def low_skills(self, thresh: float = LOW) -> list[str]:
        now = time.time()
        out: list[str] = []
        for key in SKILLS:
            s = self.data.get(key)
            if not s:
                continue
            self._decay(s, now)
            if float(s["competence"]) < thresh and int(s.get("uses") or 0) > 0:
                out.append(key)
        return out

    def snapshot(self) -> dict[str, Any]:
        now = time.time()
        items: list[dict[str, Any]] = []
        for key, label in SKILLS.items():
            s = self._ensure(key)
            self._decay(s, now)
            items.append(
                {
                    "key": key,
                    "label": label,
                    "competence": round(float(s["competence"]), 3),
                    "level": _level(float(s.get("xp") or 0.0)),
                    "xp": int(s.get("xp") or 0.0),
                    "uses": int(s.get("uses") or 0),
                    "successes": int(s.get("successes") or 0),
                }
            )
        self._save()
        items.sort(key=lambda x: (x["competence"], x["xp"]), reverse=True)
        avg = round(sum(i["competence"] for i in items) / max(1, len(items)), 3)
        return {"skills": items, "avg_competence": avg, "count": len(items)}
