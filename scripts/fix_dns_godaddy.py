#!/usr/bin/env python3
"""Починить DNS домена в GoDaddy, чтобы он указывал на Vercel.

Запуск с Мака (там сеть не ограничена):

    export GODADDY_KEY=...      # developer.godaddy.com → API Keys → Create (Production)
    export GODADDY_SECRET=...
    python3 scripts/fix_dns_godaddy.py mir.care            # показать план (ничего не менять)
    python3 scripts/fix_dns_godaddy.py mir.care --apply    # применить

Что делает: ставит A @ → 216.198.79.1 (Vercel) и CNAME www → cname.vercel-dns.com.
Сначала ВСЕГДА показывает текущие записи и разницу; меняет только с --apply.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.godaddy.com/v1"
VERCEL_A = "216.198.79.1"
VERCEL_CNAME = "cname.vercel-dns.com"


def _auth_header() -> str:
    key = os.environ.get("GODADDY_KEY", "").strip()
    secret = os.environ.get("GODADDY_SECRET", "").strip()
    if not key or not secret:
        sys.exit(
            "Нет ключей. Возьми их на developer.godaddy.com → API Keys → Create (Production), затем:\n"
            "  export GODADDY_KEY=...\n  export GODADDY_SECRET=..."
        )
    return f"sso-key {key}:{secret}"


def _request(method: str, path: str, payload: object | None = None) -> object:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method=method,
        headers={"Authorization": _auth_header(), "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode()
            return json.loads(body) if body.strip() else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:400]
        if exc.code in (401, 403):
            sys.exit(
                f"GoDaddy отказал ({exc.code}): {detail}\n\n"
                "Частая причина: GoDaddy ограничил свой API — доступ к DNS даётся аккаунтам\n"
                "с 10+ доменами или подпиской Discount Domain Club. Если это твой случай —\n"
                "правь запись руками в панели GoDaddy (инструкция в ответе Клода)."
            )
        sys.exit(f"GoDaddy вернул {exc.code}: {detail}")
    except urllib.error.URLError as exc:
        sys.exit(f"Сеть недоступна: {exc}")


def show(records: list[dict]) -> None:
    print("  ТЕКУЩИЕ ЗАПИСИ:")
    interesting = [r for r in records if r.get("type") in ("A", "CNAME", "AAAA")]
    if not interesting:
        print("    (нет A/AAAA/CNAME)")
    for r in interesting:
        print(f"    {r.get('type'):<6} {r.get('name'):<8} → {r.get('data')}  (ttl {r.get('ttl')})")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("domain", help="например mir.care")
    ap.add_argument("--apply", action="store_true", help="применить изменения (без флага — только показать)")
    ap.add_argument("--skip-www", action="store_true", help="не трогать www")
    args = ap.parse_args()

    print(f"\n=== {args.domain} ===")
    records = _request("GET", f"/domains/{args.domain}/records")
    if not isinstance(records, list):
        sys.exit("Неожиданный ответ GoDaddy")
    show(records)

    cur_a = next((r for r in records if r.get("type") == "A" and r.get("name") == "@"), None)
    cur_www = next((r for r in records if r.get("name") == "www" and r.get("type") in ("A", "CNAME")), None)

    print("\n  ПЛАН:")
    a_ok = cur_a and cur_a.get("data") == VERCEL_A
    print(f"    A     @    {cur_a.get('data') if cur_a else '(нет)'} → {VERCEL_A}"
          + ("   [уже ок]" if a_ok else ""))
    if not args.skip_www:
        www_ok = cur_www and cur_www.get("type") == "CNAME" and cur_www.get("data", "").rstrip(".") == VERCEL_CNAME
        print(f"    CNAME www  {cur_www.get('data') if cur_www else '(нет)'} → {VERCEL_CNAME}"
              + ("   [уже ок]" if www_ok else ""))

    if cur_a and not a_ok:
        print(f"\n  ⚠ Сейчас {args.domain} смотрит на {cur_a.get('data')} — если там живёт другой сайт,")
        print("    после смены он перестанет открываться на этом домене.")

    if not args.apply:
        print("\n  Ничего не изменено. Для применения добавь --apply\n")
        return 0

    print("\n  Применяю…")
    _request("PUT", f"/domains/{args.domain}/records/A/@", [{"data": VERCEL_A, "ttl": 600}])
    print(f"    ✓ A @ → {VERCEL_A}")
    if not args.skip_www:
        _request("PUT", f"/domains/{args.domain}/records/CNAME/www", [{"data": VERCEL_CNAME, "ttl": 600}])
        print(f"    ✓ CNAME www → {VERCEL_CNAME}")

    print("\n  Готово. DNS расходится 15–30 мин (иногда дольше).")
    print("  Проверить:  python3 -c \"import socket;print(socket.gethostbyname('%s'))\"" % args.domain)
    print("  В Vercel → Domains красный треугольник сам сменится на зелёную галку.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
