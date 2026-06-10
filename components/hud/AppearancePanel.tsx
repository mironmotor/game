'use client';

import { useState } from 'react';
import { X, Palette, Sparkles, Loader2, Check } from 'lucide-react';
import { HUD_BACKGROUNDS, DREAM_BACKGROUND_ID, saveDreamBackground } from './backgrounds';
import { DREAM_STYLES, generateDream } from './dream-canvas';
import { HUD_THEMES, applyTheme, getTheme, loadThemeId } from './themes';

/**
 * «Вид» — themes, backgrounds and the subconscious wallpaper generator.
 * Everything is local: themes are CSS variables, dreams are seeded canvas art.
 */
export function AppearancePanel({
  onClose,
  background,
  onSetBackground,
}: {
  onClose: () => void;
  background: string;
  onSetBackground: (id: string) => void;
}) {
  const [themeId, setThemeId] = useState(() => loadThemeId());
  const [styleId, setStyleId] = useState(DREAM_STYLES[0].id);
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const pickTheme = (id: string) => {
    const theme = applyTheme(id);
    setThemeId(theme.id);
    // Pair the matching preset unless a generated dream is on the walls.
    if (background !== DREAM_BACKGROUND_ID) onSetBackground(theme.background);
  };

  const dream = () => {
    if (busy) return;
    setBusy(true);
    setNote('');
    // Let the spinner paint before the canvas blocks the main thread.
    window.setTimeout(() => {
      try {
        const dataUrl = generateDream({ styleId, seedText: seed, hues: getTheme(themeId).dreamHues });
        if (!dataUrl) {
          setNote('Не удалось нарисовать — canvas недоступен.');
        } else {
          setPreview(dataUrl);
          if (saveDreamBackground(dataUrl)) {
            onSetBackground(DREAM_BACKGROUND_ID);
            setNote('Сон поставлен на обои.');
          } else {
            setNote('Хранилище переполнено — сон показан, но не сохранён.');
          }
        }
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  return (
    <div className="fixed bottom-[112px] left-1/2 z-20 flex max-h-[min(72vh,540px)] w-[min(400px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-cyan-300/30 bg-black/85 shadow-[0_0_28px_rgba(0,242,255,0.18)] backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-cyan-300/20 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-cyan-100/85">
          <Palette size={14} />
          <span>Вид</span>
        </div>
        <button type="button" onClick={onClose} className="hud-icon-btn" aria-label="Закрыть">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-2.5 text-[11px] text-cyan-100/80">
        <div>
          <div className="mb-1.5 text-[9px] uppercase tracking-[0.18em] text-cyan-100/45">Тема интерфейса</div>
          <div className="grid grid-cols-5 gap-1.5">
            {HUD_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pickTheme(t.id)}
                className={`flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 transition ${
                  t.id === themeId ? 'border-cyan-300/60 bg-cyan-300/15' : 'border-cyan-300/12 bg-cyan-300/[0.03] hover:bg-cyan-300/10'
                }`}
                title={t.label}
              >
                <span className="flex gap-0.5">
                  {t.swatch.map((c, i) => (
                    <span key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
                  ))}
                </span>
                <span className="max-w-full truncate text-[8.5px] leading-none text-cyan-100/70">{t.label}</span>
                {t.id === themeId && <Check size={9} className="text-cyan-300" />}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[9px] uppercase tracking-[0.18em] text-cyan-100/45">Фон</div>
          <div className="flex flex-wrap gap-1.5">
            {HUD_BACKGROUNDS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onSetBackground(b.id)}
                className={`rounded px-2 py-1 text-[10px] transition ${
                  background === b.id ? 'bg-cyan-300/20 text-cyan-100' : 'bg-cyan-300/[0.05] text-cyan-100/60 hover:bg-cyan-300/12'
                }`}
              >
                {b.label}
              </button>
            ))}
            {background === DREAM_BACKGROUND_ID && (
              <span className="rounded bg-fuchsia-300/20 px-2 py-1 text-[10px] text-fuchsia-100">Сон ✦</span>
            )}
          </div>
        </div>

        <div className="rounded-md border border-fuchsia-300/20 bg-fuchsia-300/[0.05] px-2.5 py-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-fuchsia-100/60">
            <Sparkles size={11} />
            Подсознание · генератор обоев
          </div>
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {DREAM_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStyleId(s.id)}
                className={`rounded px-2 py-1 text-[10px] transition ${
                  styleId === s.id ? 'bg-fuchsia-300/25 text-fuchsia-50' : 'bg-fuchsia-300/[0.06] text-fuchsia-100/60 hover:bg-fuchsia-300/15'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="мысль-зерно (одинаковая мысль = тот же сон)"
              className="min-w-0 flex-1 rounded border border-fuchsia-300/20 bg-black/60 px-2 py-1.5 text-[10px] text-fuchsia-50 placeholder:text-fuchsia-100/30 outline-none focus:border-fuchsia-300/50"
            />
            <button
              type="button"
              onClick={dream}
              disabled={busy}
              className="flex shrink-0 items-center gap-1 rounded bg-fuchsia-400/25 px-2.5 py-1.5 text-[10px] text-fuchsia-50 transition hover:bg-fuchsia-400/40 disabled:opacity-50"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              Сгенерить сон
            </button>
          </div>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Сон Макса" className="mt-2 w-full rounded border border-fuchsia-300/20" />
          )}
          {note && <div className="mt-1 text-[9px] text-fuchsia-100/55">{note}</div>}
          <p className="mt-1.5 text-[9px] leading-relaxed text-fuchsia-100/35">
            Без API и сети: полотно рисуется локально из «мысли-зерна» в палитре темы — как образы подсознания Макса.
          </p>
        </div>
      </div>
    </div>
  );
}
