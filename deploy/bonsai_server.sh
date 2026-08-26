#!/usr/bin/env bash
# Bonsai-27B (llama.cpp) как локальный OpenAI-совместимый сервер для MAX.
#
# Зачем отдельный сервер, а не Ollama: GGUF собран в кванте ggml type 41
# (file_type 40, ~1.13 бита на параметр). Ollama 0.32.1 такой квант не
# валидирует — `ollama create` падает на llama-quantize. Умеет его только
# свежая сборка llama.cpp, которая уже лежит рядом с моделью.
#
# По умолчанию слушает 0.0.0.0 — модель видна всей локалке (и серверу через
# обратный SSH-туннель). Ограничить можно BONSAI_HOST=127.0.0.1.
set -euo pipefail

CODEX_DIR="${BONSAI_DIR:-/Users/admin/Documents/Codex/2026-07-29/https-huggingface-co-prism-ml-bonsai}"
BIN="${BONSAI_BIN:-$CODEX_DIR/work/llama.cpp/build/bin/llama-server}"
MODEL="${BONSAI_MODEL:-$CODEX_DIR/models/Bonsai-27B-Q1_0.gguf}"
HOST="${BONSAI_HOST:-0.0.0.0}"
PORT="${BONSAI_PORT:-8127}"
CTX="${BONSAI_CTX:-4096}"          # модель обучена на 262144; на 8 ГБ ОЗУ Metal падает
                                   # с "Compute error ret=-3" уже на 8192 — это потолок железа
PARALLEL="${BONSAI_PARALLEL:-1}"   # один слот: на 8 ГБ параллельные слоты только жрут KV
LOG="${BONSAI_LOG:-$HOME/.local/max17/logs/bonsai.log}"

usage() { echo "использование: $0 {start|stop|restart|status|test}"; exit 1; }

pid_of() { pgrep -f "llama-server .*${MODEL##*/}" || true; }

# На 8 ГБ M3 бюджет Metal — 5461 МиБ на ВСЕ процессы. Bonsai занимает ~4.2 ГиБ,
# поэтому любая модель, которую держит Ollama, гарантированно роняет его в
# "Compute error ret=-3" (kIOGPUCommandBufferCallbackErrorOutOfMemory). Перед
# стартом просим Ollama отпустить веса — сам сервер при этом продолжает жить.
ollama_yield() {
  command -v ollama >/dev/null 2>&1 || return 0
  local loaded
  loaded="$(ollama ps 2>/dev/null | awk 'NR>1{print $1}')" || return 0
  for m in $loaded; do
    ollama stop "$m" >/dev/null 2>&1 && echo "выгрузил из Ollama: $m (не хватило бы GPU-памяти)"
  done
}

start() {
  if [ -n "$(pid_of)" ]; then echo "уже работает (pid $(pid_of))"; return 0; fi
  ollama_yield
  [ -x "$BIN" ] || { echo "нет бинарника llama-server: $BIN" >&2; exit 1; }
  [ -f "$MODEL" ] || { echo "нет модели: $MODEL" >&2; exit 1; }
  mkdir -p "$(dirname "$LOG")"
  nohup "$BIN" -m "$MODEL" \
    --host "$HOST" --port "$PORT" \
    -c "$CTX" -ngl 999 --parallel "$PARALLEL" \
    --alias bonsai-27b \
    --cache-ram 512 -fa on \
    -b 512 -ub 512 \
    --reasoning off --reasoning-budget 0 \
    --chat-template-kwargs '{"enable_thinking":false}' \
    >>"$LOG" 2>&1 &
  echo "запускаю bonsai-27b на $HOST:$PORT (pid $!), лог: $LOG"
  for _ in $(seq 1 60); do
    sleep 2
    if curl -sf --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
      echo "готов: http://$(ipconfig getifaddr en0 2>/dev/null || echo 127.0.0.1):$PORT/v1"
      return 0
    fi
  done
  echo "не поднялся за 120 с — смотри $LOG" >&2; exit 1
}

stop() {
  local p; p="$(pid_of)"
  [ -z "$p" ] && { echo "не запущен"; return 0; }
  kill $p
  # 3.5 ГБ весов выгружаются не мгновенно; ждём, иначе restart стартует поверх
  for _ in $(seq 1 30); do sleep 1; [ -z "$(pid_of)" ] && break; done
  [ -n "$(pid_of)" ] && { kill -9 $(pid_of) || true; sleep 2; }
  echo "остановлен (pid $p)"
}

status() {
  local p; p="$(pid_of)"
  if [ -z "$p" ]; then echo "bonsai-27b: не запущен"; return 1; fi
  echo "bonsai-27b: pid $p"
  curl -sf --max-time 3 "http://127.0.0.1:$PORT/v1/models" | head -c 300; echo
}

test_gen() {
  curl -s --max-time 300 "http://127.0.0.1:$PORT/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    -d '{"model":"bonsai-27b","messages":[{"role":"user","content":"Ответь одним предложением: ты кто?"}],"max_tokens":80,"temperature":0.3}' \
    | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["choices"][0]["message"]["content"]);print("токенов:",d.get("usage"))'
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; sleep 2; start ;;
  status) status ;;
  test) test_gen ;;
  *) usage ;;
esac
