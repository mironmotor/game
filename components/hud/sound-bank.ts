/**
 * SoundBank — Max's synthesized instrument database (Phase 9.7).
 *
 * No samples, no network: every instrument is rendered mathematically into an
 * AudioBuffer — classic synthesis recipes (sine-sweep kick, noise snare,
 * Karplus-Strong plucked string, FM bell). Noise comes from a seeded PRNG, so
 * the same seed always produces the SAME drum kit — Max's sounds are as
 * deterministic as his dreams. Buffers are cached per (name, freq).
 */

export type Rnd = () => number;

const cacheKey = (name: string, freq: number) => `${name}:${Math.round(freq)}`;

export class SoundBank {
  private cache = new Map<string, AudioBuffer>();

  constructor(
    private ctx: BaseAudioContext,
    private rnd: Rnd,
  ) {}

  /** Trigger an instrument at time t. rate shifts pitch (1 = as rendered). */
  hit(dest: AudioNode, name: string, t: number, vol: number, freq = 0, rate = 1): void {
    const buffer = this.get(name, freq);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(dest);
    src.start(t);
  }

  get(name: string, freq = 0): AudioBuffer | null {
    const key = cacheKey(name, freq);
    let buffer = this.cache.get(key) ?? null;
    if (buffer) return buffer;
    const sr = this.ctx.sampleRate;
    let data: Float32Array | null = null;
    switch (name) {
      case 'kick': data = this.kick(sr); break;
      case 'snare': data = this.snare(sr); break;
      case 'hat': data = this.hat(sr, 0.05); break;
      case 'openhat': data = this.hat(sr, 0.3); break;
      case 'clap': data = this.clap(sr); break;
      case 'tom': data = this.tom(sr, freq || 110); break;
      case 'shaker': data = this.shaker(sr); break;
      case 'pluck': data = this.pluck(sr, freq || 220); break;
      case 'bell': data = this.bell(sr, freq || 880); break;
      default: return null;
    }
    buffer = this.ctx.createBuffer(1, data.length, sr);
    buffer.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    this.cache.set(key, buffer);
    return buffer;
  }

  // --- drum recipes --------------------------------------------------------
  private kick(sr: number): Float32Array {
    const n = Math.floor(sr * 0.35);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = 42 + 100 * Math.exp(-t * 28); // 142 → 42 Hz sweep
      phase += (2 * Math.PI * f) / sr;
      let v = Math.sin(phase) * Math.exp(-t * 9);
      if (t < 0.004) v += (this.rnd() * 2 - 1) * 0.5 * (1 - t / 0.004); // click
      out[i] = v * 0.95;
    }
    return out;
  }

  private snare(sr: number): Float32Array {
    const n = Math.floor(sr * 0.22);
    const out = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const noise = this.rnd() * 2 - 1;
      const hp = noise - prev; // crude highpass
      prev = noise * 0.5;
      const body = Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 30) * 0.5;
      out[i] = (hp * Math.exp(-t * 18) * 0.7 + body) * 0.8;
    }
    return out;
  }

  private hat(sr: number, decay: number): Float32Array {
    const n = Math.floor(sr * (decay + 0.03));
    const out = new Float32Array(n);
    let p1 = 0;
    let p2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const noise = this.rnd() * 2 - 1;
      const d1 = noise - p1; // double-diff ≈ steep highpass → metallic hiss
      p1 = noise;
      const d2 = d1 - p2;
      p2 = d1;
      out[i] = d2 * Math.exp(-t / (decay * 0.35)) * 0.5;
    }
    return out;
  }

  private clap(sr: number): Float32Array {
    const n = Math.floor(sr * 0.25);
    const out = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const noise = this.rnd() * 2 - 1;
      const hp = noise - prev * 0.7;
      prev = noise;
      // three bursts 11ms apart, then a tail
      let env = 0;
      for (const b of [0, 0.011, 0.022]) {
        if (t >= b) env = Math.max(env, Math.exp(-(t - b) * 60));
      }
      env = Math.max(env, t > 0.03 ? Math.exp(-(t - 0.03) * 14) * 0.7 : 0);
      out[i] = hp * env * 0.6;
    }
    return out;
  }

  private tom(sr: number, freq: number): Float32Array {
    const n = Math.floor(sr * 0.3);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = freq * (1 + 0.6 * Math.exp(-t * 22));
      phase += (2 * Math.PI * f) / sr;
      out[i] = Math.sin(phase) * Math.exp(-t * 10) * 0.8;
    }
    return out;
  }

  private shaker(sr: number): Float32Array {
    const n = Math.floor(sr * 0.12);
    const out = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const noise = this.rnd() * 2 - 1;
      const hp = noise - prev;
      prev = noise;
      const env = t < 0.02 ? t / 0.02 : Math.exp(-(t - 0.02) * 35);
      out[i] = hp * env * 0.35;
    }
    return out;
  }

  // --- melodic recipes -----------------------------------------------------
  /** Karplus-Strong plucked string — живая струна из шума и задержки. */
  private pluck(sr: number, freq: number): Float32Array {
    const dur = 1.2;
    const n = Math.floor(sr * dur);
    const out = new Float32Array(n);
    const period = Math.max(2, Math.round(sr / freq));
    const buf = new Float32Array(period);
    for (let i = 0; i < period; i++) buf[i] = this.rnd() * 2 - 1;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const cur = buf[idx];
      const nxt = buf[(idx + 1) % period];
      out[i] = cur * 0.8;
      buf[idx] = (cur + nxt) * 0.5 * 0.996; // lowpass + damping
      idx = (idx + 1) % period;
    }
    return out;
  }

  /** FM bell — колокольчик для инсайтов. */
  private bell(sr: number, freq: number): Float32Array {
    const dur = 1.6;
    const n = Math.floor(sr * dur);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const mod = Math.sin(2 * Math.PI * freq * 3.01 * t) * 2.2 * Math.exp(-t * 3);
      out[i] = Math.sin(2 * Math.PI * freq * t + mod) * Math.exp(-t * 2.4) * 0.4;
    }
    return out;
  }
}
