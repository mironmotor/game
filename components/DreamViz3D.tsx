'use client';

/**
 * DreamViz3D — «Войти в сон». Объёмная карта НАСТОЯЩЕГО сна MAX: событие
 * internal_dream возвращает синергии-цепочки концептов, и они рисуются как живой
 * 3D-граф — узлы-концепты, светящиеся связи, по связям бегут импульсы.
 * Не декор: узлы, цепочки, толщина и цвет берутся из данных ядра
 *   • общий концепт у разных синергий → ОДИН узел (цепочки реально пересекаются),
 *   • confidence → яркость и скорость импульса,
 *   • heart_guided → тёплый розовый (сердце вело сон), иначе холодный циан.
 * Раскладка — 3D force-directed по реальным связям, а не случайная.
 * Открыть: `dream3d:open` (detail.dream — готовый сон) или `dream3d:toggle`
 * (сам сходит за свежим сном). Esc — выйти.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Loader2, Moon, X } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';

type Synergy = {
  title?: string;
  summary?: string;
  concepts?: string[];
  confidence?: number;
  heart_guided?: boolean;
};
type Dream = { synergies_created?: number; synergies?: Synergy[]; heart_influence?: unknown; blocked?: boolean };

const NODE_VERT = /* glsl */ `
uniform float uTime;
attribute float aSize;
attribute float aPhase;
varying float vTw;
void main(){
  float tw = 0.55 + 0.45*sin(uTime*1.3 + aPhase*6.2831853);
  vTw = tw;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (0.7 + tw*0.5) * (26.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const NODE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vTw;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(uColor * (0.6 + vTw*0.7), a * (0.5 + vTw*0.5));
}
`;

/** Текстовая метка концепта как спрайт (чтобы было видно, ЧТО за узел). */
function labelSprite(text: string): THREE.Sprite {
  const pad = 8;
  const font = '500 30px ui-sans-serif, system-ui, sans-serif';
  const meas = document.createElement('canvas').getContext('2d')!;
  meas.font = font;
  const w = Math.ceil(meas.measureText(text).width) + pad * 2;
  const h = 42;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(235,225,255,0.92)';
  ctx.fillText(text, pad, h / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85 });
  const sp = new THREE.Sprite(mat);
  sp.scale.set((w / h) * 0.34, 0.34, 1);
  return sp;
}

/** 3D force-directed: пружины по реальным связям + отталкивание. */
function layout(nodes: string[], edges: [number, number][]): Float32Array {
  const n = nodes.length;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    pos[i * 3] = Math.cos(phi) * r * 2.2;
    pos[i * 3 + 1] = y * 2.2;
    pos[i * 3 + 2] = Math.sin(phi) * r * 2.2;
  }
  for (let iter = 0; iter < 220; iter++) {
    const fx = new Float32Array(n);
    const fy = new Float32Array(n);
    const fz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i * 3] - pos[j * 3];
        let dy = pos[i * 3 + 1] - pos[j * 3 + 1];
        let dz = pos[i * 3 + 2] - pos[j * 3 + 2];
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.001) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          dz = Math.random() - 0.5;
          d2 = 0.001;
        }
        const f = 1.6 / d2;
        const d = Math.sqrt(d2);
        fx[i] += (dx / d) * f; fy[i] += (dy / d) * f; fz[i] += (dz / d) * f;
        fx[j] -= (dx / d) * f; fy[j] -= (dy / d) * f; fz[j] -= (dz / d) * f;
      }
    }
    for (const [a, b] of edges) {
      const dx = pos[b * 3] - pos[a * 3];
      const dy = pos[b * 3 + 1] - pos[a * 3 + 1];
      const dz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const d = Math.max(0.001, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const f = (d - 1.5) * 0.12;
      fx[a] += (dx / d) * f; fy[a] += (dy / d) * f; fz[a] += (dz / d) * f;
      fx[b] -= (dx / d) * f; fy[b] -= (dy / d) * f; fz[b] -= (dz / d) * f;
    }
    const damp = 0.12;
    for (let i = 0; i < n; i++) {
      pos[i * 3] += Math.max(-0.4, Math.min(0.4, fx[i])) * damp;
      pos[i * 3 + 1] += Math.max(-0.4, Math.min(0.4, fy[i])) * damp;
      pos[i * 3 + 2] += Math.max(-0.4, Math.min(0.4, fz[i])) * damp;
    }
  }
  // Центрируем и вписываем в кадр: иначе разлёт пружин уводит узлы за экран.
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2];
  }
  cx /= n; cy /= n; cz /= n;
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    pos[i * 3] -= cx; pos[i * 3 + 1] -= cy; pos[i * 3 + 2] -= cz;
    maxR = Math.max(maxR, Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  }
  const TARGET_R = 2.5;
  if (maxR > 0.001) {
    const k = TARGET_R / maxR;
    for (let i = 0; i < n * 3; i++) pos[i] *= k;
  }
  return pos;
}

export default function DreamViz3D() {
  const [open, setOpen] = useState(false);
  const [dream, setDream] = useState<Dream | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const hostRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  const fetchDream = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      const r = (await sendMax17Event({ type: 'internal_dream', limit: 5, persist: false })) as { dream?: Dream };
      setDream(r.dream ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail?.dream as Dream | undefined;
      setOpen(true);
      if (d?.synergies?.length) setDream(d);
      else void fetchDream();
    };
    const onToggle = () => {
      setOpen((v) => {
        if (!v) void fetchDream();
        return !v;
      });
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
    };
    window.addEventListener('dream3d:open', onOpen as EventListener);
    window.addEventListener('dream3d:toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('dream3d:open', onOpen as EventListener);
      window.removeEventListener('dream3d:toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, [fetchDream]);

  // Сцена живёт, только пока открыто и есть сон.
  useEffect(() => {
    if (!open) return;
    const host = hostRef.current;
    const synergies = (dream?.synergies ?? []).filter((s) => (s.concepts?.length ?? 0) >= 2);
    if (!host || synergies.length === 0) return;

    // ---- граф из реальных данных ----
    const index = new Map<string, number>();
    const names: string[] = [];
    const degree: number[] = [];
    const chains: { idx: number[]; conf: number; heart: boolean }[] = [];
    for (const s of synergies) {
      const idx: number[] = [];
      for (const raw of s.concepts ?? []) {
        const c = String(raw).trim();
        if (!c) continue;
        if (!index.has(c)) {
          index.set(c, names.length);
          names.push(c);
          degree.push(0);
        }
        const i = index.get(c)!;
        if (idx[idx.length - 1] !== i) idx.push(i);
        degree[i] += 1;
      }
      if (idx.length >= 2) {
        chains.push({ idx, conf: Math.max(0.15, Math.min(1, Number(s.confidence) || 0.4)), heart: Boolean(s.heart_guided) });
      }
    }
    if (names.length === 0 || chains.length === 0) return;

    const edges: [number, number][] = [];
    for (const ch of chains) for (let i = 0; i + 1 < ch.idx.length; i++) edges.push([ch.idx[i], ch.idx[i + 1]]);
    const pos = layout(names, edges);

    // ---- сцена ----
    const W = () => window.innerWidth;
    const H = () => window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04030f);
    const camera = new THREE.PerspectiveCamera(52, W() / H(), 0.1, 200);
    camera.position.set(0, 0, 6.8);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W(), H());
    host.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';

    const world = new THREE.Group();
    scene.add(world);

    const HEART = new THREE.Color(1.0, 0.42, 0.78);
    const COOL = new THREE.Color(0.42, 0.82, 1.0);

    // узлы
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sizes = new Float32Array(names.length);
    const phases = new Float32Array(names.length);
    for (let i = 0; i < names.length; i++) {
      sizes[i] = 3.2 + Math.min(4, degree[i]) * 1.5; // размер = как часто концепт снится
      phases[i] = Math.random();
    }
    nodeGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    nodeGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    const nodeMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0.85, 0.75, 1.0) } },
      vertexShader: NODE_VERT,
      fragmentShader: NODE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    world.add(new THREE.Points(nodeGeo, nodeMat));

    // метки концептов
    const sprites: THREE.Sprite[] = [];
    for (let i = 0; i < names.length; i++) {
      const sp = labelSprite(names[i]);
      sp.position.set(pos[i * 3], pos[i * 3 + 1] + 0.24, pos[i * 3 + 2]);
      world.add(sp);
      sprites.push(sp);
    }

    // цепочки-синергии + бегущие импульсы
    const lineMats: THREE.LineBasicMaterial[] = [];
    const lineGeos: THREE.BufferGeometry[] = [];
    const pulses: { idx: number[]; mesh: THREE.Mesh; t: number; speed: number }[] = [];
    const pulseGeo = new THREE.SphereGeometry(0.075, 10, 10);
    for (const ch of chains) {
      const pts = ch.idx.map((i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const col = (ch.heart ? HEART : COOL).clone();
      const mat = new THREE.LineBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.3 + ch.conf * 0.6, // яркость = confidence
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      world.add(new THREE.Line(geo, mat));
      lineMats.push(mat);
      lineGeos.push(geo);

      const pmat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      const pm = new THREE.Mesh(pulseGeo, pmat);
      world.add(pm);
      pulses.push({ idx: ch.idx, mesh: pm, t: Math.random(), speed: 0.12 + ch.conf * 0.35 });
    }

    // ---- формула синапсов/сердца: покой (раскладка) + живое движение ----
    // На каждый узел: средняя confidence и доля heart_guided среди его цепочек.
    const base = pos.slice();
    const nodeConf = new Float32Array(names.length);
    const nodeHeart = new Float32Array(names.length);
    const nodeCnt = new Float32Array(names.length);
    for (const ch of chains) for (const i of ch.idx) { nodeConf[i] += ch.conf; nodeHeart[i] += ch.heart ? 1 : 0; nodeCnt[i] += 1; }
    for (let i = 0; i < names.length; i++) {
      if (nodeCnt[i] > 0) { nodeConf[i] /= nodeCnt[i]; nodeHeart[i] /= nodeCnt[i]; } else { nodeConf[i] = 0.4; }
    }
    // «Сердце» сна — взвешенный центр heart_guided-узлов (иначе центр сцены).
    let hx = 0, hy = 0, hz = 0, hwSum = 0;
    for (let i = 0; i < names.length; i++) { const w = nodeHeart[i]; hx += base[i * 3] * w; hy += base[i * 3 + 1] * w; hz += base[i * 3 + 2] * w; hwSum += w; }
    const heartC = hwSum > 0.001 ? [hx / hwSum, hy / hwSum, hz / hwSum] : [0, 0, 0];
    // Двойной удар кардиоритма как функция фазы 0..1 (систола + слабее диастола).
    const heartbeat = (x: number) => Math.exp(-((x - 0.12) ** 2) / 0.006) + 0.55 * Math.exp(-((x - 0.4) ** 2) / 0.011);
    const posArr = nodeGeo.attributes.position.array as Float32Array;

    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    composer.setSize(W(), H());
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.5, 0.5, 0.32);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const onPointer = (e: PointerEvent) => {
      pointerRef.current.x = (e.clientX / W()) * 2 - 1;
      pointerRef.current.y = (e.clientY / H()) * 2 - 1;
    };
    window.addEventListener('pointermove', onPointer);

    let raf = 0;
    let yaw = 0;
    let pitch = 0;
    const clock = new THREE.Clock();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();
      nodeMat.uniforms.uTime.value = t;

      // ---- живое движение: сон как карта ядра ----
      // confidence → покой (уверенный концепт стоит, неуверенный дрожит);
      // heart_guided → притяжение к «сердцу» в кардиоритме; общий «вдох» сна.
      const breath = 1 + 0.035 * Math.sin(t * 0.45);
      for (let i = 0; i < names.length; i++) {
        const ph = phases[i];
        const wob = (1 - nodeConf[i]) * 0.3 + 0.04; // неуверенность = амплитуда дрожи
        let x = base[i * 3] + Math.sin(t * 0.73 + ph * 6.2831853) * wob;
        let y = base[i * 3 + 1] + Math.sin(t * 0.61 + ph * 6.2831853 + 1.7) * wob;
        let z = base[i * 3 + 2] + Math.sin(t * 0.52 + ph * 6.2831853 + 3.1) * wob;
        const hw = nodeHeart[i];
        if (hw > 0.001) {
          const beat = heartbeat(((t * 1.05 + ph * 0.3) % 1 + 1) % 1) * hw;
          const pull = (0.05 + 0.16 * beat) * hw; // сердечные узлы «дышат» к центру
          x += (heartC[0] - x) * pull;
          y += (heartC[1] - y) * pull;
          z += (heartC[2] - z) * pull;
        }
        posArr[i * 3] = x * breath;
        posArr[i * 3 + 1] = y * breath;
        posArr[i * 3 + 2] = z * breath;
      }
      nodeGeo.attributes.position.needsUpdate = true;

      // линии-синергии следуют за живыми узлами
      for (let k = 0; k < chains.length; k++) {
        const arr = lineGeos[k].attributes.position.array as Float32Array;
        const idx = chains[k].idx;
        for (let j = 0; j < idx.length; j++) {
          arr[j * 3] = posArr[idx[j] * 3];
          arr[j * 3 + 1] = posArr[idx[j] * 3 + 1];
          arr[j * 3 + 2] = posArr[idx[j] * 3 + 2];
        }
        lineGeos[k].attributes.position.needsUpdate = true;
      }

      // метки держатся у своих узлов
      for (let i = 0; i < sprites.length; i++) {
        sprites[i].position.set(posArr[i * 3], posArr[i * 3 + 1] + 0.24, posArr[i * 3 + 2]);
      }

      // импульсы бегут по живым цепочкам (скорость = confidence)
      for (const p of pulses) {
        p.t += 0.0055 * p.speed * 12;
        if (p.t > 1) p.t -= 1;
        const seg = p.t * (p.idx.length - 1);
        const i = Math.min(p.idx.length - 2, Math.floor(seg));
        const f = seg - i;
        const a = p.idx[i];
        const b = p.idx[i + 1];
        p.mesh.position.set(
          posArr[a * 3] + (posArr[b * 3] - posArr[a * 3]) * f,
          posArr[a * 3 + 1] + (posArr[b * 3 + 1] - posArr[a * 3 + 1]) * f,
          posArr[a * 3 + 2] + (posArr[b * 3 + 2] - posArr[a * 3 + 2]) * f,
        );
      }

      // мягкая орбита от мыши + собственный дрейф
      yaw += ((pointerRef.current.x * 0.9 + t * 0.05) - yaw) * 0.035;
      pitch += (-pointerRef.current.y * 0.5 - pitch) * 0.035;
      world.rotation.y = yaw;
      world.rotation.x = pitch;
      sprites.forEach((s) => s.quaternion.copy(camera.quaternion));

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
      nodeGeo.dispose();
      nodeMat.dispose();
      pulseGeo.dispose();
      lineGeos.forEach((g) => g.dispose());
      lineMats.forEach((m) => m.dispose());
      pulses.forEach((p) => (p.mesh.material as THREE.Material).dispose());
      sprites.forEach((s) => {
        s.material.map?.dispose();
        s.material.dispose();
      });
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
    };
  }, [open, dream]);

  if (!open) return null;

  const synergies = dream?.synergies ?? [];

  return (
    <div className="fixed inset-0 z-[64] bg-[#04030f]">
      <div ref={hostRef} className="absolute inset-0" style={{ pointerEvents: 'none' }} />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-3 p-4">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-indigo-300/25 bg-black/50 px-3 py-2 backdrop-blur-sm">
          <Moon className="h-4 w-4 text-indigo-200" />
          <span className="text-[11px] uppercase tracking-[0.25em] text-indigo-100">Сон MAX · 3D</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-200/60" />}
        </div>
        <button
          type="button"
          onClick={() => void fetchDream()}
          disabled={busy}
          className="pointer-events-auto rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-[11px] text-white/70 backdrop-blur-sm hover:bg-white/10 disabled:opacity-40"
        >
          Приснить заново
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="pointer-events-auto ml-auto rounded-full bg-white/10 p-2 text-white/70 hover:bg-white/20 hover:text-white"
          aria-label="Выйти из сна"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Легенда: что именно ты видишь (данные, не декор) */}
      <div className="pointer-events-none absolute bottom-4 left-4 max-w-[min(420px,calc(100vw-32px))] rounded-xl border border-white/10 bg-black/55 p-3 backdrop-blur-sm">
        <div className="text-[10px] uppercase tracking-widest text-indigo-300/60">
          {synergies.length > 0 ? `Синергий во сне: ${dream?.synergies_created ?? synergies.length}` : 'Сон пуст'}
        </div>
        <div className="mt-1 space-y-0.5">
          {synergies.slice(0, 5).map((s, i) => (
            <div key={i} className="flex items-baseline gap-1.5 text-[11px]">
              <span className={s.heart_guided ? 'text-rose-300' : 'text-cyan-300'}>{s.heart_guided ? '❤' : '◇'}</span>
              <span className="min-w-0 flex-1 truncate text-white/80">{s.title || (s.concepts ?? []).join(' → ')}</span>
              <span className="shrink-0 text-white/35">{Math.round((Number(s.confidence) || 0) * 100)}%</span>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-white/40">
          Узлы — концепты (размер = как часто снятся), линии — синергии (яркость = уверенность),
          <span className="text-rose-300/70"> розовые вело сердце</span>. Уверенные стоят спокойно,
          неуверенные дрожат; <span className="text-rose-300/70">сердечные пульсируют к центру в ритме сердца</span>.
          Двигай мышью — сон повернётся.
        </p>
        {err && <div className="mt-1 text-[10px] text-rose-300/80">{err}</div>}
      </div>
    </div>
  );
}
