#!/bin/bash
# Развернуть GAME на сервере mir.care — одной командой.
#
#   bash deploy/mircare.sh              # разведка: что там стоит, что будет сделано
#   bash deploy/mircare.sh --deploy     # выкатить
#   bash deploy/mircare.sh --auto       # выкатить и включить автообновление раз в 10 минут
#
# Запускать НА СЕРВЕРЕ (ssh root@167.99.8.198), а не на маке.
#
# Осторожность не из вежливости: на mir.care работает своя сборка со своим
# голосом (piper), которой нет в репозитории. Слепой git pull её снесёт,
# поэтому по умолчанию скрипт ничего не делает — только показывает.

set -uo pipefail

REPO="https://github.com/mironmotor/game.git"
BRANCH="${BRANCH:-main}"

say()  { printf '\033[1;36m[mir.care]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[mir.care]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[mir.care]\033[0m %s\n' "$*"; exit 1; }

MODE="scan"
for arg in "$@"; do
  case "$arg" in
    --deploy) MODE="deploy" ;;
    --auto)   MODE="auto" ;;
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

if [ "$MODE" = "scan" ]; then
  echo
  say "Пока ничего не сделано — это разведка."
  say "Выкатить:                 bash $0 --deploy"
  say "Выкатить + автообновление: bash $0 --auto"
  exit 0
fi

# ── выкатка ──────────────────────────────────────────────────────────────────
[ -n "$SITE_DIR" ] || fail "не нашёл папку сайта — укажи вручную: SITE_DIR=/путь bash $0 --deploy"
[ -d "$SITE_DIR/.git" ] || fail "сайт не под git — автовыкатка невозможна"

cd "$SITE_DIR" || fail "не смог зайти в $SITE_DIR"

# Резервная копия сборки: если новая не соберётся, сайт продолжит работать на старой.
if [ -d .next ]; then
  rm -rf .next.backup && cp -r .next .next.backup && say "старая сборка сохранена в .next.backup"
fi

say "обновляю код…"
git fetch origin "$BRANCH" || fail "не смог забрать изменения"
git merge --ff-only "origin/$BRANCH" || fail "быстрый мерж не прошёл — на сервере есть свои коммиты, разбери вручную"

say "ставлю зависимости…"
npm ci --omit=dev 2>/dev/null || npm install || fail "зависимости не встали"

say "собираю…"
if ! npm run build; then
  warn "сборка упала — возвращаю прежнюю"
  [ -d .next.backup ] && rm -rf .next && mv .next.backup .next
  fail "сайт остался на прежней версии, ничего не сломано"
fi
rm -rf .next.backup

say "перезапускаю…"
case "$RUNNER" in
  pm2)     pm2 restart all ;;
  systemd) systemctl restart "$(systemctl list-units --type=service --state=running | grep -oiE '[a-z0-9_-]*(game|next|mir)[a-z0-9_-]*\.service' | head -1)" ;;
  docker)  docker restart "$(docker ps --format '{{.Names}}' | grep -iE 'game|next' | head -1)" ;;
  *)       warn "не понял, чем запущен сайт — перезапусти процесс сам" ;;
esac

say "готово: https://mir.care"

# ── автообновление ───────────────────────────────────────────────────────────
if [ "$MODE" = "auto" ]; then
  CRON="*/10 * * * * cd $SITE_DIR && bash $SITE_DIR/deploy/mircare.sh --deploy >> /var/log/mircare-deploy.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v 'mircare.sh'; echo "$CRON" ) | crontab -
  say "автообновление включено: раз в 10 минут подтягивает $BRANCH"
  say "лог: tail -f /var/log/mircare-deploy.log"
  say "выключить: crontab -e и убрать строку с mircare.sh"
fi
