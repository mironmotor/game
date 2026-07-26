#!/usr/bin/env bash
# Love VPN — установка бота на сервер (Ubuntu/Debian) как systemd-сервис.
#
# Запускать на СЕРВЕРЕ от root, из каталога lovevpn/:
#   sudo bash deploy/install.sh
#
# Скрипт идемпотентный: повторный запуск обновляет код и перезапускает сервис.

set -euo pipefail

APP_DIR=/opt/lovevpn
STATE_DIR=/var/lib/lovevpn
SERVICE=lovevpn-bot
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Нужны права root: sudo bash deploy/install.sh" >&2
  exit 1
fi

echo "==> Проверяю python3"
command -v python3 >/dev/null || { echo "python3 не найден. apt install python3 python3-venv" >&2; exit 1; }
python3 -c "import venv" 2>/dev/null || { echo "Нет модуля venv. apt install python3-venv" >&2; exit 1; }

echo "==> Пользователь $SERVICE"
id -u lovevpn >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin lovevpn

echo "==> Код в $APP_DIR"
mkdir -p "$APP_DIR" "$STATE_DIR"
# Копируем только бота: .env переносим отдельно, чтобы не перезатирать существующий.
rm -rf "$APP_DIR/bot"
cp -r "$SRC_DIR/bot" "$APP_DIR/bot"

if [[ -f "$SRC_DIR/.env" && ! -f "$APP_DIR/.env" ]]; then
  cp "$SRC_DIR/.env" "$APP_DIR/.env"
  echo "    .env скопирован"
fi

if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$SRC_DIR/.env.example" "$APP_DIR/.env"
  echo "    !! Создан $APP_DIR/.env из примера — впишите BOT_TOKEN перед запуском."
fi

if [[ -f "$SRC_DIR/configs.txt" && ! -f "$STATE_DIR/configs.txt" ]]; then
  cp "$SRC_DIR/configs.txt" "$STATE_DIR/configs.txt"
  echo "    configs.txt скопирован в $STATE_DIR"
fi

echo "==> Виртуальное окружение и зависимости"
[[ -d "$APP_DIR/.venv" ]] || python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/bot/requirements.txt"

echo "==> Права"
chown -R lovevpn:lovevpn "$APP_DIR" "$STATE_DIR"
chmod 600 "$APP_DIR/.env"

echo "==> systemd"
install -m 644 "$SRC_DIR/deploy/$SERVICE.service" "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable "$SERVICE"

if grep -qE '^BOT_TOKEN=.+' "$APP_DIR/.env"; then
  systemctl restart "$SERVICE"
  sleep 2
  systemctl --no-pager --lines=15 status "$SERVICE" || true
  echo
  echo "Готово. Логи: journalctl -u $SERVICE -f"
else
  echo
  echo "Сервис установлен, но НЕ запущен: в $APP_DIR/.env нет BOT_TOKEN."
  echo "Впишите токен, затем: systemctl start $SERVICE && journalctl -u $SERVICE -f"
fi
