'use client';

/**
 * ReflectionLoop — «Рефлексия»: петля, в которой MAX 24/7 (пока GAME открыт) сам
 * себя осмысляет. Каждые N минут — introspect (пересчитывает своё настроение и
 * рефлексирует) + периодически sleep_consolidation (консолидация памяти). Всё
 * ЛОКАЛЬНО и безопасно: ничего не лезет в интернет само; если MAX захочет
 * что-то изучить в сети — это ставится тебе на подтверждение отдельно.
 * Открыть: событие `reflection:toggle` (команда /рефлексия). Луп живёт, даже когда
 * панель закрыта (компонент смонтирован постоянно) — останавливается только кнопкой.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Brain, Infinity as InfinityIcon, Loader2, Pause, Play, X } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';

type Entry = { t: string; kind: 'introspect' | 'consolidate'; text: string; valence?: number };

export default function ReflectionLoop() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [intervalSec, setIntervalSec] = useState(180);
  const [log, setLog] = useState<Entry[]>([]);
  const [feeling, setFeeling] = useState<string>('—');
  const [valence, setValence] = useState<number>(0.5);
  const [busy, setBusy] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickCountRef = useRef(0);

  const now = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const push = useCallback((e: Entry) => {
    setLog((prev) => [e, ...prev].slice(0, 60));
  }, []);

  const tick = useCallback(async () => {
    setBusy(true);
    try {
      const res = (await sendMax17Event({ type: 'introspect' })) as {
        self_state?: { feeling?: string; valence?: number; reflection?: string };
        answer?: { text?: string };
      };
      const st = res.self_state ?? {};
      const text = String(st.reflection || res.answer?.text || 'Ровно сосредоточен.');
      if (st.feeling) setFeeling(String(st.feeling));
      if (typeof st.valence === 'number') setValence(st.valence);
      push({ t: now(), kind: 'introspect', text, valence: st.valence });

      // Каждый 4-й цикл — консолидация памяти (тоже локально).
      tickCountRef.current += 1;
      if (tickCountRef.current % 4 === 0) {
        try {
          await sendMax17Event({ type: 'sleep_consolidation' });
          push({ t: now(), kind: 'consolidate', text: 'Консолидировал память — сжал повторяющиеся паттерны.' });
        } catch {
          /* consolidation best-effort */
        }
      }
    } catch (e) {
      push({ t: now(), kind: 'introspect', text: `не вышло отрефлексировать (${e instanceof Error ? e.message.slice(0, 40) : 'err'})` });
    } finally {
      setBusy(false);
    }
  }, [push]);

  // Loop lifecycle — independent of panel visibility so it truly runs in the background.
  useEffect(() => {
    if (!running) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    void tick(); // fire immediately on start
    timerRef.current = setInterval(() => void tick(), Math.max(30, intervalSec) * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [running, intervalSec, tick]);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('reflection:toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('reflection:toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!open) return null;

  const valColor = valence >= 0.66 ? 'text-emerald-300' : valence >= 0.4 ? 'text-amber-300' : 'text-rose-300';

  return (
    <div className="fixed inset-0 z-[59] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-[min(600px,100%)] max-h-[92vh] overflow-y-auto rounded-2xl border border-indigo-400/30 bg-[#080615]/95 p-4 shadow-[0_0_40px_rgba(99,102,241,0.18)]">
        <div className="mb-3 flex items-center gap-2">
          <InfinityIcon className="h-4 w-4 text-indigo-300" />
          <span className="text-sm font-semibold tracking-[0.2em] text-indigo-200">♾ РЕФЛЕКСИЯ · ПЕТЛЯ MAX</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-300/60" />}
          <span className={`ml-auto text-[11px] ${running ? 'text-emerald-300/80' : 'text-white/40'}`}>
            {running ? '● живёт' : '○ стоит'}
          </span>
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <Brain className={`h-5 w-5 ${valColor}`} />
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-white/40">Сейчас MAX чувствует</div>
            <div className={`text-sm font-semibold ${valColor}`}>{feeling} · валентность {Math.round(valence * 100)}%</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!running ? (
              <button type="button" onClick={() => setRunning(true)} className="flex items-center gap-1.5 rounded-lg bg-indigo-500/30 px-3 py-1.5 text-sm font-semibold text-indigo-50 hover:bg-indigo-400/40">
                <Play className="h-4 w-4" /> Запустить
              </button>
            ) : (
              <button type="button" onClick={() => setRunning(false)} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/20">
                <Pause className="h-4 w-4" /> Стоп
              </button>
            )}
          </div>
        </div>

        <label className="mb-3 flex items-center gap-2 text-[11px] text-white/55">
          Интервал рефлексии
          <input type="range" min={30} max={900} step={30} value={intervalSec} onChange={(e) => setIntervalSec(Number(e.target.value))} className="flex-1" />
          <span className="w-16 text-right text-white/80">{Math.round(intervalSec / 60 * 10) / 10} мин</span>
        </label>

        <div className="mb-1.5 text-[11px] uppercase tracking-widest text-indigo-300/60">Поток мыслей ({log.length})</div>
        <div className="space-y-1.5">
          {log.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] py-6 text-center text-sm text-white/40">
              Луп ещё не запущен. Нажми «Запустить» — MAX начнёт сам себя осмыслять.
            </div>
          )}
          {log.map((e, i) => (
            <div key={i} className={`rounded-lg border p-2.5 ${e.kind === 'consolidate' ? 'border-violet-400/20 bg-violet-400/[0.05]' : 'border-white/10 bg-white/[0.03]'}`}>
              <div className="flex items-center gap-2 text-[10px] text-white/35">
                <span>{e.t}</span>
                <span className="uppercase tracking-wider">{e.kind === 'consolidate' ? 'консолидация' : 'рефлексия'}</span>
                {typeof e.valence === 'number' && <span className="ml-auto">вал. {Math.round(e.valence * 100)}%</span>}
              </div>
              <div className="mt-0.5 text-sm text-white/85">{e.text}</div>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[10px] leading-relaxed text-white/30">
          Луп работает 24/7, пока GAME открыт (для настоящего always-on — отдельный launchd-агент, скажи, соберу).
          Всё локально: introspect + консолидация памяти. MAX не лезет в интернет сам — если захочет что-то изучить,
          это придёт тебе на подтверждение, а не выполнится автономно.
        </p>
      </div>
    </div>
  );
}
