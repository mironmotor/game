'use client';

import { useEffect, useState } from 'react';
import { introspectMax, type Introspection } from '@/lib/introspect';
import './mind.css';

// САМОСОЗНАНИЕ — Макс смотрит на своё реальное состояние (память, синапсы,
// недавние действия) и сам решает, что делать дальше. Не сознание —
// грунтованное рассуждение над фактами о себе через ядро (MiniMax/Gemma).

export default function SelfAwareness() {
  const [intro, setIntro] = useState<Introspection | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  async function reflect() {
    setBusy(true);
    setError('');
    const r = await introspectMax();
    if (r) setIntro(r);
    else setError('Ядро Max недоступно. Проверь, что мост запущен на M3.');
    setBusy(false);
  }

  useEffect(() => {
    reflect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mind-wrap">
      <header className="mind-head">
        <div className="mind-eye" data-busy={busy}>
          <span className="mind-pupil" />
        </div>
        <h1>САМОСОЗНАНИЕ</h1>
        <p>Макс смотрит на себя и решает, что делать</p>
      </header>

      {intro && (
        <>
          <div className="mind-state">
            <div className="mind-metric"><span>{intro.state.memories}</span>память</div>
            <div className="mind-metric"><span>{intro.state.synapses_total}</span>синапсы</div>
            <div className="mind-metric mood"><span>{intro.mood}</span>тонус</div>
          </div>

          <div className="mind-assessment">
            <span className="mind-label">Макс о себе</span>
            <p>{intro.assessment}</p>
          </div>

          {intro.focus && (
            <div className="mind-focus">
              <span className="mind-label">Фокус сейчас</span>
              <p>{intro.focus}</p>
            </div>
          )}

          <div className="mind-prios">
            <span className="mind-label">Что делать дальше</span>
            {intro.priorities.map((p, i) => (
              <div className="mind-prio" key={i}>
                <div className="mind-prio-n">{i + 1}</div>
                <div className="mind-prio-body">
                  <div className="mind-prio-action">{p.action}</div>
                  {p.why && <div className="mind-prio-why">{p.why}</div>}
                </div>
              </div>
            ))}
          </div>

          {intro.state.recent_actions.length > 0 && (
            <div className="mind-recent">
              <span className="mind-label">Чем занимался</span>
              <div className="mind-tags">
                {intro.state.recent_actions.slice(0, 8).map((a, i) => (
                  <span className="mind-tag" key={i}>{a}</span>
                ))}
              </div>
            </div>
          )}

          <div className="mind-src">
            {intro.source.startsWith('llm') ? 'мозг: ' + intro.source.slice(4) : 'ядро (детерминированно)'}
          </div>
        </>
      )}

      {error && <div className="mind-error">{error}</div>}

      <button className="mind-btn" onClick={reflect} disabled={busy}>
        {busy ? 'МАКС ДУМАЕТ…' : 'ОСОЗНАТЬ ЗАНОВО'}
      </button>
    </div>
  );
}
