/**
 * binaural — чистый Web Audio генератор бинауральных ритмов для «Ауры».
 * Два синуса: левое ухо = carrier − beat/2, правое = carrier + beat/2. Мозг слышит
 * разницу (beat, Гц) и мягко подстраивает ритм под неё. Работает ТОЛЬКО в наушниках
 * (нужна стерео-развязка каналов). Опционально — розовый шум-подложка для комфорта.
 * Никакого мигания/вспышек — только звук; визуал в UI держим медленным (safety).
 */

export interface BinauralHandle {
  stop: () => void;
  set: (opts: { carrier?: number; beat?: number; volume?: number; noise?: number }) => void;
}

function pinkNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return buf;
}

export function startBinaural(opts: { carrier: number; beat: number; volume: number; noise?: number }): BinauralHandle | null {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();

  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);
  // gentle 1.5s fade-in (no clicks / abrupt onset)
  master.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.volume), ctx.currentTime + 1.5);

  const half = opts.beat / 2;

  const lOsc = ctx.createOscillator();
  lOsc.type = 'sine';
  lOsc.frequency.value = opts.carrier - half;
  const lPan = ctx.createStereoPanner();
  lPan.pan.value = -1;
  const lg = ctx.createGain();
  lg.gain.value = 0.5;
  lOsc.connect(lg).connect(lPan).connect(master);

  const rOsc = ctx.createOscillator();
  rOsc.type = 'sine';
  rOsc.frequency.value = opts.carrier + half;
  const rPan = ctx.createStereoPanner();
  rPan.pan.value = 1;
  const rg = ctx.createGain();
  rg.gain.value = 0.5;
  rOsc.connect(rg).connect(rPan).connect(master);

  // optional pink-noise bed (comfort / masking)
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = pinkNoiseBuffer(ctx);
  noiseSrc.loop = true;
  const noiseLp = ctx.createBiquadFilter();
  noiseLp.type = 'lowpass';
  noiseLp.frequency.value = 1200;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = opts.noise ?? 0;
  noiseSrc.connect(noiseLp).connect(noiseGain).connect(master);

  lOsc.start();
  rOsc.start();
  noiseSrc.start();
  void ctx.resume();

  let curCarrier = opts.carrier;
  let curBeat = opts.beat;

  return {
    stop() {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      window.setTimeout(() => {
        try {
          lOsc.stop();
          rOsc.stop();
          noiseSrc.stop();
        } catch {
          /* already stopped */
        }
        void ctx.close();
      }, 700);
    },
    set({ carrier, beat, volume, noise }) {
      const t = ctx.currentTime;
      if (typeof carrier === 'number') curCarrier = carrier;
      if (typeof beat === 'number') curBeat = beat;
      if (typeof carrier === 'number' || typeof beat === 'number') {
        const h = curBeat / 2;
        lOsc.frequency.linearRampToValueAtTime(curCarrier - h, t + 0.2);
        rOsc.frequency.linearRampToValueAtTime(curCarrier + h, t + 0.2);
      }
      if (typeof volume === 'number') master.gain.linearRampToValueAtTime(Math.max(0.0002, volume), t + 0.2);
      if (typeof noise === 'number') noiseGain.gain.linearRampToValueAtTime(noise, t + 0.2);
    },
  };
}
