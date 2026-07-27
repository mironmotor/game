'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  ExternalLink,
  FileWarning,
  Flag,
  GraduationCap,
  LockKeyhole,
  Play,
  Radio,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import { CYBER_LAB_BOUNDARY, CYBER_LAB_MODULES, type CyberLabModuleId } from '@/lib/security-academy';
import { useMirCoin } from '@/hooks/use-mircoin';
import { appBasePath } from '@/lib/base-path';
import { reachGoal } from '@/lib/metrika';

type LabProgress = {
  acknowledged: boolean;
  completed: CyberLabModuleId[];
  quizPassed: boolean;
};

type TutorReply = {
  text: string;
  moduleId?: CyberLabModuleId;
};

const PROGRESS_KEY = 'game.cyber-lab.progress.v1';
// Аккаунт-стор (респектит basePath: '/game' локально, '' на сервере).
const PROGRESS_API = `${appBasePath}/api/cyberlab-progress`;
const DEFAULT_PROGRESS: LabProgress = { acknowledged: false, completed: [], quizPassed: false };

// Слияние локального и аккаунт-прогресса: пройденное объединяем, флаги — ИЛИ.
// Так прогресс с любого устройства не теряется.
function mergeProgress(base: LabProgress, incoming: Partial<LabProgress> | null | undefined): LabProgress {
  if (!incoming) return base;
  const completed = new Set<CyberLabModuleId>(base.completed);
  if (Array.isArray(incoming.completed)) {
    for (const id of incoming.completed) {
      if (CYBER_LAB_MODULES.some((module) => module.id === id)) completed.add(id as CyberLabModuleId);
    }
  }
  return {
    acknowledged: base.acknowledged || incoming.acknowledged === true,
    completed: Array.from(completed),
    quizPassed: base.quizPassed || incoming.quizPassed === true,
  };
}

function readProgress(): LabProgress {
  try {
    const stored = window.localStorage.getItem(PROGRESS_KEY);
    if (!stored) return DEFAULT_PROGRESS;
    const parsed = JSON.parse(stored) as Partial<LabProgress>;
    return {
      acknowledged: parsed.acknowledged === true,
      completed: Array.isArray(parsed.completed)
        ? parsed.completed.filter((id): id is CyberLabModuleId => CYBER_LAB_MODULES.some((module) => module.id === id))
        : [],
      quizPassed: parsed.quizPassed === true,
    };
  } catch {
    return DEFAULT_PROGRESS;
  }
}

export default function CyberLab() {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<CyberLabModuleId>('scope');
  const [progress, setProgress] = useState<LabProgress>(DEFAULT_PROGRESS);
  const [hydrated, setHydrated] = useState(false);
  const [quizAnswer, setQuizAnswer] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [tutorReply, setTutorReply] = useState<TutorReply | null>(null);
  const [canSync, setCanSync] = useState(false);
  const { earn } = useMirCoin();

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- external client-only sources: localStorage + account store. */
    setProgress(readProgress());
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    // Залогинен? Подтянуть прогресс из аккаунта и слить с локальным.
    // 401 (аноним / вход не настроен) — тихо остаёмся на localStorage.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(PROGRESS_API, { cache: 'no-store' });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { progress?: Partial<LabProgress> | null };
        setCanSync(true);
        if (data?.progress) setProgress((current) => mergeProgress(current, data.progress));
      } catch {
        /* оффлайн — остаёмся локально */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    window.dispatchEvent(new CustomEvent('game:local-state-change'));
    if (!canSync) return;
    // Залогинен — зеркалим прогресс в аккаунт (кросс-девайс).
    const controller = new AbortController();
    void fetch(PROGRESS_API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress }),
      signal: controller.signal,
    }).catch(() => {});
    return () => controller.abort();
  }, [hydrated, progress, canSync]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const moduleId = (event as CustomEvent<{ moduleId?: CyberLabModuleId }>).detail?.moduleId;
      if (moduleId && CYBER_LAB_MODULES.some((module) => module.id === moduleId)) setActiveId(moduleId);
      setOpen(true);
      reachGoal('cyberlab_open'); // цель Метрики: интерес к обучению
    };
    const onToggle = () =>
      setOpen((value) => {
        if (!value) reachGoal('cyberlab_open');
        return !value;
      });
    const onReply = (event: Event) => {
      const detail = (event as CustomEvent<TutorReply>).detail;
      if (!detail?.text) return;
      setTutorReply(detail);
      setAsking(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('cyberlab:open', onOpen as EventListener);
    window.addEventListener('cyberlab:toggle', onToggle);
    window.addEventListener('cyberlab:tutor-response', onReply as EventListener);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('cyberlab:open', onOpen as EventListener);
      window.removeEventListener('cyberlab:toggle', onToggle);
      window.removeEventListener('cyberlab:tutor-response', onReply as EventListener);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const active = useMemo(
    () => CYBER_LAB_MODULES.find((module) => module.id === activeId) ?? CYBER_LAB_MODULES[0],
    [activeId],
  );
  const completed = progress.completed.includes(active.id);
  const completionPercent = Math.round(((progress.completed.length + (progress.quizPassed ? 1 : 0)) / (CYBER_LAB_MODULES.length + 1)) * 100);

  const updateProgress = (next: LabProgress) => setProgress(next);

  const confirmScope = () => {
    if (progress.acknowledged) return;
    updateProgress({ ...progress, acknowledged: true });
    earn(20, 'Cyber Lab: зафиксирован legal scope');
  };

  const completeModule = () => {
    if (!progress.acknowledged || completed) return;
    updateProgress({ ...progress, completed: [...progress.completed, active.id] });
    earn(65, `Cyber Lab: ${active.title}`);
  };

  const answerQuiz = (answer: string) => {
    setQuizAnswer(answer);
    if (answer === 'scope' && !progress.quizPassed) {
      updateProgress({ ...progress, quizPassed: true });
      earn(45, 'Cyber Lab: safe-scope check');
    }
  };

  const askMax = (starter = false) => {
    if (!progress.acknowledged || asking) return;
    const prompt = (starter ? active.tutorStarter : question).trim();
    if (!prompt) return;
    setQuestion('');
    setAsking(true);
    setTutorReply(null);
    window.dispatchEvent(
      new CustomEvent('cyberlab:ask-max', {
        detail: {
          moduleId: active.id,
          message: prompt,
        },
      }),
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="cyber-lab-title"
        className="flex max-h-[min(860px,calc(100vh-24px))] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-cyan-300/30 bg-[#070b12] text-white shadow-[0_0_60px_rgba(0,242,255,0.13)]"
      >
        <header className="flex items-center gap-3 border-b border-cyan-300/20 bg-[#08111a] px-4 py-3 sm:px-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-cyan-300/35 bg-cyan-300/10 text-cyan-200">
            <ShieldCheck size={20} />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-cyan-200/70">GAME Ultra / Ethical Security</p>
            <h2 id="cyber-lab-title" className="text-base font-semibold tracking-wide sm:text-lg">CYBER LAB</h2>
          </div>
          <div className="ml-auto hidden min-w-[132px] sm:block">
            <div className="mb-1 flex justify-between font-mono text-[9px] uppercase tracking-[0.15em] text-cyan-100/60">
              <span>Progress</span><span>{completionPercent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-white/10">
              <div className="h-full bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.9)]" style={{ width: `${completionPercent}%` }} />
            </div>
          </div>
          <span
            className={`ml-3 hidden shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-[0.15em] sm:inline-flex ${canSync ? 'text-emerald-300/85' : 'text-white/35'}`}
            title={canSync ? 'Прогресс сохраняется в твой аккаунт' : 'Локально в этом браузере — войди, чтобы синхронизировать между устройствами'}
          >
            {canSync ? '☁ аккаунт' : '· локально'}
          </span>
          <button type="button" onClick={() => setOpen(false)} className="ml-2 grid h-8 w-8 place-items-center rounded-md text-white/60 transition hover:bg-white/10 hover:text-white" aria-label="Закрыть Cyber Lab" title="Закрыть">
            <X size={18} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="border-b border-cyan-300/15 bg-[#060a10] p-2 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <div className="grid grid-cols-4 gap-1 lg:block lg:space-y-1">
              {CYBER_LAB_MODULES.map((module) => {
                const done = progress.completed.includes(module.id);
                const selected = active.id === module.id;
                return (
                  <button
                    key={module.id}
                    type="button"
                    onClick={() => { setActiveId(module.id); setQuizAnswer(null); setTutorReply(null); }}
                    className={`flex min-h-11 items-center gap-2 rounded-md border px-2 py-2 text-left transition lg:w-full ${selected ? 'border-cyan-300/55 bg-cyan-300/10 text-cyan-50' : 'border-transparent text-white/55 hover:border-white/10 hover:bg-white/[0.04] hover:text-white/85'}`}
                    title={module.title}
                  >
                    <span className={`font-mono text-[10px] ${done ? 'text-emerald-300' : 'text-cyan-200/60'}`}>{done ? 'OK' : module.number}</span>
                    <span className="hidden min-w-0 text-xs font-medium lg:block">{module.shortTitle}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
            {!progress.acknowledged ? (
              <div className="mb-5 border border-amber-300/35 bg-amber-300/[0.07] p-4">
                <div className="flex items-start gap-3">
                  <FileWarning className="mt-0.5 shrink-0 text-amber-200" size={20} />
                  <div>
                    <h3 className="font-semibold text-amber-100">Сначала границы</h3>
                    <p className="mt-1 text-sm leading-relaxed text-amber-50/75">{CYBER_LAB_BOUNDARY}</p>
                    <button type="button" onClick={confirmScope} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border border-amber-300/45 bg-amber-300/10 px-3 text-xs font-semibold text-amber-50 transition hover:bg-amber-300/20">
                      <ShieldCheck size={15} /> Я работаю только в разрешённом scope
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] tracking-[0.22em] text-cyan-200/70">MODULE {active.number}</span>
              {completed ? <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><Check size={14} /> завершено</span> : null}
            </div>
            <h3 className="mt-1 text-2xl font-semibold tracking-wide text-white sm:text-3xl">{active.title}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/70">{active.objective}</p>

            <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="border-y border-white/10 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-200/65">Практика в безопасной среде</p>
                <ol className="mt-3 space-y-3">
                  {active.drills.map((drill, index) => (
                    <li key={drill} className="flex gap-3 text-sm leading-relaxed text-white/78">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-cyan-300/35 font-mono text-[10px] text-cyan-200">{index + 1}</span>
                      <span>{drill}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={completeModule} disabled={!progress.acknowledged || completed} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-cyan-300/15 px-3 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/25 disabled:cursor-not-allowed disabled:opacity-35">
                    {completed ? <Check size={15} /> : <Flag size={15} />}
                    {completed ? 'Модуль отмечен' : 'Зафиксировать практику +65'}
                  </button>
                  {active.resource ? (
                    <a href={active.resource.href} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-white/15 px-3 text-xs text-white/75 transition hover:border-cyan-300/45 hover:text-cyan-100">
                      <ExternalLink size={14} /> {active.resource.label}
                    </a>
                  ) : null}
                </div>
              </div>

              <aside className="border border-violet-300/20 bg-violet-300/[0.045] p-4">
                <div className="flex items-center gap-2 text-violet-100"><LockKeyhole size={17} /><span className="text-xs font-semibold uppercase tracking-[0.15em]">Safe check</span></div>
                <p className="mt-3 text-sm leading-relaxed text-white/70">Перед любым тестом что должно быть подтверждено первым?</p>
                <div className="mt-3 space-y-2">
                  {[
                    ['scope', 'Владелец, явное разрешение и опубликованный scope'],
                    ['tool', 'Самый быстрый сканер и максимальное число запросов'],
                    ['access', 'Способ обойти вход без следов'],
                  ].map(([value, label]) => (
                    <button key={value} type="button" onClick={() => answerQuiz(value)} disabled={!progress.acknowledged} className={`w-full rounded-md border px-3 py-2 text-left text-xs leading-snug transition disabled:cursor-not-allowed disabled:opacity-35 ${quizAnswer === value ? value === 'scope' ? 'border-emerald-300/60 bg-emerald-300/10 text-emerald-100' : 'border-rose-300/60 bg-rose-300/10 text-rose-100' : 'border-white/10 text-white/65 hover:border-violet-300/45'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {progress.quizPassed ? <p className="mt-3 text-xs text-emerald-300">Scope подтверждён. Награда +45 MirCoin.</p> : quizAnswer && quizAnswer !== 'scope' ? <p className="mt-3 text-xs text-rose-200">Нет: инструменты выбирают после того, как право на тест уже доказано.</p> : null}
              </aside>
            </div>

            <div className="mt-5 border border-cyan-300/20 bg-cyan-300/[0.035] p-4">
              <div className="flex items-center gap-2"><Radio size={17} className="text-cyan-200" /><h4 className="text-sm font-semibold">MAX / наставник Cyber Lab</h4></div>
              <p className="mt-1 text-xs leading-relaxed text-white/55">MAX объясняет текущий модуль и переводит любой рискованный запрос в безопасный сценарий лаборатории.</p>
              <div className="mt-3 flex gap-2">
                <input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') askMax(); }} disabled={!progress.acknowledged || asking} placeholder="Спроси MAX о текущем модуле…" className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/25 px-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-300/55 disabled:opacity-40" />
                <button type="button" onClick={() => askMax()} disabled={!progress.acknowledged || asking || !question.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-cyan-300/15 text-cyan-100 transition hover:bg-cyan-300/25 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Спросить MAX" title="Спросить MAX">
                  {asking ? <Terminal size={17} className="animate-pulse" /> : <ArrowUpRight size={17} />}
                </button>
              </div>
              <button type="button" onClick={() => askMax(true)} disabled={!progress.acknowledged || asking} className="mt-2 inline-flex items-center gap-1 text-xs text-cyan-200/80 transition hover:text-cyan-100 disabled:opacity-35">
                <Play size={12} fill="currentColor" /> Запустить вводный разбор <ChevronRight size={13} />
              </button>
              {tutorReply ? <p className="mt-3 border-l-2 border-cyan-300/70 pl-3 text-sm leading-relaxed text-cyan-50/85">{tutorReply.text}</p> : null}
            </div>

            <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs text-white/45">
              <span className="inline-flex items-center gap-2"><GraduationCap size={15} className="text-cyan-200/75" /> {progress.completed.length}/{CYBER_LAB_MODULES.length} модулей завершено</span>
              <a href="https://www.bugcrowd.com/bug-bounty-list/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan-200/75 transition hover:text-cyan-100">Официальные public programs <ExternalLink size={13} /></a>
            </footer>
          </div>
        </div>
      </section>
    </div>
  );
}
