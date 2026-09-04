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
from mark17.compression import _stem, similarity
from mark17.plasticity_bridge import TOPIC_MATCH, PlasticityBridge
from mark17.responder import _hot_topic_answer, _is_echo, _plan_answer, _recall_note

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
    # Прошедшее время теперь сводится. Раньше здесь стояло обратное с
    # объяснением, что отсекать «-ал/-ял» опасно: под нож пойдут «канал» и
    # «сигнал». Опасение было верным, но вывод — нет. Человек рассказывает о
    # сделанном именно прошедшим временем, и на живых парах ядро не узнавало
    # из-за этого каждую шестую реплику.
    check("прошедшее время сводится к настоящему",
          topic_key("поднял доход") == topic_key("поднять доход"),
          f"{topic_key('поднял доход')!r} vs {topic_key('поднять доход')!r}")

    # А вот и то самое опасение, теперь в виде сторожа. Существительные на
    # «-ал» действительно стачиваются до трёх букв («канал» → «кан»), но
    # сравнение по общему началу требует минимум четырёх, поэтому короткая
    # основа совпадает только сама с собой и ни с чем не слипается.
    check("существительные на -ал не слипаются с глаголами",
          similarity("канал связи", "поднять доход") == 0.0,
          f"{similarity('канал связи', 'поднять доход')}")
    check("сигнал и синхронизация — разные темы",
          similarity("проверить сигнал", "запустить синхронизацию") == 0.0)
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
        "content": _plan_answer("надо снять ролик для инсты", 0.5),
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


def test_recall_note() -> None:
    print("\n-- ядро замечает, что ходим кругами --")
    q = "как поднять доход"
    check("на первом заходе молчит", _recall_note({"plasticity": {"hits": 1}}, q) == "")
    check("на втором ещё молчит", _recall_note({"plasticity": {"hits": 2}}, q) == "")

    third = _recall_note({"plasticity": {"hits": 3}}, q)
    check("на третьем говорит", bool(third))
    check("называет, в какой раз", "третий" in third, third)
    check("не цитирует прошлую реплику", q not in third, third)
    check("зовёт к шагу, а не к обдумыванию", "шаг" in third, third)

    fifth = _recall_note({"plasticity": {"hits": 5}}, q)
    check("считает дальше третьего", "5-й" in fifth, fifth)

    check("мусор в hits не роняет", _recall_note({"plasticity": {"hits": "нет"}}, q) == "")
    check("без plasticity не роняет", _recall_note({}, q) == "")


def test_hot_topic(tmp: Path) -> None:
    print("\n-- «что дальше» отвечает по незакрытой теме --")
    bridge = PlasticityBridge(tmp)
    check("пока разговора не было — темы нет", bridge.hot_topic() is None)

    bridge.process(_msg("как поднять доход"))
    bridge.process(_msg("хочу поднять доходы"))
    hot = bridge.hot_topic()
    check("тема нашлась", hot is not None)
    check("считает заходы", hot and hot["hits"] == 2, str(hot))

    # Свою же тему исключаем: на конкретный вопрос отвечать «ты часто про это
    # спрашиваешь» — не ответ.
    check("своя тема исключается",
          bridge.hot_topic(exclude=hot["topic"]) is None if hot else False)

    # Свежесть важнее общего числа: тема, которую обсуждали больше, но давно,
    # к «что дальше» сегодня отношения не имеет. Метки времени задаём все явно —
    # смешивать их с time.time() нельзя, иначе «давняя» тема окажется свежее
    # любой заданной вручную.
    aged = PlasticityBridge(tmp / "aged")
    now = time.time()
    for i in range(4):
        aged.process(Event(type="user_message",
                           payload={"text": "починить сборку проекта"}, ts=now - 86400 + i))
    # Свежая тема тоже должна прозвучать хотя бы дважды: одиночную реплику
    # порог отсекает намеренно, чтобы случайно брошенное не глушило незакрытое.
    aged.process(Event(type="user_message",
                       payload={"text": "нужно нанять человека"}, ts=now - 1))
    aged.process(Event(type="user_message",
                       payload={"text": "надо нанять человека в команду"}, ts=now))
    fresh = aged.hot_topic()
    check("побеждает свежая тема, а не самая частая",
          fresh is not None and "нан" in fresh["topic"], str(fresh))
    check("у частой темы заходов действительно больше",
          aged.pattern_cache[aged.pattern_id(_msg("починить сборку проекта"))].hits == 4)

    # Ответ целиком: горячая тема превращается в план, а не в перечень
    # собственных возможностей.
    answer = _hot_topic_answer(
        {"plasticity": {"hot_topic": {"topic": "доход подн", "hits": 3}}}, 0.5
    )
    check("на «что дальше» есть ответ", answer is not None)
    if answer:
        check("это план, а не описание себя", "1." in answer["text"])
        check("названо число заходов", "3" in answer["text"])
        check("область распознана по основам", answer.get("domain") == "money")

    check("одного захода мало",
          _hot_topic_answer({"plasticity": {"hot_topic": {"topic": "доход подн", "hits": 1}}}, 0.5) is None)
    check("без горячей темы молчит", _hot_topic_answer({"plasticity": {}}, 0.5) is None)
    check("мусор не роняет", _hot_topic_answer({"plasticity": {"hot_topic": "нет"}}, 0.5) is None)


def test_stopwords_survive_stemming() -> None:
    print("\n-- стоп-слова отсекаются до стемминга --")
    # В списке лежат целые слова, а стеммер успевает их изменить: «чтобы» →
    # «чтоб», «нужно» → «нужн». Пока проверка шла только после стемминга,
    # половина списка молча не работала.
    base = topic_key("поднять доход")
    for word in ("чтобы", "нужно", "можно", "хочу", "просто", "когда", "очень"):
        # Проверяем во фразе: одиночное служебное слово темы не имеет и законно
        # возвращается как есть — схлопывать «ок» и «привет» в одно нельзя.
        check(f"«{word}» не добавляет основу к теме",
              topic_key(f"{word} поднять доход") == base,
              f"{topic_key(f'{word} поднять доход')!r} vs {base!r}")

    a, b = "хочу поднять доход в этом месяце", "что сделать чтобы поднять доход"
    score = similarity(topic_key(a), topic_key(b))
    check("одна мысль двумя формулировками проходит порог",
          score >= TOPIC_MATCH, f"Дайс {score:.3f}: {topic_key(a)!r} vs {topic_key(b)!r}")


def test_whole_dialogue(tmp: Path) -> None:
    print("\n-- диалог целиком держится без сети --")
    # Куски проверены поштучно выше; здесь важно, что они складываются. Именно
    # на сквозном прогоне вылезли обе дыры: порог hits применялся после выбора
    # свежей темы, а стоп-слова — после стемминга.
    bridge = PlasticityBridge(tmp)
    seen = [
        bridge.process(_msg("хочу поднять доход в этом месяце")).hits,
        bridge.process(_msg("а как именно поднять доходы")).hits,
        bridge.process(_msg("что сделать чтобы поднять доход")).hits,
    ]
    check("три формулировки — один паттерн", seen == [1, 2, 3], str(seen))

    # Новая тема, произнесённая один раз, не должна глушить незакрытую.
    bridge.process(_msg("надо ещё лендинг запустить"))
    hot = bridge.hot_topic(exclude=topic_key("что дальше"))
    check("после случайной реплики «что дальше» всё ещё отвечает", hot is not None)
    check("и отвечает по незакрытой теме, а не по случайной",
          hot is not None and "доход" in hot["topic"], str(hot))

    # А когда новая тема сама становится повторяющейся — она и побеждает.
    bridge.process(_msg("лендинг надо всё-таки запустить"))
    bridge.process(_msg("запустить лендинг наконец"))
    hot2 = bridge.hot_topic(exclude=topic_key("что дальше"))
    check("свежая повторяющаяся тема забирает первенство",
          hot2 is not None and "лендинг" in hot2["topic"], str(hot2))


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
    test_recall_note()
    test_stopwords_survive_stemming()
    with tempfile.TemporaryDirectory() as d:
        test_hot_topic(Path(d))
    with tempfile.TemporaryDirectory() as d:
        test_whole_dialogue(Path(d))
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
