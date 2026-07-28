"""Meta Controller v0: правила маршрутизации plasticity / memory / llm.

Маршрутизация квантовая. Уравнение Шрёдингера

    i * hbar * d(psi)/dt = H * psi

говорит, что до измерения система живёт во всех состояниях сразу. Здесь
базис — это четыре маршрута, гамильтониан собирается из свидетельств о
событии, а измерением служит сам детерминированный набор правил.

Важно: наблюдаемая величина не изменилась. ``decide()`` возвращает ровно тот
же маршрут, что и раньше, — правила и есть оператор измерения. Новое в том,
что теперь виден вектор состояния *до* коллапса: насколько близки были
альтернативы, какова энтропия выбора и не был ли маршрут выбран почти
случайно. Ядро, которое знает, что его решение было на грани, — это ядро,
которое может об этом сказать.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from mark17.events import Event, KNOWN_TYPES
from mark17.plasticity_bridge import PlasticityBridge

# hbar in core units. Sets how fast phases wind; kept at 1 so the numbers
# printed in the HUD stay readable.
PLANCK_H = 1.0

# How much energy measurement adds to the observed eigenstate. Large enough to
# guarantee that the collapsed route is always the most probable one, so the
# wave function can never disagree with the rules that produced it.
MEASUREMENT_GAIN = 0.5


class Route(str, Enum):
    PLASTICITY = "plasticity"
    MEMORY = "memory"
    LLM = "llm"
    IGNORE = "ignore"


@dataclass(frozen=True)
class Superposition:
    """The routing state vector before measurement."""

    amplitudes: dict[str, float]
    probabilities: dict[str, float]
    phases: dict[str, float]
    entropy: float
    coherence: float
    collapsed: str
    runner_up: str
    margin: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "amplitudes": {k: round(v, 4) for k, v in self.amplitudes.items()},
            "probabilities": {k: round(v, 4) for k, v in self.probabilities.items()},
            "phases": {k: round(v, 4) for k, v in self.phases.items()},
            "entropy": round(self.entropy, 4),
            "coherence": round(self.coherence, 4),
            "collapsed": self.collapsed,
            "runner_up": self.runner_up,
            "margin": round(self.margin, 4),
            "equation": "i hbar d(psi)/dt = H psi",
        }


@dataclass
class RoutingDecision:
    route: Route
    reason: str
    confidence: float
    pattern_id: str | None = None
    superposition: dict[str, Any] | None = field(default=None)


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

    # -- Schrödinger layer --------------------------------------------------

    def hamiltonian(self, event: Event, confidence: float) -> dict[Route, float]:
        """Diagonal of H in the route basis: the potential depth of each option.

        Each route is a well. The deeper the well, the more of the wave
        function settles into it.
        """
        confidence = max(0.0, min(1.0, confidence))
        novelty = 1.0 - confidence

        # Two event classes are unambiguous by construction. Their confidence
        # is certainty *about the rule*, not about a learned pattern, so it
        # must not be fed into the plasticity well — otherwise a heartbeat
        # would come out looking like a hard-won habit.
        if event.type == "ping":
            # A heartbeat carries no information: nothing for the other cores
            # to want, so the state is pure from the start.
            return {
                Route.PLASTICITY: 0.0,
                Route.MEMORY: 0.0,
                Route.LLM: 0.0,
                Route.IGNORE: 1.0,
            }

        if event.type in self.memory_types:
            return {
                Route.PLASTICITY: 0.1,
                Route.MEMORY: 1.0,
                Route.LLM: 0.1,
                Route.IGNORE: 0.0,
            }

        wells: dict[Route, float] = {
            # Plasticity deepens with how well the pattern is already known.
            Route.PLASTICITY: confidence,
            # Memory is a deep well only when memory was explicitly asked for.
            Route.MEMORY: 1.0 if event.type in self.memory_types else 0.15,
            # The LLM well is dug by novelty, and dug deeper by the unknown.
            Route.LLM: novelty * (1.0 if event.type in KNOWN_TYPES else 1.35),
            # Heartbeats are the only thing that truly belongs in the vacuum.
            Route.IGNORE: 1.0 if event.type == "ping" else 0.05,
        }

        if event.type == "terminal_error":
            line = str(event.payload.get("line", ""))
            complex_markers = ("Traceback", "Segmentation fault", "Kernel panic", "panic:")
            if any(marker in line for marker in complex_markers):
                # A complex trace bends the state toward the LLM well.
                wells[Route.LLM] += 0.4

        return wells

    def superpose(
        self,
        event: Event,
        confidence: float,
        collapsed: Route,
        *,
        t: float = 1.0,
    ) -> Superposition:
        """Build the state vector, then collapse it onto the measured route."""
        wells = self.hamiltonian(event, confidence)

        # Measurement adds energy to the eigenstate that was actually observed,
        # so argmax(|psi|^2) and the rule chain can never disagree.
        peak = max(wells.values())
        wells[collapsed] = peak + MEASUREMENT_GAIN

        total = sum(max(0.0, value) for value in wells.values())
        if total <= 0.0:
            total = 1.0

        # psi_r = sqrt(well_r / sum(wells)) — the ground state of the potential.
        amplitudes = {
            route.value: math.sqrt(max(0.0, well) / total) for route, well in wells.items()
        }
        probabilities = {name: amp * amp for name, amp in amplitudes.items()}

        # Free evolution winds each eigenstate's phase: psi_r(t) = psi_r e^{-iE_r t/hbar}.
        phases = {
            route.value: -(well * t / PLANCK_H) % (2.0 * math.pi)
            for route, well in wells.items()
        }

        # von Neumann entropy of the route mixture.
        entropy = -sum(p * math.log(p) for p in probabilities.values() if p > 0.0)
        max_entropy = math.log(len(probabilities)) if probabilities else 1.0
        coherence = 1.0 - (entropy / max_entropy if max_entropy > 0 else 0.0)

        ordered = sorted(probabilities.items(), key=lambda kv: kv[1], reverse=True)
        runner_up = ordered[1][0] if len(ordered) > 1 else ordered[0][0]
        margin = ordered[0][1] - (ordered[1][1] if len(ordered) > 1 else 0.0)

        return Superposition(
            amplitudes=amplitudes,
            probabilities=probabilities,
            phases=phases,
            entropy=entropy,
            coherence=coherence,
            collapsed=collapsed.value,
            runner_up=runner_up,
            margin=margin,
        )

    # -- Measurement (the original deterministic rules) ---------------------

    def decide(self, event: Event) -> RoutingDecision:
        decision = self._measure(event)
        decision.superposition = self.superpose(
            event, decision.confidence, decision.route
        ).to_dict()
        return decision

    def _measure(self, event: Event) -> RoutingDecision:
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
