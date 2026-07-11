'use client';

/**
 * PhaseDay — ChronoSync «Фаза дня» на рельсах MAX. Открыть: событие `phase:toggle`
 * (команда /фаза), Esc — закрыть. Показывает фазу месяца (запуск/стабилизация/
 * завершение), Луну и число дня как атмосферу, и 3 действия из РЕАЛЬНЫХ миссий
 * Мирона + фокус + «не делать». Данные — событие ядра `chrono_day` (mark17/chrono).
 */

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Loader2, Target, Ban, X, RefreshCw } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';

type Chrono = {
  date: string;
  month_phase: { code: number; key: string; label: string; day: number };
  moon: { key: string; label: string; emoji: string; fraction: number };
  day_number: { n: number; label: string };
  actions: string[];
  focus: string;
  dont: string;
  line: string;
};

const PHASE_TINT: Record<string, string> = {
  launch: 'from-emerald-500/15 border-emerald-400/40 text-emerald-200',
  stabilize: 'from-amber-500/15 border-amber-400/40 text-amber-200',
  close: 'from-violet-500/15 border-violet-400/40 text-violet-200',
};

export default function PhaseDay() {
  const [open, setOpen] = useState(false);
  const [chrono, setChrono] = useState<Chrono | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = (await sendMax17Event({ type: 'chrono_day' })) as { chrono?: Chrono; error?: string };
      if (r.chrono) setChrono(r.chrono);
      else setErr(r.error || 'нет данных фазы');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('phase:toggle', onToggle);
    window.addEventListener('phase:open', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('phase:toggle', onToggle);
      window.removeEventListener('phase:open', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  const tint = chrono ? PHASE_TINT[chrono.month_phase.key] ?? PHASE_TINT.launch : PHASE_TINT.launch;

  return (
    <div className="fixed inset-0 z-[59] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-[min(560px,100%)] max-h-[92vh] overflow-y-auto rounded-2xl border border-violet-400/30 bg-[#0a0818]/95 p-4 shadow-[0_0_40px_rgba(139,92,246,0.18)]">
        <div className="mb-3 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-violet-300" />
          <span className="text-sm font-semibold tracking-[0.2em] text-violet-200">🕒 ФАЗА ДНЯ · CHRONOSYNC</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-300/60" />}
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="ml-auto flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] text-white/70 hover:bg-white/20 disabled:opacity-40"
          >
            <RefreshCw className="h-3 w-3" /> обновить
          </button>
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        {err && <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{err}</div>}

        {chrono && (
          <>
            <div className={`rounded-xl border bg-gradient-to-b ${tint} to-transparent p-3`}>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{chrono.moon.emoji}</span>
                <div>
                  <div className="text-base font-bold">{chrono.month_phase.label} · {chrono.month_phase.code}</div>
                  <div className="text-[11px] text-white/50">
                    {chrono.date} · день {chrono.month_phase.day} · {chrono.moon.label} · число {chrono.day_number.n} ({chrono.day_number.label})
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[12px] leading-snug text-white/70">{chrono.line}</p>
            </div>

            <div className="mt-3">
              <div className="mb-1.5 text-[11px] uppercase tracking-widest text-violet-300/60">Что делать сегодня</div>
              <div className="space-y-1.5">
                {chrono.actions.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                    <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-violet-500/25 text-[11px] font-bold text-violet-100">{i + 1}</span>
                    <span className="text-sm text-white/85">{a}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-200"><Target className="h-3.5 w-3.5" /> Фокус дня</div>
                <div className="mt-1 text-sm text-white/85">{chrono.focus}</div>
              </div>
              <div className="rounded-lg border border-rose-400/25 bg-rose-400/[0.06] p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-200"><Ban className="h-3.5 w-3.5" /> Не делать</div>
                <div className="mt-1 text-sm text-white/85">{chrono.dont}</div>
              </div>
            </div>

            <p className="mt-3 text-[10px] leading-relaxed text-white/30">
              Фаза месяца — линза тайм-менеджмента (запуск→стабилизация→завершение), действия взяты из твоих реальных
              миссий. Луна и число дня — атмосфера, не предсказание. Открой /миссии, чтобы поправить цели.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
