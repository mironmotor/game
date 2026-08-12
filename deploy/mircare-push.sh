#!/bin/bash
# Выкатить mir.care С МАКА. Запускать здесь, на маке, а не на сервере.
#
#   bash deploy/mircare-push.sh            # разведка: что уедет, что останется
#   bash deploy/mircare-push.sh --deploy   # собрать локально и выкатить
#
# Почему не git pull на сервере, как в mircare.sh:
#   1. /var/www/game не под git — там ручная сборка, git pull физически нечего
#      обновлять;
#   2. на дроплете 458 МБ RAM, `next build` там падает по памяти всегда, даже
#      со свопом. Сборка идёт тут, на сервер уезжает готовый .next.
#
# Что НИКОГДА не уезжает и не затирается:
#   mark17/state/  — живая память ядра (~230 МБ, растёт каждый час). Она есть
#                    только на сервере. Скрипт снимает её к себе перед выкаткой.
#   .env.local     — ключи сервера, в репозитории их нет.
#   piper/         — локальный голос, поставлен руками.

set -uo pipefail

SERVER="${SERVER:-root@167.99.8.198}"
SITE="${SITE:-/var/www/game}"
BRANCH_EXPECTED="ultra"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"

say()  { printf '\033[1;36m[push]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[push]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[push]\033[0m %s\n' "$*"; exit 1; }

MODE="scan"
for arg in "$@"; do
  case "$arg" in
    --deploy) MODE="deploy" ;;
    *) fail "неизвестный флаг: $arg" ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || fail "не нашёл корень проекта"

# ── проверки на маке ─────────────────────────────────────────────────────────
BRANCH="$(git branch --show-current 2>/dev/null)"
say "ветка:      ${BRANCH:-?}"
[ "$BRANCH" = "$BRANCH_EXPECTED" ] || warn "боевая ветка mir.care — «$BRANCH_EXPECTED». Сейчас «$BRANCH»: выкатишь не тот сайт."

DIRTY="$(git status --porcelain | grep -vc '^?? ' || true)"
[ "$DIRTY" -gt 0 ] && warn "$DIRTY незакоммиченных правок — уедут в прод, но в истории их не будет"

command -v node >/dev/null || fail "нет node. Он в ~/.local/nodejs — добавь в PATH"
say "node:       $(node -v)"

# ── проверки на сервере ──────────────────────────────────────────────────────
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SERVER" true 2>/dev/null \
  || fail "нет доступа к $SERVER по ключу"

say "сервер:     $(ssh "$SERVER" 'uptime -p' 2>/dev/null)"
say "диск:       $(ssh "$SERVER" "df -h / | awk 'NR==2{print \$4\" свободно (\"\$5\" занято)\"}'")"
say "память:     $(ssh "$SERVER" "free -m | awk 'NR==2{print \$7\" МБ доступно\"}'")"
say "state:      $(ssh "$SERVER" "du -sh $SITE/mark17/state 2>/dev/null | cut -f1") — останется нетронутой"

if [ "$MODE" = "scan" ]; then
  echo
  say "Ничего не сделано — это разведка."
  say "Выкатить: bash $0 --deploy"
  exit 0
fi

# ── 1. память ядра к себе ────────────────────────────────────────────────────
STAMP="$(ssh "$SERVER" 'date +%Y-%m-%d-%H%M')"
DEST="$BACKUP_DIR/mircare-state-$STAMP"
say "снимаю память ядра → $DEST"
mkdir -p "$DEST"

# Ядро пишет в свои базы прямо сейчас, поэтому rsync почти всегда встречает
# пропавший файл: SQLite создаёт и убирает -wal/-shm по ходу транзакций.
# -shm бесполезен без живого процесса, его не берём; -wal берём, он нужен
# для восстановления. Код 24 («vanished») — про эту суету, а не про сбой.
rsync -az --exclude='*-shm' "$SERVER:$SITE/mark17/state/" "$DEST/"
RC=$?
case "$RC" in
  0)  ;;
  24) warn "часть временных файлов SQLite исчезла на лету — для живого ядра это норма" ;;
  *)  fail "бэкап памяти не удался (rsync $RC) — дальше не иду" ;;
esac

GOT="$(find "$DEST" -type f | wc -l | tr -d ' ')"
[ "$GOT" -gt 0 ] || fail "бэкап пуст — дальше не иду"
say "снято: $(du -sh "$DEST" | cut -f1), файлов $GOT"

# ── 2. сборка тут ────────────────────────────────────────────────────────────
# Пустой GAME_BASE_PATH — сервер отдаёт сайт с корня, локально по умолчанию /game.
say "собираю (GAME_BASE_PATH='', это займёт пару минут)…"
GAME_BASE_PATH='' NODE_ENV=production npm run build || fail "сборка упала — на сервер ничего не поехало"
[ -f .next/BUILD_ID ] || fail "нет .next/BUILD_ID — сборка неполная"
say "собрано: BUILD_ID $(cat .next/BUILD_ID)"

# ── 3. откат наготове ────────────────────────────────────────────────────────
say "сохраняю прежнюю сборку на сервере в .next.backup"
ssh "$SERVER" "rm -rf $SITE/.next.backup && cp -r $SITE/.next $SITE/.next.backup" \
  || warn "не смог сохранить прежнюю сборку — откат будет только из git"

# ── 4. код на сервер ─────────────────────────────────────────────────────────
# cache/ — это сотни мегабайт кэша webpack, серверу он не нужен.
say "везу сборку…"
rsync -az --delete --exclude='cache/' .next/ "$SERVER:$SITE/.next/" || fail "не довёз .next"

# Питоновское ядро запускается на сервере из исходников, поэтому едет отдельно.
# state/ исключена жёстко: там живая память, её затирать нельзя.
say "везу ядро mark17 (без state/)…"
rsync -az --exclude='state/' --exclude='__pycache__/' --exclude='*.pyc' \
  mark17/ "$SERVER:$SITE/mark17/" || fail "не довёз mark17"

if ! ssh "$SERVER" "cmp -s $SITE/package.json /dev/stdin" < package.json; then
  say "package.json изменился — обновляю зависимости на сервере…"
  rsync -az package.json package-lock.json "$SERVER:$SITE/"
  ssh "$SERVER" "cd $SITE && npm ci --omit=dev" \
    || warn "npm ci не прошёл (вероятно память) — сборка может не подняться"
fi

# ── 5. перезапуск и проверка ─────────────────────────────────────────────────
say "перезапускаю…"
ssh "$SERVER" 'pm2 restart game --update-env' >/dev/null 2>&1 || fail "pm2 не перезапустился"
sleep 5

CODE="$(curl -s -o /dev/null -w '%{http_code}' https://mir.care)"
if [ "$CODE" = "200" ]; then
  say "готово: https://mir.care отвечает $CODE"
  ssh "$SERVER" "rm -rf $SITE/.next.backup"
else
  warn "mir.care отвечает $CODE — откатываю"
  ssh "$SERVER" "rm -rf $SITE/.next && mv $SITE/.next.backup $SITE/.next && pm2 restart game" >/dev/null 2>&1
  fail "откатился на прежнюю сборку. Логи: ssh $SERVER 'pm2 logs game --lines 50'"
fi
