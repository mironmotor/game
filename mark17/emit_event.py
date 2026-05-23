#!/usr/bin/env python3
"""Отправить одно событие (JSONL) в stdout для pipe в daemon."""

from __future__ import annotations

import argparse
import json
import sys


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("type", help="ping | terminal_error | open_folder | recall | ...")
    p.add_argument("--line", default="")
    p.add_argument("--path", default="")
    p.add_argument("--cmd", default="")
    p.add_argument("--query", "-q", default="")
    p.add_argument("--note", default="")
    args = p.parse_args()

    payload: dict = {"type": args.type}
    if args.type == "terminal_error":
        payload["line"] = args.line
    elif args.type == "open_folder":
        payload["path"] = args.path
    elif args.type == "shell_command":
        payload["cmd"] = args.cmd
    elif args.type in ("recall", "search_memory"):
        payload["query"] = args.query or args.note
    elif args.type == "remember":
        payload["note"] = args.note or args.query

    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
