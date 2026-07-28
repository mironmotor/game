"""Navier-Stokes for the Max17 HUD: cognitive load as a fluid.

    rho (dv/dt + v.grad v) = -grad p + mu * laplacian(v) + f

The core's working state is treated as an incompressible flow through a pipe:

  * rho — density of what is being carried (memories, synapses, tasks)
  * v   — how fast the core is actually moving through it
  * L   — characteristic width of the context it has to hold open
  * mu  — viscosity, which is just uncertainty: doubt makes thought thick
  * f   — external body force, the user pushing on the system

The Reynolds number Re = rho*v*L/mu then tells the HUD which regime to draw:
laminar flow is a calm orb with parallel streamlines, turbulence is chaos.

Deterministic and stdlib-only — the HUD gets the same picture for the same
state every time.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

# Classic pipe-flow transition points, kept at their textbook values.
RE_LAMINAR = 2300.0
RE_TURBULENT = 4000.0

# Maps the core's normalised 0..1 quantities onto a Reynolds range where the
# textbook thresholds are actually meaningful.
RE_SCALE = 6000.0

# Viscosity floor: a core with perfect confidence would have zero viscosity
# and infinite Reynolds number, which is not a useful thing to render.
MU_FLOOR = 0.06

# Number of streamlines the HUD draws across the pipe.
LANES = 9


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


@dataclass(frozen=True)
class FlowState:
    """Raw cognitive quantities that feed the Navier-Stokes reading."""

    density: float = 0.5      # rho — how much material is in flight (0..1)
    velocity: float = 0.5     # v   — throughput (0..1)
    breadth: float = 0.5      # L   — context width (0..1)
    confidence: float = 0.5   # 1 - mu, inverted into viscosity
    forcing: float = 0.0      # f   — external push from the user (0..1)

    def viscosity(self) -> float:
        """mu = 1 - confidence. Doubt is what makes cognition viscous."""
        return max(MU_FLOOR, 1.0 - _clamp(self.confidence))

    def to_dict(self) -> dict[str, Any]:
        return {
            "density": round(self.density, 4),
            "velocity": round(self.velocity, 4),
            "breadth": round(self.breadth, 4),
            "confidence": round(self.confidence, 4),
            "forcing": round(self.forcing, 4),
            "viscosity": round(self.viscosity(), 4),
        }


def reynolds(state: FlowState) -> float:
    """Re = rho * v * L / mu."""
    rho = _clamp(state.density)
    v = _clamp(state.velocity)
    length = _clamp(state.breadth)
    mu = state.viscosity()
    return (rho * v * length / mu) * RE_SCALE


def regime_of(re: float) -> str:
    if re < RE_LAMINAR:
        return "laminar"
    if re < RE_TURBULENT:
        return "transitional"
    return "turbulent"


def poiseuille_profile(v_max: float, lanes: int = LANES) -> list[float]:
    """Laminar pipe flow: v(r) = v_max * (1 - (r/R)^2).

    A clean parabola — fastest in the middle, zero at the walls. This is the
    shape the HUD draws when the core is calm.
    """
    if lanes < 2:
        return [round(v_max, 4)]
    profile: list[float] = []
    for i in range(lanes):
        # r/R sweeps -1 .. 1 across the pipe.
        r = (2.0 * i / (lanes - 1)) - 1.0
        profile.append(round(max(0.0, v_max * (1.0 - r * r)), 4))
    return profile


def turbulent_profile(v_max: float, re: float, lanes: int = LANES) -> list[float]:
    """Turbulent pipe flow follows the 1/7th power law: v = v_max(1-r/R)^(1/7).

    Much flatter in the core, then it drops off a cliff at the wall — and
    carries eddies on top, which is what makes the HUD orb shudder.
    """
    if lanes < 2:
        return [round(v_max, 4)]
    exponent = 1.0 / 7.0
    # Eddy amplitude grows past the transition, deterministically phased.
    eddy = _clamp((re - RE_LAMINAR) / (RE_TURBULENT * 2.0), 0.0, 0.35)
    profile: list[float] = []
    for i in range(lanes):
        r = abs((2.0 * i / (lanes - 1)) - 1.0)
        base = v_max * ((1.0 - min(r, 0.999)) ** exponent)
        # Deterministic standing eddy — same state, same picture.
        base += eddy * v_max * math.sin(i * 2.399963)
        profile.append(round(max(0.0, base), 4))
    return profile


def solve(state: FlowState, *, dt: float = 1.0) -> dict[str, Any]:
    """One Navier-Stokes step over the core's cognitive flow."""
    dt = max(1e-6, float(dt))
    v = _clamp(state.velocity)

    re = reynolds(state)
    regime = regime_of(re)

    # Darcy friction factor: 64/Re while laminar, Blasius once it is not.
    if regime == "laminar":
        friction = 64.0 / max(re, 1.0)
    else:
        friction = 0.316 / (max(re, 1.0) ** 0.25)

    # Non-dimensional form. Dividing through by rho*U^2/L turns the equation into
    #   dv*/dt* + v*.grad v* = -grad p* + (1/Re) lap(v*) + f*
    # which keeps every term O(1). The dimensional form blows up as the context
    # narrows, because L sits squared in the denominator — useless for a HUD.

    # v . grad v : convective self-transport. The non-linear term, the one that
    # makes this a Millennium Problem and the core unpredictable under load.
    convective = v * v

    # (1/Re) * lap(v) : viscous diffusion, the term that smooths everything.
    viscous = v / max(re, 1.0)

    # -grad p : what drives the flow along the pipe.
    pressure_gradient = -(friction / 2.0) * v * v

    body_force = _clamp(state.forcing)
    acceleration = -pressure_gradient + viscous + body_force - convective
    v_next = _clamp(v + acceleration * dt)

    # Vorticity: eddy content, which is zero until the flow leaves the laminar
    # regime and then grows with Reynolds.
    vorticity = _clamp((re - RE_LAMINAR) / (RE_TURBULENT * 2.0))

    if regime == "laminar":
        profile = poiseuille_profile(v, LANES)
        advice = "Ламинарный поток: ядро держит темп, можно грузить дальше."
        stability = _clamp(1.0 - re / RE_LAMINAR * 0.4, 0.35, 1.0)
    elif regime == "transitional":
        profile = turbulent_profile(v, re, LANES)
        advice = "Переходный режим: поток на грани срыва — сузь контекст."
        stability = _clamp(0.55 - (re - RE_LAMINAR) / (RE_TURBULENT - RE_LAMINAR) * 0.25)
    else:
        profile = turbulent_profile(v, re, LANES)
        advice = "Турбулентность: нагрузка рвёт поток — нужен сон/консолидация."
        stability = _clamp(0.3 - vorticity * 0.3, 0.05, 0.3)

    return {
        "state": state.to_dict(),
        "reynolds": round(re, 1),
        "regime": regime,
        "thresholds": {"laminar": RE_LAMINAR, "turbulent": RE_TURBULENT},
        "pressure_gradient": round(pressure_gradient, 4),
        "viscous_term": round(viscous, 4),
        "convective_term": round(convective, 4),
        "acceleration": round(acceleration, 4),
        "velocity_next": round(v_next, 4),
        "vorticity": round(vorticity, 4),
        "friction_factor": round(friction, 5),
        "stability": round(stability, 4),
        "stream": profile,
        "advice": advice,
        "equation": "rho(dv/dt + v.grad v) = -grad p + mu lap(v) + f",
    }


def state_from_core(
    result: dict[str, Any],
    *,
    memory_count: int = 0,
    synapse_count: int = 0,
    latency_ms: float | None = None,
    forcing: float = 0.0,
) -> FlowState:
    """Read a FlowState out of a handled-event result plus core statistics."""
    confidence = 0.0
    value = result.get("confidence")
    if isinstance(value, (int, float)):
        confidence = _clamp(float(value))

    if not confidence:
        plasticity = result.get("plasticity")
        if isinstance(plasticity, dict) and isinstance(plasticity.get("confidence"), (int, float)):
            confidence = _clamp(float(plasticity["confidence"]))

    # Density saturates: 200 live memories already make a dense fluid.
    density = _clamp(memory_count / 200.0)
    # Breadth: how wide a context the synapse graph is holding open.
    breadth = _clamp(synapse_count / 400.0)

    if latency_ms is None:
        llm = result.get("llm")
        if isinstance(llm, dict) and isinstance(llm.get("latency_ms"), (int, float)):
            reported = float(llm["latency_ms"])
            # Zero latency means the LLM never ran, not that it was instant.
            if reported > 0.0:
                latency_ms = reported

    if latency_ms is None:
        velocity = _clamp(0.35 + confidence * 0.5)
    else:
        # 100 ms is full speed, 3 s is a crawl.
        velocity = _clamp(1.0 - (max(0.0, latency_ms - 100.0) / 2900.0))

    return FlowState(
        density=max(density, 0.05),
        velocity=velocity,
        breadth=max(breadth, 0.05),
        confidence=confidence,
        forcing=_clamp(forcing),
    )
