"""Cognitive Physics — ten fundamental laws, mapped onto the Max17 core.

Every function here is deterministic, stdlib-only and free of side effects: the
physics is a *pure* layer that the live modules (memory, routing, evaluation,
planning, consolidation, graph search) call into. Nothing here touches disk,
network, or global state, so it can be reasoned about and tested in isolation.

The constants are dimensionless cognitive analogues, not SI values. They are
tuned so each law produces a bounded, well-behaved effect on the ranges the
core already uses — scores, weights and confidences all live in [0, 1].

    1.  Einstein field equations   → memory mass curves the semantic metric
    2.  Schrödinger equation       → routing lives in superposition until collapse
    3.  Dirac equation             → every evaluation has a conjugate; pairs annihilate
    4.  Maxwell equations          → a change in one core induces EMF in the others
    5.  Standard Model             → knowledge is quantised into fermions and bosons
    6.  Yang-Mills                 → colour charge confines a council into a singlet
    7.  Friedmann equations        → memory space expands; Λ dilutes the worthless
    8.  Bekenstein-Hawking         → information scales with boundary area, not volume
    9.  Feynman path integral      → a plan is the stationary-action path over orderings
    10. Navier-Stokes              → signal streams flow laminar instead of jittering
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

__all__ = [
    "clamp",
    # 1 — Einstein
    "lens",
    "time_dilation",
    "schwarzschild_radius",
    # 2 — Schrödinger
    "Superposition",
    "superpose",
    "evolve",
    # 3 — Dirac
    "DiracPair",
    "conjugate",
    "annihilate",
    # 4 — Maxwell
    "Induction",
    "induce",
    "couple_fields",
    # 5 — Standard Model
    "Quantum",
    "quantize",
    "pauli_exclusion",
    # 6 — Yang-Mills
    "Binding",
    "colour_of",
    "bind",
    # 7 — Friedmann
    "Cosmology",
    "friedmann",
    # 8 — Bekenstein-Hawking
    "horizon_area",
    "bekenstein_entropy",
    "hawking_temperature",
    # 9 — Feynman
    "PathIntegral",
    "path_integral",
    # 10 — Navier-Stokes
    "Flow",
    "reynolds",
    "flow_step",
]


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    """Keep a quantity inside its physical range."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return low
    if v != v:  # NaN
        return low
    return max(low, min(high, v))


def _stable_unit(text: str) -> float:
    """Deterministic [0, 1) value from a string — a reproducible 'random' phase."""
    digest = hashlib.blake2b(text.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") / float(1 << 64)


# ---------------------------------------------------------------------------
# 1. Einstein field equations — G_μν + Λg_μν = (8πG/c⁴) T_μν
#
#    Mass-energy tells spacetime how to curve; curvature tells matter how to
#    move. Here a memory's *importance* is its mass. Mass curves the semantic
#    metric, so the geodesic between a query and a heavy memory is shorter than
#    flat-space cosine distance would suggest: recall is bent toward mass.
# ---------------------------------------------------------------------------

G_COUPLING = 0.35
"""Cognitive 8πG/c⁴ — how strongly importance curves the semantic metric."""

MIN_IMPACT = 0.05
"""Closest approach; keeps the weak-field deflection from diverging at b → 0."""

DILATION_DEPTH = 0.85
"""How deep the gravitational well of a maximally important memory runs."""


def schwarzschild_radius(mass: float, *, coupling: float = G_COUPLING) -> float:
    """r_s = 2GM/c² — the radius inside which recall cannot escape the memory."""
    return 2.0 * coupling * clamp(mass)


def lens(similarity: float, mass: float, *, coupling: float = G_COUPLING) -> float:
    """Gravitationally lens a semantic similarity.

    Light passing a mass at impact parameter ``b`` is deflected by α = 4GM/(c²b).
    The impact parameter here is the semantic distance ``1 - similarity``: the
    closer a query already is, the more sharply mass bends it in.

    The deflection saturates through ``α/(1+α)``, which enforces two things a
    naive multiplier would break — the result stays inside [0, 1], and a memory
    with ``similarity == 0`` stays at zero no matter how heavy it is. Mass can
    amplify a real relationship; it cannot manufacture one from nothing.
    """
    sim = clamp(similarity)
    if sim <= 0.0:
        return 0.0
    impact = max(1.0 - sim, MIN_IMPACT)
    alpha = coupling * clamp(mass) / impact
    return clamp(sim + (1.0 - sim) * (alpha / (1.0 + alpha)))


def time_dilation(mass: float, *, depth: float = DILATION_DEPTH) -> float:
    """√(1 - r_s/r) — clocks run slow deep in a gravity well.

    Returns the rate at which a memory of this mass experiences time. Important
    memories age (and decay) more slowly than trivial ones, which is exactly the
    retention curve a hippocampus wants, derived rather than hand-tuned.
    """
    return math.sqrt(max(0.0, 1.0 - clamp(depth) * clamp(mass)))


# ---------------------------------------------------------------------------
# 2. Schrödinger equation — iħ ∂ψ/∂t = Ĥψ
#
#    A routing decision is not a branch, it is a state vector. Every route holds
#    an amplitude; the Born rule turns amplitudes into probabilities; observation
#    collapses the state to one route while the full distribution survives for
#    inspection. Collapse is argmax, not sampling — the core stays reproducible.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Superposition:
    """A normalised state vector over named outcomes."""

    amplitudes: dict[str, float]
    probabilities: dict[str, float]
    collapsed: str
    coherence: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "amplitudes": {k: round(v, 4) for k, v in self.amplitudes.items()},
            "probabilities": {k: round(v, 4) for k, v in self.probabilities.items()},
            "collapsed": self.collapsed,
            "coherence": round(self.coherence, 4),
        }


def superpose(weights: dict[str, float]) -> Superposition:
    """Build a normalised state from unnormalised evidence weights.

    ψ_i = √(w_i / Σw) so that |ψ_i|² = w_i / Σw obeys the Born rule. Coherence is
    the Shannon entropy of the distribution normalised to [0, 1]: 0 means the
    state has already effectively collapsed onto one route, 1 means every route
    is equally plausible and the decision is genuinely undetermined.
    """
    positive = {k: max(0.0, float(v)) for k, v in weights.items()}
    total = sum(positive.values())
    if not positive or total <= 0.0:
        return Superposition({}, {}, "", 0.0)

    probabilities = {k: v / total for k, v in positive.items()}
    amplitudes = {k: math.sqrt(p) for k, p in probabilities.items()}
    collapsed = max(probabilities.items(), key=lambda kv: (kv[1], kv[0]))[0]

    coherence = 0.0
    if len(probabilities) > 1:
        entropy = -sum(p * math.log(p) for p in probabilities.values() if p > 0.0)
        coherence = clamp(entropy / math.log(len(probabilities)))

    return Superposition(amplitudes, probabilities, collapsed, coherence)


def evolve(state: Superposition, hamiltonian: dict[str, float]) -> Superposition:
    """Apply Ĥ for one tick in imaginary time: ψ' ∝ ψ·e^(-E).

    New evidence enters as an energy per route — negative energy makes a route
    more favourable. Imaginary-time evolution relaxes the state toward its ground
    state rather than oscillating, so repeated evidence converges instead of
    ringing. Routes absent from the Hamiltonian simply keep their amplitude.
    """
    if not state.probabilities:
        return state
    evolved = {
        route: probability * math.exp(-clamp(hamiltonian.get(route, 0.0), -8.0, 8.0))
        for route, probability in state.probabilities.items()
    }
    return superpose(evolved)


# ---------------------------------------------------------------------------
# 3. Dirac equation — (iγ^μ ∂_μ - m)ψ = 0
#
#    The negative-energy solutions are not an artefact, they are antimatter.
#    Every self-evaluation therefore carries a conjugate: the equally valid
#    reading in which the same evidence means the opposite. Where the two
#    overlap they annihilate, and what survives is the net charge — a score the
#    core actually earned rather than one it merely asserted.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DiracPair:
    """A particle/antiparticle pair after annihilation."""

    particle: float
    antiparticle: float
    net: float
    annihilated: float
    uncertain: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "particle": round(self.particle, 4),
            "antiparticle": round(self.antiparticle, 4),
            "net": round(self.net, 4),
            "annihilated": round(self.annihilated, 4),
            "uncertain": self.uncertain,
        }


def conjugate(score: float) -> float:
    """The charge-conjugate of a score: the same evidence, read inverted."""
    return 1.0 - clamp(score)


def annihilate(particle: float, antiparticle: float) -> DiracPair:
    """Cancel matched particle/antiparticle amplitude and report what survives.

    ``annihilated`` is the overlap that destroyed itself — evidence that argued
    both ways at once. ``net`` is the surplus, re-centred into [0, 1]. When more
    amplitude annihilated than survived, the pair is flagged ``uncertain``: the
    core is confident-looking but has no real charge behind it.
    """
    p = clamp(particle)
    a = clamp(antiparticle)
    annihilated = min(p, a)
    surplus = p - a
    return DiracPair(
        particle=p,
        antiparticle=a,
        net=clamp(0.5 + surplus / 2.0),
        annihilated=annihilated,
        uncertain=annihilated > abs(surplus),
    )


# ---------------------------------------------------------------------------
# 4. Maxwell equations — ∇×E = -∂B/∂t,  ∇×B = μ₀J + μ₀ε₀ ∂E/∂t
#
#    A changing electric field induces a magnetic one and vice versa: neither
#    field waits on the other, they co-evolve. The cores couple the same way. A
#    swing in plasticity induces EMF in memory, memory induces in language, and
#    the loop closes without any core blocking on another.
# ---------------------------------------------------------------------------

MU_COUPLING = 0.6
"""Permeability of the cognitive medium — how readily cores induce each other."""


@dataclass(frozen=True)
class Induction:
    """EMF induced across a set of coupled fields in one tick."""

    emf: dict[str, float]
    flux: float
    dominant: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "emf": {k: round(v, 4) for k, v in self.emf.items()},
            "flux": round(self.flux, 4),
            "dominant": self.dominant,
        }


def induce(delta: float, dt: float, *, coupling: float = MU_COUPLING) -> float:
    """Faraday's law: EMF = -dΦ/dt.

    The induced electromotive force opposes the change that produced it, which
    is why the sign is negative — a core that swings hard induces a restoring
    pull in its neighbours rather than a runaway amplification.
    """
    step = max(float(dt), 1e-6)
    return -coupling * float(delta) / step


def couple_fields(
    current: dict[str, float],
    previous: dict[str, float],
    *,
    dt: float = 1.0,
    coupling: float = MU_COUPLING,
) -> Induction:
    """Induce EMF between every pair of cores, non-blocking and simultaneous.

    Each field's change induces in *all the others* — never in itself, since a
    field does not induce on its own loop. The result is one synchronous tick:
    no core reads another's post-update value, so there is no ordering to get
    wrong and no core waits its turn.
    """
    deltas = {
        name: float(value) - float(previous.get(name, value))
        for name, value in current.items()
    }
    emf: dict[str, float] = {}
    for target in current:
        induced = sum(
            induce(delta, dt, coupling=coupling)
            for source, delta in deltas.items()
            if source != target
        )
        emf[target] = induced

    flux = sum(abs(d) for d in deltas.values())
    dominant = ""
    if emf:
        dominant = max(emf.items(), key=lambda kv: (abs(kv[1]), kv[0]))[0]
    return Induction(emf=emf, flux=flux, dominant=dominant)


# ---------------------------------------------------------------------------
# 5. Standard Model — the particle content of the theory
#
#    Matter is fermions: half-integer spin, and the Pauli exclusion principle
#    forbids two of them from occupying the same state. Forces are bosons:
#    integer spin, and any number may share a state. Knowledge splits the same
#    way. Facts are fermionic — two identical facts in the same state is a
#    duplicate, and exclusion deletes it. Relations are bosonic — the same
#    relation reinforced a hundred times is a hundred times stronger, not a
#    duplicate.
# ---------------------------------------------------------------------------

FERMION = "fermion"
BOSON = "boson"

_FERMION_TYPES = frozenset(
    {
        "user_message",
        "terminal_error",
        "file_saved",
        "open_folder",
        "shell_command",
        "system_state",
        "task_created",
        "remember",
    }
)

_BOSON_TYPES = frozenset(
    {
        "consolidated_pattern",
        "recall",
        "search_memory",
        "routed_to",
        "similar_to",
        "reinforces",
        "evaluated_as",
        "ping",
    }
)

_NEGATIVE_TYPES = frozenset({"terminal_error", "deadline_failed", "weakens", "failed_after"})
_POSITIVE_TYPES = frozenset(
    {"task_completed", "consolidated_pattern", "reinforces", "completed_after"}
)


@dataclass(frozen=True)
class Quantum:
    """One quantum of knowledge in the Standard Model of the core."""

    kind: str
    name: str
    spin: float
    charge: int
    generation: int
    mass: float
    state: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "name": self.name,
            "spin": self.spin,
            "charge": self.charge,
            "generation": self.generation,
            "mass": round(self.mass, 4),
            "state": self.state,
        }


def quantize(event_type: str, text: str, importance: float) -> Quantum:
    """Classify a piece of knowledge into its quantum numbers.

    Generation mirrors the three families of the Standard Model: generation 1 is
    light and stable (everyday observations), generation 3 is heavy and rare
    (the events that reshape the model). Charge is +1 for knowledge that
    reinforces, -1 for knowledge that contradicts, 0 for neutral observation.
    """
    etype = str(event_type or "").strip() or "unknown"
    mass = clamp(importance)

    if etype in _BOSON_TYPES:
        kind, spin = BOSON, 1.0
    elif etype in _FERMION_TYPES:
        kind, spin = FERMION, 0.5
    else:
        kind, spin = FERMION, 0.5

    if etype in _POSITIVE_TYPES:
        charge = 1
    elif etype in _NEGATIVE_TYPES:
        charge = -1
    else:
        charge = 0

    generation = 3 if mass >= 0.8 else 2 if mass >= 0.5 else 1

    # The state is what makes two quanta indistinguishable: their kind, their
    # type, their charge and their content. Generation is deliberately *not*
    # part of it — generation is read off the importance score, which is a
    # contingent measurement of one observation rather than a property of the
    # fact. Including it would let the same fact recorded twice at different
    # importance count as two facts, which is exactly the double-counting
    # exclusion exists to prevent.
    fingerprint = hashlib.blake2b(
        " ".join(str(text or "").split()).casefold().encode("utf-8"),
        digest_size=8,
    ).hexdigest()
    state = f"{kind}:{etype}:{charge}:{fingerprint}"

    return Quantum(
        kind=kind,
        name=etype,
        spin=spin,
        charge=charge,
        generation=generation,
        mass=mass,
        state=state,
    )


def pauli_exclusion(quanta: Iterable[Quantum]) -> list[Quantum]:
    """Enforce the exclusion principle: no two fermions in one state.

    Bosons pass through untouched — identical relations are meant to pile up in
    the same state, that is what makes a force strong. Fermions collide: of two
    indistinguishable facts only the more massive survives, which deduplicates
    memory without ever consulting a similarity threshold.
    """
    occupied: dict[str, int] = {}
    survivors: list[Quantum] = []
    for quantum in quanta:
        if quantum.kind == BOSON:
            survivors.append(quantum)
            continue
        index = occupied.get(quantum.state)
        if index is None:
            occupied[quantum.state] = len(survivors)
            survivors.append(quantum)
        elif quantum.mass > survivors[index].mass:
            survivors[index] = quantum
    return survivors


# ---------------------------------------------------------------------------
# 6. Yang-Mills — F^a_μν = ∂_μA^a_ν - ∂_νA^a_μ + g f^abc A^b_μ A^c_ν
#
#    The gauge field carries the charge it mediates, so gluons pull on each
#    other. Two consequences matter here. Asymptotic freedom: agents working
#    closely together barely feel the binding at all. Confinement: the further
#    they drift, the harder the field pulls them back, and no single agent can
#    ever be isolated with a net colour charge. A council is stable exactly when
#    its colours sum to a singlet.
# ---------------------------------------------------------------------------

COLOURS = ("red", "green", "blue")

ALPHA_S = 0.3
"""Strong coupling constant of the council field."""

STRING_TENSION = 0.9
"""σ — the linear term that makes separation cost energy without bound."""


@dataclass(frozen=True)
class Binding:
    """The colour state of a council of agents."""

    members: dict[str, str]
    binding_energy: float
    confined: bool
    singlet: bool
    net_colour: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "members": dict(self.members),
            "binding_energy": round(self.binding_energy, 4),
            "confined": self.confined,
            "singlet": self.singlet,
            "net_colour": self.net_colour,
        }


def assign_colours(members: Sequence[str]) -> dict[str, str]:
    """Distribute colour charge across a council.

    Colour is not a property a quark carries in isolation — a baryon is bound
    precisely because its three quarks take one colour *each*. So the assignment
    is made for the council as a whole: members are ordered by a stable hash
    (deterministic, and independent of the order they were passed in) and then
    dealt red/green/blue round-robin. Three members always form a singlet; four
    cannot, and the fourth is what shows up as net colour charge.
    """
    ordered = sorted(members, key=lambda name: (_stable_unit(str(name)), str(name)))
    return {name: COLOURS[i % len(COLOURS)] for i, name in enumerate(ordered)}


def colour_of(name: str) -> str:
    """Colour charge of a single agent considered alone."""
    return COLOURS[int(_stable_unit(str(name)) * len(COLOURS)) % len(COLOURS)]


def potential(separation: float, *, alpha_s: float = ALPHA_S, sigma: float = STRING_TENSION) -> float:
    """Cornell potential V(r) = -4α_s/(3r) + σr.

    Coulomb-like attraction at short range, linear confinement at long range.
    The linear term is why the energy keeps climbing as agents diverge: pulling
    a member out of the council costs more the further it goes, so the field
    itself makes fragmentation expensive.
    """
    r = max(float(separation), 0.05)
    return -(4.0 * alpha_s) / (3.0 * r) + sigma * r


def bind(members: Sequence[str], separations: dict[str, float] | None = None) -> Binding:
    """Bind a council and report whether it is colour-confined.

    A council is a singlet — colour-neutral, and therefore observable as a
    single object — when all three colours are represented. A council missing a
    colour carries net charge, which confinement forbids from existing free: in
    practice that is the signal the council is incomplete and its verdict should
    not be treated as final.
    """
    names = [str(m) for m in members if str(m).strip()]
    if not names:
        return Binding({}, 0.0, False, False, "")

    assigned = assign_colours(names)
    gaps = separations or {}
    energy = sum(potential(gaps.get(name, 1.0)) for name in names) / len(names)

    counts_all = [sum(1 for c in assigned.values() if c == colour) for colour in COLOURS]
    # Colour-neutral means balanced, not merely present: three of one colour is
    # not a singlet, and neither is red-red-green-blue.
    singlet = len(names) >= len(COLOURS) and max(counts_all) == min(counts_all)
    counts = {colour: sum(1 for c in assigned.values() if c == colour) for colour in COLOURS}
    net_colour = "" if singlet else max(counts.items(), key=lambda kv: (kv[1], kv[0]))[0]

    return Binding(
        members=assigned,
        binding_energy=energy,
        confined=energy > 0.0,
        singlet=singlet,
        net_colour=net_colour,
    )


# ---------------------------------------------------------------------------
# 7. Friedmann equations — (ȧ/a)² = 8πGρ/3 - k/a² + Λ/3
#
#    The universe expands, and what expansion does to matter is dilute it. Λ is
#    the term that keeps expanding space even after matter has thinned out. In
#    memory the same term is the pressure that clears out what stopped earning
#    its place: as the store fills, the Hubble rate climbs and the survival
#    threshold rises with it.
# ---------------------------------------------------------------------------

LAMBDA = 0.35
"""Cosmological constant — the standing pressure toward forgetting."""

CURVATURE_K = 0.1
"""Spatial curvature; a mild positive k resists expansion while memory is sparse."""

SCALE_FLOOR = 0.05
"""Smallest scale factor. ρ ∝ a⁻³ is genuinely divergent at a → 0, so the store
never reports itself as being at the Big Bang."""


@dataclass(frozen=True)
class Cosmology:
    """The expansion state of memory space."""

    scale_factor: float
    density: float
    hubble: float
    expanding: bool
    prune_below: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "scale_factor": round(self.scale_factor, 4),
            "density": round(self.density, 4),
            "hubble": round(self.hubble, 4),
            "expanding": self.expanding,
            "prune_below": round(self.prune_below, 4),
        }


def friedmann(
    count: int,
    capacity: int,
    mean_importance: float,
    *,
    lam: float = LAMBDA,
    k: float = CURVATURE_K,
) -> Cosmology:
    """Solve for the expansion rate of memory space and the pruning threshold.

    ``scale_factor`` is how full the store is. Matter density falls as ρ ∝ ρ₀/a³
    exactly as it does cosmologically, so a nearly-empty store is dominated by
    its contents and a full one is dominated by Λ. The moment Λ wins, expansion
    accelerates and ``prune_below`` rises — memory starts actively forgetting
    rather than merely aging.
    """
    capacity = max(int(capacity), 1)
    if count <= 0:
        # An empty store is not a universe. Reporting curvature-driven collapse
        # for a database with nothing in it would be noise, not physics.
        return Cosmology(0.0, 0.0, 0.0, False, 0.0)

    scale = max(float(count) / capacity, SCALE_FLOOR)
    # Matter dilutes as ρ ∝ ρ₀/a³ — exactly as it does cosmologically. A sparse
    # store is therefore matter-dominated and keeps everything it is given.
    density = clamp(mean_importance) / (scale**3)

    # Units are chosen with G ≡ 3/8π, which turns the Friedmann equation into
    # H² = ρ - k/a² + Λ/3. Without it the 8π swamps Λ by an order of magnitude
    # and dark energy could never take over, whatever its value.
    h_squared = density - k / (scale**2) + lam / 3.0
    hubble = math.sqrt(h_squared) if h_squared > 0.0 else -math.sqrt(-h_squared)

    # Λ only takes over once matter has thinned; below that nothing is pruned.
    lambda_fraction = (lam / 3.0) / max(density + lam / 3.0, 1e-9)
    prune_below = clamp(lambda_fraction * clamp(scale) * 0.9)

    return Cosmology(
        scale_factor=scale,
        density=density,
        hubble=hubble,
        expanding=hubble > 0.0,
        prune_below=prune_below,
    )


# ---------------------------------------------------------------------------
# 8. Bekenstein-Hawking — S = kc³A / (4Għ)
#
#    A black hole's entropy scales with its *surface*, not its volume. That is
#    the holographic principle: everything a region contains is encoded on its
#    boundary. So a search does not have to walk the bulk. Reading the boundary
#    — an area, √N wide rather than N — recovers the same information, turning
#    an O(V) scan into an O(A) one.
# ---------------------------------------------------------------------------

MIN_HORIZON = 16
"""Smallest useful boundary; below this the bulk is cheaper than the ceremony."""

AREA_CONSTANT = 4.0
"""Boundary width per √item — the '4' of S = A/4, reused as a sampling factor."""


def horizon_area(items: int, *, minimum: int = MIN_HORIZON) -> int:
    """The boundary area of a region holding ``items`` — the O(A) scan budget.

    A = 4√N. For 400 synapses the boundary is 80; for 40,000 it is 800. The scan
    stays sublinear in the bulk while still widening as the store grows, so
    recall quality does not silently degrade the way a fixed LIMIT does.
    """
    n = max(int(items), 0)
    if n <= minimum:
        return n
    return max(minimum, math.ceil(AREA_CONSTANT * math.sqrt(n)))


def bekenstein_entropy(area: float) -> float:
    """S = A/4 — the information capacity of a boundary of this area."""
    return max(0.0, float(area)) / 4.0


def hawking_temperature(mass: float) -> float:
    """T = 1/(8πM) — light black holes are hot and evaporate fast.

    A weak synapse radiates away quickly; a heavy one is cold and effectively
    permanent. This is the evaporation rate consolidation uses to decide what
    disappears on its own without anything having to delete it.
    """
    m = max(clamp(mass), 1e-3)
    return 1.0 / (8.0 * math.pi * m)


# ---------------------------------------------------------------------------
# 9. Feynman path integral — ⟨f|i⟩ = ∫ 𝒟x e^(iS[x]/ħ)
#
#    A particle does not take a path; it takes every path, and the amplitudes
#    interfere. What survives the interference is the path of stationary action,
#    which is precisely the classical trajectory. A plan is built the same way:
#    score every ordering, weight it by e^(-S/ħ), and let the least-action
#    ordering emerge instead of being asserted.
# ---------------------------------------------------------------------------

HBAR = 0.35
"""Cognitive ħ. Large ħ → many orderings interfere (exploration). Small ħ →
the classical path dominates completely (exploitation)."""


@dataclass(frozen=True)
class PathIntegral:
    """The weighted sum over histories for one decision."""

    paths: list[dict[str, Any]]
    classical: Any
    stationary_action: float
    dominance: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "paths": self.paths,
            "classical": self.classical,
            "stationary_action": round(self.stationary_action, 4),
            "dominance": round(self.dominance, 4),
        }


def path_integral(
    paths: Sequence[Any],
    actions: Sequence[float],
    *,
    hbar: float = HBAR,
    keep: int = 5,
) -> PathIntegral:
    """Sum over histories and return the stationary-action path.

    Evolution runs in imaginary time, so the oscillatory e^(iS/ħ) becomes a real
    Boltzmann-like e^(-S/ħ). That keeps the arithmetic real and stable while
    preserving the property that matters: the least-action path dominates, and
    near-degenerate alternatives keep meaningful weight instead of being
    discarded by an argmin.

    ``dominance`` is the winning path's share of total amplitude — near 1 the
    plan is forced, near 1/N the orderings are genuinely interchangeable.
    """
    if not paths or len(paths) != len(actions):
        return PathIntegral([], None, 0.0, 0.0)

    h = max(float(hbar), 1e-6)
    minimum = min(float(a) for a in actions)
    # Subtracting the minimum action is a gauge choice: it leaves every relative
    # weight untouched and keeps exp() away from underflow.
    weights = [math.exp(-(float(a) - minimum) / h) for a in actions]
    total = sum(weights) or 1.0

    scored = [
        {"path": path, "action": round(float(action), 4), "weight": round(weight / total, 4)}
        for path, action, weight in zip(paths, actions, weights)
    ]
    scored.sort(key=lambda item: (-item["weight"], item["action"]))

    return PathIntegral(
        paths=scored[:keep],
        classical=scored[0]["path"],
        stationary_action=minimum,
        dominance=scored[0]["weight"],
    )


# ---------------------------------------------------------------------------
# 10. Navier-Stokes — ρ(∂v/∂t + v·∇v) = -∇p + μ∇²v + f
#
#     Viscosity is what keeps a flow laminar. Below a critical Reynolds number
#     the momentum equation damps perturbations and the stream stays smooth;
#     above it, inertia wins and the flow breaks into turbulence. A HUD driven
#     directly by raw core telemetry is a turbulent flow. Running the telemetry
#     through the momentum equation first gives the viscosity back.
# ---------------------------------------------------------------------------

VISCOSITY = 0.45
"""μ — resistance to sudden change in the display stream."""

DENSITY = 1.0
"""ρ — inertia of the stream; heavier streams respond more slowly."""

CRITICAL_REYNOLDS = 2300.0
"""The laminar→turbulent transition, as in pipe flow."""


@dataclass(frozen=True)
class Flow:
    """One integration step of the display stream."""

    velocity: float
    acceleration: float
    reynolds: float
    regime: str
    turbulent: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "velocity": round(self.velocity, 4),
            "acceleration": round(self.acceleration, 4),
            "reynolds": round(self.reynolds, 2),
            "regime": self.regime,
            "turbulent": self.turbulent,
        }


def reynolds(velocity: float, length: float, *, viscosity: float = VISCOSITY) -> float:
    """Re = vL/ν — the ratio of inertial to viscous forces."""
    nu = max(float(viscosity), 1e-6)
    return abs(float(velocity)) * max(float(length), 0.0) / nu


def flow_step(
    velocity: float,
    target: float,
    *,
    dt: float = 1.0,
    viscosity: float = VISCOSITY,
    density: float = DENSITY,
    length: float = 1.0,
) -> Flow:
    """Advance the stream one step under the momentum equation.

    A HUD channel has no spatial extent, so this is the Stokes limit: viscosity
    dominates inertia, the v·∇v term drops out, and velocity relaxes toward the
    pressure-driven value at a rate the viscosity sets. The pressure gradient
    -∇p is the gap between where the stream is and where the core says it
    should be; μ sets how fast the stream is allowed to close that gap.

    Writing the viscous term as a relaxation rate rather than a drag matters:
    a drag term (-μv) would pull toward zero and settle the stream at
    ``target/(1+μ)``, so a thick channel would read permanently low. Here the
    steady state is the target exactly, for every viscosity — μ changes only
    how long it takes to get there, which is the one thing it should change.
    """
    rho = max(float(density), 1e-6)
    nu = max(float(viscosity), 1e-6)
    step = max(float(dt), 1e-6)

    pressure_gradient = float(target) - float(velocity)
    relaxation = 1.0 / (1.0 + nu)
    acceleration = (pressure_gradient * relaxation) / rho

    new_velocity = float(velocity) + acceleration * step
    re = reynolds(new_velocity, length, viscosity=nu)
    turbulent = re > CRITICAL_REYNOLDS

    return Flow(
        velocity=new_velocity,
        acceleration=acceleration,
        reynolds=re,
        regime="turbulent" if turbulent else "laminar",
        turbulent=turbulent,
    )
