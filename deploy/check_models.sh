#!/usr/bin/env bash
# Живая проверка каждого пресета MAX: не «есть ли ключ», а отвечает ли модель.
# Печатает модель, задержку и первые слова ответа — или причину отказа.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

set -a; [ -f .env.local ] && . ./.env.local; set +a

PYTHONPATH=. "${PYTHON_BIN:-python3}" - <<'PY'
import time
from mark17 import llm_config as c, gonka_bridge as g

msg = [{"role": "user", "content": "Ответь ровно одним словом: работаю"}]
print(f'{"пресет":16} {"модель":40} {"статус":>9}  ответ')
print("-" * 92)
for pid, p in c.PRESETS.items():
    ok_avail = c._preset_available(pid, p)
    if not ok_avail:
        why = c._local_status(pid, p)[1] if p.get("local") else "нет ключа"
        print(f'{pid:16} {str(p["model"])[:40]:40} {"—":>9}  {why}')
        continue
    t = time.time()
    r = g._chat_once(str(p["base"]).rstrip("/"), c._preset_key(p), str(p["model"]),
                     msg, role="chat", max_tokens=32, temperature=0.0,
                     timeout=90.0, response_format=None)
    ms = int((time.time() - t) * 1000)
    mark = "ОТВЕТИЛ" if r.ok else "ОШИБКА"
    tail = (r.text or r.error or "")[:40].replace("\n", " ")
    print(f'{pid:16} {str(p["model"])[:40]:40} {mark:>9}  {ms:>6} мс  {tail}')

print()
print("роли:")
for row in c.list_presets()["roles"]:
    print(f'  {row["id"]:10} -> {row["resolved"] or "env"}  ({row["model"]})')
PY
