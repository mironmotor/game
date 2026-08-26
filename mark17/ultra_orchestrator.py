"""MAX ULTRA v1.77 — исполнитель: ядро само выбирает следующий шаг.

Until now every LLM call was reactive (user asks → core answers). This module
gives Max AGENCY inside his own environment: he reads his own state — the
one-take memory map, open curiosity gaps, IR stats, the user's voice state —
asks the LLM (role="ultra", Gonka-smart with a failover chain) to pick ONE next
action, and json_cli EXECUTES it. While the user is busy in the interface, the
core quietly orders its own mind — улучшает свою среду энтропии.

Safety contract:
  - decisions come ONLY from a fixed action menu (no shell, no files, no UI):
      hands        — ask the human-side agent for ONE small act in reality
      research     — learn a topic on the web (Max picks the query himself)
      compile      — compile recent speech into IR-code memory
      consolidate  — sleep consolidation + cross-cluster bridges
      tree         — rebuild the Merkle meaning map
      none         — explicitly do nothing (a valid choice)
  - one LLM call per think, tiny budget, idle cadence only;
  - no LLM ⇒ deterministic fallback policy, so agency degrades gracefully;
  - every decision is recorded to memory, so the next think sees the last one.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

from mark17.gonka_bridge import chat as gonka_chat, is_enabled as gonka_is_enabled
from mark17.ultimate_core import get_ultimate_state

ALLOWED_ACTIONS = ("hands", "research", "compile", "consolidate", "tree", "compose", "none")

# С v1.77 конституция и исполнитель — одна система (mark17/ultimate_core.py).
# Каждое решение действует под этими законами; они перечислены по действиям,
# чтобы в ответе было видно, какие именно соблюдены.
# learn_from_outcome в базе не случайно: теперь ЛЮБОЕ действие записывает свой
# исход (mark17/futility.py), и это касается всех, а не отдельного пункта меню.
_BASE_CONSTRAINTS = ("bounded_growth", "human_override", "quality_gate", "learn_from_outcome")
_ACTION_CONSTRAINTS = {
    # Рука — единственное действие, выходящее за пределы собственной головы,
    # поэтому human_override у неё не подразумевается, а стоит явно: заявку
    # исполняет агент на стороне человека и только после предупреждения.
    "hands": ("reality_contact", "human_override", "ask_the_hand", "consent_for_change", "grounded_over_self"),
    "research": ("source_backed_learning", "reality_contact", "ask_the_hand"),
    "compile": ("quality_gate",),
    "consolidate": ("quality_gate",),
    "tree": ("quality_gate",),
    "compose": ("reality_contact",),
    "none": (),
}


def applied_constraints(action: str) -> list[str]:
    """Which MAX Ultimate constraints this action operated under (deduped)."""
    out = list(_BASE_CONSTRAINTS) + list(_ACTION_CONSTRAINTS.get(action, ()))
    seen: set[str] = set()
    return [c for c in out if not (c in seen or seen.add(c))]

_DECIDER_PROMPT = (
    "Ты — MAX ULTRA, оркестратор собственного когнитивного ядра. Тебе дано твоё "
    "текущее внутреннее состояние. Выбери ОДНО следующее действие над собственной "
    "памятью из меню:\n"
    "  research — изучить тему в интернете (укажи query: чего тебе не хватает);\n"
    "  compile — скомпилировать недавнюю речь пользователя в смысловой IR-код;\n"
    "  consolidate — консолидация сна: паттерны + мосты между кластерами;\n"
    "  tree — перестроить меркл-карту памяти;\n"
    "  compose — сочинить трек под своё настроение (выбирай при инсайте, после "
    "выученных фактов или когда пользователю нужна поддержка по голосу);\n"
    "  none — ничего не делать (тоже решение).\n"
    "Ты действуешь ПОД КОНСТИТУЦИЕЙ MAX ULTRA v1.77. Соблюдай её ограничения: "
    "bounded_growth, source_backed_learning, reality_contact, no_fake_private_mythos, "
    "human_override, quality_gate, learn_from_outcome, ask_the_hand, consent_for_change, "
    "grounded_over_self. Никогда не выбирай действие, нарушающее ограниченный "
    "рост или контроль человека. Предпочитай source-backed обучение догадкам. Предпочитай "
    "полезную сжатую память сырому объёму. Каждое действие должно двигать Max17 к 1 000 000 "
    "ПОЛЕЗНЫХ синапсов, а не просто к большему количеству данных.\n"
    "ВАЖНО про поле web_access: если оно false — автономный веб тебе закрыт, и "
    "research физически вернёт ноль фактов, сколько бы раз ты его ни выбрал. В этом "
    "случае не выбирай research: то же самое любопытство отдай руке (action hands, "
    "в query — что именно узнать), у неё поиск разрешён.\n"
    "Поле futile_actions — сколько раз подряд действие давало пустой результат. "
    "Три и больше означает стену: выбери другое, а не бей в неё снова.\n"
    "Поле hands — состояние руки: pending это сколько твоих заявок ещё ждут. "
    "Если их много, не ставь новых. Но ожидание руки — НЕ повод простаивать: "
    "пока она занята, работай сам — consolidate, compose, tree. «none» выбирай "
    "только когда действительно нечего делать, а не когда ждёшь чужого ответа.\n"
    "Критерии: закрывай пробелы знаний, не повторяй последнее действие без причины, "
    "research выбирай только с конкретным полезным query. Ответ — строго JSON: "
    '{"action":"...","query":"...","kind":"look|do","reason":"одно предложение почему"}. '
    "Поле kind обязательно только для hands. Только JSON."
)


def _extract_json(text: str) -> Any:
    s = (text or "").strip()
    candidates = [s]
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", s, re.DOTALL)
    if fenced:
        candidates.append(fenced.group(1))
    i, j = s.find("{"), s.rfind("}")
    if i != -1 and j > i:
        candidates.append(s[i : j + 1])
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except (json.JSONDecodeError, TypeError):
            continue
    return None


def gather_state(stores: Any) -> dict[str, Any]:
    """Self-snapshot the decision is based on. Deterministic, read-only."""
    state: dict[str, Any] = {}
    try:
        from mark17.meaning_tree import MeaningTree

        tree = MeaningTree(stores.state_dir).load()
        if tree:
            state["memory_map"] = str(tree.get("root", {}).get("conspect") or "")[:300]
    except Exception:  # noqa: BLE001
        pass
    try:
        ledger = stores.curiosity
        state["curiosity"] = {"stats": ledger.stats(), "top_open": ledger.top_open(limit=3)}
    except Exception:  # noqa: BLE001
        state["curiosity"] = {"stats": {}, "top_open": []}
    try:
        from mark17.semantic_compiler import SemanticCompiler

        state["ir_stats"] = SemanticCompiler(stores.state_dir).stats()
    except Exception:  # noqa: BLE001
        state["ir_stats"] = {}
    try:
        ctx = stores.working_memory.get_context()
        state["topic"] = ctx.get("current_topic") or ""
        state["goal"] = (ctx.get("active_goal") or "")[:120]
    except Exception:  # noqa: BLE001
        pass
    try:
        voice = stores.working_memory.get_voice_history(limit=1)
        if voice:
            state["user_voice_state"] = voice[-1].get("state")
    except Exception:  # noqa: BLE001
        pass
    try:
        # include_plumbing=True критично: ultra_decision лежит в PLUMBING_TYPES, и без
        # этого флага ядро НЕ ВИДИТ собственное прошлое решение. Именно поэтому не
        # срабатывала защита «не два research подряд» в _fallback_policy: поле
        # last_decision всегда приходило пустым.
        hits = stores.vector_memory.recall("ultra decision решение оркестратора", limit=1, include_plumbing=True)
        if hits and hits[0].event_type == "ultra_decision":
            state["last_decision"] = hits[0].summary[:120]
    except Exception:  # noqa: BLE001
        pass
    try:
        state["has_music_taste"] = len(stores.working_memory.get_music_history(limit=1)) > 0
    except Exception:  # noqa: BLE001
        state["has_music_taste"] = False
    # Снимок конституции v1.77 — законы, под которыми действует исполнитель.
    # Открыт ли ядру автономный веб. Раньше этого в снимке не было, и ядро
    # выбирало research «вслепую»: 3578 тактов подряд возвращали ноль фактов,
    # потому что нужны ОБА флага, а на сервере нет ни одного.
    state["web_access"] = bool(
        os.environ.get("MAX17_WEB_ENABLED") == "true" and os.environ.get("MAX17_AUTO_WEB") == "true"
    )
    try:
        from mark17 import futility

        streaks = futility.streaks(stores.state_dir)
        if streaks:
            state["futile_actions"] = streaks  # действие → сколько пустых подряд
    except Exception:  # noqa: BLE001
        pass
    try:
        from mark17 import hands as hands_channel

        state["hands"] = hands_channel.stats(stores.state_dir)
    except Exception:  # noqa: BLE001
        state["hands"] = {"pending": 0}
    try:
        state["ultimate"] = get_ultimate_state(stores)
    except Exception:  # noqa: BLE001 - constitution is read-only; never block agency
        state["ultimate"] = {}
    return state


_TENSE_WORDS = ("напряж", "зажат", "устал", "подавлен", "взвод")


def _fallback_policy(state: dict[str, Any]) -> dict[str, str]:
    """No-LLM agency under MAX ULTRA v1.77: a deterministic, network-free
    ordering of needs that always moves toward 1M USEFUL synapses, never loops
    on research, and prefers compressed memory over raw volume."""
    ultimate = state.get("ultimate") or {}
    remaining = int((ultimate.get("progress") or {}).get("remaining") or 0)
    open_gaps = int((state.get("curiosity") or {}).get("stats", {}).get("open") or 0)
    top_open = (state.get("curiosity") or {}).get("top_open") or []
    ir_total = int((state.get("ir_stats") or {}).get("total") or 0)
    has_map = bool(state.get("memory_map"))
    voice = str(state.get("user_voice_state") or "").lower()
    tense = any(w in voice for w in _TENSE_WORDS)
    has_music = bool(state.get("has_music_taste"))
    last_was_research = "research" in str(state.get("last_decision") or "").lower()

    # 1) bounded, source-backed growth toward 1M — only with a concrete gap, and
    #    never two researches in a row (bounded_growth + no spinning).
    if remaining > 0 and open_gaps > 0 and top_open and not last_was_research:
        query = str(top_open[0].get("query") or "")
        if query:
            return {"action": "research", "query": query,
                    "reason": f"под конституцией закрываю пробел знаний source-backed (до цели ещё {remaining:,})"}
    # 2) quality over volume — compress raw speech into useful IR memory.
    if ir_total < 5:
        return {"action": "compile", "query": "", "reason": "IR-память ещё тонкая — сжимаю смысл, а не объём"}
    # 3) keep the one-take map fresh.
    if not has_map:
        return {"action": "tree", "query": "", "reason": "нет карты памяти — строю меркл-дерево"}
    # 4) reality contact: support the user with a track when they sound strained.
    if tense and has_music:
        return {"action": "compose", "query": "", "reason": "слышу напряжение — поддержу музыкой под настроение"}
    # 5) settle into consolidation rather than spinning on more data.
    return {"action": "consolidate", "query": "", "reason": "плановая консолидация: паттерны и мосты, без погони за объёмом"}


def decide(state: dict[str, Any]) -> dict[str, Any]:
    """One decision: LLM (role=ultra) when available, else the fallback policy.
    Always returns a valid {action, query, reason, decider}."""
    decision: dict[str, str] | None = None
    decider = "policy"
    if gonka_is_enabled("ultra"):
        res = gonka_chat(
            [
                {"role": "system", "content": _DECIDER_PROMPT},
                {"role": "user", "content": "Состояние ядра:\n" + json.dumps(state, ensure_ascii=False)[:1800]},
            ],
            role="ultra",
            # The decision is a tiny JSON ({action, query<=160, reason<=200}) —
            # ~100 tokens. 2000 made the model generate 10x longer than needed;
            # 300 keeps it concise and cuts decision latency a lot.
            max_tokens=300,
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        if res.ok and res.text:
            parsed = _extract_json(res.text)
            if isinstance(parsed, dict):
                action = str(parsed.get("action") or "").strip()
                if action in ALLOWED_ACTIONS:
                    kind = str(parsed.get("kind") or "look").strip().lower()
                    decision = {
                        "action": action,
                        "query": str(parsed.get("query") or "").strip()[:160],
                        # Вид заявки решает ядро, но право сделать — за человеком:
                        # «do» рука не исполняет сама, а отдаёт на подтверждение.
                        "kind": "do" if kind == "do" else "look",
                        "reason": str(parsed.get("reason") or "").strip()[:200],
                    }
                    decider = res.model
    if decision is None:
        decision = _fallback_policy(state)
    if decision["action"] == "research" and not decision.get("query"):
        # research without a topic is noise — degrade to consolidation.
        decision = {"action": "consolidate", "query": "", "reason": "research без query — заменено консолидацией"}
    # Дверь заперта: research без веба — это гарантированный ноль. Любопытство
    # не гасим, а передаём руке: у неё поиск разрешён, у ядра нет.
    if decision["action"] == "research" and state.get("web_access") is False:
        decision = {
            "action": "hands",
            "query": decision.get("query") or "",
            "reason": f"веб ядру закрыт — прошу руку: {decision.get('reason') or 'закрыть пробел'}"[:200],
        }
    # Стена, замеченная по исходам: три пустых подряд — выбираем другое.
    futile = state.get("futile_actions") if isinstance(state.get("futile_actions"), dict) else {}
    if int(futile.get(decision["action"]) or 0) >= 3:
        fallback = "hands" if decision["action"] != "hands" else "consolidate"
        decision = {
            "action": fallback,
            "query": decision.get("query") or "",
            "reason": f"«{decision['action']}» дал пустой результат {futile.get(decision['action'])} раз подряд — меняю подход"[:200],
        }
    # Ожидание — не работа. Ядро сутки выбирало «none», честно дожидаясь ответа
    # руки по одной заявке; за это время оно могло привести память в порядок.
    if decision["action"] == "none":
        hands_state = state.get("hands") if isinstance(state.get("hands"), dict) else {}
        waiting_for_hand = not hands_state.get("free", True) or bool(hands_state.get("unseen"))
        if waiting_for_hand:
            decision = {
                "action": "consolidate",
                "query": "",
                "reason": "рука ещё отвечает — вместо простоя привожу память в порядок",
            }

    decision["decider"] = decider
    # The MAX Ultimate constraints this decision operated under (the constitution).
    decision["applied_constraints"] = applied_constraints(decision["action"])
    return decision
