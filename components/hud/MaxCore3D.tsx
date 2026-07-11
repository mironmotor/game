'use client';

/**
 * MaxCore3D — объёмное 3D-присутствие MAX в центре меты (WebGL / three.js).
 * Икосфера с шейдерной шумовой деформацией (живое «дыхание»), френель-свечение
 * магента→циан, облако точек-оболочка и гало. РЕАГИРУЕТ на:
 *   • микрофон («уши» MAX) — lib/ambient-audio (level + спектр),
 *   • max:thinking / max:speaking (мысли и речь).
 *
 * Аддитивно к 2D-мете: полноэкранный оверлей, дефолт скрыт. Тумблер — событие
 * `max3d:toggle` (или `/3d` / `/ядро` в чате), Esc — закрыть. Не ломает текущий
 * фон: пока закрыт — рендерит null, никакого WebGL-контекста.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { X } from 'lucide-react';
import { ambientFrame, ambientActive, startAmbient } from '@/lib/ambient-audio';

const VERT = /* glsl */ `
uniform float uTime;
uniform float uAudio;
uniform float uThinking;
uniform float uSpeaking;
varying float vNoise;
varying vec3 vNormalW;
varying vec3 vViewDir;

// Ashima simplex noise 3D (public domain)
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

void main(){
  float speed = 0.35 + uThinking*0.9 + uSpeaking*0.5;
  float amp = 0.16 + uAudio*0.5 + uThinking*0.16 + uSpeaking*0.12;
  float n = snoise(normal * 1.6 + vec3(uTime*speed));
  n += 0.5 * snoise(normal * 3.4 + vec3(uTime*speed*1.6));
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
uniform vec3 uColorA;
uniform vec3 uColorB;
varying float vNoise;
varying vec3 vNormalW;
varying vec3 vViewDir;
void main(){
  float fres = pow(1.0 - max(dot(vNormalW, vViewDir), 0.0), 2.0);
  float mixv = clamp(vNoise*0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uColorA, uColorB, mixv);
  col += fres * (0.7 + uAudio*0.7);
  float alpha = 0.5 + fres*0.5;
  gl_FragColor = vec4(col, alpha);
}
`;

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
uniform vec3 uColor;
varying vec3 vNormalW;
varying vec3 vViewDir;
void main(){
  float fres = pow(1.0 - max(dot(vNormalW, vViewDir), 0.0), 3.0);
  gl_FragColor = vec4(uColor * fres * (1.0 + uAudio), fres * (0.5 + uAudio*0.4));
}
`;

export default function MaxCore3D() {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const thinkingRef = useRef(0);
  const speakingRef = useRef(0);

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
    const camera = new THREE.PerspectiveCamera(50, W() / H(), 0.1, 100);
    camera.position.z = 3.25;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W(), H());
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';

    const COL_A = new THREE.Color(1.0, 0.23, 0.86);   // magenta
    const COL_B = new THREE.Color(0.30, 0.85, 1.0);   // cyan

    // Ядро — деформирующаяся икосфера.
    const coreGeo = new THREE.IcosahedronGeometry(1, 20);
    const coreMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uAudio: { value: 0 }, uThinking: { value: 0 }, uSpeaking: { value: 0 },
        uColorA: { value: COL_A }, uColorB: { value: COL_B },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    scene.add(core);

    // Гало — внешняя оболочка с френелем.
    const haloGeo = new THREE.IcosahedronGeometry(1.55, 6);
    const haloMat = new THREE.ShaderMaterial({
      uniforms: { uAudio: { value: 0 }, uColor: { value: COL_A.clone() } },
      vertexShader: HALO_VERT, fragmentShader: HALO_FRAG,
      transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    scene.add(halo);

    // Облако точек-оболочка (распределение Фибоначчи).
    const PN = 900;
    const pos = new Float32Array(PN * 3);
    for (let i = 0; i < PN; i++) {
      const y = 1 - (i / (PN - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * Math.PI * (3 - Math.sqrt(5));
      pos[i * 3] = Math.cos(phi) * r * 1.32;
      pos[i * 3 + 1] = y * 1.32;
      pos[i * 3 + 2] = Math.sin(phi) * r * 1.32;
    }
    const ptsGeo = new THREE.BufferGeometry();
    ptsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const ptsMat = new THREE.PointsMaterial({
      color: new THREE.Color(1.0, 0.45, 0.95), size: 0.022,
      transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const points = new THREE.Points(ptsGeo, ptsMat);
    scene.add(points);

    let audio = 0;
    let raf = 0;
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
      haloMat.uniforms.uAudio.value = audio;

      const spin = 0.12 + thinking * 0.35 + speaking * 0.18 + audio * 0.5;
      core.rotation.y += 0.0025 * (1 + spin * 8);
      core.rotation.x = Math.sin(t * 0.15) * 0.25;
      points.rotation.y -= 0.0016 * (1 + spin * 6);
      points.rotation.x = Math.cos(t * 0.12) * 0.2;
      const s = 1 + audio * 0.12 + speaking * 0.04;
      points.scale.setScalar(s);
      halo.scale.setScalar(1 + audio * 0.06);

      renderer.render(scene, camera);
    };
    tick();

    const onResize = () => {
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
      renderer.setSize(W(), H());
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.domElement.remove();
      coreGeo.dispose(); coreMat.dispose();
      haloGeo.dispose(); haloMat.dispose();
      ptsGeo.dispose(); ptsMat.dispose();
      renderer.dispose();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[55]" style={{ background: 'radial-gradient(circle at 50% 50%, rgba(10,4,20,0.35), rgba(2,1,8,0.86))' }}>
      <div ref={hostRef} className="absolute inset-0" style={{ pointerEvents: 'none' }} />
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
        <p className="mt-1 text-xs text-white/40">говори — я слышу пространство · Esc — выйти</p>
      </div>
    </div>
  );
}
