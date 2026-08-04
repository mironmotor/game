#!/bin/bash
# Перенести «Game Ultra» (сборку MAX AGI с Мака) в репозиторий mironmotor/game.
#
#   bash scripts/push_ultra.sh                  # найти и показать (ничего не менять)
#   bash scripts/push_ultra.sh --push           # залить в ветку ultra
#   bash scripts/push_ultra.sh ~/путь --push    # если папку знаешь сам
#
# БЕЗОПАСНО ПО УСТРОЙСТВУ: заливает только в НОВУЮ ветку `ultra`, никогда в
# main, никогда с --force. Ничего затереть невозможно.

set -u

REPO_URL="https://github.com/mironmotor/game.git"
BRANCH="ultra"

say()  { printf '\033[1;36m[ultra]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[ultra]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[ultra]\033[0m %s\n' "$*"; exit 1; }

DIR=""
PUSH=0
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=1 ;;
    -*) fail "неизвестный флаг: $arg" ;;
    *) DIR="$arg" ;;
  esac
done

# ── поиск проекта ────────────────────────────────────────────────────────────
if [ -z "$DIR" ]; then
  say "ищу сборку Ultra (по маркерам GODMODE / MAX AGI / РАЗГОН)…"
  for base in "$HOME" "$HOME/Documents" "$HOME/Developer" "$HOME/Projects" "$HOME/code"; do
    [ -d "$base" ] || continue
    found="$(grep -rl -m1 -E 'GODMODE|MAX AGI|РАЗГОН' "$base" \
      --include='*.tsx' --include='*.ts' --include='*.jsx' --include='*.js' \
      --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git \
      2>/dev/null | head -1)"
    if [ -n "$found" ]; then
      DIR="$(cd "$(dirname "$found")" && git rev-parse --show-toplevel 2>/dev/null \
             || cd "$(dirname "$found")" && pwd)"
      break
    fi
  done
  [ -n "$DIR" ] || fail "не нашёл. Запусти с путём: bash scripts/push_ultra.sh ~/путь/к/ultra"
fi

[ -d "$DIR" ] || fail "нет такой папки: $DIR"
cd "$DIR" || fail "не смог зайти в $DIR"

say "проект: $DIR"

# ── что внутри ───────────────────────────────────────────────────────────────
if [ -d .git ]; then
  say "git: есть"
  say "  ветка:   $(git branch --show-current 2>/dev/null || echo '(detached)')"
  say "  remote:  $(git remote get-url origin 2>/dev/null || echo '(нет origin)')"
  dirty="$(git status --porcelain | wc -l | tr -d ' ')"
  say "  незакоммиченных файлов: $dirty"
else
  warn "git: НЕТ — папка не под контролем версий"
  say "  файлов: $(find . -type f -not -path './node_modules/*' -not -path './.next/*' 2>/dev/null | wc -l | tr -d ' ')"
fi

if [ "$PUSH" -eq 0 ]; then
  echo
  say "Ничего не изменено. Чтобы залить в ветку '$BRANCH':"
  say "  bash scripts/push_ultra.sh \"$DIR\" --push"
  exit 0
fi

# ── заливка ──────────────────────────────────────────────────────────────────
if [ ! -d .git ]; then
  say "инициализирую git и делаю снимок…"
  git init -q || fail "git init не удался"
  # Не тащим мусор и секреты в репозиторий.
  [ -f .gitignore ] || printf 'node_modules/\n.next/\n.env*\n.vercel/\n.DS_Store\n' > .gitignore
  git add -A || fail "git add не удался"
  git -c user.email=game@local -c user.name=GameUltra commit -q -m "Game Ultra snapshot" \
    || fail "нечего коммитить"
elif [ -n "$(git status --porcelain)" ]; then
  say "есть незакоммиченное — сохраняю в коммит…"
  git add -A
  git -c user.email=game@local -c user.name=GameUltra commit -q -m "Game Ultra: сохранение перед переносом" \
    || warn "коммит не сделался, заливаю как есть"
fi

git remote get-url gamerepo >/dev/null 2>&1 || git remote add gamerepo "$REPO_URL"

say "заливаю в ветку '$BRANCH' (main не трогаю, force не использую)…"
if git push gamerepo "HEAD:refs/heads/$BRANCH"; then
  echo
  say "ГОТОВО. Ultra теперь здесь:"
  say "  https://github.com/mironmotor/game/tree/$BRANCH"
  say "Скажи Клоду — он посмотрит и сведёт версии."
else
  echo
  warn "push не прошёл. Частые причины:"
  warn "  · ветка '$BRANCH' уже есть и разошлась → залей под другим именем:"
  warn "      git push gamerepo HEAD:refs/heads/${BRANCH}-2"
  warn "  · нужна авторизация GitHub → gh auth login  (или настрой SSH-ключ)"
  exit 1
fi
