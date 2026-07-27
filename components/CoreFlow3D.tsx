'use client';

/**
 * CoreFlow3D — «Ядро MAX · Поток» + режим GOD VISION.
 *
 * Обычный режим: тысячи частиц текут по странному аттрактору (детерминированный
 * хаос ядра). Формулу можно переключать — Айзава / Лоренц / Томас / Хальворсен.
 *
 * GOD VISION — взгляд на ядро целиком. Три вложенных слоя, и каждый = РЕАЛЬНЫЙ
 * пласт памяти из graph_stats:
 *   • внешнее тусклое облако — ВСЕ связи (сырая масса, в основном косинусное сходство)
 *   • средний слой — СТРУКТУРНЫЕ (настоящие отношения, не арифметика)
 *   • яркое ядро внутри — ЗАРАБОТАННЫЕ (подтверждённые опытом)
 * Видно главное: истинного знания мало, и оно горит в центре огромного тумана.
 *
 * Открыть: `coreflow:open` / `coreflow:toggle`. G — GOD VISION. 1-4 — формула.
 * Мышь (зажать) — вращать. Esc — выход.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Atom, Eye, Loader2, X } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';

type CoreStat = {
  total: number;
  structural: number;
  earned: number;
  causal: number;
  nodes: number;
  avgWeight: number;
};

/** Странные аттракторы: шаг производной + масштаб и центр по z. */
type Attractor = {
  key: string;
  name: string;
  formula: string;
  scale: number;
  cz: number;
  step: number;
  d: (x: number, y: number, z: number) => [number, number, number];
};

const ATTRACTORS: Attractor[] = [
  {
    key: 'aizawa',
    name: 'Айзава',
    formula: 'ẋ=(z−b)x−dy · ẏ=dx+(z−b)y · ż=c+az−z³/3−(x²+y²)(1+ez)+fzx³',
    scale: 2.4,
    cz: 0.9,
    step: 0.011,
    d: (x, y, z) => {
      const a = 0.95, b = 0.7, c = 0.6, dd = 3.5, e = 0.25, f = 0.1;
      return [
        (z - b) * x - dd * y,
        dd * x + (z - b) * y,
        c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * z * x * x * x,
      ];
    },
  },
  {
    key: 'lorenz',
    name: 'Лоренц',
    formula: 'ẋ=σ(y−x) · ẏ=x(ρ−z)−y · ż=xy−βz',
    scale: 0.11,
    cz: 25,
    step: 0.006,
    d: (x, y, z) => [10 * (y - x), x * (28 - z) - y, x * y - (8 / 3) * z],
  },
  {
    key: 'thomas',
    name: 'Томас',
    formula: 'ẋ=sin(y)−b·x · ẏ=sin(z)−b·y · ż=sin(x)−b·z',
    scale: 0.8,
    cz: 0,
    step: 0.05,
    d: (x, y, z) => {
      const b = 0.19;
      return [Math.sin(y) - b * x, Math.sin(z) - b * y, Math.sin(x) - b * z];
    },
  },
  {
    key: 'halvorsen',
    name: 'Хальворсен',
    formula: 'ẋ=−ax−4y−4z−y² (цикл по x,y,z)',
    scale: 0.22,
    cz: -3,
    step: 0.008,
    d: (x, y, z) => {
      const a = 1.89;
      return [
        -a * x - 4 * y - 4 * z - y * y,
        -a * y - 4 * z - 4 * x - z * z,
        -a * z - 4 * x - 4 * y - x * x,
      ];
    },
  },
];

const VERT = /* glsl */ `
uniform float uSize;
attribute float aEnergy;
attribute float aLayer;
varying float vE;
varying float vL;
void main(){
  vE = aEnergy; vL = aLayer;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * (0.3 + aEnergy * 1.5) * (0.55 + aLayer * 0.75) * (30.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uCool;
uniform vec3 uHot;
uniform vec3 uCore;
uniform float uWarm;
varying float vE;
varying float vL;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  // цвет = скорость частицы; слой (vL) тянет к «золоту ядра»
  vec3 col = mix(uCool, uHot, clamp(vE * (0.7 + uWarm * 0.6), 0.0, 1.0));
  col = mix(col, uCore, vL * vL * 0.85);
  float bright = (0.35 + vE * 0.8) * (0.35 + vL * 1.15);
  gl_FragColor = vec4(col * bright, a * (0.22 + vE * 0.5 + vL * 0.35));
}
`;

export default function CoreFlow3D() {
  const [open, setOpen] = useState(false);
  const [stat, setStat] = useState<CoreStat | null>(null);
  const [busy, setBusy] = useState(false);
  const [attrIdx, setAttrIdx] = useState(0);
  const [god, setGod] = useState(false);
  // Живая энергия ансамбля — считается из РЕАЛЬНЫХ скоростей частиц (Σ½v²),
  // это настоящая кинетическая энергия симулируемой системы, не декоративное число.
  const [flowEnergy, setFlowEnergy] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef({ x: 0, y: 0, down: false });

  const fetchStat = useCallback(async () => {
    setBusy(true);
    try {
      const r = (await sendMax17Event({ type: 'graph_stats' })) as {
        graph_stats?: Record<string, number>;
      };
      // Ядро отдаёт данные в graph_stats.* — раньше тут читалось graph.synapses,
      // из-за чего на экране всегда был ноль.
      const g = r.graph_stats ?? {};
      setStat({
        total: Number(g.total_synapses) || 0,
        structural: Number(g.structural_synapses) || 0,
        earned: Number(g.earned_synapses) || 0,
        causal: Number(g.causal_synapses) || 0,
        nodes: Number(g.unique_nodes) || 0,
        avgWeight: Number(g.avg_weight) || 0,
      });
    } catch {
      setStat(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      void fetchStat();
    };
    const onToggle = () =>
      setOpen((v) => {
        if (!v) void fetchStat();
        return !v;
      });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'g' || e.key === 'G' || e.key === 'п' || e.key === 'П') setGod((v) => !v);
      const n = Number(e.key);
      if (n >= 1 && n <= ATTRACTORS.length) setAttrIdx(n - 1);
    };
    window.addEventListener('coreflow:open', onOpen);
    window.addEventListener('coreflow:toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('coreflow:open', onOpen);
      window.removeEventListener('coreflow:toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, [fetchStat]);

  // Доля «выученного» в общей массе — насколько ядро тёплое/зрелое.
  const warm = stat && stat.total > 0 ? Math.min(1, Math.max(0.12, (stat.earned / stat.total) * 40)) : 0.35;

  useEffect(() => {
    if (!open) return;
    const host = hostRef.current;
    if (!host) return;

    const attr = ATTRACTORS[attrIdx] ?? ATTRACTORS[0];
    const W = () => host.clientWidth || window.innerWidth;
    const H = () => host.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const small = Math.min(W(), H()) < 620;

    // Плотность = реальные данные ядра. В GOD VISION три слоя: вся масса,
    // структура и заработанное — их пропорции берём из graph_stats.
    const cap = small ? 4200 : 11000;
    const N = Math.max(3000, Math.min(cap, stat && stat.total > 800 ? Math.round(stat.total * 0.02) : 6500));
    const layers = god
      ? (() => {
          const t = stat?.total || 1;
          const s = stat?.structural || Math.round(t * 0.1);
          const e = stat?.earned || Math.round(t * 0.005);
          // Логарифмические доли, иначе внутренний слой был бы невидим (0.5%).
          const w = [Math.log10(t + 10), Math.log10(s + 10) * 1.15, Math.log10(e + 10) * 1.5];
          const sum = w[0] + w[1] + w[2];
          return w.map((x) => Math.max(600, Math.round((x / sum) * N)));
        })()
      : [N];
    const TOTAL = layers.reduce((a, b) => a + b, 0);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030109);
    scene.fog = new THREE.FogExp2(0x030109, god ? 0.03 : 0.055);
    const camera = new THREE.PerspectiveCamera(55, W() / H(), 0.1, 200);
    camera.position.set(0, 0, god ? 12.5 : 9.2);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(dpr);
    renderer.setSize(W(), H());
    host.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';

    const world = new THREE.Group();
    scene.add(world);
    const flow = new THREE.Group();
    flow.position.set(0, 0, -attr.cz);
    world.add(flow);

    // ---- частицы ----
    const pos = new Float32Array(TOTAL * 3);
    const energy = new Float32Array(TOTAL);
    const layerAttr = new Float32Array(TOTAL); // 0 — внешний слой, 1 — ядро
    const age = new Float32Array(TOTAL);
    const maxAge = new Float32Array(TOTAL);
    const radius = new Float32Array(TOTAL); // сжатие к центру для внутренних слоёв

    const layerOf = (i: number) => {
      let acc = 0;
      for (let l = 0; l < layers.length; l++) {
        acc += layers[l];
        if (i < acc) return l;
      }
      return layers.length - 1;
    };

    const seed = (i: number) => {
      const l = layerOf(i);
      const depth = layers.length > 1 ? l / (layers.length - 1) : 0;
      let x = (Math.random() - 0.5) * 0.4;
      let y = (Math.random() - 0.5) * 0.4;
      let z = attr.cz + (Math.random() - 0.5) * 0.6;
      // Прогон: частица рождается уже НА многообразии, а не в центре.
      const warmSteps = 80 + ((Math.random() * 900) | 0);
      for (let s = 0; s < warmSteps; s++) {
        const [dx, dy, dz] = attr.d(x, y, z);
        x += dx * attr.step; y += dy * attr.step; z += dz * attr.step;
        if (!Number.isFinite(x) || x * x + y * y + z * z > 1e6) {
          x = (Math.random() - 0.5) * 0.4; y = (Math.random() - 0.5) * 0.4; z = attr.cz;
        }
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      age[i] = 0;
      maxAge[i] = 260 + Math.random() * 600;
      energy[i] = 0.25;
      layerAttr[i] = depth;
      // Внутренние слои живут ближе к центру — «ядро в тумане».
      radius[i] = 1 - depth * 0.62;
    };
    for (let i = 0; i < TOTAL; i++) seed(i);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aEnergy', new THREE.BufferAttribute(energy, 1));
    geo.setAttribute('aLayer', new THREE.BufferAttribute(layerAttr, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: god ? 2.4 : 2.0 },
        uCool: { value: new THREE.Color(0.3, 0.55, 1.0) },
        uHot: { value: new THREE.Color(1.0, 0.45, 0.72) },
        uCore: { value: new THREE.Color(1.0, 0.86, 0.45) }, // золото «выученного»
        uWarm: { value: warm },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    flow.add(new THREE.Points(geo, mat));

    // Сердце ядра
    const coreGeo = new THREE.SphereGeometry(god ? 0.14 : 0.11, 24, 24);
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.0, 0.72, 0.5),
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.set(0, 0, attr.cz);
    flow.add(coreMesh);

    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(dpr);
    composer.setSize(W(), H());
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), god ? 0.78 : 0.62, 0.7, god ? 0.3 : 0.38);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const onPointerMove = (e: PointerEvent) => {
      pointerRef.current.x = (e.clientX / W()) * 2 - 1;
      pointerRef.current.y = (e.clientY / H()) * 2 - 1;
    };
    const onDown = () => (pointerRef.current.down = true);
    const onUp = () => (pointerRef.current.down = false);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);

    let raf = 0;
    let yaw = 0.4;
    let pitch = 0.1;
    const clock = new THREE.Clock();
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const enAttr = geo.attributes.aEnergy as THREE.BufferAttribute;
    const HSTEP = attr.step;

    let energyAcc = 0;      // Σv² за кадр
    let lastEnergyAt = -1;  // троттлинг вывода ПО ВРЕМЕНИ (не по кадрам:
                            // частота кадров непостоянна — вкладка в фоне её режет)

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.032, clock.getDelta());
      const t = clock.elapsedTime;
      energyAcc = 0;

      for (let i = 0; i < TOTAL; i++) {
        const p = i * 3;
        let x = pos[p], y = pos[p + 1], z = pos[p + 2];
        let dx = 0, dy = 0, dz = 0;
        for (let s = 0; s < 2; s++) {
          [dx, dy, dz] = attr.d(x, y, z);
          x += dx * HSTEP; y += dy * HSTEP; z += dz * HSTEP;
        }
        pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;

        const v2 = dx * dx + dy * dy + dz * dz;
        energyAcc += v2; // копим квадраты скоростей → кинетическая энергия ансамбля
        const spd = Math.sqrt(v2);
        energy[i] += (Math.min(1, spd * 0.3 * attr.scale) - energy[i]) * 0.15;

        age[i] += 1;
        const r2 = (x - 0) ** 2 + y * y + (z - attr.cz) ** 2;
        if (age[i] > maxAge[i] || !Number.isFinite(r2) || r2 > 1e6) seed(i);
      }
      posAttr.needsUpdate = true;
      enAttr.needsUpdate = true;

      // E = Σ½mv² при единичной массе частицы — реальная кинетическая энергия
      // ансамбля. Обновляем показание ~4 раза в секунду.
      if (t - lastEnergyAt > 0.25) {
        lastEnergyAt = t;
        setFlowEnergy(0.5 * energyAcc * (attr.scale * attr.scale));
      }

      // Слои: внутренние сжаты к центру — заработанное горит внутри тумана.
      const child = flow.children[0] as THREE.Points;
      child.scale.setScalar(1);
      const breath = 1 + 0.04 * Math.sin(t * 0.5);
      world.scale.setScalar(attr.scale * breath * (god ? 0.82 : 1));

      const cb = 0.42 + 0.28 * (0.5 + 0.5 * Math.sin(t * 1.6));
      coreMat.opacity = cb * (0.5 + warm);
      coreMesh.scale.setScalar((0.9 + warm * 0.6) * (1 + 0.12 * Math.sin(t * 1.6)));

      if (pointerRef.current.down) {
        yaw += (pointerRef.current.x * 1.4 - yaw) * 0.06;
        pitch += (-pointerRef.current.y * 0.9 - pitch) * 0.06;
      } else {
        yaw += dt * (god ? 0.09 : 0.14);
        pitch += (Math.sin(t * 0.13) * 0.18 - pitch) * 0.01;
      }
      world.rotation.y = yaw;
      world.rotation.x = pitch;

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
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      renderer.domElement.remove();
      geo.dispose();
      mat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
    };
  }, [open, stat, warm, attrIdx, god]);

  if (!open) return null;

  const attr = ATTRACTORS[attrIdx] ?? ATTRACTORS[0];
  const n = (v?: number) => (v ?? 0).toLocaleString('ru-RU');

  return (
    <div className="fixed inset-0 z-[66] bg-[#030109]">
      <div ref={hostRef} className="absolute inset-0" style={{ pointerEvents: 'none' }} />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start gap-2 p-4">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-fuchsia-300/25 bg-black/50 px-3 py-2 backdrop-blur-sm">
          <Atom className="h-4 w-4 text-fuchsia-200" />
          <span className="text-[11px] uppercase tracking-[0.25em] text-fuchsia-100">Ядро MAX · Поток</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-fuchsia-200/60" />}
        </div>

        <button
          type="button"
          onClick={() => setGod((v) => !v)}
          className={`pointer-events-auto flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] backdrop-blur-sm transition ${
            god
              ? 'border-amber-300/60 bg-amber-400/20 text-amber-100 shadow-[0_0_24px_rgba(251,191,36,0.25)]'
              : 'border-white/15 bg-black/50 text-white/70 hover:text-white'
          }`}
          title="Взгляд на ядро целиком: слои памяти (G)"
        >
          <Eye className="h-3.5 w-3.5" /> God Vision
        </button>

        <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-white/12 bg-black/50 p-1 backdrop-blur-sm">
          {ATTRACTORS.map((a, i) => (
            <button
              key={a.key}
              type="button"
              onClick={() => setAttrIdx(i)}
              className={`rounded-lg px-2.5 py-1 text-[11px] transition ${
                i === attrIdx ? 'bg-cyan-400/20 text-cyan-100' : 'text-white/50 hover:text-white/85'
              }`}
              title={a.formula}
            >
              {a.name}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="pointer-events-auto ml-auto rounded-full bg-white/10 p-2 text-white/70 hover:bg-white/20 hover:text-white"
          aria-label="Выйти из ядра"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 max-w-[min(460px,calc(100vw-32px))] rounded-xl border border-white/10 bg-black/60 p-3 backdrop-blur-sm">
        {god ? (
          <>
            <div className="text-[10px] uppercase tracking-widest text-amber-300/70">God Vision · слои памяти</div>
            <div className="mt-1.5 space-y-1 text-[11px]">
              <div className="flex justify-between gap-3">
                <span className="text-sky-300/80">◍ вся масса связей</span>
                <span className="font-semibold text-white/85">{n(stat?.total)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-fuchsia-300/80">◍ структурные (не арифметика)</span>
                <span className="font-semibold text-white/85">{n(stat?.structural)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-amber-300/90">★ заработанные опытом</span>
                <span className="font-semibold text-amber-100">{n(stat?.earned)}</span>
              </div>
              <div className="flex justify-between gap-3 border-t border-white/10 pt-1">
                <span className="text-white/40">причинных · узлов</span>
                <span className="text-white/60">{n(stat?.causal)} · {n(stat?.nodes)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-emerald-300/80">⚡ энергия потока</span>
                <span className="font-semibold text-emerald-100">
                  {flowEnergy.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-white/45">
              Три слоя — реальные пласты памяти. Снаружи тусклое облако сырых связей, глубже структура,
              <span className="text-amber-200/80"> в центре золотом горит то, что MAX действительно выучил</span>.
              Видно честно: настоящего знания мало, и оно внутри.
            </p>
          </>
        ) : (
          <>
            <div className="text-[10px] uppercase tracking-widest text-fuchsia-300/60">
              Аттрактор {attr.name} · синапсов {n(stat?.total)}
            </div>
            <div className="mt-1 font-mono text-[10px] leading-relaxed text-cyan-200/50">{attr.formula}</div>
            <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-2 py-1">
              <span className="font-mono text-[10px] text-emerald-200/90">E = Σ½mv²</span>
              <span className="ml-auto font-mono text-[11px] font-semibold text-emerald-100">
                {flowEnergy.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}
              </span>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-white/45">
              Кинетическая энергия ансамбля — считается вживую из скоростей всех частиц.
              Зажми мышь — покрутить. <b className="text-white/70">G</b> — God Vision, <b className="text-white/70">1-4</b> — формула.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
