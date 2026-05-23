"""Кодирует события в спайки и кормит SNN; кэш паттернов + реактивные действия."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from mark17.events import Event
from mark17.snn_core import PlasticityNetwork, StepResult

# Индексы входов (фиксированная семантика + хеш payload)
IDX_TERMINAL_ERROR = 0
IDX_OPEN_FOLDER = 1
IDX_SHELL = 2
IDX_FILE_SAVED = 3
# 4..N-1 — биты хеша signature


@dataclass
class PatternEntry:
    hits: int = 0
    last_activation: float = 0.0
    last_action: str = ""

    @property
    def confidence(self) -> float:
        # быстрее насыщается: 3 повтора ≈ 0.5+, 6+ ≈ 0.85+
        freq = min(self.hits / 6.0, 1.0)
        return min(1.0, 0.45 * freq + 0.55 * self.last_activation)


@dataclass
class PlasticityResponse:
    pattern_id: str
    confidence: float
    action: str
    hint: str
    snn: dict[str, float]
    learned: bool


class PlasticityBridge:
    def __init__(
        self,
        state_dir: Path,
        *,
        num_inputs: int = 16,
        num_hidden: int = 32,
        confidence_threshold: float = 0.55,
    ) -> None:
        self.state_dir = state_dir
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.confidence_threshold = confidence_threshold
        self.network = PlasticityNetwork.load(
            self.state_dir / "plasticity.npz",
            seed=42,
        )
        if self.network.num_inputs != num_inputs:
            self.network = PlasticityNetwork(num_inputs=num_inputs, num_hidden=num_hidden)
        self.pattern_cache: dict[str, PatternEntry] = self._load_cache()

    def _load_cache(self) -> dict[str, PatternEntry]:
        path = self.state_dir / "pattern_cache.json"
        if not path.exists():
            return {}
        raw = json.loads(path.read_text())
        return {
            k: PatternEntry(
                hits=v.get("hits", 0),
                last_activation=v.get("last_activation", 0.0),
                last_action=v.get("last_action", ""),
            )
            for k, v in raw.items()
        }

    def save(self) -> None:
        self.network.save(self.state_dir / "plasticity.npz")
        path = self.state_dir / "pattern_cache.json"
        path.write_text(
            json.dumps(
                {
                    k: {
                        "hits": e.hits,
                        "last_activation": e.last_activation,
                        "last_action": e.last_action,
                    }
                    for k, e in self.pattern_cache.items()
                },
                indent=2,
            )
        )

    def pattern_id(self, event: Event) -> str:
        h = hashlib.sha256(event.signature().encode()).hexdigest()[:12]
        return f"{event.type}:{h}"

    def encode_event(self, event: Event) -> np.ndarray:
        x = np.zeros(self.network.num_inputs, dtype=np.float32)
        et = event.type

        if et == "terminal_error":
            x[IDX_TERMINAL_ERROR] = 1.0
        elif et == "open_folder":
            x[IDX_OPEN_FOLDER] = 1.0
        elif et == "shell_command":
            x[IDX_SHELL] = 1.0
        elif et == "file_saved":
            x[IDX_FILE_SAVED] = 1.0
        elif et == "ping":
            x[4] = 1.0
        else:
            x[5] = 1.0  # unknown

        sig = event.signature()
        digest = hashlib.sha256(sig.encode()).digest()
        hash_slots = self.network.num_inputs - 6
        for i in range(hash_slots):
            byte = digest[i % len(digest)]
            if (byte >> (i % 8)) & 1:
                x[6 + i] = 1.0

        return x

    def propose_action(self, event: Event) -> tuple[str, str]:
        if event.type == "terminal_error":
            line = str(event.payload.get("line", ""))
            if "ModuleNotFoundError" in line:
                mod = line.split("'")[1] if "'" in line else "?"
                return (
                    "suggest_terminal_fix",
                    f"Похоже, не хватает модуля `{mod}`. Попробуй: pip install {mod}",
                )
            if "command not found" in line.lower():
                return ("suggest_terminal_fix", "Команда не найдена — проверь PATH или brew install.")
            if "ENOENT" in line or "no such file" in line.lower():
                return ("suggest_terminal_fix", "Файл/путь не найден — проверь cwd и путь.")
            if "EACCES" in line or "permission denied" in line.lower():
                return ("suggest_terminal_fix", "Нет прав — chmod/chown или запусти с нужными правами.")
            if "npm ERR" in line or "error code" in line.lower():
                return ("suggest_terminal_fix", "npm ошибка — попробуй: rm -rf node_modules && npm install")
            return ("suggest_terminal_fix", "Ошибка в терминале — посмотри последние строки лога.")

        if event.type == "open_folder":
            path = event.payload.get("path", "")
            return ("remember_folder", f"Запомнил частый путь: {path}")

        if event.type == "shell_command":
            cmd = event.payload.get("cmd", "")
            return ("echo_command", f"Частая команда: {cmd}")

        return ("noop", "Паттерн записан в plasticity.")

    def process(self, event: Event) -> PlasticityResponse:
        pid = self.pattern_id(event)
        x = self.encode_event(event)
        # burst: 3 микро-шага — сильнее учится на CPU без большой сети
        result: StepResult | None = None
        for _ in range(3):
            result = self.network.step(x)
        assert result is not None
        action, hint = self.propose_action(event)

        entry = self.pattern_cache.get(pid, PatternEntry())
        entry.hits += 1
        entry.last_activation = max(entry.last_activation, result.hidden_activation)
        entry.last_action = action
        self.pattern_cache[pid] = entry

        conf = entry.confidence
        learned = conf >= self.confidence_threshold

        return PlasticityResponse(
            pattern_id=pid,
            confidence=round(conf, 4),
            action=action,
            hint=hint,
            snn={
                "hidden_activation": result.hidden_activation,
                "mean_weight": result.mean_weight,
                "step_count": float(self.network.step_count),
            },
            learned=learned,
        )

    def lookup_confidence(self, event: Event) -> float:
        pid = self.pattern_id(event)
        entry = self.pattern_cache.get(pid)
        if not entry:
            return 0.0
        return entry.confidence

    def stats(self) -> dict[str, Any]:
        return {
            "patterns": len(self.pattern_cache),
            "snn_steps": self.network.step_count,
            "mean_weight": float(self.network.w.mean()),
        }
