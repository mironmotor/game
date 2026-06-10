/**
 * VoiceDecomposer — sound → state sensor for Max17 (audio twin of face-detect).
 *
 * While the mic is open it samples the Web Audio AnalyserNode (~20 Hz) and
 * extracts raw prosody per frame: RMS energy, pitch (autocorrelation, 70–400 Hz)
 * and voicedness. `summarize()` folds the recent frames into one compact
 * observation (energy / pitch median+variance / tempo as speech-burst rate /
 * pause ratio) that the HUD ships to the core as a `voice_observation` event —
 * the deterministic state reading happens server-side in mark17/voice_state.py.
 *
 * Fully local: nothing leaves the machine except the numeric summary.
 */

export interface VoiceSummary {
  energy: number; // 0..1 mean RMS of voiced frames
  pitch_hz: number; // median pitch of voiced frames
  pitch_var: number; // std deviation of pitch, Hz
  tempo: number; // voiced bursts per second (~syllable groups)
  pause_ratio: number; // 1 - voiced share of the window
  voiced_ratio: number;
  duration_sec: number;
  frames: number;
}

interface VoiceFrame {
  t: number;
  energy: number;
  pitchHz: number;
  voiced: boolean;
}

const SAMPLE_MS = 50;
const WINDOW_SIZE = 2048;
const KEEP_SEC = 30;
const ENERGY_FLOOR = 0.012; // below this a frame counts as silence
const PITCH_MIN_HZ = 70;
const PITCH_MAX_HZ = 400;

export class VoiceDecomposer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private buf = new Float32Array(WINDOW_SIZE);
  private frames: VoiceFrame[] = [];

  async start(): Promise<boolean> {
    if (this.ctx) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      const source = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = WINDOW_SIZE;
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
    analyser.getFloatTimeDomainData(this.buf);

    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const energy = Math.sqrt(sum / this.buf.length);

    let pitchHz = 0;
    if (energy > ENERGY_FLOOR) {
      pitchHz = this.estimatePitch(ctx.sampleRate);
    }
    this.frames.push({ t: Date.now(), energy, pitchHz, voiced: energy > ENERGY_FLOOR && pitchHz > 0 });

    const cutoff = Date.now() - KEEP_SEC * 1000;
    if (this.frames.length > 4 && this.frames[0].t < cutoff) {
      this.frames = this.frames.filter((f) => f.t >= cutoff);
    }
  }

  /** Normalized autocorrelation over the analysis window; returns 0 if no clear pitch. */
  private estimatePitch(sampleRate: number): number {
    const minLag = Math.floor(sampleRate / PITCH_MAX_HZ);
    const maxLag = Math.min(Math.floor(sampleRate / PITCH_MIN_HZ), this.buf.length - 1);
    let bestLag = 0;
    let bestCorr = 0;
    let norm = 0;
    for (let i = 0; i < this.buf.length; i++) norm += this.buf[i] * this.buf[i];
    if (norm <= 0) return 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < this.buf.length - lag; i++) corr += this.buf[i] * this.buf[i + lag];
      corr /= norm;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
    if (bestCorr < 0.3 || bestLag === 0) return 0;
    return sampleRate / bestLag;
  }

  /** Fold the last `windowSec` of frames into one observation (null if no speech). */
  summarize(windowSec = 12): VoiceSummary | null {
    const cutoff = Date.now() - windowSec * 1000;
    const recent = this.frames.filter((f) => f.t >= cutoff);
    if (recent.length < 8) return null;

    const voiced = recent.filter((f) => f.voiced);
    const voicedRatio = voiced.length / recent.length;
    const duration = (recent[recent.length - 1].t - recent[0].t) / 1000;
    if (voiced.length === 0 || duration <= 0.5) {
      return {
        energy: 0,
        pitch_hz: 0,
        pitch_var: 0,
        tempo: 0,
        pause_ratio: 1,
        voiced_ratio: 0,
        duration_sec: Math.max(0, duration),
        frames: recent.length,
      };
    }

    const energy = voiced.reduce((s, f) => s + f.energy, 0) / voiced.length;
    const pitches = voiced.map((f) => f.pitchHz).sort((a, b) => a - b);
    const pitchMed = pitches[Math.floor(pitches.length / 2)];
    const pitchMean = pitches.reduce((s, v) => s + v, 0) / pitches.length;
    const pitchVar = Math.sqrt(pitches.reduce((s, v) => s + (v - pitchMean) ** 2, 0) / pitches.length);

    // Tempo: unvoiced→voiced transitions per second ≈ speech bursts (syllable groups).
    let bursts = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].voiced && !recent[i - 1].voiced) bursts++;
    }
    const tempo = bursts / duration;

    return {
      energy: Math.min(1, energy * 6), // mic RMS is small; rescale to ~0..1
      pitch_hz: Math.round(pitchMed),
      pitch_var: Math.round(pitchVar * 10) / 10,
      tempo: Math.round(tempo * 100) / 100,
      pause_ratio: Math.round((1 - voicedRatio) * 100) / 100,
      voiced_ratio: Math.round(voicedRatio * 100) / 100,
      duration_sec: Math.round(duration * 10) / 10,
      frames: recent.length,
    };
  }

  /** Drop accumulated frames (after an observation has been shipped). */
  reset(): void {
    this.frames = [];
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
