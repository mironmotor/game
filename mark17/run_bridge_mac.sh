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

PORT="${PORT:-8017}"
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

# Ollama: если жива — включаем LLM-роутинг через неё
OLLAMA_HOST="${MAX17_OLLAMA_HOST:-http://127.0.0.1:11434}"
LLM_ENABLED=false
MODEL="${MAX17_LLM_MODEL:-}"
if curl -s --max-time 2 "$OLLAMA_HOST/api/tags" >/dev/null 2>&1; then
  LLM_ENABLED=true
  if [ -z "$MODEL" ]; then
    MODEL="$(curl -s --max-time 3 "$OLLAMA_HOST/api/tags" \
      | python3 -c 'import sys,json;m=json.load(sys.stdin).get("models",[]);print(m[0]["name"] if m else "")' 2>/dev/null)"
  fi
  [ -n "$MODEL" ] && say "Ollama жива → LLM включён, модель: $MODEL" \
                  || { warn "Ollama жива, но моделей нет (ollama pull qwen2.5:3b) — LLM выключаю"; LLM_ENABLED=false; }
else
  warn "Ollama не отвечает на $OLLAMA_HOST — мост пойдёт в детерминированном режиме (без LLM)."
  warn "Чтобы включить Qwen: запусти Ollama и перезапусти скрипт."
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
MAX17_LLM_PROVIDER="ollama" \
MAX17_OLLAMA_HOST="$OLLAMA_HOST" \
MAX17_LLM_MODEL="$MODEL" \
python3 -m mark17.server >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

ok=""
for _ in $(seq 1 20); do
  if curl -s --max-time 1 "http://127.0.0.1:$PORT/health" | grep -q '"ok": true'; then ok=1; break; fi
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
    PUBLIC_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1)"
    [ -n "$PUBLIC_URL" ] && break
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
