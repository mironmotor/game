'use client';

/**
 * AngelsPanel — adaptive top panel that shows the "Council of Angels" (MAX + the
 * 7 agents). Sits as a fixed overlay at the top so it never disturbs the HUD
 * layout. Ask MAX a question; it routes to the 7 angels and renders the unified
 * output: mission, per-angel cards, prioritized actions, guardrails, recommendation.
 */

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Compass,
  Eye,
  ListChecks,
  Loader2,
  Mic,
  Package,
  Play,
  Send,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Volume2,
  VolumeX,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { runMaxOrchestrator, type MaxOrchestratorResponse } from '@/lib/max-orchestrator-client';
import { sendArchitect, sendCodeAgent, sendMax17Event } from '@/lib/max17-client';
import type { AgentOutput, AgentRole, PrioritizedAction } from '@/lib/agents/types';
import { useGameState, type Task } from '@/hooks/use-game-state';
import { getVoiceName, initJarvis, jarvisPreview, jarvisSpeak, jarvisStop, listVoices, setVoiceByName } from '@/lib/jarvis-voice';
import { useI18n } from '@/components/I18nProvider';
import type { MessageKey } from '@/lib/i18n/messages';

interface AngelMeta {
  labelKey: MessageKey;
  Icon: typeof Eye;
  text: string;
  ring: string;
  dot: string;
  glow: string;
}

const ANGELS: Record<AgentRole, AngelMeta> = {
  vision: { labelKey: 'angel.vision', Icon: Eye, text: 'text-sky-300', ring: 'border-sky-400/30', dot: 'bg-sky-400', glow: 'shadow-sky-500/10' },
  voice: { labelKey: 'angel.voice', Icon: Mic, text: 'text-violet-300', ring: 'border-violet-400/30', dot: 'bg-violet-400', glow: 'shadow-violet-500/10' },
  memory: { labelKey: 'angel.memory', Icon: Brain, text: 'text-amber-300', ring: 'border-amber-400/30', dot: 'bg-amber-400', glow: 'shadow-amber-500/10' },
  strategy: { labelKey: 'angel.strategy', Icon: Compass, text: 'text-emerald-300', ring: 'border-emerald-400/30', dot: 'bg-emerald-400', glow: 'shadow-emerald-500/10' },
  product: { labelKey: 'angel.product', Icon: Package, text: 'text-blue-300', ring: 'border-blue-400/30', dot: 'bg-blue-400', glow: 'shadow-blue-500/10' },
  growth: { labelKey: 'angel.growth', Icon: TrendingUp, text: 'text-pink-300', ring: 'border-pink-400/30', dot: 'bg-pink-400', glow: 'shadow-pink-500/10' },
  guardian: { labelKey: 'angel.guardian', Icon: Shield, text: 'text-rose-300', ring: 'border-rose-400/30', dot: 'bg-rose-400', glow: 'shadow-rose-500/10' },
};

function pct(n: number): string {
  return `${Math.round((n || 0) * 100)}%`;
}

/** Which game "manager" owns a task created from each agent's action. */
const MGR_BY_ROLE: Record<AgentRole, Task['mgr']> = {
  strategy: 'MGR-1',
  guardian: 'MGR-1',
  product: 'MGR-2',
  memory: 'MGR-2',
  growth: 'MGR-3',
  vision: 'MGR-3',
  voice: 'MGR-3',
};

function xpFor(a: PrioritizedAction): number {
  return a.effort === 'large' ? 50 : a.effort === 'medium' ? 35 : 25;
}

const STATUS_LABEL: Record<string, string> = {
  active: 'в работе',
  pending: 'в очереди',
  completed: 'готово',
  failed: 'провал',
};

/** Tell the HUD NeuralCore to spin faster while MAX is processing. */
function signalThinking(active: boolean): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('max:thinking', { detail: { active } }));
  }
}

const ROLE_ORDER: AgentRole[] = ['strategy', 'product', 'growth', 'memory', 'guardian', 'vision', 'voice'];

/** Technical tasks get a real code agent (architect); everything else gets a council breakdown. */
const TECH_RE = /код|code|api|endpoint|фич|feature|баг|bug|рефактор|refactor|компонент|component|функц|function|деплой|deploy|build|сборк|тест(?!ост)|test|интеграц|скрипт|script|бэкенд|backend|фронт|frontend|миграц|migration|схем|типизац|типы|hook|хук|роут|route/i;

export default function AngelsPanel() {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MaxOrchestratorResponse | null>(null);
  // По умолчанию Совет скрыт — вызывается только кнопкой «Совет» / «Разгон»
  // (событиями angels:open / angels:kickoff / angels:ask, все снимают dismissed).
  const [dismissed, setDismissed] = useState(true);
  const [agentMode, setAgentMode] = useState(true);
  const [workIds, setWorkIds] = useState<string[]>([]);
  const [execId, setExecId] = useState<string | null>(null);
  const [execPlans, setExecPlans] = useState<Record<string, string>>({});
  const [learned, setLearned] = useState<Record<string, string>>({});
  const [autoRunning, setAutoRunning] = useState(false);
  const [wasDeep, setWasDeep] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voices, setVoices] = useState<{ name: string; lang: string }[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const voiceOnRef = useRef(false);
  voiceOnRef.current = voiceOn;
  const inputRef = useRef<HTMLInputElement>(null);
  const { tasks, addTasks, completeTask, setTaskActive } = useGameState();
  // Keep a live ref so the dock-triggered kickoff (captured once) sees fresh tasks.
  const tasksRef = useRef<Task[]>(tasks);
  tasksRef.current = tasks;

  // MAX takes the plan into the real game task system and starts task #1.
  function takeIntoWork(result: MaxOrchestratorResponse) {
    const actions = result.actions ?? [];
    if (!actions.length) {
      setWorkIds([]);
      return;
    }
    const created: Task[] = actions.map((a, i) => ({
      id: `max_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      desc: a.title,
      mgr: MGR_BY_ROLE[a.role] ?? 'MGR-1',
      xp: xpFor(a),
      status: i === 0 ? 'active' : 'pending',
      createdAt: new Date().toISOString(),
    }));
    void addTasks(created);
    setWorkIds(created.map((t) => t.id));
    // Let storage flush, then notify the HUD instance to reload its missions.
    setTimeout(() => window.dispatchEvent(new Event('game:tasks-sync')), 0);
    // "Стартую с №1" for real: immediately break down the active task into steps.
    void execute(created[0]);
  }

  // Close the learning loop: report the outcome so Max17 reinforces/weakens
  // synapses and remembers what worked. Best-effort, fast (no voice/web).
  async function learn(type: 'outcome_success' | 'outcome_failure', task: Task) {
    try {
      const r = await sendMax17Event({ type, text: task.desc });
      const adj = (r.outcome?.next_adjustment as string | undefined) || r.next_adaptation;
      if (adj) setLearned((m) => ({ ...m, [task.id]: adj }));
    } catch {
      /* learning is best-effort — never block the flow */
    }
  }

  async function markDone(id: string) {
    await completeTask(id);
    setTimeout(() => window.dispatchEvent(new Event('game:tasks-sync')), 0);
    const done = tasksRef.current.find((t) => t.id === id);
    if (done) void learn('outcome_success', done); // MAX learns: this worked
    // Pipeline: activate + auto-run the next queued task so work keeps flowing.
    const next = tasksRef.current.find(
      (t) => workIds.includes(t.id) && t.id !== id && t.status === 'pending',
    );
    if (next) {
      void setTaskActive(next.id);
      setTimeout(() => window.dispatchEvent(new Event('game:tasks-sync')), 0);
      void execute(next);
    }
  }

  async function ask(override?: string, forceWork = false, deepMode = false) {
    const q = (override ?? text).trim();
    if (!q || loading) return;
    setDismissed(false);
    setOpen(true);
    setLoading(true);
    setError(null);
    setWasDeep(deepMode);
    signalThinking(true);
    try {
      const result = await runMaxOrchestrator({ text: q, deep: deepMode, locale });
      setData(result);
      if (voiceOnRef.current && result.answer) jarvisSpeak(result.answer);
      if (agentMode || forceWork) takeIntoWork(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      signalThinking(false);
    }
  }

  // "Глубже" — the council itself reasons through the real model (deep mode).
  function deepThink() {
    if (!text.trim()) return;
    void ask(undefined, false, true);
  }

  // "Разгон дня" — context-aware kickstart. Builds the prompt from the user's open
  // tasks (Max17 memory is folded in server-side by the Memory agent), so the day
  // continues from where they actually are, not from a generic blank slate.
  function kickoff() {
    setAgentMode(true);
    const open = tasksRef.current.filter((t) => t.status === 'active' || t.status === 'pending');
    let prompt = `${t('angels.kickoff')}. ${t('ai.replyLanguageInstruction', { language: locale })}`;
    if (open.length) {
      const list = open.slice(0, 8).map((t) => `«${t.desc}»`).join(', ');
      prompt =
        `Мой день уже в процессе. Открыто/в работе: ${list}. ` +
        `Построй миссию на сегодня отсюда — что добить и что начать дальше, ` +
        `учитывая мою память и контекст. Возьми главное в работу.`;
    }
    setText(prompt);
    void ask(prompt, true);
  }

  // "Выполнить" a single task. Technical tasks are routed to the real architect
  // agent (concrete dev branches + steps + files); the rest get a council breakdown.
  async function execute(task: Task) {
    if (execId) return;
    setExecId(task.id);
    signalThinking(true);
    try {
      if (TECH_RE.test(task.desc)) {
        const r = await sendArchitect({ focus: task.desc, count: 3 });
        if (r.ok && r.branches?.length) {
          const txt = r.branches
            .map((b) => {
              const steps = b.steps?.length ? `\n   • ${b.steps.slice(0, 4).join('\n   • ')}` : '';
              const files = b.files?.length ? `\n   файлы: ${b.files.slice(0, 5).join(', ')}` : '';
              return `▸ ${b.title}${steps}${files}`;
            })
            .join('\n\n');
          setExecPlans((p) => ({ ...p, [task.id]: `🛠 architect · ${r.model ?? 'AI'}\n${txt}` }));
        } else {
          setExecPlans((p) => ({ ...p, [task.id]: r.error || 'architect: пусто' }));
        }
      } else {
        const r = await runMaxOrchestrator({
          text: `${t('angels.ask')}: ${task.desc}`,
          locale,
        });
        const steps = (r.actions ?? []).map((a, i) => `${i + 1}. ${a.title}`).join('\n');
        setExecPlans((p) => ({ ...p, [task.id]: [r.answer, steps].filter(Boolean).join('\n') }));
      }
    } catch (err) {
      setExecPlans((p) => ({ ...p, [task.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setExecId(null);
      signalThinking(false);
    }
  }

  // Autonomous run — MAX works the whole plan: executes every task through its
  // (read-only) executor in sequence, plans filling in live. Code edits stay manual.
  async function autoRun() {
    if (autoRunning || execId) return;
    setAutoRunning(true);
    try {
      const queue = tasksRef.current.filter((t) => workIds.includes(t.id) && t.status !== 'completed');
      for (const t of queue) {
        if (execPlans[t.id]) continue; // skip what already has a plan (e.g. #1)
        await execute(t);
      }
    } finally {
      setAutoRunning(false);
    }
  }

  // Real code agent — actually edits files in the isolated sandbox (code-workspace/).
  // Explicit click only (it writes files + runs shell), never auto-run.
  async function runCode(task: Task) {
    if (execId) return;
    setExecId(task.id);
    signalThinking(true);
    setExecPlans((p) => ({ ...p, [task.id]: '🛠 code-агент работает в песочнице code-workspace/…' }));
    try {
      const r = await sendCodeAgent({ instruction: task.desc, target: 'sandbox', max_steps: 8 });
      if (r.ok) {
        const head = `🛠 code · ${r.model ?? 'AI'}${r.steps?.length ? ` · шагов: ${r.steps.length}` : ''}`;
        const files = r.files_changed?.length ? `\nизменено файлов (${r.files_changed.length}): ${r.files_changed.join(', ')}` : '\nфайлы не менялись';
        setExecPlans((p) => ({ ...p, [task.id]: `${head}\n${r.answer ?? ''}${files}` }));
        void learn('outcome_success', task); // MAX learns: code task succeeded
      } else {
        setExecPlans((p) => ({ ...p, [task.id]: r.error || 'code-агент: ошибка' }));
        void learn('outcome_failure', task); // MAX learns: this approach failed
      }
    } catch (err) {
      setExecPlans((p) => ({ ...p, [task.id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setExecId(null);
      signalThinking(false);
    }
  }

  // Open / trigger the council from anywhere in the app (e.g. the HUD dock
  // "Совет" button) via global events — keeps the panel fully decoupled.
  useEffect(() => {
    const onOpen = () => {
      setDismissed(false);
      setOpen(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent).detail as { text?: string } | undefined;
      const q = typeof detail?.text === 'string' ? detail.text : '';
      if (q) {
        setText(q);
        void ask(q);
      } else {
        onOpen();
      }
    };
    const onKickoff = () => kickoff();
    window.addEventListener('angels:open', onOpen);
    window.addEventListener('angels:ask', onAsk as EventListener);
    window.addEventListener('angels:kickoff', onKickoff);
    return () => {
      window.removeEventListener('angels:open', onOpen);
      window.removeEventListener('angels:ask', onAsk as EventListener);
      window.removeEventListener('angels:kickoff', onKickoff);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // JARVIS-style voice: warm voices, restore on/off + the chosen voice, and keep
  // the picker list fresh (voices load asynchronously in the browser).
  useEffect(() => {
    initJarvis();
    try {
      if (localStorage.getItem('max_voice') === '1') setVoiceOn(true);
    } catch {
      /* ignore */
    }
    const load = () => {
      setVoices(listVoices());
      setSelectedVoice(getVoiceName());
    };
    load();
    const timer = setTimeout(load, 500);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.addEventListener('voiceschanged', load);
    }
    return () => {
      clearTimeout(timer);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.removeEventListener('voiceschanged', load);
      }
    };
  }, []);

  function toggleVoice() {
    setVoiceOn((on) => {
      const next = !on;
      try {
        localStorage.setItem('max_voice', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      if (!next) jarvisStop();
      return next;
    });
  }

  // Fully hidden — reopen via the HUD dock "Совет" button or an `angels:open` event.
  if (dismissed) return null;

  const workTasks = tasks.filter((t) => workIds.includes(t.id));

  return (
    <div className="fixed top-0 inset-x-0 z-50 pointer-events-none">
      <div className="pointer-events-auto mx-auto w-full max-w-6xl px-2 sm:px-4 pt-2">
        {/* Command bar */}
        <div className="angels-command-bar flex items-center gap-2 rounded-2xl border border-fuchsia-400/20 bg-[#0a0818]/85 px-2.5 py-2 shadow-lg shadow-fuchsia-500/10 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl px-2 py-1 text-fuchsia-200 transition hover:bg-fuchsia-400/10"
            title={t('angels.title')}
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden text-xs font-semibold tracking-wide sm:inline">{t('angels.title')}</span>
            {data && (
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
            )}
          </button>

          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ask();
            }}
            placeholder={t('angels.placeholder')}
            dir="auto"
            className="min-w-0 flex-1 bg-transparent px-2 text-sm text-white placeholder:text-white/35 focus:outline-none"
          />

          <button
            type="button"
            onClick={kickoff}
            disabled={loading}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-amber-400/40 bg-amber-400/15 px-2.5 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-40"
            title={t('angels.kickoff')}
          >
            <Zap className="h-4 w-4" />
            <span className="hidden md:inline">{t('angels.kickoff')}</span>
          </button>

          <button
            type="button"
            onClick={() => ask()}
            disabled={loading || !text.trim()}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-fuchsia-500/90 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="hidden sm:inline">{loading ? t('angels.meeting') : t('angels.ask')}</span>
          </button>

          <button
            type="button"
            onClick={deepThink}
            disabled={loading || !text.trim()}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-violet-400/40 bg-violet-500/15 px-2.5 py-1.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            title={t('angels.deep')}
          >
            {loading && wasDeep ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
            <span className="hidden md:inline">{t('angels.deep')}</span>
          </button>

          <button
            type="button"
            onClick={() => setAgentMode((m) => !m)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-medium transition',
              agentMode
                ? 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
                : 'text-white/40 hover:bg-white/10 hover:text-white/70',
            )}
            title={agentMode ? 'Режим агента ВКЛ — MAX берёт задачи в работу' : 'Режим агента ВЫКЛ — только совет'}
            aria-pressed={agentMode}
          >
            <Bot className="h-4 w-4" />
            <span className="hidden md:inline">{t('angels.agent')}</span>
          </button>

          <button
            type="button"
            onClick={toggleVoice}
            className={cn(
              'flex shrink-0 items-center justify-center rounded-xl px-2 py-1.5 transition',
              voiceOn ? 'bg-sky-500/20 text-sky-200 hover:bg-sky-500/30' : 'text-white/40 hover:bg-white/10 hover:text-white/70',
            )}
            title={voiceOn ? 'Голос MAX (JARVIS) включён — отвечает вслух' : 'Озвучивать ответы MAX голосом (JARVIS)'}
            aria-pressed={voiceOn}
            aria-label={t('hud.voice')}
          >
            {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              jarvisStop();
            }}
            className="flex shrink-0 items-center justify-center rounded-xl px-1.5 py-1.5 text-white/40 transition hover:bg-white/10 hover:text-white/80"
            title={t('common.collapse')}
            aria-label={t('common.collapse')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {voiceOn && (
          <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-sky-400/20 bg-[#0a0818]/75 px-2.5 py-1.5 backdrop-blur-md">
            <Volume2 className="h-3.5 w-3.5 shrink-0 text-sky-300/80" />
            <span className="shrink-0 text-[11px] text-white/45">{t('hud.voice')}:</span>
            <select
              value={selectedVoice}
              onChange={(e) => {
                setSelectedVoice(e.target.value);
                setVoiceByName(e.target.value);
                jarvisPreview(e.target.value);
              }}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-sky-400/40"
            >
              <option value="">{t('language.auto')} ({locale})</option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} · {v.lang}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => jarvisPreview()}
              className="shrink-0 rounded-lg bg-sky-500/20 px-2 py-1 text-[11px] text-sky-100 transition hover:bg-sky-500/35"
            >
              {t('common.test')}
            </button>
          </div>
        )}

        {/* Output */}
        {open && (loading || error || data) && (
          <div className="mt-2 max-h-[78vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0a0818]/90 p-3 shadow-2xl backdrop-blur-md sm:p-4">
            {loading && (
              <div className="mb-3 flex flex-col gap-2">
                <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-fuchsia-300/80">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('angels.thinking')}…
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_ORDER.map((role, i) => {
                    const m = ANGELS[role];
                    const Icon = m.Icon;
                    return (
                      <span
                        key={role}
                        className={cn('flex animate-pulse items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]', m.ring, m.text)}
                        style={{ animationDelay: `${i * 120}ms` }}
                      >
                        <Icon className="h-3 w-3" /> {t(m.labelKey)}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {data && (
              <div className="space-y-4">
                {/* MAX final answer */}
                <div className="rounded-xl border border-cyan-400/25 bg-gradient-to-r from-cyan-500/10 to-transparent p-3">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-cyan-300/80">
                    <Sparkles className="h-3.5 w-3.5" /> MAX отвечает
                    <span className="ml-auto flex items-center gap-1.5">
                      {(wasDeep || data.meta?.deep) && (
                        <span
                          className="flex items-center gap-1 rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] text-violet-200"
                          title={data.meta?.autoEscalated ? 'MAX ушёл глубже сам — уверенность была низкой' : 'Глубокий режим (реальная модель)'}
                        >
                          <Brain className="h-3 w-3" /> {data.meta?.autoEscalated ? 'сам углубился' : 'глубоко'}
                        </span>
                      )}
                      {agentMode && (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200">
                          <Bot className="h-3 w-3" /> режим агента
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-cyan-50">{data.answer}</p>
                </div>

                {/* Mission */}
                <div className="rounded-xl border border-fuchsia-400/20 bg-gradient-to-r from-fuchsia-500/10 to-transparent p-3">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-fuchsia-300/80">
                    <Target className="h-3.5 w-3.5" /> Миссия дня
                    <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70">
                      MAX · {pct(data.confidence)} увер.
                    </span>
                  </div>
                  <div className="mt-1 text-base font-semibold text-white">{data.mission?.title}</div>
                  <p className="mt-1 text-sm text-white/70">{data.summary}</p>
                  {data.mission?.successCriteria?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {data.mission.successCriteria.map((c, i) => (
                        <span key={i} className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">
                          ✓ {c}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Taken into work — real game tasks */}
                {agentMode && workTasks.length > 0 && (
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-emerald-300/70">
                      <ListChecks className="h-3.5 w-3.5" /> Взято в работу · {workTasks.length}
                      <button
                        type="button"
                        onClick={autoRun}
                        disabled={autoRunning || execId !== null}
                        className="ml-auto flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-100 transition hover:bg-emerald-500/35 disabled:opacity-40"
                        title="Авто-прогон: MAX сам прогонит весь план через исполнителей"
                      >
                        {autoRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                        {autoRunning ? 'прогон…' : 'Авто'}
                      </button>
                    </div>
                    <ul className="space-y-1.5">
                      {workTasks.map((t) => {
                        const done = t.status === 'completed';
                        return (
                          <li key={t.id} className="rounded-lg bg-white/[0.02] px-1.5 py-1">
                            <div className="flex items-center gap-2 text-sm">
                              <span
                                className={cn(
                                  'flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[10px]',
                                  t.status === 'active' && 'bg-emerald-500/25 text-emerald-100',
                                  t.status === 'pending' && 'bg-white/10 text-white/55',
                                  done && 'bg-emerald-500/15 text-emerald-300',
                                )}
                              >
                                {t.status === 'active' ? <Play className="h-3 w-3" /> : done ? <Check className="h-3 w-3" /> : null}
                                {STATUS_LABEL[t.status] ?? t.status}
                              </span>
                              <span className={cn('flex-1 text-white/85', done && 'text-white/40 line-through')}>{t.desc}</span>
                              <span className="hidden shrink-0 text-[10px] text-white/35 sm:inline">{t.mgr} · +{t.xp}xp</span>
                              {!done && (
                                <button
                                  type="button"
                                  onClick={() => execute(t)}
                                  disabled={execId !== null}
                                  className="flex shrink-0 items-center gap-1 rounded-lg bg-cyan-500/20 px-2 py-1 text-[11px] text-cyan-100 transition hover:bg-cyan-500/35 disabled:opacity-40"
                                  title="MAX разобьёт задачу на конкретные шаги"
                                >
                                  {execId === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                                  <span className="hidden sm:inline">Выполнить</span>
                                </button>
                              )}
                              {!done && TECH_RE.test(t.desc) && (
                                <button
                                  type="button"
                                  onClick={() => runCode(t)}
                                  disabled={execId !== null}
                                  className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-500/20 px-2 py-1 text-[11px] text-amber-100 transition hover:bg-amber-500/35 disabled:opacity-40"
                                  title="code-агент: реально правит файлы в песочнице code-workspace/"
                                >
                                  {execId === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                                  <span className="hidden sm:inline">Код</span>
                                </button>
                              )}
                              {!done && (
                                <button
                                  type="button"
                                  onClick={() => markDone(t.id)}
                                  className="shrink-0 rounded-lg bg-emerald-500/20 px-2 py-1 text-[11px] text-emerald-100 transition hover:bg-emerald-500/35"
                                >
                                  Готово
                                </button>
                              )}
                            </div>
                            {execPlans[t.id] && (
                              <pre className="mt-1.5 whitespace-pre-wrap rounded-md bg-black/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-cyan-100/85">
                                {execPlans[t.id]}
                              </pre>
                            )}
                            {learned[t.id] && (
                              <div className="mt-1 flex items-start gap-1 text-[11px] text-amber-200/80">
                                <Brain className="mt-0.5 h-3 w-3 shrink-0" />
                                <span>MAX усвоил: {learned[t.id]}</span>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* Angels grid */}
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {(data.agents ?? []).map((agent) => (
                    <AngelCard key={agent.agentId} agent={agent} />
                  ))}
                </div>

                {/* Actions + risks */}
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {data.actions?.length ? (
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="mb-2 text-[11px] uppercase tracking-widest text-white/50">Приоритетные действия</div>
                      <ol className="space-y-1.5">
                        {data.actions.map((a) => (
                          <li key={a.priority} className="flex items-start gap-2 text-sm text-white/85">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fuchsia-500/20 text-[11px] font-bold text-fuchsia-200">
                              {a.priority}
                            </span>
                            <span>
                              {a.title}
                              <span className={cn('ml-1.5 text-[10px]', ANGELS[a.role]?.text)}>· {t(ANGELS[a.role].labelKey)}</span>
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}

                  {data.risks?.length ? (
                    <div className="rounded-xl border border-rose-400/20 bg-rose-500/5 p-3">
                      <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-rose-300/70">
                        <Shield className="h-3.5 w-3.5" /> Защита · риски
                      </div>
                      <ul className="space-y-1.5">
                        {data.risks.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-rose-100/85">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300/80" />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                {/* Recommendation */}
                {data.recommendation && (
                  <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-3 text-sm text-cyan-100">
                    <span className="font-semibold text-cyan-300">MAX: </span>
                    {data.recommendation}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AngelCard({ agent }: { agent: AgentOutput }) {
  const { t } = useI18n();
  const meta = ANGELS[agent.role];
  const available = agent.metadata?.['available'] !== false;
  const Icon = meta?.Icon ?? Sparkles;
  const recalled = (agent.metadata?.['recalled'] as Array<{ text?: string }> | undefined) ?? [];
  // The memory card shows recalled items explicitly, so drop the duplicate insight.
  const insights =
    agent.role === 'memory'
      ? agent.insights.filter((i) => !i.startsWith('Похожее из памяти'))
      : agent.insights;
  return (
    <div
      className={cn(
        'rounded-xl border bg-white/[0.03] p-3 shadow-sm transition',
        meta?.ring ?? 'border-white/10',
        meta?.glow,
        !available && 'opacity-55',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', meta?.text)} />
        <span className={cn('text-xs font-semibold', meta?.text)}>
          {meta ? t(meta.labelKey) : agent.role}
        </span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-white/45">
          <span className={cn('h-1.5 w-1.5 rounded-full', meta?.dot)} />
          {pct(agent.confidence)}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-snug text-white/75">{agent.summary}</p>
      {insights?.length ? (
        <ul className="mt-2 space-y-1">
          {insights.slice(0, 2).map((ins, i) => (
            <li key={i} className="text-[11px] leading-snug text-white/55">
              · {ins}
            </li>
          ))}
        </ul>
      ) : null}
      {agent.role === 'memory' && recalled.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-amber-400/10 pt-1.5">
          <div className="text-[9px] uppercase tracking-wider text-amber-300/50">MAX вспомнил</div>
          {recalled.slice(0, 4).map((m, i) => (
            <div key={i} className="flex items-start gap-1 text-[11px] leading-snug text-amber-100/75">
              <span className="text-amber-400/50">·</span>
              <span className="break-words">{m.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
