# Справочник: API, события, скрипты

## HTTP-эндпоинты (`app/api/*`, runtime nodejs, basePath `/game`)
| Маршрут | Метод | Назначение | Токен |
|---|---|---|---|
| `/api/max17` | POST | главный мост к ядру (любое событие из каталога) | нет |
| `/api/max` | GET/POST | Совет: roster / прогон MAX+7 агентов | `x-max17-token`* |
| `/api/code` | POST | code-агент (пишет файлы в песочнице) | `x-max17-token`* |
| `/api/architect` | POST | architect-агент (ветки разработки, read-only) | `x-max17-token`* |
| `/api/desktop` | POST | desktop-агент (управление рабочим столом) | `x-max17-token`* |
| `/api/llm-config` | GET/POST | список и выбор LLM-модели в рантайме | нет |

\* токен требуется, только если задан `MAX17_API_TOKEN`; HUD шлёт его через `NEXT_PUBLIC_MAX17_API_TOKEN`.

## События ядра (`type` в теле `/api/max17`)
| Событие | Назначение |
|---|---|
| `user_message` | реплика пользователя (память, план, концепты, голос; роутинг в агента) |
| `task_created` / `task_completed` / `deadline_failed` | сигналы по задачам |
| `terminal_error` / `system_state` | ошибки/состояние системы |
| `environment_observation` / `voice_observation` | камера/сцена и голос-состояние |
| `compile_semantic` / `meaning_tree` | заземление смысла, дерево значений |
| `ultra_think` | глубокое рассуждение под конституцией v0.7 |
| `music_observation` / `music_taste` / `dream_mood` | музыка и настроение (Dreaming Music) |
| `ingest_corpus` | **массовый ингест текста/файла в граф** (путь к 1M) |
| `introspect` | интроспекция ядра |
| `sleep_consolidation` | сон/консолидация паттернов |
| `working_memory_reset` | сброс рабочей памяти |
| `outcome_success` / `outcome_failure` / `outcome_partial` / `action_done` / `action_skipped` | **обучение на исходах** |
| `compress_memory` | сжатие памяти |
| `graph_stats` | статистика графа (+ `growth_history`) |
| `neural_seed` / `neural_walk` | посев/обход нейрографа |
| `internal_dream` / `generate_synergies` | внутренние сны, синергии |
| `web_research` / `web_ingest` / `autonomous_research` | web-факты (сетевые, опц.) |
| `ultimate_bootstrap` | бутстрап MAX Ultimate-состояния |
| `memory_recall` | **быстрый recall (граф+вектор), без голоса/веба** — для Совета |
| `memory_store` | **лёгкая запись хода** в граф — для Совета |
| `llm_raw` | **сырой LLM-вызов (Gonka)** — для deep-режима Совета |

## npm-скрипты (Python-ядро)
`max17:smoke` базовый смоук · `max17:parity` парность warm/one-shot · `max17:serve` демон ·
`max17:stats` статистика графа · `max17:ingest` ингест корпуса · `max17:reembed` переэмбед вектора ·
`max17:growth` / `max17:selfgrow` рост графа · `max17:outcome` обучение · `max17:plan` план ·
`max17:semantic` / `max17:tree` / `max17:concepts` смысл · `max17:ultra` конституция ·
`max17:music` / `max17:dream` музыка/сны · `max17:env` / `max17:sense` среда ·
`max17:voicestate` голос · `max17:working` рабочая память · `max17:compress` сжатие ·
`max17:neural` / `max17:walk` нейрограф · `max17:ann` ANN-индекс · `max17:bridge` мост ·
`max17:web` / `max17:curiosity` веб/любопытство · `max17:self` / `max17:codemem` / `max17:intuition` ·
`max17:ultimate` ultimate-состояние.

Приложение: `npm run dev` (порт 3000, `/game`), `npm run build`, `npm run lint`.

## Внутренние UI-события (window CustomEvent)
| Событие | Кто шлёт → кто слушает |
|---|---|
| `angels:open` / `angels:ask` / `angels:kickoff` | док HUD → AngelsPanel (открыть/спросить/разгон) |
| `max:thinking {active}` | AngelsPanel → NeuralCore (ускорить ядро) |
| `game:tasks-sync` | AngelsPanel ↔ useGameState (синхрон задач/XP между инстансами) |
