/**
 * Ambient audio — общий микрофонный анализатор «звука пространства», который
 * слышит MAX. Один разделяемый поток + AnalyserNode на всё приложение: ядро
 * (NeuralCore) деформируется под живой звук комнаты.
 *
 * Приватность: микрофон НЕ пишется и НЕ отправляется никуда — только локальный
 * Web Audio анализ амплитуд для визуализации. Запуск — по жесту пользователя
 * (политика браузера + запрос разрешения). При отказе/недоступности ядро живёт
 * на органической анимации.
 */

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let stream: MediaStream | null = null;
let data: Uint8Array<ArrayBuffer> | null = null;
let started = false;
let starting = false;

export function ambientActive(): boolean {
  return started;
}

/** Запросить микрофон и поднять анализатор. Идемпотентно. Зови по жесту. */
export async function startAmbient(): Promise<boolean> {
  if (started) return true;
  if (starting) return false;
  if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
  starting = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return false;
    ctx = new Ctx();
    if (ctx.state === 'suspended') await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256; // 128 частотных бинов — достаточно для кольца
    analyser.smoothingTimeConstant = 0.82; // плавная деформация, без дёрганья
    src.connect(analyser); // НЕ подключаем к destination — никакой обратной связи
    data = new Uint8Array(analyser.frequencyBinCount);
    started = true;
    return true;
  } catch {
    return false; // нет разрешения / нет устройства — органический фолбэк
  } finally {
    starting = false;
  }
}

/** Кадр анализа: спектр (0..255 по бинам) + общий уровень 0..1. null если не запущен. */
export function ambientFrame(): { data: Uint8Array; level: number; bins: number } | null {
  if (!started || !analyser || !data) return null;
  analyser.getByteFrequencyData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return { data, level: sum / data.length / 255, bins: data.length };
}

export function stopAmbient(): void {
  try {
    stream?.getTracks().forEach((t) => t.stop());
    void ctx?.close();
  } catch {
    /* best-effort */
  }
  ctx = null;
  analyser = null;
  stream = null;
  data = null;
  started = false;
}
