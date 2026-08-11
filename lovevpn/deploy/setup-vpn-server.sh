#!/usr/bin/env bash
# Love VPN — поднять VPN-сервер (Xray, VLESS + Reality) на чистом Ubuntu/Debian.
#
# Запускать НА СЕРВЕРЕ от root:
#   bash setup-vpn-server.sh            50 конфигов (по умолчанию)
#   bash setup-vpn-server.sh 200        столько, сколько нужно
#
# На выходе — файл /root/lovevpn-configs.txt со ссылками vless://,
# готовый к загрузке в пул бота Love VPN.
#
# Reality выбран потому, что маскирует трафик под обычный TLS к чужому сайту:
# отдельный домен и сертификат не нужны, и такое соединение сложно отличить
# от обычного visit'а на этот сайт.

set -euo pipefail

COUNT="${1:-50}"
PORT="${PORT:-443}"
# Сайт, под который маскируется трафик. Должен поддерживать TLS 1.3 и HTTP/2.
DEST="${DEST:-www.microsoft.com}"
OUT=/root/lovevpn-configs.txt
XRAY_CONF=/usr/local/etc/xray/config.json

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Нужны права root. Запустите: sudo bash $0 $COUNT"
[[ $COUNT =~ ^[0-9]+$ && $COUNT -ge 1 && $COUNT -le 5000 ]] || die "Количество конфигов — число от 1 до 5000"

say "Проверяю систему"
command -v apt-get >/dev/null || die "Скрипт рассчитан на Ubuntu или Debian"
ok "Пакетный менеджер apt найден"

say "Ставлю зависимости"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl unzip jq qrencode >/dev/null
ok "curl, unzip, jq, qrencode"

say "Устанавливаю Xray"
if ! command -v xray >/dev/null; then
  # Официальный установщик проекта XTLS.
  bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install >/dev/null
fi
command -v xray >/dev/null || die "Xray не установился. Проверьте интернет на сервере."
ok "Xray $(xray version | head -1 | awk '{print $2}')"

say "Генерирую ключи Reality"
KEYS=$(xray x25519)
PRIVATE_KEY=$(echo "$KEYS" | awk '/[Pp]rivate/{print $NF}')
PUBLIC_KEY=$(echo "$KEYS" | awk '/[Pp]ublic/{print $NF}')
[[ -n $PRIVATE_KEY && -n $PUBLIC_KEY ]] || die "Не удалось сгенерировать ключи Reality"
SHORT_ID=$(openssl rand -hex 8)
ok "Ключевая пара и shortId готовы"

say "Создаю $COUNT клиентов"
CLIENTS_JSON=$(
  for _ in $(seq 1 "$COUNT"); do
    printf '{"id":"%s","flow":"xtls-rprx-vision"}\n' "$(xray uuid)"
  done | jq -s '.'
)
ok "UUID выданы"

say "Пишу конфигурацию Xray"
mkdir -p "$(dirname "$XRAY_CONF")"
cat > "$XRAY_CONF" <<JSON
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "port": $PORT,
      "protocol": "vless",
      "settings": {
        "clients": $CLIENTS_JSON,
        "decryption": "none"
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "dest": "$DEST:443",
          "serverNames": ["$DEST"],
          "privateKey": "$PRIVATE_KEY",
          "shortIds": ["$SHORT_ID"]
        }
      },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct" },
    { "protocol": "blackhole", "tag": "block" }
  ],
  "routing": {
    "rules": [
      { "type": "field", "ip": ["geoip:private"], "outboundTag": "block" }
    ]
  }
}
JSON
xray -test -config "$XRAY_CONF" >/dev/null || die "Конфигурация Xray не прошла проверку"
ok "Конфигурация валидна"

say "Запускаю Xray"
systemctl enable xray >/dev/null 2>&1 || true
systemctl restart xray
sleep 2
systemctl is-active --quiet xray || die "Xray не запустился. Смотрите: journalctl -u xray -n 50"
ok "Xray работает и слушает порт $PORT"

say "Настраиваю файрвол"
if command -v ufw >/dev/null; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow "$PORT"/tcp >/dev/null 2>&1 || true
  ok "ufw: открыты 22 и $PORT"
else
  ok "ufw не установлен — правила не трогаю"
fi

say "Собираю ссылки для клиентов"
IP=$(curl -fsS4 --max-time 10 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
[[ -n $IP ]] || die "Не удалось определить внешний IP сервера"

: > "$OUT"
i=0
while read -r uuid; do
  i=$((i + 1))
  printf 'vless://%s@%s:%s?type=tcp&security=reality&encryption=none&pbk=%s&fp=chrome&sni=%s&sid=%s&flow=xtls-rprx-vision#Love%%20VPN%%20NL-%s\n' \
    "$uuid" "$IP" "$PORT" "$PUBLIC_KEY" "$DEST" "$SHORT_ID" "$i" >> "$OUT"
done < <(echo "$CLIENTS_JSON" | jq -r '.[].id')
chmod 600 "$OUT"
ok "$i конфигов записано в $OUT"

say "Готово"
cat <<INFO

  Сервер:        $IP:$PORT
  Маскировка под: $DEST
  Конфигов:      $i

  Проверьте себя первым ключом (QR для телефона):

      qrencode -t ANSIUTF8 < <(head -1 $OUT)

  Заберите конфиги на Мак — выполните ЭТУ команду НА МАКЕ:

      scp root@$IP:$OUT ~/lovevpn/configs.txt

  Затем перезапустите бота: он подхватит пул при старте.
  Либо пришлите этот файл боту как .txt — вы админ, он импортирует сам.

  Файл с ключами доступа — секрет: не публикуйте его целиком.

INFO
