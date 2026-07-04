#!/bin/bash
# Установить мост Max17 как сервис macOS (launchd):
#   bash mark17/install_mac_service.sh          # установить и запустить
#   bash mark17/install_mac_service.sh remove   # убрать
# После установки мост живёт сам: автостарт при входе в систему,
# авторестарт при падении, caffeinate не даёт Маку заснуть, а при каждом
# новом туннеле URL сам прописывается в Vercel (если сделан `vercel login`
# и проект слинкован `vercel link`).

set -eu

MARK17="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$MARK17")"
LABEL="com.mironmotor.max17bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/max17bridge.log"

if [ "${1:-}" = "remove" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "[max17] сервис удалён"
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$MARK17/run_bridge_mac.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "[max17] сервис установлен и запущен."
echo "[max17] лог:      tail -f $LOG"
echo "[max17] статус:   launchctl list | grep max17"
echo "[max17] удалить:  bash mark17/install_mac_service.sh remove"
