# Запуск и окружение (Mac M3 / arm64)

## Тулчейн
- **Node.js v24 LTS (arm64)** установлен в `~/.local/nodejs` (без Homebrew). На PATH в твоём
  терминале — через `~/.zshenv`. Проверка: `node -v`.
- **Python 3** (системный, CommandLineTools 3.9) с **numpy** в user-site
  (`python3 -m pip install --user numpy`). Ядро использует именно его.
- `.env.local`: **`PYTHON_BIN=/usr/bin/python3`** — интерпретатор с numpy (старый путь к 3.13 не существует).

## Запуск
```bash
cd ~/Documents/game\ ultra
npm install          # один раз (нативно под arm64; node_modules не копировать с других машин)
npm run dev          # → http://localhost:3000/game   (обязательно с /game)
```
Если в новом окне `command not found: node` — открой свежий терминал (подхватит `~/.zshenv`) или:
```bash
PATH="$HOME/.local/nodejs/bin:$PATH" npm run dev
```

## Сборка и проверки
```bash
npm run build            # прод-сборка Next (typecheck/eslint в build отключены — см. next.config.ts)
npm run lint             # eslint
npx tsc --noEmit         # типы (в проекте есть пред-существующие ошибки в GameApp/gemini/music — не наши)
python3 mark17/smoke.py  # смоук ядра
python3 mark17/parity_check.py   # парность warm vs one-shot (должно быть ok, checked 25)
```

## Демон Max17
- Поднимается автоматически из `app/api/max17/max17-daemon.ts` при первом запросе (или предспаун).
- **После изменения Python-кода ядра** — перезапусти демон, чтобы подхватил новый код:
  ```bash
  pkill -f serve.py     # респаунится на следующем запросе
  ```
- После изменения онтологии вектора — `npm run max17:reembed`, затем `pkill -f serve.py`.

## Ключевые переменные `.env.local`
| Переменная | Назначение |
|---|---|
| `PYTHON_BIN` | интерпретатор Python с numpy (`/usr/bin/python3`) |
| `GONKA_API_KEY` / `GONKA_BASE_URL` / `GONKA_MODEL` | облачный голос/LLM (Qwen3) — deep-режим, чат-голос |
| `GEMINI_API_KEY` / `NEXT_PUBLIC_GEMINI_API_KEY` | Gemini (используется в lib/gemini.ts через OpenRouter) |
| `MAX17_API_TOKEN` / `NEXT_PUBLIC_MAX17_API_TOKEN` | токен-гейт опасных роутов (code/desktop/architect/max) |
| `MAX17_STATE_DIR` | каталог состояния ядра (по умолчанию `mark17/state`) |
| `MAX17_LLM_ENABLED` | включить локальный ollama-мост (Gonka работает независимо) |
| `MAX17_WEB_ENABLED` / `MAX17_AUTO_WEB` | разрешить web-факты/автономный ресёрч |
| `MAX17_DAEMON` | `false` → отключить демон (только one-shot) |

## Git
Удалёнка `github.com/mironmotor/game` (приватная). По договорённости работа ведётся **локально**;
важная история не запушена — единственные копии на этой машине (и старом Mac). Бэкап — по желанию.

## Заметки по производительности
- Совет по умолчанию мгновенный (детерминированные агенты + быстрый `memory_recall`).
- Deep/авто-эскалация и исполнители (architect/code) идут через реальную модель — это десятки
  секунд, со спиннером и ускоренным ядром. Это норма для «настоящего» исполнения.
- Большой ингест (крупные файлы/папки) тяжёлый на холодном демоне — кормить частями.
