#!/bin/bash
# Мост Max17 на Маке одной командой:
#   bash mark17/run_bridge_mac.sh
# Поднимает mark17/server.py (с Qwen через Ollama, если она запущена),
# пробрасывает наружу cloudflared-туннелем и печатает готовые команды
# для Vercel. Ctrl+C останавливает всё.

set -u

MARK17="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$MARK17")"
cd "$ROOT" || exit 1

# 8790, а не 8017: 8017 — это порт голосового сервера (MAX17_TTS_PORT), и когда
# оба запущены, мост и синтез речи дерутся за него. Однажды туннель в итоге
# смотрел на голос вместо ядра, а прод отвечал «Ядро Max недоступно».
PORT="${PORT:-8790}"
TTS_PORT="${MAX17_TTS_PORT:-8017}"
LOG_DIR="${TMPDIR:-/tmp}/max17-bridge"
mkdir -p "$LOG_DIR"
SERVER_LOG="$LOG_DIR/server.log"
TUNNEL_LOG="$LOG_DIR/tunnel.log"

say()  { printf '\033[1;36m[max17]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[max17]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[max17]\033[0m %s\n' "$*"; exit 1; }

# ── проверки ──────────────────────────────────────────────────────────────────
command -v python3 >/dev/null 2>&1 || fail "нет python3 — установи Xcode CLT: xcode-select --install"

if ! python3 -c 'import numpy' >/dev/null 2>&1; then
  fail "нет numpy — выполни: python3 -m pip install -r mark17/requirements.txt"
fi

# ── порт ──────────────────────────────────────────────────────────────────────
# На порту может уже кто-то сидеть. Тогда мост не сядет, а туннель уедет на
# чужой сервис — и наружу поедет не ядро. Проверяем ДО запуска.
port_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -i ":$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    # Без lsof — пробуем занять порт сами: не вышло, значит занят.
    ! python3 - "$1" <<'PY' >/dev/null 2>&1
import socket, sys
s = socket.socket()
try:
    s.bind(("127.0.0.1", int(sys.argv[1])))
except OSError:
    sys.exit(1)
finally:
    s.close()
PY
  fi
}

port_owner() {
  command -v lsof >/dev/null 2>&1 || { printf 'неизвестно'; return; }
  local who
  who="$(lsof -i ":$1" -sTCP:LISTEN -Fc 2>/dev/null | grep '^c' | head -1 | cut -c2-)"
  printf '%s' "${who:-неизвестно}"
}

if [ "$PORT" = "$TTS_PORT" ]; then
  warn "PORT=$PORT совпадает с портом голосового сервера — мост и синтез речи столкнутся."
  warn "Задай другой: PORT=8790 bash mark17/run_bridge_mac.sh"
fi

if port_busy "$PORT"; then
  warn "порт $PORT занят процессом '$(port_owner "$PORT")' — это не наш мост"
  ORIG_PORT="$PORT"
  for candidate in $(seq $((ORIG_PORT + 1)) $((ORIG_PORT + 20))); do
    if ! port_busy "$candidate"; then PORT="$candidate"; break; fi
  done
  [ "$PORT" = "$ORIG_PORT" ] && \
    fail "свободного порта нет в диапазоне $((ORIG_PORT + 1))–$((ORIG_PORT + 20)) — освободи $ORIG_PORT"
  say "перехожу на свободный порт $PORT"
fi

# Провайдер мозга Макса:
#   MINIMAX_API_KEY задан → MiniMax (то, на чём думает Max Ultra)
#   иначе если жива Ollama → Qwen/Gemma локально
#   иначе → детерминированный режим
OLLAMA_HOST="${MAX17_OLLAMA_HOST:-http://127.0.0.1:11434}"
LLM_ENABLED=false
PROVIDER="ollama"
MODEL="${MAX17_LLM_MODEL:-}"

if [ -n "${MINIMAX_API_KEY:-}" ]; then
  LLM_ENABLED=true
  PROVIDER="minimax"
  MODEL="${MINIMAX_MODEL:-${MAX17_LLM_MODEL:-MiniMax-M2}}"
  say "MiniMax-ключ найден → мозг Макса = MiniMax, модель: $MODEL"
elif curl -s --max-time 2 "$OLLAMA_HOST/api/tags" >/dev/null 2>&1; then
  LLM_ENABLED=true
  PROVIDER="ollama"
  if [ -z "$MODEL" ]; then
    MODEL="$(curl -s --max-time 3 "$OLLAMA_HOST/api/tags" \
      | python3 -c 'import sys,json;m=json.load(sys.stdin).get("models",[]);print(m[0]["name"] if m else "")' 2>/dev/null)"
  fi
  [ -n "$MODEL" ] && say "Ollama жива → LLM включён, модель: $MODEL" \
                  || { warn "Ollama жива, но моделей нет (ollama pull qwen2.5:3b) — LLM выключаю"; LLM_ENABLED=false; }
else
  warn "Ни MiniMax-ключа, ни Ollama — мост пойдёт в детерминированном режиме (без LLM)."
  warn "MiniMax:  export MINIMAX_API_KEY=... и перезапусти.  Qwen: запусти Ollama."
fi

# Токен: из env или генерим
TOKEN="${MAX17_BRIDGE_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  if command -v openssl >/dev/null 2>&1; then
    TOKEN="$(openssl rand -hex 16)"
  else
    TOKEN="$(python3 -c 'import secrets;print(secrets.token_hex(16))')"
  fi
fi

# ── запуск моста ──────────────────────────────────────────────────────────────
SERVER_PID=""
TUNNEL_PID=""
cleanup() {
  say "останавливаю…"
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

# Мак не должен засыпать, пока мост жив (только macOS)
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -dimsu -w $$ &
  say "caffeinate включён — Мак не заснёт, пока работает мост"
fi

say "стартую мост Max17 на :$PORT (лог: $SERVER_LOG)"
PORT="$PORT" \
MAX17_BRIDGE_TOKEN="$TOKEN" \
MAX17_LLM_ENABLED="$LLM_ENABLED" \
MAX17_LLM_PROVIDER="$PROVIDER" \
MAX17_OLLAMA_HOST="$OLLAMA_HOST" \
MAX17_LLM_MODEL="$MODEL" \
MINIMAX_API_KEY="${MINIMAX_API_KEY:-}" \
MINIMAX_MODEL="${MINIMAX_MODEL:-}" \
MINIMAX_BASE_URL="${MINIMAX_BASE_URL:-}" \
python3 -m mark17.server >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

ok=""
for _ in $(seq 1 20); do
  # Проверяем ИМЕННО service, а не просто "ok": true. Чужой сервис на этом
  # порту тоже может ответить {"ok": true} — так однажды наружу уехал
  # синтезатор речи вместо ядра, и полчаса ушло на поиски.
  if curl -s --max-time 1 "http://127.0.0.1:$PORT/health" | grep -q '"service": "max17-bridge"'; then ok=1; break; fi
  sleep 0.5
done
[ -n "$ok" ] || { cat "$SERVER_LOG"; fail "мост не поднялся — лог выше"; }
say "мост жив: http://127.0.0.1:$PORT/health"

# ── туннель ───────────────────────────────────────────────────────────────────
PUBLIC_URL=""
if command -v cloudflared >/dev/null 2>&1; then
  say "поднимаю cloudflared-туннель (лог: $TUNNEL_LOG)"
  cloudflared tunnel --url "http://localhost:$PORT" >"$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!
  for _ in $(seq 1 40); do
    # -a: читать лог как текст. cloudflared печатает цветной ASCII-баннер с
    # рамками из юникода, и без -a macOS-овский (BSD) grep иногда решает,
    # что файл бинарный, и вместо совпадения печатает "Binary file X
    # matches" — эта строка тогда улетает в PUBLIC_URL как будто это и есть
    # адрес. Дальше проверка ниже отсекает такой мусор явно, а не просто
    # смотрит на "непусто".
    PUBLIC_URL="$(grep -a -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1)"
    case "$PUBLIC_URL" in
      https://*.trycloudflare.com) break ;;
      *) PUBLIC_URL="" ;;
    esac
    sleep 0.5
  done
  [ -n "$PUBLIC_URL" ] || warn "не дождался URL туннеля — смотри $TUNNEL_LOG"
else
  warn "cloudflared не установлен: brew install cloudflared"
  warn "пока мост доступен только локально: http://127.0.0.1:$PORT"
fi

# ── итог ──────────────────────────────────────────────────────────────────────
echo
say "──────────────── ГОТОВО ────────────────"
say "BRIDGE URL : ${PUBLIC_URL:-http://127.0.0.1:$PORT}"
say "TOKEN      : $TOKEN"
say "LLM        : $([ "$LLM_ENABLED" = true ] && echo "ollama / $MODEL" || echo "выключен (детерминированный)")"
echo
# Автопрописывание в Vercel: работает, если `vercel login` сделан и проект слинкован
if [ -n "$PUBLIC_URL" ] && command -v vercel >/dev/null 2>&1 && [ -d "$ROOT/.vercel" ]; then
  say "обновляю MAX17_BRIDGE_URL в Vercel автоматически…"
  (cd "$ROOT" \
    && vercel env rm MAX17_BRIDGE_URL production --yes >/dev/null 2>&1 || true \
    && printf %s "$PUBLIC_URL" | vercel env add MAX17_BRIDGE_URL production >/dev/null 2>&1 \
    && vercel env rm MAX17_BRIDGE_TOKEN production --yes >/dev/null 2>&1 || true \
    && printf %s "$TOKEN" | vercel env add MAX17_BRIDGE_TOKEN production >/dev/null 2>&1 \
    && vercel --prod --yes >/dev/null 2>&1 \
    && say "Vercel обновлён и передеплоен — прод смотрит на этот мост") \
    || warn "не удалось обновить Vercel автоматически — пропиши env руками (команды ниже)"
fi

if [ -n "$PUBLIC_URL" ]; then
  say "проверка:  curl $PUBLIC_URL/health"
  echo
  say "Пропиши в Vercel (после vercel login, из папки проекта):"
  printf '  printf %%s "%s" | vercel env add MAX17_BRIDGE_URL production\n' "$PUBLIC_URL"
  printf '  printf %%s "%s" | vercel env add MAX17_BRIDGE_TOKEN production\n' "$TOKEN"
  printf '  vercel --prod\n'
  echo
  warn "Туннель живёт, пока работает этот скрипт и Мак не спит."
fi
say "Ctrl+C — остановить всё."
wait
