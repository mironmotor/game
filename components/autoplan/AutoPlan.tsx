'use client';

import { useState } from 'react';
import Link from 'next/link';
import { sendMax17Event, type Max17Plan, type Max17PlanTask, type Max17Synapses } from '@/lib/max17-client';
import './autoplan.css';

const MGR_META: Record<string, { label: string; color: string }> = {
  'MGR-3': { label: 'Прорыв', color: '#ff5d8f' },
  'MGR-2': { label: 'Фокус', color: '#ffb14e' },
  'MGR-1': { label: 'Логистика', color: '#00ffc8' },
};

function TaskCard({ t }: { t: Max17PlanTask }) {
  const meta = MGR_META[t.mgr] ?? { label: t.mgr, color: '#00ffc8' };
  return (
    <div className="ap-task" style={{ borderColor: meta.color + '55' }}>
      <div className="ap-task-head">
        <span className="ap-mgr" style={{ color: meta.color, borderColor: meta.color + '66' }}>
          {t.mgr} · {meta.label}
        </span>
        <span className="ap-time">{t.scheduledTime}</span>
        <span className="ap-xp">+{t.xp} XP</span>
      </div>
      <div className="ap-desc">{t.desc}</div>
      {t.reality_check && <div className="ap-rc">↳ {t.reality_check}</div>}
    </div>
  );
}

export default function AutoPlan() {
  const [goal, setGoal] = useState('');
  const [horizon, setHorizon] = useState(0);
  const [plan, setPlan] = useState<Max17Plan | null>(null);
  const [meta, setMeta] = useState<{ confidence: number; adaptation: string } | null>(null);
  const [synapses, setSynapses] = useState<Max17Synapses | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    if (!goal.trim() || busy) return;
    setBusy(true);
    setError('');
    setPlan(null);
    setMeta(null);
    setSynapses(null);
    try {
      const res = await sendMax17Event({ type: 'auto_plan', goal: goal.trim(), horizon_days: horizon });
      if (res.plan && res.plan.ok) {
        setPlan(res.plan);
        setMeta({ confidence: res.confidence, adaptation: res.next_adaptation });
        setSynapses(res.synapses ?? null);
      } else {
        setError(res.plan?.summary || res.error || 'Ядро Max не собрало план.');
      }
    } catch (e: unknown) {
      setError(
        (e instanceof Error ? e.message : 'Ошибка') +
          ' · Автоплан работает на Python-ядре Max через /api/max17 — нужен `npm run dev` (не статический деплой).',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ap-screen">
      <header className="ap-bar">
        <span className="ap-logo">△∞</span>
        <div>
          <div className="ap-title">АВТОПЛАН · ЯДРО MAX</div>
          <div className="ap-sub">детерминированный планировщик mark17 · без Gemini</div>
        </div>
      </header>

      <div className="ap-body">
        <div className="ap-input-row">
          <input
            className="ap-input"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            placeholder="Назови цель — например: запустить продукт и получить первых платящих клиентов"
            disabled={busy}
          />
          <select className="ap-select" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} disabled={busy}>
            <option value={0}>сегодня</option>
            <option value={1}>+1 день</option>
            <option value={3}>+3 дня</option>
            <option value={7}>неделя</option>
          </select>
          <button className="ap-go" onClick={run} disabled={busy || !goal.trim()}>
            {busy ? 'СОБИРАЮ…' : 'СОБРАТЬ ПЛАН'}
          </button>
        </div>

        {error && <div className="ap-error">{error}</div>}

        {plan && (
          <div className="ap-result">
            <div className="ap-summary">
              <div className="ap-summary-goal">«{plan.goal}»</div>
              <div className="ap-summary-line">
                <span><b>{plan.total_xp}</b> XP</span>
                <span>домен: <b>{plan.domain}</b></span>
                <span>уверенность ядра: <b>{Math.round((meta?.confidence ?? 0) * 100)}%</b></span>
              </div>
              {plan.first_move && (
                <div className="ap-first">Первый шаг: <b>{plan.first_move}</b></div>
              )}
            </div>

            <div className="ap-tasks">
              {(plan.tasks ?? []).map((t) => <TaskCard key={t.id} t={t} />)}
            </div>

            {synapses && (synapses.updated ?? 0) > 0 && (
              <div className="ap-brain">
                <div className="ap-brain-head">
                  🧠 Мозг Max вырос: <b>+{synapses.updated}</b> синапсов
                </div>
                {(synapses.top ?? []).slice(0, 3).map((s) => (
                  <div className="ap-brain-syn" key={s.id}>
                    <span className="ap-brain-w">{(s.weight ?? 0).toFixed(2)}</span>
                    <span className="ap-brain-rel">{s.source_type} → {s.target_type}</span>
                    <span className="ap-brain-sum">{s.summary}</span>
                  </div>
                ))}
                <Link href="/maxgraph" className="ap-brain-link">Смотреть весь синапс-граф →</Link>
              </div>
            )}

            {plan.principle && <div className="ap-principle">{plan.principle}</div>}
          </div>
        )}

        {!plan && !error && (
          <div className="ap-hint">
            Ядро Max разложит цель на 1 прорыв (MGR-3), 2 фокус-блока (MGR-2) и 3 шага логистики (MGR-1),
            к каждому — «контакт с реальностью». Детерминированно, без ИИ.
          </div>
        )}
      </div>
    </div>
  );
}
