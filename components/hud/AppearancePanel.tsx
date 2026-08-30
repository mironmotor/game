'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Palette, Sparkles, Loader2, Check, Music, Square, Download, Search, Upload, Link2 } from 'lucide-react';
import {
  HUD_BACKGROUNDS,
  DREAM_BACKGROUND_ID,
  CUSTOM_BACKGROUND_ID,
  saveDreamBackground,
  saveCustomBackground,
} from './backgrounds';
import { appBasePath } from '@/lib/base-path';
import { DREAM_STYLES, generateDream } from './dream-canvas';
import { bufferToWav, generateDreamTrack, playBuffer, type DreamTaste } from './dream-music';
import { sendMax17Event } from '@/lib/max17-client';
import { HUD_THEMES, applyTheme, getTheme, loadThemeId } from './themes';
import { SCENE_MODES, getSceneMode, setSceneMode, subscribeSceneMode, type SceneMode } from '@/lib/scene-mode';

interface BackgroundHit {
  id: string;
  thumb: string;
  url: string;
  title: string;
  credit: string;
  license: string;
  source: string;
}

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
  // Режим живёт вне React (его же читают слои и кнопка «Мир 3D» в доке), поэтому
  // держим локальную копию и обновляем её на событие.
  const [scene, setScene] = useState<SceneMode>('all');
  useEffect(() => {
    setScene(getSceneMode());
    return subscribeSceneMode(() => setScene(getSceneMode()));
  }, []);
  const [styleId, setStyleId] = useState(DREAM_STYLES[0].id);
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // Dreaming Music — Max composes from his listening taste.
  const [composing, setComposing] = useState(false);
  const [tasteNote, setTasteNote] = useState('');
  const [wavUrl, setWavUrl] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState(false);
  // «Своя картинка»: поиск по свободному стоку, ссылка и файл.
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<BackgroundHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickNote, setPickNote] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      stopRef.current?.();
      if (wavUrl) URL.revokeObjectURL(wavUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const composeDream = async () => {
    if (composing) return;
    setComposing(true);
    setTasteNote('');
    try {
      stopRef.current?.();
      setPlaying(false);
      const res = (await sendMax17Event({ type: 'dream_mood' })) as {
        dream_mood?: DreamTaste & { label?: string; reason?: string };
        music_taste?: { tracks?: number };
      };
      const mood = res.dream_mood || {};
      const tracks = res.music_taste?.tracks || 0;
      const buffer = await generateDreamTrack(mood, seed || mood.label || '');
      stopRef.current = playBuffer(buffer);
      setPlaying(true);
      if (wavUrl) URL.revokeObjectURL(wavUrl);
      setWavUrl(URL.createObjectURL(bufferToWav(buffer)));
      setTasteNote(
        tracks
          ? `${mood.reason || 'Сочинил под настроение'} · ~${mood.avg_bpm} BPM, ${mood.fav_key} ${mood.mode} · вкус из ${tracks} прослушиваний.`
          : `${mood.reason || 'Сочинил'} · вкуса пока нет — скажи «слушай музыку» и врубай треки!`,
      );
    } catch (e) {
      setTasteNote(e instanceof Error ? e.message : String(e));
    } finally {
      setComposing(false);
    }
  };

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

  const search = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setPickNote('');
    setHits([]);
    try {
      const res = await fetch(`${appBasePath}/api/backgrounds/search?q=${encodeURIComponent(q)}`, {
        cache: 'no-store',
      });
      const data = (await res.json()) as { results?: BackgroundHit[]; note?: string };
      setHits(data.results ?? []);
      if (!data.results?.length) {
        setPickNote('Пусто. Попробуй другие слова или повтори — сток иногда молчит.');
      }
    } catch (e) {
      setPickNote(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  const applyCustom = (url: string, credit?: string, source?: string) => {
    if (!saveCustomBackground({ url, credit, source })) {
      setPickNote('Не поместилось в хранилище браузера.');
      return;
    }
    onSetBackground(CUSTOM_BACKGROUND_ID);
    setPickNote(credit ? `Фон поставлен. Автор: ${credit}` : 'Фон поставлен.');
  };

  const pickFile = (file: File) => {
    // Картинка не уходит на сервер: она живёт data-URL-ом в этом браузере.
    // Поэтому же есть потолок — большой файл не влезет в localStorage.
    if (file.size > 3_500_000) {
      setPickNote('Файл больше 3.5 МБ — хранилище браузера его не примет. Сожми или дай ссылку.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      if (!url.startsWith('data:image/')) {
        setPickNote('Это не изображение.');
        return;
      }
      applyCustom(url, 'твой файл');
    };
    reader.onerror = () => setPickNote('Не удалось прочитать файл.');
    reader.readAsDataURL(file);
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
          <div className="mb-1.5 text-[9px] uppercase tracking-[0.18em] text-cyan-100/45">Сцена</div>
          <div className="grid grid-cols-2 gap-1.5">
            {SCENE_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSceneMode(m.id)}
                className={`flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left transition ${
                  m.id === scene
                    ? 'border-cyan-300/60 bg-cyan-300/15'
                    : 'border-cyan-300/12 bg-cyan-300/[0.03] hover:bg-cyan-300/10'
                }`}
                title={m.hint}
              >
                <span className="flex w-full items-center gap-1 text-[10px] text-cyan-100/85">
                  {m.label}
                  {m.id === scene && <Check size={9} className="ml-auto text-cyan-300" />}
                </span>
                <span className="text-[8.5px] leading-tight text-cyan-100/45">{m.hint}</span>
              </button>
            ))}
          </div>
        </div>

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
            {background === CUSTOM_BACKGROUND_ID && (
              <span className="rounded bg-cyan-300/20 px-2 py-1 text-[10px] text-cyan-100">Своя ✦</span>
            )}
          </div>
        </div>

        <div className="rounded-md border border-cyan-300/20 bg-cyan-300/[0.04] px-2.5 py-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-cyan-100/55">
            <Search size={11} />
            Своя картинка
          </div>

          <div className="flex gap-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void search();
                }
              }}
              placeholder="закат, горы, туманность, город…"
              className="min-w-0 flex-1 rounded border border-cyan-300/20 bg-black/60 px-2 py-1.5 text-[10px] text-cyan-50 outline-none placeholder:text-cyan-100/30 focus:border-cyan-300/50"
            />
            <button
              type="button"
              onClick={() => void search()}
              disabled={searching || !query.trim()}
              className="flex shrink-0 items-center gap-1 rounded bg-cyan-400/25 px-2.5 py-1.5 text-[10px] text-cyan-50 transition hover:bg-cyan-400/40 disabled:opacity-50"
            >
              {searching ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
              Найти
            </button>
          </div>

          {hits.length > 0 && (
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {hits.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  onClick={() => applyCustom(hit.url, hit.credit, hit.source)}
                  title={`${hit.title} · ${hit.credit} · ${hit.license}`}
                  className="group relative overflow-hidden rounded border border-cyan-300/15 transition hover:border-cyan-300/50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={hit.thumb}
                    alt={hit.title}
                    loading="lazy"
                    className="h-14 w-full object-cover"
                    onError={(e) => {
                      // Не оставляем пустой квадрат с одной подписью: карточка,
                      // превью которой не загрузилось, исчезает из сетки.
                      const card = e.currentTarget.closest('button');
                      if (card) card.style.display = 'none';
                    }}
                  />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 py-0.5 text-[8px] text-cyan-100/70">
                    {hit.credit}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 flex gap-1.5">
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && linkUrl.trim()) {
                  e.preventDefault();
                  applyCustom(linkUrl.trim());
                }
              }}
              placeholder="или вставь ссылку на картинку"
              className="min-w-0 flex-1 rounded border border-cyan-300/15 bg-black/60 px-2 py-1.5 text-[10px] text-cyan-50 outline-none placeholder:text-cyan-100/25 focus:border-cyan-300/40"
            />
            <button
              type="button"
              onClick={() => linkUrl.trim() && applyCustom(linkUrl.trim())}
              disabled={!linkUrl.trim()}
              className="flex shrink-0 items-center gap-1 rounded bg-cyan-300/10 px-2 py-1.5 text-[10px] text-cyan-100/70 transition hover:bg-cyan-300/20 disabled:opacity-40"
            >
              <Link2 size={10} /> Ссылкой
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex shrink-0 items-center gap-1 rounded bg-cyan-300/10 px-2 py-1.5 text-[10px] text-cyan-100/70 transition hover:bg-cyan-300/20"
            >
              <Upload size={10} /> Файл
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) pickFile(file);
                e.target.value = '';
              }}
            />
          </div>

          {pickNote && <div className="mt-1.5 text-[9px] text-cyan-100/55">{pickNote}</div>}
          <p className="mt-1.5 text-[9px] leading-relaxed text-cyan-100/35">
            Поиск идёт по свободным лицензиям (Openverse), автор подписан под каждым снимком.
            Свой файл никуда не отправляется — он остаётся в этом браузере.
          </p>
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

          <div className="mt-2 border-t border-fuchsia-300/15 pt-2">
            <div className="mb-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-fuchsia-100/60">
              <Music size={11} />
              Dreaming Music · from MAX17
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void composeDream()}
                disabled={composing}
                className="flex shrink-0 items-center gap-1 rounded bg-fuchsia-400/25 px-2.5 py-1.5 text-[10px] text-fuchsia-50 transition hover:bg-fuchsia-400/40 disabled:opacity-50"
              >
                {composing ? <Loader2 size={11} className="animate-spin" /> : <Music size={11} />}
                Сочинить трек
              </button>
              {playing && (
                <button
                  type="button"
                  onClick={() => {
                    stopRef.current?.();
                    setPlaying(false);
                  }}
                  className="flex items-center gap-1 rounded bg-fuchsia-300/10 px-2 py-1.5 text-[10px] text-fuchsia-100/70 hover:bg-fuchsia-300/20"
                >
                  <Square size={10} /> стоп
                </button>
              )}
              {wavUrl && (
                <a
                  href={wavUrl}
                  download="dreaming-music-max17.wav"
                  className="flex items-center gap-1 rounded bg-fuchsia-300/10 px-2 py-1.5 text-[10px] text-fuchsia-100/70 hover:bg-fuchsia-300/20"
                >
                  <Download size={10} /> WAV
                </a>
              )}
            </div>
            {tasteNote && <div className="mt-1 text-[9px] text-fuchsia-100/55">{tasteNote}</div>}
            <p className="mt-1 text-[9px] leading-relaxed text-fuchsia-100/35">
              Макс сочиняет из СВОЕГО вкуса — того, что наслушал через «слушай музыку». Чистый синтез, без API.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
