"""Meta Controller v1: маршрутизация plasticity / memory / llm как квантовое состояние.

Routing is not a branch, it is a state vector. Every route carries an amplitude,
the Born rule turns amplitudes into probabilities, and observation collapses the
state onto one route while the full distribution survives for inspection.

Two kinds of measurement happen here. Some events arrive already in an
eigenstate — a heartbeat *is* an ignore, an explicit recall *is* a memory read —
and there is nothing to collapse. Everything else is genuinely undetermined
until the evidence is summed: the prior comes from pattern confidence, the
event-specific rules enter as a Hamiltonian, and the route with the largest
|ψ|² is the one that runs.

Collapse is deterministic (argmax, not sampling), so the core stays reproducible.
The value of the superposition is not randomness — it is that ``coherence`` now
reports how close the decision was, which a bare branch could never express.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any

from mark17.cognitive_physics import Superposition, evolve, superpose
from mark17.events import Event, KNOWN_TYPES

if TYPE_CHECKING:  # PlasticityBridge pulls in numpy; the router itself needs
    # only `pattern_id` and `lookup_confidence`, so keep the import type-only.
    from mark17.plasticity_bridge import PlasticityBridge


class Route(str, Enum):
    PLASTICITY = "plasticity"
    MEMORY = "memory"
    LLM = "llm"
    IGNORE = "ignore"


# Ground-state amplitudes. The floor matters: a route at exactly zero can never
# be revived by the Hamiltonian, because imaginary-time evolution is
# multiplicative. Every route keeps a little amplitude so evidence can still
# reach it.
AMPLITUDE_FLOOR = 0.08
AMPLITUDE_SPAN = 0.92
MEMORY_BASELINE = 0.12

# Energies applied by the event-specific rules. Negative energy favours a route;
# imaginary-time evolution weights it by e^(-E).
E_FOLDER_HABIT = -3.0
E_LEARN_TERMINAL = -3.0
E_COMPLEX_TRACE = -1.0
E_UNKNOWN_TYPE = -1.5

COMPLEX_MARKERS = ("Traceback", "Segmentation fault", "Kernel panic", "panic:")


@dataclass
class RoutingDecision:
    route: Route
    reason: str
    confidence: float
    pattern_id: str | None = None
    superposition: dict[str, float] = field(default_factory=dict)
    coherence: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "route": self.route.value,
            "reason": self.reason,
            "confidence": round(self.confidence, 4),
            "pattern_id": self.pattern_id,
            "superposition": {k: round(v, 4) for k, v in self.superposition.items()},
            "coherence": round(self.coherence, 4),
        }


class MetaController:
    """v1 — правила остались, но теперь это гамильтониан, а не цепочка if'ов."""

    def __init__(
        self,
        plasticity: "PlasticityBridge",
        *,
        plasticity_threshold: float = 0.7,
        memory_types: frozenset[str] | None = None,
    ) -> None:
        self.plasticity = plasticity
        self.plasticity_threshold = plasticity_threshold
        self.memory_types = memory_types or frozenset(
            {"recall", "search_memory", "remember"}
        )

    # -- measurement ------------------------------------------------------

    @staticmethod
    def _eigenstate(
        route: Route,
        reason: str,
        confidence: float,
        pattern_id: str | None = None,
    ) -> RoutingDecision:
        """A measurement that is already an eigenstate — nothing to collapse."""
        return RoutingDecision(
            route=route,
            reason=reason,
            confidence=confidence,
            pattern_id=pattern_id,
            superposition={route.value: 1.0},
            coherence=0.0,
        )

    def _hamiltonian(self, event: Event, confidence: float) -> tuple[dict[str, float], str]:
        """Event-specific energies, plus the reason the dominant term was applied.

        This is the old if-chain, unchanged in what it believes — a folder open
        is a habit, an unrecognised event needs language, a raw traceback is too
        complex for reflex. It differs only in that each rule now *weights* a
        route instead of returning one, so several rules can apply at once.
        """
        energies: dict[str, float] = {}
        reason = "novel or low confidence"

        if event.type == "terminal_error":
            line = str(event.payload.get("line", ""))
            if any(marker in line for marker in COMPLEX_MARKERS) and confidence < 0.4:
                energies[Route.LLM.value] = E_COMPLEX_TRACE
                reason = "complex error trace"
            elif confidence < 0.35:
                energies[Route.PLASTICITY.value] = E_LEARN_TERMINAL
                reason = "learn new terminal pattern"

        elif event.type == "open_folder":
            energies[Route.PLASTICITY.value] = E_FOLDER_HABIT
            reason = (
                "learn folder habit" if confidence < 0.5 else "known folder habit"
            )

        if event.type not in KNOWN_TYPES and not energies:
            energies[Route.LLM.value] = E_UNKNOWN_TYPE
            reason = "unknown event type"

        if not energies and confidence >= 0.5:
            reason = "moderate pattern match"

        return energies, reason

    def superpose_routes(self, event: Event, confidence: float) -> Superposition:
        """Build the route state vector for an event without collapsing early.

        The prior is the pattern confidence itself: a well-known pattern puts its
        amplitude on reflex, an unfamiliar one puts it on language. The
        Hamiltonian then shifts that prior by whatever the event-specific rules
        have to say.
        """
        prior = {
            Route.PLASTICITY.value: AMPLITUDE_FLOOR + confidence * AMPLITUDE_SPAN,
            Route.LLM.value: AMPLITUDE_FLOOR + (1.0 - confidence) * AMPLITUDE_SPAN,
            Route.MEMORY.value: MEMORY_BASELINE,
        }
        energies, _ = self._hamiltonian(event, confidence)
        return evolve(superpose(prior), energies)

    def decide(self, event: Event) -> RoutingDecision:
        if event.type == "ping":
            return self._eigenstate(Route.IGNORE, "heartbeat", 1.0)

        if event.type in self.memory_types:
            return self._eigenstate(Route.MEMORY, "explicit memory request", 1.0)

        pid = self.plasticity.pattern_id(event)
        conf = self.plasticity.lookup_confidence(event)

        # A confidence above threshold is a strong measurement: the pattern is
        # known well enough that the state has already decohered onto reflex.
        if conf >= self.plasticity_threshold:
            return self._eigenstate(
                Route.PLASTICITY,
                f"known pattern (confidence={conf:.2f})",
                conf,
                pattern_id=pid,
            )

        state = self.superpose_routes(event, conf)
        _, reason = self._hamiltonian(event, conf)

        return RoutingDecision(
            route=Route(state.collapsed),
            reason=reason,
            confidence=conf,
            pattern_id=pid,
            superposition=state.probabilities,
            coherence=state.coherence,
        )
