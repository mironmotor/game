'use client';

import { useEffect, useRef, useState } from 'react';
import './efir.css';
import AgentPanel, { AgentLine } from '@/components/agent/AgentPanel';
import QuantumEyes, { IDLE_SIGNAL, type QuantumSignal } from '@/components/hud/QuantumEyes';
import { useEfirSignal } from '@/hooks/use-efir-signal';
import { HUE_LUT, hueIndex } from '@/lib/hue-lut';
import {
  sendMax17Event,
  type Max17Agent,
  type Max17World,
  type Max17WorldLaws,
} from '@/lib/max17-client';

// Как часто отправлять ядру перепись мира. Раз в секунду достаточно: ядро
// смотрит на мир, а не управляет каждым кадром.
const CENSUS_INTERVAL = 1.0;
// Сколько живых частиц считать «полным» миром при расчёте плотности.
//
// Замерено на живом мире (25 переписей, реальный звук в микрофон). При старом
// эталоне 50k плотность упиралась в 1.0 больше четверти времени: ядро видело
// вечно переполненный мир, эфир стоял на максимальной густоте и переставал
// что-либо сообщать — а от него зависит и цена рождения материи, и половина
// влечений агента. На 72k плотность ходит 0.35..0.84 и обе крайности снова
// достижимы. Выше поднимать нельзя: эфир слабее тормозит рождения, равновесная
// численность растёт, и кадры уходят вместе с ней (на 100k — 65k частиц и
// 27 fps против 53k и 31 fps здесь, при той же цене одной частицы).
const DENSITY_REFERENCE = 72000;
// На сколько угловых секторов делим диск, чтобы измерить симметрию мира.
// На 12 секторах 3-4 рукава попадали по одному в сектор и гистограмма выходила
// ровной при любой структуре. 24 сектора разрешают и рукав, и промежуток.
const SECTORS = 24;
// Конечный радиус ядра: ближе частица подойти не может.
const CORE_RADIUS = 0.12;
// За сколько секунд мир догоняет новое решение агента. Агент решает раз в
// секунду; без сглаживания каждое его действие выглядело бы как рывок, а не
// как чья-то воля. Полсекунды — переход виден, но не дёргает.
const AGENT_EASE = 0.5;
// Пределы, за которые агент не может утащить мир. Он живёт внутри физики
// «Эфира», а не поверх неё: без рамок «цветение» подряд превратило бы мир
// в белую стену, и никакой перепись это уже не спасла бы.
const AGENT_EMISSION_RANGE: [number, number] = [0.35, 2.2];
const AGENT_LIFETIME_RANGE: [number, number] = [0.5, 2.2];
const AGENT_SPIRAL_RANGE: [number, number] = [-0.18, 0.18];
const AGENT_ARMS_RANGE: [number, number] = [-2, 2];

// Автоэкспозиция. Свет копится аддитивно, поэтому яркость картинки растёт
// вместе с числом частиц: на 6k виден рисунок, на 55k центр выжжен в плоское
// белое пятно и вся структура пропадает. Как в камере — чем больше света,
// тем короче выдержка; при этом населении картинка держит одну яркость.
const EXPOSURE_REFERENCE = 14000;
const EXPOSURE_MIN = 0.22;
// Шлейф копит свет: при гашении 14% за кадр на экране лежит около семи кадров
// сразу. Одной выдержки мало — гасить надо тем быстрее, чем плотнее мир,
// иначе центр всё равно выгорает в ровное пятно и рукава пропадают.
const TRAIL_FADE_MIN = 0.14;
const TRAIL_FADE_MAX = 0.44;

// Скорость узора и добавка дифференциального вращения.
//
// Чистая кеплеровская орбита (ω ∝ 1/r) наматывает рукав в диск за одно время
// жизни частицы: внутренние обгоняют внешние на 3+ радиана при расстоянии
// между рукавами 2π/3 ≈ 2.1. Именно поэтому мир выглядел ровным светящимся
// пятном, а перепись честно отдавала ядру симметрию 0.99 при любой музыке.
// Это не баг отрисовки, а известная winding problem: в настоящих галактиках
// рукава — не вещество, а волна плотности, и вращается она как целое.
// Здесь так же: узор несёт PATTERN_SPEED, а на него накинут небольшой
// дифференциальный член, чтобы диск не выглядел жёстким блином.
const PATTERN_SPEED = 0.62;
const DIFFERENTIAL_SPIN = 0.22;

// ── Эфир · 3D-реальность из голоса ───────────────────────────────────────────
// Голос не крутит готовое облако — он РОЖДАЕТ материю. Каждый озвученный кадр
// эфир выбрасывает частицы в 3D-космос. Дальше они живут по законам на e = 2.718:
//   • рождение по логарифмической спирали   r = r₀·e^(bθ)   (рукава галактики)
//   • жизнь и распад                        яркость ∝ e^(−t/τ)
//   • экранированная гравитация ядра        F ∝ e^(−κ·d)
//   • атмосферная дымка глубины             α ∝ e^(−z/d)
//   • орбитальная фаза Эйлера               e^(iθ)
// Тишина — эфир перестаёт питаться, материя испаряется. Чистый Canvas 2D,
// свой проектор 3D→2D (yaw/pitch + перспектива), ноль внешних зависимостей.

const E = 2.718281828459045;
// Потолка у пула нет: массивы растут по мере надобности. Численность частиц
// держит только сама физика — равновесие «темп рождения × время жизни»
// (каждая гаснет по e^(−t/τ)), а не искусственный лимит.
const INITIAL_CAP = 8192;
const TWO_PI = Math.PI * 2;

// Единственная ручка плотности — темпа рождения. Потолка на число частиц нет:
// пул растёт сам, численность держит равновесие «рождение × время жизни».
// 1 — плотный живой космос; 6 — шланг на сотни тысяч частиц.
const DENSITY = 1;

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const expE = (x: number) => Math.pow(E, x); // e^x, буквально через e = 2.718

/**
 * Закрутка логарифмической спирали r = r₀·e^(bθ). Напряжение стягивает пружину:
 * спокойствие — раскрытые рукава (b велик), стресс — тугая навивка (b мал).
 *
 * Диапазон подобран из геометрии, а не на глаз. Частицы рождаются на радиусах
 * 0.28..4.7, значит рукав занимает по углу θ = ln(4.7/0.28)/b = 2.82/b радиан.
 * На прежних b = 0.16..0.5 это 5.6..17.6 радиан — рукав наматывается на диск
 * от одного до трёх оборотов, перекрывает сам себя и все остальные рукава, и
 * мир превращается в ровное светящееся пятно без какой-либо структуры. Здесь
 * рукав укладывается в 0.43 оборота на спокойном голосе и в один — на
 * стрессе: витки уже не пересекаются, и рукава наконец видно.
 */
const spiralB = (tension: number) => lerp(1.05, 0.45, clamp(tension));

interface HudReadout {
  f0: number;
  arousal: number;
  valence: number;
  tension: number;
  alive: number;
  arms: number;
  b: number;
  tau: number;
  kappa: number;
}

/**
 * `world` — мир на первом плане, агент одной строкой.
 * `agent`  — тот же мир, но раскрыт разум агента: влечения, F = E − T·S, дневник.
 */
export type EfirVariant = 'world' | 'agent';

export default function EfirReality({ variant = 'world' }: { variant?: EfirVariant }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const signalRef = useRef<QuantumSignal>({ ...IDLE_SIGNAL });
  const { listening, status, start, stop } = useEfirSignal(signalRef);
  const [showEyes, setShowEyes] = useState(variant === 'world');
  // Законы, присланные ядром. Мир живёт по ним до следующей переписи.
  const lawsRef = useRef<Max17WorldLaws | null>(null);
  const censusBusyRef = useRef(false);
  const sectorsRef = useRef<Float32Array>(new Float32Array(SECTORS));
  const [world, setWorld] = useState<Max17World | null>(null);
  const [agent, setAgent] = useState<Max17Agent | null>(null);
  // Куда агент тянет мир (цель) и где мир сейчас (сглаженное). Оттенок
  // накапливается: каждый «перекрас» уводит палитру дальше по кругу.
  const agentAim = useRef({ emission: 1, lifetime: 1, arms: 0, spiral: 0, hue: 0 });
  const agentNow = useRef({ emission: 1, lifetime: 1, arms: 0, spiral: 0, hue: 0 });
  const [hud, setHud] = useState<HudReadout>({
    f0: 0, arousal: 0, valence: 0.5, tension: 0, alive: 0, arms: 3, b: 0.4, tau: 3, kappa: 2,
  });

  // Частицы — SoA. rad/ang/hgt — цилиндрические координаты диска-галактики.
  // count — сколько живых; массивы растут вдвое, когда живых становится больше.
  const sim = useRef({
    rad: new Float32Array(INITIAL_CAP),
    ang: new Float32Array(INITIAL_CAP),
    hgt: new Float32Array(INITIAL_CAP),
    born: new Float32Array(INITIAL_CAP),
    life: new Float32Array(INITIAL_CAP),
    hue: new Float32Array(INITIAL_CAP),
    spin: new Float32Array(INITIAL_CAP), // индивидуальная орбитальная скорость
    count: 0,
    cap: INITIAL_CAP,
    peak: 0,
    // счётчики для переписи: сколько родилось и погасло с прошлого отчёта
    bornAcc: 0,
    diedAcc: 0,
    censusAcc: 0,
    t: 0,
    phase: 0, // фаза Эйлера θ
    yaw: 0.6,
    pitch: 0.42,
    drag: false,
    moved: false,
    lastX: 0,
    lastY: 0,
    w: 0,
    h: 0,
    dpr: 1,
  });

  const resize = () => {
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    if (!wrap || !cv) return;
    const s = sim.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    s.w = wrap.clientWidth;
    s.h = wrap.clientHeight;
    s.dpr = dpr;
    cv.width = Math.round(s.w * dpr);
    cv.height = Math.round(s.h * dpr);
    cv.style.width = `${s.w}px`;
    cv.style.height = `${s.h}px`;
    s.moved = true;
  };

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    const cv = canvasRef.current;
    const ctx = cv?.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let last = 0;
    let hudAcc = 0;

    // Слой частиц: рисуем их в собственный пиксельный буфер (аддитивно) и
    // переносим на холст одним вызовом — тогда счёт может расти без потолка.
    const layer = document.createElement('canvas');
    const lctx = layer.getContext('2d');
    let img: ImageData | null = null;

    // Расширить пул вдвое — вызывается, когда живых стало больше ёмкости.
    const grow = () => {
      const s = sim.current;
      const cap = s.cap * 2;
      const g = (a: Float32Array) => {
        const n = new Float32Array(cap);
        n.set(a);
        return n;
      };
      s.rad = g(s.rad);
      s.ang = g(s.ang);
      s.hgt = g(s.hgt);
      s.born = g(s.born);
      s.life = g(s.life);
      s.hue = g(s.hue);
      s.spin = g(s.spin);
      s.cap = cap;
    };

    // Вычеркнуть погасшую частицу: на её место переносим последнюю живую.
    const removeAt = (i: number) => {
      const s = sim.current;
      s.diedAcc++;
      const last = s.count - 1;
      if (i !== last) {
        s.rad[i] = s.rad[last];
        s.ang[i] = s.ang[last];
        s.hgt[i] = s.hgt[last];
        s.born[i] = s.born[last];
        s.life[i] = s.life[last];
        s.hue[i] = s.hue[last];
        s.spin[i] = s.spin[last];
      }
      s.count = last;
    };

    // Зажечь новую частицу из текущего эфира: посадить её на лог-спираль.
    const ignite = (now: number, sig: QuantumSignal) => {
      const s = sim.current;
      if (s.count >= s.cap) grow();
      s.bornAcc++;
      const i = s.count++;
      const ag = agentNow.current;
      // напряжение закручивает рукава: спокойствие — раскрытая спираль (b велик),
      // стресс — тугая пружина (b мал). Агент добавляет к этому свой сдвиг:
      // «свивание» стягивает мир к оси, «рассеяние» пускает вширь.
      const b = clamp(spiralB(sig.tension) + ag.spiral, 0.35, 1.3);
      const arms = Math.round(
        clamp(lerp(4, 2, clamp(sig.tension)) + ag.arms, 2, 6),
      );
      const arm = Math.floor(Math.random() * arms);
      // радиус рождения: выше тон (регистр) — дальше от ядра
      const tt = Math.pow(Math.random(), 0.7);
      const r0 = 0.28;
      const rad = r0 + tt * (2.4 + sig.register * 3.4);
      // угол на спирали r = r0·e^(bθ)  ⟺  θ = ln(r/r0)/b
      const theta = Math.log(rad / r0) / b;
      // Толщина рукава. Раньше 0.5 рад при расстоянии между рукавами 2.1 —
      // четверть промежутка, рукава сливались ещё на рождении.
      const scatter = (Math.random() - 0.5) * 0.22;
      s.rad[i] = rad;
      s.ang[i] = arm * (TWO_PI / arms) + theta + scatter;
      // высота диска: тоньше к краю, чуть приподнята регистром
      s.hgt[i] = (Math.random() - 0.5) * (0.9 - tt * 0.6) + (sig.register - 0.5) * 0.7;
      s.born[i] = now;
      // Позитив — долгая светящаяся жизнь; негатив — быстрые искры. Густой
      // эфир ядра (impedance) удерживает рождённое дольше — это его закон.
      // «Удержание» агента добавляется поверх закона ядра: он не отменяет
      // физику эфира, а докручивает её в ту сторону, которую сам выбрал.
      const lifeScale = (lawsRef.current?.lifetime_scale ?? 1) * ag.lifetime;
      s.life[i] = lerp(1.1, 6.5, clamp(sig.valence)) * (0.7 + Math.random() * 0.6) * lifeScale;
      // магента-палитра: позитив → фиолет, негатив → горячий розовый.
      // ag.hue — накопленный «перекрас» агента, он уводит палитру по кругу.
      s.hue[i] = 316 + ag.hue + (sig.valence - 0.5) * -40 + (Math.random() - 0.5) * 14;
      // Волна плотности плюс лёгкий дифференциал. Разброс ±4% — чтобы
      // структура не выглядела нарисованной; случайности больше здесь быть не
      // должно, иначе соседи по рукаву разъедутся и рукав снова размажется.
      s.spin[i] =
        (0.96 + Math.random() * 0.08) *
        (PATTERN_SPEED + DIFFERENTIAL_SPIN / (0.4 + rad * 0.5));
    };

    const loop = (ts: number) => {
      const s = sim.current;
      const dt = last ? clamp((ts - last) / 1000, 0, 0.05) : 0.016;
      last = ts;
      s.t += dt;
      const now = s.t;
      const sig = signalRef.current;

      // Мир догоняет решение агента, а не прыгает в него. Коэффициент не
      // зависит от частоты кадров: на 30 и на 144 fps переход одинаков.
      {
        const k = 1 - Math.pow(0.02, dt / AGENT_EASE);
        const aim = agentAim.current;
        const cur = agentNow.current;
        cur.emission += (aim.emission - cur.emission) * k;
        cur.lifetime += (aim.lifetime - cur.lifetime) * k;
        cur.arms += (aim.arms - cur.arms) * k;
        cur.spiral += (aim.spiral - cur.spiral) * k;
        cur.hue += (aim.hue - cur.hue) * k;
      }

      // фаза Эйлера θ из тона голоса (частота кванта)
      const omega = TWO_PI * (sig.voiced ? clamp(sig.f0 / 260, 0.15, 4) : 0.25);
      s.phase += omega * dt;

      // ЭМИССИЯ ИЗ ЭФИРА: озвученный кадр рождает частицы (число ∝ энергии).
      // Верхней планки нет — сколько голоса, столько материи.
      // Импеданс эфира — цена излучения в среду, поэтому он прямо задаёт,
      // сколько материи мир может позволить себе родить.
      if (sig.voiced) {
        // Цена излучения от ядра × воля агента: «цветение» раскрывает эфир,
        // «затишье» прикручивает. Оба множителя перемножаются честно.
        const emitScale = (lawsRef.current?.emission_scale ?? 1) * agentNow.current.emission;
        const emit = Math.round(
          (4 + sig.energy * 60 + sig.brightness * 26) * DENSITY * emitScale * (dt * 60),
        );
        for (let k = 0; k < emit; k++) ignite(now, sig);
      }

      // гравитация ядра e^(−κ·d): возбуждение → сильный короткий стяг (тугое ядро)
      const kappa = lerp(3.6, 1.2, clamp(sig.arousal));
      const gStrength = lerp(0.15, 0.9, clamp(sig.arousal));

      const { w, h, dpr } = s;
      const cx = w / 2;
      const cy = h / 2;
      // Мир занимал около трети холста, а остальное было чёрным полем. При
      // десятках тысяч частиц это решает не композицию, а видимость: на пятне
      // радиусом 200px 66k частиц накрывают каждый пиксель, и никакая
      // структура физически не может проступить. Втрое больший радиус — это
      // вдевятеро больше площади на ту же численность.
      const scale = Math.min(w, h) * 0.2;
      const focal = 520;
      const camDist = 7;

      const cyaw = Math.cos(s.yaw), syaw = Math.sin(s.yaw);
      const cpit = Math.cos(s.pitch), spit = Math.sin(s.pitch);

      // Выдержка на этот кадр: считается по прошлому счёту, так что расходов
      // на неё нет вообще, а разница между кадрами незаметна.
      const exposure = clamp(EXPOSURE_REFERENCE / Math.max(1, s.count), EXPOSURE_MIN, 1);
      const trailFade = clamp(TRAIL_FADE_MIN / exposure, TRAIL_FADE_MIN, TRAIL_FADE_MAX);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // шлейф: при орбите мышью гасим сильнее, чтобы не смазывалось
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = s.moved ? 'rgba(6,2,16,0.5)' : `rgba(6,2,16,${trailFade})`;
      ctx.fillRect(0, 0, w, h);
      s.moved = false;

      // свечение ядра Макса
      const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 2.4);
      const coreA = 0.16 + (sig.voiced ? sig.energy * 0.4 : 0.04);
      // Свечение ядра идёт за палитрой агента, иначе после «перекраса» центр
      // остался бы старого цвета и мир развалился бы надвое.
      const coreHue = (((315 + agentNow.current.hue) % 360) + 360) % 360;
      coreGlow.addColorStop(0, `hsla(${coreHue},100%,72%,${coreA})`);
      coreGlow.addColorStop(0.4, `hsla(${coreHue},100%,60%,${coreA * 0.4})`);
      coreGlow.addColorStop(1, `hsla(${coreHue},100%,60%,0)`);
      ctx.fillStyle = coreGlow;
      ctx.fillRect(cx - scale * 2.4, cy - scale * 2.4, scale * 4.8, scale * 4.8);

      ctx.globalCompositeOperation = 'lighter';

      if (lctx && (layer.width !== w || layer.height !== h) && w > 0 && h > 0) {
        layer.width = w;
        layer.height = h;
        img = lctx.createImageData(w, h);
      }
      const data = img ? img.data : null;
      if (data) data.fill(0);

      // Копим перепись прямо в цикле — отдельный проход по частицам не нужен.
      let radSum = 0;
      let hueSum = 0;
      const sectors = sectorsRef.current;
      sectors.fill(0);

      let i = 0;
      while (i < s.count) {
        const age = now - s.born[i];
        const decay = expE(-age / s.life[i]); // e^(−t/τ)
        if (decay < 0.04) {
          removeAt(i); // на место погасшей встала последняя — i не двигаем
          continue;
        }

        // орбита + лёгкий внешний дрейф − стяг ядра
        let rad = s.rad[i];
        const pull = expE(-kappa * rad) * gStrength; // экранированная гравитация
        rad += (0.22 - pull) * dt; // квазиравновесие рукавов
        // У ядра конечный размер. Без этого частица проваливается в
        // отрицательный радиус, там e^(−κ·r) обращается в рост, стяг взрывается
        // и уносит её в бесконечность — облако молча теряет вещество.
        if (rad < CORE_RADIUS) rad = CORE_RADIUS;
        s.rad[i] = rad;
        s.ang[i] += s.spin[i] * dt;
        s.hgt[i] *= 1 - 0.12 * dt; // диск потихоньку уплощается

        const ang = s.ang[i];
        radSum += rad;
        hueSum += s.hue[i];
        sectors[(((ang % TWO_PI) + TWO_PI) % TWO_PI) * (SECTORS / TWO_PI) | 0]++;

        const wx = rad * Math.cos(ang);
        const wz = rad * Math.sin(ang);
        const wy = s.hgt[i];

        // вращение камеры: yaw вокруг Y, затем pitch вокруг X
        const x1 = wx * cyaw - wz * syaw;
        const z1 = wx * syaw + wz * cyaw;
        const y1 = wy * cpit - z1 * spit;
        const z2 = wy * spit + z1 * cpit;

        const persp = focal / (focal + (z2 + camDist) * scale * 0.06);
        const px = cx + x1 * scale * persp;
        const py = cy + y1 * scale * persp;
        const onScreen = persp > 0 && px >= -4 && px < w + 4 && py >= -4 && py < h + 4;

        if (onScreen && data) {
          // атмосферная дымка e^(−z/d): дальнее тускнеет
          const fog = clamp(expE(-(z2 + camDist) / 12));
          // ближе к ядру — ярче, добела
          const coreHot = clamp(1 - rad / 3);
          const alpha = decay * fog * (0.28 + coreHot * 0.4) * exposure;
          if (alpha >= 0.01) {
            const white = clamp(coreHot * 0.75); // к ядру выбеливает
            const hi = hueIndex(s.hue[i]);
            const r = (HUE_LUT[hi] + (255 - HUE_LUT[hi]) * white) * alpha;
            const g = (HUE_LUT[hi + 1] + (255 - HUE_LUT[hi + 1]) * white) * alpha;
            const bl = (HUE_LUT[hi + 2] + (255 - HUE_LUT[hi + 2]) * white) * alpha;
            const xi = px | 0;
            const yi = py | 0;
            if (xi >= 0 && xi < w && yi >= 0 && yi < h) {
              const o = (yi * w + xi) * 4;
              data[o] += r;
              data[o + 1] += g;
              data[o + 2] += bl;
              data[o + 3] = 255;
              // ближние крупные частицы получают мягкое ядро
              if (persp > 1 && coreHot > 0.3) {
                const hr = r * 0.5;
                const hg = g * 0.5;
                const hb = bl * 0.5;
                if (xi + 1 < w) { const p = o + 4; data[p] += hr; data[p + 1] += hg; data[p + 2] += hb; data[p + 3] = 255; }
                if (yi + 1 < h) { const p = o + w * 4; data[p] += hr; data[p + 1] += hg; data[p + 2] += hb; data[p + 3] = 255; }
              }
            }
          }
        }
        i++;
      }

      if (lctx && img) {
        lctx.putImageData(img, 0, 0);
        ctx.drawImage(layer, 0, 0, w, h);
      }
      ctx.globalCompositeOperation = 'source-over';
      if (s.count > s.peak) s.peak = s.count;

      // авто-вращение, когда не тащим мышью
      if (!s.drag) s.yaw += 0.06 * dt;

      // ПЕРЕПИСЬ: раз в секунду ядро узнаёт, каким стал мир, и отвечает
      // законами следующего интервала. Без этого Макс мир не видит вообще.
      s.censusAcc += dt;
      if (s.censusAcc >= CENSUS_INTERVAL && !censusBusyRef.current) {
        const dtCensus = s.censusAcc;
        s.censusAcc = 0;
        const alive = s.count;
        // Симметрия: насколько ровно частицы разложены по секторам диска.
        let symmetry = 0;
        if (alive > 0) {
          const mean = alive / SECTORS;
          let dev = 0;
          for (let k = 0; k < SECTORS; k++) dev += Math.abs(sectors[k] - mean);
          symmetry = clamp(1 - dev / (2 * alive));
        }
        // Ядро не должно получать нечисла ни при каком стечении обстоятельств:
        // одна испорченная частица не имеет права испортить перепись мира.
        const fin = (v: number) => (Number.isFinite(v) ? v : 0);
        const census = {
          alive,
          born: s.bornAcc,
          died: s.diedAcc,
          radius: fin(alive > 0 ? radSum / alive : 0),
          density: clamp(alive / DENSITY_REFERENCE),
          spiral_b: fin(spiralB(sig.tension)),
          arms: Math.round(lerp(4, 2, clamp(sig.tension))),
          hue: fin(alive > 0 ? ((hueSum / alive) % 360 + 360) % 360 : 316),
          symmetry: fin(symmetry),
          energy: fin(sig.energy),
          dt: fin(dtCensus) || 1,
        };
        s.bornAcc = 0;
        s.diedAcc = 0;
        censusBusyRef.current = true;
        void sendMax17Event({
          type: 'world_state',
          user_id: 'miron',
          title: 'эфир',
          census,
          voice: { tension: sig.tension, arousal: sig.arousal, valence: sig.valence },
          source: 'efir',
          timestamp: new Date().toISOString(),
        })
          .then((res) => {
            if (res.world) {
              setWorld(res.world);
              if (res.world.laws) lawsRef.current = res.world.laws;
              // Агент едет прицепом к переписи — отдельного запроса нет.
              const a = res.world.agent;
              if (a?.action?.knobs) {
                const k = a.action.knobs;
                const aim = agentAim.current;
                aim.emission = clamp(k.emission ?? 1, ...AGENT_EMISSION_RANGE);
                aim.lifetime = clamp(k.lifetime ?? 1, ...AGENT_LIFETIME_RANGE);
                aim.arms = clamp(k.arms ?? 0, ...AGENT_ARMS_RANGE);
                aim.spiral = clamp(k.spiral ?? 0, ...AGENT_SPIRAL_RANGE);
                // Оттенок — единственная накопительная ручка: «перекрас»
                // сдвигает палитру дальше, а не ставит её в фиксированную точку.
                aim.hue += k.hue ?? 0;
              }
              if (a) setAgent(a);
            }
          })
          .catch(() => {
            // мост недоступен — мир просто живёт по своим законам
          })
          .finally(() => {
            censusBusyRef.current = false;
          });
      }

      // телеметрия HUD (throttled)
      hudAcc += dt;
      if (hudAcc >= 0.25) {
        hudAcc = 0;
        setHud({
          f0: Math.round(sig.f0),
          arousal: sig.arousal,
          valence: sig.valence,
          tension: sig.tension,
          alive: s.count,
          arms: Math.round(lerp(4, 2, clamp(sig.tension))),
          b: spiralB(sig.tension),
          tau: lerp(1.1, 6.5, clamp(sig.valence)),
          kappa,
        });
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  // орбита указателем
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = sim.current;
    s.drag = true;
    s.moved = true;
    s.lastX = e.clientX;
    s.lastY = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = sim.current;
    if (!s.drag) return;
    s.yaw += (e.clientX - s.lastX) * 0.01;
    s.pitch = clamp(s.pitch + (e.clientY - s.lastY) * 0.01, -1.3, 1.3);
    s.lastX = e.clientX;
    s.lastY = e.clientY;
    s.moved = true;
  };
  const onUp = () => {
    sim.current.drag = false;
  };

  return (
    <div ref={wrapRef} className="ef-screen">
      <div className="ef-bar">
        <span className="ef-logo">{variant === 'agent' ? '◇' : '△∞'}</span>
        <div>
          <div className="ef-title">
            {variant === 'agent' ? 'АГЕНТ · ОН РЕШАЕТ САМ' : 'ЭФИР · РЕАЛЬНОСТЬ ИЗ ГОЛОСА'}
          </div>
          <div className="ef-formula">
            {variant === 'agent'
              ? 'F = E − T·S · влечения → действие → сверка с миром'
              : 'r = r₀·e^(bθ) · яркость ∝ e^(−t/τ) · e = 2.718'}
          </div>
        </div>
        <div className="ef-bar-actions">
          <button
            type="button"
            className={`ef-mic ${listening ? 'on' : ''}`}
            onClick={listening ? stop : start}
          >
            {listening ? '⏹ Закрыть эфир' : '🎙 Впустить голос'}
          </button>
          <button
            type="button"
            className={`ef-eyes ${showEyes ? 'on' : ''}`}
            onClick={() => setShowEyes((v) => !v)}
            title="Квантовые глаза Макса"
          >
            ◉
          </button>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="ef-canvas"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      />

      {/* Квантовые глаза смотрят за своим же космосом */}
      {showEyes && (
        <div className="ef-eyewin">
          <QuantumEyes signalRef={signalRef} active={listening} className="h-[120px]" />
        </div>
      )}

      {/* Разум агента: в режиме «Агент» он и есть главное на экране */}
      {variant === 'agent' && (
        <div className="ef-agentwin">
          <AgentPanel agent={agent} />
        </div>
      )}

      {/* Панель законов на e — что сейчас лепит голос */}
      <div className={`ef-panel ${variant === 'agent' ? 'ef-panel-left' : ''}`}>
        <div className="ef-panel-title">ЗАКОНЫ РЕАЛЬНОСТИ · e = 2.718</div>
        <Row k="Тон f0" v={hud.f0 ? `${hud.f0} Гц` : '—'} />
        <Row k="Рукава спирали" v={`${hud.arms} · b=${hud.b.toFixed(2)}`} />
        <Row k="Жизнь τ" v={`${hud.tau.toFixed(1)} с`} />
        <Row k="Гравитация κ" v={hud.kappa.toFixed(2)} />
        <Row k="Частиц в эфире" v={`${hud.alive}`} accent />

        {/* Что ядро знает о мире — раньше не знало ничего */}
        {world && (
          <div className="ef-world">
            <div className="ef-world-title">МИР В ЯДРЕ</div>
            <Row k="Адрес" v={world.world?.id ?? '—'} />
            <Row k="Эпоха" v={world.laws?.epoch_title ?? '—'} />
            <Row
              k="Вещество"
              v={`${world.body_count ?? 0}${world.laws?.can_condense ? '' : ' · горячо'}`}
              accent
            />
            {world.hint && <div className="ef-world-hint">{world.hint}</div>}
          </div>
        )}

        {/* В режиме мира агент — одна строка: он есть, но не заслоняет космос */}
        {variant === 'world' && <AgentLine agent={agent} />}

        <div className="ef-bars">
          <Meter label="Возбуждение" v={hud.arousal} c="#ff2fd0" />
          <Meter label="Позитив" v={hud.valence} c="#c07bff" />
          <Meter label="Напряжение" v={hud.tension} c="#ff6a8a" />
        </div>
        <div className="ef-status">{status}</div>
      </div>

      <div className="ef-foot">
        {variant === 'agent' ? (
          <>
            Перепись мира → влечения → F = E − T·S → действие → сверка с миром
            &nbsp;·&nbsp; агент решает раз в секунду и помнит себя между
            сессиями &nbsp;·&nbsp; {hud.alive.toLocaleString('ru-RU')} живых
          </>
        ) : (
          <>
            Audio · FFT → Частицы → Спираль e^(bθ) → Эфир &nbsp;·&nbsp; тащи мышью — облети космос
            &nbsp;·&nbsp; без потолка: {hud.alive.toLocaleString('ru-RU')} живых
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="ef-row">
      <span>{k}</span>
      <b className={accent ? 'ef-accent' : ''}>{v}</b>
    </div>
  );
}

function Meter({ label, v, c }: { label: string; v: number; c: string }) {
  return (
    <div className="ef-meter">
      <div className="ef-meter-head">
        <span>{label}</span>
        <span>{Math.round(v * 100)}%</span>
      </div>
      <div className="ef-meter-track">
        <div className="ef-meter-fill" style={{ width: `${Math.round(v * 100)}%`, background: c, boxShadow: `0 0 8px ${c}` }} />
      </div>
    </div>
  );
}
