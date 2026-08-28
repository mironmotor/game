'use client';

import { useState } from 'react';
import { ingestViaMax, type IngestResult } from '@/lib/ingest';
import './inbox.css';

// Инбокс Макса: сваливаешь поток инфы + промпт-критерий важности → ядро
// фильтрует, важное уходит в память/синапсы Макса, шум отбрасывается.

export default function MaxInbox() {
  const [interest, setInterest] = useState('');
  const [stream, setStream] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<IngestResult | null>(null);
  const [error, setError] = useState('');

  async function run() {
    if (busy || !stream.trim()) return;
    setBusy(true);
    setError('');
    setRes(null);
    const out = await ingestViaMax(interest.trim(), stream);
    if (out) setRes(out);
    // Пустой ответ — это «запрос не прошёл», а не «ядро стоит»: ingestViaMax
    // отдаёт null и когда ядро ответило, но без разбора потока. Про мост на M3
    // здесь тем более неправда — ядро живёт на том же сервере, что и сайт.
    else setError('Ядро не разобрало поток на этот раз. Попробуй ещё раз или сократи текст.');
    setBusy(false);
  }

  return (
    <div className="ib-wrap">
      <header className="ib-head">
        <div className="ib-logo">△∞</div>
        <h1>ИНБОКС МАКСА</h1>
        <p>Свали поток инфы и задай, что важно. Макс отфильтрует и запомнит важное.</p>
      </header>

      <section className="ib-form">
        <label className="ib-field">
          <span>Что важно (критерий по промпту)</span>
          <input
            value={interest}
            onChange={(e) => setInterest(e.target.value)}
            placeholder="клиенты и деньги для проекта · запуск GAME · здоровье…"
            disabled={busy}
          />
        </label>
        <label className="ib-field">
          <span>Поток информации (каждый пункт с новой строки)</span>
          <textarea
            value={stream}
            onChange={(e) => setStream(e.target.value)}
            rows={8}
            placeholder={'Встреча с инвестором завтра 15:00\nПосмотрел видео с котом\nКлиент готов заплатить 5000$\nНадо купить молоко'}
            disabled={busy}
          />
        </label>
        <button className="ib-btn" onClick={run} disabled={busy || !stream.trim()}>
          {busy ? 'МАКС ФИЛЬТРУЕТ…' : 'ПРОПУСТИТЬ ЧЕРЕЗ МАКСА'}
        </button>
      </section>

      {error && <div className="ib-error">{error}</div>}

      {res && (
        <section className="ib-result">
          <div className="ib-summary">
            <b>{res.kept_count}</b> важных в память · <span className="ib-muted">{res.dropped_count} отброшено</span>
            <span className="ib-src">
              {res.source.startsWith('llm') ? `мозг Max: ${res.source.slice(4)}` : 'ядро Max'}
            </span>
          </div>

          <div className="ib-col ib-kept">
            <div className="ib-col-title">✦ В память Макса</div>
            {res.kept.length === 0 && <div className="ib-empty">Ничего важного по этому критерию.</div>}
            {res.kept.map((e, i) => (
              <div className="ib-item" key={i}>
                <div className="ib-item-top">
                  <span className="ib-score">{Math.round(e.score * 100)}%</span>
                  <span className="ib-reason">{e.reason}</span>
                </div>
                <p>{e.text}</p>
              </div>
            ))}
          </div>

          {res.dropped.length > 0 && (
            <details className="ib-col ib-dropped">
              <summary className="ib-col-title">Отброшено ({res.dropped.length})</summary>
              {res.dropped.map((e, i) => (
                <div className="ib-item ib-item-dim" key={i}>
                  <p>{e.text}</p>
                </div>
              ))}
            </details>
          )}
        </section>
      )}
    </div>
  );
}
