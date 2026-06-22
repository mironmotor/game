"""Configuration loader for GAME MARKET CORE.

Loads ``config.yaml``. PyYAML is used when available; otherwise a small
pure-stdlib parser handles the limited YAML subset this project uses
(nested mappings, scalars, inline ``[a, b]`` lists, comments). This keeps
Stage 1 runnable with zero third-party dependencies.
"""

from __future__ import annotations

import os
from typing import Any

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.yaml")


def _coerce(value: str) -> Any:
    """Turn a raw scalar string into int/float/bool/None/str."""
    v = value.strip()
    if v == "" or v in {"~", "null", "None"}:
        return None
    if v.lower() in {"true", "yes", "on"}:
        return True
    if v.lower() in {"false", "no", "off"}:
        return False
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        return v[1:-1]
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        if not inner:
            return []
        return [_coerce(item) for item in inner.split(",")]
    try:
        if "." in v or "e" in v.lower():
            return float(v)
        return int(v)
    except ValueError:
        return v


def _minimal_yaml(text: str) -> dict:
    """Parse the limited YAML subset used by this project.

    Supports comments, blank lines, two-space-indented nested mappings,
    ``key: value`` scalars, and inline ``[a, b, c]`` lists. It deliberately
    does not implement block lists, anchors, or multi-line strings.
    """
    root: dict = {}
    # Stack of (indent, container) frames.
    stack: list[tuple[int, dict]] = [(-1, root)]

    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip(" "))
        key, _, rest = line.strip().partition(":")
        key = key.strip()

        while stack and indent <= stack[-1][0]:
            stack.pop()
        if not stack:
            stack = [(-1, root)]
        container = stack[-1][1]

        if rest.strip() == "":
            child: dict = {}
            container[key] = child
            stack.append((indent, child))
        else:
            container[key] = _coerce(rest)
    return root


def load_config(path: str | None = None) -> dict:
    path = path or CONFIG_PATH
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    try:
        import yaml  # type: ignore

        data = yaml.safe_load(text)
        return data or {}
    except Exception:
        return _minimal_yaml(text)


def get(cfg: dict, dotted: str, default: Any = None) -> Any:
    """Fetch ``a.b.c`` from a nested config dict with a default."""
    node: Any = cfg
    for part in dotted.split("."):
        if not isinstance(node, dict) or part not in node:
            return default
        node = node[part]
    return node
