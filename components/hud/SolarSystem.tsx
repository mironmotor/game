'use client';

/**
 * SolarSystem — живой фон-навигатор Солнечной системы с камерой и SLOWED-фокусом.
 *
 * • Клик по ПЛАНЕТЕ → камера плавно летит к ней и СЦЕНА ЗАМЕДЛЯЕТСЯ (slowed),
 *   планета по центру. Камера трекает её по орбите.
 * • У ЗЕМЛИ — ЛУНА: клик по Луне → перелёт на неё. Над Землёй — сигнатуры MAX.
 * • Клик по пустому космосу → обратно ко всей системе (нормальная скорость).
 * • Клик по СОЛНЦУ → влёт + GODMODE (☉ Солнце-интерфейс · Ядро).
 *
 * 2D-канвас, пре-рендеренные glow-спрайты. Клики — hit-test по экранным позициям
 * (работает с движущимися по орбитам телами). Микрофон даёт лёгкое дыхание.
 */

import { useEffect, useRef, type MouseEvent } from 'react';
import { sendMax17Event } from '@/lib/max17-client';
import { ambientFrame } from '@/lib/ambient-audio';

interface Body {
  key: string;
  name: string;
  sx: number;
  sy: number;
  r: number;
}

export function SolarSystem({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<string[]>([]);
  const focusRef = useRef<string | null>(null); // ключ сфокусированного тела
  const bodiesRef = useRef<Body[]>([]); // экранные позиции для кликов
  const pendingGodRef = useRef(false);
  const thinkingRef = useRef(false); // совет агентов / обработка → ускоряем планеты
  const camRef = useRef({ zoom: 1, fx: 0, fy: 0, tz: 1, tfx: 0, tfy: 0, init: false });

  // Совет агентов «думает» → фон ускоряется (max:thinking / max:speaking).
  useEffect(() => {
    const onThink = (e: Event) => {
      thinkingRef.current = Boolean((e as CustomEvent).detail?.active);
    };
    window.addEventListener('max:thinking', onThink as EventListener);
    return () => window.removeEventListener('max:thinking', onThink as EventListener);
  }, []);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = (await sendMax17Event({ type: 'graph_stats' })) as {
          graph_stats?: { top_concepts?: Array<{ concept: string }>; top_node_types?: Array<{ node_type: string }> };
        };
        if (!alive) return;
        const labels = [
          ...(r.graph_stats?.top_concepts ?? []).map((c) => c.concept),
          ...(r.graph_stats?.top_node_types ?? []).map((n) => n.node_type),
        ].filter(Boolean);
        if (labels.length) labelsRef.current = labels;
      } catch {
        /* мост холодный */
      }
    };
    void pull();
    const t = setInterval(pull, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Закрыли GODMODE → камера и фокус назад ко всей системе.
  useEffect(() => {
    const reset = () => {
      pendingGodRef.current = false;
      focusRef.current = null;
    };
    window.addEventListener('godmode:closed', reset as EventListener);
    return () => window.removeEventListener('godmode:closed', reset as EventListener);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;
    let sunWX = 0;
    let sunWY = 0;
    let base = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = Math.max(2, r.width);
      H = Math.max(2, r.height);
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      base = Math.min(W, H);
      sunWX = W * 0.42;
      sunWY = H * 0.5;
      const c = camRef.current;
      if (!c.init) {
        c.fx = c.tfx = W / 2;
        c.fy = c.tfy = H / 2;
        c.init = true;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const glow = (stops: Array<[number, string]>, s = 128) => {
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      for (const [o, col] of stops) gr.addColorStop(o, col);
      g.fillStyle = gr;
      g.fillRect(0, 0, s, s);
      return c;
    };
    const sunSprite = glow([[0, 'rgba(255,236,170,0.97)'], [0.3, 'rgba(255,180,80,0.45)'], [1, 'rgba(255,140,40,0)']]);
    const atmoSprite = glow([[0, 'rgba(90,180,255,0)'], [0.72, 'rgba(70,150,255,0.16)'], [0.9, 'rgba(120,200,255,0.28)'], [1, 'rgba(120,200,255,0)']]);
    const maxSprite = glow([[0, 'rgba(255,150,240,0.95)'], [0.4, 'rgba(255,60,220,0.4)'], [1, 'rgba(255,60,220,0)']], 64);
    const sigSprite = glow([[0, 'rgba(180,255,230,0.95)'], [0.5, 'rgba(60,230,180,0.35)'], [1, 'rgba(60,230,180,0)']], 64);
    const glowCache = new Map<string, HTMLCanvasElement>();
    const pglow = (h: string): HTMLCanvasElement => {
      let c = glowCache.get(h);
      if (!c) {
        c = glow([[0, h], [0.5, h], [1, 'rgba(0,0,0,0)']], 64);
        glowCache.set(h, c);
      }
      return c;
    };

    let seed = 424242;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const stars = Array.from({ length: 240 }, () => ({ x: rnd(), y: rnd(), z: 0.2 + rnd() * 0.8, tw: rnd() * 6.28 }));

    const GN = 1400;
    const globe: Array<{ x: number; y: number; z: number; land: number }> = [];
    for (let i = 0; i < GN; i++) {
      const y = 1 - (i / (GN - 1)) * 2;
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * Math.PI * (3 - Math.sqrt(5));
      const x = Math.cos(phi) * rr;
      const z = Math.sin(phi) * rr;
      const n =
        Math.sin(x * 3.1 + 1) * Math.cos(y * 2.7) + Math.sin(z * 3.9 + 2) * 0.7 + Math.sin((x + z) * 5.3) * 0.5 + Math.cos((y + x) * 4.1) * 0.4;
      globe.push({ x, y, z, land: n > 0.35 ? 1 : 0 });
    }

    // Планеты на орбитах (доли base). fz — зум при фокусе.
    const orbits = [
      { key: 'mercury', name: 'Меркурий', R: 0.16, size: 5, col: '#b9a89a', sp: 0.5, ph: 1, fz: 5 },
      { key: 'venus', name: 'Венера', R: 0.24, size: 8, col: '#e6c98a', sp: 0.34, ph: 4, fz: 4.5 },
      { key: 'earth', name: 'Земля', R: 0.34, earth: true, sp: 0.22, ph: -0.4, fz: 2.8 },
      { key: 'mars', name: 'Марс', R: 0.45, size: 6, col: '#d9603a', sp: 0.16, ph: 2.2, fz: 5 },
      { key: 'jupiter', name: 'Юпитер', R: 0.56, size: 13, col: '#d9a066', sp: 0.1, ph: 5, fz: 3.2 },
      { key: 'saturn', name: 'Сатурн', R: 0.66, size: 11, col: '#c9a25a', sp: 0.07, ph: 2.2, ring: true, fz: 3.4 },
    ] as Array<{ key: string; name: string; R: number; size?: number; col?: string; sp: number; ph: number; earth?: boolean; ring?: boolean; fz: number }>;
    const KY = 0.42;
    const earthRW = base * 0.12;

    const maxTrail: Array<[number, number]> = [];
    let sigAnim = 0;
    let t = 0; // живое время (вращение Земли, ядро MAX, звёзды)
    let pt = 0; // «планетное» время — медленный дрейф орбит
    let audio = 0;
    let timeScale = 1;
    let planetScale = 1;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cam = camRef.current;
      const af = ambientFrame();
      audio += ((af ? af.level : 0) - audio) * 0.08;

      // SLOWED при фокусе; УСКОРЕНИЕ на совете агентов.
      const focus = focusRef.current;
      const think = thinkingRef.current;
      const tsTarget = focus ? 0.28 : think ? 1.5 : 1;
      timeScale += (tsTarget - timeScale) * 0.05;
      t += 0.0016 * timeScale;
      // Планеты: спокойный дрейф (~орбита за минуту); ускоряются на совете,
      // почти замирают в фокусе.
      const psTarget = focus ? 0.18 : think ? 3.0 : 1.0;
      planetScale += (psTarget - planetScale) * 0.04;
      pt += 0.00014 * planetScale;

      // Мировые позиции тел (для трекинга камерой + кликов).
      const bw: Record<string, { wx: number; wy: number; fz: number; name: string }> = {
        sun: { wx: sunWX, wy: sunWY, fz: 3.6, name: 'Солнце' },
      };
      let earthWX = sunWX;
      let earthWY = sunWY;
      const planetPos: Array<{ o: (typeof orbits)[number]; px: number; py: number }> = [];
      for (const o of orbits) {
        const R = o.R * base;
        const a = pt * o.sp * 60 + o.ph;
        const px = sunWX + Math.cos(a) * R;
        const py = sunWY + Math.sin(a) * R * KY;
        planetPos.push({ o, px, py });
        bw[o.key] = { wx: px, wy: py, fz: o.fz, name: o.name };
        if (o.earth) {
          earthWX = px;
          earthWY = py;
        }
      }
      const moonA = pt * 14;
      const moonOrb = earthRW * 2.0;
      const moonWX = earthWX + Math.cos(moonA) * moonOrb;
      const moonWY = earthWY + Math.sin(moonA) * moonOrb * 0.5;
      bw.moon = { wx: moonWX, wy: moonWY, fz: 6, name: 'Луна' };

      // Камера: трекает фокус, иначе общий план (не трогаем при влёте в Солнце).
      if (!pendingGodRef.current) {
        if (focus && bw[focus]) {
          cam.tfx = bw[focus].wx;
          cam.tfy = bw[focus].wy;
          cam.tz = bw[focus].fz;
        } else {
          cam.tfx = W / 2;
          cam.tfy = H / 2;
          cam.tz = 1;
        }
      }
      cam.zoom += (cam.tz - cam.zoom) * 0.07;
      cam.fx += (cam.tfx - cam.fx) * 0.07;
      cam.fy += (cam.tfy - cam.fy) * 0.07;
      const w2s = (wx: number, wy: number): [number, number] => [(wx - cam.fx) * cam.zoom + W / 2, (wy - cam.fy) * cam.zoom + H / 2];
      const zf = (n: number) => n / cam.zoom; // экранно-постоянный размер

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // Звёзды.
      ctx.globalCompositeOperation = 'lighter';
      for (const s of stars) {
        const tw = 0.4 + (Math.sin(t * 4 + s.tw) * 0.5 + 0.5) * 0.6;
        ctx.globalAlpha = tw * (0.25 + s.z);
        ctx.fillStyle = '#dfeaff';
        ctx.fillRect(s.x * W, s.y * H, 1.1, 1.1);
      }

      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-cam.fx, -cam.fy);

      // Солнце.
      const ss = base * 1.0;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.6 + audio * 0.18;
      ctx.drawImage(sunSprite, sunWX - ss / 2, sunWY - ss / 2, ss, ss);
      const coreR = base * 0.06;
      ctx.globalAlpha = 0.97;
      ctx.drawImage(sunSprite, sunWX - coreR * 1.7, sunWY - coreR * 1.7, coreR * 3.4, coreR * 3.4);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.45 + Math.sin(t * 14) * 0.18;
      ctx.strokeStyle = 'rgba(255,210,120,0.9)';
      ctx.lineWidth = zf(1.4);
      ctx.beginPath();
      ctx.arc(sunWX, sunWY, coreR * (1.5 + Math.sin(t * 14) * 0.1), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = 'rgba(255,228,170,0.95)';
      ctx.font = `${zf(10)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('☉ ЯДРО · GODMODE', sunWX, sunWY - coreR * 1.9);

      // Орбиты + планеты (кроме Земли — она глобус).
      for (const { o, px, py } of planetPos) {
        const R = o.R * base;
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.07;
        ctx.strokeStyle = '#6aa';
        ctx.lineWidth = zf(1);
        ctx.beginPath();
        ctx.ellipse(sunWX, sunWY, R, R * KY, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (o.earth) continue;
        const sz = o.size!;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5;
        ctx.drawImage(pglow(o.col!), px - sz * 2.2, py - sz * 2.2, sz * 4.4, sz * 4.4);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = o.col!;
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.fill();
        if (o.ring) {
          ctx.globalAlpha = 0.45;
          ctx.strokeStyle = o.col!;
          ctx.lineWidth = zf(1.5);
          ctx.beginPath();
          ctx.ellipse(px, py, sz * 2.1, sz * 0.7, 0.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        // подпись
        ctx.globalAlpha = focus === o.key ? 0.95 : 0.6;
        ctx.fillStyle = 'rgba(200,225,255,0.9)';
        ctx.font = `${zf(focus === o.key ? 13 : 10)}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(o.name, px, py + sz + zf(14));
      }

      // ── ЗЕМЛЯ (глобус на орбите) ──
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9;
      ctx.drawImage(atmoSprite, earthWX - earthRW * 1.5, earthWY - earthRW * 1.5, earthRW * 3, earthRW * 3);
      const rot = t * 0.6;
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const ctl = Math.cos(-0.35);
      const stl = Math.sin(-0.35);
      const dot = 1.6 / Math.max(1, cam.zoom * 0.5);
      for (let i = 0; i < GN; i++) {
        const p = globe[i];
        const x1 = p.x * cr - p.z * sr;
        const z1 = p.x * sr + p.z * cr;
        const y1 = p.y * ctl - z1 * stl;
        const z2 = p.y * stl + z1 * ctl;
        if (z2 < -0.05) continue;
        const depth = (z2 + 1) / 2;
        const px = earthWX + x1 * earthRW;
        const py = earthWY + y1 * earthRW;
        if (p.land) {
          ctx.globalAlpha = 0.25 + depth * 0.7;
          ctx.fillStyle = `rgba(${Math.round(40 + depth * 60)},${Math.round(200 + depth * 55)},${Math.round(120 + depth * 60)},1)`;
          ctx.fillRect(px, py, dot, dot);
        } else if ((i & 3) === 0) {
          ctx.globalAlpha = 0.05 + depth * 0.16;
          ctx.fillStyle = 'rgba(60,120,220,1)';
          ctx.fillRect(px, py, dot * 0.8, dot * 0.8);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = focus === 'earth' ? 0.95 : 0.6;
      ctx.fillStyle = 'rgba(200,225,255,0.9)';
      ctx.font = `${zf(focus === 'earth' ? 13 : 10)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('Земля', earthWX, earthWY + earthRW + zf(16));

      // ── ЛУНА (вокруг Земли) ──
      const moonR = base * 0.035;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5;
      ctx.drawImage(pglow('rgba(200,205,215,0.9)'), moonWX - moonR * 2, moonWY - moonR * 2, moonR * 4, moonR * 4);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#c8ccd6';
      ctx.beginPath();
      ctx.arc(moonWX, moonWY, moonR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = focus === 'moon' ? 0.95 : 0.55;
      ctx.fillStyle = 'rgba(210,220,235,0.9)';
      ctx.font = `${zf(focus === 'moon' ? 13 : 9)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('Луна', moonWX, moonWY - moonR - zf(6));

      // ── ЯДРО MAX вокруг Земли ──
      const ma = t * 2.4;
      const morb = earthRW * 1.45;
      const mx = earthWX + Math.cos(ma) * morb;
      const my = earthWY + Math.sin(ma) * morb * 0.42;
      maxTrail.push([mx, my]);
      if (maxTrail.length > 24) maxTrail.shift();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < maxTrail.length; k++) {
        const a = (k / maxTrail.length) * 0.5;
        const sz = 3 + (k / maxTrail.length) * 7;
        ctx.globalAlpha = a;
        ctx.drawImage(maxSprite, maxTrail[k][0] - sz / 2, maxTrail[k][1] - sz / 2, sz, sz);
      }
      const msz = base * 0.035 * (1 + Math.sin(t * 30) * 0.12 + audio * 0.7);
      ctx.globalAlpha = 1;
      ctx.drawImage(maxSprite, mx - msz / 2, my - msz / 2, msz, msz);

      // ── СИГНАТУРЫ MAX (когда в фокусе Земля) ──
      const sigTgt = focus === 'earth' ? 1 : 0;
      sigAnim += (sigTgt - sigAnim) * 0.07;
      if (sigAnim > 0.02) {
        const labels = labelsRef.current.slice(0, 10);
        const sigR = earthRW * (1.8 + sigAnim * 0.6);
        ctx.font = `${zf(10)}px ui-monospace, monospace`;
        ctx.textBaseline = 'middle';
        for (let k = 0; k < labels.length; k++) {
          const a = (k / labels.length) * Math.PI * 2 + t * 0.6;
          const x = earthWX + Math.cos(a) * sigR;
          const y = earthWY + Math.sin(a) * sigR * 0.5;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = sigAnim * 0.35;
          ctx.strokeStyle = 'rgba(80,230,180,0.6)';
          ctx.lineWidth = zf(1);
          ctx.beginPath();
          ctx.moveTo(earthWX, earthWY);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.globalAlpha = sigAnim * 0.9;
          ctx.drawImage(sigSprite, x - 8, y - 8, 16, 16);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = sigAnim;
          ctx.fillStyle = 'rgba(190,255,235,0.92)';
          ctx.textAlign = 'left';
          ctx.fillText(labels[k].slice(0, 16), x + zf(9), y);
        }
        ctx.textBaseline = 'alphabetic';
      }

      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.textAlign = 'left';

      // Подсказка возврата при фокусе.
      if (focus) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = 'rgba(180,210,255,0.85)';
        ctx.font = '11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`◀ ${bw[focus]?.name ?? ''} · клик по космосу — ко всей системе`, W / 2, 24);
        ctx.textAlign = 'left';
      }

      // Экранные позиции тел для кликов.
      const bodies: Body[] = [];
      const add = (key: string, name: string, wx: number, wy: number, rWorld: number) => {
        const [sx, sy] = w2s(wx, wy);
        bodies.push({ key, name, sx, sy, r: Math.max(22, rWorld * cam.zoom) });
      };
      add('sun', 'Солнце', sunWX, sunWY, base * 0.08);
      for (const { o, px, py } of planetPos) add(o.key, o.name, px, py, o.earth ? earthRW * 1.2 : (o.size ?? 6) * 2.5);
      add('moon', 'Луна', moonWX, moonWY, moonR * 2.2);
      bodiesRef.current = bodies;

      if (pendingGodRef.current && cam.zoom > 2.2) {
        pendingGodRef.current = false;
        window.dispatchEvent(new CustomEvent('godmode:open'));
      }
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Ближайшее попавшее тело.
    let hit: Body | null = null;
    let best = Infinity;
    for (const b of bodiesRef.current) {
      const d = Math.hypot(mx - b.sx, my - b.sy);
      if (d <= b.r && d < best) {
        best = d;
        hit = b;
      }
    }
    if (!hit) {
      focusRef.current = null; // пустой космос → ко всей системе
      return;
    }
    if (hit.key === 'sun') {
      const c = camRef.current;
      c.tz = 3.6;
      c.tfx = canvas.getBoundingClientRect().width * 0.42; // sunWX
      c.tfy = canvas.getBoundingClientRect().height * 0.5; // sunWY
      pendingGodRef.current = true;
      focusRef.current = null;
      return;
    }
    focusRef.current = hit.key; // планета/луна → фокус + slowed
  };

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        onClick={onClick}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'auto', cursor: 'pointer' }}
        aria-label="Навигатор Солнечной системы: клик по планете — перелёт и замедление, по Солнцу — GODMODE"
      />
    </div>
  );
}
