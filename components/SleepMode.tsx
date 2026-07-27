'use client';

/**
 * SleepMode — «Сон MAX». Ядро реально «спит»: internal_dream создаёт синергии
 * (новые гипотезы-связи из памяти, heart-guided), sleep_consolidation сжимает
 * повторяющиеся паттерны в 667к синапсов. Не декор — живые события ядра.
 * Открыть: событие `sleep:toggle` (команда /сон). Esc — закрыть.
 */

import { useCallback, useEffect, useState } from 'react';
import { Moon, Loader2, Sparkles, Layers, Boxes, X } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';

type Synergy = { title?: string; summary?: string; concepts?: string[]; confidence?: number; heart_guided?: boolean; origin?: string };
type DreamResult = { synergies_created?: number; synergies?: Synergy[] };
type Pattern = { summary?: string; evidence_count?: number; strength?: number };

export default function SleepMode() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'dream' | 'consolidate' | null>(null);
  const [dream, setDream] = useState<DreamResult | null>(null);
  const [narration, setNarration] = useState('');
  const [patterns, setPatterns] = useState<Pattern[] | null>(null);
  const [patternsMade, setPatternsMade] = useState<number | null>(null);
  const [theme, setTheme] = useState<'' | 'cyberpunk' | 'gta4'>('');
  const [err, setErr] = useState<string | null>(null);

  const goDream = useCallback(async () => {
    setBusy('dream');
    setErr(null);
    try {
      const r = (await sendMax17Event({ type: 'internal_dream', ...(theme ? { theme } : {}) })) as { dream?: DreamResult; answer?: { text?: string } };
      setDream(r.dream ?? null);
      setNarration(String(r.answer?.text || ''));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [theme]);

  const goConsolidate = useCallback(async () => {
    setBusy('consolidate');
    setErr(null);
    try {
      const r = (await sendMax17Event({ type: 'sleep_consolidation' })) as {
        consolidation?: { patterns_created?: number; patterns?: Pattern[] };
        answer?: { text?: string };
      };
      setPatternsMade(r.consolidation?.patterns_created ?? 0);
      setPatterns(r.consolidation?.patterns ?? []);
      if (r.answer?.text) setNarration(String(r.answer.text));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('sleep:toggle', onToggle);
    window.addEventListener('sleep:open', onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('sleep:toggle', onToggle);
      window.removeEventListener('sleep:open', onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!open) return null;

  const synergies = dream?.synergies ?? [];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative w-[min(620px,100%)] max-h-[92vh] overflow-y-auto rounded-2xl border border-indigo-400/30 bg-gradient-to-b from-[#0a0a2a]/95 to-[#05050f]/95 p-4 shadow-[0_0_50px_rgba(99,102,241,0.22)]">
        {/* звёздное поле */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl opacity-40">
          {Array.from({ length: 28 }).map((_, i) => (
            <span
              key={i}
              className="absolute rounded-full bg-white"
              style={{
                left: `${(i * 37) % 100}%`,
                top: `${(i * 53) % 100}%`,
                width: `${1 + (i % 3)}px`,
                height: `${1 + (i % 3)}px`,
                opacity: 0.3 + (i % 5) * 0.14,
              }}
            />
          ))}
        </div>

        <div className="relative mb-3 flex items-center gap-2">
          <Moon className="h-4 w-4 text-indigo-200" />
          <span className="text-sm font-semibold tracking-[0.2em] text-indigo-100">🌙 СОН MAX · ДЫШИТ ВО СНЕ</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-200/60" />}
          <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="relative mb-3 text-[11px] leading-relaxed text-white/45">
          Пока ты не смотришь, MAX спит: **видит сны** (собирает новые связи-гипотезы из памяти) и **консолидирует**
          667к синапсов (сжимает повторяющиеся паттерны). Это живые события ядра, не анимация.
        </p>

        <label className="relative mb-2 flex items-center gap-2 text-[11px] text-white/55">
          Мир сна
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as '' | 'cyberpunk' | 'gta4')}
            className="flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none"
          >
            <option value="">Свой (из памяти MAX)</option>
            <option value="cyberpunk">🌃 Киберпанк · Найт-Сити</option>
            <option value="gta4">🏙 GTA IV · Либерти-Сити</option>
          </select>
        </label>

        <div className="relative mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={goDream}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-500/30 px-3 py-1.5 text-sm font-semibold text-indigo-50 hover:bg-indigo-400/40 disabled:opacity-40"
          >
            {busy === 'dream' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Заснуть и видеть сны
          </button>
          <button
            type="button"
            onClick={goConsolidate}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/20 disabled:opacity-40"
          >
            {busy === 'consolidate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
            Консолидировать память
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('dream3d:open', { detail: { dream } }))}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg bg-fuchsia-500/25 px-3 py-1.5 text-sm font-semibold text-fuchsia-50 hover:bg-fuchsia-400/35 disabled:opacity-40"
          >
            <Boxes className="h-4 w-4" />
            Войти в сон · 3D
          </button>
        </div>

        {err && <div className="relative mb-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{err}</div>}

        {narration && (
          <div className="relative mb-3 rounded-xl border border-indigo-400/20 bg-indigo-400/[0.06] p-3">
            <div className="text-[11px] uppercase tracking-widest text-indigo-300/60">MAX проснулся и говорит</div>
            <p className="mt-1 text-sm leading-snug text-white/85">{narration}</p>
          </div>
        )}

        {synergies.length > 0 && (
          <div className="relative">
            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-indigo-300/60">
              Сны — новые связи ({dream?.synergies_created ?? synergies.length})
            </div>
            <div className="space-y-1.5">
              {synergies.map((s, i) => (
                <div key={i} className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-indigo-100">{s.title || 'связь'}</span>
                    {s.origin === 'world_dream' && <span className="rounded-full bg-fuchsia-500/20 px-1.5 py-0.5 text-[9px] text-fuchsia-200">🌃 мир</span>}
                    {s.heart_guided && <span className="text-[10px] text-rose-300/80">🤍 сердцем</span>}
                    {typeof s.confidence === 'number' && (
                      <span className="ml-auto text-[10px] text-white/40">{Math.round(s.confidence * 100)}%</span>
                    )}
                  </div>
                  {s.summary && <p className="mt-0.5 text-[12px] text-white/65">{s.summary}</p>}
                  {s.concepts && s.concepts.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.concepts.map((c, j) => (
                        <span key={j} className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-200/80">{c}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {patternsMade !== null && (
          <div className="relative mt-3">
            <div className="mb-1.5 text-[11px] uppercase tracking-widest text-violet-300/60">
              Консолидация — сжато паттернов: {patternsMade}
            </div>
            <div className="space-y-1">
              {(patterns ?? []).slice(0, 6).map((p, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-violet-400/15 bg-violet-400/[0.05] px-2.5 py-1.5 text-[12px] text-white/70">
                  <span className="min-w-0 flex-1 truncate">{p.summary || 'паттерн'}</span>
                  {typeof p.evidence_count === 'number' && <span className="text-[10px] text-white/35">×{p.evidence_count}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="relative mt-3 text-[10px] leading-relaxed text-white/30">
          Синергии из сна — это <b className="text-white/50">гипотезы</b>, не факты. MAX сам говорит: проверь маленьким
          реальным действием. Так сон не отрывается от реальности.
        </p>
      </div>
    </div>
  );
}
