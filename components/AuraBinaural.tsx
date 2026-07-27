'use client';

/**
 * AuraBinaural — «Аура»: бинауральные ритмы под человека для входа в поток.
 * Выбор состояния (поток/фокус/медитация/покой/озарение), тонкая настройка
 * (несущая/ритм/громкость/шум), и «Под меня» — подбор ритма по состоянию MAX
 * (introspect). Открыть: событие `aura:toggle` (команда /аура), Esc — закрыть.
 * Нужны наушники (бинаурал = разница между ушами). Визуал — медленное «дыхание»,
 * без мигания на частоте ритма (safety для светочувствительных).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Headphones, Loader2, Play, Sparkles, Square, Waves, X } from 'lucide-react';
import { startBinaural, type BinauralHandle } from '@/lib/binaural';
import { sendMax17Event } from '@/lib/max17-client';

type Preset = { id: string; label: string; band: string; beat: number; carrier: number; hue: number; note: string };

const PRESETS: Preset[] = [
  { id: 'flow', label: 'Поток', band: 'Alpha', beat: 10, carrier: 200, hue: 265, note: 'расслабленный фокус, вход в поток' },
  { id: 'focus', label: 'Фокус', band: 'Beta', beat: 16, carrier: 220, hue: 35, note: 'активная концентрация, работа' },
  { id: 'meditate', label: 'Медитация', band: 'Theta', beat: 6, carrier: 180, hue: 190, note: 'глубокое спокойствие, идеи' },
  { id: 'calm', label: 'Покой', band: 'Delta', beat: 2.5, carrier: 120, hue: 230, note: 'глубокий отдых, восстановление' },
  { id: 'insight', label: 'Озарение', band: 'Gamma', beat: 40, carrier: 300, hue: 320, note: 'пиковая ясность, инсайт' },
];

export default function AuraBinaural() {
  const [open, setOpen] = useState(false);
  const [presetId, setPresetId] = useState('flow');
  const [carrier, setCarrier] = useState(200);
  const [beat, setBeat] = useState(10);
  const [volume, setVolume] = useState(0.18);
  const [noise, setNoise] = useState(0.05);
  const [playing, setPlaying] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const handleRef = useRef<BinauralHandle | null>(null);
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];

  const applyPreset = useCallback((p: Preset) => {
    setPresetId(p.id);
    setCarrier(p.carrier);
    setBeat(p.beat);
    handleRef.current?.set({ carrier: p.carrier, beat: p.beat });
  }, []);

  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    handleRef.current?.stop();
    const h = startBinaural({ carrier, beat, volume, noise });
    if (!h) {
      setNote('Web Audio недоступен в этом браузере');
      return;
    }
    handleRef.current = h;
    setPlaying(true);
  }, [carrier, beat, volume, noise]);

  // Live-tune while playing.
  useEffect(() => {
    if (playing) handleRef.current?.set({ carrier, beat, volume, noise });
  }, [carrier, beat, volume, noise, playing]);

  // «Под меня» — MAX читает своё состояние и подбирает ритм.
  const tuneToMe = useCallback(async () => {
    if (tuning) return;
    setTuning(true);
    setNote('MAX слушает состояние…');
    try {
      const res = (await sendMax17Event({ type: 'introspect' })) as {
        self_state?: { feeling?: string; valence?: number };
      };
      const v = res.self_state?.valence ?? 0.5;
      const feeling = res.self_state?.feeling ?? '';
      // высокая валентность → поток; средняя → фокус; низкая/уставшее → медитация/покой
      const pick = v >= 0.66 ? 'flow' : v >= 0.45 ? 'focus' : v >= 0.3 ? 'meditate' : 'calm';
      const p = PRESETS.find((x) => x.id === pick) ?? PRESETS[0];
      applyPreset(p);
      setNote(`🫀 Под тебя: ${p.label} (${p.band}) — MAX «${feeling}», валентность ${Math.round(v * 100)}%`);
      if (!playing) play();
    } catch (e) {
      setNote(`Не считал состояние (${e instanceof Error ? e.message.slice(0, 40) : 'err'})`);
    } finally {
      setTuning(false);
    }
  }, [tuning, applyPreset, playing, play]);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('aura:toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('aura:toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Stop audio when the component unmounts (leaving the app), not on panel close —
  // so the aura keeps playing in the background while you work.
  useEffect(() => () => handleRef.current?.stop(), []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[59] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-[min(560px,100%)] max-h-[92vh] overflow-y-auto rounded-2xl border p-4 shadow-[0_0_40px_rgba(139,92,246,0.18)]"
        style={{ borderColor: `hsla(${preset.hue},70%,60%,0.35)`, background: '#0a0818f2' }}>
        <div className="mb-3 flex items-center gap-2">
          <Waves className="h-4 w-4" style={{ color: `hsl(${preset.hue},80%,70%)` }} />
          <span className="text-sm font-semibold tracking-[0.2em]" style={{ color: `hsl(${preset.hue},70%,78%)` }}>◐ АУРА · БИНАУРАЛЬНЫЕ РИТМЫ</span>
          <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg p-1 text-white/40 hover:bg-white/10 hover:text-white/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Медленное «дыхание» ауры — НЕ мигает на частоте ритма (safety). */}
        <style>{`@keyframes aura-breathe {0%,100%{transform:translate(-50%,-50%) scale(0.9);opacity:.55}50%{transform:translate(-50%,-50%) scale(1.15);opacity:.95}}`}</style>
        <div className="relative mb-3 h-40 overflow-hidden rounded-xl border border-white/10 bg-black/60">
          <div
            className="absolute left-1/2 top-1/2 h-40 w-40 rounded-full"
            style={{
              background: `radial-gradient(circle, hsla(${preset.hue},85%,70%,0.9), hsla(${preset.hue},80%,55%,0.25) 45%, transparent 70%)`,
              filter: 'blur(14px)',
              animation: playing ? 'aura-breathe 5.5s ease-in-out infinite' : 'none',
              opacity: playing ? undefined : 0.35,
            }}
          />
          <div className="absolute bottom-2 left-0 right-0 text-center text-[11px] text-white/50">
            {preset.label} · {preset.band} · {beat.toFixed(1)} Гц · {preset.note}
          </div>
        </div>

        <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-2.5 py-1.5 text-[11px] text-amber-100/90">
          <Headphones className="h-3.5 w-3.5" /> Нужны наушники — бинаурал живёт на разнице между ушами.
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p)}
              className={`rounded-xl border p-2 text-center transition ${presetId === p.id ? '' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}
              style={presetId === p.id ? { borderColor: `hsla(${p.hue},70%,60%,0.6)`, background: `hsla(${p.hue},70%,55%,0.14)` } : undefined}
            >
              <div className="text-sm font-semibold text-white/90">{p.label}</div>
              <div className="text-[10px] text-white/40">{p.band} · {p.beat} Гц</div>
            </button>
          ))}
        </div>

        <div className="mb-3 space-y-1.5 text-[11px] text-white/55">
          <label className="flex items-center gap-2">
            Ритм (beat)
            <input type="range" min={1} max={40} step={0.5} value={beat} onChange={(e) => setBeat(Number(e.target.value))} className="flex-1" />
            <span className="w-14 text-right text-white/80">{beat.toFixed(1)} Гц</span>
          </label>
          <label className="flex items-center gap-2">
            Несущая
            <input type="range" min={80} max={400} step={5} value={carrier} onChange={(e) => setCarrier(Number(e.target.value))} className="flex-1" />
            <span className="w-14 text-right text-white/80">{carrier} Гц</span>
          </label>
          <label className="flex items-center gap-2">
            Громкость
            <input type="range" min={0} max={0.5} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="flex-1" />
            <span className="w-14 text-right text-white/80">{Math.round(volume * 200)}%</span>
          </label>
          <label className="flex items-center gap-2">
            Шум-подложка
            <input type="range" min={0} max={0.2} step={0.01} value={noise} onChange={(e) => setNoise(Number(e.target.value))} className="flex-1" />
            <span className="w-14 text-right text-white/80">{Math.round(noise * 500)}%</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!playing ? (
            <button type="button" onClick={play} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
              style={{ background: `hsla(${preset.hue},70%,55%,0.35)` }}>
              <Play className="h-4 w-4" /> Включить
            </button>
          ) : (
            <button type="button" onClick={stop} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white/80 hover:bg-white/20">
              <Square className="h-4 w-4" /> Стоп
            </button>
          )}
          <button type="button" onClick={tuneToMe} disabled={tuning}
            className="flex items-center gap-1.5 rounded-lg bg-fuchsia-500/25 px-3 py-1.5 text-sm font-semibold text-fuchsia-50 hover:bg-fuchsia-400/40 disabled:opacity-40"
            title="MAX читает состояние и подбирает ритм под тебя">
            {tuning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Под меня
          </button>
        </div>

        {note && <div className="mt-2 text-[11px]" style={{ color: `hsl(${preset.hue},70%,80%)` }}>{note}</div>}

        <p className="mt-3 text-[10px] leading-relaxed text-white/30">
          Бинауральные ритмы — мягкая настройка мозговых волн под задачу (не медицина, не лечение). Начинай тихо,
          слушай ~10–20 мин. Если некомфортно — выключи. Не слушай за рулём и не при эпилепсии без консультации.
        </p>
      </div>
    </div>
  );
}
