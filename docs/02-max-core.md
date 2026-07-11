# Ядро MAX (Max17 / `mark17`)

`mark17` — внутреннее имя когнитивного ядра «Max17». Чистый Python + NumPy, без сети по
умолчанию. Состояние живёт в `mark17/state/` (SQLite + файлы).

## Память (три слоя)

| Слой | Файл | Что это |
|---|---|---|
| Keyword-память | `hippocampus.py` | `remember(event, hint, action)`, `recall(query)`, `recent(...)` — SQLite, точные/частотные совпадения |
| Семантическая | `vector_memory.py` | локальные эмбеддинги (256-мерный signed-hashing: char-n-граммы + **онтология синонимов** + концепты), cosine recall |
| Граф синапсов | `neural_graph.py` | узлы и связи (`related_to`, `leads_to`, `grounds`, `reinforces`, `adapted_by`…) — путь к 1M |

### Семантическая онтология (recall по смыслу)
`vector_memory.py::SYNONYM_GROUPS` группирует слова в концепты, чтобы recall находил **смысл, а не буквы**.
Покрыты системные концепты (memory/pattern/core/development/task) **и жизненные домены**:
`sales, marketing, content, product, code, money, body, relationship, focus`.
Пример: «звонки клиентам» вспоминает «холодный обзвон»; «снять видео» вспоминает «Reels».

При изменении онтологии хранилище переэмбеддивается: `npm run max17:reembed` (затем перезапуск демона).

### Быстрый recall/store для Совета (без голоса/веба)
- `memory_recall` — только граф + вектор, **без Gonka и без веба** (~мс). Возвращает `memory.recalled`,
  `memory.semantic`, `outcomes` (релевантные исходы), `consolidation.patterns`.
- `memory_store` — лёгкая запись хода в граф (идемпотентно), без тяжёлого пайплайна.
- Гигиена: на стороне `lib/max17-memory-store.ts` системная телеметрия (web_fact, environment,
  ultra_decision, user_message-префиксы…) фильтруется; остаются человеческие воспоминания.

## Обучение на исходах (замкнутая петля)
События `outcome_success | outcome_failure | outcome_partial | action_done | action_skipped`
(`outcome.py`, `_handle_outcome_event` в `json_cli.py`):
- определяют статус и оценку, **обновляют синапсы** (`update_outcome_synapses`: усиление успеха /
  ослабление провала), пишут память.
- Совет читает исходы в план (`memory_recall.outcomes`): избегает того, что не сработало, и
  закрепляет успешное. «Готово» по задаче → `outcome_success`; провал кода → `outcome_failure`.

## Концепты, план, критик, сны, музыка, голос
- `concepts.py` / `concept_compression.py` / `semantic_compiler.py` / `meaning_tree.py` —
  заземление и сжатие смысла в граф.
- `planner.py` — `plan_next_actions`; `critic.py` — самооценка хода.
- `consolidation.py` — сон/консолидация паттернов; `dreamer.py` — внутренние сны.
- `music_sense.py` — анализ музыки; `self_state.py` — настроение MAX.
- `gonka_bridge.py` — облачный голос (OpenAI-совместимый, Qwen3). `llm_bridge.py` — локальный ollama (опц.).
- `web_sense.py` / `corpus_ingest.py` — web-факты и **массовый ингест корпуса в граф**.

## Путь к 1 000 000 синапсов

Цель конституции (`MAX Ultimate v0.7`): **1M ПОЛЕЗНЫХ синапсов**, не сырых данных. Локальная
цель графа в статистике — 100 000 (ближний рубеж).

### Как смотреть прогресс
- `npm run max17:stats` — total_synapses, unique_nodes, прогресс, состав по типам связей.
- Панель **Корпус** (нижний правый угол HUD) — текущий счёт, `%` к 1M и **спарклайн роста во времени**.
- Лог роста: `mark17/state/growth_log.jsonl` (append-only снапшоты `{t, total}`, дедуп);
  пишется при `graph_stats` и `ingest_corpus` (`mark17/growth_log.py`).

### Как растить «правильно»
1. **Корпус-ингест** (`ingest_corpus`, `corpus_ingest.py`): текст или путь к файлу/папке проекта →
   режется на чанки → компилится в IR → вшивается в граф. Идемпотентно (кеш по хешу), офлайн,
   путь заперт в каталоге проекта. UI: панель «Корпус» (режимы «Текст»/«Путь»).
2. **Ходы Совета + обучение** — каждый осмысленный ход и закрытая задача добавляют структурные связи.
3. Избегать сырья: автономные `web_fact` — низкополезные, фильтруются из recall.

## Каталог событий ядра
`user_message, task_created, task_completed, deadline_failed, terminal_error, system_state,
environment_observation, voice_observation, compile_semantic, meaning_tree, ultra_think,
music_observation, music_taste, dream_mood, ingest_corpus, introspect, sleep_consolidation,
working_memory_reset, outcome_success, outcome_failure, outcome_partial, action_done,
action_skipped, compress_memory, graph_stats, neural_seed, neural_walk, internal_dream,
generate_synergies, web_research, web_ingest, autonomous_research, ultimate_bootstrap,
memory_recall, memory_store, llm_raw`

Полный справочник событий с назначением — в [05-api-events-scripts](05-api-events-scripts.md).
