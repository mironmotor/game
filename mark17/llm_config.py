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
import sys
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent
_STATE = _ROOT / "mark17" / "state" / "llm_active.json"

DEFAULT_BASE_URL = "https://proxy.gonkabroker.com/v1"
DEFAULT_MODEL = "Qwen/Qwen3-235B-A22B-Instruct-2507-FP8"
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
    "code": "gonka-qwen3",
    "architect": "gonka-qwen3",
    "desktop": "gonka-qwen3",
    # Bulk graph growth should be cheap. If Ollama is not running, it will fail
    # soft and the deterministic pipeline remains the fallback.
    "bulk": "ollama-0.5b",
    # Ultra decides the core's OWN next action — needs judgment, calls are rare
    # (idle cadence) and tiny, so the smart model is worth it.
    "ultra": "gonka-qwen3",
}

# Resilience ladder per role: if the resolved primary backend fails (provider
# down / 401 / timeout), the bridge automatically tries the next AVAILABLE
# candidate before giving up to the deterministic core. This is why a single
# provider dying (Gonka 401, Gemini 429) no longer takes every feature dark.
# Order = preference; unavailable presets (no key / Ollama down) are skipped.
FALLBACK_CHAINS = {
    "chat": ["gonka-qwen3", "gemini", "groq", "ollama-3b"],
    "code": ["gonka-qwen3", "gonka-kimi", "gemini", "groq"],
    "architect": ["gonka-qwen3", "gonka-kimi", "gemini"],
    "desktop": ["gonka-qwen3", "gemini", "groq"],
    "bulk": ["ollama-0.5b", "ollama-3b", "gemini"],
    "ultra": ["gonka-qwen3", "gonka-kimi", "gemini"],
}

# id -> preset. `key` = literal API key; `key_env` = env var holding the key.
PRESETS: dict[str, dict[str, Any]] = {
    "ollama-0.5b": {
        "label": "Ollama qwen2.5:0.5b — локально, быстро/слабо",
        "base": "http://127.0.0.1:11434/v1",
        "key": "ollama",
        "model": "qwen2.5:0.5b",
        "local": True,
    },
    "ollama-3b": {
        "label": "Ollama qwen2.5:3b — локально, умнее/медленнее",
        "base": "http://127.0.0.1:11434/v1",
        "key": "ollama",
        "model": "qwen2.5:3b",
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


def _preset_key(preset: dict[str, Any]) -> str:
    if preset.get("key"):
        return str(preset["key"])
    env_name = preset.get("key_env")
    return os.environ.get(str(env_name), "") if env_name else ""


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
        if default in PRESETS and _preset_key(PRESETS[default]):
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
        if not key:
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
        out.append(resolve(role))
    return out


# Answer-length cap per backend: small for slow local CPU (snappy), large for
# fast cloud models (richer). Overrides the MAX17_VOICE_MAX_TOKENS env fallback.
_VOICE_MAX = {
    "ollama-0.5b": 200,
    "ollama-3b": 240,
    "gemini": 700,
    "groq": 700,
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
    for pid, p in PRESETS.items():
        items.append(
            {
                "id": pid,
                "label": p["label"],
                "model": p["model"],
                "local": bool(p.get("local")),
                "available": bool(_preset_key(p)),
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
