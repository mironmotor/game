'use client';

import { useEffect, useRef, useState } from 'react';
import './efir.css';
import QuantumEyes, { IDLE_SIGNAL, type QuantumSignal } from '@/components/hud/QuantumEyes';
import { useEfirSignal } from '@/hooks/use-efir-signal';
import { HUE_LUT, hueIndex } from '@/lib/hue-lut';

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

export default function EfirReality() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const signalRef = useRef<QuantumSignal>({ ...IDLE_SIGNAL });
  const { listening, status, start, stop } = useEfirSignal(signalRef);
  const [showEyes, setShowEyes] = useState(true);
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
      const i = s.count++;
      // напряжение закручивает рукава: спокойствие — раскрытая спираль (b велик),
      // стресс — тугая пружина (b мал).
      const b = lerp(0.5, 0.16, clamp(sig.tension));
      const arms = Math.round(lerp(4, 2, clamp(sig.tension)));
      const arm = Math.floor(Math.random() * arms);
      // радиус рождения: выше тон (регистр) — дальше от ядра
      const tt = Math.pow(Math.random(), 0.7);
      const r0 = 0.28;
      const rad = r0 + tt * (2.4 + sig.register * 3.4);
      // угол на спирали r = r0·e^(bθ)  ⟺  θ = ln(r/r0)/b
      const theta = Math.log(rad / r0) / b;
      const scatter = (Math.random() - 0.5) * 0.5;
      s.rad[i] = rad;
      s.ang[i] = arm * (TWO_PI / arms) + theta + scatter;
      // высота диска: тоньше к краю, чуть приподнята регистром
      s.hgt[i] = (Math.random() - 0.5) * (0.9 - tt * 0.6) + (sig.register - 0.5) * 0.7;
      s.born[i] = now;
      // позитив — долгая светящаяся жизнь; негатив — быстрые искры
      s.life[i] = lerp(1.1, 6.5, clamp(sig.valence)) * (0.7 + Math.random() * 0.6);
      // магента-палитра: позитив → фиолет, негатив → горячий розовый
      s.hue[i] = 316 + (sig.valence - 0.5) * -40 + (Math.random() - 0.5) * 14;
      // дифференциальное вращение: ближе к ядру — быстрее (шир рукавов)
      s.spin[i] = (0.5 + Math.random() * 0.5) / (0.4 + rad * 0.5);
    };

    const loop = (ts: number) => {
      const s = sim.current;
      const dt = last ? clamp((ts - last) / 1000, 0, 0.05) : 0.016;
      last = ts;
      s.t += dt;
      const now = s.t;
      const sig = signalRef.current;

      // фаза Эйлера θ из тона голоса (частота кванта)
      const omega = TWO_PI * (sig.voiced ? clamp(sig.f0 / 260, 0.15, 4) : 0.25);
      s.phase += omega * dt;

      // ЭМИССИЯ ИЗ ЭФИРА: озвученный кадр рождает частицы (число ∝ энергии).
      // Верхней планки нет — сколько голоса, столько материи.
      if (sig.voiced) {
        const emit = Math.round((4 + sig.energy * 60 + sig.brightness * 26) * DENSITY * (dt * 60));
        for (let k = 0; k < emit; k++) ignite(now, sig);
      }

      // гравитация ядра e^(−κ·d): возбуждение → сильный короткий стяг (тугое ядро)
      const kappa = lerp(3.6, 1.2, clamp(sig.arousal));
      const gStrength = lerp(0.15, 0.9, clamp(sig.arousal));

      const { w, h, dpr } = s;
      const cx = w / 2;
      const cy = h / 2;
      const scale = Math.min(w, h) * 0.12;
      const focal = 520;
      const camDist = 7;

      const cyaw = Math.cos(s.yaw), syaw = Math.sin(s.yaw);
      const cpit = Math.cos(s.pitch), spit = Math.sin(s.pitch);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // шлейф: при орбите мышью гасим сильнее, чтобы не смазывалось
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = s.moved ? 'rgba(6,2,16,0.5)' : 'rgba(6,2,16,0.14)';
      ctx.fillRect(0, 0, w, h);
      s.moved = false;

      // свечение ядра Макса
      const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 2.4);
      const coreA = 0.16 + (sig.voiced ? sig.energy * 0.4 : 0.04);
      coreGlow.addColorStop(0, `hsla(315,100%,72%,${coreA})`);
      coreGlow.addColorStop(0.4, `hsla(315,100%,60%,${coreA * 0.4})`);
      coreGlow.addColorStop(1, 'hsla(315,100%,60%,0)');
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
        s.rad[i] = rad;
        s.ang[i] += s.spin[i] * dt;
        s.hgt[i] *= 1 - 0.12 * dt; // диск потихоньку уплощается

        const ang = s.ang[i];
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
          const alpha = decay * fog * (0.28 + coreHot * 0.4);
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
          b: lerp(0.5, 0.16, clamp(sig.tension)),
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
        <span className="ef-logo">△∞</span>
        <div>
          <div className="ef-title">ЭФИР · РЕАЛЬНОСТЬ ИЗ ГОЛОСА</div>
          <div className="ef-formula">r = r₀·e^(bθ) · яркость ∝ e^(−t/τ) · e = 2.718</div>
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

      {/* Панель законов на e — что сейчас лепит голос */}
      <div className="ef-panel">
        <div className="ef-panel-title">ЗАКОНЫ РЕАЛЬНОСТИ · e = 2.718</div>
        <Row k="Тон f0" v={hud.f0 ? `${hud.f0} Гц` : '—'} />
        <Row k="Рукава спирали" v={`${hud.arms} · b=${hud.b.toFixed(2)}`} />
        <Row k="Жизнь τ" v={`${hud.tau.toFixed(1)} с`} />
        <Row k="Гравитация κ" v={hud.kappa.toFixed(2)} />
        <Row k="Частиц в эфире" v={`${hud.alive}`} accent />
        <div className="ef-bars">
          <Meter label="Возбуждение" v={hud.arousal} c="#ff2fd0" />
          <Meter label="Позитив" v={hud.valence} c="#c07bff" />
          <Meter label="Напряжение" v={hud.tension} c="#ff6a8a" />
        </div>
        <div className="ef-status">{status}</div>
      </div>

      <div className="ef-foot">
        Audio · FFT → Частицы → Спираль e^(bθ) → Эфир &nbsp;·&nbsp; тащи мышью — облети космос &nbsp;·&nbsp;
        без потолка: {hud.alive.toLocaleString('ru-RU')} живых
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
