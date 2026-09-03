#!/usr/bin/env python3
"""Живо ли ядро на сервере и растёт ли уверенность — по настоящим разговорам.

Процесс в pm2 может гореть зелёным и быть при этом бесполезным: server.py
поднимается на одной стандартной библиотеке, а всё тяжёлое подтягивается
позже. «online» — не ответ на вопрос «Макс работает?».

Отвечает на него состояние: сколько тем ядро уже узнаёт, к каким возвращаются
повторно и какая на них уверенность. Считаем по живой памяти, а не тестовыми
запросами: запрос записался бы в ту же память и подмешал бы в неё выдуманную
тему. Диагностика не должна менять то, что она измеряет.

  core_health.py <адрес моста>      напр. http://127.0.0.1:8000
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path


def confidence(hits: int, activation: float) -> float:
    """Та же формула, что в PatternEntry.confidence — иначе цифры разойдутся."""
    freq = min(hits / 6.0, 1.0)
    return min(1.0, 0.45 * freq + 0.55 * activation)


def health(base: str) -> dict:
    try:
        with urllib.request.urlopen(f"{base}/health", timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return {"ok": False, "error": str(exc)}


def main(argv: list[str]) -> int:
    base = (argv[1] if len(argv) > 1 else "http://127.0.0.1:8000").rstrip("/")

    info = health(base)
    if not info.get("ok"):
        print(f"  мост не отвечает на {base}: {info.get('error', '?')}")
        return 1

    print(f"  мост:        отвечает ({base})")
    print(f"  LLM:         {'включена' if info.get('llm_enabled') else 'выключена'}")
    state_dir = info.get("state_dir") or ""
    print(f"  состояние:   {state_dir or 'не сообщено'}")

    cache = Path(state_dir) / "pattern_cache.json"
    if not state_dir or not cache.exists():
        print("  памяти пока нет — ядро ещё не отвечало ни на один вопрос")
        return 0

    try:
        raw = json.loads(cache.read_text())
    except (OSError, ValueError) as exc:
        print(f"  память не читается: {exc}")
        return 1

    talks = [
        (v.get("hits", 0), confidence(v.get("hits", 0), v.get("last_activation", 0.0)),
         (v.get("topic") or "").strip())
        for k, v in raw.items()
        if k.startswith("user_message:")
    ]
    if not talks:
        print("  реплик человека в памяти пока нет")
        return 0

    repeated = [t for t in talks if t[0] >= 2]
    print(f"  тем всего:   {len(talks)}")
    print(f"  повторных:   {len(repeated)}   ← ради них всё и делалось:")
    print("               узнать тему, заданную другими словами")

    if repeated:
        best = sorted(repeated, reverse=True)[:5]
        print("  самые частые:")
        for hits, conf, topic in best:
            short = (topic[:46] + "…") if len(topic) > 47 else topic
            print(f"    {hits:3d} раз · уверенность {conf:.0%}  {short}")
        top = max(c for _, c, _ in repeated)
        print(f"  максимум уверенности: {top:.0%}", end="")
        print("   (до правки потолок был около 33%)" if top > 0.4 else "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
