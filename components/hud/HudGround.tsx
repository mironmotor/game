'use client';

/**
 * HudGround — ЗЕМЛЯ МИРА. 3D-сцена, на которой стоит весь интерфейс GAME.
 *
 * Раньше фон был плоским: обои + солнечная система в небе. Теперь под окнами
 * появилась ЗЕМЛЯ — уходящая к горизонту полярная сетка, а на ней стоят объекты
 * меты, как приборы в интерфейсе Джарвиса. Всё рисуется по одному своду правил
 * (vision-style.ts), поэтому сцена читается как один кадр, а не как набор эффектов.
 *
 * Что стоит на земле — не декор, у каждого объекта живые данные:
 *   • БАШНЯ ЯДРА в центре — сам MAX: столб света, гироскопы, ядро.
 *     Крутится быстрее на мысли, ярче на речи; по земле идёт волна на каждое слово.
 *   • МОНОЛИТЫ вокруг — верхние концепты синапс-графа. Это и есть «мета, внутри
 *     которой ИИ растёт»: архитектура мира — его собственный граф, а не наша выдумка.
 *   • ДУГА у подножия — дорога к 1M ЗАРАБОТАННЫХ синапсов (earned_progress).
 *   • ПИЛОНЫ слева — миссии игрока: высота от XP, свет от статуса.
 *   • МОНЕТА справа — MirCoin: локальный журнал начислений (не блокчейн).
 *   • ЛИНЗА слева вверху — зрение MAX: открыта, когда включена камера.
 *
 * Адаптивность: горизонт, дальность и плотность считаются от экрана и железа
 * (телефон и слабые машины получают low-профиль), палитра берётся из живых
 * переменных темы — мир перекрашивается вместе с HUD. Уважает prefers-reduced-motion,
 * замирает на скрытой вкладке и на время полноэкранного 3D-ядра.
 *
 * Клик по объекту открывает то, что он показывает. Курсор ловится только над
 * объектом — пустая земля кликов не перехватывает, под ней живёт солнечная система.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { ambientActive, ambientFrame } from '@/lib/ambient-audio';
import { subscribeGraphPulse, type GraphPulse } from '@/lib/graph-pulse';
import { getSceneMode, hasGround, subscribeSceneMode, toggleGround, type SceneMode } from '@/lib/scene-mode';
import type { Task } from '@/hooks/use-game-state';
import type { NeuralCoreStatus } from './NeuralCore';
import {
  VISION,
  bandMaterial,
  beamMaterial,
  groundFade,
  fillMaterial,
  lineMaterial,
  makeLabel,
  moteMaterial,
  paletteKey,
  prefersCalm,
  readPalette,
  shellMaterial,
  visionTier,
  type VisionLabel,
  type VisionPalette,
} from './vision-style';

const CONCEPT_SLOTS = 6;
const PYLON_SLOTS = 5;

// Граф отдаёт верхние концепты как есть, а среди них попадаются служебные ключи
// вроде «8C68EB2D5E06632». На земле такой монолит читается как поломка мира, а не
// как смысл, поэтому имена без единой буквы и голые хэши отбрасываем, а длинные
// подрезаем — подпись должна помещаться над башней, а не наезжать на соседнюю.
const HASH_LIKE = /^[0-9a-f]{6,}$/i;
const MAX_LABEL = 18;

function readableConcept(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (text.length < 2) return null;
  if (!/[a-zA-Zа-яёА-ЯЁ]/.test(text)) return null;
  if (HASH_LIKE.test(text.replace(/[\s_-]/g, ''))) return null;
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}
/** Цель дороги к 1M — если ядро не прислало свою. */
const SYNAPSE_TARGET = 1_000_000;

export interface HudGroundProps {
  coreStatus: NeuralCoreStatus;
  missions: Task[];
  balance: number;
  isCameraActive: boolean;
  onToggleCamera?: () => void;
  onOpenMissions?: () => void;
  className?: string;
}

type Role = keyof VisionPalette;

interface Hotspot {
  proxy: THREE.Mesh;
  label: string;
  activate: () => void;
  /** Что подсветить на наведении. */
  glow: (amount: number) => void;
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('ru-RU').replace(/,/g, ' ');
}

// Земля включается режимом сцены (lib/scene-mode), а не собственным тумблером:
// иначе «Мир 3D» из дока и панель «Вид» спорили бы за одно и то же состояние.
// Кнопка дока продолжает слать `world:toggle` — здесь он и обрабатывается.

export function HudGround(props: HudGroundProps) {
  const { className = '' } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const mode = useSyncExternalStore(subscribeSceneMode, getSceneMode, () => 'all' as SceneMode);
  const on = hasGround(mode);

  useEffect(() => {
    window.addEventListener('world:toggle', toggleGround);
    return () => window.removeEventListener('world:toggle', toggleGround);
  }, []);

  // Живые значения для кадра: сцена строится один раз, данные втекают через ref.
  const liveRef = useRef(props);
  useEffect(() => {
    liveRef.current = props;
  });

  useEffect(() => {
    if (!on) return;
    const host = hostRef.current;
    if (!host) return;

    const tier = visionTier();
    const calm = prefersCalm();
    const mobile = window.matchMedia('(max-width: 700px)').matches;

    const W = () => host.clientWidth || window.innerWidth;
    const H = () => host.clientHeight || window.innerHeight;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: tier !== 'low',
        alpha: true,
        powerPreference: 'low-power',
      });
    } catch {
      return; // нет WebGL — интерфейс живёт и без земли
    }
    renderer.setClearColor(0x000000, 0);
    const maxDpr = tier === 'high' ? 1.75 : tier === 'mid' ? 1.35 : 1.25;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.setSize(W(), H());
    renderer.domElement.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    host.appendChild(renderer.domElement);

    // ── камера: горизонт ровно на заданной доле экрана ───────────────────────
    const horizonFrac = mobile ? VISION.horizon.mobile : VISION.horizon.desktop;
    const camHeight = 2.6;
    const camDist = mobile ? 26 : 24;
    const halfFov = THREE.MathUtils.degToRad(VISION.fov / 2);
    const pitch = Math.atan(2 * (horizonFrac - 0.5) * Math.tan(halfFov));
    const aim = new THREE.Vector3(0, camHeight + camDist * Math.tan(pitch), 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(VISION.fov, W() / H(), 0.1, 280);
    camera.position.set(0, camHeight, camDist);
    camera.lookAt(aim);

    // Мир отодвинут от камеры: башня ядра стоит в глубине, ближние приборы —
    // перед ней, но выше нижней кромки, где начинаются окна чата и вывода.
    const world = new THREE.Group();
    world.position.z = mobile ? -12 : -10;
    scene.add(world);

    // ── стиль: палитра темы + учёт всего созданного для честной уборки ──────
    let palette = readPalette();
    let paletteId = paletteKey(palette);
    const themed: Array<{ role: Role; set: (color: THREE.Color) => void }> = [];
    const trash: Array<{ dispose: () => void }> = [];
    const labels: VisionLabel[] = [];

    const keep = <T extends { dispose: () => void }>(item: T): T => {
      trash.push(item);
      return item;
    };

    const themedLine = (role: Role, opacity: number, vertexColors = false) => {
      const material = keep(lineMaterial(palette[role], opacity, vertexColors));
      themed.push({ role, set: (c) => material.color.copy(c) });
      return material;
    };
    const themedFill = (role: Role, opacity: number) => {
      const material = keep(fillMaterial(palette[role], opacity));
      themed.push({ role, set: (c) => material.color.copy(c) });
      return material;
    };
    const themedShell = (role: Role, power: number, intensity: number) => {
      const material = keep(shellMaterial(palette[role], power, intensity));
      themed.push({ role, set: (c) => (material.uniforms.uColor.value as THREE.Color).copy(c) });
      return material;
    };
    const themedBeam = (base: Role, top: Role, power: number) => {
      const material = keep(beamMaterial(palette[base], palette[top], power));
      themed.push({ role: base, set: (c) => (material.uniforms.uColorBase.value as THREE.Color).copy(c) });
      themed.push({ role: top, set: (c) => (material.uniforms.uColorTop.value as THREE.Color).copy(c) });
      return material;
    };
    const themedMote = (role: Role, size: number, opacity: number) => {
      const material = keep(moteMaterial(palette[role], size, opacity));
      themed.push({ role, set: (c) => (material.uniforms.uColor.value as THREE.Color).copy(c) });
      return material;
    };
    const themedBand = (role: Role, intensity: number) => {
      const material = keep(bandMaterial(palette[role], intensity));
      themed.push({ role, set: (c) => (material.uniforms.uColor.value as THREE.Color).copy(c) });
      return material;
    };
    const themedLabel = (text: string, role: Role, width: number, opacity: number) => {
      const label = makeLabel(text, palette[role], width);
      label.sprite.material.opacity = opacity;
      labels.push(label);
      themed.push({ role, set: (c) => label.set(label.sprite.userData.text as string, c) });
      label.sprite.userData.text = text;
      return label;
    };
    const setLabel = (label: VisionLabel, text: string, role: Role) => {
      if (label.sprite.userData.text === text) return;
      label.sprite.userData.text = text;
      label.set(text, palette[role]);
    };

    const ringGeometry = (radius: number, segments = 96) => {
      const points: number[] = [];
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        points.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      }
      const geometry = keep(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      return geometry;
    };

    // ── ЗЕМЛЯ: полярная сетка, гаснущая с удалением от ядра ─────────────────
    // Гасим не туманом, а самим цветом (правило №5): аддитивная смесь от тумана
    // только светлеет. Заодно это даёт свет: мир освещён ядром, край — темнота.
    const rings = tier === 'low' ? 11 : VISION.grid.rings;
    const spokes = tier === 'low' ? 18 : VISION.grid.spokes;
    const ringStep = VISION.grid.radius / rings;
    const gridPos: number[] = [];
    const gridCol: number[] = [];
    // Камера в системе координат мира — от неё считается «ярко под ногами».
    const camLocalZ = camDist - world.position.z;
    const pushGrid = (x: number, z: number) => {
      const fade = groundFade(Math.hypot(x, z - camLocalZ), Math.hypot(x, z));
      gridPos.push(x, 0, z);
      gridCol.push(fade, fade, fade); // серым — цвет придёт из материала темы
    };
    for (let i = 1; i <= rings; i++) {
      const radius = i * ringStep;
      const segments = Math.max(40, Math.min(tier === 'low' ? 72 : 148, Math.round(radius * 5)));
      for (let s = 0; s < segments; s++) {
        const a0 = (s / segments) * Math.PI * 2;
        const a1 = ((s + 1) / segments) * Math.PI * 2;
        pushGrid(Math.cos(a0) * radius, Math.sin(a0) * radius);
        pushGrid(Math.cos(a1) * radius, Math.sin(a1) * radius);
      }
    }
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2;
      const steps = 14;
      for (let k = 0; k < steps; k++) {
        const r0 = ringStep + (VISION.grid.radius - ringStep) * (k / steps);
        const r1 = ringStep + (VISION.grid.radius - ringStep) * ((k + 1) / steps);
        pushGrid(Math.cos(a) * r0, Math.sin(a) * r0);
        pushGrid(Math.cos(a) * r1, Math.sin(a) * r1);
      }
    }
    const gridGeometry = keep(new THREE.BufferGeometry());
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPos, 3));
    gridGeometry.setAttribute('color', new THREE.Float32BufferAttribute(gridCol, 3));
    const gridMaterial = themedLine('structure', VISION.alpha.grid, true);
    world.add(new THREE.LineSegments(gridGeometry, gridMaterial));

    // Край мира и световая полоса горизонта за ним.
    const rimMaterial = themedLine('energy', 0.3);
    const rim = new THREE.LineLoop(ringGeometry(VISION.grid.radius * 0.92, 160), rimMaterial);
    world.add(rim);

    const bandGeometry = keep(new THREE.PlaneGeometry(340, 30));
    // 1.25 на аддитивном блендинге давало не зарево за краем мира, а яркую черту
    // поперёк кадра: она пробивала полупрозрачные монолиты и резала сцену пополам.
    const band = new THREE.Mesh(bandGeometry, themedBand('energy', 0.45));
    band.position.set(0, 0, -62);
    world.add(band);

    // ── БАШНЯ ЯДРА ──────────────────────────────────────────────────────────
    const tower = new THREE.Group();
    world.add(tower);

    const baseRingMaterial = themedLine('structure', 0.5);
    [3.1, 4.0, 5.1].forEach((radius) => {
      tower.add(new THREE.LineLoop(ringGeometry(radius, 120), baseRingMaterial));
    });

    const beamMat = themedBeam('mass', 'energy', 1.5);
    const beamGeometry = keep(new THREE.CylinderGeometry(0.95, 2.9, 13, 36, 1, true));
    const beam = new THREE.Mesh(beamGeometry, beamMat);
    beam.position.y = 6.5;
    tower.add(beam);

    const nucleus = new THREE.Group();
    nucleus.position.y = 3.6;
    tower.add(nucleus);

    const nucleusGeometry = keep(new THREE.IcosahedronGeometry(1.15, 1));
    const nucleusEdges = keep(new THREE.EdgesGeometry(nucleusGeometry));
    const nucleusFrame = new THREE.LineSegments(nucleusEdges, themedLine('structure', VISION.alpha.edge));
    nucleus.add(nucleusFrame);
    const nucleusShell = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(1.7, 2)), themedShell('mass', 2.4, 0.5));
    nucleus.add(nucleusShell);
    const heart = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(0.42, 2)), themedFill('hot', 0.5));
    nucleus.add(heart);

    // Гироскопы: три кольца в разных плоскостях — «прибор», а не украшение.
    const gyroMaterial = themedLine('energy', 0.45);
    const gyros: THREE.LineLoop[] = [];
    [
      [0, 0, 0],
      [Math.PI / 2.2, 0.5, 0],
      [0.6, 0, Math.PI / 2.4],
    ].forEach(([rx, ry, rz], index) => {
      const gyro = new THREE.LineLoop(ringGeometry(2.25 + index * 0.28, 110), gyroMaterial);
      gyro.rotation.set(rx, ry, rz);
      nucleus.add(gyro);
      gyros.push(gyro);
    });

    // Волны по земле: одна на мысль, одна на слово.
    const pulseMaterial = themedLine('energy', 0.5);
    const pulses = [0, 1, 2].map(() => {
      const ring = new THREE.LineLoop(ringGeometry(1, 96), pulseMaterial.clone());
      ring.visible = false;
      tower.add(ring);
      return { ring, life: 0 };
    });
    pulses.forEach((slot) => {
      const material = slot.ring.material as THREE.LineBasicMaterial;
      trash.push(material);
      themed.push({ role: 'energy', set: (c) => material.color.copy(c) });
    });
    let pulseCursor = 0;
    const emitPulse = () => {
      const slot = pulses[pulseCursor % pulses.length];
      pulseCursor += 1;
      slot.life = 1;
      slot.ring.visible = true;
    };

    // ── ДОРОГА К 1M: дуга заработанных синапсов у подножия башни ────────────
    // Кольцо лежало плашмя на земле (y = 0.02) при камере высотой 2.6 — в
    // проекции оно вырождалось в яркую черту через весь кадр и читалось как
    // лазер, а не как дорога. Поднимаем над землёй и слегка наклоняем к зрителю:
    // тогда виден эллипс с ближней и дальней кромкой, и путь по нему очевиден.
    const arcPoints: number[] = [];
    const ARC_SEGMENTS = 220;
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
      const a = -Math.PI / 2 + (i / ARC_SEGMENTS) * Math.PI * 2;
      arcPoints.push(Math.cos(a) * 5.8, 0, Math.sin(a) * 5.8);
    }
    const arcRing = new THREE.Group();
    arcRing.position.y = 0.75;
    arcRing.rotation.x = -0.1;
    tower.add(arcRing);
    const arcTrackGeometry = keep(new THREE.BufferGeometry());
    arcTrackGeometry.setAttribute('position', new THREE.Float32BufferAttribute(arcPoints, 3));
    arcRing.add(new THREE.Line(arcTrackGeometry, themedLine('structure', 0.14)));
    const arcGeometry = keep(new THREE.BufferGeometry());
    arcGeometry.setAttribute('position', new THREE.Float32BufferAttribute(arcPoints, 3));
    arcGeometry.setDrawRange(0, 2);
    const arc = new THREE.Line(arcGeometry, themedLine('energy', 0.62));
    arcRing.add(arc);

    const synapseLabel = themedLabel('СИНАПСЫ', 'structure', 5.4, 0.6);
    synapseLabel.sprite.position.set(0, 0.55, 7.4);
    tower.add(synapseLabel.sprite);

    // ── МОНОЛИТЫ: верхние концепты графа = мета, в которой растёт ядро ──────
    const monolithSlots = (tier === 'low' ? 4 : CONCEPT_SLOTS);
    const monolithEdge = themedLine('structure', VISION.alpha.edge);
    const monolithFill = themedFill('mass', VISION.alpha.fill);
    const monolithAnchor = themedLine('structure', 0.22);
    // Место монолита считается от ЧИСЛА пришедших концептов, а не от номера слота.
    // Иначе после отсева хэшей оставшиеся три занимали первые три слота — то есть
    // весь левый край, — и правая половина кадра пустовала. ±41° при fov 46: шире
    // крайние башни уезжают за кромку.
    const MONOLITH_SPREAD = 0.72;
    const placeMonolith = (group: THREE.Group, index: number, total: number) => {
      const t = total <= 1 ? 0 : (index / (total - 1)) * 2 - 1;
      const angle = t * MONOLITH_SPREAD;
      // Три кольца глубины: соседние башни не выстраиваются в плоскую стенку.
      const radius = 22 + (index % 3) * 4.2;
      group.position.set(Math.sin(angle) * radius, 0, -Math.cos(angle) * radius);
      group.rotation.y = angle;
    };

    const monoliths = Array.from({ length: monolithSlots }, (_, index) => {
      const group = new THREE.Group();
      placeMonolith(group, index, monolithSlots);

      const body = new THREE.Mesh(keep(new THREE.BoxGeometry(1.8, 1, 1.8)), monolithFill);
      const frame = new THREE.LineSegments(
        keep(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.8, 1, 1.8))),
        monolithEdge,
      );
      group.add(body, frame);
      group.add(new THREE.LineLoop(ringGeometry(1.75, 48), monolithAnchor));

      const label = themedLabel('—', 'structure', 5.4, 0.42);
      group.add(label.sprite);

      const proxy = new THREE.Mesh(
        keep(new THREE.BoxGeometry(2.6, 1, 2.6)),
        keep(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })),
      );
      group.add(proxy);
      world.add(group);
      return { group, body, frame, label, proxy, height: 4 };
    });
    const setMonolithHeight = (slot: (typeof monoliths)[number], height: number) => {
      slot.height = height;
      slot.body.scale.y = height;
      slot.body.position.y = height / 2;
      slot.frame.scale.y = height;
      slot.frame.position.y = height / 2;
      slot.proxy.scale.y = height;
      slot.proxy.position.y = height / 2;
      slot.label.sprite.position.y = height + 1.9;
    };
    monoliths.forEach((slot) => setMonolithHeight(slot, 4.2));

    // ── ПИЛОНЫ МИССИЙ ──────────────────────────────────────────────────────
    const pylonSlots = tier === 'low' ? 3 : PYLON_SLOTS;
    const pylonEdge = themedLine('structure', 0.55);
    const pylonAnchor = themedLine('structure', 0.2);
    const pylonFillDone = themedFill('energy', 0.3);
    const pylonFillOpen = themedFill('mass', 0.16);
    const pylons = Array.from({ length: pylonSlots }, (_, index) => {
      // Раньше пилоны стояли тесной кучей под монолитами; чуть шире шаг и
      // больше радиус — ряд читается как отдельный прибор, а не как частокол.
      const angle = THREE.MathUtils.degToRad(200 + index * (mobile ? 5.4 : 5.2));
      const radius = 13.2;
      const group = new THREE.Group();
      group.position.set(Math.sin(angle) * radius, 0, -Math.cos(angle) * radius);
      group.rotation.y = angle;

      const frame = new THREE.LineSegments(
        keep(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.42, 1, 0.42))),
        pylonEdge,
      );
      const fill = new THREE.Mesh(keep(new THREE.BoxGeometry(0.34, 1, 0.34)), pylonFillOpen);
      group.add(frame, fill);
      group.add(new THREE.LineLoop(ringGeometry(0.62, 32), pylonAnchor));

      const proxy = new THREE.Mesh(
        keep(new THREE.BoxGeometry(1.2, 3, 1.2)),
        keep(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })),
      );
      proxy.position.y = 1.5;
      group.add(proxy);
      world.add(group);
      return { group, frame, fill, proxy };
    });
    const missionLabel = themedLabel('МИССИИ', 'structure', 3.6, 0.5);
    missionLabel.sprite.position.set(
      Math.sin(THREE.MathUtils.degToRad(200)) * 13.2 - 0.6,
      3.9,
      -Math.cos(THREE.MathUtils.degToRad(200)) * 13.2,
    );
    world.add(missionLabel.sprite);

    // ── МОНЕТА MIRCOIN ─────────────────────────────────────────────────────
    // Честно: это локальный журнал начислений, не блокчейн. Кольцо делений —
    // заполненные насечки журнала; слоты под он-чейн пока не светятся.
    const coin = new THREE.Group();
    coin.position.set(7.6, 0, 11.4);
    world.add(coin);
    coin.add(new THREE.LineLoop(ringGeometry(1.9, 6), themedLine('structure', 0.4)));
    coin.add(new THREE.LineLoop(ringGeometry(2.5, 48), themedLine('structure', 0.16)));

    const coinDisc = new THREE.Group();
    coinDisc.position.y = 2.1;
    coin.add(coinDisc);
    const coinGeometry = keep(new THREE.CylinderGeometry(1.15, 1.15, 0.18, 6));
    coinDisc.add(new THREE.Mesh(coinGeometry, themedFill('energy', 0.22)));
    coinDisc.add(
      new THREE.LineSegments(keep(new THREE.EdgesGeometry(coinGeometry)), themedLine('energy', 0.8)),
    );
    coinDisc.rotation.x = 0.35;

    const coinBeam = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(0.16, 0.5, 2.1, 16, 1, true)),
      themedBeam('mass', 'energy', 0.5),
    );
    coinBeam.position.y = 1.05;
    coin.add(coinBeam);

    const tickMaterial = themedFill('energy', 0.7);
    const tickDim = themedFill('structure', 0.12);
    const TICKS = 12;
    const ticks = Array.from({ length: TICKS }, (_, index) => {
      const a = (index / TICKS) * Math.PI * 2;
      const tick = new THREE.Mesh(keep(new THREE.BoxGeometry(0.1, 0.34, 0.1)), tickDim);
      tick.position.set(Math.cos(a) * 2.5, 0.18, Math.sin(a) * 2.5);
      coin.add(tick);
      return tick;
    });
    const coinLabel = themedLabel('MIRCOIN', 'structure', 3.6, 0.5);
    coinLabel.sprite.position.set(0, 4, 0);
    coin.add(coinLabel.sprite);
    const coinProxy = new THREE.Mesh(
      keep(new THREE.BoxGeometry(3, 4.6, 3)),
      keep(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })),
    );
    coinProxy.position.y = 2.1;
    coin.add(coinProxy);

    // ── ЛИНЗА ЗРЕНИЯ ───────────────────────────────────────────────────────
    const lens = new THREE.Group();
    lens.position.set(-7.2, 4.9, 4);
    world.add(lens);
    const lensRingMaterial = themedLine('structure', 0.5);
    const lensRings = [1.5, 1.05, 0.62].map((radius, index) => {
      const ring = new THREE.LineLoop(ringGeometry(radius, 72), lensRingMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = index * 0.6;
      lens.add(ring);
      return ring;
    });
    const iris = new THREE.Mesh(keep(new THREE.CircleGeometry(0.5, 32)), themedFill('energy', 0.3));
    lens.add(iris);
    const lensShell = new THREE.Mesh(keep(new THREE.SphereGeometry(1.75, 20, 14)), themedShell('mass', 3, 0.4));
    lens.add(lensShell);
    // Якорь: линза висит — значит, у неё есть столб до земли (правило №4).
    const lensBeam = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(0.12, 0.55, 4.9, 14, 1, true)),
      themedBeam('mass', 'structure', 0.34),
    );
    lensBeam.position.y = -2.45;
    lens.add(lensBeam);
    const lensAnchorRing = new THREE.LineLoop(ringGeometry(1.1, 40), themedLine('structure', 0.22));
    lensAnchorRing.position.y = -4.9;
    lens.add(lensAnchorRing);
    const lensLabel = themedLabel('ЗРЕНИЕ', 'structure', 3.2, 0.45);
    lensLabel.sprite.position.set(0, 2.4, 0);
    lens.add(lensLabel.sprite);
    const lensProxy = new THREE.Mesh(
      keep(new THREE.BoxGeometry(3, 3, 3)),
      keep(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })),
    );
    lens.add(lensProxy);

    // ── ПЫЛЬ СИНАПСОВ ──────────────────────────────────────────────────────
    const moteCount = tier === 'high' ? 900 : tier === 'mid' ? 520 : 200;
    const motePos = new Float32Array(moteCount * 3);
    const moteSeed = new Float32Array(moteCount * 3); // радиус, угол, скорость
    const moteScale = new Float32Array(moteCount);
    for (let i = 0; i < moteCount; i++) {
      const radius = 3 + Math.pow(Math.random(), 0.7) * 26;
      const angle = Math.random() * Math.PI * 2;
      moteSeed[i * 3] = radius;
      moteSeed[i * 3 + 1] = angle;
      moteSeed[i * 3 + 2] = 0.25 + Math.random() * 0.9;
      motePos[i * 3] = Math.cos(angle) * radius;
      motePos[i * 3 + 1] = Math.random() * 9;
      motePos[i * 3 + 2] = Math.sin(angle) * radius;
      moteScale[i] = 0.4 + Math.random() * 0.8;
    }
    const moteGeometry = keep(new THREE.BufferGeometry());
    moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
    moteGeometry.setAttribute('aScale', new THREE.BufferAttribute(moteScale, 1));
    const moteMat = themedMote('energy', tier === 'low' ? 20 : 26, 0.55);
    const motes = new THREE.Points(moteGeometry, moteMat);
    world.add(motes);

    // ── горячие точки: клик открывает то, что объект показывает ────────────
    const towerProxy = new THREE.Mesh(
      keep(new THREE.BoxGeometry(5.4, 9, 5.4)),
      keep(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })),
    );
    towerProxy.position.y = 4.2;
    tower.add(towerProxy);

    const hotspots: Hotspot[] = [
      {
        proxy: towerProxy,
        label: 'ЯДРО MAX',
        activate: () => window.dispatchEvent(new CustomEvent('max3d:toggle')),
        glow: (amount) => {
          nucleus.scale.setScalar(1 + amount * 0.12);
          beamMat.uniforms.uPower.value = 1.5 + amount * 0.8;
        },
      },
      {
        proxy: coinProxy,
        label: 'MIRCOIN',
        activate: () => window.dispatchEvent(new CustomEvent('mircoin:toggle')),
        glow: (amount) => {
          coinDisc.scale.setScalar(1 + amount * 0.16);
          coinLabel.sprite.material.opacity = 0.5 + amount * 0.45;
        },
      },
      {
        proxy: lensProxy,
        label: 'ЗРЕНИЕ',
        activate: () => liveRef.current.onToggleCamera?.(),
        glow: (amount) => {
          lens.scale.setScalar(1 + amount * 0.12);
          lensLabel.sprite.material.opacity = 0.45 + amount * 0.5;
        },
      },
      ...pylons.map((pylon) => ({
        proxy: pylon.proxy,
        label: 'МИССИИ',
        activate: () => liveRef.current.onOpenMissions?.(),
        glow: (amount: number) => {
          pylon.group.scale.setScalar(1 + amount * 0.14);
          missionLabel.sprite.material.opacity = 0.5 + amount * 0.45;
        },
      })),
      ...monoliths.map((slot) => ({
        proxy: slot.proxy,
        label: 'ГРАФ',
        activate: () => window.dispatchEvent(new CustomEvent('brain:open')),
        glow: (amount: number) => {
          slot.label.sprite.material.opacity = 0.42 + amount * 0.5;
          slot.group.scale.setScalar(1 + amount * 0.06);
        },
      })),
    ];
    const hoverAmount = new WeakMap<THREE.Mesh, number>();
    const proxies = hotspots.map((h) => h.proxy);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(0, 0);
    const pointerScreen = new THREE.Vector2(0, 0);
    let hovered: Hotspot | null = null;
    let pointerInside = false;
    // Мышь наводится — палец нет. На тач-экране мир остаётся сквозным: иначе холст
    // перехватил бы тапы у солнечной системы под ним и у прокрутки ленты окон.
    const finePointer = window.matchMedia('(pointer: fine)').matches;

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pointerInside = true;
      pointerScreen.set(event.clientX, event.clientY);
      pointer.set((event.clientX / W()) * 2 - 1, -(event.clientY / H()) * 2 + 1);
    };
    const onPointerLeave = () => {
      pointerInside = false;
      hovered = null;
      renderer.domElement.style.pointerEvents = 'none';
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave);

    const onClick = () => {
      if (hovered) hovered.activate();
    };
    renderer.domElement.addEventListener('click', onClick);

    // ── живые данные ───────────────────────────────────────────────────────
    let pulse: GraphPulse | null = null;
    const unsubscribe = subscribeGraphPulse((next) => {
      pulse = next;
      const concepts = ((next.top_concepts ?? []) as Array<{ concept?: string; count?: number }>)
        .map((c) => ({ label: readableConcept(c?.concept), count: Number(c?.count) || 0 }))
        .filter((c): c is { label: string; count: number } => Boolean(c.label));
      const maxCount = concepts.reduce((max, c) => Math.max(max, c.count), 0) || 1;
      // Скелет мира, пока граф молчит: три башни по всей ширине, а не слева.
      const shown = concepts.length || 3;
      monoliths.forEach((slot, index) => {
        const concept = concepts[index];
        slot.group.visible = index < shown;
        if (!slot.group.visible) return;
        placeMonolith(slot.group, index, shown);
        if (!concept) {
          setLabel(slot.label, '—', 'structure');
          setMonolithHeight(slot, 4.2);
          return;
        }
        setLabel(slot.label, concept.label, 'structure');
        setMonolithHeight(slot, 3.4 + (concept.count / maxCount) * 8.2);
      });
      const target = Number(next.target_synapses) || SYNAPSE_TARGET;
      const earned = Number(next.earned_synapses ?? next.total_synapses ?? 0);
      const goal = target >= 1_000_000 ? `${Math.round(target / 1_000_000)}M` : formatNumber(target);
      setLabel(synapseLabel, `СИНАПСЫ ${formatNumber(earned)} / ${goal}`, 'structure');
    });

    // ── мысль и речь ядра ──────────────────────────────────────────────────
    let thinking = 0;
    let speaking = 0;
    let thinkingTarget = 0;
    let speakingTarget = 0;
    const onThinking = (event: Event) => {
      const active = Boolean((event as CustomEvent).detail?.active);
      thinkingTarget = active ? 1 : 0;
      if (active) emitPulse();
    };
    const onSpeaking = (event: Event) => {
      const active = Boolean((event as CustomEvent).detail?.active);
      speakingTarget = active ? 1 : 0;
      if (active) emitPulse();
    };
    window.addEventListener('max:thinking', onThinking as EventListener);
    window.addEventListener('max:speaking', onSpeaking as EventListener);

    // Полноэкранное 3D-ядро забирает GPU себе — земля на это время замирает.
    let suspended = false;
    const onSuspend = () => {
      suspended = true;
    };
    const onResume = () => {
      suspended = false;
    };
    window.addEventListener('max3d:open', onSuspend);
    window.addEventListener('max3d:close', onResume);

    // ── кадр ───────────────────────────────────────────────────────────────
    const clock = new THREE.Clock();
    const minFrame = tier === 'low' ? 1 / 30 : 0;
    let frameDebt = 0;
    let raf = 0;
    let audio = 0;
    const camDrift = new THREE.Vector2(0, 0);
    let arcShown = 0;
    let paletteCheckedAt = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, clock.getDelta());
      if (document.hidden || suspended) return;
      if (minFrame > 0) {
        frameDebt += dt;
        if (frameDebt < minFrame) return;
        frameDebt = 0;
      }
      const t = clock.getElapsedTime();
      const live = liveRef.current;

      // Дыхание сцены: слух ядра, если микрофон уже слушает (сами его не будим).
      const frame = ambientActive() ? ambientFrame() : null;
      audio += ((frame ? frame.level : 0) - audio) * 0.12;
      const statusThinking = live.coreStatus === 'processing' ? 1 : 0;
      const statusSpeaking = live.coreStatus === 'speaking' ? 1 : 0;
      thinking += (Math.max(thinkingTarget, statusThinking) - thinking) * 0.08;
      speaking += (Math.max(speakingTarget, statusSpeaking) - speaking) * 0.14;
      const life = calm ? 0.15 : 1;
      const heat = thinking * 0.6 + speaking * 0.8 + audio * 0.6;

      // Башня: гироскопы разгоняются на мысли, ядро вспыхивает на речи.
      gyros[0].rotation.y += dt * (VISION.spin.ring + thinking * 0.9) * life;
      gyros[1].rotation.z += dt * (VISION.spin.ring * 0.8 + thinking * 0.7) * life;
      gyros[2].rotation.x -= dt * (VISION.spin.ring * 0.6 + thinking * 0.5) * life;
      nucleus.rotation.y += dt * (VISION.spin.slow + thinking * 0.35) * life;
      nucleus.position.y = 3.6 + Math.sin(t * 0.5) * 0.16 * life;
      heart.scale.setScalar(1 + speaking * 0.5 + audio * 0.7);
      beamMat.uniforms.uTime.value = t;
      beamMat.uniforms.uPower.value = 1.5 + heat * 0.9;
      (nucleusShell.material as THREE.ShaderMaterial).uniforms.uIntensity.value = 0.5 + heat * 0.5;
      rimMaterial.opacity = 0.3 + speaking * 0.25;

      // Волны по земле от каждого события.
      pulses.forEach((slot) => {
        if (slot.life <= 0) return;
        slot.life = Math.max(0, slot.life - dt * 0.45);
        const grow = (1 - slot.life) * 34 + 1;
        slot.ring.scale.setScalar(grow);
        const material = slot.ring.material as THREE.LineBasicMaterial;
        material.opacity = slot.life * 0.5;
        if (slot.life <= 0) slot.ring.visible = false;
      });

      // Дорога к 1M: дуга дорастает до реальной доли заработанных синапсов.
      const earnedProgress = Math.max(
        0,
        Math.min(
          1,
          Number(
            pulse?.earned_progress ??
              (pulse?.earned_synapses != null
                ? Number(pulse.earned_synapses) / (Number(pulse.target_synapses) || SYNAPSE_TARGET)
                : pulse?.progress ?? 0),
          ) || 0,
        ),
      );
      arcShown += (earnedProgress - arcShown) * 0.05;
      arcGeometry.setDrawRange(0, Math.max(2, Math.round(arcShown * ARC_SEGMENTS) + 1));

      // Пилоны миссий: высота от XP, свет от статуса.
      const missions = live.missions ?? [];
      pylons.forEach((pylon, index) => {
        const task = missions[index];
        // Пустой список — не пустой мир: у новичка стоят те же три демо-миссии,
        // что показывает окно МИССИИ, только приглушённо.
        const demo = !task && missions.length === 0 && index < 3;
        if (!task && !demo) {
          pylon.group.visible = false;
          return;
        }
        pylon.group.visible = true;
        const height = task ? 1 + Math.min(2.6, (task.xp || 40) / 60) : 1.5 + index * 0.25;
        const done = task?.status === 'completed';
        const failed = task?.status === 'failed';
        const active = task?.status === 'active';
        pylon.frame.scale.y = height;
        pylon.frame.position.y = height / 2;
        const fillHeight = done ? height : failed ? height * 0.15 : height * (active ? 0.7 : 0.35);
        pylon.fill.scale.y = fillHeight;
        pylon.fill.position.y = fillHeight / 2;
        pylon.fill.material = done ? pylonFillDone : pylonFillOpen;
        if (active) {
          pylon.fill.scale.y = fillHeight * (1 + Math.sin(t * 2.2 + index) * 0.06 * life);
        }
      });

      // Монета: крутится всегда, насечки журнала загораются по балансу.
      coinDisc.rotation.y += dt * VISION.spin.coin * life;
      coinDisc.position.y = 2.1 + Math.sin(t * 0.7) * 0.1 * life;
      const litTicks = Math.max(0, Math.min(TICKS, Math.round((live.balance / 500) * 4)));
      ticks.forEach((tickMesh, index) => {
        tickMesh.material = index < litTicks ? tickMaterial : tickDim;
      });

      // Линза: открыта, когда MAX действительно смотрит.
      const watching = live.isCameraActive ? 1 : 0;
      lensRings.forEach((ring, index) => {
        ring.rotation.z += dt * (0.1 + index * 0.06 + watching * 0.5) * life;
      });
      (iris.material as THREE.MeshBasicMaterial).opacity = 0.12 + watching * 0.5 + audio * 0.2;
      iris.scale.setScalar(0.55 + watching * 0.5 + audio * 0.3);
      lens.position.y = 4.9 + Math.sin(t * 0.4) * 0.2 * life;

      // Пыль: медленно поднимается, на мысли — стягивается к ядру.
      const positions = moteGeometry.getAttribute('position') as THREE.BufferAttribute;
      const array = positions.array as Float32Array;
      const inward = thinking * dt * 2.4;
      for (let i = 0; i < moteCount; i++) {
        const iy = i * 3 + 1;
        array[iy] += dt * moteSeed[i * 3 + 2] * (0.35 + thinking * 1.6) * life;
        if (array[iy] > 9.5) {
          array[iy] = 0;
          const radius = moteSeed[i * 3];
          const angle = moteSeed[i * 3 + 1];
          array[i * 3] = Math.cos(angle) * radius;
          array[i * 3 + 2] = Math.sin(angle) * radius;
        }
        if (inward > 0) {
          array[i * 3] -= array[i * 3] * inward * 0.04;
          array[i * 3 + 2] -= array[i * 3 + 2] * inward * 0.04;
        }
      }
      positions.needsUpdate = true;
      moteMat.uniforms.uOpacity.value = 0.35 + thinking * 0.35 + audio * 0.3;

      // Наведение: курсор ловится только над объектом, иначе клики уходят вниз.
      if (pointerInside && finePointer) {
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(proxies, false);
        const next = hits.length ? hotspots.find((h) => h.proxy === hits[0].object) ?? null : null;
        if (next !== hovered) {
          hovered = next;
          renderer.domElement.style.pointerEvents = next ? 'auto' : 'none';
          renderer.domElement.style.cursor = next ? 'pointer' : 'default';
        }
      }
      hotspots.forEach((spot) => {
        const target = spot === hovered ? 1 : 0;
        const current = hoverAmount.get(spot.proxy) ?? 0;
        const value = current + (target - current) * 0.16;
        hoverAmount.set(spot.proxy, value);
        if (value > 0.001 || current > 0.001) spot.glow(value);
      });

      // Камера: еле заметный дрейф — мир живой, но композиция не плывёт.
      const targetX = pointerInside ? (pointerScreen.x / W() - 0.5) * 0.9 : 0;
      const targetY = pointerInside ? (0.5 - pointerScreen.y / H()) * 0.4 : 0;
      camDrift.x += (targetX - camDrift.x) * 0.02;
      camDrift.y += (targetY - camDrift.y) * 0.02;
      camera.position.set(camDrift.x, camHeight + camDrift.y, camDist);
      camera.lookAt(aim);

      // Тема могла смениться — палитра живая, сверяем раз в секунду.
      if (t - paletteCheckedAt > 1) {
        paletteCheckedAt = t;
        const next = readPalette();
        const nextId = paletteKey(next);
        if (nextId !== paletteId) {
          palette = next;
          paletteId = nextId;
          themed.forEach((entry) => entry.set(palette[entry.role]));
        }
      }

      renderer.render(scene, camera);
    };
    tick();

    const onResize = () => {
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
      renderer.setSize(W(), H());
    };
    window.addEventListener('resize', onResize);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(raf);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('max:thinking', onThinking as EventListener);
      window.removeEventListener('max:speaking', onSpeaking as EventListener);
      window.removeEventListener('max3d:open', onSuspend);
      window.removeEventListener('max3d:close', onResume);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      labels.forEach((label) => label.dispose());
      trash.forEach((item) => item.dispose());
      renderer.domElement.remove();
      renderer.dispose();
    };
  }, [on]);

  if (!on) return null;
  return <div ref={hostRef} className={`hud-ground ${className}`} aria-hidden />;
}

export default HudGround;
