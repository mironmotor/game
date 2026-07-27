'use client';

/**
 * AgentRunner — «Автопилот · Прогон по шагам». Новый режим автопилота: MAX
 * раскладывает цель на КОНКРЕТНЫЕ атомарные шаги и ВЫПОЛНЯЕТ их вживую, шаг за
 * шагом, визуализируя прогресс (⏳ → 🔄 → ✅).
 *
 * Шаги двух видов:
 *   • auto — MAX делает сам (ресерч, персонализация, черновик, план, код). Делает
 *     без кнопок: это подготовка текста, мир не трогается.
 *   • gate — нужен Мирон-человек (SEND / CALL / PAYMENT / вход по паролю). MAX
 *     готовит всё ДО этого шага и останавливается: действие в мире жмёшь ты.
 *
 * Открыть: `runner:open` (detail.goal) или команда /прогон. Esc — закрыть.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleDot, Hand, Loader2, Play, Rocket, Square, X } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';
import { recordOutcome } from '@/lib/outcome';
import { reachGoal } from '@/lib/metrika';

type StepKind = 'auto' | 'gate';
type Step = { n?: number; action: string; kind: StepKind; note?: string };
type RunStep = Step & { status: 'pending' | 'running' | 'done' | 'gate'; output: string };

async function raw(system: string, text: string, maxTokens: number, json = false): Promise<string> {
  const r = (await sendMax17Event({ type: 'llm_raw', system, text, json, max_tokens: maxTokens })) as {
    llm?: { text?: string };
    llm_text?: string;
    answer?: { text?: string };
  };
  return String(r.llm_text || r.llm?.text || r.answer?.text || '').trim();
}

const GUARD =
  'Только легальное и реальное. НЕ выдумывай фактов, кейсов, цифр, аккаунтов, ссылок и отзывов — если чего-то нет, скажи прямо. Отвечай по-русски (тексты для клиентов — можно на языке клиента).';

export default function AgentRunner() {
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState('Заработать 55 555 ₽ сегодня через outbound к US B2B IT-компаниям (маркетинг + AI + разработка)');
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [phase, setPhase] = useState<'idle' | 'planning' | 'running' | 'done'>('idle');
  const [err, setErr] = useState('');
  const stopRef = useRef(false);

  const run = useCallback(async () => {
    const g = goal.trim();
    if (!g) return;
    stopRef.current = false;
    setErr('');
    setSteps([]);
    setPhase('planning');
    reachGoal('agent_run'); // цель Метрики: глубокое вовлечение — запустил прогон
    try {
      // 1) Планировщик: цель → конкретные атомарные шаги (auto/gate).
      const planRaw = await raw(
        'Ты — Планировщик прогона MAX. Разложи цель на 5-9 КОНКРЕТНЫХ атомарных шагов по порядку. ' +
          'Для каждого шага реши вид: "auto" — MAX делает сам (ресерч, персонализация, черновик, план, код), или "gate" — нужен человек Мирон (отправка сообщения, звонок, оплата, вход по паролю, регистрация). ' +
          GUARD +
          ' Верни СТРОГО JSON и коротко: {"steps":[{"action":"что сделать (кратко)","kind":"auto|gate","note":"деталь"}]}.',
        `Цель: ${g}`,
        1400,
        true,
      );
      const js = planRaw.slice(planRaw.indexOf('{'), planRaw.lastIndexOf('}') + 1);
      const plan = JSON.parse(js) as { steps?: Step[] };
      const list = (plan.steps ?? []).filter((s) => s.action).slice(0, 9);
      if (list.length === 0) throw new Error('план пуст');
      // ЖЁСТКАЯ СТРАХОВКА: действия в реальном мире — ВСЕГДА gate (нужен человек),
      // что бы ни сказал LLM. MAX готовит их, но жмёшь ты.
      const GATE_RE =
        /отправ|разосл|напиши(?:\s|те)?\s*(?:письмо|сообщени|dm)|send|оплат|заплат|перевед|депозит|deposit|payment|pay\b|звон|созвон|позвон|call\b|регистр|sign\s?up|register|логин|войти|пароль|login|password|подтверд|опубликов|запост|post\b|встреч|meeting/i;
      const runs: RunStep[] = list.map((s, i) => {
        const forcedGate = GATE_RE.test(s.action) || GATE_RE.test(s.note || '');
        return { ...s, n: i + 1, kind: forcedGate || s.kind === 'gate' ? 'gate' : 'auto', status: 'pending', output: '' };
      });
      setSteps(runs);

      // 2) Выполняем по порядку. auto — делаем; gate — помечаем «нужен ты» и НЕ выполняем.
      setPhase('running');
      for (let i = 0; i < runs.length; i++) {
        if (stopRef.current) break;
        if (runs[i].kind === 'gate') {
          setSteps((prev) => prev.map((s, k) => (k === i ? { ...s, status: 'gate', output: 'Готово к действию — это жмёшь ты (SEND / CALL / PAYMENT).' } : s)));
          continue;
        }
        setSteps((prev) => prev.map((s, k) => (k === i ? { ...s, status: 'running' } : s)));
        const done = runs
          .slice(0, i)
          .filter((s) => s.output && s.status === 'done')
          .map((s) => `[${s.action}]: ${s.output}`)
          .join('\n')
          .slice(0, 1600);
        const out = await raw(
          `Ты — исполнитель шага в прогоне MAX к цели. Выполни ТОЛЬКО свой шаг, конкретно и готово к использованию (черновик/ресерч/план/код). ${GUARD}`,
          `Цель: ${g}\n\nТвой шаг: ${runs[i].action}${runs[i].note ? ` (${runs[i].note})` : ''}\n\nЧто уже сделано ранее:\n${done || '—'}`,
          800,
        );
        setSteps((prev) => prev.map((s, k) => (k === i ? { ...s, status: 'done', output: out } : s)));
        // Петля исхода: шаг реально выполнен — MAX учится, что сработало.
        void recordOutcome({ goal: g, action: runs[i].action, ok: Boolean(out), agent: 'runner' });
      }
      setPhase('done');
    } catch (e) {
      setErr('Прогон споткнулся: ' + (e instanceof Error ? e.message : String(e)));
      setPhase('idle');
    }
  }, [goal]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const g = (e as CustomEvent).detail?.goal as string | undefined;
      if (g && g.trim()) setGoal(g);
      setOpen(true);
    };
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('runner:open', onOpen as EventListener);
    window.addEventListener('runner:toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('runner:open', onOpen as EventListener);
      window.removeEventListener('runner:toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!open) return null;

  const busy = phase === 'planning' || phase === 'running';
  const doneN = steps.filter((s) => s.status === 'done').length;
  const gateN = steps.filter((s) => s.status === 'gate').length;

  return (
    <div className="fixed inset-0 z-[63] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-[min(760px,100%)] flex-col overflow-hidden rounded-2xl border border-sky-400/30 bg-gradient-to-b from-[#04121e]/95 to-[#02090f]/95 shadow-[0_0_50px_rgba(56,189,248,0.16)]">
        <div className="flex items-center gap-2 border-b border-sky-400/15 px-4 py-3">
          <Rocket className="h-4 w-4 text-sky-300" />
          <span className="text-sm font-semibold tracking-[0.2em] text-sky-100">АВТОПИЛОТ · ПРОГОН ПО ШАГАМ</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-200/60" />}
          {steps.length > 0 && (
            <span className="text-[10px] uppercase tracking-widest text-sky-200/50">
              {doneN}/{steps.length} сделано{gateN ? ` · ${gateN} на тебе` : ''}
            </span>
          )}
          <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-lg border border-white/10 bg-black/40 p-2.5 text-[12px] text-white/85 outline-none focus:border-sky-400/40"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy || !goal.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-sky-500/25 px-3.5 py-2 text-sm font-semibold text-sky-50 hover:bg-sky-400/35 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {phase === 'planning' ? 'Раскладываю на шаги…' : phase === 'running' ? 'Выполняю шаги…' : 'Запустить прогон'}
            </button>
            {busy && (
              <button type="button" onClick={() => (stopRef.current = true)} className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-2 text-[11px] text-white/60 hover:bg-white/10">
                <Square className="h-3 w-3" /> Стоп
              </button>
            )}
          </div>
          <p className="text-[10px] leading-relaxed text-white/40">
            MAX выполняет шаги <b className="text-sky-200/70">auto</b> сам (подготовка). Шаги <b className="text-amber-200/70">🙋 нужен ты</b> (SEND / CALL / PAYMENT)
            он готовит до кнопки и оставляет тебе — действие в мире жмёшь ты.
          </p>

          {err && <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">{err}</div>}

          {/* Вертикальный конвейер шагов */}
          {steps.length > 0 && (
            <div className="relative space-y-2 pl-2">
              {steps.map((s, i) => {
                const gate = s.kind === 'gate';
                const border = gate ? 'border-amber-400/25' : s.status === 'done' ? 'border-emerald-400/25' : s.status === 'running' ? 'border-sky-400/40' : 'border-white/10';
                const bg = gate ? 'bg-amber-400/[0.05]' : s.status === 'done' ? 'bg-emerald-400/[0.04]' : s.status === 'running' ? 'bg-sky-400/[0.06]' : 'bg-white/[0.02]';
                return (
                  <div key={i} className={`rounded-xl border ${border} ${bg} p-3`}>
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0">
                        {gate ? (
                          <Hand className="h-4 w-4 text-amber-300" />
                        ) : s.status === 'done' ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : s.status === 'running' ? (
                          <Loader2 className="h-4 w-4 animate-spin text-sky-300" />
                        ) : (
                          <CircleDot className="h-4 w-4 text-white/30" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-white/35">#{s.n}</span>
                          <span className={`text-[12px] font-semibold ${gate ? 'text-amber-100' : 'text-white/90'}`}>
                            {gate ? '🙋 ' : ''}
                            {s.action}
                          </span>
                          <span className="ml-auto text-[9px] uppercase tracking-widest text-white/30">{gate ? 'нужен ты' : s.status}</span>
                        </div>
                        {s.note && !s.output && <div className="mt-0.5 text-[10px] text-white/40">{s.note}</div>}
                        {s.output && (
                          <div className={`mt-1.5 whitespace-pre-wrap rounded-lg p-2 text-[11px] leading-snug ${gate ? 'bg-amber-500/[0.08] text-amber-100/90' : 'bg-black/30 text-white/85'}`}>
                            {s.output}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
