"""Standalone tests for world_model — модели 3D-мира в ядре.

Run: python3 mark17/test_world_model.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.world_model import (
    WorldCensus,
    WorldModel,
    process_world_event,
    seed_from_text,
    world_id_from_seed,
)

_FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok  {name}")
    else:
        print(f"FAIL  {name} {detail}")
        _FAILURES.append(name)


def _census(**over) -> WorldCensus:
    base = dict(
        alive=5000, born=400, died=120, radius=3.0, density=0.5,
        spiral_b=0.4, arms=3, hue=316.0, symmetry=0.7, energy=0.6, dt=1.0,
    )
    base.update(over)
    return WorldCensus(**base)


def test_addressing() -> None:
    print("\n-- адресация миров --")
    check("одно семя — один адрес", world_id_from_seed(42) == world_id_from_seed(42))
    check("разные семена — разные адреса", world_id_from_seed(42) != world_id_from_seed(43))
    check("адрес выглядит как адрес", world_id_from_seed(42).startswith("w-"))
    check("семя из текста детерминировано", seed_from_text("миру мир") == seed_from_text("миру мир"))
    check("разный текст — разное семя", seed_from_text("а") != seed_from_text("б"))


def test_census_parsing() -> None:
    print("\n-- перепись --")
    c = WorldCensus.from_payload({"census": {"alive": 10, "density": 5, "hue": 400, "dt": 0}})
    check("плотность зажата в 0..1", c.density == 1.0, f"got {c.density}")
    check("оттенок приведён к кругу", 0 <= c.hue < 360, f"got {c.hue}")
    check("dt не бывает нулевым", c.dt > 0, f"got {c.dt}")
    empty = WorldCensus.from_payload({})
    check("пустая перепись безопасна", empty.alive == 0 and empty.dt > 0)
    junk = WorldCensus.from_payload({"alive": "много", "density": None})
    check("мусор не роняет разбор", junk.alive == 0 and junk.density == 0.0)


def test_world_lifecycle(state_dir: Path) -> None:
    print("\n-- жизнь мира --")
    model = WorldModel(state_dir)
    w = model.ensure_world(1234, user_id="miron", title="первый")
    check("мир родился", w["id"] == world_id_from_seed(1234))
    again = model.ensure_world(1234, user_id="miron")
    check("повторное семя не плодит миров", again["id"] == w["id"])
    check("у мира есть возраст", again["created_at"] == w["created_at"])

    out = model.observe(w["id"], _census())
    check("перепись принята", out["world_id"] == w["id"])
    check("есть законы", "emission_scale" in out["laws"])
    check("есть космос", out["cosmos"]["epoch"] != "")
    check("есть подсказка", bool(out["hint"]))

    stored = model.get(w["id"])
    check("перепись посчитана", stored["census_count"] == 1, f"got {stored['census_count']}")
    check("пик населения записан", stored["peak_alive"] == 5000)

    hist = model.history(w["id"])
    check("история пишется", len(hist) == 1)


def test_matter_condensation(state_dir: Path) -> None:
    print("\n-- вещество --")
    model = WorldModel(state_dir)
    w = model.ensure_world(777, user_id="miron")
    wid = w["id"]

    # Мир, где почти ничего не гаснет: перевес вещества максимальный.
    born_total = 0
    for _ in range(40):
        out = model.observe(wid, _census(alive=800, born=600, died=10, density=0.8))
        born_total += len(out["new_bodies"])
    check("вещество сгустилось", born_total > 0, f"got {born_total}")

    bodies = model.bodies(wid)
    check("вещество сохранено", len(bodies) == born_total, f"{len(bodies)} vs {born_total}")
    if bodies:
        b = bodies[0]
        check("у тела есть масса", b["mass"] > 0)
        check("у тела есть место в мире", any(abs(b[k]) > 0 for k in ("x", "y", "z")))

    stored = model.get(wid)
    check("счётчик тел сходится", stored["body_count"] == born_total)
    check("масса мира выросла", stored["matter_mass"] > 0 if born_total else True)


def test_matter_survives_reopen(state_dir: Path) -> None:
    print("\n-- мир переживает сессию --")
    model = WorldModel(state_dir)
    w = model.ensure_world(31337, user_id="miron")
    for _ in range(40):
        model.observe(w["id"], _census(alive=900, born=700, died=5, density=0.9))
    before = model.bodies(w["id"])

    # Новый объект модели = новая «сессия»: данные читаются с диска.
    reopened = WorldModel(state_dir)
    same = reopened.ensure_world(31337, user_id="miron")
    check("мир открылся тот же", same["id"] == w["id"])
    after = reopened.bodies(same["id"])
    check("вещество на месте", len(after) == len(before), f"{len(after)} vs {len(before)}")
    if before and after:
        check("тела не сдвинулись", after[0]["x"] == before[0]["x"])


def test_reproducible_from_seed() -> None:
    print("\n-- воспроизводимость по семени --")
    with tempfile.TemporaryDirectory() as d1, tempfile.TemporaryDirectory() as d2:
        pos = []
        for d in (d1, d2):
            model = WorldModel(Path(d))
            w = model.ensure_world(555, user_id="miron")
            for _ in range(40):
                model.observe(w["id"], _census(alive=900, born=700, died=5, density=0.9), now=1_800_000_000.0)
            b = model.bodies(w["id"])
            pos.append([(x["x"], x["y"], x["z"]) for x in b])
        check("одно семя — то же вещество", pos[0] == pos[1] and len(pos[0]) > 0,
              f"{len(pos[0])} vs {len(pos[1])}")


def test_hot_world_cannot_condense(state_dir: Path) -> None:
    print("\n-- горячий мир не держит структуру --")
    model = WorldModel(state_dir)
    w = model.ensure_world(999, user_id="miron")
    # now = сразу после T=0: вселенная ядра ещё раскалена.
    out = model.observe(w["id"], _census(alive=900, born=800, died=1), now=1_754_092_800.0 + 5.0)
    check("связывание запрещено", out["laws"]["can_condense"] is False)
    check("вещество не родилось", out["new_bodies"] == [])
    check("подсказка объясняет почему", "горяч" in out["hint"].lower())


def test_tension_thickens_ether(state_dir: Path) -> None:
    print("\n-- напряжение человека густит эфир --")
    model = WorldModel(state_dir)
    calm = model.ensure_world(11, user_id="a")
    tense = model.ensure_world(12, user_id="b")
    a = model.observe(calm["id"], _census(density=0.5), tension=0.0)
    b = model.observe(tense["id"], _census(density=0.5), tension=1.0)
    check("скорость обмена падает", b["laws"]["propagation"] < a["laws"]["propagation"],
          f"{b['laws']['propagation']} vs {a['laws']['propagation']}")
    check("узкое место — внимание", b["laws"]["bottleneck"] == "attention",
          f"got {b['laws']['bottleneck']}")


def test_end_to_end(state_dir: Path) -> None:
    print("\n-- сквозной путь события --")
    model = WorldModel(state_dir)
    payload = {
        "user_id": "miron",
        "title": "эфирный",
        "census": {"alive": 4000, "born": 300, "died": 90, "density": 0.6,
                    "radius": 3.2, "hue": 316, "arms": 3, "spiral_b": 0.4, "dt": 1.0},
    }
    out = process_world_event(payload, model, tension=0.2)
    check("мир получил адрес", out["world"]["id"].startswith("w-"))
    check("перепись вернулась", out["census"]["alive"] == 4000)
    check("законы на месте", out["laws"]["propagation"] > 0)
    check("вещество перечислено", isinstance(out["bodies"], list))

    # Без семени, но с тем же именем и человеком — тот же мир.
    again = process_world_event(payload, model)
    check("тот же мир по имени", again["world"]["id"] == out["world"]["id"])

    named = process_world_event({"user_id": "miron", "seed": "мир-о-музыке"}, model)
    check("семя из слова работает", named["world"]["id"].startswith("w-"))
    check("слово даёт свой мир", named["world"]["id"] != out["world"]["id"])


def main() -> int:
    print("world_model tests")
    test_addressing()
    test_census_parsing()
    test_reproducible_from_seed()
    with tempfile.TemporaryDirectory() as d:
        test_world_lifecycle(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_matter_condensation(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_matter_survives_reopen(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_hot_world_cannot_condense(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_tension_thickens_ether(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_end_to_end(Path(d))

    print()
    if _FAILURES:
        print(f"FAILED: {len(_FAILURES)} — {', '.join(_FAILURES)}")
        return 1
    print("all world_model tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
