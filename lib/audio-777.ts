/**
 * audio-777 — local generative music engine for GODMODE «Режим 777».
 * Pure Web Audio (no samples, no network, no 8-bit beeps): layered drums +
 * sub bass + pad chords + supersaw lead through sidechain-pump, delay and reverb
 * buses, arranged into a full track (intro → build → drop → break → drop).
 * Exposes an AnalyserNode for the reactive visualizer, and an offline renderer to
 * a downloadable WAV. Honest scope: rich electronica played by a synth engine —
 * MAX's LLM composes the pattern; it is NOT a neural audio model like Suno.
 */

export type Mood777 = 'dreamy' | 'chill' | 'dark' | 'energetic' | 'epic';

export interface Track777Params {
  mood: Mood777;
  bpm: number;
  energy: number; // 0..1 — density + brightness
  key: string; // 'C' | 'D' | ... | 'B'
  chordMode?: ChordMode777; // harmony flavour; default 'auto' (by mood)
}

interface MoodSpec {
  scale: 'minor' | 'major';
  bright: number; // 0..1 filter openness
  reverb: number; // 0..1 wet
  hue: number; // visualizer color
  defBpm: number;
}

/**
 * A composition MAX writes from scratch (LLM → JSON). The engine plays it as a
 * step sequencer indexed globally (bar*16 + step), so patterns LONGER than 16
 * steps evolve across bars. Note slots are scale-degree integers (0 = tonic,
 * negative = rest); chords are per-bar scale-degree roots. All fields optional —
 * the engine falls back to its deterministic generator for anything missing.
 */
export interface SongSpec {
  bpm?: number;
  key?: string;
  scale?: 'minor' | 'major';
  drums?: { kick?: number[]; snare?: number[]; hat?: number[] }; // 0/1 per step, any length
  bass?: number[]; // scale-degree or -1 = rest, any length
  melody?: number[]; // scale-degree or -1 = rest, any length
  chords?: number[]; // per-bar scale-degree roots (loops)
}

export const MOODS: Record<Mood777, MoodSpec> = {
  dreamy: { scale: 'minor', bright: 0.5, reverb: 0.55, hue: 265, defBpm: 90 },
  chill: { scale: 'major', bright: 0.45, reverb: 0.45, hue: 190, defBpm: 100 },
  dark: { scale: 'minor', bright: 0.3, reverb: 0.4, hue: 330, defBpm: 122 },
  energetic: { scale: 'minor', bright: 0.72, reverb: 0.28, hue: 25, defBpm: 128 },
  epic: { scale: 'minor', bright: 0.6, reverb: 0.6, hue: 48, defBpm: 110 },
};

export const KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NOTE_HZ: Record<string, number> = { C: 130.81, D: 146.83, E: 164.81, F: 174.61, G: 196.0, A: 220.0, B: 246.94 };
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PROG = [0, 5, 3, 4]; // scale-degree roots: i – VI – iv/III – V (legacy fallback)

// --- Harmony system: named chord shapes + progressions so the pad/arp are full,
// not a bare triad. A "shape" is scale-degree offsets from the chord root; deg()
// wraps octaves, so offset 6 = 7th, 8 = 9th, etc. ---
export type ChordMode777 = 'auto' | 'triad' | 'sevenths' | 'ninths' | 'sus' | 'cinematic' | 'jazzy';
export const CHORD_MODES: { id: ChordMode777; label: string }[] = [
  { id: 'auto', label: 'Авто (по настроению)' },
  { id: 'triad', label: 'Триады (чисто)' },
  { id: 'sevenths', label: 'Септаккорды' },
  { id: 'ninths', label: 'Нонаккорды (пышно)' },
  { id: 'sus', label: 'Sus / эфир' },
  { id: 'cinematic', label: 'Кинематик' },
  { id: 'jazzy', label: 'Джаз' },
];
type ChordSpec = { root: number; shape: number[] };
const SH = {
  triad: [0, 2, 4],
  sev: [0, 2, 4, 6],
  nine: [0, 2, 4, 6, 8],
  sus: [0, 3, 4, 6],
  add9: [0, 2, 4, 8],
  maj7: [0, 2, 4, 6],
};
const PROGRESSIONS: Record<Exclude<ChordMode777, 'auto'>, ChordSpec[]> = {
  triad: [{ root: 0, shape: SH.triad }, { root: 5, shape: SH.triad }, { root: 3, shape: SH.triad }, { root: 4, shape: SH.triad }],
  sevenths: [{ root: 1, shape: SH.sev }, { root: 4, shape: SH.sev }, { root: 0, shape: SH.sev }, { root: 5, shape: SH.sev }],
  ninths: [{ root: 0, shape: SH.nine }, { root: 3, shape: SH.nine }, { root: 5, shape: SH.nine }, { root: 4, shape: SH.nine }],
  sus: [{ root: 0, shape: SH.sus }, { root: 5, shape: SH.sus }, { root: 6, shape: SH.sus }, { root: 4, shape: SH.sus }],
  cinematic: [{ root: 0, shape: SH.add9 }, { root: 5, shape: SH.maj7 }, { root: 6, shape: SH.add9 }, { root: 4, shape: SH.sev }],
  jazzy: [{ root: 1, shape: SH.sev }, { root: 4, shape: SH.nine }, { root: 0, shape: SH.maj7 }, { root: 3, shape: SH.sev }],
};
const MOOD_PROG: Record<Mood777, Exclude<ChordMode777, 'auto'>> = {
  dreamy: 'ninths',
  chill: 'sevenths',
  dark: 'sevenths',
  energetic: 'sus',
  epic: 'cinematic',
};
function progressionFor(params: Track777Params): ChordSpec[] {
  const mode = params.chordMode && params.chordMode !== 'auto' ? params.chordMode : MOOD_PROG[params.mood];
  return PROGRESSIONS[mode] ?? PROGRESSIONS.triad;
}

function semis(freq: number, n: number): number {
  return freq * Math.pow(2, n / 12);
}

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  }
  return buf;
}

interface Bus {
  ctx: BaseAudioContext;
  dry: AudioNode; // un-ducked (drums)
  wet: AudioNode; // reverb send
  delaySend: AudioNode; // delay send
  pump: GainNode; // sidechain bus (bass/pad/lead route here; ducks on kick)
  noise: AudioBuffer;
  beat: number; // seconds per beat, for sidechain release timing
}

// --- Drum voices (route to dry — not ducked) ---

function kick(b: Bus, t: number, g: number) {
  const o = b.ctx.createOscillator();
  const a = b.ctx.createGain();
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  a.gain.setValueAtTime(g, t);
  a.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
  o.connect(a).connect(b.dry);
  o.start(t);
  o.stop(t + 0.3);
  // transient click
  const s = b.ctx.createBufferSource();
  s.buffer = b.noise;
  const hp = b.ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3200;
  const ca = b.ctx.createGain();
  ca.gain.setValueAtTime(g * 0.5, t);
  ca.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
  s.connect(hp).connect(ca).connect(b.dry);
  s.start(t);
  s.stop(t + 0.03);
  // sidechain duck
  const pg = b.pump.gain;
  pg.cancelScheduledValues(t);
  pg.setValueAtTime(0.32, t);
  pg.linearRampToValueAtTime(1.0, t + b.beat * 0.55);
}

function hat(b: Bus, t: number, g: number) {
  const s = b.ctx.createBufferSource();
  s.buffer = b.noise;
  const hp = b.ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const a = b.ctx.createGain();
  a.gain.setValueAtTime(g, t);
  a.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  s.connect(hp).connect(a).connect(b.dry);
  s.start(t);
  s.stop(t + 0.06);
}

function snare(b: Bus, t: number, g: number) {
  const s = b.ctx.createBufferSource();
  s.buffer = b.noise;
  const bp = b.ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1900;
  const a = b.ctx.createGain();
  a.gain.setValueAtTime(g, t);
  a.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  s.connect(bp).connect(a).connect(b.dry);
  s.start(t);
  s.stop(t + 0.18);
}

function clap(b: Bus, t: number, g: number) {
  // three quick noise bursts — the classic layered clap
  for (const off of [0, 0.011, 0.022]) {
    const s = b.ctx.createBufferSource();
    s.buffer = b.noise;
    const bp = b.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 1.2;
    const a = b.ctx.createGain();
    a.gain.setValueAtTime(g, t + off);
    a.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.12);
    s.connect(bp).connect(a).connect(b.dry);
    s.start(t + off);
    s.stop(t + off + 0.14);
  }
}

// --- Tonal voices (route to pump/wet/delay — ducked by kick) ---

function bass(b: Bus, t: number, freq: number, dur: number, g: number) {
  const a = b.ctx.createGain();
  a.gain.setValueAtTime(0.0001, t);
  a.gain.linearRampToValueAtTime(g, t + 0.012);
  a.gain.setValueAtTime(g, t + dur * 0.7);
  a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  a.connect(b.pump);
  // sub sine layer
  const sub = b.ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = freq;
  const sg = b.ctx.createGain();
  sg.gain.value = 0.85;
  sub.connect(sg).connect(a);
  sub.start(t);
  sub.stop(t + dur + 0.02);
  // filtered saw layer for grit
  const saw = b.ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = freq;
  const lp = b.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 440;
  const wg = b.ctx.createGain();
  wg.gain.value = 0.5;
  saw.connect(lp).connect(wg).connect(a);
  saw.start(t);
  saw.stop(t + dur + 0.02);
}

function pad(b: Bus, t: number, freqs: number[], dur: number, g: number, bright: number) {
  const lp = b.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600 + bright * 2600;
  const a = b.ctx.createGain();
  a.gain.setValueAtTime(0.0001, t);
  a.gain.linearRampToValueAtTime(g, t + dur * 0.25);
  a.gain.setValueAtTime(g, t + dur * 0.7);
  a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  lp.connect(a);
  a.connect(b.pump);
  a.connect(b.wet);
  for (const f of freqs) {
    for (const det of [-6, 6]) {
      const o = b.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = semis(f, det / 100);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
}

function lead(b: Bus, t: number, freq: number, dur: number, g: number, bright: number) {
  const a = b.ctx.createGain();
  a.gain.setValueAtTime(0.0001, t);
  a.gain.linearRampToValueAtTime(g, t + 0.02);
  a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const lp = b.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400 + bright * 4200;
  lp.connect(a);
  a.connect(b.pump);
  a.connect(b.wet);
  a.connect(b.delaySend);
  // supersaw — detuned saws for a wide, full lead
  for (const det of [-12, -5, 0, 5, 12]) {
    const o = b.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = semis(freq, det / 100);
    const og = b.ctx.createGain();
    og.gain.value = det === 0 ? 0.5 : 0.26;
    o.connect(og).connect(lp);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
}

// --- Arrangement: a 32-bar track shape so it evolves, not loops flat ---

interface SectionProfile {
  kick: boolean;
  snare: boolean;
  hats: number; // 0..1 density
  bass: boolean;
  lead: boolean;
  pad: boolean;
  fill: boolean; // snare roll into next section
  mul: number; // energy multiplier
}

function sectionProfile(bar: number): SectionProfile {
  const b = ((bar % 32) + 32) % 32;
  if (b < 4) return { kick: b >= 2, snare: false, hats: 0.3, bass: b >= 2, lead: false, pad: true, fill: false, mul: 0.5 };
  if (b < 8) return { kick: true, snare: b >= 6, hats: 0.7, bass: true, lead: false, pad: true, fill: b === 7, mul: 0.78 };
  if (b < 16) return { kick: true, snare: true, hats: 1, bass: true, lead: true, pad: true, fill: b === 15, mul: 1.1 };
  if (b < 20) return { kick: false, snare: false, hats: 0.4, bass: false, lead: true, pad: true, fill: b === 19, mul: 0.6 };
  return { kick: true, snare: true, hats: 1, bass: true, lead: true, pad: true, fill: b === 31, mul: 1.15 };
}

function fillRoll(b: Bus, p: { bpm: number }, t: number) {
  const beat = 60 / p.bpm;
  for (let s = 0; s < 8; s++) snare(b, t + 3 * beat + s * (beat / 8), 0.22 + s * 0.05);
}

function scheduleBar(b: Bus, p: Track777Params, spec: MoodSpec, t: number, bar: number) {
  const beat = 60 / p.bpm;
  const sc = sectionProfile(bar);
  const scale = spec.scale === 'minor' ? MINOR : MAJOR;
  const root = NOTE_HZ[p.key] ?? NOTE_HZ.A;
  const deg = (i: number) => semis(root, scale[((i % scale.length) + scale.length) % scale.length] + 12 * Math.floor(i / scale.length));
  const prog = progressionFor(p);
  const cspec = prog[bar % prog.length];
  const notes = cspec.shape.map((o) => deg(cspec.root + o)); // full chord voicing
  const e = p.energy * sc.mul;

  // drums
  if (sc.kick) for (let i = 0; i < 4; i++) if (e > 0.4 || i % 2 === 0) kick(b, t + i * beat, 0.92);
  if (sc.snare) {
    snare(b, t + beat, 0.45);
    clap(b, t + beat, 0.35);
    snare(b, t + 3 * beat, 0.45);
    clap(b, t + 3 * beat, 0.35);
  }
  if (sc.hats > 0) {
    const hatStep = sc.hats >= 1 && e > 0.6 ? beat / 4 : beat / 2;
    for (let h = 0; h < 4 * beat - 1e-6; h += hatStep) hat(b, t + h, 0.09 + sc.hats * 0.1);
  }
  if (sc.fill) fillRoll(b, p, t);

  // bass — chord root, ducked by kick
  if (sc.bass) {
    const bf = semis(notes[0], -12);
    bass(b, t, bf, beat * 0.9, 0.5);
    bass(b, t + 2 * beat, bf, beat * 0.9, 0.5);
    if (e > 0.6) {
      bass(b, t + beat, bf, beat * 0.5, 0.4);
      bass(b, t + 3 * beat, bf, beat * 0.5, 0.4);
    }
  }

  // pad — full chord voicing + sub-octave root for body
  if (sc.pad) pad(b, t, [semis(notes[0], -12), ...notes], 4 * beat, 0.14, spec.bright);

  // supersaw arp lead over the chord tones (moves through the whole chord)
  if (sc.lead) {
    const arp = [notes[0], notes[1 % notes.length], notes[2 % notes.length], notes[3 % notes.length], semis(notes[1 % notes.length], 12)];
    const steps = e > 0.5 ? 8 : 4;
    const sd = (4 * beat) / steps;
    for (let s = 0; s < steps; s++) {
      const f = semis(arp[s % arp.length], 12);
      lead(b, t + s * sd, f, sd * 0.9, 0.1 + e * 0.05, spec.bright);
    }
  }
}

function scheduleSongBar(b: Bus, p: Track777Params, mspec: MoodSpec, song: SongSpec, t: number, bar: number) {
  const bpm = song.bpm ?? p.bpm;
  const beat = 60 / bpm;
  const step = beat / 4; // 16 steps per bar
  const sc = sectionProfile(bar);
  const scaleArr = (song.scale ?? mspec.scale) === 'minor' ? MINOR : MAJOR;
  const root = NOTE_HZ[song.key ?? p.key] ?? NOTE_HZ.A;
  const deg = (i: number) => semis(root, scaleArr[((i % scaleArr.length) + scaleArr.length) % scaleArr.length] + 12 * Math.floor(i / scaleArr.length));
  const at = (arr: number[] | undefined, gi: number) =>
    Array.isArray(arr) && arr.length ? arr[((gi % arr.length) + arr.length) % arr.length] : undefined;
  const d = song.drums ?? {};

  for (let s = 0; s < 16; s++) {
    const gi = bar * 16 + s; // global step — patterns longer than 16 evolve across bars
    const tt = t + s * step;
    if (sc.kick && at(d.kick, gi)) kick(b, tt, 0.92);
    if (sc.snare && at(d.snare, gi)) {
      snare(b, tt, 0.45);
      clap(b, tt, 0.3);
    }
    if (sc.hats > 0 && at(d.hat, gi)) hat(b, tt, 0.14);
    if (sc.bass && song.bass) {
      const n = at(song.bass, gi);
      if (typeof n === 'number' && n >= 0) bass(b, tt, semis(deg(n), -12), step * 1.6, 0.5);
    }
    if (sc.lead && song.melody) {
      const n = at(song.melody, gi);
      if (typeof n === 'number' && n >= 0) lead(b, tt, semis(deg(n), 12), step * 1.6, 0.12, mspec.bright);
    }
  }
  if (sc.fill) fillRoll(b, { bpm }, t);

  if (sc.pad) {
    const chords = song.chords && song.chords.length ? song.chords : [0];
    const cr = chords[bar % chords.length];
    const prog = progressionFor(p);
    const shape = prog[bar % prog.length].shape; // voice MAX's chord root with the selected flavour
    const notes = shape.map((o) => deg(cr + o));
    pad(b, t, [semis(notes[0], -12), ...notes], 4 * beat, 0.14, mspec.bright);
  }
}

/** Build the shared FX graph (reverb + delay + sidechain pump + glue compressor). */
function buildBus(ctx: BaseAudioContext, spec: MoodSpec, bpm: number, out: AudioNode): Bus {
  const conv = ctx.createConvolver();
  conv.buffer = impulse(ctx, 1.6 + spec.reverb * 1.5);
  const wetGain = ctx.createGain();
  wetGain.gain.value = spec.reverb;
  conv.connect(wetGain).connect(out);

  const dry = ctx.createGain();
  dry.connect(out);
  const wet = ctx.createGain();
  wet.connect(conv);

  const pump = ctx.createGain();
  pump.gain.value = 1;
  pump.connect(dry);

  // ping-flavored delay feeding the master
  const delaySend = ctx.createGain();
  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = (60 / bpm) * 0.75;
  const fb = ctx.createGain();
  fb.gain.value = 0.34;
  const dWet = ctx.createGain();
  dWet.gain.value = 0.32;
  delaySend.connect(delay);
  delay.connect(fb).connect(delay);
  delay.connect(dWet).connect(out);

  return { ctx, dry, wet, delaySend, pump, noise: noiseBuffer(ctx), beat: 60 / bpm };
}

export interface Live777 {
  analyser: AnalyserNode;
  hue: number;
  stop: () => void;
}

export function start777(params: Track777Params, song?: SongSpec): Live777 {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const spec = MOODS[params.mood];
  const bpm = song?.bpm ?? params.bpm;

  const master = ctx.createGain();
  master.gain.value = 0.72;
  // glue compressor keeps the fuller mix loud and clip-safe
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  master.connect(comp);
  comp.connect(analyser);
  analyser.connect(ctx.destination);

  const bus = buildBus(ctx, spec, bpm, master);
  const barDur = (60 / bpm) * 4;
  let nextBar = ctx.currentTime + 0.15;
  let bar = 0;
  const timer = window.setInterval(() => {
    while (nextBar < ctx.currentTime + 0.3) {
      if (song) scheduleSongBar(bus, params, spec, song, nextBar, bar);
      else scheduleBar(bus, params, spec, nextBar, bar);
      nextBar += barDur;
      bar++;
    }
  }, 25);

  void ctx.resume();

  return {
    analyser,
    hue: spec.hue,
    stop: () => {
      window.clearInterval(timer);
      master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
      window.setTimeout(() => void ctx.close(), 300);
    },
  };
}

/** Offline-render `seconds` of the track to a downloadable WAV blob. */
export async function render777Wav(params: Track777Params, seconds = 32, song?: SongSpec): Promise<Blob> {
  const spec = MOODS[params.mood];
  const bpm = song?.bpm ?? params.bpm;
  const sampleRate = 44100;
  const OAC = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil(sampleRate * seconds), sampleRate);

  const master = ctx.createGain();
  master.gain.value = 0.72;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  master.connect(comp);
  comp.connect(ctx.destination);

  const bus = buildBus(ctx, spec, bpm, master);
  const barDur = (60 / bpm) * 4;
  let t = 0;
  let bar = 0;
  while (t < seconds) {
    if (song) scheduleSongBar(bus, params, spec, song, t, bar);
    else scheduleBar(bus, params, spec, t, bar);
    t += barDur;
    bar++;
  }
  const rendered = await ctx.startRendering();
  return encodeWav(rendered);
}

function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels;
  const len = buf.length * ch * 2 + 44;
  const ab = new ArrayBuffer(len);
  const view = new DataView(ab);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  let off = 0;
  writeStr(off, 'RIFF'); off += 4;
  view.setUint32(off, len - 8, true); off += 4;
  writeStr(off, 'WAVE'); off += 4;
  writeStr(off, 'fmt '); off += 4;
  view.setUint32(off, 16, true); off += 4;
  view.setUint16(off, 1, true); off += 2;
  view.setUint16(off, ch, true); off += 2;
  view.setUint32(off, buf.sampleRate, true); off += 4;
  view.setUint32(off, buf.sampleRate * ch * 2, true); off += 4;
  view.setUint16(off, ch * 2, true); off += 2;
  view.setUint16(off, 16, true); off += 2;
  writeStr(off, 'data'); off += 4;
  view.setUint32(off, buf.length * ch * 2, true); off += 4;
  const chans: Float32Array[] = [];
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  for (let i = 0; i < buf.length; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
