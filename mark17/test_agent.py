"""Standalone tests for agent — первого автономного жителя мира.

Run: python3 mark17/test_agent.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.agent import (
    ACTION_BY_KEY,
    DRIVES,
    TRUST_START,
    Agent,
    Observation,
    decide,
    energy,
    entropy,
    observe_world,
    process_agent_event,
    temperature,
)

_FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok  {name}")
    else:
        print(f"FAIL  {name} {detail}")
        _FAILURES.append(name)


def _census(**over) -> dict:
    base = dict(
        alive=5000, born=400, died=120, radius=3.0, density=0.5,
        spiral_b=0.4, arms=3, hue=316.0, symmetry=0.7, energy=0.5, dt=1.0,
    )
    base.update(over)
    return base


# --- наблюдение -------------------------------------------------------------


def test_observation() -> None:
    print("\n-- наблюдение --")
    obs = observe_world(_census(), tension=0.0)
    check("плотность прочитана", abs(obs.density - 0.5) < 1e-9)
    check("симметрия прочитана", abs(obs.symmetry - 0.7) < 1e-9)
    check("спокойствие = 1 - напряжение", abs(obs.calm - 1.0) < 1e-9)

    tense = observe_world(_census(), tension=0.8)
    check("напряжение съедает спокойствие", abs(tense.calm - 0.2) < 1e-9)

    frozen = observe_world(_census(born=0, died=0), tension=0.0)
    check("мёртвый мир не меняется", frozen.change == 0.0, f"change={frozen.change}")

    churning = observe_world(_census(alive=100, born=900, died=900), tension=0.0)
    check("бурлящий мир меняется сильно", churning.change > 0.6, f"change={churning.change}")

    # Дрейф считается относительно прошлого такта: тот же мир, другой цвет.
    prev = observe_world(_census(born=0, died=0), tension=0.0)
    moved = observe_world(_census(born=0, died=0, hue=136.0), tension=0.0, previous=prev)
    check("сдвиг цвета читается как изменение", moved.change > 0.2, f"change={moved.change}")

    # Оттенок кольцевой: 359° и 1° — соседи.
    near_a = observe_world(_census(born=0, died=0, hue=359.0), tension=0.0)
    near_b = observe_world(_census(born=0, died=0, hue=1.0), tension=0.0, previous=near_a)
    check("оттенок замкнут в круг", near_b.change < 0.05, f"change={near_b.change}")

    junk = observe_world({"density": "nope", "symmetry": None, "alive": float("nan")})
    check("мусор в переписи не ломает наблюдение", 0.0 <= junk.density <= 1.0)


# --- термодинамика ----------------------------------------------------------


def test_thermodynamics() -> None:
    print("\n-- свободная энергия --")
    perfect = {spec.observable: spec.target for spec in DRIVES}
    check("на уставках энергия нулевая", energy(perfect) < 1e-9)
    check("уход от уставки стоит энергии", energy({**perfect, "density": 0.0}) > 0.1)

    check("полностью упорядоченный мир скучен", entropy({"symmetry": 1.0, "change": 0.0, "density": 0.0}) < 1e-9)
    check("забитый мир так же скучен", entropy({"symmetry": 1.0, "change": 0.0, "density": 1.0}) < 1e-9)
    check("середина держит максимум энтропии", entropy({"symmetry": 0.5, "change": 0.5, "density": 0.5}) > 0.99)

    cold = temperature(arousal=0.0, sound_energy=0.0, propagation=1.0)
    hot = temperature(arousal=1.0, sound_energy=1.0, propagation=1.0)
    check("возбуждение греет агента", hot > cold * 5, f"{cold} -> {hot}")

    thick = temperature(arousal=1.0, sound_energy=1.0, propagation=0.25)
    check("густой эфир остужает", thick < hot, f"{thick} vs {hot}")
    check("быстрый эфир не разгоняет сверх потолка",
          temperature(arousal=1.0, sound_energy=1.0, propagation=9.0) == hot)


# --- выбор ------------------------------------------------------------------


def _trust(**over) -> dict:
    table = {key: TRUST_START for key in ACTION_BY_KEY}
    table.update(over)
    return table


def test_decision() -> None:
    print("\n-- выбор действия --")
    # Пустой мир: расти неоткуда, агент должен звать вещество.
    empty = Observation(density=0.02, symmetry=0.5, change=0.1, calm=0.9)
    check("в пустом мире агент цветёт", decide(empty, 0.2, _trust()).action.key == "bloom")

    # Забитый мир: рост уже перелёт, надо унять.
    packed = Observation(density=0.98, symmetry=0.4, change=0.9, calm=0.9)
    check("в забитом мире агент не цветёт", decide(packed, 0.2, _trust()).action.key != "bloom")

    # Мир ровно на уставках: трогать нечего, самое дешёвое — смотреть.
    settled = Observation(density=0.45, symmetry=0.72, change=0.35, calm=0.85)
    check("мир на уставках — агент смотрит", decide(settled, 0.05, _trust()).action.key == "watch")

    # Один и тот же вход — один и тот же выбор. Никакого шума.
    a = decide(empty, 0.3, _trust()).action.key
    b = decide(empty, 0.3, _trust()).action.key
    check("выбор детерминирован", a == b)

    # Недоверие к действию отбирает у него эффект и, значит, победу.
    doubted = decide(empty, 0.2, _trust(bloom=0.15)).action.key
    check("действие без доверия перестаёт выигрывать", doubted != "bloom", f"выбрал {doubted}")

    # Все альтернативы возвращаются наружу — ядро обязано уметь объясниться.
    considered = decide(empty, 0.2, _trust()).considered
    check("видны все рассмотренные варианты", len(considered) == len(ACTION_BY_KEY))
    check("ровно один помечен выбранным", sum(1 for c in considered if c["chosen"]) == 1)


def test_temperature_shifts_behaviour() -> None:
    print("\n-- температура двигает поведение --")
    # Мир полный, довольно ровный и вялый. Холодный агент экономит: убавляет
    # рождения и даёт миру выдохнуть. Горячий за те же деньги покупает энтропию
    # и швыряет мир вширь. Один и тот же мир, разные ответы — и переключает их
    # ровно член -T*S, а не отдельный режим.
    world = Observation(density=0.70, symmetry=0.60, change=0.0, calm=0.85)
    cold_choice = decide(world, 0.02, _trust()).action.key
    hot_choice = decide(world, 1.1, _trust()).action.key
    check("холодный и горячий агенты ведут себя по-разному",
          cold_choice != hot_choice, f"{cold_choice} == {hot_choice}")
    check("холодный агент бережёт мир", cold_choice == "hush", f"выбрал {cold_choice}")
    check("горячий агент идёт за разнообразием",
          hot_choice in {"scatter", "tint", "bloom"}, f"выбрал {hot_choice}")

    # Это не единственная точка: температура разводит выбор на заметной части
    # пространства состояний, иначе -T*S был бы украшением.
    grid = [round(i * 0.1, 1) for i in range(11)]
    flips = sum(
        1
        for d in grid
        for s in grid
        for c in grid
        if decide(Observation(density=d, symmetry=s, change=c, calm=0.85), 0.02, _trust()).action.key
        != decide(Observation(density=d, symmetry=s, change=c, calm=0.85), 1.1, _trust()).action.key
    )
    check("температура решает не в одной точке", flips > len(grid) ** 3 * 0.1,
          f"{flips} из {len(grid) ** 3}")


# --- жизнь и обучение -------------------------------------------------------


def test_lifecycle(tmp: Path) -> None:
    print("\n-- жизнь агента --")
    agent = Agent(tmp)
    out = agent.tick("w-abc123", _census(), laws={"propagation": 1.0}, tension=0.1, arousal=0.4, now=1000.0)
    check("агент завёлся", out["tick"] == 1)
    check("адрес выведен из мира", out["agent_id"] == Agent.agent_id_for("w-abc123"))
    check("действие выбрано", out["action"]["key"] in ACTION_BY_KEY)
    check("законы для браузера приехали", "emission" in out["action"]["knobs"])
    check("четыре влечения", len(out["drives"]) == 4)
    check("свободная энергия посчитана", "free_energy" in out["thermo"])
    check("первый такт учиться не на чем", out["learned"] is None)
    check("агент сказал словами", len(out["say"]) > 10)

    second = agent.tick("w-abc123", _census(), laws={"propagation": 1.0}, tension=0.1, arousal=0.4, now=1001.0)
    check("такты считаются", second["tick"] == 2)
    check("на втором такте есть чему учиться", second["learned"] is not None)
    check("журнал ведётся", len(second["journal"]) == 2)


def test_learning_from_error(tmp: Path) -> None:
    print("\n-- обучение на ошибке предсказания --")
    agent = Agent(tmp)
    world = "w-liar"

    # Первый такт в пустом мире: агент почти наверняка выберет цветение и
    # предскажет прирост плотности.
    first = agent.tick(world, _census(alive=10, density=0.02, born=5, died=0),
                       laws={"propagation": 1.0}, now=2000.0)
    chosen = first["action"]["key"]
    before = first["trust"][chosen]["trust"]

    # А мир не шелохнулся — предсказание не сбылось.
    second = agent.tick(world, _census(alive=10, density=0.02, born=5, died=0),
                        laws={"propagation": 1.0}, now=2001.0)
    learned = second["learned"]
    check("ядро назвало проверяемое действие", learned["action"] == chosen)
    check("ошибка предсказания измерена", learned["error"] > 0.0)
    check("доверие упало после промаха",
          learned["trust_after"] < before, f"{before} -> {learned['trust_after']}")

    # Много промахов подряд — доверие должно осесть, но не уйти в ноль:
    # действие, которому не доверяют совсем, уже нельзя переоценить.
    for i in range(20):
        agent.tick(world, _census(alive=10, density=0.02, born=5, died=0),
                   laws={"propagation": 1.0}, now=2002.0 + i)
    trust = agent.trust_table(Agent.agent_id_for(world))
    check("доверие не проваливается ниже пола",
          all(v["trust"] >= 0.15 - 1e-9 for v in trust.values()))

    # Доверие растёт, когда мир действительно приходит туда, куда обещано.
    # Мир ровно на всех уставках, включая новизну: оборот 4500/9000 даёт
    # change = 0.35. Трогать нечего, агент смотрит — и его предсказание
    # «ничего не поедет» сбывается такт за тактом.
    honest = Agent(tmp / "sub")
    calm = "w-honest"
    steady = _census(alive=4500, born=2250, died=2250, density=0.45, symmetry=0.72, hue=316.0)
    honest.tick(calm, steady, laws={"propagation": 1.0}, tension=0.15, now=3000.0)
    seq = [honest.tick(calm, steady, laws={"propagation": 1.0}, tension=0.15, now=3001.0 + i)
           for i in range(6)]
    check("на уставках агент выбирает наблюдение",
          seq[-1]["action"]["key"] == "watch", f"выбрал {seq[-1]['action']['key']}")
    watch_trust = seq[-1]["trust"]["watch"]["trust"]
    check("сбывшееся предсказание поднимает доверие",
          watch_trust > TRUST_START, f"trust={watch_trust}")


def test_direction_not_position(tmp: Path) -> None:
    print("\n-- судят по направлению, а не по попаданию в точку --")
    # Голос двигает мир на порядок сильнее агента, поэтому требовать от него
    # угадать точное состояние — значит требовать угадать человека. Спрашивают
    # только одно: подтолкнул ли он мир туда, куда обещал.
    empty = _census(alive=200, born=40, died=5, density=0.02, symmetry=0.5, hue=316.0)

    forward = Agent(tmp / "fwd")
    first = forward.tick("w-fwd", empty, laws={"propagation": 1.0}, now=7000.0)
    check("в пустом мире агент зовёт вещество", first["action"]["key"] == "bloom")
    grown = _census(alive=9000, born=1500, died=200, density=0.30, symmetry=0.45, hue=316.0)
    hit = forward.tick("w-fwd", grown, laws={"propagation": 1.0}, now=7001.0)["learned"]
    check("мир поехал туда, куда обещано — доверие вверх",
          hit["trust_after"] > hit["trust_before"],
          f"{hit['trust_before']} -> {hit['trust_after']} (acc={hit['accuracy']})")
    check("направление засчитано", hit["accuracy"] > 0.5, f"acc={hit['accuracy']}")

    backward = Agent(tmp / "back")
    backward.tick("w-back", empty, laws={"propagation": 1.0}, now=7000.0)
    # Тот же старт, но мир поехал против всего, что обещало «цветение»:
    # разредился, выровнялся и замер. Обратите внимание на born/died — оборот
    # обязан упасть тоже, иначе мир пойдёт за обещанием хотя бы по новизне.
    shrunk = _census(alive=200, born=0, died=2, density=0.001, symmetry=0.95, hue=316.0)
    miss = backward.tick("w-back", shrunk, laws={"propagation": 1.0}, now=7001.0)["learned"]
    check("мир поехал против обещания — доверие вниз",
          miss["trust_after"] < miss["trust_before"],
          f"{miss['trust_before']} -> {miss['trust_after']} (acc={miss['accuracy']})")
    check("обратное направление не засчитано", miss["accuracy"] < 0.5, f"acc={miss['accuracy']}")

    # Мир, стоящий на месте, — это промах для всего, что обещало движение.
    frozen = Agent(tmp / "frozen")
    frozen.tick("w-frozen", empty, laws={"propagation": 1.0}, now=7000.0)
    still = frozen.tick("w-frozen", empty, laws={"propagation": 1.0}, now=7001.0)["learned"]
    check("неподвижный мир — нулевая точность", still["accuracy"] == 0.0,
          f"acc={still['accuracy']}")

    # Шум четвёртого знака не имеет права выглядеть как подтверждение.
    check("шум округления не считается движением",
          all(abs(v) < 1e-9 for v in still["moved"].values()),
          f"moved={still['moved']}")


def test_agent_survives_reopen(tmp: Path) -> None:
    print("\n-- агент переживает перезапуск --")
    world = "w-persist"
    first = Agent(tmp)
    for i in range(5):
        first.tick(world, _census(), laws={"propagation": 1.0}, now=4000.0 + i)

    reopened = Agent(tmp)
    state = reopened.state(world)
    check("агент нашёлся после перезапуска", state is not None)
    check("такты не сбросились", state["tick"] == 5, f"tick={state['tick']}")
    check("журнал пережил перезапуск", len(state["journal"]) == 5)
    check("намерение сохранено", state["intent"] in ACTION_BY_KEY)

    sixth = reopened.tick(world, _census(), laws={"propagation": 1.0}, now=4100.0)
    check("счёт продолжился, а не начался заново", sixth["tick"] == 6)

    check("незнакомый мир — пустое состояние", reopened.state("w-nobody") is None)


def test_one_agent_per_world(tmp: Path) -> None:
    print("\n-- один мир — один агент --")
    agent = Agent(tmp)
    a = agent.tick("w-alpha", _census(), now=5000.0)
    b = agent.tick("w-beta", _census(), now=5000.0)
    check("у разных миров разные агенты", a["agent_id"] != b["agent_id"])

    a2 = agent.tick("w-alpha", _census(), now=5001.0)
    check("тот же мир — тот же агент", a2["agent_id"] == a["agent_id"])
    check("счётчики не смешались", a2["tick"] == 2 and b["tick"] == 1)


def test_event_path(tmp: Path) -> None:
    print("\n-- сквозной путь события --")
    agent = Agent(tmp)
    out = process_agent_event(
        {
            "world_id": "w-event",
            "census": _census(),
            "voice": {"tension": 0.3, "arousal": 0.7},
            "laws": {"propagation": 0.8},
        },
        agent,
        now=6000.0,
    )
    check("событие прошло насквозь", out["tick"] == 1)
    check("напряжение доехало до влечений",
          any(abs(d["value"] - 0.7) < 1e-9 for d in out["drives"] if d["key"] == "care"))

    try:
        process_agent_event({"census": _census()}, agent)
    except ValueError:
        check("без мира событие отклонено", True)
    else:
        check("без мира событие отклонено", False, "исключения не было")

    # Пустая перепись — законный вход: вкладку только что открыли.
    blank = process_agent_event({"world_id": "w-blank"}, agent, now=6001.0)
    check("пустая перепись не роняет агента", blank["action"]["key"] in ACTION_BY_KEY)


def main() -> int:
    print("== agent ==")
    test_observation()
    test_thermodynamics()
    test_decision()
    test_temperature_shifts_behaviour()
    with tempfile.TemporaryDirectory() as d:
        test_lifecycle(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_learning_from_error(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_direction_not_position(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_agent_survives_reopen(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_one_agent_per_world(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_event_path(Path(d))

    print()
    if _FAILURES:
        print(f"FAILED: {len(_FAILURES)} — {', '.join(_FAILURES)}")
        return 1
    print("all agent tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
