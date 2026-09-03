"""Кодирует события в спайки и кормит SNN; кэш паттернов + реактивные действия."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from mark17.compression import TOPIC_MATCH, similarity
from mark17.events import Event, topic_key
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
    # Нормализованная тема реплики. Нужна, чтобы узнать уже виденный вопрос,
    # заданный другими словами; для остальных типов событий пустая.
    topic: str = ""
    # Когда тему поднимали в последний раз. Нужна, чтобы на «что дальше»
    # отвечать по недавнему разговору, а не по самому частому за всю историю.
    last_seen: float = 0.0

    @property
    def confidence(self) -> float:
        # быстрее насыщается: 3 повтора ≈ 0.5+, 6+ ≈ 0.85+
        freq = min(self.hits / 6.0, 1.0)
        return min(1.0, 0.45 * freq + 0.55 * self.last_activation)


@dataclass
class PlasticityResponse:
    pattern_id: str
    confidence: float
    # Сколько раз эта тема уже поднималась. Наружу отдаётся, потому что «в
    # третий раз спрашиваешь об одном» — это то, что ядро реально знает, и то,
    # что человеку полезнее любой цифры уверенности.
    hits: int
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
                topic=v.get("topic", ""),
                last_seen=v.get("last_seen", 0.0),
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
                        "topic": e.topic,
                        "last_seen": e.last_seen,
                    }
                    for k, e in self.pattern_cache.items()
                },
                indent=2,
            )
        )

    def pattern_id(self, event: Event) -> str:
        """Ключ паттерна. Для реплики человека — с узнаванием по смыслу.

        Хеш от текста опознаёт только дословный повтор, а человек дословно не
        повторяется. Поэтому для `user_message` сначала ищем среди уже виденных
        тем ту, что совпадает с этой хотя бы на TOPIC_MATCH по основам слов, и
        возвращаем ЕЁ ключ — тогда третий разговор об одном и том же и
        засчитывается как третий, а не как первый.

        Побеждает самая похожая тема, а при равенстве — ключ, меньший
        лексикографически: одинаковый вход обязан давать одинаковый ключ
        независимо от порядка обхода словаря.
        """
        if event.type == "user_message":
            topic = topic_key(event.payload.get("text", ""))
            if topic:
                mine = set(topic.split())
                best_pid, best_score = "", 0.0
                for pid, entry in self.pattern_cache.items():
                    if not entry.topic or not pid.startswith("user_message:"):
                        continue
                    score = similarity(mine, set(entry.topic.split()))
                    if score > best_score or (score == best_score and pid < best_pid):
                        best_pid, best_score = pid, score
                if best_score >= TOPIC_MATCH:
                    return best_pid

        h = hashlib.sha256(event.signature().encode()).hexdigest()[:12]
        return f"{event.type}:{h}"

    def hot_topic(self, *, exclude: str = "", min_hits: int = 2) -> dict[str, Any] | None:
        """Тема, к которой человек возвращается сейчас.

        Это ответ на «что дальше» — вопрос, на который ядро до сих пор отвечало
        описанием собственных возможностей, хотя знало ответ: вот тема, к
        которой ты возвращаешься чаще всего в последнее время.

        Выбор по свежести, а не по общему числу упоминаний: тема, которую
        обсуждали двадцать раз в марте, к «что дальше» сегодня отношения не
        имеет. Из одинаково свежих побеждает та, к которой возвращались чаще.

        Порог min_hits отсекает случайно брошенное вслух ДО выбора по свежести,
        а не после. Иначе достаточно одной новой реплики, чтобы «что дальше»
        замолчало: самой свежей окажется она, порог её отбросит, и незакрытая
        тема рядом останется ненайденной. Ровно это и вылезло на живом прогоне
        диалога — по отдельности каждый кусок работал.
        """
        best: tuple[float, int, str] | None = None
        for pid, entry in self.pattern_cache.items():
            if not pid.startswith("user_message:") or not entry.topic:
                continue
            if entry.hits < min_hits:
                continue
            if exclude and entry.topic == exclude:
                continue
            key = (entry.last_seen, entry.hits, entry.topic)
            if best is None or key > best:
                best = key
        if best is None:
            return None
        return {"topic": best[2], "hits": best[1], "last_seen": best[0]}

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
        if event.type == "user_message":
            entry.last_seen = event.ts
        if event.type == "user_message" and not entry.topic:
            # Тема пишется один раз, при рождении паттерна. Переписывать её на
            # каждом попадании нельзя: тема поплывёт вслед за формулировками и
            # через десяток реплик паттерн перестанет узнавать сам себя.
            entry.topic = topic_key(event.payload.get("text", ""))
        self.pattern_cache[pid] = entry

        conf = entry.confidence
        learned = conf >= self.confidence_threshold

        return PlasticityResponse(
            pattern_id=pid,
            confidence=round(conf, 4),
            hits=entry.hits,
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
