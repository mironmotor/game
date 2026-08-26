/**
 * MIR VISION — ЕДИНЫЙ СТИЛЬ мира GAME.
 *
 * Один свод правил на всё, что рисуется в мете: землю, объекты, подписи, поток.
 * Смысл в том, чтобы сцена читалась как ОДИН кадр одной модели зрения, а не как
 * набор эффектов. Любой новый объект берёт материалы отсюда — и попадает в стиль
 * автоматически.
 *
 * ПРАВИЛА (нарушать — значит выпасть из стиля):
 *  1. Цвет несёт смысл, а не настроение. Четыре роли, ни одной сверх:
 *       structure — чертёж: сетка земли, рёбра, оси, подписи;
 *       mass      — объём: тела, оболочки, столбы света;
 *       energy    — жизнь: поток, прогресс, вспышки, всё что движется;
 *       hot       — бело-горячее, только сердцевина, не больше ~5% кадра.
 *     Роли берутся из ЖИВЫХ переменных темы (--hud-cyan/purple/magenta), поэтому
 *     мир перекрашивается вместе с интерфейсом — это тот же адаптивный HUD.
 *  2. Ничего непрозрачного. Всё аддитивное, depthWrite: false — мир СВЕТИТСЯ
 *     поверх обоев, а не закрывает их. Значит — никакого фотореализма и текстур.
 *  3. Объём набирается СЛОЯМИ, а не толщиной: линия всегда в один пиксель,
 *     плотность делают вложенные каркасы, оболочки Френеля и точки.
 *  4. Всё стоит НА ЗЕМЛЕ. Парящее обязано иметь якорь — столб света или кольцо
 *     на грунте под собой. Без якоря объект читается как наклейка.
 *  5. Далёкое гаснет в цвет пустоты (deep). Туман не рисуем — гасим сам цвет,
 *     иначе аддитивное смешение осветляет даль вместо того, чтобы её съедать.
 *  6. Движение медленное: 0.02–0.2 рад/с. Быстрее — только на мысли и речи ядра.
 *  7. Подписи — верхний регистр, разрядка, только цветом structure, всегда лицом
 *     к камере и всегда выше своего объекта.
 *
 * Тот же свод словами — в VISION_STYLE_CARD (для генерации/описания кадров).
 */

import * as THREE from 'three';

export interface VisionPalette {
  /** Чертёж: сетка, рёбра, подписи. */
  structure: THREE.Color;
  /** Объём: тела, оболочки, столбы. */
  mass: THREE.Color;
  /** Жизнь: поток, прогресс, вспышки. */
  energy: THREE.Color;
  /** Бело-горячее — сердцевина. */
  hot: THREE.Color;
  /** Пустота: даль, в которую всё гаснет. */
  deep: THREE.Color;
}

const FALLBACK = { structure: '#00f2ff', mass: '#a855f7', energy: '#d946ef' };

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

function toColor(value: string, fallback: string): THREE.Color {
  try {
    return new THREE.Color(value);
  } catch {
    return new THREE.Color(fallback);
  }
}

/** Живая палитра из переменных активной темы HUD. */
export function readPalette(): VisionPalette {
  const structure = toColor(cssVar('--hud-cyan', FALLBACK.structure), FALLBACK.structure);
  const mass = toColor(cssVar('--hud-purple', FALLBACK.mass), FALLBACK.mass);
  const energy = toColor(cssVar('--hud-magenta', FALLBACK.energy), FALLBACK.energy);
  return {
    structure,
    mass,
    energy,
    hot: energy.clone().lerp(new THREE.Color(0xffffff), 0.6),
    deep: mass.clone().multiplyScalar(0.05),
  };
}

/** Отпечаток палитры — по нему ловим смену темы, не сравнивая цвета руками. */
export function paletteKey(p: VisionPalette): string {
  return `${p.structure.getHexString()}${p.mass.getHexString()}${p.energy.getHexString()}`;
}

/** Числовые настройки стиля. Общие для всех объектов мира. */
export const VISION = {
  /** Доля высоты экрана, на которой стоит горизонт. Выше середины экрана его
   * держать нельзя: снизу идут окна чата и вывода, мир должен уместиться над ними. */
  horizon: { desktop: 0.5, mobile: 0.4 },
  fov: 46,
  /** Земля: полярная сетка. */
  grid: { radius: 46, rings: 17, spokes: 36, nearFade: 14, farFade: 58, coreHalo: 12 },
  /** Дыхание мира, рад/с. */
  spin: { slow: 0.02, ring: 0.07, coin: 0.45 },
  /** Прозрачности по ролям — одинаковые во всех объектах. */
  alpha: { grid: 0.46, edge: 0.7, fill: 0.11, glow: 0.45, label: 0.85 },
} as const;

export type VisionTier = 'low' | 'mid' | 'high';

/** Во что рисуем на этом устройстве. Телефон и слабое железо — всегда 'low'. */
export function visionTier(): VisionTier {
  if (typeof window === 'undefined') return 'mid';
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const mobile = window.matchMedia('(max-width: 700px)').matches;
  if (mobile || cores <= 4 || memory <= 4) return 'low';
  if (cores <= 8) return 'mid';
  return 'high';
}

/** Пользователь просил покой — мир замирает, но не исчезает. */
export function prefersCalm(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Гашение земли (правило №5), вшитое в вершинные цвета.
 *
 * Два закона разом: под ногами ярко и к горизонту гаснет в пустоту — это даёт
 * глубину; и отдельным ореолом светится круг вокруг ядра — мир освещён ядром,
 * поэтому у его подножия земля видна, даже когда до неё далеко.
 */
export function groundFade(distanceToCamera: number, distanceToCore: number): number {
  const { nearFade, farFade, coreHalo } = VISION.grid;
  const near = 1 - Math.max(0, Math.min(1, (distanceToCamera - nearFade) / (farFade - nearFade)));
  // У самых ног земля тоже гаснет: там низ кадра, где стоят чат и вывод, и яркая
  // сетка под ними только мешала бы читать текст. Ярче всего — средний план.
  const foot = Math.max(0, Math.min(1, (distanceToCamera - 2) / nearFade));
  const halo = 1 - Math.max(0, Math.min(1, distanceToCore / coreHalo));
  return Math.min(1, Math.max(Math.pow(near, 1.25) * foot, halo * 0.6));
}

// ─────────────────────────── материалы стиля ───────────────────────────

/** Линия чертежа. Всегда в один пиксель — объём набирается слоями (правило №3). */
export function lineMaterial(color: THREE.Color, opacity: number, vertexColors = false) {
  return new THREE.LineBasicMaterial({
    color: color.clone(),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors,
    fog: false,
  });
}

/** Заливка объёма — почти прозрачная, только чтобы каркас читался телом. */
export function fillMaterial(color: THREE.Color, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color: color.clone(),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
}

const SHELL_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vViewDir;
void main(){
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
uniform float uIntensity;
varying vec3 vNormalW;
varying vec3 vViewDir;
void main(){
  float fresnel = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), uPower);
  float a = fresnel * uIntensity;
  gl_FragColor = vec4(uColor * a, a);
}
`;

/** Оболочка Френеля: светятся края, середина пустая. Тело без стены. */
export function shellMaterial(color: THREE.Color, power = 2.6, intensity = 0.55) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uPower: { value: power },
      uIntensity: { value: intensity },
    },
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
}

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vViewDir;
void main(){
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColorBase;
uniform vec3 uColorTop;
uniform float uTime;
uniform float uPower;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vViewDir;
void main(){
  float edge = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), 1.5);
  float rise = pow(1.0 - vUv.y, 1.35);
  float scan = 0.82 + 0.18 * sin(vUv.y * 22.0 - uTime * 2.4);
  float a = edge * rise * scan * uPower;
  vec3 col = mix(uColorBase, uColorTop, vUv.y);
  gl_FragColor = vec4(col * a, a);
}
`;

/** Столб света — якорь всего парящего (правило №4). */
export function beamMaterial(base: THREE.Color, top: THREE.Color, power = 0.85) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorBase: { value: base.clone() },
      uColorTop: { value: top.clone() },
      uTime: { value: 0 },
      uPower: { value: power },
    },
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

const MOTE_VERT = /* glsl */ `
attribute float aScale;
uniform float uSize;
varying float vScale;
void main(){
  vScale = aScale;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * aScale * (60.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vScale;
void main(){
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;
  float a = (1.0 - smoothstep(0.0, 0.5, d)) * uOpacity * (0.5 + vScale * 0.5);
  gl_FragColor = vec4(uColor * a, a);
}
`;

/** Пылинка синапса: мягкая точка без спрайт-текстуры. */
export function moteMaterial(color: THREE.Color, size = 26, opacity = 0.7) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uOpacity: { value: opacity },
      uSize: { value: size },
    },
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

const BAND_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
void main(){
  float band = exp(-abs(vUv.y - 0.5) * 34.0);
  float sides = 1.0 - smoothstep(0.25, 1.0, abs(vUv.x - 0.5) * 2.0);
  float a = band * sides * uIntensity;
  gl_FragColor = vec4(uColor * a, a);
}
`;

const BAND_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Полоса горизонта — тонкая световая черта на краю мира. */
export function bandMaterial(color: THREE.Color, intensity = 0.5) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uIntensity: { value: intensity },
    },
    vertexShader: BAND_VERT,
    fragmentShader: BAND_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

// ─────────────────────────── подписи ───────────────────────────

const LABEL_W = 512;
const LABEL_H = 96;

function paintLabel(canvas: HTMLCanvasElement, text: string, color: THREE.Color) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, LABEL_W, LABEL_H);
  const value = text.toUpperCase().slice(0, 26);
  ctx.font = '600 34px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  // Разрядку рисуем посимвольно: ctx.letterSpacing есть не везде (правило №7).
  const spacing = 6;
  const width = [...value].reduce((sum, ch) => sum + ctx.measureText(ch).width + spacing, -spacing);
  const hex = `#${color.getHexString()}`;
  ctx.fillStyle = hex;
  ctx.shadowColor = hex;
  ctx.shadowBlur = 18;
  let x = (LABEL_W - width) / 2;
  for (const ch of value) {
    ctx.fillText(ch, x, LABEL_H / 2);
    x += ctx.measureText(ch).width + spacing;
  }
}

export interface VisionLabel {
  sprite: THREE.Sprite;
  set: (text: string, color?: THREE.Color) => void;
  dispose: () => void;
}

/** Подпись объекта: спрайт, который всегда смотрит в камеру. */
export function makeLabel(text: string, color: THREE.Color, worldWidth = 3.4): VisionLabel {
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_W;
  canvas.height = LABEL_H;
  paintLabel(canvas, text, color);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: VISION.alpha.label,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldWidth, (worldWidth * LABEL_H) / LABEL_W, 1);
  return {
    sprite,
    set: (next: string, nextColor?: THREE.Color) => {
      paintLabel(canvas, next, nextColor ?? color);
      texture.needsUpdate = true;
    },
    dispose: () => {
      texture.dispose();
      material.dispose();
    },
  };
}

// ─────────────────────────── стиль словами ───────────────────────────

/**
 * Тот же стиль текстом — чтобы модель зрения (и любой генератор кадров) держала
 * ту же картинку, что и движок. Один источник правды на глаза и на код.
 */
export const VISION_STYLE_CARD = [
  'MIR VISION — голографическая проекция мира GAME.',
  'Тёмная земля до горизонта, полярная сетка на грунте, объекты СТОЯТ на земле.',
  'Только каркасы, точки и градиентные свечения: ни текстур, ни фотореализма, ни теней.',
  'Всё аддитивно светится поверх фона; линии в один пиксель, объём — вложенными слоями.',
  'Палитра ровно из трёх ролей: циан — чертёж и подписи, фиолет — объём, магента — движение и энергия;',
  'бело-горячее только в сердцевине, не больше 5% кадра.',
  'Даль гаснет в пустоту, у горизонта — тонкая светящаяся полоса.',
  'Камера на уровне глаз, горизонт чуть ниже середины кадра, движение медленное.',
  'Подписи — верхний регистр с разрядкой, всегда над своим объектом.',
].join(' ');
