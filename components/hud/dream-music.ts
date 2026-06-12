/**
 * Dreaming Music CGI — from MAX17. Max composes a track from his own TASTE.
 *
 * No APIs, no samples: pure Web Audio synthesis in an OfflineAudioContext.
 * The taste profile (avg BPM / key / mode / bass / brightness, aggregated by
 * music_sense from everything Max listened to) sets the scale, tempo and mix;
 * a seeded PRNG arranges pad chords, a bass line, an arpeggio and sparkles —
 * the same taste + the same seed-thought always dream the same track.
 */

export interface DreamTaste {
  avg_bpm?: number;
  fav_key?: string;
  mode?: string; // 'minor' | 'major'
  avg_bass?: number;
  avg_brightness?: number;
  avg_energy?: number;
}

import { SoundBank } from './sound-bank';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const DURATION = 24; // seconds
const SR = 44100;

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noteHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export async function generateDreamTrack(taste: DreamTaste, seedText = ''): Promise<AudioBuffer> {
  const rnd = mulberry32(hashSeed(`${JSON.stringify(taste)}::${seedText || 'dream'}`));
  const bpm = Math.min(150, Math.max(70, taste.avg_bpm || 100));
  const rootIdx = Math.max(0, NOTES.indexOf(taste.fav_key || 'A'));
  const minor = (taste.mode || 'minor') === 'minor';
  const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const rootMidi = 45 + rootIdx; // around A2
  const bass = Math.min(1, Math.max(0.2, taste.avg_bass ?? 0.5));
  const bright = Math.min(1, Math.max(0.1, taste.avg_brightness ?? 0.5));

  const ctx = new OfflineAudioContext(2, SR * DURATION, SR);
  const master = ctx.createGain();
  master.gain.value = 0.6;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1500 + bright * 6000;
  master.connect(lp).connect(ctx.destination);

  const beat = 60 / bpm;
  const bar = beat * 4;
  // chord progression over scale degrees (seeded): i — VI — III — VII style walks
  const degrees = [0, 5, 2, 6].map((d) => (rnd() < 0.3 ? Math.floor(rnd() * 7) : d));

  // Sound database: synthesized drum kit + strings + bells (seeded separately,
  // so the kit's character doesn't shift the melodic dice).
  const bank = new SoundBank(ctx, mulberry32(hashSeed(`${seedText}::bank`)));
  const drums = ctx.createGain();
  const label = ((taste as { label?: string }).label || '').toLowerCase();
  const energy = Math.min(1, Math.max(0.1, taste.avg_energy ?? 0.5));
  const lullaby = label.includes('колыбель');
  const calmStyle = lullaby || label.includes('успока') || label.includes('эмбиент') || energy < 0.35;
  const driveStyle = !calmStyle && (label.includes('драйв') || (bpm >= 115 && energy >= 0.55));
  const insight = label.includes('инсайт');
  drums.gain.value = lullaby ? 0.5 : 0.8 + energy * 0.5;
  drums.connect(master);

  const tone = (
    freq: number,
    t0: number,
    dur: number,
    vol: number,
    type: OscillatorType,
    detune = 0,
  ) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.08, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  };

  for (let barIdx = 0; barIdx * bar < DURATION; barIdx++) {
    const t0 = barIdx * bar;
    const deg = degrees[barIdx % degrees.length];
    const chordRoot = rootMidi + scale[deg % 7] + 12;

    // pad: root + third + fifth, two detuned voices each
    for (const off of [0, minor ? 3 : 4, 7]) {
      const f = noteHz(chordRoot + off);
      tone(f, t0, bar * 1.05, 0.05, 'sawtooth', -6);
      tone(f, t0, bar * 1.05, 0.05, 'triangle', 6);
    }
    // bass: root pulse on beats 1 and 3 (плотность из вкуса)
    for (let b = 0; b < 4; b++) {
      if (b % 2 === 0 || rnd() < bass * 0.5) {
        tone(noteHz(chordRoot - 12), t0 + b * beat, beat * 0.9, 0.16 * bass + 0.06, 'sine');
      }
    }
    // plucked-string arpeggio (Karplus-Strong) — живые струны вместо синта
    for (let s = 0; s < 8; s++) {
      if (rnd() < (calmStyle ? 0.45 : 0.72)) {
        const step = scale[Math.floor(rnd() * 7)];
        const octave = rnd() < 0.3 ? 24 : 12;
        bank.hit(master, 'pluck', t0 + s * beat * 0.5, 0.16 + bright * 0.1, noteHz(chordRoot + step + octave));
      }
    }
    // sparkles: bells when bright / on insight, soft sines otherwise
    if (rnd() < 0.3 + bright * 0.4) {
      const hi = noteHz(chordRoot + 24 + scale[Math.floor(rnd() * 7)]);
      if (insight || bright > 0.6) bank.hit(master, 'bell', t0 + rnd() * bar, 0.12, hi);
      else tone(hi, t0 + rnd() * bar, beat, 0.02, 'sine');
    }

    // --- beats from the sound database (pattern follows the mood) ---------
    const step16 = beat / 4;
    for (let s = 0; s < 16; s++) {
      const ts = t0 + s * step16;
      if (lullaby) {
        if (s === 0 || s === 8) bank.hit(drums, 'shaker', ts, 0.25);
        continue;
      }
      if (calmStyle) {
        if (s === 0) bank.hit(drums, 'kick', ts, 0.35);
        if (s === 4 || s === 12) bank.hit(drums, 'shaker', ts, 0.3);
        if (s === 8) bank.hit(drums, 'hat', ts, 0.15);
        continue;
      }
      if (driveStyle) {
        if (s % 4 === 0) bank.hit(drums, 'kick', ts, 0.55); // four-on-the-floor
        if (s === 4 || s === 12) bank.hit(drums, 'clap', ts, 0.4);
        if (s % 2 === 1) bank.hit(drums, 'hat', ts, s % 4 === 3 ? 0.28 : 0.18);
        if (s === 14 && rnd() < 0.6) bank.hit(drums, 'openhat', ts, 0.22);
        if (rnd() < 0.06) bank.hit(drums, 'hat', ts + step16 / 2, 0.1); // ghost
      } else {
        if (s === 0 || s === 8) bank.hit(drums, 'kick', ts, 0.5);
        if (s === 4 || s === 12) bank.hit(drums, 'snare', ts, 0.4);
        if (s % 2 === 0) bank.hit(drums, 'hat', ts, 0.16);
        if (s === 10 && rnd() < 0.4) bank.hit(drums, 'kick', ts, 0.3); // syncopation
      }
    }
    // fill: tom run at the end of every 4th bar
    if (!lullaby && !calmStyle && barIdx % 4 === 3) {
      for (let f = 0; f < 4; f++) {
        bank.hit(drums, 'tom', t0 + (12 + f) * step16, 0.3, 90 + f * 35);
      }
    }
    // insight: a bell chime opens each bar — радость открытия
    if (insight && barIdx % 2 === 0) {
      bank.hit(master, 'bell', t0, 0.14, noteHz(chordRoot + 24));
    }
  }

  // gentle fade-out master envelope
  master.gain.setValueAtTime(0.6, DURATION - 2);
  master.gain.linearRampToValueAtTime(0.0, DURATION - 0.05);

  return ctx.startRendering();
}

/** 16-bit PCM WAV for download — «Dreaming Music CGI — from MAX17». */
export function bufferToWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const length = buffer.length * channels * 2;
  const arr = new ArrayBuffer(44 + length);
  const view = new DataView(arr);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, length, true);
  let off = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([arr], { type: 'audio/wav' });
}

/** Play a rendered dream through a fresh AudioContext; returns a stop handle. */
export function playBuffer(buffer: AudioBuffer): () => void {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  src.onended = () => void ctx.close().catch(() => undefined);
  return () => {
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
  };
}
