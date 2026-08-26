#!/usr/bin/env bash
# Поднимает локальный слой моделей MAX так, чтобы он был виден всей локалке,
# и печатает адреса + команду обратного туннеля для дроплета mir.care.
#
#   Ollama   :11434  — мелкие модели (qwen2.5 0.5b/3b, qwen3-vl:4b, moondream)
#   llama.cpp:8127   — Bonsai-27B (27 млрд параметров, ~1.13 бита на параметр)
#
# ВАЖНО про 8 ГБ: бюджет Metal — 5461 МиБ на весь мак. Две тяжёлые модели
# одновременно не живут, поэтому Ollama держим с коротким keep-alive, а
# bonsai_server.sh перед стартом просит её отпустить веса.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || echo 127.0.0.1)"
DROPLET="${MIRCARE_HOST:-root@167.99.8.198}"

start_ollama() {
  if curl -sf --max-time 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    echo "Ollama уже слушает :11434"
  else
    mkdir -p "$HOME/.local/max17/logs"
    OLLAMA_HOST=0.0.0.0:11434 \
    OLLAMA_MAX_LOADED_MODELS=1 \
    OLLAMA_KEEP_ALIVE=2m \
    OLLAMA_FLASH_ATTENTION=1 \
    nohup ollama serve >>"$HOME/.local/max17/logs/ollama.log" 2>&1 &
    sleep 3
    echo "Ollama поднята на 0.0.0.0:11434"
  fi
}

case "${1:-up}" in
  up)
    start_ollama
    "$HERE/bonsai_server.sh" start
    cat <<TXT

Адреса для локалки (мак = $LAN_IP):
  Bonsai-27B   http://$LAN_IP:8127/v1     (модель: bonsai-27b)
  Ollama       http://$LAN_IP:11434/v1    (модель: qwen2.5:3b, qwen3-vl:4b, …)

Другая машина в локалке цепляется к ядру одной строкой в .env.local:
  MAX17_BONSAI_HOST=http://$LAN_IP:8127
  MAX17_OLLAMA_HOST=http://$LAN_IP:11434

Дроплет mir.care (458 МБ ОЗУ — сам 27B не потянет никогда) ходит сюда через
обратный туннель; запускать НА МАКЕ и держать открытым:
  ssh -N -R 7127:127.0.0.1:8127 -R 7434:127.0.0.1:11434 $DROPLET
и тогда на сервере:
  MAX17_BONSAI_HOST=http://127.0.0.1:7127
  MAX17_OLLAMA_HOST=http://127.0.0.1:7434
TXT
    ;;
  tunnel)
    echo "туннель на $DROPLET: 7127→8127 (bonsai), 7434→11434 (ollama)"
    exec ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
      -R 7127:127.0.0.1:8127 -R 7434:127.0.0.1:11434 "$DROPLET"
    ;;
  down)
    "$HERE/bonsai_server.sh" stop || true
    pkill -f "ollama serve" && echo "Ollama остановлена" || true
    ;;
  status)
    "$HERE/bonsai_server.sh" status || true
    curl -sf --max-time 2 http://127.0.0.1:11434/api/version && echo " ← Ollama" || echo "Ollama не отвечает"
    ollama ps 2>/dev/null || true
    ;;
  *) echo "использование: $0 {up|down|status|tunnel}"; exit 1 ;;
esac
