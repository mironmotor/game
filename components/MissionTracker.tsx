'use client';

/**
 * MissionTracker — живая доска миссий MAX. Не todo-список: реальные цели Мирона,
 * которые MAX держит на виду и по которым пушит к ОДНОМУ следующему шагу.
 * Открыть: событие `missions:toggle` (команда /миссии), Esc — закрыть.
 * CRUD через событие ядра `missions`. Состояние — на сервере (state/missions.json).
 */

import { useCallback, useEffect, useState } from 'react';
import { Target, X, Plus, Check, Star, ChevronUp, Loader2 } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';
import { useMirCoin } from '@/hooks/use-mircoin';

type Mission = {
  id: string; title: string; why: string; status: string;
  progress: number; next_step: string;
};
type Snap = {
  missions: Mission[]; active_id: string; active: Mission | null;
  open_count: number; done_count: number;
};

export default function MissionTracker() {
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const { earn: earnMirCoin } = useMirCoin();

  const send = useCallback(async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = (await sendMax17Event({ type: 'missions', ...payload })) as { missions?: Snap };
      if (r.missions) setSnap(r.missions);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onOpen = () => setOpen(true);
    // Кто-то добавил миссии извне (агент заработка и т.п.) — открываем и перечитываем.
    const onRefresh = () => {
      setOpen(true);
      void send({ action: 'list' });
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('missions:toggle', onToggle);
    window.addEventListener('missions:open', onOpen);
    window.addEventListener('missions:refresh', onRefresh);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('missions:toggle', onToggle);
      window.removeEventListener('missions:open', onOpen);
      window.removeEventListener('missions:refresh', onRefresh);
      window.removeEventListener('keydown', onKey);
    };
  }, [send]);

  useEffect(() => { if (open) void send({ action: 'list' }); }, [open, send]);

  if (!open) return null;

  const missions = snap?.missions ?? [];
  const openM = missions.filter((m) => m.status !== 'done');
  const doneM = missions.filter((m) => m.status === 'done');
  const activeId = snap?.active_id ?? '';

  const addMission = () => {
    const t = title.trim();
    if (!t) return;
    setTitle('');
    void send({ action: 'add', title: t });
  };

  const Row = ({ m, active }: { m: Mission; active: boolean }) => (
    <div className={`rounded-xl border p-3 transition ${active ? 'border-amber-400/60 bg-amber-400/[0.07]' : 'border-white/10 bg-white/[0.03]'}`}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => void send({ action: 'focus', id: m.id })} title="В фокус"
          className={active ? 'text-amber-300' : 'text-white/30 hover:text-amber-300'}>
          <Star className="h-4 w-4" fill={active ? 'currentColor' : 'none'} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white/90">{m.title}</div>
          {m.why && <div className="text-[11px] text-white/40">{m.why}</div>}
          {m.next_step && <div className="mt-0.5 text-[12px] text-amber-200/80">→ {m.next_step}</div>}
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-amber-400/70" style={{ width: `${m.progress}%` }} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[11px] text-white/45">{m.progress}%</span>
          <div className="flex gap-1">
            <button type="button" onClick={() => void send({ action: 'update', id: m.id, progress: Math.min(100, m.progress + 20) })}
              className="rounded bg-white/10 px-1.5 text-[11px] text-white/70 hover:bg-white/20">+20</button>
            <button
              type="button"
              onClick={() => {
                void send({ action: 'complete', id: m.id });
                earnMirCoin(150, `Миссия: ${m.title}`);
              }}
              className="rounded bg-emerald-500/25 p-1 text-emerald-200 hover:bg-emerald-500/40" title="Выполнено · +150 MirCoin">
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[59] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-[min(640px,100%)] max-h-[92vh] overflow-y-auto rounded-2xl border border-amber-400/30 bg-[#0a0818]/95 p-4 shadow-[0_0_40px_rgba(186,117,23,0.18)]">
        <div className="mb-3 flex items-center gap-2">
          <Target className="h-4 w-4 text-amber-300" />
          <span className="text-sm font-semibold tracking-[0.2em] text-amber-200">🎯 МИССИИ</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300/60" />}
          <span className="ml-auto text-[11px] text-white/40">{snap?.open_count ?? 0} в работе · {snap?.done_count ?? 0} закрыто</span>
          <button type="button" onClick={() => setOpen(false)} className="ml-2 rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-[11px] text-white/40">MAX держит их на виду и пушит к одному шагу. Звезда — в фокус, +20 — прогресс, ✓ — закрыть.</p>

        <div className="mb-3 flex gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addMission()}
            placeholder="Новая миссия…"
            className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-amber-400/40" />
          <button type="button" onClick={addMission} disabled={busy || !title.trim()}
            className="flex items-center gap-1 rounded-lg bg-amber-500/25 px-3 py-1.5 text-sm font-semibold text-amber-100 hover:bg-amber-500/40 disabled:opacity-40">
            <Plus className="h-4 w-4" /> Добавить
          </button>
        </div>

        <div className="space-y-2">
          {openM.length === 0 && <div className="py-6 text-center text-sm text-white/40">Миссий нет. Добавь первую — одну, конкретную.</div>}
          {openM.map((m) => <Row key={m.id} m={m} active={m.id === activeId} />)}
        </div>

        {doneM.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-widest text-emerald-300/60">
              <ChevronUp className="h-3 w-3" /> Закрыто ({doneM.length})
            </div>
            <div className="space-y-1">
              {doneM.map((m) => (
                <div key={m.id} className="rounded-lg border border-emerald-400/15 bg-emerald-400/[0.04] px-3 py-1.5 text-sm text-white/45 line-through">
                  {m.title}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
