"""Laminar HUD stream — Navier-Stokes applied to core telemetry.

The core emits telemetry in bursts: confidence jumps the instant a pattern
matches, memory counts step by whole integers, route probabilities snap between
values. Rendered directly, that is a turbulent flow, and a turbulent HUD is one
the eye cannot read.

This module is the viscous layer between the core and the display. Each channel
is integrated through the momentum equation, so the HUD tracks real state
closely while the high-frequency component — the jitter — is damped out by
viscosity rather than by an arbitrary smoothing constant.

State is held in memory by the caller, so this stays as pure and testable as the
physics kernel underneath it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from mark17.cognitive_physics import (
    CRITICAL_REYNOLDS,
    DENSITY,
    VISCOSITY,
    Flow,
    clamp,
    flow_step,
)

__all__ = ["ChannelState", "FluidHud", "CHANNEL_VISCOSITY"]


CHANNEL_VISCOSITY: dict[str, float] = {
    # Confidence swings hardest and reads worst when it jitters — thickest.
    "confidence": 0.70,
    # Energy and focus are human-facing gauges; they should glide.
    "energy": 0.60,
    "focus": 0.60,
    # Route probability should stay responsive: it is a decision, not a mood.
    "route": 0.25,
    # Counters only ever ratchet; light damping is enough to avoid stepping.
    "memories": 0.35,
    "synapses": 0.35,
}

DEFAULT_VISCOSITY = VISCOSITY


@dataclass
class ChannelState:
    """The instantaneous state of one HUD channel."""

    velocity: float = 0.0
    target: float = 0.0
    viscosity: float = DEFAULT_VISCOSITY
    density: float = DENSITY
    turbulence_events: int = 0
    history: list[float] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "value": round(self.velocity, 4),
            "target": round(self.target, 4),
            "viscosity": round(self.viscosity, 3),
            "turbulence_events": self.turbulence_events,
        }


class FluidHud:
    """Integrates named telemetry channels into a laminar display stream.

    Usage is a single call per frame::

        hud = FluidHud()
        frame = hud.step({"confidence": 0.9, "energy": 42})

    Channels appear on first sight and keep their state between frames. Values
    are clamped to [0, 1] on the way in unless a channel is registered with an
    explicit scale, so gauges and probabilities can share the same stream.
    """

    def __init__(
        self,
        *,
        dt: float = 1.0,
        history_limit: int = 32,
        viscosity: dict[str, float] | None = None,
    ) -> None:
        self.dt = max(float(dt), 1e-6)
        self.history_limit = max(int(history_limit), 2)
        self.viscosity = {**CHANNEL_VISCOSITY, **(viscosity or {})}
        self.channels: dict[str, ChannelState] = {}
        self.frame = 0

    def _channel(self, name: str) -> ChannelState:
        state = self.channels.get(name)
        if state is None:
            state = ChannelState(viscosity=self.viscosity.get(name, DEFAULT_VISCOSITY))
            self.channels[name] = state
        return state

    def step(self, telemetry: dict[str, float]) -> dict[str, Any]:
        """Advance every channel one frame and return the renderable state."""
        self.frame += 1
        rendered: dict[str, Any] = {}
        flows: dict[str, Flow] = {}

        for name, raw in telemetry.items():
            state = self._channel(name)
            state.target = clamp(raw)
            flow = flow_step(
                state.velocity,
                state.target,
                dt=self.dt,
                viscosity=state.viscosity,
                density=state.density,
                # Characteristic length is how far the stream still has to
                # travel: a large correction is the thing that can go turbulent.
                length=abs(state.target - state.velocity),
            )
            state.velocity = clamp(flow.velocity)
            if flow.turbulent:
                state.turbulence_events += 1
            state.history.append(state.velocity)
            if len(state.history) > self.history_limit:
                del state.history[: -self.history_limit]

            flows[name] = flow
            rendered[name] = round(state.velocity, 4)

        settled = all(
            abs(state.velocity - state.target) < 0.01 for state in self.channels.values()
        )

        return {
            "frame": self.frame,
            "values": rendered,
            "regime": "turbulent" if any(f.turbulent for f in flows.values()) else "laminar",
            "settled": settled,
            "critical_reynolds": CRITICAL_REYNOLDS,
            "channels": {name: state.to_dict() for name, state in self.channels.items()},
        }

    def settle(self, telemetry: dict[str, float], *, max_frames: int = 240) -> dict[str, Any]:
        """Run frames until the stream reaches steady state.

        Useful for one-shot renders (a report, a screenshot) where there is no
        animation loop to carry the flow — the viscous solution is run to
        convergence and only the settled frame is returned.
        """
        frame: dict[str, Any] = {}
        for _ in range(max(int(max_frames), 1)):
            frame = self.step(telemetry)
            if frame["settled"]:
                break
        return frame

    def snapshot(self) -> dict[str, Any]:
        """Current stream state without advancing time."""
        return {
            "frame": self.frame,
            "values": {name: round(s.velocity, 4) for name, s in self.channels.items()},
            "channels": {name: s.to_dict() for name, s in self.channels.items()},
        }
