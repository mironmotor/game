# Совет Ангелов: MAX + 7 агентов

TypeScript-слой поверх ядра: `lib/agents/`. MAX — центральный оркестратор и **подписчик**;
7 агентов — специализированные «органы». Агенты не трогают приложение и не общаются друг с
другом — всё через MAX.

> Подробный гайд для разработчика (как добавить агента, подключить сервисы) — в
> [`lib/agents/README.md`](../lib/agents/README.md).

## Поток
```
ввод пользователя
  → MAX.processUserInput()
  → primeContext: один recall греет память + исходы на весь прогон
  → routeToAgents: выбор агентов (config + canHandle)
  → агенты.run() → AgentOutput, публикуются на event bus
  → MAX подписан на agent:completed/error → собирает централизованно
  → Guardian запускается ПОСЛЕДНИМ (ревьюит peerOutputs)
  → synthesizeResponse → единый ответ: answer / mission / actions / risks
  → [deep?] deepen(): реальная модель уточняет ответ
  → берёт задачи в работу (если режим агента)
```

## 7 агентов (`lib/agents/specialized/`)
| Агент | Роль | Делает |
|---|---|---|
| `StrategyAgent` | strategy | фокус, цели, миссия дня, следующие шаги; учитывает исходы (обучение) |
| `ProductAgent` | product | привязка к продукту/фиче, UX-путь, ценность |
| `GrowthAgent` | growth | контент/Reels/Telegram, охваты, офферы, воронки |
| `MemoryAgent` | memory | recall из ядра, паттерны, непрерывность контекста |
| `GuardianAgent` | guardian | риски, перегруз, реализм; предупреждает о повторе провалов |
| `VisionAgent` | vision | визуальный контекст (через VisionInputAdapter; сейчас заглушка) |
| `VoiceAgent` | voice | голос/эмоция (через VoiceInputAdapter; сейчас заглушка) |

Каждый агент возвращает структуру: `{ agentId, role, summary, insights[], actions[], risks?, confidence, metadata? }`.

## Ключевые файлы
- `types.ts` — AgentRole, AgentInput/Output/Context, AgentTask/Result, OrchestratorState, MemoryStore, LlmCaller, OutcomeMemory.
- `event-bus.ts` — типизированный pub/sub (`agent:started|completed|error`, `max:synthesis_started|completed`).
- `base-agent.ts` — `BaseAgent` (id/name/role/description/capabilities/run/canHandle).
- `orchestrator.ts` — `MaxOrchestrator`: `processUserInput`, `routeToAgents`, `collectAgentResults`,
  `synthesizeResponse`, `createMission`, `evaluateRisks`, `deepen` (LLM), авто-эскалация.
- `adapters.ts` — `InMemoryMemoryStore`, null Vision/Voice адаптеры.
- `index.ts` — `createMax()` фабрика + barrel.
- `nlp.ts` — двуязычные текст-хелперы для эвристик.

## Режимы и обучение
- **Быстрый (по умолчанию)**: детерминированные эвристики, ~мс. Память — реальная (Max17 через
  `Max17MemoryStore`, событие `memory_recall`).
- **Deep (Глубже)**: один заземлённый LLM-вызов (Gonka через `Max17LlmCaller`/`llm_raw`) уточняет
  mission/answer/actions/risks. Кнопка «Глубже» — вручную.
- **Авто-эскалация**: если запрос без конкретики (нет сущностей/чисел) **И** совет реально не
  уверен → MAX сам уходит в deep. Порог консервативный, чтобы обычные запросы оставались мгновенными.
- **Обучение**: «Готово»/успех кода → `outcome_success`; провал → `outcome_failure`. Ядро
  усиливает/ослабляет синапсы, будущие планы учитывают опыт (бейдж «Учёл прошлый опыт»).

## Конфигурация
`agents.config.ts` (корень) — включение/выключение агентов:
```ts
export const agentsConfig = { vision: true, voice: true, memory: true,
  strategy: true, product: true, growth: true, guardian: true };
```

## Эндпоинт
`app/api/max/route.ts`:
- `GET /game/api/max` — состав агентов (roster).
- `POST /game/api/max { text, deep?, sessionId? }` — полный прогон, единый `MaxSynthesis`.
- Память Max17 и LLM подключены всегда (LLM срабатывает только при deep/авто-эскалации).
- Токен-гейт: заголовок `x-max17-token` (если задан `MAX17_API_TOKEN`).
