#!/bin/bash
# Разведка сервера mir.care: что там стоит и в каком оно состоянии.
#
#   bash deploy/mircare.sh              # разведка
#
# Запускать НА СЕРВЕРЕ (ssh root@167.99.8.198).
#
# ВЫКАТКА ЭТИМ СКРИПТОМ БОЛЬШЕ НЕ ДЕЛАЕТСЯ — оба её условия на mir.care ложны:
#   1. /var/www/game не под git (.git отсутствует) — обновлять git pull нечего;
#   2. на дроплете 458 МБ RAM, `next build` там падает по памяти всегда.
# Выкатывать нужно с мака: bash deploy/mircare-push.sh --deploy — он собирает
# локально и везёт готовый .next, не трогая mark17/state (живую память ядра).
#
# Боевая ветка сайта — ultra, не main. Сверка 2026-08-12: из 271 исходника
# сервера 226 совпадают с ultra и только 45 с main. В main нет ни premium,
# ни admin, ни tts, ни mircoin, ни lib/db — выкат main снёс бы сайт.

set -uo pipefail

REPO="https://github.com/mironmotor/game.git"
BRANCH="${BRANCH:-ultra}"

say()  { printf '\033[1;36m[mir.care]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[mir.care]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[mir.care]\033[0m %s\n' "$*"; exit 1; }

MODE="scan"
for arg in "$@"; do
  case "$arg" in
    --deploy|--auto)
      fail "выкатка отсюда невозможна: сайт не под git, а сборка не влезает в память сервера.
       Выкатывай с мака:  bash deploy/mircare-push.sh --deploy" ;;
    *) fail "неизвестный флаг: $arg" ;;
  esac
done

# ── что тут вообще крутится ──────────────────────────────────────────────────
say "разведка…"

SITE_DIR=""
for guess in /var/www/mir.care /var/www/game /opt/game /root/game /home/*/game /srv/game; do
  [ -f "$guess/package.json" ] && { SITE_DIR="$guess"; break; }
done
if [ -z "$SITE_DIR" ]; then
  SITE_DIR="$(find / -maxdepth 5 -name package.json -not -path '*/node_modules/*' 2>/dev/null \
    | head -1 | xargs -r dirname)"
fi

say "папка сайта:   ${SITE_DIR:-НЕ НАЙДЕНА}"
say "порт 80/443:   $(ss -lntp 2>/dev/null | grep -E ':80|:443' | head -1 | sed 's/.*users:(//' | cut -d, -f1 || echo '—')"

RUNNER="—"
command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null | grep -q online && RUNNER="pm2"
systemctl list-units --type=service --state=running 2>/dev/null | grep -qiE 'game|next|mir' && RUNNER="systemd"
docker ps 2>/dev/null | grep -qiE 'game|next' && RUNNER="docker"
say "чем запущено:  $RUNNER"

if [ -n "$SITE_DIR" ] && [ -d "$SITE_DIR/.git" ]; then
  say "git:           $(git -C "$SITE_DIR" remote get-url origin 2>/dev/null || echo 'нет origin')"
  say "ветка:         $(git -C "$SITE_DIR" branch --show-current 2>/dev/null)"
  DIRTY="$(git -C "$SITE_DIR" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  say "не в git:      $DIRTY файлов"
  [ "$DIRTY" -gt 0 ] && warn "есть правки, которых нет в репозитории — при обновлении они потеряются"
else
  warn "сайт не под git — обновить через git pull нельзя, нужен ручной перенос файлов"
fi

# Ищем то, чего в репозитории нет: это и есть риск потери.
if [ -n "$SITE_DIR" ]; then
  for uniq in piper .env.local certs uploads data; do
    [ -e "$SITE_DIR/$uniq" ] && warn "на сервере есть «$uniq» — в репозитории этого нет, не затирать"
  done
fi

# Живая память ядра — то, чего нет нигде, кроме этого сервера.
if [ -n "$SITE_DIR" ] && [ -d "$SITE_DIR/mark17/state" ]; then
  say "память ядра:   $(du -sh "$SITE_DIR/mark17/state" 2>/dev/null | cut -f1) в mark17/state — бэкапить перед каждой выкаткой"
fi

echo
say "Это только разведка, ничего не изменено."
say "Выкатка идёт с мака:  bash deploy/mircare-push.sh --deploy"
