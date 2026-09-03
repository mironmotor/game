#!/usr/bin/env python3
"""
Mark 17 daemon v0.2

  python3 daemon.py -i              # интерактив (TTY)
  python3 daemon.py --pretty ...    # читаемый вывод
  echo '{"type":"ping"}' | python3 daemon.py
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from mark17.cli_format import emit
from mark17.events import Event, topic_key, parse_event_line, parse_shorthand
from mark17.hippocampus import Hippocampus
from mark17.llm_bridge import LlmBridge
from mark17.meta_controller import MetaController, Route
from mark17.plasticity_bridge import PlasticityBridge

VERSION = "0.2.0"
STORE_TYPES = frozenset({"terminal_error", "open_folder", "shell_command", "file_saved"})


class Mark17Brain:
    def __init__(
        self,
        state_dir: Path,
        *,
        plasticity_threshold: float = 0.7,
        llm_enabled: bool = True,
        llm_model: str = "phi3:mini",
        llm_host: str = "http://127.0.0.1:11434",
    ) -> None:
        self.plasticity = PlasticityBridge(state_dir)
        self.memory = Hippocampus(state_dir)
        self.llm = LlmBridge(
            host=llm_host, model=llm_model, enabled=llm_enabled, state_dir=state_dir
        )
        self.meta = MetaController(
            self.plasticity,
            plasticity_threshold=plasticity_threshold,
        )

    def ready_payload(self) -> dict:
        return {
            "ok": True,
            "message": "mark17 daemon ready",
            "version": VERSION,
            "stats": self.plasticity.stats(),
            "memory_stats": self.memory.stats(),
            "llm_available": self.llm.available,
        }

    def handle(self, event: Event) -> dict:
        decision = self.meta.decide(event)
        out: dict = {
            "ok": True,
            "ts": time.time(),
            "event_type": event.type,
            "route": decision.route.value,
            "decision": {
                "reason": decision.reason,
                "confidence": decision.confidence,
                "pattern_id": decision.pattern_id,
                # The routing state vector before it collapsed onto this route.
                "superposition": decision.superposition,
            },
        }

        if decision.route == Route.IGNORE:
            out["message"] = "pong"
            return out

        if decision.route == Route.MEMORY:
            if event.type == "remember":
                note = str(event.payload.get("note", ""))
                mid = self.memory.remember(event, hint=note, action="remember")
                out["memory"] = {"stored_id": mid, "note": note}
                return out

            query = str(
                event.payload.get("query")
                or event.payload.get("q")
                or event.signature()
            )
            hits = self.memory.recall(query)
            out["memory"] = {
                "query": query,
                "hits": [
                    {
                        "id": h.id,
                        "event_type": h.event_type,
                        "importance": round(h.importance, 3),
                        "score": round(h.score, 3),
                        "summary": h.content.get("hint") or h.signature[:80],
                    }
                    for h in hits
                ],
            }
            if not hits:
                out["memory"]["hint"] = "Ничего не найдено. Сначала накопи события (terminal_error, open_folder)."
            return out

        pl = self.plasticity.process(event)
        out["plasticity"] = {
            "pattern_id": pl.pattern_id,
            "confidence": pl.confidence,
            "hits": pl.hits,
            "action": pl.action,
            "hint": pl.hint,
            "learned": pl.learned,
            "snn": pl.snn,
        }
        # Тема, к которой человек возвращается сейчас. Нужна, чтобы на «что
        # дальше» ответить по делу, а не описанием своих возможностей. Свою же
        # тему исключаем: на конкретный вопрос отвечать «ты часто про это
        # спрашиваешь» — не ответ.
        hot = self.plasticity.hot_topic(exclude=topic_key(event.payload.get("text", "")))
        if hot:
            out["plasticity"]["hot_topic"] = hot

        if event.type in STORE_TYPES:
            self.memory.remember(event, hint=pl.hint, action=pl.action)

        mem_snippets: list[str] = []
        if event.type == "terminal_error":
            mem_snippets = [
                h.content.get("hint", "")
                for h in self.memory.recall(str(event.payload.get("line", ""))[:200], limit=3)
                if h.content.get("hint")
            ]

        if decision.route == Route.LLM:
            ctx = pl.hint
            if event.type == "terminal_error":
                ctx = str(event.payload.get("line", ""))[:500]
            prompt = self.llm.build_prompt(event.type, ctx, mem_snippets)
            llm_res = self.llm.ask(prompt)
            out["llm"] = {
                "status": llm_res.status,
                "model": llm_res.model,
                "text": llm_res.text,
                "latency_ms": llm_res.latency_ms,
            }
        elif decision.route == Route.PLASTICITY and pl.learned:
            # подсказка из похожей памяти, если есть
            if mem_snippets and event.type == "terminal_error":
                out["memory_hint"] = mem_snippets[0]

        return out


def run_stdin(brain: Mark17Brain, save_every: int, pretty: bool) -> int:
    n = 0
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            result = _process_line(line, brain)
            if result.get("_stop"):
                break
            emit(result, pretty=pretty)
            n += 1
            if save_every > 0 and n % save_every == 0:
                brain.plasticity.save()
        except Exception as e:
            emit({"ok": False, "error": str(e), "trace": traceback.format_exc()}, pretty=pretty)
    brain.plasticity.save()
    return 0


def run_interactive(brain: Mark17Brain, pretty: bool) -> int:
    emit(brain.ready_payload(), pretty=pretty)
    sys.stderr.write(
        "Интерактивный режим. Команды:\n"
        "  ping | err <текст> | open <путь> | cmd <команда> | recall <запрос>\n"
        "  stats | decay | JSON {...} | quit\n\n"
    )
    sys.stderr.flush()
    n = 0
    while True:
        try:
            line = input("mark17> ").strip()
        except (EOFError, KeyboardInterrupt):
            sys.stderr.write("\n")
            break
        if not line:
            continue
        try:
            result = _process_line(line, brain)
            if result.get("_stop"):
                emit({"ok": True, "message": "bye"}, pretty=pretty)
                break
            emit(result, pretty=pretty)
            n += 1
            if n % 3 == 0:
                brain.plasticity.save()
        except Exception as e:
            emit({"ok": False, "error": str(e)}, pretty=pretty)
    brain.plasticity.save()
    emit({"ok": True, "message": "bye", "stats": brain.plasticity.stats()}, pretty=pretty)
    return 0


def _process_line(line: str, brain: Mark17Brain) -> dict:
    low = line.strip().lower()
    if low in ("quit", "exit", "q"):
        return {"ok": True, "message": "bye", "_stop": True}
    if low == "stats":
        return {
            "ok": True,
            "stats": brain.plasticity.stats(),
            "memory_stats": brain.memory.stats(),
            "llm_available": brain.llm.available,
        }
    if low == "decay":
        removed = brain.memory.decay_all()
        return {"ok": True, "message": f"decay: removed {removed} weak memories"}

    if line.startswith("{"):
        event = parse_event_line(line)
    else:
        event = parse_shorthand(line)
    return brain.handle(event)


def run_replay(path: Path, brain: Mark17Brain, pretty: bool) -> int:
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        emit(_process_line(line, brain), pretty=pretty)
    brain.plasticity.save()
    emit({"ok": True, "stats": brain.plasticity.stats(), "message": "replay done"}, pretty=pretty)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Mark 17 daemon")
    parser.add_argument("--state-dir", type=Path, default=Path(__file__).resolve().parent / "state")
    parser.add_argument("--replay", type=Path)
    parser.add_argument("-i", "--interactive", action="store_true", help="TTY REPL")
    parser.add_argument("--pretty", "-p", action="store_true", help="читаемый вывод")
    parser.add_argument("--save-every", type=int, default=5)
    parser.add_argument("--plasticity-threshold", type=float, default=0.7)
    parser.add_argument("--no-llm", action="store_true")
    parser.add_argument("--ollama-model", default="qwen2.5:0.5b")
    parser.add_argument("--ollama-host", default="http://127.0.0.1:11434")
    args = parser.parse_args()

    brain = Mark17Brain(
        args.state_dir,
        plasticity_threshold=args.plasticity_threshold,
        llm_enabled=not args.no_llm,
        llm_model=args.ollama_model,
        llm_host=args.ollama_host,
    )

    if args.replay:
        return run_replay(args.replay, brain, args.pretty)

    if args.interactive or (sys.stdin.isatty() and not args.replay):
        return run_interactive(brain, args.pretty)

    emit(brain.ready_payload(), pretty=args.pretty)
    return run_stdin(brain, args.save_every, args.pretty)


if __name__ == "__main__":
    raise SystemExit(main())
