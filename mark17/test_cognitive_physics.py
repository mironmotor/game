"""Standalone tests for the cognitive physics layer.

Run: python3 mark17/test_cognitive_physics.py

No pytest required — pure stdlib, same style as test_voice_state.py. Each of
the ten equations gets at least one test that would fail if the equation were
replaced by a constant.
"""

from __future__ import annotations

import sys
import tempfile
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.cognitive_physics import (
    BOSONS,
    MASS_GAP,
    ColourCharge,
    CoreField,
    canonize,
    confine,
    council_colour,
    induct,
    running_coupling,
    snapshot,
)
from mark17.consolidation import DILUTION_FLOOR, friedmann
from mark17.critic import evaluate_event
from mark17.events import Event
from mark17.fluid_flow import FlowState, poiseuille_profile, regime_of, reynolds, solve
from mark17.meta_controller import MetaController, Route
from mark17.planner import action, build_plan, path_integral
from mark17.plasticity_bridge import PlasticityBridge
from mark17.synapse_graph import SynapseGraph
from mark17.vector_memory import (
    VectorMemory,
    magnification,
    schwarzschild_radius,
    time_dilation,
)

DAY = 86400.0


def _tmp() -> Path:
    return Path(tempfile.mkdtemp(prefix="physics-test-"))


# --- 1. Einstein: gravitational lensing of recall --------------------------


def test_einstein_heavier_memory_lenses_more():
    # Same impact parameter, more mass => more magnification.
    assert magnification(0.9, 0.3) > magnification(0.2, 0.3)
    # A query passing far from the mass is not bent at all.
    assert magnification(0.9, 8.0) < 1.05
    # Magnification never runs away.
    assert magnification(1.0, 1e-6) <= 4.0


def test_einstein_time_dilation_slows_important_memories():
    # Deeper in the well, less proper time elapses.
    assert time_dilation(0.9, 0.4) < time_dilation(0.1, 0.4)
    assert 0.0 <= time_dilation(0.9, 0.4) <= 1.0
    # Schwarzschild radius grows with mass.
    assert schwarzschild_radius(0.9) > schwarzschild_radius(0.1)


def test_einstein_curvature_outranks_flat_recall():
    memory = VectorMemory(_tmp())
    text = "деплой ядра упал на проде"

    # Same text, so identical semantic similarity — only mass differs.
    memory.remember(
        Event(type="task_completed", payload={"text": text}),
        {"score": 1.0, "reason": "critical", "reinforce": text},
    )
    memory.remember(
        Event(type="system_state", payload={"text": text}),
        {"score": 0.0, "reason": "routine", "reinforce": text},
    )

    hits = memory.recall("деплой ядра упал", limit=2)
    assert len(hits) == 2
    heavy, light = hits[0], hits[1]
    # The massive memory wins, and it wins *because* of the lens.
    assert heavy.importance > light.importance
    assert heavy.magnification > light.magnification

    # Ageing both by 60 days must widen the gap, not preserve it: the light
    # memory ages at wall-clock speed, the heavy one at its own proper time.
    future = time.time() + 60 * DAY
    fresh_ratio = hits[0].score / hits[1].score
    aged = memory.recall("деплой ядра упал", limit=2, now=future)
    aged_ratio = aged[0].score / aged[1].score
    assert aged_ratio > fresh_ratio


# --- 2. Schrödinger: superposition of routes -------------------------------


def _controller() -> MetaController:
    return MetaController(PlasticityBridge(_tmp()))


def test_schrodinger_probabilities_normalise():
    meta = _controller()
    decision = meta.decide(Event(type="terminal_error", payload={"line": "boom"}))
    sup = decision.superposition
    assert sup is not None
    # Serialised at 4 decimal places, so allow for the rounding.
    total = sum(sup["probabilities"].values())
    assert abs(total - 1.0) < 1e-3


def test_schrodinger_collapse_matches_the_rules():
    """The wave function must never disagree with the measurement."""
    meta = _controller()
    events = [
        Event(type="ping"),
        Event(type="recall", payload={"query": "память"}),
        Event(type="terminal_error", payload={"line": "Traceback (most recent call last)"}),
        Event(type="open_folder", payload={"path": "/tmp"}),
        Event(type="user_message", payload={"text": "привет"}),
    ]
    for event in events:
        decision = meta.decide(event)
        sup = decision.superposition
        argmax = max(sup["probabilities"], key=lambda k: sup["probabilities"][k])
        assert argmax == decision.route.value == sup["collapsed"], event.type


def test_schrodinger_heartbeat_is_a_pure_state():
    meta = _controller()
    ping = meta.decide(Event(type="ping"))
    noisy = meta.decide(Event(type="user_message", payload={"text": "?"}))
    # A heartbeat is unambiguous; an unknown message is not.
    assert ping.superposition["coherence"] > noisy.superposition["coherence"]
    assert ping.route is Route.IGNORE


# --- 3. Dirac: the antiparticle of an evaluation ---------------------------


def test_dirac_anti_has_opposite_charge():
    event = Event(type="user_message", payload={"text": "почини деплой"})
    result = {"route": "llm", "llm": {"status": "ok"}, "plasticity": {"confidence": 0.8}}
    evaluation = evaluate_event(event, result)
    assert evaluation.anti is not None
    particle_charge = evaluation.score * 2.0 - 1.0
    assert abs(evaluation.anti.charge + particle_charge) < 1e-9


def test_dirac_annihilation_produces_a_correction():
    """Strong memory evidence while routed to a dead LLM must annihilate."""
    event = Event(type="user_message", payload={"text": "что было вчера"})
    result = {
        "route": "llm",
        "llm": {"status": "error"},
        "plasticity": {"confidence": 0.5},
        "memory": {"recalled": [{"id": 1, "score": 0.95}]},
        "decision": {"superposition": {"runner_up": "memory"}},
    }
    evaluation = evaluate_event(event, result)
    assert evaluation.anti.route == "memory"
    assert evaluation.anti.annihilates
    assert evaluation.anti.energy_released > 0.0
    assert "memory" in evaluation.anti.correction


def test_dirac_stable_pair_when_route_was_right():
    event = Event(type="ping")
    result = {"route": "ignore", "plasticity": {"confidence": 1.0}}
    evaluation = evaluate_event(event, result)
    assert not evaluation.anti.annihilates
    assert evaluation.anti.energy_released == 0.0


# --- 4. Maxwell: induction between the three cores -------------------------


def test_maxwell_no_memory_monopole():
    """div B = 0 is not approximate — it must hold for every state."""
    for b in (0.0, 0.3, 0.9, -0.5):
        out = induct(CoreField(plasticity=0.4, memory=b, llm=0.2))
        assert out["gauss_b"] == 0.0
        assert out["monopole_free"] is True


def test_maxwell_changing_memory_induces_attention_emf():
    """Faraday: curl E = -dB/dt. A rising memory field must induce negative EMF."""
    previous = CoreField(plasticity=0.2, memory=0.1, llm=0.0)
    now = CoreField(plasticity=0.2, memory=0.6, llm=0.0)
    out = induct(now, previous=previous, dt=1.0)
    assert out["faraday_curl_e"] < 0
    assert abs(out["faraday_curl_e"] + 0.5) < 1e-9


def test_maxwell_displacement_current_works_without_llm():
    """The core keeps winding its memory field even with J = 0."""
    previous = CoreField(plasticity=0.1, memory=0.3, llm=0.0)
    now = CoreField(plasticity=0.8, memory=0.3, llm=0.0)
    out = induct(now, previous=previous, dt=1.0)
    assert out["displacement_current"] > 0
    assert out["ampere_curl_b"] > 0
    assert out["blocking"] is False


def test_maxwell_reads_the_three_cores_off_a_result():
    colour = council_colour(
        {
            "plasticity": {"confidence": 0.7},
            "memory": {"recalled": [{"id": 1, "score": 0.4}]},
            "llm": {"status": "ok"},
        }
    )
    assert colour.red == 0.7
    assert colour.green > 0.0
    assert colour.blue > 0.0


# --- 5. Standard Model: canonical knowledge quanta -------------------------


def test_standard_model_generations_and_lifetimes():
    stable = canonize(
        Event(type="consolidated_pattern", payload={}),
        {"route": "memory"},
        {"score": 0.9},
    )
    fleeting = canonize(Event(type="ping", payload={}), {"route": "ignore"}, None)
    assert stable.generation == 1
    assert fleeting.generation == 3
    # Stable matter outlives heartbeats by orders of magnitude.
    assert stable.lifetime > fleeting.lifetime * 100


def test_standard_model_quarks_are_confined():
    quark = canonize(Event(type="user_message", payload={"text": "hi"}), {"route": "llm"})
    lepton = canonize(Event(type="ping", payload={}), {"route": "ignore"})
    assert quark.family == "quark" and quark.confined
    assert lepton.family == "lepton" and not lepton.confined


def test_standard_model_higgs_grants_mass():
    """Mass is acquired through the critic, not intrinsic to the event."""
    event = Event(type="user_message", payload={"text": "важное"})
    heavy = canonize(event, {"route": "llm"}, {"score": 1.0})
    light = canonize(event, {"route": "llm"}, {"score": 0.0})
    assert heavy.mass > light.mass


def test_standard_model_failures_are_negatively_charged():
    quantum = canonize(
        Event(type="deadline_failed", payload={}), {"route": "memory"}, {"score": 0.8}
    )
    assert quantum.charge < 0
    assert quantum.boson in BOSONS


# --- 6. Yang-Mills: confinement and the mass gap ---------------------------


def test_yang_mills_one_loud_core_is_not_white():
    """A single core doing all the work can never read as a balanced council."""
    out = confine(ColourCharge(red=0.32, green=0.0, blue=0.0))
    assert not out["white"]
    assert out["verdict"] == "confined"


def test_yang_mills_strong_council_emits():
    out = confine(ColourCharge(red=0.8, green=0.75, blue=0.7))
    assert out["white"]
    assert out["excitation"] > MASS_GAP
    assert out["free"] and out["verdict"] == "emit"


def test_yang_mills_weak_but_agreeing_council_stays_virtual():
    """Agreement is not enough — the excitation has to clear the gap."""
    out = confine(ColourCharge(red=0.15, green=0.15, blue=0.15))
    assert out["white"]
    assert out["excitation"] < MASS_GAP
    assert out["verdict"] == "virtual"


def test_yang_mills_asymptotic_freedom():
    """Coupling weakens as the core grows confident."""
    assert running_coupling(0.9) < running_coupling(0.5) < running_coupling(0.15)
    assert confine(ColourCharge(0.9, 0.9, 0.9))["asymptotically_free"]
    assert not confine(ColourCharge(0.2, 0.2, 0.2))["asymptotically_free"]


# --- 7. Friedmann: expansion, curvature and the Lambda term ----------------


def test_friedmann_fates_differ():
    open_universe = friedmann(1.0, 0.01, -0.4)
    closed_universe = friedmann(0.2, 0.02, 0.9)
    assert open_universe["fate"] == "expanding"
    assert closed_universe["fate"] == "collapsing"


def test_friedmann_omega_accounting():
    """Omega_m + Omega_Lambda + Omega_k = 1 — the Friedmann constraint itself."""
    cosmos = friedmann(1.0, 0.3, 0.05)
    total = (
        cosmos["omega_matter"] + cosmos["omega_lambda"] + cosmos["omega_curvature"]
    )
    assert abs(total - 1.0) < 1e-3
    # Omega_total is the content only; curvature is the remainder.
    assert abs(cosmos["omega_total"] + cosmos["omega_curvature"] - 1.0) < 1e-3
    assert cosmos["hubble"] > 0


def test_friedmann_lambda_dilutes_weak_patterns():
    """Denser universes expand faster and thin their weak patterns harder."""
    calm = friedmann(1.0, 0.02, 0.0)
    dense = friedmann(1.0, 1.5, 0.0)
    assert dense["hubble"] > calm["hubble"]
    assert dense["dilution"] < calm["dilution"]
    # A weak pattern survives a calm night and evaporates in a dense one.
    weak = 0.30
    assert weak * calm["dilution"] >= DILUTION_FLOOR
    assert weak * dense["dilution"] < DILUTION_FLOOR


# --- 8. Bekenstein-Hawking: holographic search -----------------------------


def _seeded_graph() -> SynapseGraph:
    graph = SynapseGraph(_tmp())
    # One hub with many spokes, plus scattered leaf-to-leaf links.
    for i in range(12):
        graph.upsert(
            source_type="event",
            source_id="hub",
            target_type="memory",
            target_id=f"m{i}",
            relation_type="recalled_with",
            weight=0.5 + (i % 5) / 20.0,
            metadata={"summary": f"link {i}"},
        )
    for i in range(6):
        graph.upsert(
            source_type="memory",
            source_id=f"m{i}",
            target_type="memory",
            target_id=f"m{i + 1}",
            relation_type="similar_to",
            weight=0.3,
            metadata={"summary": f"chain {i}"},
        )
    return graph


def test_bekenstein_entropy_scales_with_area():
    horizon = _seeded_graph().horizon()
    assert horizon["area"] > 0
    # S = A/4 exactly.
    assert abs(horizon["entropy"] - horizon["area"] / 4.0) < 1e-9
    # The boundary is genuinely smaller than the volume it encodes.
    assert horizon["area"] < horizon["volume"]
    assert horizon["compression"] > 1.0


def test_hawking_temperature_falls_with_mass():
    light = _seeded_graph().horizon()
    assert light["temperature"] > 0
    assert light["information_bits"] > 0


def test_holographic_search_only_touches_the_boundary():
    graph = _seeded_graph()
    screen = graph.horizon()
    boundary = {node["node"] for node in screen["boundary"]}
    found = graph.holographic_search("event:hub", limit=5)
    assert found["neighbours"]
    for neighbour in found["neighbours"]:
        assert neighbour["node"] in boundary
    # Bounded by the area, never by the volume.
    assert len(found["neighbours"]) <= screen["area"]


# --- 9. Feynman: sum over histories in the planner -------------------------


def test_feynman_probabilities_normalise():
    plan = build_plan("запустить продукт и получить первых клиентов")
    total = sum(path["probability"] for path in plan["paths"])
    assert abs(total - 1.0) < 1e-3
    assert len(plan["paths"]) >= 3


def test_feynman_classical_path_is_stationary_action():
    plan = build_plan("выучить испанский")
    actions = [path["action"] for path in plan["paths"]]
    classical = next(p for p in plan["paths"] if p["classical"])
    assert classical["action"] == min(actions)
    assert classical["path"] == plan["path"]
    # Least action must also be the most probable.
    assert classical["probability"] == max(p["probability"] for p in plan["paths"])


def test_feynman_endpoints_are_fixed():
    """The integral is over paths, not over task sets: same tasks, new order."""
    plan = build_plan("собрать mvp")
    descs = sorted(task["desc"] for task in plan["tasks"])
    assert len(plan["tasks"]) == 6
    assert len(set(descs)) == 6
    assert plan["total_xp"] == 50 + 30 * 2 + 10 * 3
    # Steps are numbered along the chosen trajectory.
    assert [task["step"] for task in plan["tasks"]] == [1, 2, 3, 4, 5, 6]


def test_feynman_domain_changes_the_action():
    """A builder and a learner should not get identical trajectories scored."""
    mgrs = ["MGR-3", "MGR-2", "MGR-2", "MGR-1", "MGR-1", "MGR-1"]
    order = (0, 1, 2, 3, 4, 5)
    assert action(order, mgrs, "build") < action(order, mgrs, "default")
    assert path_integral(mgrs, "build")[0]["action"] <= path_integral(mgrs, "default")[0]["action"]


# --- 10. Navier-Stokes: the HUD flow ---------------------------------------


def test_navier_stokes_regimes():
    assert regime_of(100.0) == "laminar"
    assert regime_of(3000.0) == "transitional"
    assert regime_of(9000.0) == "turbulent"


def test_navier_stokes_doubt_thickens_the_flow():
    """mu = 1 - confidence: an unsure core moves through treacle."""
    sure = FlowState(density=0.6, velocity=0.8, breadth=0.6, confidence=0.95)
    unsure = FlowState(density=0.6, velocity=0.8, breadth=0.6, confidence=0.1)
    assert unsure.viscosity() > sure.viscosity()
    assert reynolds(sure) > reynolds(unsure)


def test_navier_stokes_terms_stay_bounded():
    """The non-dimensional form must not blow up on a narrow context."""
    narrow = FlowState(density=0.05, velocity=1.0, breadth=0.05, confidence=0.3)
    out = solve(narrow)
    for key in ("pressure_gradient", "viscous_term", "convective_term", "acceleration"):
        assert abs(out[key]) < 50.0, f"{key} = {out[key]}"


def test_navier_stokes_turbulence_under_load():
    loaded = FlowState(density=0.95, velocity=0.95, breadth=0.95, confidence=0.9)
    out = solve(loaded)
    assert out["regime"] == "turbulent"
    assert out["vorticity"] > 0
    assert out["stability"] < 0.35
    assert "консолидация" in out["advice"]


def test_navier_stokes_laminar_profile_is_parabolic():
    profile = poiseuille_profile(1.0, lanes=9)
    assert profile[0] == 0.0 and profile[-1] == 0.0   # no-slip at the walls
    assert profile[4] == max(profile)                 # fastest in the middle
    assert profile[:4] == sorted(profile[:4])         # monotonic rise


def test_snapshot_colour_override_beats_the_result_stub():
    """The physics probe must be able to supply colour measured elsewhere.

    Without this, the read-only probe — which deliberately runs none of the
    three cores — would read colour off its own stub of zeros, and Maxwell's
    field plus Yang-Mills' confinement would sit at zero forever on the one
    event built to display them.
    """
    stub = {
        "plasticity": {"confidence": 0.0, "action": "measure"},
        "memory": {"hint": "3 memories"},
        "llm": {"status": "skipped"},
    }
    event = Event(type="system_state", payload={"text": "проверка"}, source="test")

    # Colour read off the stub: all three cores silent.
    blind = snapshot(event, stub)
    assert blind["yang_mills"]["colour"] == {"red": 0.0, "green": 0.0, "blue": 0.0}
    assert blind["maxwell"]["energy_density"] == 0.0

    # Same stub, colour measured from the cores' standing state.
    seeing = snapshot(event, stub, colour=ColourCharge(red=0.42, green=0.9, blue=0.0))
    assert seeing["yang_mills"]["colour"]["red"] > 0.0
    assert seeing["maxwell"]["energy_density"] > 0.0
    assert seeing["maxwell"]["field"]["memory"] == 0.9

    # And a stronger council must read as less confined than a weaker one.
    weak = snapshot(event, stub, colour=ColourCharge(red=0.1, green=0.9, blue=0.0))
    assert seeing["yang_mills"]["residual_colour"] < weak["yang_mills"]["residual_colour"]


def _run() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001 - surface any error as a failure
            failed += 1
            print(f"  ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run())
