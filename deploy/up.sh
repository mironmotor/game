#!/usr/bin/env bash
# Выкатить свежий main на mir.care — одной строкой с телефона.
#
#   curl -sL https://raw.githubusercontent.com/mironmotor/game/main/deploy/up.sh | bash
#
# Запускать НА СЕРВЕРЕ (root@167.99.8.198).
#
# Чем это отличается от deploy/mircare.sh: тот умеет обновлять только папку,
# которая уже под гитом, и на живом сервере честно отказывается работать —
# /var/www/game там распакованная сборка без истории. Этот скрипт закрывает
# ровно эту дыру: один раз усыновляет папку (git init + fetch + reset), а
# дальше каждый следующий запуск — обычное обновление.
#
# Что НЕ трогается: всё, чего нет в репозитории. piper, .env.local, certs,
# uploads и накопленное состояние Макса в mark17/state лежат вне гита, а
# `git reset --hard` переписывает только отслеживаемые файлы и не удаляет
# посторонние. Это не осторожность на всякий случай — на сервере живёт своя
# голосовая сборка, которой в репозитории нет, и слепая перезапись снесла бы её.

set -uo pipefail

REPO="https://github.com/mironmotor/game.git"
BRANCH="${BRANCH:-main}"
RAW_BASE="https://raw.githubusercontent.com/mironmotor/game/$BRANCH"

say()  { printf '\033[1;36m[up]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[up]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[up]\033[0m %s\n' "$*"; exit 1; }

# Режим диагностики: ничего не меняет, только рассказывает. Нужен, чтобы
# разобраться в поломке одной короткой командой, а не диктовать человеку
# десяток длинных по одной — набирать их приходится вручную, с телефона.
MODE="deploy"
ARG1="${1:-}"
case "$ARG1" in
  --diag|-d) MODE="diag"; ARG1="" ;;
  --core|-c) MODE="core"; ARG1="" ;;
esac

# ── где сайт ─────────────────────────────────────────────────────────────────
APP_DIR="${APP_DIR:-$ARG1}"
if [ -z "$APP_DIR" ]; then
  for guess in /var/www/game /var/www/mir.care /opt/game /root/game /srv/game; do
    [ -f "$guess/package.json" ] && { APP_DIR="$guess"; break; }
  done
fi
[ -n "$APP_DIR" ] || fail "не нашёл папку сайта — запусти так: APP_DIR=/путь bash up.sh"
[ -f "$APP_DIR/package.json" ] || fail "в $APP_DIR нет package.json"
cd "$APP_DIR" || fail "не смог зайти в $APP_DIR"
say "папка сайта:  $APP_DIR"

command -v git  >/dev/null || fail "нет git"
command -v npm  >/dev/null || fail "нет npm"

# Процесс запоминаем ДО обновления кода: pm2 перечитает список после рестарта,
# а нам нужно знать, кого именно перезапускать, ещё на старом состоянии.
# Процессов в одной папке бывает несколько: рядом с сайтом живёт мост Макса.
# Первый найденный — не тот, кого достаточно перезапустить: код обновился у
# обоих. Поэтому собираем всех, у кого рабочая папка совпадает.
PM2_NAMES=""
if command -v pm2 >/dev/null 2>&1; then
  PM2_NAMES="$(pm2 jlist 2>/dev/null | python3 -c '
import json, sys, os
try:
    apps = json.load(sys.stdin)
except Exception:
    raise SystemExit
want = os.path.realpath(sys.argv[1])
for a in apps:
    env = a.get("pm2_env", {}) or {}
    cwd = env.get("pm_cwd") or env.get("cwd") or ""
    name = a.get("name", "")
    if name and cwd and os.path.realpath(cwd) == want:
        print(name)
' "$APP_DIR" 2>/dev/null)"
fi
say "pm2-процессы: $(echo ${PM2_NAMES:-не найдены} | tr '\n' ' ')"

# package.json сервера снимаем ДО того, как git его перезапишет. На mir.care
# ровно это и сломало сборку: у сервера свой package.json с drizzle-orm под
# свои роуты (lib/db, user-count, game-state), которых в репозитории нет.
# reset --hard подменил его версией из гита, npm ci снёс node_modules и
# поставил ровно то, что в lock-файле, — и сборка упала на собственных файлах
# сервера. Снимок нужен, чтобы вернуть потерянное, а не гадать по тексту ошибки.
PRE_PKG="$(mktemp)"
[ -f package.json ] && cp package.json "$PRE_PKG"
EXTRA_FILE="$APP_DIR/.deploy-extra-deps.json"

# Только ядро: обновить mark17 и перезапустить мост, не трогая сайт.
#
# Понадобилось потому, что на mir.care сайт и репозиторий — разные
# приложения в одной папке. У сервера свой lib/auth.ts на NextAuth, в
# репозитории lib/auth.tsx на Firebase; оба отзываются на @/lib/auth, а Next
# разрешает .tsx раньше .ts — и репозиторный файл заслоняет серверный.
# Сборка сайта из-за этого не проходит и пройти не может, пока приложения не
# сведены. Ядру же сборка не нужна вовсе: это отдельный процесс на python,
# и обновляется он независимо.
#
# Отсюда checkout ровно одного каталога вместо reset всего дерева: остальные
# файлы сервера не должны шелохнуться.
if [ "$MODE" = "core" ]; then
  [ -d .git ] || fail "папка ещё не под гитом — сначала запусти без флагов"
  git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
  say "обновляю только ядро (mark17), сайт не трогаю…"
  git fetch -q --depth 1 origin "$BRANCH" || fail "не смог забрать $BRANCH"
  git checkout -q FETCH_HEAD -- mark17 || fail "не смог обновить mark17"
  say "ядро обновлено до $(git rev-parse --short FETCH_HEAD)"

  if python3 -c 'import numpy' 2>/dev/null; then
    say "numpy: на месте"
  else
    warn "numpy нет — ядро не поднимется:  apt-get install -y python3-numpy"
  fi

  # Перезапускаем только мост. Процессы сайта не трогаем намеренно: их код мы
  # и не меняли, а лишний рестарт — лишний способ уронить работающее.
  BRIDGE="$(echo "$PM2_NAMES" | grep -iE 'max17|bridge' | head -1)"
  if [ -n "$BRIDGE" ]; then
    pm2 restart "$BRIDGE" --update-env >/dev/null 2>&1 \
      && say "перезапущен: $BRIDGE" || warn "не смог перезапустить $BRIDGE"
  else
    warn "не нашёл процесс моста среди: $(echo ${PM2_NAMES:-нет} | tr '\n' ' ')"
    warn "перезапусти сам:  pm2 restart <имя>"
  fi
  say "готово. Проверка:  pm2 logs $BRIDGE --lines 30"
  exit 0
fi

if [ "$MODE" = "diag" ]; then
  echo
  say "──────────── ДИАГНОСТИКА (ничего не меняю) ────────────"
  if [ -d .git ]; then
    say "версия:  $(git rev-parse --short HEAD 2>/dev/null || echo '—')"
    echo
    say "файлы на сервере, которых НЕТ в репозитории:"
    git status --porcelain 2>/dev/null | awk '/^\?\?/{print "  " $2}' | head -40
  else
    warn "папка ещё не под гитом — запусти без --diag"
  fi
  echo
  say "зависимости, восстанавливаемые после npm ci:"
  if [ -s "$EXTRA_FILE" ]; then cat "$EXTRA_FILE"; else echo "  (пусто)"; fi
  echo
  say "процессы pm2: $(echo ${PM2_NAMES:-нет} | tr '\n' ' ')"
  say "numpy: $(python3 -c 'import numpy' 2>/dev/null && echo есть || echo НЕТ)"
  say "свободно RAM: $(free -m 2>/dev/null | awk '/^Mem:/{print $7}') МБ"

  # «online» в pm2 ничего не доказывает: server.py поднимается на одной
  # стандартной библиотеке, тяжёлое подтягивается позже, и процесс горит
  # зелёным, будучи бесполезным. Спрашиваем сам мост и его память.
  echo
  say "ядро Макса:"
  BPORT="$(pm2 jlist 2>/dev/null | python3 -c '
import json, sys
try:
    apps = json.load(sys.stdin)
except Exception:
    raise SystemExit
for a in apps:
    name = (a.get("name") or "").lower()
    if "max17" in name or "bridge" in name:
        port = ((a.get("pm2_env") or {}).get("env") or {}).get("PORT")
        if port:
            print(port)
            break
' 2>/dev/null)"
  # Порт в окружении pm2 может и не значиться — тогда спрашиваем ядро само,
  # перебирая обычные места. 8000 — значение по умолчанию в server.py.
  # Вывод неудачной попытки прячем: перебор портов — наша внутренняя кухня,
  # и три строки «connection refused» подряд читаются как поломка, хотя это
  # обычный поиск. Показываем только то, что нашлось, а если не нашлось
  # ничего — одну внятную строку вместо четырёх невнятных.
  # Диагностика ничего не обновляет — а значит помощника рядом может и не
  # быть: на сервере дерево остаётся на той версии, до которой дошла
  # последняя удачная выкатка. Без этого разбор молча врал бы «мост не
  # отвечает», хотя мост жив, а не хватает файла. Берём помощника оттуда же,
  # откуда пришёл сам скрипт, во временный файл — папку сайта не трогаем.
  HELPER="$APP_DIR/deploy/core_health.py"
  if [ ! -f "$HELPER" ]; then
    HELPER="$(mktemp)"
    if ! curl -sfL -m 20 "$RAW_BASE/deploy/core_health.py" -o "$HELPER" 2>/dev/null; then
      rm -f "$HELPER"; HELPER=""
      warn "не смог получить core_health.py — проверю только, отвечает ли мост"
    fi
  fi

  CORE_OUT=""
  for candidate in ${BPORT:-} 8000 8790 3001; do
    [ -n "$candidate" ] || continue
    if [ -z "$HELPER" ]; then
      if curl -sf -m 5 "http://127.0.0.1:$candidate/health" >/dev/null 2>&1; then
        say "  мост отвечает на порту $candidate"
        CORE_OUT="ok"; break
      fi
      continue
    fi
    if CORE_OUT="$(python3 "$HELPER" "http://127.0.0.1:$candidate" 2>/dev/null)"; then
      printf '%s\n' "$CORE_OUT"
      CORE_OUT="ok"
      break
    fi
    CORE_OUT=""
  done
  if [ -z "$CORE_OUT" ]; then
    warn "мост не отвечает ни на одном из портов: ${BPORT:-} 8000 8790 3001"
    warn "лог:  pm2 logs max17-bridge --lines 30"
  fi
  exit 0
fi

# ── резервная копия ──────────────────────────────────────────────────────────
# node_modules и .next не архивируем: они восстанавливаются сборкой, а весят
# больше всего остального вместе взятого — из-за них копия делалась бы минуты
# и съедала гигабайты на каждую выкатку.
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/root/backups/game-$STAMP.tgz"
mkdir -p /root/backups
say "делаю резервную копию…"
if tar czf "$BACKUP" --exclude=node_modules --exclude=.next --exclude=.git -C "$APP_DIR" . 2>/dev/null; then
  say "копия:        $BACKUP ($(du -h "$BACKUP" | cut -f1))"
else
  warn "копия сделалась не полностью — но исходные файлы на месте, продолжаю"
fi

# ── усыновление или обновление ───────────────────────────────────────────────
# /var/www принадлежит не root, и git на этом останавливается: «detected
# dubious ownership». Защита правильная — она не даёт выполнить чужой
# .git/config от имени root, — но здесь папка своя, и запрет надо снять
# явно. Ровно эту команду git и предлагает сам в тексте ошибки.
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

if [ ! -d .git ]; then
  say "папка не под гитом — усыновляю (история появится, файлы вне репозитория останутся)"
  git init -q || fail "git init не прошёл"
fi

# Remote выставляем отдельно от init, а не следом за ним: если прошлый запуск
# успел создать .git и споткнулся до remote, папка выглядит как «уже под
# гитом», а origin в ней нет — и fetch падает с «origin does not appear to be
# a git repository». Спрашиваем git, есть ли remote, вместо того чтобы гадать.
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO" || fail "не смог поправить origin"
else
  git remote add origin "$REPO" || fail "не смог добавить origin"
fi

say "забираю $BRANCH…"
# --depth 1: история сервером не нужна, а полный клон этого репозитория тянет
# заметно дольше на скромном канале дроплета.
git fetch -q --depth 1 origin "$BRANCH" || fail "не смог забрать $BRANCH"

NEW_SHA="$(git rev-parse --short FETCH_HEAD)"
OLD_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo '—')"
say "было:         $OLD_SHA"
say "станет:       $NEW_SHA"

git symbolic-ref HEAD "refs/heads/$BRANCH" 2>/dev/null || true
git reset --hard -q FETCH_HEAD || fail "не смог применить $BRANCH"
say "код обновлён"

# ── зависимости ──────────────────────────────────────────────────────────────
# Именно npm ci без --omit=dev: next build собирает через typescript и tailwind,
# а они в devDependencies. Без них сборка падает на ровном месте.
# Первое знакомство: своего списка ещё нет, а package.json сервера могла
# перезаписать уже прошлая выкатка — сравнивать не с чем, разница нулевая, и
# потеря невидима. Но прежний package.json лежит в резервных копиях, которые
# эта же выкатка и делает, каждый раз ДО подмены файлов. Оттуда и достаём.
#
# Перебираем несколько копий, а не только свежую: свежая может быть сделана
# уже после подмены и ничего не знать о потерянном. Объединение по нескольким
# копиям находит расхождение независимо от того, на какой выкатке оно возникло.
if [ ! -f "$EXTRA_FILE" ]; then
  SEEDED=""
  for archive in $(ls -1t /root/backups/game-*.tgz 2>/dev/null | head -5); do
    SEED="$(mktemp)"
    if tar xzOf "$archive" ./package.json > "$SEED" 2>/dev/null && [ -s "$SEED" ]; then
      FOUND="$(python3 "$APP_DIR/deploy/extra_deps.py" save "$SEED" package.json "$EXTRA_FILE" 2>/dev/null)"
      [ -n "$FOUND" ] && SEEDED="yes"
    fi
    rm -f "$SEED"
  done
  [ -n "$SEEDED" ] && say "из резервных копий восстановлен список серверных зависимостей"
fi

# Что было у сервера и пропало из репозитория — запоминаем НАВСЕГДА, в файл
# вне гита. Иначе список живёт ровно один запуск: на следующем «прежним»
# package.json окажется уже репозиторный, и потеря станет невидимой.
python3 "$APP_DIR/deploy/extra_deps.py" save "$PRE_PKG" package.json "$EXTRA_FILE" || true

say "ставлю зависимости…"
npm ci --no-audit --no-fund 2>&1 | tail -3 || {
  warn "npm ci не прошёл, пробую npm install"
  npm install --no-audit --no-fund 2>&1 | tail -3 || fail "зависимости не встали"
}

# npm ci ставит ровно lock-файл и ничего сверх него, поэтому серверные пакеты
# докладываем отдельно и после — иначе он их же и снесёт.
if [ -s "$EXTRA_FILE" ]; then
  EXTRA_ARGS="$(python3 "$APP_DIR/deploy/extra_deps.py" args "$EXTRA_FILE" 2>/dev/null)"
  if [ -n "$EXTRA_ARGS" ]; then
    say "возвращаю серверные зависимости: $EXTRA_ARGS"
    npm i --no-audit --no-fund $EXTRA_ARGS 2>&1 | tail -2 || warn "не встали: $EXTRA_ARGS"
  fi
fi

# ── сборка ───────────────────────────────────────────────────────────────────
if [ -d .next ]; then
  rm -rf .next.backup && cp -r .next .next.backup && say "прежняя сборка сохранена"
fi

# Сборка Next — самое прожорливое место всей выкатки. На дроплете с малым ОЗУ
# она падает по нехватке памяти, и по логу это выглядит как загадочное
# «Killed» без объяснений. Временный своп дешевле и честнее, чем гадать.
SWAP_ADDED=""
AVAIL_MB="$(free -m 2>/dev/null | awk '/^Mem:/{print $7}')"
if [ -n "$AVAIL_MB" ] && [ "$AVAIL_MB" -lt 1200 ] && [ ! -f /swapfile-up ]; then
  say "свободно ${AVAIL_MB} МБ — добавляю временный своп на время сборки"
  if fallocate -l 2G /swapfile-up 2>/dev/null && chmod 600 /swapfile-up \
     && mkswap -q /swapfile-up 2>/dev/null && swapon /swapfile-up 2>/dev/null; then
    SWAP_ADDED="yes"
  else
    rm -f /swapfile-up
    warn "своп добавить не вышло — если сборку убьёт по памяти, дело в этом"
  fi
fi
cleanup_swap() {
  if [ -n "$SWAP_ADDED" ]; then
    swapoff /swapfile-up 2>/dev/null
    rm -f /swapfile-up
    say "временный своп убран"
  fi
}
trap cleanup_swap EXIT

say "собираю…"
BUILD_LOG="$(mktemp)"
if ! npm run build 2>&1 | tee "$BUILD_LOG"; then
  warn "сборка упала — возвращаю прежнюю"
  rm -rf .next
  [ -d .next.backup ] && mv .next.backup .next

  # Голый вывод webpack человеку ничего не говорит. «Can't resolve X» почти
  # всегда значит одно: на сервере лежит свой файл, которого нет в
  # репозитории, и он тянет пакет, которого нет в package.json. Называем
  # виновника прямо, вместо того чтобы заставлять читать сотню строк.
  MISSING="$(grep -o "Can't resolve '[^']*'" "$BUILD_LOG" 2>/dev/null \
    | sed "s/Can't resolve '//;s/'//" | cut -d/ -f1 | sort -u | tr '\n' ' ')"
  if [ -n "$MISSING" ]; then
    echo
    warn "не хватает пакетов: $MISSING"
    warn "их тянут файлы, которых нет в репозитории:"
    git status --porcelain 2>/dev/null | awk '/^\?\?/{print "  " $2}' | head -15
    warn "поставить и повторить:  npm i $MISSING && up"
  fi
  rm -f "$BUILD_LOG"
  fail "сайт остался на прежней версии, ничего не сломано"
fi
rm -f "$BUILD_LOG"
rm -rf .next.backup
cleanup_swap
trap - EXIT

# ── ядро Макса ───────────────────────────────────────────────────────────────
# Ядро запускается отдельным процессом python3 из app/api/max17. Если numpy
# нет, оно молча отвалится уже в проде, а сборка сайта об этом не узнает —
# поэтому проверяем здесь, а не оставляем на потом.
if command -v python3 >/dev/null 2>&1; then
  if python3 -c 'import numpy' 2>/dev/null; then
    say "python3 + numpy: на месте"
  else
    warn "python3 есть, а numpy нет — ядро Макса не поднимется"
    warn "поставить:  apt-get install -y python3-numpy"
  fi
else
  warn "python3 не найден — ядро Макса работать не будет"
fi

# MAX17_BRIDGE_URL на своём сервере должен быть пустым: тогда роут запускает
# python3 рядом с собой. Если адрес задан, ядро ходит кругом через сеть — на
# Vercel это единственный способ, здесь же лишний крюк и лишняя точка отказа.
if grep -qs 'MAX17_BRIDGE_URL=.\+' .env.local .env.production .env 2>/dev/null; then
  warn "в .env задан MAX17_BRIDGE_URL — ядро пойдёт через сеть, а не напрямую"
  warn "на этом сервере его стоит убрать: питон и сайт живут в одной папке"
fi

# ── перезапуск ───────────────────────────────────────────────────────────────
say "перезапускаю…"
if [ -n "$PM2_NAMES" ]; then
  echo "$PM2_NAMES" | while read -r proc; do
    [ -n "$proc" ] || continue
    if pm2 restart "$proc" --update-env >/dev/null 2>&1; then
      say "pm2: $proc перезапущен"
    else
      warn "pm2 не перезапустил $proc — сделай сам: pm2 restart $proc"
    fi
  done
elif command -v pm2 >/dev/null 2>&1; then
  warn "не понял, какой процесс отвечает за $APP_DIR"
  pm2 list
  warn "перезапусти нужный сам: pm2 restart <имя>"
else
  warn "pm2 нет — перезапусти процесс сайта сам"
fi

# Дальше эта же выкатка вызывается двумя буквами. Восемьдесят символов,
# набираемых с телефона по каждому поводу, — это и есть та цена, из-за
# которой проверить догадку дольше, чем её придумать.
if [ "$(id -u)" = "0" ] && [ -d /usr/local/bin ]; then
  printf '#!/bin/sh\nexec bash %s/deploy/up.sh "$@"\n' "$APP_DIR" > /usr/local/bin/up
  chmod +x /usr/local/bin/up
  say "теперь достаточно:  up   |   up --core (только ядро)   |   up --diag"
fi

echo
say "──────────────── ГОТОВО ────────────────"
say "версия:   $OLD_SHA → $NEW_SHA"
say "откат:    tar xzf $BACKUP -C $APP_DIR"
say "проверка: curl -s localhost:3000 >/dev/null && echo ok"
say "лог:      pm2 logs --lines 50"
rm -f "$PRE_PKG"
