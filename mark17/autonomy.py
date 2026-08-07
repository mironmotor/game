"""Автономия Макса: сам смотрит, сам решает, сам делает — и отвечает за это.

Один такт: наблюдение → решение → действие → запись результата.

Решение принимает LLM, если он доступен, но выбирать он может **только из
списка того, что руки реально умеют** (`hands.ACTIONS`). Свободного текста,
который потом кто-то попытается исполнить, здесь нет: модель называет ключ
действия, а всё остальное проверяют руки. Нет LLM — работают правила поверх
той же картины, и автономность не пропадает, а становится проще.

Про «руки»: выполнение по умолчанию выключено (`allow_execute=False`) — такт
заканчивается предложением. Так «Макс решил» и «Макс сделал» остаются двумя
разными событиями, и второе всегда включается человеком осознанно.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any

from mark17 import hands

MAX_STEPS = 5

# Мозг на NOOA (NVIDIA-labs OO Agents) живёт отдельным процессом: он требует
# Python ≥3.12, а ядро работает на 3.9. Подробности — nooa_bridge/README.md.
NOOA_URL = os.environ.get("MAX17_NOOA_URL", "http://127.0.0.1:8791").rstrip("/")
NOOA_TIMEOUT = 30


def ask_nooa(state: dict[str, Any], goal: str) -> dict[str, Any] | None:
    """Спросить решение у NOOA. Недоступен — молча возвращаем None.

    Ответ всё равно проходит через parse_decision, то есть имя действия
    сверяется с тем, что руки реально умеют. Чужой мозг не может назначить
    себе новое действие.
    """
    body = json.dumps({
        "goal": goal,
        "state": {k: state.get(k) for k in ("memories", "synapses", "reality")},
        "recent": state.get("recent", [])[:6],
        "can_do": state.get("can_do", []),
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{NOOA_URL}/decide", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=NOOA_TIMEOUT) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None
    if not payload.get("ok"):
        return None
    decision = parse_decision(str(payload.get("raw") or ""))
    if decision:
        decision["source"] = f"nooa:{payload.get('model', '?')}"
    return decision


def observe(brain: Any, synapse_graph: Any) -> dict[str, Any]:
    """Что Макс знает о себе и о мире прямо сейчас."""
    state: dict[str, Any] = {"memories": 0, "synapses": 0, "recent": [], "reality": {}}
    try:
        stats = brain.memory.stats()
        state["memories"] = stats.get("memories", 0)
    except Exception:
        pass
    try:
        graph = synapse_graph.get_graph(limit=20)
        state["synapses"] = graph.get("total", 0) if isinstance(graph, dict) else 0
    except Exception:
        pass
    try:
        for hit in brain.memory.recent(limit=8):
            content = hit.content if isinstance(hit.content, dict) else {}
            note = str(content.get("hint") or content.get("note") or "").strip()
            if note:
                state["recent"].append(note[:120])
    except Exception:
        pass
    try:
        from mark17 import reality
        state["reality"] = reality.stats()
    except Exception:
        pass
    state["can_do"] = hands.describe()
    state["last_actions"] = [
        {"action": a.get("action"), "ok": a.get("ok"), "dry_run": a.get("dry_run")}
        for a in hands.recent_actions(limit=5)
    ]
    return state


def build_prompt(state: dict[str, Any], goal: str) -> str:
    can = "\n".join(f"- {a['action']}: {a['what']}" for a in state.get("can_do", []))
    recent = "\n".join(f"- {r}" for r in state.get("recent", [])) or "(пусто)"
    reality = state.get("reality", {})
    return (
        "Ты — ядро Max. Реши, что сделать ОДНИМ следующим действием.\n\n"
        f"ЦЕЛЬ: {goal or 'разобраться в состоянии проекта и предложить полезный шаг'}\n\n"
        f"Память: {state.get('memories')} записей, синапсов: {state.get('synapses')}\n"
        f"Реальность: блоков {reality.get('blocks', 0)}, перебора {reality.get('effort', 0)}\n"
        f"Недавно:\n{recent}\n\n"
        f"ДОСТУПНЫЕ ДЕЙСТВИЯ (только из этого списка):\n{can}\n\n"
        "Ответь СТРОГО валидным JSON без пояснений:\n"
        '{"action": "ключ из списка", "params": {"...": "..."}, '
        '"why": "одно предложение — зачем", "expect": "что ожидаешь увидеть"}'
    )


def parse_decision(raw: str) -> dict[str, Any] | None:
    text = re.sub(r"```json\n?|```\n?", "", raw or "").strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    action = str(data.get("action") or "")
    if action not in hands.ACTIONS:
        return None  # модель назвала то, чего руки не умеют — решение не принимается
    params = data.get("params")
    return {
        "action": action,
        "params": params if isinstance(params, dict) else {},
        "why": str(data.get("why", ""))[:200],
        "expect": str(data.get("expect", ""))[:200],
        "source": "llm",
    }


def decide_deterministic(state: dict[str, Any], goal: str) -> dict[str, Any]:
    """Решение по правилам, когда LLM недоступен.

    Порядок отражает то, что полезно на практике: сначала осмотреться, потом
    свериться с репозиторием, потом зафиксировать вывод.
    """
    goal_low = (goal or "").lower()
    if any(w in goal_low for w in ("файл", "прочит", "посмотр", "read")):
        target = _guess_path(goal) or "README.md"
        return {"action": "read_file", "params": {"path": target},
                "why": f"в цели упомянут файл — читаю {target}",
                "expect": "содержимое файла", "source": "rules"}
    if any(w in goal_low for w in ("git", "измен", "статус", "коммит")):
        return {"action": "run_command", "params": {"command": "git status --short"},
                "why": "цель про состояние репозитория",
                "expect": "список изменённых файлов", "source": "rules"}
    if not state.get("last_actions"):
        return {"action": "list_dir", "params": {"path": "."},
                "why": "ещё ничего не делал — осматриваюсь",
                "expect": "структура проекта", "source": "rules"}
    return {"action": "write_note",
            "params": {"name": "observation",
                       "text": f"Цель: {goal}\nПамять: {state.get('memories')}, "
                               f"синапсы: {state.get('synapses')}\n"
                               f"Недавно: {'; '.join(state.get('recent', [])[:3])}"},
            "why": "фиксирую наблюдение, чтобы не потерялось",
            "expect": "заметка на диске", "source": "rules"}


def _guess_path(goal: str) -> str:
    match = re.search(r"[\w./-]+\.(py|ts|tsx|md|json|css|sh|txt)", goal or "")
    return match.group(0) if match else ""


def step(
    *,
    brain: Any,
    synapse_graph: Any,
    goal: str = "",
    allow_execute: bool = False,
    llm: Any = None,
) -> dict[str, Any]:
    """Один такт автономии."""
    state = observe(brain, synapse_graph)

    # Порядок мозгов: NOOA (если поднят) → свой LLM → правила. Каждый следующий
    # включается молча, когда предыдущий не ответил, — автономность не должна
    # зависеть от того, что у человека сейчас запущено.
    decision: dict[str, Any] | None = ask_nooa(state, goal)
    if decision is None and llm is not None and getattr(llm, "enabled", False) and getattr(llm, "available", False):
        response = llm.ask(build_prompt(state, goal))
        if getattr(response, "ok", False):
            decision = parse_decision(response.text)
    if decision is None:
        decision = decide_deterministic(state, goal)

    outcome = hands.act(decision["action"], decision["params"], confirm=allow_execute)

    return {
        "ok": True,
        "goal": goal,
        "state": {k: state[k] for k in ("memories", "synapses", "reality")},
        "decision": decision,
        "outcome": outcome,
        "executed": bool(outcome.get("ok") and not outcome.get("dry_run")),
        "verdict": _verdict(decision, outcome),
    }


def _verdict(decision: dict[str, Any], outcome: dict[str, Any]) -> str:
    what = decision["action"]
    why = decision.get("why", "")
    if not outcome.get("ok"):
        return f"Хотел {what} ({why}), но не смог: {outcome.get('error', 'причина неизвестна')}"
    if outcome.get("dry_run"):
        return f"Решил: {what}. {why} Не выполнено — руки выключены."
    return f"Сделал: {what}. {why}"


def run(
    *,
    brain: Any,
    synapse_graph: Any,
    goal: str = "",
    steps: int = 1,
    allow_execute: bool = False,
    llm: Any = None,
) -> dict[str, Any]:
    """Несколько тактов подряд.

    Потолок в MAX_STEPS — не формальность: автономный цикл без верхней границы
    это способ незаметно сжечь и время, и токены, и терпение.
    """
    steps = max(1, min(MAX_STEPS, int(steps or 1)))
    history: list[dict[str, Any]] = []
    for _ in range(steps):
        result = step(brain=brain, synapse_graph=synapse_graph, goal=goal,
                      allow_execute=allow_execute, llm=llm)
        history.append(result)
        if not result["outcome"].get("ok"):
            break  # уперлись — дальше без разбора не идём
    return {
        "ok": True,
        "goal": goal,
        "steps": len(history),
        "hands_enabled": allow_execute,
        "history": history,
        "verdict": history[-1]["verdict"] if history else "ничего не сделано",
    }
