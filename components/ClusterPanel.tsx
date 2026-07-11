'use client';

/**
 * ClusterPanel — пульт MAX GOD. Связка первичной ноды (M3) и воркера (i5) по LAN.
 * Здесь задаёшь адрес воркера, видишь онлайн/офлайн и можешь отдать тест-задание.
 * Открыть: событие `cluster:toggle` (команда /кластер), Esc — закрыть.
 * Работает через событие ядра `cluster` (status | set_worker | dispatch).
 */

import { useCallback, useEffect, useState } from 'react';
import { Network, X, Loader2, Cpu, Radio } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';

type ClusterStatus = {
  worker_url: string; alive: boolean; last_alive: string; last_seen: string;
  result?: { ok?: boolean; llm_text?: string; error?: string };
};

export default function ClusterPanel() {
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<ClusterStatus | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const call = useCallback(async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = (await sendMax17Event({ type: 'cluster', ...payload })) as { cluster?: ClusterStatus };
      if (r.cluster) {
        setSt(r.cluster);
        setUrl((u) => (u ? u : r.cluster!.worker_url || ''));
      }
      return r;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('cluster:toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('cluster:toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => { if (open) void call({ action: 'status' }); }, [open, call]);

  if (!open) return null;

  const save = () => { setNote(''); void call({ action: 'set_worker', url: url.trim() }); };
  const ping = () => { setNote(''); void call({ action: 'status' }); };
  const test = async () => {
    setNote('Шлю задание воркеру…');
    const r = (await call({ action: 'dispatch', event: { type: 'llm_raw', text: 'скажи привет одним словом' } })) as { ok?: boolean };
    setNote(r?.ok ? 'Воркер ответил ✓' : 'Воркер не ответил');
  };

  const Node = ({ label, sub, online, primary }: { label: string; sub: string; online: boolean; primary?: boolean }) => (
    <div className={`flex-1 rounded-xl border p-3 ${primary ? 'border-indigo-400/50 bg-indigo-400/[0.06]' : online ? 'border-emerald-400/40 bg-emerald-400/[0.05]' : 'border-white/10 bg-white/[0.03]'}`}>
      <div className="flex items-center gap-2">
        <Cpu className={`h-4 w-4 ${primary ? 'text-indigo-300' : online ? 'text-emerald-300' : 'text-white/40'}`} />
        <span className="text-sm font-semibold text-white/90">{label}</span>
        <span className={`ml-auto h-2 w-2 rounded-full ${primary || online ? 'bg-emerald-400' : 'bg-white/25'}`} />
      </div>
      <div className="mt-1 text-[11px] text-white/45">{sub}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[59] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-[min(620px,100%)] rounded-2xl border border-indigo-400/30 bg-[#0a0818]/95 p-4 shadow-[0_0_40px_rgba(99,102,241,0.18)]">
        <div className="mb-3 flex items-center gap-2">
          <Network className="h-4 w-4 text-indigo-300" />
          <span className="text-sm font-semibold tracking-[0.2em] text-indigo-200">⛓ MAX GOD · КЛАСТЕР</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-300/60" />}
          <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          <Node label="M3 · первичный" sub="этот Мак · HUD, голос, чат" online primary />
          <Node label="i5 · воркер" sub={st?.worker_url || 'не настроен'} online={!!st?.alive} />
        </div>

        <div className="mb-1 text-[11px] uppercase tracking-widest text-indigo-300/70">Адрес воркера (i5)</div>
        <div className="flex gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="http://192.168.1.X:3000/game/api/max17"
            className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-indigo-400/40" />
          <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-indigo-500/25 px-3 py-1.5 text-sm font-semibold text-indigo-100 hover:bg-indigo-500/40 disabled:opacity-40">Сохранить</button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={ping} disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white/80 hover:bg-white/20 disabled:opacity-40">
            <Radio className="h-4 w-4" /> Проверить связь
          </button>
          <button type="button" onClick={test} disabled={busy || !st?.worker_url} className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-100 hover:bg-emerald-500/35 disabled:opacity-30">
            Тест-задание
          </button>
          <span className={`ml-auto text-sm ${st?.alive ? 'text-emerald-300' : 'text-white/40'}`}>
            {st?.worker_url ? (st?.alive ? '● воркер онлайн' : '○ воркер офлайн') : 'воркер не задан'}
          </span>
        </div>

        {(note || st?.result) && (
          <div className="mt-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/70">
            {note}
            {st?.result?.llm_text && <div className="mt-1 text-emerald-200/80">воркер сказал: «{st.result.llm_text}»</div>}
            {st?.result?.error && <div className="mt-1 text-rose-300/80">{st.result.error}</div>}
          </div>
        )}

        <p className="mt-3 text-[10px] leading-relaxed text-white/30">
          Подними MAX на i5 (npm run dev), узнай его LAN-IP, впиши адрес сюда и сохрани. Связь зелёная → M3 сможет
          отдавать воркеру тяжёлую фоновую работу. Слияние мозгов (синапсы) — следующая фаза.
        </p>
      </div>
    </div>
  );
}
