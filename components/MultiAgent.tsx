'use client';

/**
 * MultiAgent — «MAX · Мультиагент». Честная агентная бригада: сложная задача
 * раскладывается Планировщиком на под-агентов, каждый работает своим шагом,
 * Синтезатор собирает итог. В моменте тратит больше контекста (несколько
 * LLM-проходов подряд) — за это и «глубина». Ты видишь всю бригаду в работе.
 *
 * ЧЕСТНОСТЬ: агенты рассуждают/планируют/пишут по тому, что знают. Они НЕ ходят
 * в LinkedIn, не парсят чужие данные и НЕ выдумывают факты/аккаунты/источники —
 * если шагу нужны живые данные, которых у MAX нет, агент честно это говорит и
 * выдаёт каркас/черновик, а не фейк.
 *
 * Открыть: событие `multi:toggle` (команда /мультиагент). Esc — закрыть.
 */

import { useCallback, useEffect, useState } from 'react';
import { Bot, Brain, CheckCircle2, Loader2, Network, Play, X } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';
import { recordOutcome } from '@/lib/outcome';

type Agent = { name: string; role: string; task: string };
type AgentRun = Agent & { status: 'wait' | 'work' | 'done'; output: string };
type Phase = 'idle' | 'planning' | 'working' | 'synth' | 'done';

const GUARD =
  'ВАЖНО: не выдумывай факты, источники, аккаунты, имена, ссылки или данные, которых у тебя нет. ' +
  'Нет доступа к живым данным (LinkedIn, интернет, чужие базы) — так и скажи и выдай каркас/критерии/черновик, а не фейк. Отвечай по-русски, по делу.';

async function raw(system: string, text: string, maxTokens: number, json = false): Promise<string> {
  const r = (await sendMax17Event({ type: 'llm_raw', system, text, json, max_tokens: maxTokens })) as {
    llm?: { text?: string };
    llm_text?: string;
    answer?: { text?: string };
  };
  return String(r.llm_text || r.llm?.text || r.answer?.text || '').trim();
}

export default function MultiAgent() {
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [agents, setAgents] = useState<AgentRun[]>([]);
  const [final, setFinal] = useState('');
  const [err, setErr] = useState('');

  const run = useCallback(async () => {
    const t = task.trim();
    if (!t) return;
    setErr('');
    setFinal('');
    setAgents([]);
    setPhase('planning');
    try {
      // 1) Планировщик — раскладывает задачу на 2-4 под-агента.
      const planRaw = await raw(
        'Ты — Планировщик мультиагентной бригады MAX. Разложи задачу на 2-4 под-агента, каждый со своей узкой ролью и КОРОТКИМ подзаданием (одна фраза). ' +
          GUARD +
          ' Верни СТРОГО JSON и ничего кроме него, все поля коротко: {"agents":[{"name":"имя","role":"роль","task":"одна фраза"}]}.',
        `Задача: ${t}`,
        1300,
        true,
      );
      const js = planRaw.slice(planRaw.indexOf('{'), planRaw.lastIndexOf('}') + 1);
      const plan = JSON.parse(js) as { agents?: Agent[] };
      const list = (plan.agents ?? []).filter((a) => a.name && a.task).slice(0, 4);
      if (list.length === 0) throw new Error('план пуст');
      const runs: AgentRun[] = list.map((a) => ({ ...a, status: 'wait', output: '' }));
      setAgents(runs);

      // 2) Под-агенты — по очереди (демон серийный), с живым статусом.
      setPhase('working');
      const outputs: string[] = [];
      for (let i = 0; i < runs.length; i++) {
        setAgents((prev) => prev.map((a, k) => (k === i ? { ...a, status: 'work' } : a)));
        const out = await raw(
          `Ты — под-агент «${runs[i].name}» (роль: ${runs[i].role}) в бригаде MAX. Выполни свой шаг чётко и практично. ${GUARD}`,
          `Общая задача: ${t}\n\nТвой шаг: ${runs[i].task}`,
          800,
        );
        outputs.push(`### ${runs[i].name} (${runs[i].role})\n${out}`);
        setAgents((prev) => prev.map((a, k) => (k === i ? { ...a, status: 'done', output: out } : a)));
        // Петля исхода: под-агент отработал свой кусок общей задачи.
        void recordOutcome({ goal: t, action: `${runs[i].name}: ${runs[i].task}`, ok: Boolean(out), agent: 'multiagent' });
      }

      // 3) Синтезатор — собирает итог.
      setPhase('synth');
      const synth = await raw(
        'Ты — Синтезатор бригады MAX. Собери работы под-агентов в один связный, практичный итог для пользователя: что делать, по шагам, без воды. ' +
          GUARD,
        `Задача: ${t}\n\nРаботы под-агентов:\n\n${outputs.join('\n\n')}`,
        1400,
      );
      setFinal(synth || 'Синтезатор промолчал.');
      setPhase('done');
    } catch (e) {
      setErr('Бригада споткнулась: ' + (e instanceof Error ? e.message : String(e)));
      setPhase('idle');
    }
  }, [task]);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('multi:toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('multi:toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!open) return null;

  const busy = phase !== 'idle' && phase !== 'done';
  const phaseLabel = { idle: '', planning: 'Планировщик раскладывает задачу…', working: 'Под-агенты работают…', synth: 'Синтезатор собирает итог…', done: 'Готово' }[phase];

  return (
    <div className="fixed inset-0 z-[63] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-[min(720px,100%)] flex-col overflow-hidden rounded-2xl border border-violet-400/30 bg-gradient-to-b from-[#0d0620]/95 to-[#070312]/95 shadow-[0_0_50px_rgba(139,92,246,0.16)]">
        <div className="flex items-center gap-2 border-b border-violet-400/15 px-4 py-3">
          <Network className="h-4 w-4 text-violet-300" />
          <span className="text-sm font-semibold tracking-[0.2em] text-violet-100">MAX · МУЛЬТИАГЕНТ</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-200/60" />}
          {phaseLabel && <span className="text-[10px] uppercase tracking-widest text-violet-200/50">{phaseLabel}</span>}
          <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-[11px] leading-relaxed text-white/50">
            Сложную задачу MAX раскладывает на бригаду под-агентов: <b className="text-white/75">Планировщик → под-агенты → Синтезатор</b>.
            В моменте тратит больше контекста (несколько проходов) — за это глубина. Агенты не выдумывают данных и не парсят чужое.
          </p>

          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            rows={2}
            placeholder="Задача для бригады. Напр.: «составь стратегию первых 5 клиентов на фриланс-разработку и черновик письма»"
            className="w-full resize-none rounded-lg border border-white/10 bg-black/40 p-2.5 text-[12px] text-white/85 outline-none focus:border-violet-400/40"
          />
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || !task.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-violet-500/25 px-3.5 py-2 text-sm font-semibold text-violet-50 hover:bg-violet-400/35 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {busy ? 'Бригада работает…' : 'Запустить бригаду'}
          </button>

          {err && <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">{err}</div>}

          {/* Бригада агентов */}
          {agents.length > 0 && (
            <div className="space-y-2">
              {agents.map((a, i) => (
                <div key={i} className="rounded-xl border border-violet-400/20 bg-violet-400/[0.04] p-2.5">
                  <div className="flex items-center gap-2">
                    <Bot className="h-3.5 w-3.5 text-violet-300" />
                    <span className="text-[12px] font-semibold text-violet-100">{a.name}</span>
                    <span className="text-[10px] text-white/40">· {a.role}</span>
                    <span className="ml-auto">
                      {a.status === 'work' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" />
                      ) : a.status === 'done' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <span className="text-[9px] uppercase tracking-widest text-white/30">ждёт</span>
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-white/45">{a.task}</div>
                  {a.output && <div className="mt-1.5 whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-[11px] leading-snug text-white/80">{a.output}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Итог синтезатора */}
          {final && (
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-emerald-300/70">
                <Brain className="h-3.5 w-3.5" /> Итог бригады
              </div>
              <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-white/90">{final}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
