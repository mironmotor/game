/**
 * MaxOrchestrator — MAX itself: the central conductor and subscriber.
 *
 * Flow:
 *   user input
 *     → MAX routes the task to the selected agents
 *     → agents return structured AgentOutputs (published on the event bus)
 *     → MAX is subscribed to every agent:completed / agent:error
 *     → MAX collects, runs Guardian as a final stabilization pass
 *     → MAX synthesizes one unified answer (summary / mission / actions / risks)
 *
 * Agents never touch the app and never talk to each other — everything goes
 * through MAX.
 */

import { EventBus } from './event-bus';
import { clamp01, genId, nowIso, uniq } from './nlp';
import { AGENT_ROLES } from './types';
import type {
  Agent,
  AgentContext,
  AgentInput,
  AgentInsight,
  AgentOutput,
  AgentResult,
  AgentRole,
  AgentServices,
  AgentsConfig,
  AgentTask,
  MaxSynthesis,
  Mission,
  OrchestratorState,
  PrioritizedAction,
} from './types';

export interface MaxOrchestratorOptions {
  agents: Agent[];
  config: AgentsConfig;
  services?: AgentServices;
  bus?: EventBus;
}

/** Merge order when MAX prioritizes actions across agents (lower = earlier). */
const ROLE_ORDER: Record<AgentRole, number> = {
  strategy: 0,
  product: 1,
  growth: 2,
  memory: 3,
  vision: 4,
  voice: 5,
  guardian: 6,
};

/** Guardian principle: a single day holds only so many real actions. */
const MAX_ACTIONS = 6;

/** Below this decision confidence (substantive agents, excl. Guardian), MAX
 *  auto-escalates to the deep LLM pass. */
const AUTO_DEEP_THRESHOLD = 0.55;

/** Pull a JSON object out of an LLM reply (handles code fences / surrounding prose). */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

export class MaxOrchestrator {
  readonly bus: EventBus;
  private registry = new Map<AgentRole, Agent>();
  private config: AgentsConfig;
  private services: AgentServices;
  private state: OrchestratorState = { status: 'idle', tasks: [], results: [] };
  /** Central result buffers keyed by runId — filled by the bus subscription. */
  private collected = new Map<string, AgentResult[]>();

  constructor(options: MaxOrchestratorOptions) {
    this.bus = options.bus ?? new EventBus();
    this.config = options.config;
    this.services = options.services ?? {};
    for (const agent of options.agents) this.registry.set(agent.role, agent);

    // MAX subscribes to ALL agents: every result lands here centrally.
    this.bus.on('agent:completed', ({ result }) => this.absorb(result));
    this.bus.on('agent:error', ({ result }) => this.absorb(result));
  }

  getState(): OrchestratorState {
    return this.state;
  }

  /** Public roster (handy for a GET endpoint / debugging). */
  roster() {
    return AGENT_ROLES.filter((role) => this.registry.has(role)).map((role) => {
      const agent = this.registry.get(role) as Agent;
      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        description: agent.description,
        capabilities: agent.capabilities,
        enabled: this.isEnabled(role),
      };
    });
  }

  // --- public API ---------------------------------------------------------

  async processUserInput(
    input: string | AgentInput,
    baseContext: Partial<AgentContext> = {},
    opts: { deep?: boolean; autoDeep?: boolean } = {},
  ): Promise<MaxSynthesis> {
    const runId = genId('run');
    const startedAt = nowIso();
    const start = Date.now();
    const normalizedInput = this.normalizeInput(input);
    const context = this.buildContext(baseContext, runId);

    this.collected.set(runId, []);
    this.state = { status: 'routing', runId, input: normalizedInput, tasks: [], results: [], startedAt };

    try {
      // 0) Prime shared context once: a single recall fills memories + outcome
      //    history, so every agent (and the learning loop) reasons from the same data.
      await this.primeContext(normalizedInput, context);

      // 1) Route to the selected non-guardian agents.
      const roles = this.routeToAgents(normalizedInput, context);
      const tasks = roles.map((role) => this.createTask(role, normalizedInput, context, runId));
      this.state.tasks = [...tasks];

      // 2) Run them; results are collected centrally via the event bus.
      this.state.status = 'collecting';
      await this.collectAgentResults(tasks);

      // 3) Guardian runs LAST and reviews peers (never talks to them directly).
      if (this.isEnabled('guardian') && this.registry.has('guardian')) {
        const peerOutputs = this.outputsFrom(this.collected.get(runId) ?? []);
        const guardianTask = this.createTask('guardian', normalizedInput, { ...context, peerOutputs }, runId);
        this.state.tasks.push(guardianTask);
        await this.collectAgentResults([guardianTask]);
      }

      const results = [...(this.collected.get(runId) ?? [])];
      this.state.results = results;

      // 4) Synthesize one unified answer.
      this.state.status = 'synthesizing';
      this.bus.emit('max:synthesis_started', { runId, input: normalizedInput, results });
      let synthesis = this.synthesizeResponse(results, context);
      // Deep mode: let the real model refine mission/answer/actions, grounded in
      // the agents' draft + recalled memory + outcomes. Falls back to heuristics.
      // Auto-escalate: if the heuristic council is unsure, MAX goes deep on its own.
      const canDeepen = !!context.services?.llm;
      // Auto-escalate when the request lacks concrete anchors (no entities/quantities)
      // or the substantive council is unsure — exactly when the model adds most value.
      const strat = synthesis.agents.find((a) => a.role === 'strategy');
      const grounded = strat?.metadata?.['grounded'] === true;
      const substantive = synthesis.agents.filter(
        (a) => a.role !== 'guardian' && a.metadata?.['available'] !== false,
      );
      const decisionConf = substantive.length
        ? substantive.reduce((sum, a) => sum + a.confidence, 0) / substantive.length
        : synthesis.confidence;
      // Rare by design: only escalate when the input is BOTH vague (no concrete
      // anchors) AND the council is genuinely unsure — so normal asks stay instant.
      const autoEscalate =
        opts.autoDeep !== false && !opts.deep && !grounded && decisionConf < AUTO_DEEP_THRESHOLD;
      if (canDeepen && (opts.deep || autoEscalate)) {
        synthesis = await this.deepen(synthesis, normalizedInput, context);
        if (autoEscalate && synthesis.meta.deep) synthesis.meta.autoEscalated = true;
      }
      synthesis.meta.durationMs = Date.now() - start;
      this.bus.emit('max:synthesis_completed', { runId, synthesis });

      // 5) Persist the turn if a memory store is wired (exercises saveMemory()).
      await this.persistTurn(normalizedInput, synthesis, context);

      this.state.synthesis = synthesis;
      this.state.status = 'done';
      this.state.finishedAt = nowIso();
      return synthesis;
    } catch (err) {
      this.state.status = 'error';
      this.state.error = err instanceof Error ? err.message : String(err);
      this.state.finishedAt = nowIso();
      throw err;
    } finally {
      this.collected.delete(runId);
    }
  }

  /** Pick which agents to run for this task (Guardian is excluded — it runs in the final pass). */
  routeToAgents(input: AgentInput, context: AgentContext): AgentRole[] {
    return AGENT_ROLES.filter((role) => role !== 'guardian')
      .filter((role) => this.isEnabled(role))
      .filter((role) => {
        const agent = this.registry.get(role);
        if (!agent) return false;
        return agent.canHandle ? agent.canHandle(input, context) : true;
      });
  }

  /** Run tasks in parallel; each emits agent:started then agent:completed|agent:error. */
  async collectAgentResults(tasks: AgentTask[]): Promise<AgentResult[]> {
    return Promise.all(tasks.map((task) => this.runTask(task)));
  }

  synthesizeResponse(results: AgentResult[], context: AgentContext): MaxSynthesis {
    const outputs = this.outputsFrom(results);
    const ranAgents = uniq(outputs.map((o) => o.role));
    const erroredAgents = uniq(results.filter((r) => r.status === 'error').map((r) => r.task.role));
    const skippedAgents = AGENT_ROLES.filter((r) => !ranAgents.includes(r) && !erroredAgents.includes(r));

    const mission = this.createMission(results);
    const risks = this.evaluateRisks(results);
    const actions = this.prioritizeActions(outputs);

    const insights: AgentInsight[] = outputs.map((o) => ({
      role: o.role,
      agentId: o.agentId,
      summary: o.summary,
      insights: o.insights,
      confidence: o.confidence,
    }));

    // Confidence: blend agents that actually contributed signal (skip null adapters).
    const contributing = outputs.filter((o) => o.metadata?.['available'] !== false);
    const pool = contributing.length ? contributing : outputs;
    const confidence = pool.length
      ? clamp01(pool.reduce((sum, o) => sum + o.confidence, 0) / pool.length)
      : 0;

    const learnedFrom = context.outcomes?.length ?? 0;
    return {
      summary:
        this.buildSummary(mission, ranAgents, actions) +
        (learnedFrom ? ` Учёл прошлый опыт: ${learnedFrom} исход(ов).` : ''),
      answer: this.composeAnswer(mission, actions, risks),
      mission,
      insights,
      actions,
      risks,
      recommendation: this.buildRecommendation(mission, actions, risks),
      confidence,
      agents: outputs,
      meta: { ranAgents, skippedAgents, erroredAgents, durationMs: 0 },
    };
  }

  /** MAX's voiced final answer after the council — decisive, ready to act on. */
  private composeAnswer(mission: Mission, actions: PrioritizedAction[], risks: string[]): string {
    const top = actions.slice(0, 3).map((a, i) => `${i + 1}) ${a.title}`).join(' ');
    const more = actions.length > 3 ? ` (+ ещё ${actions.length - 3})` : '';
    const guard = risks[0] ? ` Страж-риск держу в уме: ${risks[0]}` : '';
    const plan = actions.length
      ? ` Беру в работу ${actions.length} задач(и): ${top}${more}. Стартую с №1.`
      : ' Конкретных действий не выделил — уточни цель одним предложением.';
    return `Совет собран. Миссия дня: ${mission.title}.${plan}${guard}`;
  }

  /** Deep mode: one grounded LLM call refines mission/answer/actions/risks. */
  private async deepen(
    synthesis: MaxSynthesis,
    input: AgentInput,
    context: AgentContext,
  ): Promise<MaxSynthesis> {
    const llm = context.services?.llm;
    if (!llm) return synthesis;

    const mem = (context.memories ?? []).slice(0, 5).map((m) => `- ${m.text}`).join('\n');
    const outs = (context.outcomes ?? []).map((o) => `- [${o.status}] ${o.text}`).join('\n');
    const draft = synthesis.actions.map((a, i) => `${i + 1}. ${a.title}`).join('\n');
    const angels = synthesis.agents
      .filter((a) => a.metadata?.['available'] !== false)
      .map((a) => `${a.role}: ${a.summary}`)
      .join('\n');

    const system =
      'Ты — MAX, ядро-оркестратор продуктивности и совет из 7 агентов. ' +
      'Думай конкретно и по делу, на языке пользователя, без воды и общих фраз. ' +
      'Учитывай память и прошлые исходы — не повторяй то, что не сработало.';
    const prompt =
      `Запрос: "${input.text}"\n\n` +
      `Память:\n${mem || '—'}\n\n` +
      `Прошлые исходы:\n${outs || '—'}\n\n` +
      `Сигналы агентов:\n${angels || '—'}\n\n` +
      `Черновик плана:\n${draft || '—'}\n\n` +
      'Дай СТРОГО JSON без пояснений: ' +
      '{"mission":"короткая фраза — миссия дня",' +
      '"answer":"2-4 предложения, прямой ответ от MAX",' +
      '"actions":["3-6 конкретных приоритетных действий"],' +
      '"risks":["1-3 риска/предостережения"]}';

    try {
      const raw = await llm(prompt, { json: true, system });
      if (!raw.trim()) return synthesis;
      const parsed = JSON.parse(extractJson(raw)) as {
        mission?: string;
        answer?: string;
        actions?: unknown[];
        risks?: unknown[];
      };
      if (typeof parsed.answer === 'string' && parsed.answer.trim()) {
        synthesis.answer = parsed.answer.trim();
      }
      if (typeof parsed.mission === 'string' && parsed.mission.trim()) {
        synthesis.mission = { ...synthesis.mission, title: parsed.mission.trim() };
      }
      if (Array.isArray(parsed.actions) && parsed.actions.length) {
        synthesis.actions = parsed.actions
          .map((t) => String(t).trim())
          .filter(Boolean)
          .slice(0, 6)
          .map((title, i) => ({ title, role: 'strategy' as AgentRole, priority: i + 1, reason: 'MAX · deep' }));
      }
      if (Array.isArray(parsed.risks) && parsed.risks.length) {
        synthesis.risks = uniq([
          ...parsed.risks.map((r) => String(r).trim()).filter(Boolean),
          ...synthesis.risks,
        ]).slice(0, 5);
      }
      synthesis.meta = { ...synthesis.meta, deep: true };
    } catch (err) {
      console.error('[MAX] deepen failed', err);
    }
    return synthesis;
  }

  createMission(results: AgentResult[]): Mission {
    const strategy = this.outputsFrom(results).find((o) => o.role === 'strategy');
    const fromMeta = strategy?.metadata?.['mission'] as Mission | undefined;
    if (fromMeta?.title) return fromMeta;

    const focus = (strategy?.metadata?.['focus'] as string[] | undefined) ?? [];
    return {
      title: focus[0] ? `Двигаю «${focus[0]}» вперёд` : 'Миссия дня',
      focus,
      why: 'Фокус важнее количества задач.',
    };
  }

  evaluateRisks(results: AgentResult[]): string[] {
    const outputs = this.outputsFrom(results);
    const risks: string[] = [];
    // Guardian first (authoritative), then any peer-flagged risks.
    const guardian = outputs.find((o) => o.role === 'guardian');
    if (guardian?.risks) risks.push(...guardian.risks);
    for (const o of outputs) {
      if (o.role !== 'guardian' && o.risks) risks.push(...o.risks);
    }
    return uniq(risks);
  }

  // --- internals ----------------------------------------------------------

  private absorb(result: AgentResult): void {
    this.collected.get(result.task.runId)?.push(result);
  }

  private async runTask(task: AgentTask): Promise<AgentResult> {
    const startedAt = nowIso();
    const start = Date.now();
    this.bus.emit('agent:started', { task });

    const agent = this.registry.get(task.role);
    if (!agent) {
      const result = this.errorResult(task, `No agent registered for role: ${task.role}`, startedAt, start);
      this.bus.emit('agent:error', { result });
      return result;
    }

    try {
      const output = await agent.run(task.input, task.context);
      const result: AgentResult = {
        task,
        status: 'completed',
        output,
        startedAt,
        finishedAt: nowIso(),
        durationMs: Date.now() - start,
      };
      this.bus.emit('agent:completed', { result });
      return result;
    } catch (err) {
      const result = this.errorResult(task, err instanceof Error ? err.message : String(err), startedAt, start);
      this.bus.emit('agent:error', { result });
      return result;
    }
  }

  private errorResult(task: AgentTask, error: string, startedAt: string, start: number): AgentResult {
    return { task, status: 'error', error, startedAt, finishedAt: nowIso(), durationMs: Date.now() - start };
  }

  private prioritizeActions(outputs: AgentOutput[]): PrioritizedAction[] {
    const ordered = [...outputs].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
    const seen = new Set<string>();
    const merged: { title: string; role: AgentRole }[] = [];
    for (const output of ordered) {
      for (const action of output.actions) {
        const key = action.toLowerCase().trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push({ title: action, role: output.role });
      }
    }
    return merged.slice(0, MAX_ACTIONS).map((item, index) => ({
      title: item.title,
      role: item.role,
      priority: index + 1,
      reason: `предложено ${item.role}-агентом`,
    }));
  }

  private buildSummary(mission: Mission, ranAgents: AgentRole[], actions: PrioritizedAction[]): string {
    const head = mission.focus[0];
    return `Собрал ${ranAgents.length} агент(ов)${head ? ` вокруг «${head}»` : ''}. ` +
      `Главное на сегодня: ${mission.title.toLowerCase()}; ${actions.length} приоритетных действий.`;
  }

  private buildRecommendation(mission: Mission, actions: PrioritizedAction[], risks: string[]): string {
    const parts = [`Сегодня: ${mission.title}.`];
    if (actions[0]) parts.push(`Начни с: ${actions[0].title}`);
    if (risks[0]) parts.push(`Держи в уме: ${risks[0]}`);
    return parts.join(' ');
  }

  private outputsFrom(results: AgentResult[]): AgentOutput[] {
    return results.filter((r): r is AgentResult & { output: AgentOutput } => Boolean(r.output)).map((r) => r.output);
  }

  private isEnabled(role: AgentRole): boolean {
    return this.config[role] !== false;
  }

  private createTask(role: AgentRole, input: AgentInput, context: AgentContext, runId: string): AgentTask {
    const agent = this.registry.get(role);
    return {
      id: genId('task'),
      runId,
      agentId: agent?.id ?? role,
      role,
      input,
      context,
      createdAt: nowIso(),
    };
  }

  private normalizeInput(input: string | AgentInput): AgentInput {
    if (typeof input === 'string') return { text: input };
    return { ...input, text: input.text ?? '' };
  }

  private buildContext(base: Partial<AgentContext>, _runId: string): AgentContext {
    return {
      now: base.now ?? nowIso(),
      sessionId: base.sessionId,
      userId: base.userId,
      history: base.history,
      memories: base.memories,
      peerOutputs: base.peerOutputs,
      services: { ...this.services, ...(base.services ?? {}) },
      config: base.config ?? this.config,
      signal: base.signal,
    };
  }

  /** One recall to populate memories + outcome history for the whole run. */
  private async primeContext(input: AgentInput, context: AgentContext): Promise<void> {
    const store = context.services?.memory;
    if (!store) return;
    try {
      if (!context.memories) {
        context.memories = await store.getRelevantMemories(input.text, 6);
      }
      if (!context.outcomes && store.lastOutcomes) {
        context.outcomes = store.lastOutcomes();
      }
    } catch (err) {
      console.error('[MAX] primeContext failed', err);
    }
  }

  private async persistTurn(input: AgentInput, synthesis: MaxSynthesis, context: AgentContext): Promise<void> {
    const store = context.services?.memory;
    if (!store) return;
    try {
      await store.saveMemory({
        text: input.text,
        kind: 'event',
        metadata: { mission: synthesis.mission.title },
      });
    } catch (err) {
      console.error('[MAX] saveMemory failed', err);
    }
  }
}
