#!/usr/bin/env python3
"""Стенд: меряет ядро в числах, а не во впечатлениях.

Зачем отдельно от тестов. Тесты отвечают «сломано или нет» — и это другой
вопрос. Здесь измеряется то, что не ломается, а медленно улучшается или
медленно гниёт: узнаёт ли ядро одну тему, сказанную разными словами, и
отвечает ли по делу без всякой LLM.

Такие величины нельзя держать в голове. Однажды я уже принёс сюда «85% →
100%», и цифры оказались враньём: прогоны шли в общую папку состояния и
считали накопленное чужое. Поэтому стенд обязан быть запускаемым на любом
срезе кода и обязан считать каждый замер с чистого листа.

  python3 mark17/bench.py            # человекочитаемо
  python3 mark17/bench.py --json     # для сравнения двух срезов
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.compression import similarity
from mark17.events import Event
from mark17.plasticity_bridge import PlasticityBridge

# ── 1. Узнавание ─────────────────────────────────────────────────────────────
# Пары про одно и то же, сказанные по-разному. Ровно то, что человек делает
# всегда: возвращается к теме, не повторяя формулировку. Если ядро видит здесь
# две разные темы, то счётчик повторов не растёт, уверенность стоит на месте,
# и «в третий раз спрашиваешь об одном» никогда не срабатывает.
#
# Пары взяты из живых областей этого проекта — деньги, контент, тело, учёба,
# стройка, люди, — а не выдуманы под алгоритм.
PARAPHRASES: tuple[tuple[str, str], ...] = (
    ("как поднять доход в этом месяце", "хочу поднять доход"),
    ("поднять доход", "поднимаю доход потихоньку"),
    ("надо снять ролик для инсты", "снимаю ролик в инсту"),
    ("запустить рекламу на клиентов", "запускаю рекламу чтобы пришли клиенты"),
    ("хочу начать бегать по утрам", "начинаю бегать утром"),
    ("надо выучить английский", "учу английский"),
    ("собрать лендинг за неделю", "собираю лендинг, неделя есть"),
    ("написать никите про презентацию", "пишу никите насчёт презентации"),
    ("посчитать расходы за месяц", "считаю расходы за месяц"),
    ("сделать бота для анализа проектов", "делаю бота, он анализирует проекты"),
    # Прошедшее время — известное слабое место грубого стеммера.
    ("поднял доход в этом месяце", "поднять доход в этом месяце"),
    ("снял ролик для инсты", "снять ролик для инсты"),
    ("запустил рекламу", "запустить рекламу"),
    ("выучил английский", "выучить английский"),
    ("написал никите", "написать никите"),
)

# Пары, которые ядро обязано НЕ склеить. Без них метрика жульничает: склеить
# всё со всем даёт 100% узнавания и полную бесполезность.
DIFFERENT: tuple[tuple[str, str], ...] = (
    ("как поднять доход", "хочу начать бегать по утрам"),
    ("надо снять ролик для инсты", "посчитать расходы за месяц"),
    ("выучить английский", "запустить рекламу на клиентов"),
    ("написать никите", "собрать лендинг за неделю"),
    ("сделать бота для анализа", "хочу спать"),
)

# ── 2. Покрытие ──────────────────────────────────────────────────────────────
# Вопросы, на которые ядро обязано ответить по делу — без LLM, из себя.
SHOULD_ANSWER: tuple[str, ...] = (
    "как поднять доход в этом месяце",
    "хочу заработать пять тысяч долларов за месяц",
    "надо снять ролик для инсты",
    "как запустить рекламу на клиентов",
    "хочу начать бегать по утрам",
    "надо выучить английский за полгода",
    "собрать лендинг за неделю",
    "как написать никите про презентацию",
    "посчитать расходы за месяц",
    "сделать бота который анализирует проекты",
    "хочу больше энергии днём",
    "как договориться с партнёром о доле",
)

# Вопросы, на которые у ядра нет предметного ответа. Здесь важно не «сказать
# или промолчать», а КАК сказать: человеку нельзя показывать машинное нутро.
#
# Первый прогон стенда поймал ровно это. На «расскажи анекдот» ядро выдавало:
# «Уверенность пока низкая (16%)… закрепить этот запрос как новый паттерн».
# Формально ответ есть, длина приличная — а по сути человеку показали
# приборную панель вместо разговора.
NO_DOMAIN: tuple[str, ...] = (
    "расскажи анекдот",
    "какая завтра погода",
    "привет",
    "спасибо",
    "как дела",
)

# Слова, которых человек в ответе видеть не должен. Это не стилистика: пока
# они там, ядро говорит о себе, а не с собеседником, — и никакая уверенность
# в процентах этого не исправит.
MACHINERY = (
    "паттерн",
    "уверенность",
    "маршрут",
    "plasticity",
    "ассоциаци",
    "воспоминани",
    "вывод ядра",
    "self-eval",
)

MIN_ANSWER_CHARS = 60
ECHO_LIMIT = 0.85


def _fresh_bridge(tmp: Path) -> PlasticityBridge:
    """Каждый замер с чистого листа: накопленное чужое искажает результат."""
    return PlasticityBridge(tmp)


def measure_recognition() -> dict:
    same_hits = 0
    for a, b in PARAPHRASES:
        with tempfile.TemporaryDirectory() as d:
            bridge = _fresh_bridge(Path(d))
            first = bridge.process(Event(type="user_message", ts=1.0,
                                         payload={"text": a})).pattern_id
            second = bridge.process(Event(type="user_message", ts=2.0,
                                          payload={"text": b})).pattern_id
            if first == second:
                same_hits += 1

    kept_apart = 0
    for a, b in DIFFERENT:
        with tempfile.TemporaryDirectory() as d:
            bridge = _fresh_bridge(Path(d))
            first = bridge.process(Event(type="user_message", ts=1.0,
                                         payload={"text": a})).pattern_id
            second = bridge.process(Event(type="user_message", ts=2.0,
                                          payload={"text": b})).pattern_id
            if first != second:
                kept_apart += 1

    return {
        "склеено_верно": same_hits,
        "склеено_всего": len(PARAPHRASES),
        "разделено_верно": kept_apart,
        "разделено_всего": len(DIFFERENT),
        "узнавание_pct": round(100 * same_hits / len(PARAPHRASES)),
        "различение_pct": round(100 * kept_apart / len(DIFFERENT)),
    }


def _ask(text: str) -> str:
    """Прогнать вопрос через ядро ровно так, как это делает сервер."""
    with tempfile.TemporaryDirectory() as d:
        proc = subprocess.run(
            [sys.executable, str(_ROOT / "mark17" / "json_cli.py"),
             "--no-llm", "--state-dir", d],
            input=json.dumps({"type": "user_message", "text": text}) + "\n",
            capture_output=True, text=True, timeout=120,
        )
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            data = json.loads(line)
        except ValueError:
            continue
        answer = data.get("answer") or {}
        return str(answer.get("text") or "").strip()
    return ""


def _is_substantive(question: str, answer: str) -> bool:
    """Ответ по делу — не отписка, не эхо и не рассказ о себе.

    Длина здесь не признак качества, а отсечка пустоты: короче шестидесяти
    знаков не помещается ни один разбор по шагам, зато прекрасно помещается
    «принято» и «не понял».
    """
    if len(answer) < MIN_ANSWER_CHARS:
        return False
    if "Max17, когнитивное ядро" in answer:  # рассказ о своих возможностях
        return False
    if similarity(question, answer) >= ECHO_LIMIT:  # эхо вопроса
        return False
    return True


def _leaks_machinery(answer: str) -> list[str]:
    low = answer.lower()
    return [w for w in MACHINERY if w in low]


def measure_coverage() -> dict:
    answered = 0
    misses: list[str] = []
    leaked_on_answers: list[str] = []
    for q in SHOULD_ANSWER:
        a = _ask(q)
        if _is_substantive(q, a):
            answered += 1
        else:
            misses.append(q)
        if _leaks_machinery(a):
            leaked_on_answers.append(q)

    clean = 0
    leaks: list[tuple[str, list[str]]] = []
    for q in NO_DOMAIN:
        found = _leaks_machinery(_ask(q))
        if found:
            leaks.append((q, found))
        else:
            clean += 1

    total_leaks = len(leaks) + len(leaked_on_answers)
    return {
        "ответил_верно": answered,
        "ответить_должен": len(SHOULD_ANSWER),
        "покрытие_pct": round(100 * answered / len(SHOULD_ANSWER)),
        "не_ответил": misses,
        "без_нутра_верно": clean,
        "без_нутра_всего": len(NO_DOMAIN),
        "утечек_всего": total_leaks,
        "утечки": [{"вопрос": q, "слова": w} for q, w in leaks],
        "утечки_в_ответах": leaked_on_answers,
    }


def measure_speed(rounds: int = 40) -> dict:
    """Сколько ядро думает над репликой. Медиана, а не среднее: один
    случайный тормоз диска не должен решать за все сорок."""
    with tempfile.TemporaryDirectory() as d:
        bridge = _fresh_bridge(Path(d))
        times: list[float] = []
        for i in range(rounds):
            text = PARAPHRASES[i % len(PARAPHRASES)][i % 2]
            start = time.perf_counter()
            bridge.process(Event(type="user_message", ts=float(i),
                                 payload={"text": text}))
            times.append((time.perf_counter() - start) * 1000)
    times.sort()
    return {"медиана_мс": round(times[len(times) // 2], 2),
            "худшее_мс": round(times[-1], 2)}


def main() -> int:
    as_json = "--json" in sys.argv
    result = {
        "узнавание": measure_recognition(),
        "покрытие": measure_coverage(),
        "скорость": measure_speed(),
    }

    if as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    r, c, s = result["узнавание"], result["покрытие"], result["скорость"]
    print("── УЗНАВАНИЕ ──")
    print(f"  одну тему разными словами:  {r['склеено_верно']}/{r['склеено_всего']}"
          f"  ({r['узнавание_pct']}%)")
    print(f"  разные темы не склеил:      {r['разделено_верно']}/{r['разделено_всего']}"
          f"  ({r['различение_pct']}%)")
    print("\n── ПОКРЫТИЕ (без LLM) ──")
    print(f"  ответил по делу:            {c['ответил_верно']}/{c['ответить_должен']}"
          f"  ({c['покрытие_pct']}%)")
    print(f"  без машинного нутра:        {c['без_нутра_верно']}/{c['без_нутра_всего']}")
    print(f"  утечек внутренностей:       {c['утечек_всего']}")
    for q in c["не_ответил"]:
        print(f"    нет ответа: {q}")
    for item in c["утечки"]:
        print(f"    нутро наружу: {item['вопрос']}  →  {', '.join(item['слова'])}")
    for q in c["утечки_в_ответах"]:
        print(f"    нутро в рабочем ответе: {q}")
    print("\n── СКОРОСТЬ ──")
    print(f"  медиана {s['медиана_мс']} мс · худшее {s['худшее_мс']} мс")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
