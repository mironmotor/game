'use client';

/**
 * CorpusPanel — controlled feeding channel for MAX + a live growth dashboard.
 * Paste curated text OR point at a project file/folder; MAX compiles it into the
 * synapse graph (the road to 1M USEFUL synapses). Shows the synapse delta and a
 * sparkline of total synapses over time toward 1M. Bottom-right, collapsible.
 */

import { useEffect, useState } from 'react';
import { Activity, BookOpen, ChevronDown, FolderInput, FolderOpen, Loader2, Send, Type, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getApiPath, sendMax17Event, type Max17Response } from '@/lib/max17-client';
import { useI18n } from '@/components/I18nProvider';

const GOAL = 1_000_000;

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ');
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) {
    return <div className="py-2 text-[11px] text-white/30">Мало точек — скорми ещё, и график оживёт.</div>;
  }
  const w = 380;
  const h = 44;
  const pad = 3;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((v - min) / range) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 44 }} aria-label="Рост синапсов во времени">
      <polyline points={pts} fill="none" stroke="#1D9E75" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function CorpusPanel() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'text' | 'path'>('text');
  const [text, setText] = useState('');
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Max17Response | null>(null);
  const [stats, setStats] = useState<Max17Response | null>(null);

  async function refreshStats() {
    try {
      const r = await sendMax17Event({ type: 'graph_stats' });
      setStats(r);
    } catch {
      /* dashboard is best-effort */
    }
  }

  useEffect(() => {
    if (open && !stats) void refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('corpus:toggle', onToggle);
    window.addEventListener('corpus:open', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('corpus:toggle', onToggle);
      window.removeEventListener('corpus:open', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  async function ingest() {
    const payload = mode === 'path' ? { type: 'ingest_corpus', path: path.trim() } : { type: 'ingest_corpus', text: text.trim() };
    const hasInput = mode === 'path' ? path.trim() : text.trim();
    if (!hasInput || loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await sendMax17Event(payload);
      setResult(r);
      if (mode === 'text') setText('');
      void refreshStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function revealInFinder() {
    const p = path.trim();
    if (!p) return;
    setError(null);
    try {
      const token = process.env.NEXT_PUBLIC_MAX17_API_TOKEN;
      const r = await fetch(getApiPath('reveal'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'x-max17-token': token } : {}) },
        body: JSON.stringify({ path: p }),
      });
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) setError(d.error || `Не удалось открыть в Finder (${r.status})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const added = result?.ingest?.synapses_added ?? 0;
  const total = stats?.graph_stats?.total_synapses ?? result?.graph_total ?? 0;
  const pct = total ? Math.min(100, (total / GOAL) * 100) : 0;
  const series = (stats?.growth_history ?? []).map((p) => p.total ?? 0).filter((n) => n > 0);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full border border-teal-400/30 bg-[#0a0818]/85 px-3 py-2 text-xs font-semibold text-teal-200 shadow-lg shadow-teal-500/10 backdrop-blur-md transition hover:bg-teal-400/10"
        title={t('corpus.title')}
      >
        <BookOpen className="h-4 w-4" />
        {t('corpus.title')}
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(440px,calc(100vw-32px))] rounded-2xl border border-teal-400/25 bg-[#0a0818]/92 p-3 shadow-2xl backdrop-blur-md">
      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-widest text-teal-300/80">
        <BookOpen className="h-3.5 w-3.5" /> {t('corpus.title')} → MAX
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto rounded-lg p-1 text-white/40 transition hover:bg-white/10 hover:text-white/80"
          aria-label={t('common.collapse')}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-2 flex gap-1">
        {(['text', 'path'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs transition',
              mode === m ? 'bg-teal-500/20 text-teal-100' : 'text-white/45 hover:bg-white/10',
            )}
          >
            {m === 'text' ? <Type className="h-3.5 w-3.5" /> : <FolderInput className="h-3.5 w-3.5" />}
            {m === 'text' ? 'Текст' : 'Путь'}
          </button>
        ))}
      </div>

      {mode === 'text' ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Вставь курируемый текст / заметки / данные — MAX переварит это в структурные синапсы…"
          rows={4}
          className="w-full resize-y rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-teal-400/40"
        />
      ) : (
        <div>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ingest();
            }}
            placeholder="напр. mark17/examples  или  README.md"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-teal-400/40"
          />
          <p className="mt-1 text-[10px] text-white/30">Путь относительно проекта (файл или папка, только текстовые). Заперто в каталоге проекта.</p>
          <button
            type="button"
            onClick={revealInFinder}
            disabled={!path.trim()}
            className="mt-2 flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/70 transition hover:border-teal-400/40 hover:bg-teal-400/10 hover:text-teal-100 disabled:cursor-not-allowed disabled:opacity-40"
            title="Показать этот путь в Finder"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Открыть в Finder
          </button>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <span className="text-[11px] text-white/40">{mode === 'text' ? `${text.trim().length} симв.` : 'файл/папка'}</span>
        <button
          type="button"
          onClick={ingest}
          disabled={loading || (mode === 'text' ? !text.trim() : !path.trim())}
          className="ml-auto flex items-center gap-1.5 rounded-xl bg-teal-500/90 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {loading ? 'Переваривает…' : 'Скормить MAX'}
        </button>
      </div>

      {error && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-200">
          <X className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {result && !error && (
        <div className="mt-2 text-xs text-teal-100">
          <span className="text-base font-semibold text-teal-200">+{fmt(added)}</span> синапсов ·{' '}
          {result.ingest ? `фрагментов ${result.ingest.chunks ?? 0}, скомпилировано ${result.ingest.compiled ?? 0}, из кеша ${result.ingest.cached ?? 0}` : ''}
        </div>
      )}

      <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-white/45">
          <Activity className="h-3.5 w-3.5" /> рост графа
          <span className="ml-auto text-white/60">{fmt(total)} / 1 000 000 · {pct.toFixed(2)}%</span>
        </div>
        <Sparkline data={series} />
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-teal-400" style={{ width: `${Math.max(0.4, pct)}%` }} />
        </div>
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-white/30">
        Контролируемая среда: в граф попадает только то, что ты дал. Идемпотентно (кеш по хешу), без сети.
      </p>
    </div>
  );
}
