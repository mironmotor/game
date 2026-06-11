"""Semantic compiler — Phase 6 (MAX ULTRA): speech → IR-code, not text.

A sentence is compiled into a tiny intermediate representation (IR) with a FIXED
vocabulary — the "least linguistic" form that still carries the meaning. RU and
EN compile to the same shapes, duplicates collapse by content hash, and the IR
lands in the synapse graph as first-class nodes, so bridges / flywheel / recall
work over compiled meaning for free.

Honesty contract (verify→fix philosophy):
  - the LLM is just the front-end compiler (role="bulk", cheap); its output is
    validated against the fixed schema;
  - every compilation is ROUND-TRIP checked: IR → deterministic verbalization →
    embedding cosine vs the source text. Below threshold ⇒ NOT verified, and the
    caller keeps plain text as the memory of record;
  - compilations are cached by text hash («кешированные графы»): the same phrase
    is compiled once, forever. Offline / no-LLM falls back to a deterministic
    keyword "note" unit — graceful, marked compiler="fallback".

IR unit kinds (fixed): entity | state | event | goal | cause | note.
Relations rendered into the graph: attrs → related_to, cause → leads_to.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import time
from pathlib import Path
from typing import Any

from mark17.events import Event
from mark17.gonka_bridge import chat as gonka_chat, is_enabled as gonka_is_enabled
from mark17.vector_memory import VectorMemory, cosine_similarity, embed_text

KINDS = frozenset({"entity", "state", "event", "goal", "cause", "note"})
# Round-trip gate: n-gram cosines are graded (related sentences ≈ 0.05–0.25, and
# a faithful verbalization shares many tokens with the source, landing higher).
MIN_SIM = float(os.environ.get("MAX17_IR_MIN_SIM", "0.15") or 0.15)
_TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9_\-]+")
_STOP = frozenset(
    {
        "и", "а", "но", "что", "это", "как", "в", "на", "с", "по", "у", "не", "же",
        "то", "за", "из", "для", "она", "он", "они", "мы", "ты", "я", "его", "ее",
        "её", "их", "был", "была", "было", "есть", "сейчас", "очень", "просто",
        "the", "a", "an", "is", "are", "was", "and", "or", "of", "to", "in", "it",
    }
)

_COMPILER_PROMPT = (
    "Ты — семантический компилятор Max17. Преврати фразу пользователя в МИНИМАЛЬНЫЙ "
    "смысловой код (IR) — строгий JSON без пояснений:\n"
    '{"units":[{"kind":"entity|state|event|goal","id":"snake_id","about":"id-сущности",'
    '"attrs":{"ключ":"значение"}},{"kind":"cause","from":"id","to":"id"}]}\n'
    "Правила: id — короткие латинские snake_case; attrs — самые простые пары "
    "(age, rel, what, count, outcome, avoid, since, want…); значения держи на языке "
    "оригинала только для имён собственных, остальное — простыми словами; "
    "НЕ выдумывай фактов, которых нет во фразе; cause связывает событие/состояние "
    "причиной. 3-8 юнитов максимум. Только JSON."
)


def _extract_json(text: str) -> Any:
    """Tolerant JSON extraction: providers sometimes wrap json_object output in
    markdown fences or prefix prose. Try raw, fenced, then outermost braces."""
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


def text_hash(text: str) -> str:
    return hashlib.blake2b(" ".join(str(text).lower().split()).encode("utf-8"), digest_size=12).hexdigest()


def _tokens(text: str) -> list[str]:
    return [t for t in _TOKEN_RE.findall(str(text).casefold()) if len(t) >= 3 and t not in _STOP]


def _valid_units(raw: Any) -> list[dict[str, Any]]:
    """Schema gate for the LLM output: only fixed kinds, only simple fields."""
    units_in = raw.get("units") if isinstance(raw, dict) else raw
    if not isinstance(units_in, list):
        return []
    out: list[dict[str, Any]] = []
    for u in units_in[:10]:
        if not isinstance(u, dict):
            continue
        kind = str(u.get("kind") or "").strip()
        if kind not in KINDS:
            continue
        if kind == "cause":
            f, t = str(u.get("from") or "").strip(), str(u.get("to") or "").strip()
            if f and t and f != t:
                out.append({"kind": "cause", "from": f[:40], "to": t[:40]})
            continue
        uid = str(u.get("id") or "").strip()[:40]
        if not uid:
            continue
        attrs_in = u.get("attrs") if isinstance(u.get("attrs"), dict) else {}
        attrs = {}
        for k, v in list(attrs_in.items())[:8]:
            ks = str(k).strip()[:30]
            if not ks:
                continue
            attrs[ks] = (v if isinstance(v, (int, float)) else str(v)[:60])
        unit: dict[str, Any] = {"kind": kind, "id": uid, "attrs": attrs}
        about = str(u.get("about") or "").strip()
        if about:
            unit["about"] = about[:40]
        out.append(unit)
    return out


def _fallback_units(text: str) -> list[dict[str, Any]]:
    """No-LLM path: a compact keyword note. Deterministic, honest about itself."""
    toks = _tokens(text)[:8]
    if not toks:
        return []
    return [{"kind": "note", "id": f"note_{text_hash(text)[:8]}", "attrs": {"keywords": " ".join(toks)}}]


def render_ir(units: list[dict[str, Any]]) -> str:
    """Compact s-expression text — the stored/embedded «code» form."""
    lines: list[str] = []
    for u in units:
        if u["kind"] == "cause":
            lines.append(f"(cause {u['from']} -> {u['to']})")
            continue
        attrs = " ".join(
            f"({k} {v})" for k, v in u.get("attrs", {}).items()
        )
        about = f" @{u['about']}" if u.get("about") else ""
        lines.append(f"({u['kind']} {u['id']}{about} {attrs})".replace("  ", " ").strip())
    return "\n".join(lines)


def verbalize(units: list[dict[str, Any]]) -> str:
    """Deterministic re-verbalization for the round-trip check (not for the user)."""
    bits: list[str] = []
    for u in units:
        if u["kind"] == "cause":
            bits.append(f"{u['from']} приводит к {u['to']}")
            continue
        attrs = "; ".join(f"{k} {v}" for k, v in u.get("attrs", {}).items())
        about = f" про {u['about']}" if u.get("about") else ""
        bits.append(f"{u['kind']} {u['id']}{about}: {attrs}")
    return ". ".join(bits)


class SemanticCompiler:
    def __init__(self, state_dir: Path) -> None:
        self.db_path = Path(state_dir) / "semantic_ir.db"
        Path(state_dir).mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as c:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS ir_units (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts REAL NOT NULL,
                    text_hash TEXT UNIQUE NOT NULL,
                    source_text TEXT NOT NULL,
                    ir_json TEXT NOT NULL,
                    ir_text TEXT NOT NULL,
                    compiler TEXT NOT NULL,
                    sim REAL NOT NULL,
                    verified INTEGER NOT NULL
                )
                """
            )

    def lookup(self, text: str) -> dict[str, Any] | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM ir_units WHERE text_hash = ?", (text_hash(text),)).fetchone()
        if not row:
            return None
        try:
            units = json.loads(row["ir_json"])
        except (json.JSONDecodeError, TypeError):
            return None
        return {
            "units": units,
            "ir_text": str(row["ir_text"]),
            "compiler": str(row["compiler"]),
            "sim": float(row["sim"]),
            "verified": bool(row["verified"]),
            "cached": True,
        }

    def _persist(self, text: str, units: list[dict[str, Any]], ir_text: str, compiler: str, sim: float, verified: bool) -> None:
        with self._conn() as c:
            c.execute(
                """
                INSERT OR REPLACE INTO ir_units (ts, text_hash, source_text, ir_json, ir_text, compiler, sim, verified)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (time.time(), text_hash(text), text[:500], json.dumps(units, ensure_ascii=False), ir_text, compiler, sim, 1 if verified else 0),
            )

    def compile_text(
        self,
        text: str,
        *,
        vector_memory: VectorMemory | None = None,
        synapse_graph: Any = None,
    ) -> dict[str, Any]:
        """Compile (or fetch from cache) one utterance into IR. Side effects on a
        NEW verified compile: graph edges + a recallable vector-memory row."""
        text = " ".join(str(text or "").split())
        if not text:
            return {"units": [], "ir_text": "", "compiler": "none", "sim": 0.0, "verified": False, "cached": False}

        cached = self.lookup(text)
        if cached:
            return cached

        units: list[dict[str, Any]] = []
        compiler = "fallback"
        if gonka_is_enabled("bulk"):
            res = gonka_chat(
                [
                    {"role": "system", "content": _COMPILER_PROMPT},
                    {"role": "user", "content": text[:600]},
                ],
                role="bulk",
                # gemini-2.5-flash spends "thinking" tokens out of this budget;
                # 1200 truncates mid-JSON (seen live) — keep it generous.
                max_tokens=6000,
                temperature=0.1,
                response_format={"type": "json_object"},
            )
            if res.ok and res.text:
                parsed = _extract_json(res.text)
                if parsed is not None:
                    units = _valid_units(parsed)
                    if units:
                        compiler = res.model
        if not units:
            units = _fallback_units(text)
            compiler = "fallback"
        if not units:
            return {"units": [], "ir_text": "", "compiler": compiler, "sim": 0.0, "verified": False, "cached": False}

        ir_text = render_ir(units)
        # Round-trip honesty gate: the IR must re-verbalize близко к источнику.
        sim = cosine_similarity(embed_text(text), embed_text(verbalize(units) or ir_text))
        verified = sim >= MIN_SIM

        self._persist(text, units, ir_text, compiler, sim, verified)

        if verified:
            self._grow(units, ir_text, text, synapse_graph)
            if vector_memory is not None:
                try:
                    vector_memory.remember(
                        Event(type="semantic_ir", payload={"text": f"{ir_text} | {text[:100]}"}, source="semantic_compiler"),
                        {"score": round(sim, 3), "reason": f"IR compiled ({compiler})", "store_memory": True, "reinforce": "semantic_ir"},
                    )
                except Exception:  # noqa: BLE001 - recall row is best-effort
                    pass

        return {"units": units, "ir_text": ir_text, "compiler": compiler, "sim": round(sim, 4), "verified": verified, "cached": False}

    def _grow(self, units: list[dict[str, Any]], ir_text: str, source_text: str, synapse_graph: Any) -> None:
        """IR nodes become first-class graph nodes, so bridges/flywheel see them."""
        if synapse_graph is None:
            return
        try:
            for u in units:
                if u["kind"] == "cause":
                    synapse_graph.upsert(
                        source_type="ir_node", source_id=u["from"],
                        target_type="ir_node", target_id=u["to"],
                        relation_type="leads_to", weight=0.7,
                        metadata={"summary": f"(cause {u['from']} -> {u['to']})", "source": "semantic_compiler"},
                    )
                    continue
                for k, v in u.get("attrs", {}).items():
                    synapse_graph.upsert(
                        source_type="ir_node", source_id=u["id"],
                        target_type="ir_attr", target_id=f"{k}:{v}"[:60],
                        relation_type="related_to", weight=0.6,
                        metadata={"summary": f"({u['kind']} {u['id']} ({k} {v})) | {source_text[:60]}", "source": "semantic_compiler"},
                    )
                if u.get("about"):
                    synapse_graph.upsert(
                        source_type="ir_node", source_id=u["id"],
                        target_type="ir_node", target_id=u["about"],
                        relation_type="related_to", weight=0.65,
                        metadata={"summary": f"{u['id']} about {u['about']}", "source": "semantic_compiler"},
                    )
        except Exception:  # noqa: BLE001 - graph growth is best-effort
            pass

    def stats(self) -> dict[str, int]:
        with self._conn() as c:
            rows = c.execute("SELECT verified, COUNT(*) n FROM ir_units GROUP BY verified").fetchall()
        out = {"verified": 0, "unverified": 0}
        for r in rows:
            out["verified" if r["verified"] else "unverified"] = int(r["n"])
        out["total"] = out["verified"] + out["unverified"]
        return out
