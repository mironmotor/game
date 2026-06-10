/**
 * Voice signature engine — faithful port of mironmotor/neuron-motor's
 * voice/signature.html DSP, adapted as a reusable engine for the Max HUD.
 *
 * Local & deterministic (Web Audio only, nothing leaves the machine): per-frame
 * it extracts pitch (autocorrelation), formants F1/F2, HNR, jitter (pitch
 * tremor), shimmer (amplitude tremor), brightness, speech rate and throat
 * constriction, keeps a personal voice baseline in localStorage (EMA, warmup),
 * and maps the rich feature set to three smoothed axes — arousal / valence /
 * tension — plus a human verdict. `onFrame` fires every animation frame with the
 * full reading so the HUD can visualise it and feed Max's core.
 */

export interface VoiceFeatures {
  f0: number;
  register: number;
  brightness: number;
  energy: number;
  jitter: number;
  shimmer: number;
  f0var: number;
  rate: number;
  f1: number;
  f2: number;
  constriction: number;
  hnr: number;
  hnrNorm: number;
  voiced: boolean;
}

export interface VoiceReading {
  feats: VoiceFeatures;
  arousal: number; // smoothed 0..1
  valence: number; // smoothed 0..1
  tension: number; // smoothed 0..1
  label: string;
  desc: string;
  note: string;
  warming: boolean;
  obs: number;
  stability: number; // 0..1, how steadily the state is held
  trend: 'up' | 'down' | 'flat';
  overtones: number[]; // 60 bins, for the visualization
}

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteOf = (f: number): string => {
  if (f <= 0) return '—';
  const n = Math.round(12 * Math.log2(f / 440) + 69);
  return NOTES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
};
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const std = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) * (x - m))));
};
// mean jump between neighbouring frames — catches tremor, not intonation
const meanAbsDiff = (a: number[]) => {
  if (a.length < 2) return 0;
  let s = 0;
  for (let i = 1; i < a.length; i++) s += Math.abs(a[i] - a[i - 1]);
  return s / (a.length - 1);
};

// ===== personal voice baseline (like the Max17 core), kept in the browser =====
const ALPHA = 0.05;
const WARMUP = 8;
const PROFILE_KEY = 'max17_voice_profile_v4';
type Profile = { obs: number; [k: string]: number };
const PROFILE_KEYS = ['f0', 'register', 'brightness', 'energy', 'jitter', 'shimmer', 'hnr', 'f1', 'f2', 'constriction'] as const;

function loadProfile(): Profile | null {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
  } catch {
    return null;
  }
}
function saveProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* private mode — skip persistence */
  }
}
function updateProfile(f: Record<string, number>): Profile {
  const p = loadProfile();
  if (!p) {
    const np: Profile = { obs: 1 };
    PROFILE_KEYS.forEach((k) => (np[k] = f[k]));
    saveProfile(np);
    return np;
  }
  const np: Profile = { obs: p.obs + 1 };
  PROFILE_KEYS.forEach((k) => (np[k] = (p[k] ?? f[k]) * (1 - ALPHA) + f[k] * ALPHA));
  saveProfile(np);
  return np;
}

const NEG = ['не могу', 'опять', 'бесит', 'проблема', 'ошибка', 'плохо', 'устал', 'злюсь', 'достало', 'тревож', 'страшно', 'паника', 'не работает'];
const POS = ['круто', 'класс', 'отлично', 'супер', 'получилось', 'спасибо', 'рад', 'люблю', 'кайф', 'красиво', 'работает', 'вектор'];
function contextBias(t: string): number {
  if (!t) return 0;
  const l = t.toLowerCase();
  let s = 0;
  NEG.forEach((c) => l.includes(c) && s--);
  POS.forEach((c) => l.includes(c) && s++);
  return clamp(s * 0.07, -0.2, 0.2);
}

function labelOf(a: number, v: number, t: number, f: VoiceFeatures): { label: string; desc: string } {
  if (t > 0.7 && f.constriction > 0.65) return { label: '😬 зажатый, напряжённый', desc: 'горло сжато относительно твоей нормы, голос дрожит' };
  if (t > 0.7) return { label: '😬 напряжённый, на взводе', desc: 'высокая дрожь голоса' };
  if (f.hnr < 7 && a < 0.4) return { label: '😮‍💨 усталый, глуховатый', desc: 'много придыхания, мало тона' };
  if (a > 0.66 && v > 0.55) return { label: '🤩 воодушевлён, энергичен', desc: 'яркий, открытый, быстрый' };
  if (a > 0.6 && v <= 0.45) return { label: '😤 взволнован, на эмоциях', desc: 'высокий и резкий' };
  if (a < 0.35 && v >= 0.5) return { label: '😌 спокоен, расслаблен', desc: 'ровный, чистый, низкий' };
  if (a < 0.35 && v < 0.45) return { label: '😔 тихий, подавленный', desc: 'медленный, тусклый' };
  if (v > 0.6) return { label: '🙂 ровный, позитивный', desc: 'чистый и устойчивый' };
  return { label: '😐 нейтральный', desc: '' };
}

function analyze(f: VoiceFeatures, ctx: string): { arousal: number; valence: number; tension: number } {
  const p = loadProfile();
  const obs = p ? p.obs : 0;
  const warming = obs < WARMUP;
  let dev: Record<string, number> = {};
  if (p && obs > 0) {
    const base = p.f0 || f.f0 || 1;
    dev = {
      f0: clamp((f.f0 - p.f0) / Math.max(40, base * 0.4), -1, 1),
      jitter: clamp(f.jitter - (p.jitter || 0), -1, 1),
      shimmer: clamp(f.shimmer - (p.shimmer || 0), -1, 1),
      hnr: clamp((f.hnr - (p.hnr || 0)) / 15, -1, 1),
      energy: clamp(f.energy - (p.energy || 0), -1, 1),
      constriction: clamp(f.constriction - (p.constriction || 0), -1, 1),
    };
  }
  if (!f.voiced) return { arousal: 0, valence: 0.5, tension: 0 };

  let arousal = 0.3 * f.register + 0.22 * f.brightness + 0.22 * f.energy + 0.16 * f.rate + 0.1 * f.f0var;
  if (!warming) arousal += 0.3 * Math.max(0, dev.f0) + 0.12 * Math.max(0, dev.energy);
  arousal = clamp(arousal);

  let tension = 0.38 * f.jitter + 0.25 * f.shimmer + 0.12 * Math.max(0, f.constriction - 0.3) + 0.15 * (1 - f.hnrNorm) + 0.1 * f.register;
  if (!warming) tension += 0.22 * Math.max(0, dev.jitter) + 0.14 * Math.max(0, dev.constriction) + 0.12 * Math.max(0, -dev.hnr);
  tension = clamp(tension);

  let valence = 0.5 + 0.22 * (f.brightness - 0.5) + 0.18 * (f.hnrNorm - 0.5) - 0.3 * f.jitter - 0.1 * Math.max(0, f.constriction - 0.3) - 0.18 * (tension - 0.5) + contextBias(ctx);
  valence = clamp(valence);

  return { arousal, valence, tension };
}

export class VoiceSignatureEngine {
  private actx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private pitch: AnalyserNode | null = null;
  private raf = 0;
  private running = false;

  private SR = 48000;
  private binHz = 0;
  private freq = new Uint8Array(0);
  private floatFreq = new Float32Array(0);
  private pbuf = new Float32Array(2048);

  private f0s = 0;
  private lastAmp = 0;
  private lastUpd = 0;
  private smAr = 0;
  private smVa = 0.5;
  private smTe = 0;
  private smInit = false;
  private shownLabel = '—';
  private shownDesc = '';
  private lastLabelChange = 0;

  private readonly HMAX = 45;
  private f0Hist: number[] = [];
  private ampHist: number[] = [];
  private onsetHist: number[] = [];
  private teTrend: number[] = [];
  private tv = new Array(60).fill(0);

  ctxText = ''; // optional text context (the message being said) for valence bias

  async start(onFrame: (r: VoiceReading) => void): Promise<boolean> {
    if (this.running) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.actx = new Ctx();
      await this.actx.resume();
      this.SR = this.actx.sampleRate;
      const src = this.actx.createMediaStreamSource(this.stream);
      this.analyser = this.actx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.6;
      this.pitch = this.actx.createAnalyser();
      this.pitch.fftSize = 2048;
      src.connect(this.analyser);
      src.connect(this.pitch);
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.floatFreq = new Float32Array(this.analyser.frequencyBinCount);
      this.pbuf = new Float32Array(2048);
      this.binHz = this.SR / 4096;
      this.f0s = 0;
      this.f0Hist = [];
      this.ampHist = [];
      this.onsetHist = [];
      this.teTrend = [];
      this.tv = new Array(60).fill(0);
      this.smInit = false;
      this.smAr = 0;
      this.smVa = 0.5;
      this.smTe = 0;
      this.shownLabel = '—';
      this.shownDesc = '';
      this.lastLabelChange = 0;
      this.running = true;
      const loop = () => {
        if (!this.running) return;
        const reading = this.frame();
        if (reading) onFrame(reading);
        this.raf = requestAnimationFrame(loop);
      };
      loop();
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  private detectPitch(buf: Float32Array, sr: number): { f: number; rms: number; clarity: number } {
    const N = buf.length;
    let rms = 0;
    for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / N);
    if (rms < 0.008) return { f: -1, rms, clarity: 0 };
    const minLag = Math.max(2, Math.floor(sr / 1000));
    const maxLag = Math.min(N - 2, Math.floor(sr / 70));
    let c0 = 0;
    for (let i = 0; i < N; i++) c0 += buf[i] * buf[i];
    const corr = new Float32Array(maxLag + 1);
    let best = -1;
    let bestC = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = 0; i < N - lag; i++) s += buf[i] * buf[i + lag];
      const c = s / c0;
      corr[lag] = c;
      if (c > bestC) {
        bestC = c;
        best = lag;
      }
    }
    if (best < 0 || bestC < 0.45) return { f: -1, rms, clarity: bestC };
    let lag = best;
    const a = corr[best - 1];
    const b = corr[best];
    const cc = corr[best + 1];
    const d = a + cc - 2 * b;
    if (d !== 0) lag = best - (0.5 * (cc - a)) / d;
    return { f: sr / lag, rms, clarity: bestC };
  }

  private findFormants(mag: Float32Array): { f1: number; f2: number } {
    const peakIn = (loHz: number, hiHz: number): number => {
      const lo = Math.max(1, Math.floor(loHz / this.binHz));
      const hi = Math.min(mag.length - 2, Math.ceil(hiHz / this.binHz));
      let bestB = -1;
      let bestV = -1;
      for (let i = lo; i <= hi; i++) {
        const v = (mag[i - 1] + mag[i] + mag[i + 1]) / 3;
        if (v > bestV) {
          bestV = v;
          bestB = i;
        }
      }
      return bestB > 0 ? bestB * this.binHz : 0;
    };
    return { f1: peakIn(250, 900), f2: peakIn(900, 2800) };
  }

  private computeHNR(mag: Float32Array, F0: number): number {
    if (!F0) return 0;
    let harm = 0;
    let noise = 0;
    for (let i = 1; i < mag.length; i++) {
      const f = i * this.binHz;
      const e = mag[i] * mag[i];
      const nearest = Math.round(f / F0) * F0;
      if (nearest > 0 && Math.abs(f - nearest) < F0 * 0.12) harm += e;
      else noise += e;
    }
    if (noise <= 0) return 30;
    return clamp(10 * Math.log10(harm / noise), -5, 30);
  }

  private pushHist(arr: number[], v: number) {
    arr.push(v);
    if (arr.length > this.HMAX) arr.shift();
  }

  private frame(): VoiceReading | null {
    const analyser = this.analyser;
    const pitch = this.pitch;
    if (!analyser || !pitch) return null;
    analyser.getByteFrequencyData(this.freq);
    analyser.getFloatFrequencyData(this.floatFreq);
    pitch.getFloatTimeDomainData(this.pbuf);

    const mag = new Float32Array(this.freq.length);
    for (let i = 0; i < this.freq.length; i++) mag[i] = Math.pow(10, this.floatFreq[i] / 20);

    const p = this.detectPitch(this.pbuf, this.SR);
    const voiced = p.f >= 65 && p.f <= 1200;
    if (voiced) this.f0s = this.f0s ? this.f0s * 0.7 + p.f * 0.3 : p.f;
    const F0 = voiced ? this.f0s : 0;

    let amp = 0;
    for (let i = 0; i < this.pbuf.length; i++) amp += this.pbuf[i] * this.pbuf[i];
    amp = Math.sqrt(amp / this.pbuf.length);

    let loE = 0;
    let hiE = 0;
    let cN = 0;
    let cD = 0;
    for (let i = 1; i < this.freq.length; i++) {
      const f = i * this.binHz;
      const v = this.freq[i];
      cN += f * v;
      cD += v;
      if (f >= 80 && f <= 400) loE += v;
      if (f >= 2000 && f <= 8000) hiE += v;
    }
    const centroid = cD > 0 ? cN / cD : 70;
    const brightness = clamp((Math.log(Math.max(centroid, 100)) - Math.log(200)) / (Math.log(5000) - Math.log(200)));
    const energy = clamp((loE + hiE) / 12000);
    const register = F0 ? clamp((Math.log(F0) - Math.log(70)) / (Math.log(1000) - Math.log(70))) : 0;

    if (voiced) {
      this.pushHist(this.f0Hist, F0);
      this.pushHist(this.ampHist, amp);
    }
    const onset = amp > this.lastAmp * 1.35 && amp > 0.01 ? 1 : 0;
    this.pushHist(this.onsetHist, onset);
    this.lastAmp = amp;

    const f0mean = mean(this.f0Hist) || 1;
    const jitter = clamp(meanAbsDiff(this.f0Hist) / Math.max(3, f0mean * 0.04));
    const ampmean = mean(this.ampHist) || 1e-6;
    const shimmer = clamp(meanAbsDiff(this.ampHist) / Math.max(0.008, ampmean * 0.55));
    const f0var = clamp(std(this.f0Hist) / 30);
    const rate = clamp(mean(this.onsetHist) * 6);

    const { f1, f2 } = this.findFormants(mag);
    const profC = loadProfile();
    let constriction = 0.3;
    if (profC && profC.obs >= WARMUP && profC.f1 > 0 && f1 > 0) {
      constriction = clamp(
        0.3 + ((profC.f1 - f1) / Math.max(200, profC.f1 * 0.6)) * 0.5 + ((profC.f2 - f2) / Math.max(500, profC.f2 * 0.5)) * 0.3,
      );
    }

    const hnr = this.computeHNR(mag, F0);
    const hnrNorm = clamp((hnr + 5) / 35);

    for (let i = 0; i < 60; i++) {
      const tf = 65.4064 * Math.pow(2, i / 12);
      const bin = Math.round(tf / this.binHz);
      let peak = 0;
      for (let b = Math.max(1, bin - 1); b <= Math.min(this.freq.length - 1, bin + 1); b++) if (this.freq[b] > peak) peak = this.freq[b];
      const lvl = peak / 255;
      this.tv[i] = lvl > this.tv[i] ? lvl : this.tv[i] * 0.85 + lvl * 0.15;
    }

    const feats: VoiceFeatures = { f0: F0, register, brightness, energy, jitter, shimmer, f0var, rate, f1, f2, constriction, hnr, hnrNorm, voiced };

    const now = performance.now();
    const st = analyze(feats, this.ctxText);
    const SMOOTH = 0.06;
    if (voiced) {
      if (!this.smInit) {
        this.smAr = st.arousal;
        this.smVa = st.valence;
        this.smTe = st.tension;
        this.smInit = true;
      } else {
        this.smAr += (st.arousal - this.smAr) * SMOOTH;
        this.smVa += (st.valence - this.smVa) * SMOOTH;
        this.smTe += (st.tension - this.smTe) * SMOOTH;
      }
    }

    const STATE_HOLD_MS = 5000;
    const smLabel = labelOf(this.smAr, this.smVa, this.smTe, feats);
    if (this.shownLabel === '—' || (now - this.lastLabelChange > STATE_HOLD_MS && smLabel.label !== this.shownLabel)) {
      this.shownLabel = smLabel.label;
      this.shownDesc = smLabel.desc;
      this.lastLabelChange = now;
    }
    if (voiced && now - this.lastUpd > 1400) {
      this.lastUpd = now;
      updateProfile(feats as unknown as Record<string, number>);
    }

    let stability = 0;
    let trend: 'up' | 'down' | 'flat' = 'flat';
    if (voiced) {
      this.teTrend.push(this.smTe);
      if (this.teTrend.length > 120) this.teTrend.shift();
    }
    if (this.smInit && this.teTrend.length > 10) {
      stability = clamp(1 - std(this.teTrend) * 4);
      const half = Math.floor(this.teTrend.length / 2);
      const d = mean(this.teTrend.slice(half)) - mean(this.teTrend.slice(0, half));
      trend = d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat';
    }

    const prof = loadProfile();
    return {
      feats,
      arousal: this.smAr,
      valence: this.smVa,
      tension: this.smTe,
      label: this.smInit ? this.shownLabel : 'считываю…',
      desc: this.shownDesc,
      note: noteOf(F0),
      warming: (prof?.obs ?? 0) < WARMUP,
      obs: prof?.obs ?? 0,
      stability,
      trend,
      overtones: this.tv.slice(),
    };
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.actx?.close().catch(() => undefined);
    this.actx = null;
    this.analyser = null;
    this.pitch = null;
  }
}
