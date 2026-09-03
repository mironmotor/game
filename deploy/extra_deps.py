#!/usr/bin/env python3
"""Зависимости сервера, которых нет в репозитории, — помнить между выкатками.

Зачем: на mir.care у сервера свой package.json. В нём есть drizzle-orm под
собственные роуты (lib/db, app/api/user-count, app/api/game-state), которых в
репозитории нет вовсе. Выкатка перезаписывает package.json версией из гита,
npm ci сносит node_modules и ставит ровно lock-файл — и сборка падает на
файлах самого сервера.

Список нужно помнить снаружи гита, а не выводить каждый раз заново: на
следующей выкатке «прежним» package.json окажется уже репозиторный, разница
станет нулевой, и потеря — невидимой. Один раз замеченное расхождение
хранится и применяется всегда.

  extra_deps.py save <прежний package.json> <новый> <хранилище.json>
  extra_deps.py args <хранилище.json>      → "имя@версия имя@версия"
"""

from __future__ import annotations

import json
import os
import sys


def deps(path: str) -> dict[str, str]:
    """Все зависимости файла одним словарём: обычные и dev вперемешку.

    Разделение здесь не нужно и вредно: пакет, потерянный из devDependencies,
    ломает сборку ровно так же, как потерянный из dependencies.
    """
    try:
        with open(path) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    out: dict[str, str] = {}
    for key in ("dependencies", "devDependencies"):
        out.update(data.get(key) or {})
    return out


def load(store: str) -> dict[str, str]:
    if not os.path.exists(store):
        return {}
    try:
        with open(store) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save(pre: str, post: str, store: str) -> int:
    extra = load(store)
    have = deps(post)
    # Копим, а не заменяем: расхождения могут вскрываться по одному, на разных
    # выкатках, и найденное в прошлый раз не должно теряться в этот.
    for name, version in deps(pre).items():
        if name not in have:
            extra[name] = version
    if not extra:
        return 0
    with open(store, "w") as f:
        json.dump(extra, f, indent=2, sort_keys=True, ensure_ascii=False)
    for name, version in sorted(extra.items()):
        print(f"{name}@{version}")
    return 0


def args(store: str) -> int:
    extra = load(store)
    if extra:
        print(" ".join(f"{n}@{v}" for n, v in sorted(extra.items())))
    return 0


def main(argv: list[str]) -> int:
    if len(argv) >= 5 and argv[1] == "save":
        return save(argv[2], argv[3], argv[4])
    if len(argv) >= 3 and argv[1] == "args":
        return args(argv[2])
    sys.stderr.write(__doc__ or "")
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
