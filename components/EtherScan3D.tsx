'use client';

/**
 * EtherScan3D — «MAX · Эфир». Честный 3D-радар того, что РЕАЛЬНО рядом:
 * Bluetooth-устройства (по RSSI → расстояние), устройства в локальной сети (ARP)
 * и твоя Wi-Fi. Данные из /api/scan — только то, что отдаёт железо Мака, без
 * «сквозь стены». MAX в центре, устройства вокруг по кольцам (ближе сигнал —
 * ближе и крупнее), радарный луч, bloom. Открыть: `ether:toggle` (команда /эфир).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Brain, Loader2, Radar, RefreshCw, ScrollText, Sparkles, X } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';
import { appBasePath } from '@/lib/base-path';

type DType = 'phone' | 'headphones' | 'computer' | 'router' | 'tv' | 'speaker' | 'watch' | 'unknown';
type Move = 'approach' | 'leave' | 'steady';
type Device = { id: string; kind: 'bt' | 'lan' | 'wifi' | 'self'; dtype?: DType; name: string; detail: string; vendor?: string; rssi: number | null; dist: number; move?: Move };
type Scan = { ok: boolean; counts?: Record<string, number>; closest?: { name: string; rssi: number } | null; devices?: Device[] };

const DICON: Record<string, string> = {
  phone: '📱', headphones: '🎧', computer: '💻', router: '📡', tv: '📺', speaker: '🔊', watch: '⌚', unknown: '•',
};

const KIND_COLOR: Record<string, THREE.ColorRepresentation> = {
  wifi: 0xff4fd0, // магента
  bt: 0x4fd0ff, // циан
  lan: 0xa06bff, // фиолет
  self: 0xffffff,
};
const KIND_LABEL: Record<string, string> = { wifi: 'Wi-Fi', bt: 'Bluetooth', lan: 'Сеть', self: 'MAX' };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

function labelSprite(text: string, color: string): THREE.Sprite {
  const font = '500 26px ui-sans-serif, system-ui, sans-serif';
  const meas = document.createElement('canvas').getContext('2d')!;
  meas.font = font;
  const w = Math.ceil(meas.measureText(text).width) + 16;
  const h = 38;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 8, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.9 }));
  sp.scale.set((w / h) * 0.3, 0.3, 1);
  return sp;
}

export default function EtherScan3D() {
  const [open, setOpen] = useState(false);
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [logRows, setLogRows] = useState<Record<string, unknown>[]>([]);
  const [research, setResearch] = useState('');
  const [researching, setResearching] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<Scan | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const seenRef = useRef<Set<string>>(new Set());
  const newRef = useRef<Set<string>>(new Set());
  const rssiRef = useRef<Map<string, number>>(new Map());
  const firstScanRef = useRef(true);
  const [arrival, setArrival] = useState('');

  const doScan = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(`${appBasePath}/api/scan`, { cache: 'no-store' });
      const data = (await r.json()) as Scan;
      const devs = data.devices ?? [];
      // Детектор движения: сравниваем сигнал с прошлым сканом (тренд RSSI).
      // Сигнал вырос (ближе к 0) на ≥4 dBm → приближается, упал → уходит.
      devs.forEach((d) => {
        if (d.rssi == null) return;
        const prev = rssiRef.current.get(d.id);
        if (prev != null) {
          const delta = d.rssi - prev;
          d.move = delta >= 4 ? 'approach' : delta <= -4 ? 'leave' : 'steady';
        }
        rssiRef.current.set(d.id, d.rssi);
      });
      const logEvent = (event: string, names: string) =>
        void fetch(`${appBasePath}/api/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event, names }),
        }).catch(() => undefined);

      const approaching = devs.filter((d) => d.move === 'approach');
      const leaving = devs.filter((d) => d.move === 'leave');
      if (!firstScanRef.current && approaching.length > 0) {
        const who = approaching.map((d) => d.name).slice(0, 2).join(', ');
        setArrival(`↗ Приближается: ${who}`);
        window.dispatchEvent(new CustomEvent('max:announce', { detail: { text: `${who} приближается` } }));
        logEvent('approach', who);
        setTimeout(() => setArrival(''), 7000);
      }
      if (!firstScanRef.current && leaving.length > 0) logEvent('leave', leaving.map((d) => d.name).slice(0, 3).join(', '));
      // «MAX замечает новых»: сравниваем с тем, кто был в эфире раньше.
      const fresh = devs.filter((d) => !seenRef.current.has(d.id));
      if (!firstScanRef.current && fresh.length > 0) {
        newRef.current = new Set(fresh.map((d) => d.id));
        const names = fresh.map((d) => d.name).slice(0, 3).join(', ');
        setArrival(`🛰 Новый в эфире: ${names}`);
        window.dispatchEvent(new CustomEvent('max:announce', { detail: { text: `Рядом появился: ${names}` } }));
        logEvent('arrival', names);
        setTimeout(() => setArrival(''), 9000);
      } else {
        newRef.current = new Set();
      }
      devs.forEach((d) => seenRef.current.add(d.id));
      firstScanRef.current = false;
      setScan(data);
      scanRef.current = data;
    } catch {
      /* оставляем прошлый скан */
    } finally {
      setBusy(false);
    }
  }, []);

  const analyze = useCallback(async () => {
    const devs = scanRef.current?.devices ?? [];
    if (devs.length === 0) return;
    setAnalyzing(true);
    setAnalysis('');
    try {
      const list = devs
        .map((d) => `- ${KIND_LABEL[d.kind]}: ${d.name} (${d.rssi != null ? d.rssi + ' dBm' : 'без сигнала'})`)
        .join('\n');
      const r = (await sendMax17Event({
        type: 'llm_raw',
        system:
          'Ты — MAX, ИИ вселенной GAME. Тебе дали список устройств, которые РЕАЛЬНО в радиоэфире рядом с Мироном (Bluetooth/Wi-Fi/локальная сеть). ' +
          'Коротко и по делу опиши, что вокруг: сколько устройств, что ближе всего, что за техника похоже. НЕ выдумывай «сквозь стены» и людей — только то, что в списке. 3-4 предложения, по-русски, тёпло.',
        text: `Устройства в эфире рядом:\n${list}`,
      })) as { llm?: { text?: string }; llm_text?: string; answer?: { text?: string } };
      setAnalysis(String(r.llm_text || r.llm?.text || r.answer?.text || '').trim() || 'MAX промолчал.');
    } catch (e) {
      setAnalysis('Не удалось прочитать эфир: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const loadLog = useCallback(async () => {
    try {
      const r = await fetch(`${appBasePath}/api/scan?log=80`, { cache: 'no-store' });
      const d = (await r.json()) as { log?: Record<string, unknown>[] };
      setLogRows((d.log ?? []).slice().reverse()); // новые сверху
    } catch {
      /* лог недоступен — не критично */
    }
  }, []);

  // Агент MAX: читает всю летопись эфира и ставит по ней ресерч (разбор паттернов),
  // затем пишет вывод обратно в лог как событие research.
  const researchLog = useCallback(async () => {
    setResearching(true);
    setResearch('');
    try {
      const r = await fetch(`${appBasePath}/api/scan?log=200`, { cache: 'no-store' });
      const d = (await r.json()) as { log?: Record<string, unknown>[] };
      const rows = d.log ?? [];
      // Компактная сводка лога для ядра.
      const scans = rows.filter((x) => x.event === 'scan');
      const events = rows.filter((x) => x.event !== 'scan' && x.event !== 'research');
      const seen = new Map<string, { n: number; rssi: number[] }>();
      for (const s of scans) {
        for (const dev of ((s.devices as Record<string, unknown>[]) ?? [])) {
          const name = String(dev.name);
          const e = seen.get(name) ?? { n: 0, rssi: [] };
          e.n += 1;
          if (typeof dev.rssi === 'number') e.rssi.push(dev.rssi);
          seen.set(name, e);
        }
      }
      const digest = [...seen.entries()]
        .sort((a, b) => b[1].n - a[1].n)
        .map(([name, e]) => `${name}: в ${e.n}/${scans.length} сканах${e.rssi.length ? `, сигнал ~${Math.round(e.rssi.reduce((s, v) => s + v, 0) / e.rssi.length)} dBm` : ''}`)
        .join('\n');
      const evLog = events.slice(-12).map((x) => `${String(x.iso).slice(11, 19)} ${x.event}: ${x.names}`).join('\n');

      const resp = (await sendMax17Event({
        type: 'llm_raw',
        system:
          'Ты — MAX, аналитик радиоэфира вокруг Мирона. Тебе дают ЛОГ реальных сканов (Bluetooth/Wi-Fi/сеть) за сессию. ' +
          'Сделай ресерч по фактам лога: кто постоянно рядом, кто редко, у кого сигнал скакал (двигался), были ли новые устройства или уходы. ' +
          'НЕ выдумывай устройств, которых нет в логе. 4-6 предложений, по-русски, по делу, как отчёт агента.',
        text: `ЛОГ ЭФИРА (${scans.length} сканов):\n\nПрисутствие устройств:\n${digest}\n\nСобытия:\n${evLog || 'нет'}`,
      })) as { llm?: { text?: string }; llm_text?: string; answer?: { text?: string } };
      const out = String(resp.llm_text || resp.llm?.text || resp.answer?.text || '').trim() || 'MAX не смог собрать ресерч.';
      setResearch(out);
      // пишем ресерч обратно в летопись
      void fetch(`${appBasePath}/api/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'research', text: out }),
      }).catch(() => undefined);
      void loadLog();
    } catch (e) {
      setResearch('Ресерч не удался: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setResearching(false);
    }
  }, [loadLog]);

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('ether:toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('ether:toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // при открытии — скан + автообновление раз в 8с
  useEffect(() => {
    if (!open) return;
    // сброс: «новые» считаем относительно момента открытия эфира
    seenRef.current = new Set();
    newRef.current = new Set();
    rssiRef.current = new Map();
    firstScanRef.current = true;
    setArrival('');
    void doScan();
    const iv = setInterval(() => void doScan(), 8000);
    return () => clearInterval(iv);
  }, [open, doScan]);

  // Живой лог: пока панель лога открыта — подтягиваем свежие записи.
  useEffect(() => {
    if (!open || !showLog) return;
    void loadLog();
    const iv = setInterval(() => void loadLog(), 5000);
    return () => clearInterval(iv);
  }, [open, showLog, loadLog]);

  const devices = useMemo(() => scan?.devices ?? [], [scan]);

  // 3D-сцена: пересобирается при смене набора устройств
  useEffect(() => {
    if (!open) return;
    const host = hostRef.current;
    if (!host) return;

    const W = () => window.innerWidth;
    const H = () => window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03040d);
    const camera = new THREE.PerspectiveCamera(52, W() / H(), 0.1, 200);
    camera.position.set(0, 2.9, 6.2);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W(), H());
    host.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';

    const world = new THREE.Group();
    scene.add(world);

    // кольца-дальномеры
    for (let r = 1; r <= 4; r++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.012, r + 0.012, 96),
        new THREE.MeshBasicMaterial({ color: 0x2a3b6b, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      world.add(ring);
    }

    // центр — MAX
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.34, 3),
      new THREE.MeshBasicMaterial({ color: 0xff59d6, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }),
    );
    world.add(core);
    const coreLabel = labelSprite('MAX', '#ffd6f4');
    coreLabel.position.set(0, 0.5, 0);
    world.add(coreLabel);

    // радарный луч
    const sweep = new THREE.Mesh(
      new THREE.CircleGeometry(4, 48, 0, Math.PI / 7),
      new THREE.MeshBasicMaterial({ color: 0x4fd0ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    sweep.rotation.x = -Math.PI / 2;
    world.add(sweep);

    // устройства
    const nodeSprites: THREE.Sprite[] = [];
    const geoms: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    const spokeMats: THREE.Material[] = [];
    const pulseRings: THREE.Mesh[] = [];
    const n = Math.max(1, devices.length);
    devices.forEach((d, i) => {
      // равномерно по кругу (индекс) + лёгкий джиттер, чтобы подписи не слипались
      const theta = (i / n) * Math.PI * 2 + (hash(d.id) - 0.5) * 0.5;
      const r = 0.9 + d.dist * 3.1;
      const y = (d.kind === 'wifi' ? 0.15 : d.kind === 'bt' ? 0.45 : 0.05) + (i % 2 ? 0.32 : -0.02);
      const pos = new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r);
      const col = new THREE.Color(KIND_COLOR[d.kind]);
      const size = 0.14 + (d.rssi != null ? Math.max(0, (d.rssi + 90) / 60) * 0.16 : 0.06);

      const g = new THREE.SphereGeometry(size, 16, 16);
      const m = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.copy(pos);
      world.add(mesh);
      geoms.push(g);
      mats.push(m);

      // спица к центру
      const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), pos]);
      const sm = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending });
      world.add(new THREE.Line(sg, sm));
      geoms.push(sg);
      spokeMats.push(sm);

      const icon = DICON[d.dtype ?? 'unknown'] ?? '•';
      const arrow = d.move === 'approach' ? ' ↗' : d.move === 'leave' ? ' ↘' : '';
      const base = d.name.length > 20 ? d.name.slice(0, 19) + '…' : d.name;
      const label = labelSprite(`${icon} ${base}${arrow}`, d.move === 'approach' ? '#8effc0' : d.move === 'leave' ? '#ff9db0' : '#dfe8ff');
      label.position.copy(pos).add(new THREE.Vector3(0, size + 0.22, 0));
      world.add(label);
      nodeSprites.push(label);

      // новичок в эфире — пульсирующее кольцо-маркер
      if (newRef.current.has(d.id)) {
        const rg = new THREE.RingGeometry(size + 0.08, size + 0.14, 40);
        const rm = new THREE.MeshBasicMaterial({ color: 0xffe14f, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
        const ring = new THREE.Mesh(rg, rm);
        ring.position.copy(pos);
        ring.userData.pulse = true;
        world.add(ring);
        geoms.push(rg);
        mats.push(rm);
        pulseRings.push(ring);
      }
    });

    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    composer.setSize(W(), H());
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.6, 0.5, 0.28);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const onPointer = (e: PointerEvent) => {
      pointerRef.current.x = (e.clientX / W()) * 2 - 1;
      pointerRef.current.y = (e.clientY / H()) * 2 - 1;
    };
    window.addEventListener('pointermove', onPointer);

    let raf = 0;
    let yaw = 0;
    const clock = new THREE.Clock();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();
      sweep.rotation.z = -t * 1.1;
      core.rotation.y += 0.01;
      core.scale.setScalar(1 + Math.sin(t * 2) * 0.06);
      yaw += ((pointerRef.current.x * 0.8 + t * 0.06) - yaw) * 0.04;
      world.rotation.y = yaw;
      const p = 1 + Math.sin(t * 5) * 0.35;
      pulseRings.forEach((r) => {
        r.scale.setScalar(p);
        (r.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(t * 5) * 0.4;
        r.quaternion.copy(camera.quaternion);
      });
      [coreLabel, ...nodeSprites].forEach((s) => s.quaternion.copy(camera.quaternion));
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
      geoms.forEach((g) => g.dispose());
      [...mats, ...spokeMats].forEach((m) => m.dispose());
      nodeSprites.forEach((s) => {
        s.material.map?.dispose();
        s.material.dispose();
      });
      coreLabel.material.map?.dispose();
      coreLabel.material.dispose();
      (core.material as THREE.Material).dispose();
      core.geometry.dispose();
      (sweep.material as THREE.Material).dispose();
      sweep.geometry.dispose();
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
    };
  }, [open, devices]);

  if (!open) return null;

  const c = scan?.counts;

  return (
    <div className="fixed inset-0 z-[64] bg-[#03040d]">
      <div ref={hostRef} className="absolute inset-0" style={{ pointerEvents: 'none' }} />

      {arrival && (
        <div className="pointer-events-none absolute left-1/2 top-20 -translate-x-1/2 rounded-xl border border-amber-300/40 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-100 backdrop-blur-sm">
          {arrival}
        </div>
      )}

      {/* Живой лог эфира справа */}
      {showLog && (
        <div className="absolute right-4 top-16 flex max-h-[70vh] w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-cyan-300/20 bg-black/70 backdrop-blur-sm">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-[11px] uppercase tracking-widest text-cyan-100/70">
            <ScrollText className="h-3.5 w-3.5" /> Летопись эфира
            <span className="ml-auto text-white/35">{logRows.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-1.5 font-mono text-[10px] leading-relaxed">
            {logRows.length === 0 && <div className="p-2 text-white/40">лог пуст</div>}
            {logRows.map((row, i) => {
              const iso = String(row.iso || '');
              const t = iso.slice(11, 19);
              const ev = String(row.event || '');
              if (ev === 'scan') {
                const cnt = (row.counts as { total?: number })?.total ?? 0;
                const cl = (row.closest as { name?: string })?.name ?? '—';
                return (
                  <div key={i} className="border-b border-white/[0.04] py-0.5 text-white/55">
                    <span className="text-white/35">{t}</span> скан · {cnt} устр · ближе {cl}
                  </div>
                );
              }
              const color =
                ev === 'arrival' ? 'text-emerald-300' : ev === 'leave' ? 'text-rose-300' : ev === 'approach' ? 'text-cyan-300' : 'text-amber-300';
              const icon = ev === 'arrival' ? '🛰' : ev === 'leave' ? '↘' : ev === 'approach' ? '↗' : '🧠';
              return (
                <div key={i} className={`border-b border-white/[0.04] py-1 ${color}`}>
                  <span className="text-white/35">{t}</span> {icon} {ev}
                  {row.names ? ` · ${row.names}` : ''}
                  {row.text ? <div className="mt-0.5 text-white/70">{String(row.text)}</div> : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-3 p-4">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-cyan-300/25 bg-black/50 px-3 py-2 backdrop-blur-sm">
          <Radar className="h-4 w-4 text-cyan-200" />
          <span className="text-[11px] uppercase tracking-[0.25em] text-cyan-100">MAX · Эфир</span>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-200/60" />}
        </div>
        <button
          type="button"
          onClick={() => void doScan()}
          disabled={busy}
          className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-[11px] text-white/70 backdrop-blur-sm hover:bg-white/10 disabled:opacity-40"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Скан
        </button>
        <button
          type="button"
          onClick={() => void analyze()}
          disabled={analyzing || devices.length === 0}
          className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-fuchsia-300/25 bg-fuchsia-500/15 px-3 py-2 text-[11px] text-fuchsia-100 backdrop-blur-sm hover:bg-fuchsia-400/25 disabled:opacity-40"
        >
          {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} MAX читает эфир
        </button>
        <button
          type="button"
          onClick={() => setShowLog((v) => !v)}
          className={`pointer-events-auto flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] backdrop-blur-sm ${showLog ? 'border-cyan-300/40 bg-cyan-500/20 text-cyan-50' : 'border-white/10 bg-black/50 text-white/70 hover:bg-white/10'}`}
        >
          <ScrollText className="h-3.5 w-3.5" /> Лог
        </button>
        <button
          type="button"
          onClick={() => void researchLog()}
          disabled={researching}
          className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-amber-300/30 bg-amber-500/15 px-3 py-2 text-[11px] text-amber-100 backdrop-blur-sm hover:bg-amber-400/25 disabled:opacity-40"
        >
          {researching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />} MAX: ресерч лога
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="pointer-events-auto ml-auto rounded-full bg-white/10 p-2 text-white/70 hover:bg-white/20 hover:text-white"
          aria-label="Выйти"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 max-w-[min(440px,calc(100vw-32px))] rounded-xl border border-white/10 bg-black/55 p-3 backdrop-blur-sm">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <span className="text-white/45">Найдено: <b className="text-white/85">{c?.total ?? 0}</b></span>
          <span className="text-fuchsia-300/80">Wi-Fi {c?.wifi ?? 0}</span>
          <span className="text-cyan-300/80">Bluetooth {c?.bt ?? 0}</span>
          <span className="text-violet-300/80">Сеть {c?.lan ?? 0}</span>
        </div>
        {scan?.closest && (
          <div className="mt-1 text-[11px] text-white/60">
            Ближе всего: <span className="text-white/85">{scan.closest.name}</span> ({scan.closest.rssi} dBm)
          </div>
        )}
        {analysis && (
          <div className="mt-2 rounded-lg border border-fuchsia-300/20 bg-fuchsia-400/[0.06] p-2 text-[11px] leading-snug text-white/85">{analysis}</div>
        )}
        {research && (
          <div className="mt-2 rounded-lg border border-amber-300/25 bg-amber-400/[0.07] p-2 text-[11px] leading-snug text-white/85">
            <div className="mb-0.5 flex items-center gap-1 text-[10px] uppercase tracking-widest text-amber-300/70">
              <Brain className="h-3 w-3" /> Ресерч лога · MAX-агент
            </div>
            {research}
          </div>
        )}
        {devices.some((d) => d.move === 'approach' || d.move === 'leave') && (
          <div className="mt-1 flex flex-wrap gap-x-3 text-[11px]">
            {devices.filter((d) => d.move === 'approach').slice(0, 2).map((d) => (
              <span key={d.id} className="text-emerald-300/90">↗ {d.name} ближе</span>
            ))}
            {devices.filter((d) => d.move === 'leave').slice(0, 2).map((d) => (
              <span key={d.id} className="text-rose-300/80">↘ {d.name} дальше</span>
            ))}
          </div>
        )}
        <p className="mt-1.5 text-[10px] leading-relaxed text-white/40">
          Реальный радиоэфир: Bluetooth (сигнал → расстояние), сеть, Wi-Fi. Иконка = тип, ↗ приближается / ↘ уходит по тренду сигнала. Только то, что видит железо.
        </p>
      </div>
    </div>
  );
}
