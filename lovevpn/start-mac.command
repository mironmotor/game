#!/usr/bin/env bash
# Love VPN — запуск бота на Маке одной командой (или двойным кликом).
#
# Скрипт сам находит папку проекта, создаёт окружение, ставит зависимости,
# подхватывает токен (из .env или из файла на рабочем столе), спрашивает
# недостающее и стартует бота. Повторный запуск ничего не ломает — готовые
# шаги пропускаются.

set -uo pipefail

# Настоящий токен Telegram: ID бота, двоеточие и ровно 35 символов.
# Требование «ровно 35» отсекает похожие строки, которые могут валяться рядом.
TOKEN_RE='^[0-9]{6,12}:[A-Za-z0-9_-]{35}$'

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n\n' "$*"; read -r -p "Enter — закрыть окно" _; exit 1; }

# --- где лежит проект -------------------------------------------------------
# Скрипт может быть где угодно (рабочий стол, Загрузки) — ищем папку с ботом.
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"
PROJECT=""
for candidate in "$SELF_DIR" "$HOME/lovevpn" "$HOME/Desktop/lovevpn" "$HOME/Downloads/lovevpn" "$HOME/Documents/lovevpn"; do
  if [[ -f "$candidate/bot/main.py" ]]; then
    PROJECT="$candidate"
    break
  fi
done
[[ -n $PROJECT ]] || die "Не нашёл папку lovevpn. Положите этот файл внутрь неё и запустите снова."
cd "$PROJECT" || die "Не удалось перейти в $PROJECT"

# --- чтение и запись .env (через python3 — работает одинаково везде) --------
env_value() {
  [[ -f .env ]] || { printf ''; return; }
  python3 - "$1" <<'PY'
import pathlib, sys
key = sys.argv[1]
for line in pathlib.Path(".env").read_text(encoding="utf-8", errors="replace").splitlines():
    if line.startswith(key + "="):
        print(line.split("=", 1)[1].strip().strip('"').strip("'"))
        break
PY
}

env_set() {
  python3 - "$1" "$2" <<'PY'
import pathlib, sys
key, value = sys.argv[1], sys.argv[2]
path = pathlib.Path(".env")
lines = path.read_text(encoding="utf-8", errors="replace").splitlines() if path.exists() else []
out, found = [], False
for line in lines:
    if line.startswith(key + "="):
        out.append(f"{key}={value}")
        found = True
    else:
        out.append(line)
if not found:
    out.append(f"{key}={value}")
path.write_text("\n".join(out) + "\n", encoding="utf-8")
PY
}

say "Love VPN — подготовка"
ok "Папка проекта: $PROJECT"

# --- 1. Python --------------------------------------------------------------
command -v python3 >/dev/null || die "python3 не найден. Выполните: xcode-select --install"
PYV=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' \
  || die "Нужен Python 3.9 или новее, а установлен $PYV. Свежий — на python.org"
ok "Python $PYV"

# --- 2. Окружение и зависимости --------------------------------------------
if [[ ! -x .venv/bin/python ]]; then
  say "Создаю окружение (один раз, ~10 секунд)"
  python3 -m venv .venv || die "Не удалось создать окружение .venv"
fi
if ! .venv/bin/python -c 'import aiogram' 2>/dev/null; then
  say "Ставлю зависимости (один раз, ~30 секунд)"
  .venv/bin/pip install --quiet --upgrade pip 2>/dev/null
  .venv/bin/pip install --quiet -r bot/requirements.txt || die "Не удалось установить aiogram"
fi
ok "Зависимости на месте"

# --- 3. Файл настроек -------------------------------------------------------
[[ -f .env ]] || cp .env.example .env
chmod 600 .env
ok "Файл настроек .env готов"

# --- 4. Токен бота ----------------------------------------------------------
TOKEN=$(env_value BOT_TOKEN)
if [[ ! $TOKEN =~ $TOKEN_RE ]]; then
  # В .env токена нет (или осталась подсказка-заглушка) — ищем на рабочем столе.
  FOUND=$(grep -rhoaE '[0-9]{6,12}:[A-Za-z0-9_-]{35}' "$HOME/Desktop" 2>/dev/null | head -1 || true)
  if [[ -n ${FOUND:-} && $FOUND =~ $TOKEN_RE ]]; then
    TOKEN="$FOUND"
    ok "Токен найден в файле на рабочем столе"
  else
    say "Нужен токен бота"
    echo "  Возьмите его у @BotFather (ваш бот → API Token) или из файла с ключом."
    echo "  Вставьте сюда: при вставке символы не отображаются — это нормально."
    printf '\n  Токен: '
    read -rs TOKEN
    echo
    TOKEN=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
    [[ $TOKEN =~ $TOKEN_RE ]] || die "Не похоже на токен. Он выглядит так: 1234567890:AAH-xxxxxxxxxxxxxxxxxxxxx"
  fi
  env_set BOT_TOKEN "$TOKEN"
fi
ok "Токен на месте"

# --- 5. ID администратора ---------------------------------------------------
ADMIN=$(env_value LOVEVPN_ADMIN_IDS)
if [[ ! $ADMIN =~ ^[0-9][0-9,]*$ ]]; then
  say "Ваш Telegram ID — чтобы вам работали админские команды"
  echo "  Напишите @userinfobot в Telegram, он ответит числом."
  echo "  Можно пропустить — нажмите Enter, впишете позже."
  printf '\n  Ваш ID: '
  read -r ADMIN
  ADMIN=$(printf '%s' "$ADMIN" | tr -cd '0-9,')
  if [[ -n $ADMIN ]]; then
    env_set LOVEVPN_ADMIN_IDS "$ADMIN"
    ok "ID записан"
  else
    warn "ID не задан — админские команды пока никому не доступны"
  fi
else
  ok "ID администратора на месте"
fi

# --- 6. Конфиги VPN ---------------------------------------------------------
if [[ -f configs.txt ]]; then
  ok "Файл configs.txt найден — ключи загрузятся в пул"
else
  warn "configs.txt нет. Ключи можно прислать .txt файлом прямо в бота (вы админ)"
fi

# --- 7. Запуск --------------------------------------------------------------
say "Запускаю бота. Ctrl+C — остановить. Окно не закрывайте: закроете — бот выключится"
echo
.venv/bin/python -m bot.main
STATUS=$?

echo
if [[ $STATUS -ne 0 ]]; then
  printf '\033[31mБот остановился с ошибкой (код %s).\033[0m\n' "$STATUS"
  echo "Скопируйте текст выше и пришлите — разберём."
fi
read -r -p "Enter — закрыть окно" _
