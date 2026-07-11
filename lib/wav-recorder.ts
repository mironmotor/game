// Микрофон → WAV (16kHz mono, 16-bit PCM). WAV выбран намеренно: его гарантированно
// принимает Gemini-ASR (/api/asr), в отличие от webm/opus у MediaRecorder, чей контейнер
// зависит от браузера. Захват через Web Audio (ScriptProcessor) — работает везде.

export class WavRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private inRate = 48000;
  private readonly outRate = 16000;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.inRate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.node.onaudioprocess = (e) => {
      // Копируем — буфер переиспользуется движком после колбэка.
      this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    this.source.connect(this.node);
    // ScriptProcessor должен быть в графе, чтобы тикать; выход молчит (echo нет).
    this.node.connect(this.ctx.destination);
  }

  async stop(): Promise<Blob> {
    const inRate = this.inRate;
    try {
      this.node?.disconnect();
      this.source?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      await this.ctx?.close();
    } catch {
      /* ignore teardown errors */
    }
    const merged = mergeChunks(this.chunks);
    this.chunks = [];
    const down = downsample(merged, inRate, this.outRate);
    return encodeWav(down, this.outRate);
  }
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function downsample(buf: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return buf;
  const ratio = inRate / outRate;
  const outLen = Math.floor(buf.length / ratio);
  const out = new Float32Array(outLen);
  let pos = 0;
  for (let i = 0; i < outLen; i++) {
    const next = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = Math.floor(i * ratio); j < next && j < buf.length; j++) {
      sum += buf[j];
      count++;
    }
    out[i] = count ? sum / count : 0;
    pos = next;
  }
  void pos;
  return out;
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
