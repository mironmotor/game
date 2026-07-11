"""Corpus ingest — bulk meaning into the graph. Phase 10 (road to 1M synapses).

This is the real path to a million synapses: not random Wikipedia from the
flywheel, but YOUR corpus — notes, code, books, the project's own docs —
compiled into IR-code memory and wired into the synapse graph. Each chunk runs
through the SemanticCompiler (Phase 6), so it's:

  - cached by text hash («кешированные графы»): re-ingesting is free;
  - round-trip verified: garbage compilations stay text, не загрязняют граф;
  - graph-native: every verified chunk adds ir_node/ir_attr/cause edges, which
    the bridges (Phase 5), flywheel (Phase 3) and meaning tree (Phase 7) all see.

Cheap and offline-friendly: with Ollama (bulk role) on an M2 the compiler costs
no tokens, so a corpus can stream in over hours in the background. The fallback
keyword-note compiler keeps it working with no LLM at all.

Source confinement: free text (from the HUD) is always allowed; a path is
resolved and confined to the project dir, so ingest can't read arbitrary disk.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from mark17.guardian import is_clean as _guard_clean, record as _guard_record
from mark17.semantic_compiler import SemanticCompiler

_ROOT = Path(__file__).resolve().parent.parent
# Optional whitelisted external corpus root (e.g. a dataset folder outside the
# project). Paths still resolve only within the project OR this single root —
# never arbitrary disk. Set MAX17_CORPUS_ROOT to enable.
_CORPUS_ROOT = os.environ.get("MAX17_CORPUS_ROOT", "").strip()
_SENT_SPLIT = re.compile(r"(?<=[.!?。…])\s+|\n{2,}|\r?\n(?=\s*[-*•\d])")
MIN_CHUNK = 12
MAX_CHUNK = 320
MAX_CHUNKS_DEFAULT = 300
MAX_FILE_BYTES = 8_000_000  # читаем до ~8МБ с файла (хватает на тысячи записей; не взрывает память)
# Files we read for path ingest — text-ish only, never binaries/secrets/state.
_TEXT_SUFFIXES = {
    ".md", ".txt", ".py", ".ts", ".tsx", ".js", ".json", ".jsonl", ".css",
    ".rst", ".csv", ".tsv", ".yml", ".yaml",
}
_SKIP_DIRS = {".git", "node_modules", ".next", "state", "__pycache__", ".venv", "certificates"}


def chunk_text(text: str, *, min_len: int = MIN_CHUNK, max_len: int = MAX_CHUNK) -> list[str]:
    """Split prose/code into compile-sized chunks: sentence/paragraph/bullet
    boundaries, merge fragments that are too short, hard-wrap anything too long."""
    raw = [p.strip() for p in _SENT_SPLIT.split(str(text or "")) if p and p.strip()]
    chunks: list[str] = []
    buf = ""
    for part in raw:
        if len(part) > max_len:
            if buf:
                chunks.append(buf)
                buf = ""
            for i in range(0, len(part), max_len):
                piece = part[i : i + max_len].strip()
                if len(piece) >= min_len:
                    chunks.append(piece)
            continue
        candidate = f"{buf} {part}".strip() if buf else part
        if len(candidate) <= max_len:
            buf = candidate
        else:
            if buf:
                chunks.append(buf)
            buf = part
        if len(buf) >= min_len and (buf.endswith((".", "!", "?", "…")) or len(buf) >= max_len * 0.8):
            chunks.append(buf)
            buf = ""
    if len(buf) >= min_len:
        chunks.append(buf)
    # de-dup consecutive identical chunks, drop anything still too short
    out: list[str] = []
    for c in chunks:
        if len(c) >= min_len and (not out or out[-1] != c):
            out.append(c)
    return out


def ingest_text(
    text: str,
    *,
    source: str,
    compiler: SemanticCompiler,
    vector_memory: Any,
    synapse_graph: Any,
    max_chunks: int = MAX_CHUNKS_DEFAULT,
) -> dict[str, Any]:
    """Compile a blob of text chunk-by-chunk into the graph. Idempotent (cache)."""
    chunks = chunk_text(text)[: max(1, max_chunks)]
    before = synapse_graph.count()
    compiled = cached = unverified = units = blocked = 0
    samples: list[str] = []
    for chunk in chunks:
        if not _guard_clean(chunk):
            blocked += 1  # Ангел безопасности: война/политика/пороки — не в ядро
            continue
        ir = compiler.compile_text(chunk, vector_memory=vector_memory, synapse_graph=synapse_graph)
        if ir.get("cached"):
            cached += 1
        elif ir.get("verified"):
            compiled += 1
            units += len(ir.get("units") or [])
            if len(samples) < 3 and ir.get("ir_text"):
                samples.append(str(ir["ir_text"]).replace("\n", " ")[:120])
        else:
            unverified += 1
    if blocked:
        _guard_record(blocked)
    after = synapse_graph.count()
    return {
        "source": source,
        "chunks": len(chunks),
        "compiled": compiled,
        "cached": cached,
        "blocked": blocked,
        "unverified": unverified,
        "ir_units": units,
        "synapses_before": before,
        "synapses_after": after,
        "synapses_added": after - before,
        "ir_samples": samples,
    }


def _within(target: Path, root: Path) -> bool:
    return target == root or root in target.parents


def _display(p: Path) -> str:
    """Path for reporting/source: relative to project, else to corpus root, else abs."""
    try:
        return str(p.relative_to(_ROOT))
    except ValueError:
        pass
    if _CORPUS_ROOT:
        try:
            return str(p.relative_to(Path(_CORPUS_ROOT).resolve()))
        except ValueError:
            pass
    return str(p)


def _safe_path(rel: str) -> Path | None:
    # 1) project-relative (preferred when it actually exists)
    target = (_ROOT / rel).resolve()
    if _within(target, _ROOT) and target.exists():
        return target
    # 2) whitelisted external corpus root (if configured) — relative or absolute
    if _CORPUS_ROOT:
        root = Path(_CORPUS_ROOT).resolve()
        cand = (root / rel).resolve()
        if _within(cand, root) and cand.exists():
            return cand
        if _within(target, root) and target.exists():
            return target
    # nothing existing matched: return the confined project candidate for a clean
    # "not found" error, or None if the path escapes the project entirely.
    return target if _within(target, _ROOT) else None


def _iter_files(target: Path) -> list[Path]:
    if target.is_file():
        return [target] if target.suffix.lower() in _TEXT_SUFFIXES else []
    files: list[Path] = []
    for path in sorted(target.rglob("*")):
        if any(part in _SKIP_DIRS for part in path.parts):
            continue
        if path.is_file() and path.suffix.lower() in _TEXT_SUFFIXES:
            files.append(path)
    return files


def ingest_path(
    rel: str,
    *,
    compiler: SemanticCompiler,
    vector_memory: Any,
    synapse_graph: Any,
    max_files: int = 40,
    max_chunks_per_file: int = 120,
) -> dict[str, Any]:
    """Ingest a project file or folder (confined to the project dir)."""
    target = _safe_path(rel)
    if target is None or not target.exists():
        return {"error": f"путь недоступен или вне проекта: {rel}", "files": 0, "synapses_added": 0}
    before = synapse_graph.count()
    files = _iter_files(target)[: max(1, max_files)]
    per_file: list[dict[str, Any]] = []
    total_compiled = 0
    for path in files:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")[:MAX_FILE_BYTES]
        except Exception:  # noqa: BLE001
            continue
        res = ingest_text(
            text,
            source=_display(path),
            compiler=compiler,
            vector_memory=vector_memory,
            synapse_graph=synapse_graph,
            max_chunks=max_chunks_per_file,
        )
        total_compiled += res["compiled"]
        per_file.append({"file": res["source"], "compiled": res["compiled"], "cached": res["cached"]})
    after = synapse_graph.count()
    return {
        "root": _display(target) if target != _ROOT else ".",
        "files": len(files),
        "compiled": total_compiled,
        "synapses_before": before,
        "synapses_after": after,
        "synapses_added": after - before,
        "per_file": per_file[:20],
    }
