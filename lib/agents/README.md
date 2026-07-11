# MAX + 7 Agents

A modular, typed, extensible agent architecture for the GAME / MAX project.

> **MAX is the single core of consciousness. The seven agents are specialized
> organs — perception, voice, memory, strategy, product, growth and protection.
> They work as one orchestra, not as seven disconnected chatbots.**

This layer is **pure TypeScript** (no React / Next / Node-only APIs in the core),
so it runs inside an API route, in the browser, or in a worker. It sits *on top
of* the existing Python `mark17` (Max17) core and never modifies the UI or the
existing API routes.

## What is MAX?

`MaxOrchestrator` is the central conductor **and subscriber**. It is **not** an
ordinary agent. The flow is always:

```
User Input
  → MAX Orchestrator
  → MAX routes the task to the agents that should handle it
  → agents return structured AgentOutputs (published on the event bus)
  → MAX is subscribed to every agent:completed / agent:error
  → MAX collects + filters + merges
  → MAX runs Guardian as a final stabilization pass
  → MAX synthesizes ONE unified answer / mission / action set
```

Agents **never** touch the app and **never** talk to each other. Everything goes
through MAX.

## The 7 agents

| Agent | Role | Responsibility |
|-------|------|----------------|
| `VisionAgent` | `vision` | Visual context, scene, images, camera |
| `VoiceAgent` | `voice` | Voice, speech, intonation, energy, emotion |
| `MemoryAgent` | `memory` | Memory, patterns, history, repeating cycles |
| `StrategyAgent` | `strategy` | Strategy, priorities, goals, missions, next steps |
| `ProductAgent` | `product` | Product, UX, architecture, features, API |
| `GrowthAgent` | `growth` | Marketing, content, Reels, Telegram, offers, funnels |
| `GuardianAgent` | `guardian` | Safety, risks, balance, limits, reality-check |

Every agent returns a structured `AgentOutput` (never bare text):

```ts
{
  agentId: string;
  role: AgentRole;
  summary: string;
  insights: string[];
  actions: string[];
  risks?: string[];
  confidence: number;   // 0..1
  metadata?: object;
}
```

`Guardian` always runs **last** and reviews the other agents' outputs via
`context.peerOutputs` (it stabilizes the plan — it does not block creativity).

## How to call the orchestrator

```ts
import { createMax } from '@/lib/agents';

const max = createMax();
const result = await max.processUserInput(
  'Я хочу сегодня продвинуть AstroMap и снять 3 Reels',
);

result.summary;        // short summary
result.mission;        // mission of the day
result.insights;       // per-agent insights
result.actions;        // prioritized actions
result.risks;          // guardrails (guardian + agents)
result.recommendation; // final recommendation
```

### Or via the example endpoint

```bash
# roster
curl http://localhost:3000/game/api/max

# run the pipeline
curl -X POST http://localhost:3000/game/api/max \
  -H 'Content-Type: application/json' \
  -d '{"text":"Я хочу сегодня продвинуть AstroMap и снять 3 Reels"}'
```

From the client:

```ts
import { runMaxOrchestrator } from '@/lib/max-orchestrator-client';
const synthesis = await runMaxOrchestrator({ text: '…' });
```

## Turning agents on/off

Edit [`agents.config.ts`](../../agents.config.ts) at the project root:

```ts
export const agentsConfig: AgentsConfig = {
  vision: true, voice: true, memory: true,
  strategy: true, product: true, growth: true, guardian: true,
};
```

Disabled agents are skipped during routing.

## How to add a new agent

1. Create `lib/agents/specialized/my-agent.ts` extending `BaseAgent`:

   ```ts
   import { BaseAgent } from '../base-agent';
   import type { AgentContext, AgentInput, AgentOutput, AgentRole } from '../types';

   export class MyAgent extends BaseAgent {
     readonly id = 'my-agent';
     readonly name = 'My Agent';
     readonly role: AgentRole = 'strategy'; // add a new role to AgentRole if needed
     readonly description = '…';
     readonly capabilities = ['…'];

     async run(input: AgentInput, _context: AgentContext): Promise<AgentOutput> {
       return this.output({ summary: '…', insights: [], actions: [], confidence: 0.5 });
     }
   }
   ```

2. If it is a brand-new role, add it to `AgentRole` + `AGENT_ROLES` in `types.ts`,
   `ROLE_ORDER` in `orchestrator.ts`, and `AgentsConfig` + `agents.config.ts`.
3. Register it: `createMax({ agents: [...buildDefaultAgents(), new MyAgent()] })`.

## Wiring real memory, voice and camera later

The core ships with honest stubs; swap them by implementing the same interfaces
and passing them via `createMax({ services })`:

- **Memory** — implement `MemoryStore` (`getRelevantMemories` / `saveMemory` /
  `detectPatterns`). A natural backing is the Max17 Hippocampus via
  `sendMax17Event` (`lib/max17-client.ts`) or a database.
- **Vision** — implement `VisionInputAdapter` backed by
  `components/hud/face-detect.ts`.
- **Voice** — implement `VoiceInputAdapter` backed by
  `components/hud/voice-signature.ts`.
- **Generative agents** — pass an `LlmCaller` in `services.llm` to upgrade any
  agent from deterministic heuristics to LLM reasoning (e.g. route it to the
  Gonka voice or Gemini). Agents are deterministic and network-free by default.

```ts
const max = createMax({
  services: {
    memory: new MyMax17MemoryStore(),
    vision: new CameraVisionAdapter(),
    voice: new MicVoiceAdapter(),
    llm: async (prompt) => (await sendMax17Event({ type: 'user_message', text: prompt })).answer?.text ?? '',
  },
});
```

## Files

```
lib/agents/
  types.ts                 # AgentRole, AgentInput/Output/Context, AgentTask/Result, OrchestratorState…
  event-bus.ts             # typed pub/sub (agent:started|completed|error, max:synthesis_*)
  base-agent.ts            # BaseAgent (id/name/role/description/capabilities/run/canHandle)
  adapters.ts              # NullVision/NullVoice adapters + InMemoryMemoryStore
  nlp.ts                   # tiny bilingual text helpers for the heuristics
  orchestrator.ts          # MaxOrchestrator (processUserInput, routeToAgents, …)
  index.ts                 # barrel + createMax() factory
  specialized/*.ts         # the seven agents
agents.config.ts           # on/off toggles (project root)
lib/max-orchestrator-client.ts   # client for POST /api/max
app/api/max/route.ts       # example endpoint
```
