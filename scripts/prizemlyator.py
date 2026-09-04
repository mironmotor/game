#!/usr/bin/env python3
"""Приземлятор — превращает голосовой поток мыслей в карточки бэклога.

Расшифровка голоса — это сплошной текст без структуры: в одном абзаце
и факт с цифрой, и задача, и сомнение. Скрипт режет поток на смысловые
куски и раскладывает по полкам, помечая то, что требует проверки.

Он ничего не выдумывает: только размечает и переставляет. Всё, что
похоже на цифру или на деньги, попадает в «требует подтверждения» —
непроверенная цифра в ролике дороже, чем её отсутствие.

    python3 scripts/prizemlyator.py dump.txt >> docs/backlog.md
    pbpaste | python3 scripts/prizemlyator.py
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys

# Расшифровка почти не ставит точки, зато щедра на слова-склейки.
# Режем и по знакам препинания, и по этим склейкам.
SPLIT_MARKERS = (
    "соответственно", "получается", "то есть", "в общем", "короче",
    "дальше", "потом", "а ещё", "а еще", "кстати", "вот",
)
_MARKERS = "|".join(SPLIT_MARKERS)
# Режем ПЕРЕД склейкой, а не по ней: иначе слово перед «дальше» съедается
# вместе с разделителем, и карточка теряет подлежащее.
_SPLIT_RE = re.compile(
    r"(?<=[.!?])\s+|(?<=,)\s+(?=(?:" + _MARKERS + r")\b)",
    re.IGNORECASE,
)
_LEAD_MARKER_RE = re.compile(r"^(?:" + _MARKERS + r")[,\s]+", re.IGNORECASE)

NUMBER_RE = re.compile(r"\d[\d\s.,]*|\b(?:мил+ион\w*|тысяч\w*|тыс\.?|млн|млрд|к\b)", re.IGNORECASE)
MONEY_RE = re.compile(r"₽|руб|\$|долл|евро|usdt|ton|stars|звёзд|звезд", re.IGNORECASE)
ACTION_RE = re.compile(r"\b(нужно|надо|сделать|сделаю|запуст\w+|написать|снять|добавить|проверить|уточнить)\b", re.IGNORECASE)
PROBLEM_RE = re.compile(r"\b(проблема|ошибк\w+|не получ\w+|боюсь|забоял\w+|заблокир\w+|сорвал\w+|потерял\w+|риск)\b", re.IGNORECASE)
IDEA_RE = re.compile(r"\b(идея|можно|давай|хочу|стоит|попробу\w+)\b", re.IGNORECASE)

# Куда кусок ложится в контент-плане (см. docs/personal_brand_30d.md §2).
PILLARS = (
    ("Блогеры", re.compile(r"блогер\w*|подписчик\w*|прогрев|охват\w*|реклам\w*", re.IGNORECASE)),
    ("Собираем за вечер", re.compile(r"бот\w*|телеграм|telegram|код\w*|лендинг|деплой|автоматиз\w*", re.IGNORECASE)),
    ("Разбор запуска", re.compile(r"запуск\w*|команд\w*|разработчик\w*|упаковк\w*|vpn|продукт\w*", re.IGNORECASE)),
    ("Управление", re.compile(r"фокус\w*|расфокус\w*|управлен\w*|команд\w*|выгоран\w*|решени\w*", re.IGNORECASE)),
    ("Деньги и платежи", re.compile(r"платёжк\w*|платежк\w*|оплат\w*|вывод\w*|трибьют|tribute|карт\w*|крипт\w*", re.IGNORECASE)),
)


def classify(chunk: str) -> str:
    """Тип карточки. Порядок проверок — от самого действенного к самому мягкому."""
    if PROBLEM_RE.search(chunk):
        return "Провал/риск"
    if ACTION_RE.search(chunk):
        return "Действие"
    if MONEY_RE.search(chunk) or NUMBER_RE.search(chunk):
        return "Факт"
    if IDEA_RE.search(chunk):
        return "Идея"
    return "Мысль"


def pillar(chunk: str) -> str:
    for name, pattern in PILLARS:
        if pattern.search(chunk):
            return name
    return "—"


def needs_proof(chunk: str) -> bool:
    """Цифра или деньги в кадре — значит нужен скрин. Без скрина в ролик не идёт."""
    return bool(MONEY_RE.search(chunk)) or bool(NUMBER_RE.search(chunk))


def split_chunks(raw: str) -> list[str]:
    chunks = []
    for piece in _SPLIT_RE.split(raw):
        piece = " ".join((piece or "").split())
        piece = _LEAD_MARKER_RE.sub("", piece)
        # Обрывки в два слова — это мусор расшифровки, а не мысль.
        if len(piece.split()) >= 4:
            chunks.append(piece.rstrip(",;"))
    return chunks


def render(chunks: list[str], source: str) -> str:
    today = dt.date.today().isoformat()
    out = [f"\n## Приземление {today} — {source}\n"]
    counts: dict[str, int] = {}
    for i, chunk in enumerate(chunks, 1):
        kind = classify(chunk)
        counts[kind] = counts.get(kind, 0) + 1
        proof = " · **нужен скрин**" if needs_proof(chunk) else ""
        out.append(f"### {i}. [{kind}] {pillar(chunk)}{proof}\n")
        out.append(f"> {chunk}\n")
        out.append("- Следующее действие: \n- Статус: новое\n")
    summary = ", ".join(f"{k}: {v}" for k, v in sorted(counts.items()))
    out.insert(1, f"_Карточек: {len(chunks)}. {summary}._\n")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", nargs="?", help="файл с расшифровкой; без него читает stdin")
    args = parser.parse_args()

    if args.file:
        with open(args.file, encoding="utf-8") as fh:
            raw = fh.read()
        source = args.file
    else:
        raw = sys.stdin.read()
        source = "stdin"

    chunks = split_chunks(raw)
    if not chunks:
        print("Пусто: ни одного куска длиннее трёх слов.", file=sys.stderr)
        return 1
    print(render(chunks, source))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
