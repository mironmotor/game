"""Meta Controller v0: правила маршрутизации plasticity / memory / llm."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from mark17.events import Event, KNOWN_TYPES
from mark17.plasticity_bridge import PlasticityBridge


class Route(str, Enum):
    PLASTICITY = "plasticity"
    MEMORY = "memory"
    LLM = "llm"
    IGNORE = "ignore"


@dataclass
class RoutingDecision:
    route: Route
    reason: str
    confidence: float
    pattern_id: str | None = None


class MetaController:
    """
    v0 — без ML, только пороги и тип события.
    """

    def __init__(
        self,
        plasticity: PlasticityBridge,
        *,
        plasticity_threshold: float = 0.7,
        memory_types: frozenset[str] | None = None,
    ) -> None:
        self.plasticity = plasticity
        self.plasticity_threshold = plasticity_threshold
        self.memory_types = memory_types or frozenset(
            {"recall", "search_memory", "remember"}
        )

    def decide(self, event: Event) -> RoutingDecision:
        if event.type == "ping":
            return RoutingDecision(Route.IGNORE, "heartbeat", 1.0)

        if event.type in self.memory_types:
            return RoutingDecision(Route.MEMORY, "explicit memory request", 1.0)

        pid = self.plasticity.pattern_id(event)
        conf = self.plasticity.lookup_confidence(event)

        if conf >= self.plasticity_threshold:
            return RoutingDecision(
                Route.PLASTICITY,
                f"known pattern (confidence={conf:.2f})",
                conf,
                pattern_id=pid,
            )

        # Новые / редкие terminal_error — можно быстро дать plasticity попробовать,
        # но сложные кейсы — в LLM
        if event.type == "terminal_error":
            line = str(event.payload.get("line", ""))
            complex_markers = ("Traceback", "Segmentation fault", "Kernel panic", "panic:")
            if any(m in line for m in complex_markers) and conf < 0.4:
                return RoutingDecision(
                    Route.LLM,
                    "complex error trace",
                    conf,
                    pattern_id=pid,
                )
            if conf < 0.35:
                return RoutingDecision(
                    Route.PLASTICITY,
                    "learn new terminal pattern",
                    conf,
                    pattern_id=pid,
                )

        if event.type == "open_folder":
            if conf < 0.5:
                return RoutingDecision(
                    Route.PLASTICITY,
                    "learn folder habit",
                    conf,
                    pattern_id=pid,
                )
            return RoutingDecision(
                Route.PLASTICITY,
                "known folder habit",
                conf,
                pattern_id=pid,
            )

        if event.type not in KNOWN_TYPES:
            return RoutingDecision(Route.LLM, "unknown event type", conf, pattern_id=pid)

        if conf >= 0.5:
            return RoutingDecision(Route.PLASTICITY, "moderate pattern match", conf, pattern_id=pid)

        return RoutingDecision(Route.LLM, "novel or low confidence", conf, pattern_id=pid)
