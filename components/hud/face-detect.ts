// Lazy, resilient face detection via face-api.js (TinyFaceDetector). The model
// (~190KB) is served from public/models and the library is dynamically
// imported only when the camera is first used, so it never enters the SSR/initial
// bundle. If the backend or model fails to load, detectFaces returns null and the
// caller falls back to the light+motion sensor — vision still works, just coarser.

import { getPublicPath } from '@/lib/max17-client';

type FaceApi = typeof import('@vladmandic/face-api');

const MODEL_URL = getPublicPath('models');

let faceapi: FaceApi | null = null;
let loadPromise: Promise<FaceApi | null> | null = null;

async function loadFaceApi(): Promise<FaceApi | null> {
  if (faceapi) return faceapi;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const mod = await import('@vladmandic/face-api');
      // tfjs is bundled but its re-exported namespace types omit these helpers.
      const tf = mod.tf as unknown as {
        setBackend?: (backend: string) => Promise<boolean>;
        ready?: () => Promise<void>;
      };
      // WebGL is much faster on the 2015 Air's iGPU; fall back to CPU if missing.
      try {
        await tf.setBackend?.('webgl');
      } catch {
        await tf.setBackend?.('cpu');
      }
      await tf.ready?.();
      await mod.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
      // 68-point face landmarks → точечная сетка лица (не квадрат). ~356KB, локально.
      try {
        await mod.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
      } catch (e) {
        console.warn('[Max17 HUD] лэндмарки лица недоступны, остаюсь на рамке', e);
      }
      faceapi = mod;
      return mod;
    } catch (error) {
      console.warn('[Max17 HUD] детектор лиц недоступен, остаюсь на свете+движении', error);
      return null;
    }
  })();
  return loadPromise;
}

/** Kick off model load ahead of the first detection (e.g. when camera turns on). */
export function prewarmFaceApi(): void {
  void loadFaceApi();
}

export interface FaceBox {
  // Normalized 0..1 relative to the frame, so callers scale to any display size.
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FacePoint {
  x: number; // нормировано 0..1 к кадру
  y: number;
}

export interface FaceReading {
  count: number;
  // Largest face box area / frame area (0..1) — a rough "how close" proxy.
  coverage: number;
  // Detected face rectangles (normalized) for drawing the outline overlay.
  boxes: FaceBox[];
  // 68 точек-лэндмарков на лицо (нормировано) — для точечной сетки/фрактала.
  meshes: FacePoint[][];
  // Есть ли реальные лэндмарки (модель загрузилась), иначе только boxes.
  hasMesh: boolean;
}

/** Detect faces in the current video frame. Returns null if detection is
 *  unavailable (model not loaded / backend error) so callers degrade gracefully. */
export async function detectFaces(video: HTMLVideoElement): Promise<FaceReading | null> {
  const api = await loadFaceApi();
  if (!api) return null;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  try {
    const options = new api.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
    const hasLandmarks = Boolean(api.nets.faceLandmark68Net.isLoaded);
    const boxes: FaceBox[] = [];
    const meshes: FacePoint[][] = [];
    let maxArea = 0;
    let count = 0;

    if (hasLandmarks) {
      const results = await api.detectAllFaces(video, options).withFaceLandmarks();
      count = results.length;
      for (const r of results) {
        const { x, y, width, height } = r.detection.box;
        const area = width * height;
        if (area > maxArea) maxArea = area;
        boxes.push({ x: x / w, y: y / h, w: width / w, h: height / h });
        meshes.push(r.landmarks.positions.map((p) => ({ x: p.x / w, y: p.y / h })));
      }
    } else {
      const detections = await api.detectAllFaces(video, options);
      count = detections.length;
      for (const det of detections) {
        const { x, y, width, height } = det.box;
        const area = width * height;
        if (area > maxArea) maxArea = area;
        boxes.push({ x: x / w, y: y / h, w: width / w, h: height / h });
      }
    }
    const coverage = w && h ? Number((maxArea / (w * h)).toFixed(3)) : 0;
    return { count, coverage, boxes, meshes, hasMesh: hasLandmarks };
  } catch (error) {
    console.warn('[Max17 HUD] детекция лиц не удалась', error);
    return null;
  }
}
