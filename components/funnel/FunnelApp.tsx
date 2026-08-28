'use client';

import { useState } from 'react';
import { generateSparks, synthesizeBigIdea, generateViaMax, type FunnelSeed, type BigIdea } from '@/lib/funnel';
import './funnel.css';

type Phase = 'idle' | 'sparking' | 'synthesizing' | 'done' | 'error';

const EMPTY_SEED: FunnelSeed = { domain: '', audience: '', trend: '', twist: '' };

const FIELDS: { key: keyof FunnelSeed; label: string; placeholder: string }[] = [
  { key: 'domain', label: 'Сфера', placeholder: 'финтех, образование, спорт…' },
  { key: 'audience', label: 'Для кого', placeholder: 'студенты, фрилансеры, родители…' },
  { key: 'trend', label: 'Тренд / технология', placeholder: 'ИИ-агенты, AR, web3…' },
  { key: 'twist', label: 'Поворот / ограничение', placeholder: 'без приложения, офлайн, за 1$…' },
];

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] uppercase tracking-wider text-emerald-300/70 mb-1">
        <span>{label}</span>
        <span>{value}/10</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-[#00ff88] transition-[width] duration-700"
          style={{ width: `${value * 10}%` }}
        />
      </div>
    </div>
  );
}

function IdeaField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-emerald-300/60 mb-1">{label}</div>
      <p className="text-sm leading-relaxed text-emerald-50/90">{value}</p>
    </div>
  );
}

export default function FunnelApp() {
  const [seed, setSeed] = useState<FunnelSeed>(EMPTY_SEED);
  const [phase, setPhase] = useState<Phase>('idle');
  const [sparks, setSparks] = useState<string[]>([]);
  const [idea, setIdea] = useState<BigIdea | null>(null);
  const [error, setError] = useState<string>('');

  const busy = phase === 'sparking' || phase === 'synthesizing';

  async function run() {
    setError('');
    setIdea(null);
    setSparks([]);
    try {
      setPhase('sparking');

      // Сначала — ядро Max (мост): ключ в браузере не нужен.
      const viaMax = await generateViaMax(seed);
      if (viaMax) {
        setSparks(viaMax.sparks);
        setPhase('synthesizing');
        await new Promise((r) => setTimeout(r, 600)); // дать искрам упасть
        setIdea(viaMax.idea);
        setPhase('done');
        return;
      }

      // Запасной путь: прямой вызов LLM из браузера (нужен NEXT_PUBLIC-ключ).
      const newSparks = await generateSparks(seed);
      setSparks(newSparks);

      setPhase('synthesizing');
      const bigIdea = await synthesizeBigIdea(seed, newSparks);
      setIdea(bigIdea);
      setPhase('done');
    } catch (e: unknown) {
      // Ядро тут не диагностируется: сюда приводит и упавший браузерный
      // фолбэк. Про MAX17_BRIDGE_URL говорить нечего — на mir.care ядро стоит
      // рядом с сайтом, а не за мостом.
      setError(
        (e instanceof Error ? e.message : 'Что-то пошло не так') +
          ' · Идея не собралась: ядро не ответило по этому запросу и браузерного ключа (NEXT_PUBLIC_GEMINI_API_KEY) нет.',
      );
      setPhase('error');
    }
  }

  return (
    <div className="funnel-wrap px-4 py-10 sm:py-14">
      <div className="max-w-3xl mx-auto">
        <header className="text-center mb-10">
          <h1 className="funnel-title text-3xl sm:text-4xl font-bold text-[#00ff88]">ВОРОНКА</h1>
          <p className="mt-3 text-sm text-emerald-100/60 max-w-md mx-auto">
            Засыпь сырьё сверху — воронка перемелет искры и выдаст одну Big Idea внизу.
          </p>
        </header>

        {/* TOP — inputs */}
        <section
          className={`funnel-stage ${phase === 'idle' || phase === 'sparking' ? 'active' : 'idle'} rounded-2xl p-5 sm:p-6`}
          style={{ maxWidth: 640 }}
        >
          <div className="grid sm:grid-cols-2 gap-4">
            {FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="text-[11px] uppercase tracking-wider text-emerald-300/70">{f.label}</span>
                <input
                  className="funnel-input mt-1 w-full rounded-lg px-3 py-2 text-sm"
                  value={seed[f.key]}
                  onChange={(e) => setSeed((s) => ({ ...s, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  disabled={busy}
                />
              </label>
            ))}
          </div>
          <button
            onClick={run}
            disabled={busy}
            className="mt-5 w-full rounded-lg bg-[#00ff88] py-3 font-semibold text-[#06210f] tracking-wide transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'ВОРОНКА РАБОТАЕТ…' : sparks.length ? 'ЕЩЁ РАЗ' : 'ЗАПУСТИТЬ ВОРОНКУ'}
          </button>
          <p className="mt-2 text-center text-[11px] text-emerald-100/40">
            Все поля можно оставить пустыми — тогда будет полная свобода.
          </p>
        </section>

        {/* MIDDLE — sparks (narrowing) */}
        {(phase === 'sparking' || sparks.length > 0) && (
          <section className={`funnel-stage ${phase === 'sparking' ? 'active' : 'idle'} mt-4 rounded-xl p-5`} style={{ maxWidth: 520 }}>
            <div className="text-[11px] uppercase tracking-wider text-emerald-300/60 mb-3 text-center">
              {phase === 'sparking' ? 'Генерирую искры…' : 'Сырые искры'}
            </div>
            {phase === 'sparking' && sparks.length === 0 ? (
              <div className="flex justify-center gap-2 py-3">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="funnel-pulse h-2 w-2 rounded-full bg-[#00ff88]"
                    style={{ animationDelay: `${i * 0.18}s` }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                {sparks.map((s, i) => (
                  <span
                    key={i}
                    className="spark-chip rounded-full border border-emerald-400/20 bg-emerald-400/5 px-3 py-1 text-xs text-emerald-100/80"
                    style={{ animationDelay: `${i * 0.05}s` }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

        {/* synthesizing indicator */}
        {phase === 'synthesizing' && (
          <div className="mt-4 text-center text-sm text-emerald-300/70">
            <span className="funnel-pulse inline-block mr-2 h-2 w-2 rounded-full bg-[#00ff88] align-middle" />
            Сжимаю искры в одну Big Idea…
          </div>
        )}

        {/* BOTTOM — the big idea */}
        {idea && (
          <section className="idea-card mt-5 rounded-2xl border border-[#00ff88]/40 bg-gradient-to-b from-[#00ff88]/[0.07] to-transparent p-6 sm:p-8" style={{ maxWidth: 420, margin: '20px auto 0', boxShadow: '0 0 40px rgba(0,255,136,0.18)' }}>
            <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-300/60 text-center mb-2">Big Idea</div>
            <h2 className="funnel-title text-center text-2xl font-bold text-[#00ff88]">{idea.name}</h2>
            <p className="mt-2 text-center text-base text-emerald-50">{idea.tagline}</p>

            <div className="mt-6 space-y-4">
              <IdeaField label="Проблема" value={idea.problem} />
              <IdeaField label="Решение" value={idea.solution} />
              <IdeaField label="Для кого" value={idea.whoFor} />
              <IdeaField label="Почему сейчас" value={idea.whyNow} />
              <IdeaField label="Нечестное преимущество" value={idea.magic} />
              <IdeaField label="Первый шаг" value={idea.firstStep} />
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4">
              <ScoreBar label="Дерзость" value={idea.boldness} />
              <ScoreBar label="Масштаб" value={idea.scale} />
            </div>
          </section>
        )}

        {error && (
          <div className="mt-5 mx-auto max-w-md rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-center text-sm text-red-200">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
