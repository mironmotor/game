'use client';

/**
 * Mode777 — «Режим 777» для GODMODE: задаёшь параметры → локальный синт играет
 * полноценную (не 8-бит) электронику, а при проигрывании работает абстрактный
 * реактивный визуалайзер (радиальный спектр + пульс ядра под бит). Скачивание WAV.
 */

import { useEffect, useRef, useState } from 'react';
import { Brain, Download, Loader2, Play, Sparkles, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CHORD_MODES, KEYS, MOODS, render777Wav, start777, type ChordMode777, type Live777, type Mood777, type SongSpec, type Track777Params } from '@/lib/audio-777';
import { startViz777, type Viz777, type VizMode777 } from '@/lib/audio-viz-777';
import { sendMax17Event } from '@/lib/max17-client';

const MOOD_LABELS: Record<Mood777, string> = {
  dreamy: 'Мечтательно',
  chill: 'Чилл',
  dark: 'Тёмно',
  energetic: 'Энергично',
  epic: 'Эпично',
};

/** Pull a JSON object out of the model's reply (handles code fences / prose). */
function extractJson(raw: string): string {
  const f = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = f ? f[1] : raw;
  const a = body.indexOf('{');
  const z = body.lastIndexOf('}');
  return a >= 0 && z > a ? body.slice(a, z + 1) : body;
}

export default function Mode777() {
  const [mood, setMood] = useState<Mood777>('dreamy');
  const [bpm, setBpm] = useState(MOODS.dreamy.defBpm);
  const [energy, setEnergy] = useState(0.6);
  const [keyName, setKeyName] = useState('A');
  const [chordMode, setChordMode] = useState<ChordMode777>('auto');
  const [visual, setVisual] = useState<VizMode777>('flow');
  const [playing, setPlaying] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [wavUrl, setWavUrl] = useState<string | null>(null);
  const [spec, setSpec] = useState<SongSpec | null>(null);
  const [composing, setComposing] = useState(false);
  const [composeNote, setComposeNote] = useState('');

  const liveRef = useRef<Live777 | null>(null);
  const rafRef = useRef<number | null>(null);
  const vizRef = useRef<Viz777 | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  function currentParams(): Track777Params {
    return { mood, bpm, energy, key: keyName, chordMode };
  }

  function stop() {
    liveRef.current?.stop();
    liveRef.current = null;
    vizRef.current?.stop();
    vizRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setPlaying(false);
  }

  function draw(live: Live777) {
    const canvas = canvasRef.current;
    const ctx2d = canvas?.getContext('2d');
    if (!canvas || !ctx2d) return;
    const an = live.analyser;
    const freq = new Uint8Array(an.frequencyBinCount);
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      an.getByteFrequencyData(freq);
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      ctx2d.clearRect(0, 0, w, h);
      let bassSum = 0;
      for (let i = 0; i < 8; i++) bassSum += freq[i];
      const bass = bassSum / 8 / 255;
      const bars = 72;
      const baseR = Math.min(w, h) * 0.16;
      for (let i = 0; i < bars; i++) {
        const v = freq[Math.floor((i / bars) * an.frequencyBinCount * 0.55)] / 255;
        const ang = (i / bars) * Math.PI * 2;
        const r1 = baseR + bass * 16;
        const r2 = r1 + v * Math.min(w, h) * 0.34;
        ctx2d.strokeStyle = `hsla(${live.hue + i * 1.6}, 82%, ${48 + v * 34}%, ${0.45 + v * 0.55})`;
        ctx2d.lineWidth = 2.5;
        ctx2d.beginPath();
        ctx2d.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
        ctx2d.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
        ctx2d.stroke();
      }
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, baseR * (0.55 + bass * 0.55), 0, Math.PI * 2);
      ctx2d.fillStyle = `hsla(${live.hue}, 85%, ${38 + bass * 42}%, 0.9)`;
      ctx2d.fill();
    };
    loop();
  }

  function play(useSpec: SongSpec | null = spec) {
    stop();
    const live = start777(currentParams(), useSpec ?? undefined);
    liveRef.current = live;
    setPlaying(true);
    // TouchDesigner-style WebGL feedback visualizer; 2D radial spectrum is the fallback.
    const canvas = canvasRef.current;
    const viz = canvas ? startViz777(canvas, live.analyser, live.hue, visual) : null;
    if (viz) {
      vizRef.current = viz;
    } else {
      draw(live);
    }
  }

  // Switch visual mode live (flow ↔ fractal eye) without stopping the audio.
  useEffect(() => {
    if (!playing) return;
    const live = liveRef.current;
    const canvas = canvasRef.current;
    if (!live || !canvas) return;
    vizRef.current?.stop();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const viz = startViz777(canvas, live.analyser, live.hue, visual);
    if (viz) vizRef.current = viz;
    else draw(live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visual]);

  // MAX composes the actual pattern from scratch (LLM → JSON), engine plays it.
  async function composeWithMax() {
    if (composing) return;
    setComposing(true);
    setComposeNote('MAX сочиняет…');
    try {
      const p = currentParams();
      const prompt =
        'Ты — MAX, композитор. Сочини музыкальный паттерн на 2 такта (32 шага, 16 шагов = 1 такт) СТРОГО как JSON, без пояснений и текста вокруг.\n' +
        'Схема: {"bpm":<70-150>,"scale":"minor"|"major",' +
        '"drums":{"kick":[32 числа 0/1],"snare":[32 числа 0/1],"hat":[32 числа 0/1]},' +
        '"bass":[32 числа: ступень гаммы 0..7 или -1=пауза],' +
        '"melody":[32 числа: ступень 0..14 или -1=пауза],' +
        '"chords":[8 чисел: корень аккорда (ступень) по тактам]}\n' +
        `Настроение: ${p.mood}. Тональность: ${p.key}. Энергия: ${p.energy.toFixed(2)} (выше — плотнее драмы и мелодия). BPM около ${p.bpm}. ` +
        'Движок сам аранжирует это в полный трек (интро→билд→дроп→брейк). Сделай грувно и музыкально, оставляй дыхание (паузы -1), держись в гамме, мелодия пусть развивается между тактами.';
      const res = (await sendMax17Event({ type: 'llm_raw', text: prompt, json: true })) as { llm_text?: string };
      const parsed = JSON.parse(extractJson(res.llm_text || '')) as SongSpec;
      setSpec(parsed);
      setComposeNote('MAX написал свой паттерн ✦');
      play(parsed);
    } catch (err) {
      setComposeNote(`Не разобрал ответ MAX (${err instanceof Error ? err.message.slice(0, 40) : 'parse'}) — играю пресет`);
      setSpec(null);
      play(null);
    } finally {
      setComposing(false);
    }
  }

  // Let the chat orchestrator trigger a from-scratch compose: when MAX routes a
  // music request to «Режим 777», HudApp opens GODMODE then fires this event.
  const composeRef = useRef(composeWithMax);
  composeRef.current = composeWithMax;
  useEffect(() => {
    const onCompose = () => {
      void composeRef.current();
    };
    window.addEventListener('mode777:compose', onCompose);
    return () => window.removeEventListener('mode777:compose', onCompose);
  }, []);

  async function download() {
    if (rendering) return;
    setRendering(true);
    try {
      const blob = await render777Wav(currentParams(), 32, spec ?? undefined);
      if (wavUrl) URL.revokeObjectURL(wavUrl);
      setWavUrl(URL.createObjectURL(blob));
    } catch {
      /* render best-effort */
    } finally {
      setRendering(false);
    }
  }

  useEffect(() => {
    setBpm(MOODS[mood].defBpm);
  }, [mood]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const resize = () => {
      const r = c.getBoundingClientRect();
      c.width = Math.max(2, r.width * 2);
      c.height = Math.max(2, r.height * 2);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    return () => {
      stop();
      if (wavUrl) URL.revokeObjectURL(wavUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.04] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-amber-300/80">
        <Sparkles className="h-3.5 w-3.5" /> Режим 777 · музыка + визуал (TouchDesigner-style)
      </div>

      <canvas key={visual} ref={canvasRef} className="h-56 w-full rounded-lg border border-white/10 bg-black" />

      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-white/55">
        <label className="flex items-center gap-2">
          Настроение
          <select value={mood} onChange={(e) => setMood(e.target.value as Mood777)} className="flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none">
            {(Object.keys(MOODS) as Mood777[]).map((m) => (
              <option key={m} value={m}>{MOOD_LABELS[m]}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Тон
          <select value={keyName} onChange={(e) => setKeyName(e.target.value)} className="flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none">
            {KEYS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          BPM
          <input type="range" min={70} max={150} step={1} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="flex-1" />
          <span className="w-7 text-right text-white/80">{bpm}</span>
        </label>
        <label className="flex items-center gap-2">
          Энергия
          <input type="range" min={0} max={1} step={0.05} value={energy} onChange={(e) => setEnergy(Number(e.target.value))} className="flex-1" />
          <span className="w-7 text-right text-white/80">{Math.round(energy * 100)}</span>
        </label>
      </div>

      <label className="mt-2 flex items-center gap-2 text-[11px] text-white/55">
        Гармония
        <select
          value={chordMode}
          onChange={(e) => setChordMode(e.target.value as ChordMode777)}
          className="flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none"
        >
          {CHORD_MODES.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </label>

      <label className="mt-2 flex items-center gap-2 text-[11px] text-white/55">
        Визуал
        <select
          value={visual}
          onChange={(e) => setVisual(e.target.value as VizMode777)}
          className="flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none"
        >
          <option value="flow">Поток (feedback)</option>
          <option value="eye">Фрактальный глаз</option>
        </select>
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={composeWithMax}
          disabled={composing}
          className="flex items-center gap-1.5 rounded-lg bg-amber-500/30 px-3 py-1.5 text-sm font-semibold text-amber-50 transition hover:bg-amber-400/40 disabled:opacity-40"
          title="MAX сам пишет паттерн с нуля (его мозг — GODMODE-модель) и играет его"
        >
          {composing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
          MAX сочиняет
        </button>
        {!playing ? (
          <button type="button" onClick={() => play()} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white/80 transition hover:bg-white/20">
            <Play className="h-4 w-4" /> Играть
          </button>
        ) : (
          <button type="button" onClick={stop} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white/80 transition hover:bg-white/20">
            <Square className="h-4 w-4" /> Стоп
          </button>
        )}
        <button type="button" onClick={download} disabled={rendering} className="ml-auto flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/20 disabled:opacity-40">
          {rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {rendering ? 'Рендер…' : 'WAV'}
        </button>
        {wavUrl && (
          <a href={wavUrl} download="max-777.wav" className="flex items-center gap-1 rounded-lg bg-amber-500/20 px-2.5 py-1.5 text-xs text-amber-100 hover:bg-amber-500/35">
            <Download className="h-3.5 w-3.5" /> скачать
          </a>
        )}
      </div>
      {composeNote && <div className="mt-1.5 text-[11px] text-amber-200/80">{composeNote}</div>}
    </div>
  );
}
