"""Standalone tests: узнавание темы, ответ по существу, кеш.

Run: python3 mark17/test_recognition.py

Здесь закреплено то, из-за чего уверенность ядра два года стояла на трети:
ключ паттерна считался от точного текста, поэтому «как поднять доход» и
«как поднять доход в этом месяце» были разными паттернами, каждый с нуля.
"""

from __future__ import annotations

import sys
import tempfile
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.events import Event, topic_key
from mark17.llm_bridge import CACHE_TTL_SEC, LlmBridge
from mark17.plasticity_bridge import TOPIC_MATCH, PlasticityBridge
from mark17.responder import _is_echo, _plan_answer

_FAILURES: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok  {name}")
    else:
        print(f"FAIL  {name} {detail}")
        _FAILURES.append(name)


def _msg(text: str) -> Event:
    return Event(type="user_message", payload={"text": text})


# --- тема реплики -----------------------------------------------------------


def test_topic_key() -> None:
    print("\n-- ключ темы --")
    check("порядок слов не важен",
          topic_key("поднять доход") == topic_key("доход поднять"))
    check("словоформы сводятся",
          topic_key("поднять доход") == topic_key("поднять доходы"))
    # Известное ограничение грубого стеммера: прошедшее время не сводится
    # («поднял» остаётся «поднял»). Отсекать «-ял/-ал» нельзя — под нож пойдут
    # «канал» и «сигнал». В вопросах-целях прошедшее время почти не встречается,
    # поэтому это оставлено как есть, а не подпёрто исключениями.
    check("прошедшее время пока не сводится — и это записано",
          topic_key("поднял доход") != topic_key("поднять доход"))
    check("вид глагола не разводит тему",
          topic_key("поднять доход") == topic_key("поднимать доход"),
          f"{topic_key('поднять доход')!r} vs {topic_key('поднимать доход')!r}")
    check("местоимения не попадают в тему",
          topic_key("как мне поднять доход") == topic_key("поднять доход"),
          f"{topic_key('как мне поднять доход')!r}")
    check("разные темы — разные ключи",
          topic_key("поднять доход") != topic_key("починить сборку"))

    # Реплика из одних служебных слов не имеет темы. Схлопывать такие в один
    # паттерн нельзя: «ок» и «привет» — не одно и то же.
    check("пустая тема падает обратно в текст", topic_key("ок") != topic_key("привет"))
    check("пустой ввод не роняет", isinstance(topic_key(""), str))
    check("None не роняет", isinstance(topic_key(None), str))


# --- узнавание паттерна -----------------------------------------------------


def test_pattern_recognition(tmp: Path) -> None:
    print("\n-- узнавание переформулировки --")
    bridge = PlasticityBridge(tmp)

    first = bridge.process(_msg("как поднять доход"))
    same = bridge.process(_msg("как мне поднять доход в этом месяце"))
    check("переформулировка — тот же паттерн",
          same.pattern_id == first.pattern_id,
          f"{first.pattern_id} vs {same.pattern_id}")

    other = bridge.process(_msg("почему падает сборка проекта"))
    check("другая тема — другой паттерн", other.pattern_id != first.pattern_id)

    third = bridge.process(_msg("хочу поднять доходы"))
    check("третья формулировка тоже своя же",
          third.pattern_id == first.pattern_id)
    check("уверенность копится через переформулировки",
          third.confidence > first.confidence,
          f"{first.confidence} -> {third.confidence}")


def test_confidence_no_longer_stuck(tmp: Path) -> None:
    print("\n-- уверенность больше не стоит на месте --")
    # Так выглядит живой разговор: одно и то же, но каждый раз другими словами.
    # Раньше каждая строка была новым паттерном с hits=1, и уверенность
    # намертво оставалась в районе трети.
    bridge = PlasticityBridge(tmp)
    said = [
        "как поднять доход",
        "как мне поднять доход в этом месяце",
        "хочу поднять доходы",
        "что сделать чтобы поднять доход",
        "нужно поднять доход",
    ]
    seen = [bridge.process(_msg(t)).confidence for t in said]
    check("уверенность растёт по ходу разговора", seen[-1] > seen[0],
          f"{seen[0]} -> {seen[-1]}")
    check("доходит до высокой", seen[-1] >= 0.8, f"итог {seen[-1]}")
    check("один паттерн, а не пять",
          len([p for p in bridge.pattern_cache if p.startswith("user_message:")]) <= 2,
          f"паттернов: {sorted(bridge.pattern_cache)}")


def test_topic_survives_reopen(tmp: Path) -> None:
    print("\n-- тема переживает перезапуск --")
    first = PlasticityBridge(tmp)
    pid = first.process(_msg("как поднять доход")).pattern_id
    first.save()

    reopened = PlasticityBridge(tmp)
    again = reopened.process(_msg("хочу поднять доходы"))
    check("после перезапуска паттерн тот же", again.pattern_id == pid,
          f"{pid} vs {again.pattern_id}")
    check("тема сохранилась на диск",
          bool(reopened.pattern_cache[pid].topic))


def test_match_threshold_is_not_a_sieve(tmp: Path) -> None:
    print("\n-- порог не склеивает всё подряд --")
    bridge = PlasticityBridge(tmp)
    base = bridge.process(_msg("как поднять доход клиентам")).pattern_id
    for other in ("починить сборку проекта", "что почитать вечером", "снять ролик"):
        got = bridge.process(_msg(other)).pattern_id
        check(f"«{other}» не слилось", got != base)
    check("порог осмысленный", 0.4 < TOPIC_MATCH < 0.9, f"TOPIC_MATCH={TOPIC_MATCH}")


# --- ответ по существу ------------------------------------------------------


def test_plan_answer() -> None:
    print("\n-- ответ по существу без сети --")
    money = _plan_answer("как поднять доход в этом месяце", 0.5)
    check("на цель с доменом есть план", money is not None)
    if money:
        check("домен распознан", money.get("domain") == "money", str(money.get("domain")))
        check("в ответе есть шаги", "1." in money["text"])
        check("есть проверка реальностью", len(money["text"].splitlines()) >= 3)
        check("это не отчёт о маршруте", "Уверенность" not in money["text"])

    # Каждая область отвечает своим, а не одним шаблоном на всё. Раньше план на
    # «поднять доход» и на «начать бегать» совпадал дословно.
    by_domain = {
        "body": _plan_answer("хочу начать бегать по утрам", 0.5),
        "learn": _plan_answer("хочу выучить английский", 0.5),
        "build": _plan_answer("надо запустить лендинг", 0.5),
        "people": _plan_answer("нужно нанять человека в команду", 0.5),
    }
    for want, got in by_domain.items():
        check(f"область «{want}» распознана",
              got is not None and got.get("domain") == want,
              str(got.get("domain") if got else None))

    texts = [a["text"] for a in [money, *by_domain.values()] if a]
    check("планы разных областей не совпадают", len(set(texts)) == len(texts))
    check("в плане про деньги есть деньги",
          money is not None and any(w in money["text"].lower() for w in ("сумм", "цен", "трат")))
    check("в плане про тело есть тело",
          by_domain["body"] is not None
          and any(w in by_domain["body"]["text"].lower() for w in ("форм", "будильник", "вес")))

    # Молчание — часть ответа: делать вид, что понял, ядро не должно.
    check("на неопознанное план не выдаётся",
          _plan_answer("расскажи анекдот про физиков", 0.5) is None)
    check("на погоду план не выдаётся",
          _plan_answer("какая завтра погода в москве", 0.5) is None)
    check("на короткую реплику план не выдаётся", _plan_answer("ок", 0.5) is None)


def test_echo_is_not_memory() -> None:
    print("\n-- эхо не выдаётся за воспоминание --")
    q = "что почитать по маркетингу"
    check("свой же вопрос опознан как эхо", _is_echo(q, q))
    check("он же с точкой — тоже эхо", _is_echo(q, q + "."))
    check("переформулировка — тоже эхо", _is_echo(q, "что мне почитать по маркетингу"))
    check("другая мысль — не эхо",
          not _is_echo(q, "вчера чинили сборку и упал numpy"))
    check("пустое — не эхо", not _is_echo(q, ""))


# --- кеш --------------------------------------------------------------------


def test_cache(tmp: Path) -> None:
    print("\n-- кеш ответов --")
    bridge = LlmBridge(state_dir=tmp, enabled=True)
    bridge._cache_put("как поднять доход", "Ответ провайдера")

    check("попадание по той же теме", bridge.ask("как поднять доход").status == "cached")
    check("попадание по переформулировке",
          bridge.ask("как мне поднять доход в этом месяце").status == "cached")
    check("другая тема мимо кеша",
          bridge.ask("почему падает сборка").status != "cached")

    # Разные модели не должны делить один ответ.
    other = LlmBridge(state_dir=tmp, enabled=True, model="другая-модель")
    check("ответ чужой модели не подхватывается",
          other.ask("как поднять доход").status != "cached")

    # Протухший ответ отдавать нельзя.
    stale = LlmBridge(state_dir=tmp, enabled=True)
    stale._cache_put("старый вопрос про сборку", "давно")
    import json as _json
    path = tmp / "llm_cache.json"
    raw = _json.loads(path.read_text())
    key = stale._cache_key("старый вопрос про сборку")
    raw[key]["ts"] = time.time() - CACHE_TTL_SEC - 60
    path.write_text(_json.dumps(raw, ensure_ascii=False))
    check("протухшее не отдаётся", stale._cache_get("старый вопрос про сборку") == "")

    # Кеш не обязан работать, чтобы работало ядро.
    nowhere = LlmBridge(enabled=True)
    check("без state_dir кеш молча выключен", nowhere._cache_get("что угодно") == "")
    nowhere._cache_put("что угодно", "текст")  # не должно бросить


def test_llm_off_is_instant(tmp: Path) -> None:
    print("\n-- выключенный LLM не ходит в сеть --")
    bridge = LlmBridge(state_dir=tmp, enabled=False)
    t0 = time.time()
    res = bridge.ask("как поднять доход")
    check("статус skipped", res.status == "skipped", res.status)
    check("отвечает мгновенно", time.time() - t0 < 0.5)


def main() -> int:
    print("== узнавание и ответ ==")
    test_topic_key()
    with tempfile.TemporaryDirectory() as d:
        test_pattern_recognition(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_confidence_no_longer_stuck(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_topic_survives_reopen(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_match_threshold_is_not_a_sieve(Path(d))
    test_plan_answer()
    test_echo_is_not_memory()
    with tempfile.TemporaryDirectory() as d:
        test_cache(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_llm_off_is_instant(Path(d))

    print()
    if _FAILURES:
        print(f"FAILED: {len(_FAILURES)} — {', '.join(_FAILURES)}")
        return 1
    print("all recognition tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
