"""Re-embed all vector memories with the current embed_text.

Run after switching the embedding space — e.g. enabling neural embeddings
(MAX17_EMBED_NEURAL) or changing the synonym ontology — so every stored record
shares one space and cosine recall stays consistent. Restart the daemon after.

Loads .env.local automatically, so the provider (Ollama/Gemini) matches the app:

    python3 mark17/reembed.py            # uses mark17/state + .env.local
    python3 mark17/reembed.py --state-dir <dir>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def _load_env(path: Path) -> None:
    """Minimal .env loader (KEY=VALUE), without overriding real env."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip()


# Load BEFORE importing vector_memory: embedder probes the provider at import.
_load_env(_ROOT / ".env.local")

from mark17 import embedder  # noqa: E402
from mark17.vector_memory import VectorMemory  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Re-embed Max17 vector memories")
    parser.add_argument("--state-dir", type=Path, default=Path(__file__).resolve().parent / "state")
    args = parser.parse_args()

    vm = VectorMemory(args.state_dir)
    count = vm.reembed_all()
    print(
        json.dumps(
            {"ok": True, "reembedded": count, "state_dir": str(args.state_dir), "embedder": embedder.info()},
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
