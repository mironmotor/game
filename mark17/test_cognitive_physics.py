"""Standalone tests for cognitive physics (run: python3 mark17/test_cognitive_physics.py).

No pytest required — pure stdlib, same convention as test_voice_state.py.
Covers the physics kernel itself and the five live modules it was wired into.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.cognitive_physics import (
    BOSON,
    COLOURS,
    FERMION,
    annihilate,
    bekenstein_entropy,
    bind,
    conjugate,
    couple_fields,
    evolve,
    flow_step,
    friedmann,
    hawking_temperature,
    horizon_area,
    lens,
    path_integral,
    pauli_exclusion,
    quantize,
    reynolds,
    superpose,
    time_dilation,
)
from mark17.critic import evaluate_event
from mark17.events import Event
from mark17.fluid_flow import FluidHud
from mark17.planner import action, build_plan
from mark17.vector_memory import VectorMemory


# --- 1. Einstein -----------------------------------------------------------

def test_mass_bends_recall_toward_it():
    heavy = lens(0.5, 1.0)
    light = lens(0.5, 0.05)
    assert heavy > light, "mass must curve the metric"
    assert heavy <= 1.0, "lensing must stay inside the unit interval"


def test_lensing_cannot_manufacture_relevance():
    # Zero similarity is zero regardless of mass: curvature amplifies a real
    # relationship, it does not create one.
    assert lens(0.0, 1.0) == 0.0


def test_lensing_is_monotonic_in_similarity():
    values = [lens(s / 10.0, 0.6) for s in range(11)]
    assert values == sorted(values)


def test_heavy_memories_age_slower():
    assert time_dilation(1.0) < time_dilation(0.5) < time_dilation(0.0)
    assert time_dilation(0.0) == 1.0


# --- 2. Schrödinger --------------------------------------------------------

def test_born_rule_normalises():
    state = superpose({"a": 3.0, "b": 1.0})
    assert abs(sum(state.probabilities.values()) - 1.0) < 1e-9
    assert abs(state.probabilities["a"] - 0.75) < 1e-9
    assert state.collapsed == "a"


def test_coherence_is_zero_when_certain_and_one_when_uniform():
    assert superpose({"a": 1.0, "b": 0.0}).coherence == 0.0
    assert abs(superpose({"a": 1.0, "b": 1.0}).coherence - 1.0) < 1e-9


def test_evolution_favours_negative_energy():
    state = superpose({"a": 1.0, "b": 1.0})
    evolved = evolve(state, {"b": -2.0})
    assert evolved.collapsed == "b"
    assert evolved.probabilities["b"] > state.probabilities["b"]


def test_empty_state_is_safe():
    state = superpose({})
    assert state.collapsed == ""
    assert evolve(state, {"a": -1.0}).collapsed == ""


# --- 3. Dirac --------------------------------------------------------------

def test_exact_conjugate_annihilates_to_the_original_score():
    # The key property: with no real counter-evidence the layer is a no-op.
    for score in (0.1, 0.35, 0.5, 0.82, 1.0):
        pair = annihilate(score, conjugate(score))
        assert abs(pair.net - score) < 1e-9, f"{score} -> {pair.net}"


def test_extra_counter_evidence_lowers_the_net():
    plain = annihilate(0.8, conjugate(0.8))
    countered = annihilate(0.8, conjugate(0.8) + 0.3)
    assert countered.net < plain.net


def test_balanced_evidence_is_flagged_uncertain():
    assert annihilate(0.5, 0.5).uncertain
    assert not annihilate(0.9, 0.1).uncertain


# --- 4. Maxwell ------------------------------------------------------------

def test_induction_opposes_the_change():
    induction = couple_fields({"a": 1.0, "b": 0.0}, {"a": 0.0, "b": 0.0})
    # a rose, so the EMF it induces in b opposes that rise.
    assert induction.emf["b"] < 0.0
    assert induction.dominant == "b"


def test_a_field_does_not_induce_on_itself():
    induction = couple_fields({"a": 1.0, "b": 0.0}, {"a": 0.0, "b": 0.0})
    assert induction.emf["a"] == 0.0


def test_steady_fields_induce_nothing():
    induction = couple_fields({"a": 0.5, "b": 0.5}, {"a": 0.5, "b": 0.5})
    assert all(abs(v) < 1e-9 for v in induction.emf.values())
    assert induction.flux == 0.0


# --- 5. Standard Model -----------------------------------------------------

def test_facts_are_fermions_and_relations_are_bosons():
    assert quantize("user_message", "hello", 0.5).kind == FERMION
    assert quantize("consolidated_pattern", "x", 0.5).kind == BOSON


def test_generation_tracks_mass():
    assert quantize("user_message", "a", 0.9).generation == 3
    assert quantize("user_message", "a", 0.6).generation == 2
    assert quantize("user_message", "a", 0.2).generation == 1


def test_exclusion_deduplicates_fermions_keeping_the_heaviest():
    quanta = [
        quantize("user_message", "same text", 0.3),
        quantize("user_message", "same text", 0.9),
        quantize("user_message", "other text", 0.4),
    ]
    survivors = pauli_exclusion(quanta)
    assert len(survivors) == 2
    assert max(q.mass for q in survivors) == 0.9


def test_bosons_are_allowed_to_share_a_state():
    quanta = [quantize("consolidated_pattern", "same", 0.5) for _ in range(4)]
    assert len(pauli_exclusion(quanta)) == 4


# --- 6. Yang-Mills ---------------------------------------------------------

def test_three_members_form_a_singlet():
    binding = bind(["plasticity", "memory", "llm"])
    assert binding.singlet
    assert set(binding.members.values()) == set(COLOURS)


def test_a_fourth_member_breaks_neutrality():
    binding = bind(["a", "b", "c", "d"])
    assert not binding.singlet
    assert binding.net_colour in COLOURS


def test_separation_costs_energy_without_bound():
    close = bind(["a", "b", "c"], {"a": 0.3, "b": 0.3, "c": 0.3})
    far = bind(["a", "b", "c"], {"a": 4.0, "b": 4.0, "c": 4.0})
    assert far.binding_energy > close.binding_energy
    assert far.confined, "confinement must grow with separation"


# --- 7. Friedmann ----------------------------------------------------------

def test_sparse_memory_keeps_everything():
    assert friedmann(10, 2000, 0.6).prune_below < 0.01


def test_pruning_threshold_rises_as_memory_fills():
    thresholds = [friedmann(n, 2000, 0.3).prune_below for n in (100, 800, 1500, 2000)]
    assert thresholds == sorted(thresholds)
    assert thresholds[-1] > thresholds[0]


def test_high_quality_memory_resists_dilution():
    good = friedmann(1900, 2000, 0.8).prune_below
    poor = friedmann(1900, 2000, 0.1).prune_below
    assert good < poor, "dense matter should hold off Λ"


# --- 8. Bekenstein-Hawking -------------------------------------------------

def test_horizon_is_sublinear_in_the_bulk():
    assert horizon_area(40000) < 40000 / 10
    assert horizon_area(400) == 80
    # Small stores are not worth the ceremony — scan the bulk.
    assert horizon_area(10) == 10


def test_horizon_still_grows_with_the_bulk():
    areas = [horizon_area(n) for n in (100, 1000, 10000, 100000)]
    assert areas == sorted(areas)
    assert len(set(areas)) == len(areas), "a fixed LIMIT would flatten here"


def test_entropy_is_a_quarter_of_area():
    assert bekenstein_entropy(80) == 20.0


def test_light_synapses_are_hot():
    assert hawking_temperature(0.05) > hawking_temperature(0.9)


# --- 9. Feynman ------------------------------------------------------------

def test_least_action_path_dominates():
    integral = path_integral(["a", "b", "c"], [1.0, 5.0, 9.0])
    assert integral.classical == "a"
    assert integral.stationary_action == 1.0
    assert integral.paths[0]["weight"] > integral.paths[1]["weight"]


def test_degenerate_paths_share_amplitude():
    integral = path_integral(["a", "b"], [2.0, 2.0])
    assert abs(integral.dominance - 0.5) < 1e-9


def test_weights_sum_to_one():
    integral = path_integral(list("abcd"), [1.0, 2.0, 3.0, 4.0], keep=4)
    assert abs(sum(p["weight"] for p in integral.paths) - 1.0) < 1e-3


def test_mismatched_input_is_safe():
    assert path_integral(["a"], []).classical is None


# --- 10. Navier-Stokes -----------------------------------------------------

def test_flow_converges_to_its_target():
    v = 0.0
    for _ in range(200):
        v = flow_step(v, 1.0).velocity
    assert abs(v - 1.0) < 0.05


def test_viscosity_damps_the_step():
    thin = flow_step(0.0, 1.0, viscosity=0.05).velocity
    thick = flow_step(0.0, 1.0, viscosity=0.9).velocity
    assert thin >= thick, "a thicker fluid must move less per step"


def test_reynolds_rises_with_velocity():
    assert reynolds(2.0, 1.0) > reynolds(0.5, 1.0)


def test_hud_smooths_a_step_input():
    hud = FluidHud()
    frame = hud.step({"confidence": 1.0})
    assert frame["values"]["confidence"] < 1.0, "the HUD must not snap"
    settled = hud.settle({"confidence": 1.0})
    assert settled["settled"]
    assert abs(settled["values"]["confidence"] - 1.0) < 0.02


def test_hud_channels_are_independent():
    hud = FluidHud()
    hud.step({"confidence": 1.0, "route": 1.0})
    # route is the thinner channel, so it must travel further in one frame.
    assert hud.channels["route"].velocity > hud.channels["confidence"].velocity


# --- integration: the physics is actually wired in -------------------------

def test_vector_memory_recall_reports_curvature():
    memory = VectorMemory(Path(tempfile.mkdtemp(prefix="cp-mem-")))
    memory.remember(
        Event(type="task_completed", payload={"text": "закрыл задачу по памяти ядра"}),
        {"score": 0.95, "reason": "done", "reinforce": "память ядра"},
    )
    hits = memory.recall("память ядра")
    assert hits, "the memory should be recalled"
    assert hits[0].curvature > 0.0, "a heavy memory must bend the query toward it"
    assert hits[0].score <= 1.5


def test_heavier_memory_outranks_a_lighter_one():
    memory = VectorMemory(Path(tempfile.mkdtemp(prefix="cp-mass-")))
    memory.remember(
        Event(type="system_state", payload={"text": "паттерн развития ядра"}),
        {"score": 0.1, "reason": "trivial", "reinforce": ""},
    )
    memory.remember(
        Event(type="task_completed", payload={"text": "паттерн развития ядра"}),
        {"score": 0.99, "reason": "major", "reinforce": ""},
    )
    hits = memory.recall("паттерн развития ядра")
    assert len(hits) >= 2
    assert hits[0].importance > hits[1].importance


def test_critic_flags_an_llm_failure_as_uncertain():
    event = Event(type="user_message", payload={"text": "привет"})
    ok = evaluate_event(event, {"route": "llm", "llm": {"status": "ok"}})
    failed = evaluate_event(event, {"route": "llm", "llm": {"status": "error"}})
    assert failed.score < ok.score, "a failed LLM call must cost score"
    assert failed.dirac is not None
    assert failed.dirac.annihilated > 0.0


def test_planner_derives_its_ordering_from_least_action():
    plan = build_plan("запустить продукт и получить первых клиентов")
    assert plan["ok"]
    assert plan["path_integral"]["paths_summed"] == 720
    orderings = tuple((t["mgr"], t["desc"], t["reality_check"]) for t in plan["tasks"])
    # Whatever the planner chose, no other ordering may have lower action.
    assert abs(action(orderings) - plan["path_integral"]["stationary_action"]) < 1e-9


def test_planner_opens_with_the_cheapest_step():
    plan = build_plan("собрать mvp за неделю")
    assert plan["tasks"][0]["mgr"] == "MGR-1", "the day must not open with the breakthrough"
    assert plan["first_move"] == plan["tasks"][0]["desc"]


def test_plan_still_carries_every_task_and_its_xp():
    plan = build_plan("привести тело в порядок", horizon_days=3)
    assert len(plan["tasks"]) == 6
    assert plan["total_xp"] == 50 + 30 * 2 + 10 * 3
    assert all(t["reality_check"] for t in plan["tasks"])


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
        except Exception as e:  # noqa: BLE001 - surface wiring errors as failures
            failed += 1
            print(f"  ERROR {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run())
