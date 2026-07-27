'use client';

/**
 * MaxCore3D — объёмное 3D-присутствие MAX в центре меты (WebGL / three.js).
 * Молотое ядро-сердце + деформирующаяся икосфера (шейдерное «дыхание»), богатый
 * градиент магента→фиолет→циан с бело-горячими гребнями, двуслойная атмосфера,
 * мягкие мерцающие частицы и КИНЕМАТОГРАФИЧНЫЙ bloom (UnrealBloomPass).
 * РЕАГИРУЕТ на:
 *   • микрофон («уши» MAX) — lib/ambient-audio (level + спектр),
 *   • max:thinking / max:speaking (мысли и речь) — свечение вспыхивает на речи,
 *   • мышь — лёгкий параллакс камеры (живое присутствие).
 *
 * Полноэкранный оверлей, дефолт скрыт. Тумблер — событие `max3d:toggle`
 * (или `/3d` / `/ядро` в чате), Esc — закрыть. Пока закрыт — рендерит null,
 * никакого WebGL-контекста.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { X } from 'lucide-react';
import { ambientFrame, ambientActive, startAmbient } from '@/lib/ambient-audio';

// Ashima simplex noise 3D (public domain) — общий для всех шейдеров с деформацией.
const SNOISE = /* glsl */ `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

// Оболочка: деформирующаяся икосфера — тело MAX.
const VERT = /* glsl */ `
uniform float uTime;
uniform float uAudio;
uniform float uThinking;
uniform float uSpeaking;
varying float vNoise;
varying vec3 vNormalW;
varying vec3 vViewDir;
${SNOISE}
void main(){
  float speed = 0.32 + uThinking*0.9 + uSpeaking*0.5;
  float amp = 0.15 + uAudio*0.5 + uThinking*0.16 + uSpeaking*0.12;
  float n = snoise(normal * 1.6 + vec3(uTime*speed));
  n += 0.5 * snoise(normal * 3.4 + vec3(uTime*speed*1.6));
  n += 0.25 * snoise(normal * 6.8 + vec3(uTime*speed*2.2));
  vNoise = n;
  vec3 displaced = position + normal * n * amp;
  vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
  vNormalW = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform float uAudio;
uniform float uSpeaking;
uniform vec3 uColorA; // magenta
uniform vec3 uColorB; // cyan
uniform vec3 uColorM; // violet (середина)
varying float vNoise;
varying vec3 vNormalW;
varying vec3 vViewDir;
void main(){
  float fres = pow(1.0 - max(dot(vNormalW, vViewDir), 0.0), 2.2);
  float m = clamp(vNoise*0.5 + 0.5, 0.0, 1.0);
  // Тройной градиент: магента → фиолет → циан.
  vec3 col = m < 0.5 ? mix(uColorA, uColorM, m*2.0) : mix(uColorM, uColorB, (m-0.5)*2.0);
  // Френель-обод.
  col += fres * (0.36 + uAudio*0.4 + uSpeaking*0.22);
  // Тёпло-магентовые гребни на пиках шума — «жар» ядра (не выжигаем в белый).
  col += smoothstep(0.72, 1.0, m) * (0.26 + uSpeaking*0.3) * vec3(1.0, 0.5, 0.88);
  float alpha = 0.26 + fres*0.34;
  gl_FragColor = vec4(col, alpha);
}
`;

// Внутреннее ядро-сердце: горячий центр, чтобы сфера не была полой.
const CORE_VERT = /* glsl */ `
uniform float uTime;
uniform float uAudio;
varying vec3 vNormalW;
varying vec3 vViewDir;
${SNOISE}
void main(){
  float n = snoise(normal * 2.2 + vec3(uTime*0.5));
  vec3 displaced = position + normal * n * (0.06 + uAudio*0.14);
  vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
  vNormalW = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const CORE_FRAG = /* glsl */ `
uniform float uAudio;
uniform float uSpeaking;
uniform vec3 uHot;
uniform vec3 uEdge;
varying vec3 vNormalW;
varying vec3 vViewDir;
void main(){
  float facing = max(dot(vNormalW, vViewDir), 0.0);
  float hot = pow(facing, 2.5);
  vec3 col = mix(uEdge, uHot, hot);
  col *= 1.0 + uAudio*0.55 + uSpeaking*0.35;
  float alpha = (0.08 + hot*0.17);
  gl_FragColor = vec4(col, alpha);
}
`;

// Атмосфера: внешние френель-оболочки (объёмное свечение).
const HALO_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vViewDir;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalW = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const HALO_FRAG = /* glsl */ `
uniform float uAudio;
uniform float uPower;
uniform float uIntensity;
uniform vec3 uColor;
varying vec3 vNormalW;
varying vec3 vViewDir;
void main(){
  float fres = pow(1.0 - max(dot(vNormalW, vViewDir), 0.0), uPower);
  float e = fres * uIntensity * (1.0 + uAudio);
  gl_FragColor = vec4(uColor * e, fres * (0.4 + uAudio*0.4) * uIntensity);
}
`;

// Частицы-оболочка: мягкие круглые точки с мерцанием и разбросом размера.
const PT_VERT = /* glsl */ `
uniform float uTime;
uniform float uAudio;
uniform float uSize;
attribute float aPhase;
attribute float aScale;
varying float vTw;
void main(){
  float tw = 0.5 + 0.5*sin(uTime*1.6 + aPhase*6.2831853);
  vTw = tw;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * aScale * (0.55 + tw*0.85) * (1.0 + uAudio*1.3) * (1.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const PT_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vTw;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(uColor * (0.55 + vTw*0.7), a * (0.3 + vTw*0.55));
}
`;

// Точки-оболочка по распределению Фибоначчи + случайные фаза/масштаб для мерцания.
function shellGeometry(count: number, radius: number, jitter = 0): THREE.BufferGeometry {
  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const scale = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    const rad = radius + (jitter ? (Math.random() - 0.5) * jitter : 0);
    pos[i * 3] = Math.cos(phi) * r * rad;
    pos[i * 3 + 1] = y * rad;
    pos[i * 3 + 2] = Math.sin(phi) * r * rad;
    phase[i] = Math.random();
    scale[i] = 0.5 + Math.random() * 1.4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aScale', new THREE.BufferAttribute(scale, 1));
  return geo;
}

export default function MaxCore3D() {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const thinkingRef = useRef(0);
  const speakingRef = useRef(0);
  const pointerRef = useRef({ x: 0, y: 0 });

  // Тумблер + события состояния.
  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onOpen = () => setOpen(true);
    const onClose = () => setOpen(false);
    const onThinking = (e: Event) => { thinkingRef.current = (e as CustomEvent).detail?.active ? 1 : 0; };
    const onSpeaking = (e: Event) => { speakingRef.current = (e as CustomEvent).detail?.active ? 1 : 0; };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('max3d:toggle', onToggle);
    window.addEventListener('max3d:open', onOpen);
    window.addEventListener('max3d:close', onClose);
    window.addEventListener('max:thinking', onThinking as EventListener);
    window.addEventListener('max:speaking', onSpeaking as EventListener);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('max3d:toggle', onToggle);
      window.removeEventListener('max3d:open', onOpen);
      window.removeEventListener('max3d:close', onClose);
      window.removeEventListener('max:thinking', onThinking as EventListener);
      window.removeEventListener('max:speaking', onSpeaking as EventListener);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // WebGL-сцена живёт только пока открыто.
  useEffect(() => {
    if (!open) return;
    const host = hostRef.current;
    if (!host) return;
    if (!ambientActive()) void startAmbient();

    const W = () => window.innerWidth;
    const H = () => window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04010a);
    const camera = new THREE.PerspectiveCamera(50, W() / H(), 0.1, 100);
    camera.position.z = 4.4;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W(), H());
    host.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';

    const COL_A = new THREE.Color(1.0, 0.23, 0.86);   // magenta
    const COL_B = new THREE.Color(0.30, 0.85, 1.0);   // cyan
    const COL_M = new THREE.Color(0.60, 0.30, 1.0);   // violet
    const HOT = new THREE.Color(1.0, 0.40, 0.78);     // розово-магента жар
    const EDGE = new THREE.Color(0.32, 0.07, 0.58);   // тёмный край сердца

    // Внутреннее ядро-сердце.
    const innerGeo = new THREE.IcosahedronGeometry(0.72, 12);
    const innerMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uAudio: { value: 0 }, uSpeaking: { value: 0 },
        uHot: { value: HOT }, uEdge: { value: EDGE },
      },
      vertexShader: CORE_VERT, fragmentShader: CORE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    scene.add(inner);

    // Оболочка — деформирующаяся икосфера.
    const coreGeo = new THREE.IcosahedronGeometry(1, 24);
    const coreMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uAudio: { value: 0 }, uThinking: { value: 0 }, uSpeaking: { value: 0 },
        uColorA: { value: COL_A }, uColorB: { value: COL_B }, uColorM: { value: COL_M },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    scene.add(core);

    // Атмосфера — две френель-оболочки.
    const makeHalo = (radius: number, power: number, intensity: number, color: THREE.Color) => {
      const geo = new THREE.IcosahedronGeometry(radius, 6);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uAudio: { value: 0 }, uPower: { value: power },
          uIntensity: { value: intensity }, uColor: { value: color.clone() },
        },
        vertexShader: HALO_VERT, fragmentShader: HALO_FRAG,
        transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      return { geo, mat, mesh };
    };
    const haloInner = makeHalo(1.5, 3.4, 0.5, COL_A);
    const haloOuter = makeHalo(2.1, 2.2, 0.34, COL_B);

    // Частицы: основная оболочка + тонкий пылевой подслой.
    const makePoints = (count: number, radius: number, jitter: number, size: number, color: THREE.Color, opacity: number) => {
      const geo = shellGeometry(count, radius, jitter);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uAudio: { value: 0 }, uSize: { value: size }, uColor: { value: color.clone() },
        },
        vertexShader: PT_VERT, fragmentShader: PT_FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      mat.uniforms.uColor.value.multiplyScalar(opacity);
      const pts = new THREE.Points(geo, mat);
      scene.add(pts);
      return { geo, mat, pts };
    };
    const shell = makePoints(1100, 1.34, 0.04, 46, new THREE.Color(1.0, 0.5, 0.95), 1.0);
    const dust = makePoints(700, 1.9, 0.55, 30, new THREE.Color(0.55, 0.8, 1.0), 0.7);

    // Постпроцессинг: настоящий bloom.
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    composer.setSize(W(), H());
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.34, 0.42, 0.62);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const onPointer = (e: PointerEvent) => {
      pointerRef.current.x = (e.clientX / W()) * 2 - 1;
      pointerRef.current.y = (e.clientY / H()) * 2 - 1;
    };
    window.addEventListener('pointermove', onPointer);

    let audio = 0;
    let raf = 0;
    let camX = 0;
    let camY = 0;
    const clock = new THREE.Clock();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const af = ambientFrame();
      const raw = af ? af.level : 0;
      audio += (raw - audio) * 0.18;
      const thinking = thinkingRef.current;
      const speaking = speakingRef.current;
      const t = clock.getElapsedTime();

      coreMat.uniforms.uTime.value = t;
      coreMat.uniforms.uAudio.value = audio;
      coreMat.uniforms.uThinking.value = thinking;
      coreMat.uniforms.uSpeaking.value = speaking;
      innerMat.uniforms.uTime.value = t;
      innerMat.uniforms.uAudio.value = audio;
      innerMat.uniforms.uSpeaking.value = speaking;
      haloInner.mat.uniforms.uAudio.value = audio;
      haloOuter.mat.uniforms.uAudio.value = audio;
      shell.mat.uniforms.uTime.value = t;
      shell.mat.uniforms.uAudio.value = audio;
      dust.mat.uniforms.uTime.value = t;
      dust.mat.uniforms.uAudio.value = audio;

      // Свечение вспыхивает на речи и звуке (умеренно — без выжигания в белый).
      bloom.strength = 0.3 + speaking * 0.26 + audio * 0.3 + thinking * 0.1;

      const spin = 0.12 + thinking * 0.35 + speaking * 0.18 + audio * 0.5;
      core.rotation.y += 0.0022 * (1 + spin * 8);
      core.rotation.x = Math.sin(t * 0.15) * 0.22;
      inner.rotation.y -= 0.0018 * (1 + spin * 5);
      inner.rotation.z = Math.sin(t * 0.1) * 0.2;
      shell.pts.rotation.y -= 0.0014 * (1 + spin * 6);
      shell.pts.rotation.x = Math.cos(t * 0.12) * 0.18;
      dust.pts.rotation.y += 0.0009 * (1 + spin * 3);
      dust.pts.rotation.z = Math.sin(t * 0.08) * 0.15;

      const s = 1 + audio * 0.12 + speaking * 0.04;
      shell.pts.scale.setScalar(s);
      haloInner.mesh.scale.setScalar(1 + audio * 0.06);
      haloOuter.mesh.scale.setScalar(1 + audio * 0.09);
      inner.scale.setScalar(1 + audio * 0.1 + speaking * 0.05);

      // Живая камера: мягкий параллакс от мыши + медленный дрейф.
      const targetX = pointerRef.current.x * 0.5 + Math.sin(t * 0.13) * 0.12;
      const targetY = -pointerRef.current.y * 0.35 + Math.cos(t * 0.11) * 0.1;
      camX += (targetX - camX) * 0.04;
      camY += (targetY - camY) * 0.04;
      camera.position.x = camX;
      camera.position.y = camY;
      camera.lookAt(0, 0, 0);

      composer.render();
    };
    tick();

    const onResize = () => {
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
      renderer.setSize(W(), H());
      composer.setSize(W(), H());
      bloom.setSize(W(), H());
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      renderer.domElement.remove();
      innerGeo.dispose(); innerMat.dispose();
      coreGeo.dispose(); coreMat.dispose();
      haloInner.geo.dispose(); haloInner.mat.dispose();
      haloOuter.geo.dispose(); haloOuter.mat.dispose();
      shell.geo.dispose(); shell.mat.dispose();
      dust.geo.dispose(); dust.mat.dispose();
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[55]" style={{ background: 'radial-gradient(circle at 50% 50%, rgba(10,4,20,0.35), rgba(2,1,8,0.86))' }}>
      <div ref={hostRef} className="absolute inset-0" style={{ pointerEvents: 'none' }} />
      {/* Виньетка поверх — мягко затемняет края, фокус на ядре. */}
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 46%, transparent 40%, rgba(2,1,8,0.55) 100%)' }} />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white/70 transition hover:bg-white/20 hover:text-white"
        aria-label="Закрыть 3D-ядро"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="pointer-events-none absolute inset-x-0 bottom-8 text-center">
        <p className="text-[11px] uppercase tracking-[0.4em] text-fuchsia-200/70">MAX · ядро</p>
        <p className="mt-1 text-xs text-white/40">говори — я слышу пространство · двигай мышью · Esc — выйти</p>
      </div>
    </div>
  );
}
