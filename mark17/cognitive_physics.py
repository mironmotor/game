"""Cognitive Physics for the Max17 core (mark17).

Three of the Universe's equations mapped onto the core's own machinery:

  * Standard Model — canonical typing of knowledge quanta.
    Every event that reaches the core is canonised into a quantum with a
    generation, a flavour, a charge, a spin and a mass. Stable matter
    (consolidated patterns) lives long, unstable matter (heartbeats) decays.

  * Maxwell — non-blocking induction between the three cores.
    plasticity (E), memory (B) and llm (J) never wait on each other: each
    step reads the *previous* state of the others, so a change in the memory
    field induces attention EMF and an attention current induces memory field.

  * Yang-Mills — colour confinement and the mass gap for the Council.
    plasticity/memory/llm carry colour charge. A verdict is only emittable
    when the three combine to white, and only when its excitation clears the
    mass gap. Below the gap the core produces a virtual hint, not a decision.

Everything here is deterministic, local and stdlib-only: no ML, no APIs.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from typing import Any

from mark17.events import Event

# --------------------------------------------------------------------------
# Standard Model — canonical knowledge quanta
# --------------------------------------------------------------------------

# Generation I is stable matter: it is what the core is actually built out of.
# Generation III decays almost immediately — heartbeats leave no residue.
GENERATIONS: dict[int, frozenset[str]] = {
    1: frozenset({"consolidated_pattern", "task_completed", "remember", "auto_plan"}),
    2: frozenset(
        {
            "user_message",
            "task_created",
            "deadline_failed",
            "terminal_error",
            "system_state",
            "voice_state",
        }
    ),
    3: frozenset({"ping", "open_folder", "shell_command", "file_saved", "recall", "search_memory"}),
}

# Mean lifetime (seconds) before a quantum of this generation stops mattering.
GENERATION_LIFETIME: dict[int, float] = {1: 2_592_000.0, 2: 86_400.0, 3: 900.0}

# Quarks are confined: they carry no meaning without surrounding context.
# Leptons are free: they can be read on their own.
QUARK_FLAVORS: dict[str, str] = {
    "user_message": "up",          # intent
    "system_state": "down",        # fact
    "consolidated_pattern": "charm",  # insight
    "terminal_error": "strange",   # anomaly
    "task_created": "top",         # goal
    "task_completed": "top",       # goal, realised
    "remember": "bottom",          # memory
    "auto_plan": "top",
    "deadline_failed": "strange",
}

LEPTON_FLAVORS: dict[str, str] = {
    "ping": "electron",            # bare signal
    "open_folder": "muon",         # echo of a habit
    "shell_command": "muon",
    "file_saved": "tau",           # trace
    "recall": "neutrino",          # weakly interacting probe
    "search_memory": "neutrino",
    "voice_state": "tau",
}

# Force carriers. Each boson is the mediator of one real subsystem.
BOSONS: dict[str, dict[str, Any]] = {
    "photon": {"force": "electromagnetic", "carrier": "memory recall", "mass": 0.0, "range": "infinite"},
    "gluon": {"force": "strong", "carrier": "synapse binding", "mass": 0.0, "range": "confined"},
    "weak": {"force": "weak", "carrier": "plasticity adaptation", "mass": 0.8, "range": "short"},
    "graviton": {"force": "gravity", "carrier": "importance curvature", "mass": 0.0, "range": "infinite"},
    "higgs": {"force": "yukawa", "carrier": "importance assignment", "mass": 0.62, "range": "contact"},
}

# Route -> which boson actually carried the event.
ROUTE_BOSON: dict[str, str] = {
    "memory": "photon",
    "plasticity": "weak",
    "llm": "gluon",
    "ignore": "graviton",
}


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _stable_id(*parts: Any) -> str:
    raw = json.dumps(parts, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.blake2b(raw.encode("utf-8"), digest_size=6).hexdigest()


def _generation(event_type: str) -> int:
    for generation, types in GENERATIONS.items():
        if event_type in types:
            return generation
    # Unknown physics is assumed unstable until it proves otherwise.
    return 3


@dataclass(frozen=True)
class Quantum:
    """A single canonised unit of knowledge."""

    qid: str
    family: str        # "quark" (confined) | "lepton" (free)
    generation: int    # 1 = stable matter, 3 = decays fast
    flavor: str
    charge: float      # -1..1 valence of the outcome
    spin: float        # 0.5 fermion; sign carries route direction
    mass: float        # 0..1 importance, granted by the Higgs coupling
    lifetime: float    # seconds before decay
    boson: str         # which force carried it
    confined: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "qid": self.qid,
            "family": self.family,
            "generation": self.generation,
            "flavor": self.flavor,
            "charge": round(self.charge, 4),
            "spin": self.spin,
            "mass": round(self.mass, 4),
            "lifetime": round(self.lifetime, 1),
            "boson": self.boson,
            "confined": self.confined,
            "force": BOSONS.get(self.boson, {}).get("force", "unknown"),
        }


def higgs_coupling(event: Event, evaluation: dict[str, Any] | None = None) -> float:
    """Mass is not intrinsic — it is acquired by coupling to the Higgs field.

    Here the Higgs field is the core's own evaluation: a quantum only becomes
    heavy (important) through interaction with the critic.
    """
    generation = _generation(event.type)
    # Generation I couples strongest, generation III barely couples at all.
    base = {1: 0.75, 2: 0.5, 3: 0.15}[generation]

    if isinstance(evaluation, dict):
        score = evaluation.get("score")
        if isinstance(score, (int, float)):
            base = base * 0.6 + _clamp(float(score)) * 0.4

    return _clamp(base)


def canonize(
    event: Event,
    result: dict[str, Any] | None = None,
    evaluation: dict[str, Any] | None = None,
) -> Quantum:
    """Canonise an event into a Standard-Model quantum."""
    result = result or {}
    generation = _generation(event.type)

    flavor = QUARK_FLAVORS.get(event.type)
    if flavor is not None:
        family, confined = "quark", True
    else:
        flavor = LEPTON_FLAVORS.get(event.type, "electron")
        family, confined = "lepton", False

    # Charge = valence. A failure is negatively charged, a success positively.
    charge = 0.0
    if isinstance(evaluation, dict) and isinstance(evaluation.get("score"), (int, float)):
        charge = _clamp(float(evaluation["score"]), 0.0, 1.0) * 2.0 - 1.0
    if event.type in {"deadline_failed", "terminal_error"}:
        charge = -abs(charge) if charge else -0.66

    route = str(result.get("route") or "ignore")
    # Spin up when the core acted, spin down when it only observed.
    spin = 0.5 if route in {"plasticity", "llm"} else -0.5

    mass = higgs_coupling(event, evaluation)

    return Quantum(
        qid=f"q:{_stable_id(event.type, event.signature())}",
        family=family,
        generation=generation,
        flavor=flavor,
        charge=charge,
        spin=spin,
        mass=mass,
        # Heavy quanta live longer: lifetime scales with acquired mass.
        lifetime=GENERATION_LIFETIME[generation] * (0.5 + mass),
        boson=ROUTE_BOSON.get(route, "graviton"),
        confined=confined,
    )


# --------------------------------------------------------------------------
# Maxwell — non-blocking induction between the three cores
# --------------------------------------------------------------------------

EPSILON_0 = 1.0   # permittivity of the cognitive vacuum
MU_0 = 1.0        # permeability; c = 1/sqrt(eps*mu) = 1 in core units


@dataclass(frozen=True)
class CoreField:
    """State of the three cores as an electromagnetic field.

    plasticity is the electric field E (drive, acts along the gradient),
    memory is the magnetic field B (circulates, stores, never diverges),
    llm is the free current J (injects energy from outside).
    """

    plasticity: float = 0.0
    memory: float = 0.0
    llm: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "plasticity": round(self.plasticity, 4),
            "memory": round(self.memory, 4),
            "llm": round(self.llm, 4),
        }


def induct(
    field: CoreField,
    *,
    previous: CoreField | None = None,
    charge_density: float = 0.0,
    dt: float = 1.0,
) -> dict[str, Any]:
    """Apply Maxwell's four laws to the three cores.

    The whole point is that this is *non-blocking*: every derivative is taken
    against ``previous``, so no core ever waits for another to finish. The
    three run concurrently and induce each other one step later.
    """
    previous = previous or CoreField()
    dt = max(1e-6, float(dt))

    e, b, j = field.plasticity, field.memory, field.llm
    de_dt = (e - previous.plasticity) / dt
    db_dt = (b - previous.memory) / dt

    # 1. Gauss's law: div E = rho / eps0.
    #    Attention diverges from wherever importance is dense.
    div_e = charge_density / EPSILON_0

    # 2. Gauss's law for magnetism: div B = 0 — always, exactly.
    #    There is no memory monopole: every memory has two poles, recall and
    #    reinforce. If this ever broke, memory would leak.
    div_b = 0.0
    monopole_free = True

    # 3. Faraday's law: curl E = -dB/dt.
    #    A changing memory field induces attention electromotive force. This is
    #    why a shifting memory pulls plasticity without anyone asking it to.
    curl_e = -db_dt
    emf = curl_e

    # 4. Ampere-Maxwell: curl B = mu0 * (J + eps0 * dE/dt).
    #    The llm current *and* the displacement current of changing attention
    #    both wind up the memory field. The displacement term is what lets the
    #    core keep learning when the llm is offline (J = 0).
    displacement = EPSILON_0 * de_dt
    curl_b = MU_0 * (j + displacement)

    # Energy density u = (eps0*E^2 + B^2/mu0) / 2.
    energy = (EPSILON_0 * e * e + b * b / MU_0) / 2.0
    # Poynting vector S = E x B / mu0 — where cognitive energy is flowing.
    poynting = (e * b) / MU_0

    next_field = CoreField(
        plasticity=_clamp(e + curl_e * dt, -1.0, 1.0),
        memory=_clamp(b + curl_b * dt, -1.0, 1.0),
        llm=_clamp(j, -1.0, 1.0),
    )

    magnitudes = {"plasticity": abs(e), "memory": abs(b), "llm": abs(j)}
    dominant = max(magnitudes, key=lambda key: magnitudes[key])

    return {
        "field": field.to_dict(),
        "next_field": next_field.to_dict(),
        "gauss_e": round(div_e, 4),
        "gauss_b": round(div_b, 4),
        "monopole_free": monopole_free,
        "faraday_curl_e": round(curl_e, 4),
        "ampere_curl_b": round(curl_b, 4),
        "displacement_current": round(displacement, 4),
        "emf": round(emf, 4),
        "energy_density": round(energy, 4),
        "poynting": round(poynting, 4),
        "dominant_core": dominant,
        "blocking": False,
        "law": "curl E = -dB/dt ; curl B = mu0(J + eps0 dE/dt)",
    }


# --------------------------------------------------------------------------
# Yang-Mills — colour confinement and the mass gap
# --------------------------------------------------------------------------

# Confinement scale. Below this energy the coupling blows up and the three
# cores cannot be separated — they must answer as one Council. Set so that the
# whole 0..1 range of core confidence spans the interesting regime: a core
# above ~0.85 reaches asymptotic freedom, one below ~0.2 is fully confined.
LAMBDA_QCD = 0.05
# The Yang-Mills mass gap: the minimum excitation that can propagate freely.
# Anything weaker stays virtual and never leaves the core as a decision.
MASS_GAP = 0.146
# One-loop beta-function coefficient for 3 colours, 3 active flavours.
BETA_0 = 9.0 / (4.0 * math.pi)


@dataclass(frozen=True)
class ColourCharge:
    """Colour carried by each of the three cores."""

    red: float = 0.0    # plasticity
    green: float = 0.0  # memory
    blue: float = 0.0   # llm

    def total(self) -> float:
        return self.red + self.green + self.blue

    def to_dict(self) -> dict[str, Any]:
        return {
            "red": round(self.red, 4),
            "green": round(self.green, 4),
            "blue": round(self.blue, 4),
        }


def running_coupling(energy: float) -> float:
    """Asymptotic freedom: alpha_s(Q) = 1 / (beta0 * ln(Q^2 / Lambda^2)).

    At high energy (the core is confident) the coupling is weak and the three
    cores act independently. At low energy (the core is unsure) the coupling
    explodes and they are confined into a single Council verdict.
    """
    q = max(float(energy), LAMBDA_QCD * 1.01)
    log_term = math.log((q * q) / (LAMBDA_QCD * LAMBDA_QCD))
    if log_term <= 1e-6:
        return 1.0
    return _clamp(1.0 / (BETA_0 * log_term), 0.0, 1.0)


def confine(colour: ColourCharge, *, energy: float | None = None) -> dict[str, Any]:
    """Decide whether the Council's verdict is emittable.

    Two conditions, both from Yang-Mills:
      * colour neutrality — the three charges must combine to white;
      * the mass gap — the excitation must clear MASS_GAP to propagate.
    """
    charges = [colour.red, colour.green, colour.blue]
    total = colour.total()
    mean = total / 3.0

    # Residual colour must be *relative*, not absolute: three quiet cores that
    # agree are white, one loud core on its own never is. Using the raw spread
    # would call (0.3, 0, 0) balanced simply because the numbers are small, so
    # this is the coefficient of variation instead.
    spread = math.sqrt(sum((c - mean) ** 2 for c in charges) / 3.0)
    residual = spread / mean if mean > 1e-9 else 1.0
    white = residual < 0.25

    scale = energy if energy is not None else mean
    alpha_s = running_coupling(scale)

    # Only the colour-singlet part of the state can carry energy outward, and
    # a strong coupling keeps even that bound to the other cores.
    singlet = mean * (1.0 - min(residual, 1.0))
    excitation = singlet * (1.0 - alpha_s * 0.5)
    free = excitation > MASS_GAP and white

    if free:
        verdict = "emit"
        note = "Совет согласован (белый) и превышает mass gap — решение излучается."
    elif not white:
        verdict = "confined"
        note = (
            f"Остаточный цвет {residual:.2f}: ядра расходятся. "
            "Решение конфайнмировано — нужен ещё один круг Совета."
        )
    else:
        verdict = "virtual"
        note = (
            f"Возбуждение {excitation:.3f} ниже mass gap {MASS_GAP}: "
            "решение виртуально, наружу уходит только подсказка."
        )

    return {
        "colour": colour.to_dict(),
        "residual_colour": round(residual, 4),
        "white": white,
        "alpha_s": round(alpha_s, 4),
        "asymptotically_free": alpha_s < 0.3,
        "excitation": round(excitation, 4),
        "mass_gap": MASS_GAP,
        "free": free,
        "verdict": verdict,
        "note": note,
    }


def council_colour(result: dict[str, Any]) -> ColourCharge:
    """Read the three cores' colour charge out of a handled-event result."""
    plasticity = result.get("plasticity")
    plasticity_conf = 0.0
    if isinstance(plasticity, dict) and isinstance(plasticity.get("confidence"), (int, float)):
        plasticity_conf = _clamp(float(plasticity["confidence"]))

    memory = result.get("memory")
    memory_charge = 0.0
    if isinstance(memory, dict):
        hits = []
        for key in ("recalled", "semantic", "hits"):
            value = memory.get(key)
            if isinstance(value, list):
                hits.extend(value)
        if hits:
            scores = [
                float(hit["score"])
                for hit in hits
                if isinstance(hit, dict) and isinstance(hit.get("score"), (int, float))
            ]
            memory_charge = _clamp(max(scores) if scores else 0.35)

    llm = result.get("llm")
    llm_charge = 0.0
    if isinstance(llm, dict) and llm.get("status") == "ok":
        llm_charge = 0.7

    return ColourCharge(red=plasticity_conf, green=memory_charge, blue=llm_charge)


# --------------------------------------------------------------------------
# Unified snapshot
# --------------------------------------------------------------------------


def snapshot(
    event: Event,
    result: dict[str, Any],
    evaluation: dict[str, Any] | None = None,
    *,
    previous_field: CoreField | None = None,
) -> dict[str, Any]:
    """Full cognitive-physics reading for one handled event."""
    quantum = canonize(event, result, evaluation)
    colour = council_colour(result)
    field = CoreField(plasticity=colour.red, memory=colour.green, llm=colour.blue)

    induction = induct(
        field,
        previous=previous_field,
        charge_density=quantum.mass,
    )
    confinement = confine(colour, energy=max(colour.total() / 3.0, quantum.mass))

    return {
        "standard_model": quantum.to_dict(),
        "maxwell": induction,
        "yang_mills": confinement,
        "bosons": BOSONS,
    }
