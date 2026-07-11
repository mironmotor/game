'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Play, Loader2, FileCode, Terminal, Undo2 } from 'lucide-react';
import { sendCodeAgent, sendMax17Event, type CodeAgentResult } from '@/lib/max17-client';

interface Turn {
  instruction: string;
  result?: CodeAgentResult;
  error?: string;
}

const ACTION_LABEL: Record<string, string> = {
  list_dir: 'ls',
  read_file: 'read',
  write_file: 'write',
  run_command: 'run',
  final: 'final',
  verify_reject: '↻fix',
};

export function CodeConsole({
  onClose,
  initialTask,
  initialTarget,
}: {
  onClose: () => void;
  initialTask?: string;
  initialTarget?: 'sandbox' | 'project';
}) {
  const [instruction, setInstruction] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<'sandbox' | 'project'>('sandbox');
  const [lastRevert, setLastRevert] = useState<{ restore: Record<string, string | null>; target: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const ranTaskRef = useRef<string | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy]);

  const run = async (taskOverride?: string) => {
    const text = (taskOverride ?? instruction).trim();
    if (!text || busy) return;
    setInstruction('');
    const index = turns.length;
    setTurns((prev) => [...prev, { instruction: text }]);
    setBusy(true);
    try {
      const history = turns.flatMap((t) =>
        t.result?.answer
          ? [
              { role: 'user', content: t.instruction },
              { role: 'assistant', content: t.result.answer },
            ]
          : [],
      );
      const result = await sendCodeAgent({ instruction: text, history, target });
      setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, result } : t)));
      if (result.restore && Object.keys(result.restore).length > 0) {
        setLastRevert({ restore: result.restore, target: result.target || target });
      }
      if (result.ok && result.answer) {
        // Tie-in: leave a lightweight memory trace in the cognitive core.
        void sendMax17Event({
          type: 'system_state',
          text: `[code] ${text} → ${result.answer}`.slice(0, 400),
          source: 'code_mode',
        }).catch(() => {});
      }
      // №4: успех/провал агента → ЗАРАБОТАННЫЙ синапс (validated outcome).
      void sendMax17Event({
        type: 'agent_experience',
        agent: 'code',
        text,
        ok: Boolean(result.ok),
      }).catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTurns((prev) => prev.map((t, i) => (i === index ? { ...t, error: message } : t)));
    } finally {
      setBusy(false);
    }
  };

  const revert = async () => {
    if (!lastRevert || busy) return;
    setBusy(true);
    try {
      const r = await sendCodeAgent({
        mode: 'revert',
        restore: lastRevert.restore,
        target: lastRevert.target as 'sandbox' | 'project',
      });
      setTurns((prev) => [
        ...prev,
        {
          instruction: '↩ откат изменений',
          result: { ok: r.ok, answer: (r.reverted || []).join('; ') || r.error || 'откат выполнен' },
        },
      ]);
      setLastRevert(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTurns((prev) => [...prev, { instruction: '↩ откат изменений', error: message }]);
    } finally {
      setBusy(false);
    }
  };

  // Launched from the Architect with a target preset (e.g. project mode).
  useEffect(() => {
    if (initialTarget) setTarget(initialTarget);
  }, [initialTarget]);

  // Orchestrator dispatch: auto-run a task handed in from the main chat.
  useEffect(() => {
    const task = initialTask?.trim();
    if (task && ranTaskRef.current !== task) {
      ranTaskRef.current = task;
      void run(task);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTask]);

  return (
    <div className="fixed bottom-[112px] right-4 z-20 flex h-[min(60vh,460px)] w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-cyan-300/30 bg-black/75 shadow-[0_0_28px_rgba(0,242,255,0.18)] backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-cyan-300/20 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-cyan-100/85">
          <Terminal size={14} />
          <span>Код · Qwen3</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTarget((v) => (v === 'sandbox' ? 'project' : 'sandbox'))}
            className={`rounded px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] ${
              target === 'project' ? 'bg-amber-300/25 text-amber-100' : 'bg-cyan-300/15 text-cyan-100/70'
            }`}
            title={
              target === 'project'
                ? 'Цель: ЖИВОЙ проект Game (правит реальные файлы)'
                : 'Цель: песочница code-workspace/'
            }
          >
            {target === 'project' ? '⚠ проект Game' : 'песочница'}
          </button>
          {lastRevert && (
            <button
              type="button"
              onClick={() => void revert()}
              disabled={busy}
              className="flex items-center gap-1 rounded bg-amber-300/15 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-amber-100 hover:bg-amber-300/25"
              title="Откатить изменения последнего прогона"
            >
              <Undo2 size={11} /> откат
            </button>
          )}
          <button type="button" onClick={onClose} className="hud-icon-btn" aria-label="Закрыть код-режим">
            <X size={16} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-2 text-[11px] text-cyan-100/80">
        {turns.length === 0 && (
          <p className="text-cyan-100/45">
            Опиши задачу — агент прочитает/изменит файлы и запустит команды в песочнице
            <code className="px-1 text-cyan-300/80">code-workspace/</code>. Напр.: «создай FastAPI-эндпоинт /ping и запусти тест».
          </p>
        )}
        {turns.map((turn, i) => (
          <div key={i} className="space-y-1.5">
            <div className="text-cyan-300/90">
              <span className="text-cyan-300/50">{'>'} </span>
              {turn.instruction}
            </div>
            {turn.result?.lessons_used && turn.result.lessons_used.length > 0 && (
              <div className="rounded border border-fuchsia-300/20 bg-fuchsia-300/[0.06] px-2 py-1 text-[10px] text-fuchsia-100/80">
                <span className="text-fuchsia-200/90">🧠 вспомнил {turn.result.lessons_used.length} уро{turn.result.lessons_used.length === 1 ? 'к' : 'ка'}:</span>
                {turn.result.lessons_used.map((l, j) => (
                  <div key={j} className="truncate text-fuchsia-100/55">{l.lesson}</div>
                ))}
              </div>
            )}
            {turn.result?.steps && turn.result.steps.length > 0 && (
              <div className="space-y-0.5 border-l border-cyan-300/15 pl-2">
                {turn.result.steps.map((step, j) => (
                  <div key={j} className="flex gap-2 text-[10px] text-cyan-100/55">
                    <span className="min-w-[34px] text-cyan-300/70">{ACTION_LABEL[step.action] ?? step.action}</span>
                    <span className="truncate">
                      {step.command || step.path || ''}
                      {step.observation ? (
                        <span className="text-cyan-100/35"> — {step.observation.split('\n')[0].slice(0, 60)}</span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {turn.result?.answer && (
              <div className="rounded border border-cyan-300/15 bg-cyan-300/5 px-2 py-1 text-cyan-100/90">
                {turn.result.answer}
              </div>
            )}
            {turn.result?.verify && (turn.result.verify.fix_attempts ?? 0) > 0 && (
              <div
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] ${
                  turn.result.verify.passed
                    ? 'bg-emerald-400/15 text-emerald-200/90'
                    : 'bg-amber-400/15 text-amber-200/90'
                }`}
              >
                {turn.result.verify.passed ? '✓ проверка пройдена' : '⚠ проверка не прошла'} · исправлений: {turn.result.verify.fix_attempts}
              </div>
            )}
            {turn.result?.error && <div className="text-amber-300/80">⚠ {turn.result.error}</div>}
            {turn.error && <div className="text-amber-300/80">⚠ {turn.error}</div>}
            {turn.result?.files_changed && turn.result.files_changed.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {turn.result.files_changed.map((f) => (
                  <span key={f} className="flex items-center gap-1 rounded bg-cyan-300/10 px-1.5 py-0.5 text-[9px] text-cyan-200/80">
                    <FileCode size={10} /> {f}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-cyan-100/55">
            <Loader2 size={13} className="animate-spin" /> агент работает…
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-cyan-300/20 px-2 py-2">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void run();
            }
          }}
          placeholder="Задача для кода…"
          disabled={busy}
          className="min-w-0 flex-1 rounded border border-cyan-300/20 bg-black/40 px-2 py-1 text-[11px] text-cyan-50 outline-none placeholder:text-cyan-100/30 focus:border-cyan-300/50"
        />
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !instruction.trim()}
          className="hud-icon-btn"
          aria-label="Запустить агента"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
        </button>
      </div>
    </div>
  );
}
