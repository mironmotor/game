/**
 * MusicDecomposer — Max's ears for MUSIC (Phase 9, Dreaming Music).
 *
 * While listening it samples the AnalyserNode (~20 Hz) and extracts per frame:
 * band energies (bass/mid/treble), spectral brightness, a 12-bin chromagram and
 * onset flags. `summarize()` folds the window into one observation: BPM (onset
 * autocorrelation), rhythmic regularity, dynamics, dominant chroma (key-ish)
 * and a minor-likeness guess. Everything local — only numbers leave the page.
 */

export interface MusicSummary {
  bpm: number;
  energy: number;
  bass: number;
  mid: number;
  treble: number;
  brightness: number;
  regularity: number;
  dynamics: number;
  key: string;
  minor_like: number;
  duration_sec: number;
  frames: number;
}

interface MusicFrame {
  t: number;
  energy: number;
  bass: number;
  mid: number;
  treble: number;
  centroid: number;
  onset: boolean;
  chroma: Float32Array;
}

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SAMPLE_MS = 50;
const KEEP_SEC = 45;
const FFT_SIZE = 4096;

export class MusicDecomposer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private freq: Float32Array = new Float32Array(FFT_SIZE / 2);
  private frames: MusicFrame[] = [];
  private lastEnergy = 0;

  async start(): Promise<boolean> {
    if (this.ctx) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      const source = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0.4;
      source.connect(this.analyser);
      this.timer = window.setInterval(() => this.sample(), SAMPLE_MS);
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  private sample(): void {
    const analyser = this.analyser;
    const ctx = this.ctx;
    if (!analyser || !ctx) return;
    analyser.getFloatFrequencyData(this.freq);
    const binHz = ctx.sampleRate / FFT_SIZE;

    let bass = 0;
    let mid = 0;
    let treble = 0;
    let cNum = 0;
    let cDen = 0;
    const chroma = new Float32Array(12);
    for (let i = 1; i < this.freq.length; i++) {
      const f = i * binHz;
      if (f > 9000) break;
      const mag = Math.pow(10, this.freq[i] / 20);
      const e = mag * mag;
      if (f < 250) bass += e;
      else if (f < 2000) mid += e;
      else treble += e;
      cNum += f * mag;
      cDen += mag;
      if (f >= 55 && f <= 2200) {
        const noteIdx = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12; // A=9 → C=0
        chroma[noteIdx] += e;
      }
    }
    const energy = Math.sqrt(bass + mid + treble);
    const onset = energy > this.lastEnergy * 1.4 && energy > 1e-4;
    this.lastEnergy = energy;
    this.frames.push({
      t: Date.now(),
      energy,
      bass,
      mid,
      treble,
      centroid: cDen > 0 ? cNum / cDen : 0,
      onset,
      chroma,
    });
    const cutoff = Date.now() - KEEP_SEC * 1000;
    if (this.frames.length > 8 && this.frames[0].t < cutoff) {
      this.frames = this.frames.filter((f) => f.t >= cutoff);
    }
  }

  /** BPM via autocorrelation of the onset train (60–180 BPM search). */
  private estimateBpm(frames: MusicFrame[]): { bpm: number; regularity: number } {
    const onsets = frames.map((f) => (f.onset ? 1 : 0));
    const fps = 1000 / SAMPLE_MS;
    let bestLag = 0;
    let bestCorr = 0;
    const minLag = Math.round((60 / 180) * fps); // 180 BPM
    const maxLag = Math.round((60 / 60) * fps); // 60 BPM
    const total = onsets.reduce((s, v) => s + v, 0);
    if (total < 6) return { bpm: 0, regularity: 0 };
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i + lag < onsets.length; i++) corr += onsets[i] * onsets[i + lag];
      corr /= total;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
    if (!bestLag) return { bpm: 0, regularity: 0 };
    return { bpm: Math.round((60 * fps) / bestLag), regularity: Math.min(1, bestCorr * 2.2) };
  }

  summarize(windowSec = 20): MusicSummary | null {
    const cutoff = Date.now() - windowSec * 1000;
    const recent = this.frames.filter((f) => f.t >= cutoff);
    if (recent.length < 40) return null;
    const duration = (recent[recent.length - 1].t - recent[0].t) / 1000;

    const energies = recent.map((f) => f.energy);
    const eMean = energies.reduce((s, v) => s + v, 0) / energies.length;
    const eStd = Math.sqrt(energies.reduce((s, v) => s + (v - eMean) ** 2, 0) / energies.length);
    const sums = recent.reduce(
      (acc, f) => {
        acc.bass += f.bass;
        acc.mid += f.mid;
        acc.treble += f.treble;
        acc.centroid += f.centroid;
        return acc;
      },
      { bass: 0, mid: 0, treble: 0, centroid: 0 },
    );
    const totalBand = sums.bass + sums.mid + sums.treble || 1e-9;

    const chroma = new Float32Array(12);
    for (const f of recent) for (let i = 0; i < 12; i++) chroma[i] += f.chroma[i];
    let keyIdx = 0;
    for (let i = 1; i < 12; i++) if (chroma[i] > chroma[keyIdx]) keyIdx = i;
    const chromaTotal = chroma.reduce((s, v) => s + v, 0) || 1e-9;
    // minor-likeness: minor third vs major third energy above the tonic
    const minor3 = chroma[(keyIdx + 3) % 12] / chromaTotal;
    const major3 = chroma[(keyIdx + 4) % 12] / chromaTotal;
    const minorLike = minor3 + major3 > 0 ? minor3 / (minor3 + major3) : 0.5;

    const { bpm, regularity } = this.estimateBpm(recent);
    const centroid = sums.centroid / recent.length;
    return {
      bpm,
      energy: Math.min(1, eMean * 40),
      bass: sums.bass / totalBand,
      mid: sums.mid / totalBand,
      treble: sums.treble / totalBand,
      brightness: Math.min(1, Math.max(0, (Math.log(Math.max(centroid, 100)) - Math.log(200)) / (Math.log(5000) - Math.log(200)))),
      regularity,
      dynamics: Math.min(1, (eStd / Math.max(eMean, 1e-6)) * 1.2),
      key: NOTES[keyIdx],
      minor_like: Math.round(minorLike * 100) / 100,
      duration_sec: Math.round(duration * 10) / 10,
      frames: recent.length,
    };
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.analyser = null;
    this.frames = [];
  }
}
