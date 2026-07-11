'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Play, Loader2, Monitor, Check, SkipForward, Zap } from 'lucide-react';
import {
  sendDesktopAgent,
  sendMax17Event,
  type DesktopAction,
  type DesktopMessage,
  type DesktopResult,
} from '@/lib/max17-client';

type LogItem =
  | { kind: 'you'; text: string }
  | { kind: 'obs'; action: string; text: string }
  | { kind: 'final'; text: string }
  | { kind: 'error'; text: string };

const MAX_AUTO_STEPS = 20;

function actionLabel(a: DesktopAction): string {
  const arg = a.app || a.text || a.keys || a.command || '';
  return `${a.action}${arg ? ` · ${arg}` : ''}`;
}

export function DesktopConsole({ onClose, initialTask }: { onClose: () => void; initialTask?: string }) {
  const [instruction, setInstruction] = useState('');
  const [log, setLog] = useState<LogItem[]>([]);
  const [pending, setPending] = useState<{ action: DesktopAction; messages: DesktopMessage[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoMode, setAutoMode] = useState(true);
  const autoModeRef = useRef(true);
  const ranTaskRef = useRef<string | null>(null);
  const taskRef = useRef(''); // активная задача — для записи опыта в граф (№4)
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    autoModeRef.current = autoMode;
  }, [autoMode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [log, pending, busy]);

  const push = (item: LogItem) => setLog((prev) => [...prev, item]);

  // Walk the proposal chain: read-actions auto-run; write-actions pause for approval.
  const process = async (result: DesktopResult, stepsLeft: number) => {
    if (!result.ok) {
      push({ kind: 'error', text: result.error || 'агент вернул ошибку' });
      // №4: провал тоже исход — учимся (в «заработанные» не идёт).
      if (taskRef.current) {
        void sendMax17Event({ type: 'agent_experience', agent: 'desktop', text: taskRef.current, ok: false }).catch(() => {});
      }
      setBusy(false);
      return;
    }
    const proposal = result.proposal;
    if (!proposal) {
      setBusy(false);
      return;
    }
    if (proposal.action === 'final') {
      push({ kind: 'final', text: proposal.answer || 'Готово.' });
      void sendMax17Event({
        type: 'system_state',
        text: `[desktop] ${proposal.answer || ''}`.slice(0, 400),
        source: 'desktop_mode',
      }).catch(() => {});
      // №4: успешное завершение → ЗАРАБОТАННЫЙ синапс (validated outcome).
      if (taskRef.current) {
        void sendMax17Event({ type: 'agent_experience', agent: 'desktop', text: taskRef.current, ok: true }).catch(() => {});
      }
      setBusy(false);
      return;
    }
    // Auto-mode: read-actions always auto-run; safe write-actions auto-run too;
    // only actions flagged needs_confirm (shell, quit, destructive keys) pause.
    const needsConfirm = proposal.needs_confirm ?? proposal.risk === 'write';
    const canAuto = proposal.risk === 'read' || (autoModeRef.current && !needsConfirm);
    if (canAuto && stepsLeft > 0) {
      const r = await sendDesktopAgent({
        mode: 'execute',
        approved_action: proposal,
        messages: result.messages,
      });
      push({ kind: 'obs', action: actionLabel(proposal), text: (r.observation || '').split('\n').slice(0, 3).join(' ') });
      await process(r, stepsLeft - 1);
      return;
    }
    // Needs confirmation (or auto budget spent) -> wait for the user.
    setPending({ action: proposal, messages: result.messages || [] });
    setBusy(false);
  };

  const start = async (taskOverride?: string) => {
    const text = (taskOverride ?? instruction).trim();
    if (text) taskRef.current = text;
    if (!text || busy || pending) return;
    setInstruction('');
    push({ kind: 'you', text });
    setBusy(true);
    try {
      const result = await sendDesktopAgent({ mode: 'propose', instruction: text });
      await process(result, MAX_AUTO_STEPS);
    } catch (error) {
      push({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      setBusy(false);
    }
  };

  // Orchestrator dispatch: auto-run a task handed in from the main chat.
  useEffect(() => {
    const task = initialTask?.trim();
    if (task && ranTaskRef.current !== task) {
      ranTaskRef.current = task;
      void start(task);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTask]);

  const approve = async () => {
    if (!pending) return;
    const { action, messages } = pending;
    setPending(null);
    setBusy(true);
    try {
      const r = await sendDesktopAgent({ mode: 'execute', approved_action: action, messages });
      push({ kind: 'obs', action: actionLabel(action), text: (r.observation || '').split('\n').slice(0, 3).join(' ') });
      await process(r, MAX_AUTO_STEPS);
    } catch (error) {
      push({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      setBusy(false);
    }
  };

  const skip = () => {
    setPending(null);
    push({ kind: 'error', text: 'действие отклонено — сессия остановлена' });
  };

  return (
    <div className="fixed bottom-[112px] left-4 z-20 flex h-[min(60vh,460px)] w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-cyan-300/30 bg-black/75 shadow-[0_0_28px_rgba(0,242,255,0.18)] backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-cyan-300/20 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-cyan-100/85">
          <Monitor size={14} />
          <span>Рабочий стол · Qwen3</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAutoMode((v) => !v)}
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] ${
              autoMode ? 'bg-cyan-300/20 text-cyan-100' : 'bg-white/5 text-cyan-100/50'
            }`}
            title="Авто-режим: простое делает сам, спрашивает только сложное/опасное"
          >
            <Zap size={11} /> авто {autoMode ? 'вкл' : 'выкл'}
          </button>
          <button type="button" onClick={onClose} className="hud-icon-btn" aria-label="Закрыть desktop-режим">
            <X size={16} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2 text-[11px] text-cyan-100/80">
        {log.length === 0 && !pending && (
          <p className="text-cyan-100/45">
            Опиши задачу для компьютера. В авто-режиме агент делает простое сам и спрашивает только на
            сложное/опасное (shell, закрытие приложений, ⌘Q/⌘W/Delete). Нужны разрешения macOS:
            Универсальный доступ / Автоматизация.
          </p>
        )}
        {log.map((item, i) => {
          if (item.kind === 'you') {
            return (
              <div key={i} className="text-cyan-300/90">
                <span className="text-cyan-300/50">{'>'} </span>
                {item.text}
              </div>
            );
          }
          if (item.kind === 'obs') {
            return (
              <div key={i} className="flex gap-2 text-[10px] text-cyan-100/55">
                <span className="min-w-[60px] text-cyan-300/70">{item.action}</span>
                <span className="truncate">{item.text}</span>
              </div>
            );
          }
          if (item.kind === 'final') {
            return (
              <div key={i} className="rounded border border-cyan-300/15 bg-cyan-300/5 px-2 py-1 text-cyan-100/90">
                {item.text}
              </div>
            );
          }
          return (
            <div key={i} className="text-amber-300/80">
              ⚠ {item.text}
            </div>
          );
        })}
        {busy && !pending && (
          <div className="flex items-center gap-2 text-cyan-100/55">
            <Loader2 size={13} className="animate-spin" /> думает…
          </div>
        )}
        {pending && (
          <div className="rounded-md border border-amber-300/40 bg-amber-300/10 px-2 py-2">
            <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-amber-200/80">подтвердить действие</div>
            <div className="text-amber-100/90">{pending.action.summary || actionLabel(pending.action)}</div>
            <div className="mt-0.5 font-mono text-[10px] text-amber-100/55">{actionLabel(pending.action)}</div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void approve()}
                className="flex items-center gap-1 rounded bg-cyan-300/20 px-2 py-1 text-[10px] text-cyan-100 hover:bg-cyan-300/30"
              >
                <Check size={12} /> Выполнить
              </button>
              <button
                type="button"
                onClick={skip}
                className="flex items-center gap-1 rounded bg-white/5 px-2 py-1 text-[10px] text-cyan-100/70 hover:bg-white/10"
              >
                <SkipForward size={12} /> Отклонить
              </button>
            </div>
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
              void start();
            }
          }}
          placeholder="Задача для рабочего стола…"
          disabled={busy || !!pending}
          className="min-w-0 flex-1 rounded border border-cyan-300/20 bg-black/40 px-2 py-1 text-[11px] text-cyan-50 outline-none placeholder:text-cyan-100/30 focus:border-cyan-300/50"
        />
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy || !!pending || !instruction.trim()}
          className="hud-icon-btn"
          aria-label="Запустить"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
        </button>
      </div>
    </div>
  );
}
