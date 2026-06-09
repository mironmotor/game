'use client';

import { useState } from 'react';
import { X, Loader2, GitBranch, Sparkles, Wrench } from 'lucide-react';
import { sendArchitect, type DevBranch } from '@/lib/max17-client';

const RISK_COLOR: Record<string, string> = {
  low: 'text-emerald-300/80',
  med: 'text-amber-300/80',
  high: 'text-rose-300/80',
};

function branchToTask(b: DevBranch): string {
  const steps = (b.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n');
  const files = (b.files || []).join(', ');
  return [
    b.title,
    b.why ? `\nЗачем: ${b.why}` : '',
    steps ? `\nШаги:\n${steps}` : '',
    files ? `\nЗатронуть файлы: ${files}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function ArchitectConsole({
  onClose,
  onImplement,
}: {
  onClose: () => void;
  onImplement: (task: string) => void;
}) {
  const [focus, setFocus] = useState('');
  const [branches, setBranches] = useState<DevBranch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const propose = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await sendArchitect({ focus: focus.trim() || undefined, count: 5 });
      if (r.ok && r.branches) {
        setBranches(r.branches);
        if (r.branches.length === 0) setError('Модель не вернула веток — попробуй ещё раз или задай фокус.');
      } else {
        setError(r.error || 'Не удалось получить предложения.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-[112px] left-1/2 z-20 flex h-[min(66vh,520px)] w-[min(460px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-cyan-300/30 bg-black/80 shadow-[0_0_28px_rgba(0,242,255,0.18)] backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-cyan-300/20 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-cyan-100/85">
          <GitBranch size={14} />
          <span>Архитектор · ветки развития</span>
        </div>
        <button type="button" onClick={onClose} className="hud-icon-btn" aria-label="Закрыть">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2 text-[11px] text-cyan-100/80">
        {branches.length === 0 && !busy && !error && (
          <p className="text-cyan-100/45">
            Внутренний ИИ проанализирует проект и предложит новые ветки развития. Можно задать фокус
            (напр. «производительность», «автономность», «UX») или оставить пусто.
          </p>
        )}
        {error && <div className="text-amber-300/80">⚠ {error}</div>}
        {busy && (
          <div className="flex items-center gap-2 text-cyan-100/55">
            <Loader2 size={13} className="animate-spin" /> анализирую проект…
          </div>
        )}
        {branches.map((b, i) => (
          <div key={i} className="rounded-md border border-cyan-300/15 bg-cyan-300/[0.04] px-2.5 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium text-cyan-100/95">
                <span className="text-cyan-300/60">{i + 1}. </span>
                {b.title}
              </div>
              <div className="flex shrink-0 gap-1 text-[9px] uppercase tracking-[0.1em]">
                {b.risk && <span className={RISK_COLOR[b.risk] || 'text-cyan-100/50'}>risk {b.risk}</span>}
                {b.effort && <span className="text-cyan-100/40">· {b.effort}</span>}
              </div>
            </div>
            {b.why && <div className="mt-1 text-cyan-100/60">{b.why}</div>}
            {b.steps && b.steps.length > 0 && (
              <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[10px] text-cyan-100/55">
                {b.steps.slice(0, 6).map((s, j) => (
                  <li key={j}>{s}</li>
                ))}
              </ol>
            )}
            {b.files && b.files.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {b.files.slice(0, 6).map((f) => (
                  <span key={f} className="rounded bg-cyan-300/10 px-1.5 py-0.5 text-[9px] text-cyan-200/70">
                    {f}
                  </span>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => onImplement(branchToTask(b))}
              className="mt-2 flex items-center gap-1 rounded bg-cyan-300/20 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-300/30"
              title="Передать ветку код-агенту (project-режим)"
            >
              <Wrench size={11} /> реализовать
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-cyan-300/20 px-2 py-2">
        <input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void propose();
            }
          }}
          placeholder="Фокус (необязательно)…"
          disabled={busy}
          className="min-w-0 flex-1 rounded border border-cyan-300/20 bg-black/40 px-2 py-1 text-[11px] text-cyan-50 outline-none placeholder:text-cyan-100/30 focus:border-cyan-300/50"
        />
        <button
          type="button"
          onClick={() => void propose()}
          disabled={busy}
          className="flex items-center gap-1 rounded bg-cyan-300/20 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-cyan-100 hover:bg-cyan-300/30 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} предложить
        </button>
      </div>
    </div>
  );
}
