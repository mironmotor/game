#!/bin/bash
# Поселить мост Max17 на сервер — навсегда, вместо туннеля с Мака.
#
#   bash deploy/bridge_server.sh            # разведка: что есть, что будет сделано
#   bash deploy/bridge_server.sh --install  # поставить и запустить
#
# Запускать НА СЕРВЕРЕ (167.99.8.198), через ssh или веб-консоль DigitalOcean.
#
# Зачем вообще:
#
# Быстрые cloudflare-туннели одноразовые. Каждый перезапуск скрипта на Маке —
# новый адрес, а значит заново прописать env в Vercel и заново пересобрать.
# Плюс Мак должен не спать. Это не поломка, а устройство схемы, и чинить её
# по одному разу бессмысленно.
#
# У сервера постоянный адрес и он не засыпает. Мост, поселённый здесь,
# прописывается в Vercel один раз и больше не трогается никогда.
#
# Мост слушает только 127.0.0.1 и наружу выходит через nginx, у которого уже
# есть сертификат сайта. Открывать порт напрямую нельзя: без TLS токен уедет
# по сети открытым текстом.

set -uo pipefail

say()  { printf '\033[1;36m[мост]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[мост]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[мост]\033[0m %s\n' "$*"; exit 1; }

MODE="scan"
for arg in "$@"; do
  case "$arg" in
    --install) MODE="install" ;;
    *) fail "неизвестный флаг: $arg" ;;
  esac
done

PORT="${MAX17_BRIDGE_PORT:-8790}"
ENV_FILE="/etc/max17/bridge.env"
UNIT="/etc/systemd/system/max17-bridge.service"
LOCATION="/max17"

# ── что тут есть ──────────────────────────────────────────────────────────────
say "разведка…"

SITE_DIR=""
for guess in /var/www/mir.care /var/www/game /opt/game /root/game /home/*/game /srv/game; do
  [ -f "$guess/mark17/server.py" ] && { SITE_DIR="$guess"; break; }
done
if [ -z "$SITE_DIR" ]; then
  SITE_DIR="$(find / -maxdepth 6 -path '*/mark17/server.py' -not -path '*/node_modules/*' 2>/dev/null \
    | head -1 | xargs -r dirname | xargs -r dirname)"
fi

PYTHON="$(command -v python3 || true)"
NGINX="$(command -v nginx || true)"
FREE_MB="$(free -m 2>/dev/null | awk '/^Mem:/{print $7}')"

say "папка проекта: ${SITE_DIR:-НЕ НАЙДЕНА}"
say "python3:       ${PYTHON:-НЕТ} $([ -n "$PYTHON" ] && $PYTHON -V 2>&1 | cut -d' ' -f2)"
say "nginx:         ${NGINX:-НЕТ}"
say "свободно RAM:  ${FREE_MB:-?} МБ"
say "мост сейчас:   $(systemctl is-active max17-bridge 2>/dev/null || echo 'не установлен')"

# 512 МБ — это тариф за $4. Сам мост укладывается в десятки мегабайт (только
# стандартная библиотека), но рядом живёт сборка сайта, и вот ей тесно.
if [ -n "$FREE_MB" ] && [ "$FREE_MB" -lt 250 ]; then
  warn "меньше 250 МБ свободно — мост влезет, но сборка сайта рядом может не пережить"
fi

if [ -n "$NGINX" ]; then
  NGINX_SITE="$(grep -rl "server_name" /etc/nginx/sites-enabled/ 2>/dev/null | head -1)"
  say "конфиг nginx:  ${NGINX_SITE:-не найден в sites-enabled}"
else
  warn "nginx нет — наружу мост выставить нечем, TLS взять неоткуда"
fi

if [ "$MODE" = "scan" ]; then
  echo
  say "Пока ничего не сделано — это разведка."
  say "Поставить:  bash $0 --install"
  exit 0
fi

# ── установка ─────────────────────────────────────────────────────────────────
[ -n "$SITE_DIR" ] || fail "не нашёл mark17/server.py — укажи вручную: SITE_DIR=/путь bash $0 --install"
[ -n "$PYTHON" ]   || fail "нет python3"
[ "$(id -u)" = "0" ] || fail "нужен root: sudo bash $0 --install"

# Токен генерируется один раз и потом переиспользуется: перезапуск установщика
# не должен внезапно отцеплять уже настроенный Vercel.
mkdir -p /etc/max17
if [ -f "$ENV_FILE" ] && grep -q MAX17_BRIDGE_TOKEN "$ENV_FILE"; then
  TOKEN="$(grep MAX17_BRIDGE_TOKEN "$ENV_FILE" | cut -d= -f2-)"
  say "токен уже есть, оставляю прежний"
else
  TOKEN="$(openssl rand -hex 16 2>/dev/null || head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  say "сгенерировал новый токен"
fi

cat > "$ENV_FILE" <<EOF
PORT=$PORT
MAX17_BRIDGE_TOKEN=$TOKEN
MAX17_STATE_DIR=/var/lib/max17/state
MAX17_LLM_ENABLED=false
EOF
chmod 600 "$ENV_FILE"
mkdir -p /var/lib/max17/state

# Restart=always — то, ради чего всё затевалось: сервер переживает перезагрузку
# и падение процесса сам, без человека с ноутбуком.
cat > "$UNIT" <<EOF
[Unit]
Description=Max17 bridge
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$SITE_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$PYTHON $SITE_DIR/mark17/server.py
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now max17-bridge >/dev/null 2>&1
sleep 2

if ! systemctl is-active --quiet max17-bridge; then
  journalctl -u max17-bridge -n 20 --no-pager
  fail "мост не поднялся — лог выше"
fi
say "мост работает на 127.0.0.1:$PORT"

# ── наружу через nginx ────────────────────────────────────────────────────────
if [ -n "$NGINX" ] && [ -n "${NGINX_SITE:-}" ]; then
  if grep -q "location $LOCATION/" "$NGINX_SITE"; then
    say "nginx уже настроен, не трогаю"
  else
    cp "$NGINX_SITE" "$NGINX_SITE.bak.$(date +%s)"
    # proxy_pass со слэшем на конце срезает префикс: /max17/event → /event.
    if ! python3 - "$NGINX_SITE" "$LOCATION" "$PORT" <<'PY'
import re
import sys

path, loc, port = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()

# Блок надо выбрать, а не взять последний. В типичном конфиге их два: сам сайт
# на 443 и редирект с 80. Редирект часто идёт последним, и вставка «перед
# последней закрывающей скобкой» уехала бы именно в него — мост оказался бы за
# `return 301` и не отвечал бы вовсе.
def server_blocks(src: str):
    for m in re.finditer(r'\bserver\s*\{', src):
        depth, i = 0, m.end() - 1
        while i < len(src):
            if src[i] == '{':
                depth += 1
            elif src[i] == '}':
                depth -= 1
                if depth == 0:
                    yield m.start(), i
                    break
            i += 1

target = None
for start, end in server_blocks(text):
    body = text[start:end]
    if 'listen 443' in body or 'ssl_certificate' in body:
        target = end
if target is None:
    sys.stderr.write('не нашёл server-блок с TLS\n')
    raise SystemExit(1)

block = f"""
    location {loc}/ {{
        proxy_pass http://127.0.0.1:{port}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 70s;
    }}
"""
open(path, 'w').write(text[:target] + block + text[target:])
PY
    then
      warn "не понял конфиг nginx — не трогаю его, настрой руками"
      warn "нужен location $LOCATION/ → http://127.0.0.1:$PORT/ в блоке с TLS"
    fi
    if nginx -t >/dev/null 2>&1; then
      systemctl reload nginx
      say "nginx настроен: $LOCATION/ → 127.0.0.1:$PORT"
    else
      warn "конфиг nginx не прошёл проверку — возвращаю прежний"
      mv "$NGINX_SITE.bak."* "$NGINX_SITE" 2>/dev/null
      nginx -t
    fi
  fi
else
  warn "nginx не настроен автоматически — мост доступен только локально"
fi

# ── итог ──────────────────────────────────────────────────────────────────────
echo
say "──────────────── ГОТОВО ────────────────"
say "BRIDGE URL : https://mir.care$LOCATION"
say "TOKEN      : $TOKEN"
echo
say "проверка:  curl https://mir.care$LOCATION/health"
echo
say "Прописать в Vercel один раз (из папки проекта, после vercel login):"
for env in production preview; do
  printf '  printf %%s "https://mir.care%s" | vercel env add MAX17_BRIDGE_URL %s\n' "$LOCATION" "$env"
  printf '  printf %%s "%s" | vercel env add MAX17_BRIDGE_TOKEN %s\n' "$TOKEN" "$env"
done
printf '  vercel --prod\n'
echo
say "Адрес больше не меняется. Мак может спать."
say "лог моста:  journalctl -u max17-bridge -f"
