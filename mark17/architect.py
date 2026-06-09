"""Architect mode — the internal AI proposes new development branches.

Read-only: snapshots the project structure, hands it to Qwen3 with a staff-engineer
prompt grounded in what already exists + known weak points, and returns a RANKED
JSON list of development branches (title/why/steps/risk/effort/files). The user
implements a chosen branch via the code agent (project target). No writes here.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.code_agent import _extract_json
from mark17.gonka_bridge import chat as gonka_chat, is_enabled as gonka_is_enabled

SNAPSHOT_DIRS = ("app", "components/hud", "mark17", "lib", "hooks")
SKIP_PARTS = {"node_modules", ".next", ".git", "code-workspace", "__pycache__", "certificates"}
CODE_SUFFIXES = {".ts", ".tsx", ".py", ".css"}

CAPABILITIES = (
    "УЖЕ ПОСТРОЕНО: Max17 — локальное детерминированное ядро (память, синапс-граф ~100k, "
    "пластичность, концепты, working memory, dreamer, source_memory); персистентный демон /api/max17; "
    "голос Gonka Qwen3 (естественные ответы); retrieval-first веб-поиск (Wikipedia, двуязычный); "
    "семантический индекс памяти (n-gram эмбеддинги + numpy); автообучение (curiosity flywheel); "
    "зрение + детектор лиц + индикатор движения; hands-free голос (вейк-ворд/хлопок); "
    "оркестратор-роутер (chat/code/desktop); код-агент (sandbox + project-режим с откатом); "
    "desktop-агент (macOS, auto-mode); безопасность (localhost-бинд + токен-гейт)."
)
WEAK_POINTS = (
    "ИЗВЕСТНЫЕ СЛАБОСТИ: 10 tsc-ошибок в GameApp.tsx/gemini.ts скрыты ignoreBuildErrors; "
    "нет TS/agent-тестов; Gonka вызывается на КАЖДЫЙ месседж (цена/латентность, нет fast-path/кэша); "
    "флайвил автообучения и dreamer построены, но не запускаются по триггеру (idle/sleep); "
    "агенты пишут лишь system_state-трейс, но не учатся в синапс-граф; оркестратор только keyword; "
    "файлы-боги (HudApp.tsx ~1140, json_cli.py ~2000 строк); npm audit high/moderate."
)


def _snapshot() -> str:
    lines: list[str] = []
    for rel in SNAPSHOT_DIRS:
        base = _ROOT / rel
        if not base.exists():
            continue
        lines.append(f"## {rel}/")
        for path in sorted(base.rglob("*")):
            if any(part in SKIP_PARTS for part in path.parts):
                continue
            if path.is_file() and path.suffix in CODE_SUFFIXES:
                try:
                    count = sum(1 for _ in path.open(encoding="utf-8", errors="replace"))
                except Exception:  # noqa: BLE001
                    count = 0
                lines.append(f"  {path.relative_to(_ROOT)} ({count})")
            if len(lines) >= 220:
                break
        if len(lines) >= 220:
            break
    return "\n".join(lines[:220])


def propose(request: dict[str, Any]) -> dict[str, Any]:
    if not gonka_is_enabled("architect"):
        return {"ok": False, "error": "GONKA_API_KEY не задан — архитектор выключен.", "branches": []}
    focus = str(request.get("focus") or "").strip()
    try:
        count = int(request.get("count", 5))
    except (TypeError, ValueError):
        count = 5
    count = max(3, min(8, count))

    snapshot = _snapshot()
    system = (
        "Ты — главный инженер (staff engineer) проекта Game: Next.js 15 + локальное Python-ядро Max17, "
        "LLM — Qwen3 через Gonka. Железо-цель: MacBook Air 2015, CPU-only, локал-ферст. "
        "Предлагай НОВЫЕ, конкретные, реализуемые ветки развития под этот стек и железо. "
        "Не повторяй уже существующее. Каждая ветка — с пользой, шагами, риском и трудозатратой. "
        "Верни СТРОГО JSON без markdown. Будь КРАТОК: why ≤ 200 символов, до 4 коротких шагов. "
        '{"branches":[{"title":"...","why":"...","steps":["..."],"risk":"low|med|high",'
        '"effort":"S|M|L","files":["путь",...]}]}'
    )
    user = (
        f"{CAPABILITIES}\n\n{WEAK_POINTS}\n\nСТРУКТУРА ПРОЕКТА (файл — строк):\n{snapshot}\n\n"
        + (f"ФОКУС пользователя: {focus}\n\n" if focus else "")
        + f"Предложи {count} лучших веток развития, отсортируй по ценности. Только JSON."
    )

    res = gonka_chat(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        role="architect",
        max_tokens=8000,
        temperature=0.4,
        response_format={"type": "json_object"},
    )
    if not res.ok or not res.text:
        return {"ok": False, "error": res.error or res.status, "branches": [], "model": res.model}
    parsed = _extract_json(res.text)
    branches: list[Any] = []
    if isinstance(parsed, dict) and isinstance(parsed.get("branches"), list):
        branches = parsed["branches"]
    elif isinstance(parsed, list):
        branches = parsed
    clean = [b for b in branches if isinstance(b, dict) and b.get("title")][:count]
    return {"ok": True, "branches": clean, "model": res.model}


def main() -> int:
    raw = sys.stdin.read()
    try:
        request = json.loads(raw) if raw.strip() else {}
        if not isinstance(request, dict):
            raise ValueError("request must be a JSON object")
    except Exception as exc:  # noqa: BLE001
        sys.stdout.write(json.dumps({"ok": False, "error": f"bad request: {exc}", "branches": []}, ensure_ascii=False) + "\n")
        return 1
    sys.stdout.write(json.dumps(propose(request), ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
