"""Runtime LLM backend selector.

The HUD can switch the active model on the fly: the choice is stored in a small
JSON file that `gonka_bridge` reads on every call, so switching takes effect
without a restart. v0.2 supports per-role overrides so chat, code, desktop,
architect and bulk graph jobs can use different backends.

Presets carry base_url + model + how to get the API key (a literal for Ollama, or
an env var for cloud providers). A preset is "available" only if its key resolves.
If no choice is stored, we fall back to the GONKA_* env vars (.env.local).
"""

from __future__ import annotations

import json
import os
import socket
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent
_STATE = _ROOT / "mark17" / "state" / "llm_active.json"

DEFAULT_BASE_URL = "https://proxy.gonkabroker.com/v1"
DEFAULT_MODEL = "deepseek-ai/DeepSeek-V4-Flash-0731"


def _openai_base(env_name: str, default: str) -> str:
    """Base URL локального бэкенда с /v1 на конце.

    Адрес берётся из env, поэтому одну и ту же сборку можно запустить и на
    маке (127.0.0.1), и на другой машине локалки / на дроплете через обратный
    SSH-туннель — достаточно выставить MAX17_OLLAMA_HOST=http://192.168.1.103:11434.
    """
    base = (os.environ.get(env_name) or default).strip().rstrip("/")
    return base if base.endswith("/v1") else base + "/v1"


# Ollama держит мелкие модели, llama-server — Bonsai-27B, LM Studio — Qwen3.
OLLAMA_BASE = _openai_base("MAX17_OLLAMA_HOST", "http://127.0.0.1:11434")
BONSAI_BASE = _openai_base("MAX17_BONSAI_HOST", "http://127.0.0.1:8127")
LMSTUDIO_BASE = _openai_base("MAX17_LMSTUDIO_HOST", "http://127.0.0.1:1234")

ROLES = ("chat", "code", "architect", "desktop", "bulk", "ultra")
ROLE_LABELS = {
    "chat": "Чат",
    "code": "Код",
    "architect": "Архитектор",
    "desktop": "Desktop",
    "bulk": "Bulk ingest",
    "ultra": "Ультра-оркестратор",
}
ROLE_DEFAULTS = {
    # On Air 2015 local Ollama can be slow; prefer the selected/global cloud
    # preset for chat unless the user explicitly sets a local override.
    "chat": None,
    # Брокер отдаёт четыре модели: DeepSeek-V4-Flash, MiniMax-M2.7, Kimi-K2.6 и
    # эмбеддер BGE-M3 (Qwen3-235B он больше НЕ отдаёт — оттуда 404 и провал в
    # Gemini). Основной теперь DeepSeek-V4-Flash: 400k контекста против 205k у
    # MiniMax, $0.25/млн против $0.30, tools поддерживает. MiniMax остаётся
    # первым в лестнице отката, так что ошибка DeepSeek ничего не гасит.
    "code": "gonka-deepseek",
    "architect": "gonka-deepseek",
    "desktop": "gonka-deepseek",
    # Bulk graph growth should be cheap. If Ollama is not running, it will fail
    # soft and the deterministic pipeline remains the fallback.
    "bulk": "ollama-0.5b",
    # Ultra decides the core's OWN next action — needs judgment, calls are rare
    # (idle cadence) and tiny, so the smart model is worth it.
    "ultra": "gonka-deepseek",
}

# Resilience ladder per role: if the resolved primary backend fails (provider
# down / 401 / timeout), the bridge automatically tries the next AVAILABLE
# candidate before giving up to the deterministic core. This is why a single
# provider dying (Gonka 401, Gemini 429) no longer takes every feature dark.
# Order = preference; unavailable presets (no key / Ollama down) are skipped.
FALLBACK_CHAINS = {
    # Локальные модели (LM Studio :1234, Bonsai :8127) стоят ПЕРЕД Gemini: свой
    # сервер без лимитов лучше, чем 429 на бесплатном тарифе Gemini.
    "chat": ["gonka-deepseek", "gonka-minimax", "gonka-kimi", "lmstudio-qwen3", "bonsai-27b", "gemini", "groq", "ollama-3b"],
    "code": ["gonka-deepseek", "gonka-minimax", "gonka-kimi", "lmstudio-qwen3", "bonsai-27b", "gemini", "groq"],
    "architect": ["gonka-deepseek", "gonka-minimax", "gonka-kimi", "bonsai-27b", "lmstudio-qwen3", "gemini"],
    "desktop": ["gonka-deepseek", "gonka-minimax", "gonka-kimi", "lmstudio-qwen3", "gemini", "groq"],
    # Bulk растит граф пачками: сначала дешёвая локальная мелочь, потом Bonsai
    # (27 млрд параметров без счётчика токенов), и только затем облако.
    "bulk": ["ollama-0.5b", "ollama-3b", "bonsai-27b", "lmstudio-qwen3", "gonka-deepseek", "gemini"],
    "ultra": ["gonka-deepseek", "gonka-minimax", "gonka-kimi", "lmstudio-qwen3", "bonsai-27b", "gemini"],
}

# id -> preset. `key` = literal API key; `key_env` = env var holding the key.
PRESETS: dict[str, dict[str, Any]] = {
    "ollama-0.5b": {
        "label": "Ollama qwen2.5:0.5b — локально, быстро/слабо",
        "base": OLLAMA_BASE,
        "key": "ollama",
        "model": "qwen2.5:0.5b",
        "local": True,
    },
    "ollama-3b": {
        "label": "Ollama qwen2.5:3b — локально, умнее/медленнее",
        "base": OLLAMA_BASE,
        "key": "ollama",
        "model": "qwen2.5:3b",
        "local": True,
    },
    "ollama-qwen3": {
        # Тег был `qwen3:4b` — такой модели в Ollama нет, и каждый вызов
        # возвращал 404. Реально скачан `qwen3-vl:4b` (он же и текст умеет).
        "label": "Ollama Qwen3-VL 4B — локально, суверенно (8 ГБ-friendly)",
        "base": OLLAMA_BASE,
        "key": "ollama",
        "model": "qwen3-vl:4b",
        "local": True,
    },
    "bonsai-27b": {
        "label": "Bonsai-27B — локально, 27 млрд параметров (~1.13 бита/пар.)",
        "base": BONSAI_BASE,
        "key": "llama-cpp",
        "model": "bonsai-27b",
        "local": True,
    },
    "lmstudio-qwen3": {
        "label": "LM Studio · Qwen3 4B — локально, сервер :1234",
        "base": LMSTUDIO_BASE,
        "key": "lm-studio",
        "model": "qwen3-4b",
        "local": True,
    },
    "gemini": {
        "label": "Gemini 2.5 Flash — облако, умно (есть лимиты)",
        "base": "https://generativelanguage.googleapis.com/v1beta/openai",
        "key_env": "GEMINI_API_KEY",
        "model": "gemini-2.5-flash",
    },
    "groq": {
        "label": "Groq Llama-3.3-70B — облако, быстро+умно",
        "base": "https://api.groq.com/openai/v1",
        "key_env": "GROQ_API_KEY",
        "model": "llama-3.3-70b-versatile",
    },
    "gonka-qwen3": {
        "label": "Gonka · Qwen3-235B — умно, дёшево, без лимитов",
        "base": "https://proxy.gonkabroker.com/v1",
        "key_env": "GONKA_API_KEY",
        "model": "Qwen/Qwen3-235B-A22B-Instruct-2507-FP8",
    },
    "gonka-deepseek": {
        "label": "Gonka · DeepSeek-V4-Flash — 400k контекст, самый дешёвый",
        "base": "https://proxy.gonkabroker.com/v1",
        "key_env": "GONKA_API_KEY",
        "model": "deepseek-ai/DeepSeek-V4-Flash-0731",
    },
    # ── Anthropic. Единственный бэкенд не по OpenAI-протоколу: мост узнаёт его
    # по адресу и переключается на Messages API (mark17/gonka_bridge.py).
    # Цена честно вынесена в подпись: у Fable выход стоит в 200 раз дороже, чем
    # у DeepSeek, поэтому в лестницы отката он НЕ добавлен — только ручной выбор
    # или назначение на роль, где решений мало, а цена ошибки высока.
    "claude-fable": {
        "label": "Claude Fable 5 — самый сильный, $10/$50 за млн (дорого)",
        "base": "https://api.anthropic.com/v1",
        "key_env": "ANTHROPIC_API_KEY",
        "model": "claude-fable-5",
    },
    "claude-opus": {
        "label": "Claude Opus 5 — сильный, $5/$25 за млн",
        "base": "https://api.anthropic.com/v1",
        "key_env": "ANTHROPIC_API_KEY",
        "model": "claude-opus-5",
    },
    "gonka-kimi": {
        "label": "Gonka · Kimi-K2.6 — большой ризонер",
        "base": "https://proxy.gonkabroker.com/v1",
        "key_env": "GONKA_API_KEY",
        "model": "moonshotai/Kimi-K2.6",
    },
    "gonka-minimax": {
        "label": "Gonka · MiniMax-M2.7 — облако",
        "base": "https://proxy.gonkabroker.com/v1",
        "key_env": "GONKA_API_KEY",
        "model": "MiniMaxAI/MiniMax-M2.7",
    },
}

_LOCAL_PROBE_TTL_SEC = 30.0  # было 10: перепроверять туннель каждые 10 с — дорого
# Кэш проб держим НА ДИСКЕ, а не только в памяти. Каждый вызов панели — новый
# python-процесс (Next спавнит его на запрос), поэтому кэш в памяти умирал, не
# дожив до второго запроса, и каждый раз заново платился полный обход туннеля.
_PROBE_CACHE_FILE = _ROOT / "mark17" / "state" / "local_probe_cache.json"
_LOCAL_PROBE_CACHE: dict[str, tuple[float, bool, str]] = {}
_probe_cache_loaded = False


def _preset_key(preset: dict[str, Any]) -> str:
    if preset.get("key"):
        return str(preset["key"])
    env_name = preset.get("key_env")
    return os.environ.get(str(env_name), "") if env_name else ""


# Второй, длинный шанс для бэкендов за туннелем.
_TUNNEL_PROBE_SEC = 2.5


def _local_models_url(base: str) -> str:
    return base.rstrip("/") + "/models"


def _local_status(preset_id: str, preset: dict[str, Any], *, timeout: float = 0.35) -> tuple[bool, str]:
    """Fast cached health check for local OpenAI-compatible backends.

    Две попытки, и это не перестраховка. «Локальный» бэкенд теперь не всегда
    localhost: дроплет ходит к моделям мака через обратный SSH-туннель
    (127.0.0.1:7127 → 8127), и путь дроплет → интернет → мак в 350 мс не
    укладывается — Bonsai и Ollama показывались красными, хотя отвечали. Закрытый
    порт при этом даёт мгновенный отказ соединения, а не таймаут, поэтому вторую
    попытку получают только те, кто именно НЕ УСПЕЛ ответить.
    """
    if not preset.get("local"):
        return bool(_preset_key(preset)), "key" if _preset_key(preset) else "missing_key"
    now = time.time()
    cached = _LOCAL_PROBE_CACHE.get(preset_id)
    if cached and now - cached[0] < _LOCAL_PROBE_TTL_SEC:
        return cached[1], cached[2]
    url = _local_models_url(str(preset.get("base") or ""))
    ok = False
    reason = "local_offline:unknown"
    for attempt_timeout in (timeout, _TUNNEL_PROBE_SEC):
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=attempt_timeout) as resp:  # noqa: S310 - localhost/tunnel
                ok = 200 <= int(getattr(resp, "status", 0)) < 300
            reason = "local_online" if ok else "local_unhealthy"
            break
        except socket.timeout:
            reason = "local_offline:timeout"
            continue  # медленный путь (туннель) — даём второй, длинный шанс
        except Exception as exc:  # noqa: BLE001 - offline local backend is expected.
            ok = False
            reason = f"local_offline:{type(exc).__name__}"
            break
    _LOCAL_PROBE_CACHE[preset_id] = (now, ok, reason)
    return ok, reason


def _load_probe_cache() -> None:
    """Поднимает кэш проб с диска — один раз на процесс."""
    global _probe_cache_loaded
    if _probe_cache_loaded:
        return
    _probe_cache_loaded = True
    try:
        raw = json.loads(_PROBE_CACHE_FILE.read_text(encoding="utf-8"))
        now = time.time()
        for pid, row in (raw or {}).items():
            ts, ok, reason = float(row[0]), bool(row[1]), str(row[2])
            if now - ts < _LOCAL_PROBE_TTL_SEC:
                _LOCAL_PROBE_CACHE[pid] = (ts, ok, reason)
    except Exception:  # noqa: BLE001 - нет кэша или он битый: просто прозондируем заново
        pass


def _save_probe_cache() -> None:
    try:
        _PROBE_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = _PROBE_CACHE_FILE.with_suffix(".tmp")
        tmp.write_text(
            json.dumps({pid: [ts, ok, reason] for pid, (ts, ok, reason) in _LOCAL_PROBE_CACHE.items()}),
            encoding="utf-8",
        )
        tmp.replace(_PROBE_CACHE_FILE)
    except Exception:  # noqa: BLE001 - кэш не критичен
        pass


def _warm_local_probes() -> None:
    """Опрашивает все локальные бэкенды разом и раскладывает ответы по кэшу."""
    _load_probe_cache()
    now = time.time()
    stale = [
        (pid, preset)
        for pid, preset in PRESETS.items()
        if preset.get("local")
        and not (
            (cached := _LOCAL_PROBE_CACHE.get(pid)) and now - cached[0] < _LOCAL_PROBE_TTL_SEC
        )
    ]
    if len(stale) < 2:
        return  # одну пробу распараллеливать незачем
    try:
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=min(6, len(stale))) as pool:
            list(pool.map(lambda item: _local_status(item[0], item[1]), stale))
    except Exception:  # noqa: BLE001 - без пула просто вернёмся к последовательным пробам
        pass
    _save_probe_cache()


def _preset_available(preset_id: str, preset: dict[str, Any]) -> bool:
    return _local_status(preset_id, preset)[0] if preset.get("local") else bool(_preset_key(preset))


def available_for_role(role: str | None = None) -> bool:
    return bool(resolve_chain(role))


def _read_state() -> dict[str, Any]:
    try:
        data = json.loads(_STATE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001 - missing/garbage file => no override
        return {}


def _write_state(data: dict[str, Any]) -> bool:
    try:
        _STATE.parent.mkdir(parents=True, exist_ok=True)
        _STATE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return True
    except Exception:  # noqa: BLE001
        return False


def get_active() -> str | None:
    data = _read_state()
    active = str(data.get("active") or "")
    return active if active in PRESETS else None


def _role_state() -> dict[str, str]:
    data = _read_state()
    roles = data.get("roles")
    if not isinstance(roles, dict):
        return {}
    out: dict[str, str] = {}
    for role, preset_id in roles.items():
        if str(role) in ROLES and str(preset_id) in PRESETS:
            out[str(role)] = str(preset_id)
    return out


def get_role_active(role: str) -> str | None:
    return _role_state().get(role)


def set_active(preset_id: str) -> bool:
    if preset_id not in PRESETS:
        return False
    data = _read_state()
    data["active"] = preset_id
    roles = data.get("roles")
    if isinstance(roles, dict):
        data["roles"] = {k: v for k, v in roles.items() if k in ROLES and v in PRESETS}
    return _write_state(data)


def set_role_active(role: str, preset_id: str | None) -> bool:
    if role not in ROLES:
        return False
    data = _read_state()
    roles = data.get("roles")
    roles = roles if isinstance(roles, dict) else {}
    roles = {k: v for k, v in roles.items() if k in ROLES and v in PRESETS}
    if preset_id in (None, "", "auto"):
        roles.pop(role, None)
    elif preset_id in PRESETS:
        roles[role] = preset_id
    else:
        return False
    data["roles"] = roles
    active = str(data.get("active") or "")
    if active and active not in PRESETS:
        data.pop("active", None)
    return _write_state(data)


def resolve_preset_id(role: str | None = None) -> str | None:
    if role in ROLES:
        explicit = get_role_active(str(role))
        if explicit:
            return explicit
        default = ROLE_DEFAULTS.get(str(role))
        if default in PRESETS and _preset_available(default, PRESETS[default]):
            return default
    return get_active()


def resolve(role: str | None = None) -> tuple[str, str, str]:
    """(base_url, api_key, model) for role preset, active preset, or env."""
    preset_id = resolve_preset_id(role)
    if preset_id:
        p = PRESETS[preset_id]
        return str(p["base"]).rstrip("/"), _preset_key(p), str(p["model"])
    return (
        (os.environ.get("GONKA_BASE_URL") or DEFAULT_BASE_URL).rstrip("/"),
        os.environ.get("GONKA_API_KEY", "").strip(),
        (os.environ.get("GONKA_MODEL") or DEFAULT_MODEL).strip(),
    )


def resolve_chain(role: str | None = None) -> list[tuple[str, str, str]]:
    """Ordered (base_url, key, model) candidates for a role, best first.

    The resolved primary comes first, then the role's FALLBACK_CHAINS — keeping
    only candidates whose key is available, de-duped by model. If nothing has a
    key (all cloud keys missing, Ollama down), the env fallback is returned so
    behavior never gets worse than the single-resolve path.
    """
    out: list[tuple[str, str, str]] = []
    seen: set[str] = set()

    def _add(pid: str | None) -> None:
        if pid not in PRESETS:
            return
        p = PRESETS[pid]
        key = _preset_key(p)
        if not key or not _preset_available(pid, p):
            return
        model = str(p["model"])
        if model in seen:
            return
        seen.add(model)
        out.append((str(p["base"]).rstrip("/"), key, model))

    _add(resolve_preset_id(role))
    for pid in FALLBACK_CHAINS.get(str(role), []):
        _add(pid)
    if not out:
        env_key = os.environ.get("GONKA_API_KEY", "").strip()
        if env_key:
            out.append(
                (
                    (os.environ.get("GONKA_BASE_URL") or DEFAULT_BASE_URL).rstrip("/"),
                    env_key,
                    (os.environ.get("GONKA_MODEL") or DEFAULT_MODEL).strip(),
                )
            )
    return out


# Answer-length cap per backend: small for slow local CPU (snappy), large for
# fast cloud models (richer). Overrides the MAX17_VOICE_MAX_TOKENS env fallback.
_VOICE_MAX = {
    "ollama-0.5b": 200,
    "ollama-3b": 240,
    "gemini": 700,
    "groq": 700,
    "bonsai-27b": 220,
    "claude-fable": 900,
    "claude-opus": 900,
    "gonka-deepseek": 900,
    "gonka-qwen3": 800,
    "gonka-kimi": 800,
    "gonka-minimax": 800,
}


def voice_max_tokens(role: str | None = None) -> int:
    preset_id = resolve_preset_id(role)
    if preset_id in _VOICE_MAX:
        return _VOICE_MAX[preset_id]
    env = os.environ.get("MAX17_VOICE_MAX_TOKENS")
    if env:
        try:
            return max(64, min(4000, int(env)))
        except (TypeError, ValueError):
            pass
    return 512


def list_presets() -> dict[str, Any]:
    active = get_active()
    role_active = _role_state()
    items = []
    # Прогреваем кэш проб ПАРАЛЛЕЛЬНО: пять локальных бэкендов, каждый со своим
    # таймаутом, последовательно давали 11 с на /api/llm-config. Пробы независимы,
    # поэтому общее время должно равняться самой медленной, а не их сумме.
    _warm_local_probes()

    for pid, p in PRESETS.items():
        available, reason = _local_status(pid, p) if p.get("local") else (bool(_preset_key(p)), "key" if _preset_key(p) else "missing_key")
        items.append(
            {
                "id": pid,
                "label": p["label"],
                "model": p["model"],
                "local": bool(p.get("local")),
                "available": available,
                "availability": reason,
                "active": pid == active,
            }
        )
    # If no preset is active, the env (.env.local) backend is in effect.
    _, _, env_model = resolve()
    role_rows = []
    for role in ROLES:
        resolved = resolve_preset_id(role)
        role_rows.append(
            {
                "id": role,
                "label": ROLE_LABELS.get(role, role),
                "active": role_active.get(role),
                "resolved": resolved,
                "auto": role not in role_active,
                "model": (PRESETS.get(resolved or "", {}).get("model") if resolved else env_model),
            }
        )
    return {"presets": items, "active": active, "roles": role_rows, "env_model": env_model}


def main() -> int:
    raw = sys.stdin.read()
    try:
        req = json.loads(raw) if raw.strip() else {}
    except Exception:  # noqa: BLE001
        req = {}
    if str(req.get("action") or "list") == "set":
        role = str(req.get("role") or "")
        preset_id = str(req.get("id") or "")
        ok = set_role_active(role, preset_id) if role else set_active(preset_id)
        out = {"ok": ok, **list_presets()}
    else:
        out = {"ok": True, **list_presets()}
    sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
