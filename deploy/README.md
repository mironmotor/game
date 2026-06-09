# Деплой Game (локально)

Game — **локал-ферст** приложение: API-роуты спавнят локальный Python (ядро Max17),
читают/пишут файлы, гоняют shell и управляют рабочим столом Mac. Поэтому его
**нельзя выкатить в облако** (Vercel/Firebase serverless не дают Python, файловой
системы, долгоживущих процессов и десктопа). «Деплой» здесь = постоянный
**локальный прод-сервер**.

## Быстрый запуск (прод)
```bash
cd "/Users/gost/Documents/game 2"
npm run build        # один раз и после каждой правки кода
npm run start:hud    # прод-сервер на http://localhost:3002/game (localhost-бинд)
```
Прод-сборка отдаёт страницы мгновенно (~0.05с против 20–40с в dev).

## Постоянный деплой (запуск при логине, авто-рестарт) — launchd
```bash
npm run build
cp deploy/com.max17.game.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.max17.game.plist
```
- Сервис стартует при входе в систему и перезапускается, если упадёт (`KeepAlive`).
- Открывать: **http://localhost:3002/game**
- Остановить: `launchctl unload ~/Library/LaunchAgents/com.max17.game.plist`
- Логи: `/tmp/max17-game.out.log`, `/tmp/max17-game.err.log`

## Важно
- **LLM-функции** (голос, код-агент, desktop-агент, архитектор) требуют **валидного
  `GONKA_API_KEY`** в `.env.local`. Текущий ключ отозван (401) — пока он не заменён,
  работает только детерминированное ядро.
- **Desktop-управление под launchd** упрётся в разрешения macOS (TCC привязывает
  Автоматизацию/Доступ к запускающему процессу). Для desktop-режима надёжнее
  запускать `npm run start:hud` из своего Терминала и выдать ему права.
- После любой правки кода нужен повторный `npm run build` (прод не хот-релоадит).
- HTTP на `localhost`/`127.0.0.1` — это secure context, камера/микрофон работают
  без https.
