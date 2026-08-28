'use client';

import { useEffect, useState } from 'react';
import { generateViaMax, generateSparks, synthesizeBigIdea, type FunnelSeed, type BigIdea } from '@/lib/funnel';
import { useTelegram, useMainButton } from './useTelegram';
import './tg.css';

type Phase = 'idle' | 'working' | 'done' | 'error';

const EMPTY: FunnelSeed = { domain: '', audience: '', trend: '', twist: '' };

const FIELDS: { key: keyof FunnelSeed; label: string; ph: string }[] = [
  { key: 'domain', label: 'Сфера', ph: 'финтех, спорт, музыка…' },
  { key: 'audience', label: 'Для кого', ph: 'студенты, фрилансеры…' },
  { key: 'trend', label: 'Тренд', ph: 'ИИ-агенты, AR, web3…' },
  { key: 'twist', label: 'Поворот', ph: 'офлайн, за 1$, без апп…' },
];

export default function TgBigIdea() {
  const { webApp, ready, inTelegram, user, haptic } = useTelegram();
  const [seed, setSeed] = useState<FunnelSeed>(EMPTY);
  const [phase, setPhase] = useState<Phase>('idle');
  const [sparks, setSparks] = useState<string[]>([]);
  const [idea, setIdea] = useState<BigIdea | null>(null);
  const [source, setSource] = useState('');
  const [error, setError] = useState('');

  const busy = phase === 'working';

  async function run() {
    if (busy) return;
    haptic('medium');
    setError('');
    setIdea(null);
    setSparks([]);
    setPhase('working');
    try {
      // Ядро Max (Max Ultra на M3) — первым: ключ в браузере не нужен.
      const viaMax = await generateViaMax(seed);
      if (viaMax) {
        setSparks(viaMax.sparks);
        setSource(viaMax.source);
        setIdea(viaMax.idea);
        setPhase('done');
        haptic('success');
        return;
      }
      // Фолбэк: прямой LLM из браузера (если задан NEXT_PUBLIC-ключ).
      const sp = await generateSparks(seed);
      setSparks(sp);
      const big = await synthesizeBigIdea(seed, sp);
      setSource('browser-llm');
      setIdea(big);
      setPhase('done');
      haptic('success');
    } catch (e) {
      // Сюда попадаем, когда упал и запасной браузерный путь. Утверждать при
      // этом, что ядро стоит (да ещё на M3, где его нет), нельзя — мы знаем
      // только то, что идея не собралась.
      setError((e instanceof Error ? e.message : 'Ошибка') + ' · Идея не собралась. Попробуй ещё раз.');
      setPhase('error');
      haptic('error');
    }
  }

  // Нативная кнопка Telegram внизу окна
  useMainButton(webApp, busy ? 'ВОРОНКА РАБОТАЕТ…' : idea ? 'ЕЩЁ ИДЕЮ' : 'СОЗДАТЬ BIG IDEA', run, {
    active: !busy,
    progress: busy,
  });

  // прячем результат при новом вводе не нужно — оставляем историю на экране

  if (!ready) {
    return (
      <div className="tg-wrap tg-center">
        <div className="tg-logo">△∞</div>
        <div className="tg-spinner" />
      </div>
    );
  }

  return (
    <div className="tg-wrap">
      <header className="tg-head">
        <div className="tg-logo">△∞</div>
        <h1>BIG IDEA</h1>
        <p>
          {user?.first_name ? `${user.first_name}, засыпь` : 'Засыпь'} сырьё — ядро Max перемелет
          в одну дерзкую идею.
        </p>
      </header>

      <section className="tg-form">
        {FIELDS.map((f) => (
          <label key={f.key} className="tg-field">
            <span>{f.label}</span>
            <input
              value={seed[f.key]}
              onChange={(e) => setSeed((s) => ({ ...s, [f.key]: e.target.value }))}
              placeholder={f.ph}
              disabled={busy}
            />
          </label>
        ))}
        <p className="tg-hint">Все поля можно оставить пустыми — тогда полная свобода.</p>

        {/* Фолбэк-кнопка для теста вне Telegram (в Telegram снизу нативная) */}
        {!inTelegram && (
          <button className="tg-btn" onClick={run} disabled={busy}>
            {busy ? 'ВОРОНКА РАБОТАЕТ…' : idea ? 'ЕЩЁ ИДЕЮ' : 'СОЗДАТЬ BIG IDEA'}
          </button>
        )}
      </section>

      {sparks.length > 0 && (
        <section className="tg-sparks">
          {sparks.map((s, i) => (
            <span key={i} className="tg-spark" style={{ animationDelay: `${i * 0.04}s` }}>
              {s}
            </span>
          ))}
        </section>
      )}

      {idea && (
        <section className="tg-idea">
          <div className="tg-idea-label">Big Idea</div>
          <h2>{idea.name}</h2>
          <p className="tg-tagline">{idea.tagline}</p>

          <IdeaRow label="Проблема" v={idea.problem} />
          <IdeaRow label="Решение" v={idea.solution} />
          <IdeaRow label="Для кого" v={idea.whoFor} />
          <IdeaRow label="Почему сейчас" v={idea.whyNow} />
          <IdeaRow label="Нечестное преимущество" v={idea.magic} />
          <IdeaRow label="Первый шаг" v={idea.firstStep} />

          <div className="tg-scores">
            <Score label="Дерзость" v={idea.boldness} />
            <Score label="Масштаб" v={idea.scale} />
          </div>

          <div className="tg-source">
            {source.startsWith('llm')
              ? `мозг Max: ${source.slice(4)}`
              : source === 'deterministic'
                ? 'ядро Max (детерминированно)'
                : source === 'browser-llm'
                  ? 'браузерный LLM'
                  : `источник: ${source}`}
          </div>
        </section>
      )}

      {error && <div className="tg-error">{error}</div>}
    </div>
  );
}

function IdeaRow({ label, v }: { label: string; v: string }) {
  if (!v) return null;
  return (
    <div className="tg-row">
      <div className="tg-row-label">{label}</div>
      <p>{v}</p>
    </div>
  );
}

function Score({ label, v }: { label: string; v: number }) {
  return (
    <div className="tg-score">
      <div className="tg-score-top">
        <span>{label}</span>
        <span>{v}/10</span>
      </div>
      <div className="tg-score-bar">
        <div style={{ width: `${v * 10}%` }} />
      </div>
    </div>
  );
}
