/**
 * Dream canvas — Max's subconscious painted procedurally. No API, no network:
 * a seeded PRNG + canvas 2D turn a "seed thought" (any text) into an abstract
 * wallpaper. The same thought always paints the same dream; a new thought —
 * a new one. Palette hues come from the active theme, so dreams match the skin.
 *
 * Styles:
 *  - flow:   жидкие линии тока — мысли, текущие по полю
 *  - nebula: туманности и звёзды — глубокая память
 *  - web:    нейронная паутина — синапсы и связи
 *  - aurora: ленты сияния — настроение
 */

export interface DreamStyle {
  id: string;
  label: string;
}

export const DREAM_STYLES: DreamStyle[] = [
  { id: 'flow', label: 'Потоки мысли' },
  { id: 'nebula', label: 'Туманность памяти' },
  { id: 'web', label: 'Нейронная паутина' },
  { id: 'aurora', label: 'Сияние' },
];

// ---------------------------------------------------------------- prng / noise
function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tiny value-noise: hashed lattice + bilinear interpolation + 3 octaves. */
function makeNoise(rnd: () => number): (x: number, y: number) => number {
  const SIZE = 64;
  const grid = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const at = (ix: number, iy: number) => grid[((iy % SIZE) + SIZE) % SIZE * SIZE + (((ix % SIZE) + SIZE) % SIZE)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const base = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y) => 0.55 * base(x, y) + 0.3 * base(x * 2.1, y * 2.1) + 0.15 * base(x * 4.3, y * 4.3);
}

// ---------------------------------------------------------------------- paint
const W = 1600;
const H = 1000;

function darkBase(g: CanvasRenderingContext2D, rnd: () => number, hues: number[]) {
  const h = hues[0];
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, `hsl(${h + 20}, 45%, ${4 + rnd() * 3}%)`);
  grad.addColorStop(0.5, `hsl(${h - 15}, 50%, ${6 + rnd() * 4}%)`);
  grad.addColorStop(1, `hsl(${h + 40}, 40%, ${3 + rnd() * 3}%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
}

function paintFlow(g: CanvasRenderingContext2D, rnd: () => number, hues: number[]) {
  darkBase(g, rnd, hues);
  const noise = makeNoise(rnd);
  const scale = 2.6 + rnd() * 2.2;
  g.globalCompositeOperation = 'lighter';
  const lines = 620;
  for (let l = 0; l < lines; l++) {
    let x = rnd() * W;
    let y = rnd() * H;
    const hue = hues[Math.floor(rnd() * hues.length)] + (rnd() - 0.5) * 26;
    const alpha = 0.025 + rnd() * 0.05;
    g.strokeStyle = `hsla(${hue}, 95%, ${55 + rnd() * 25}%, ${alpha})`;
    g.lineWidth = 0.7 + rnd() * 1.6;
    g.beginPath();
    g.moveTo(x, y);
    const steps = 90 + Math.floor(rnd() * 110);
    for (let s = 0; s < steps; s++) {
      const ang = noise((x / W) * scale, (y / H) * scale) * Math.PI * 4;
      x += Math.cos(ang) * 3.1;
      y += Math.sin(ang) * 3.1;
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) break;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
}

function paintNebula(g: CanvasRenderingContext2D, rnd: () => number, hues: number[]) {
  darkBase(g, rnd, hues);
  g.globalCompositeOperation = 'lighter';
  const clouds = 7 + Math.floor(rnd() * 4);
  for (let c = 0; c < clouds; c++) {
    const cx = rnd() * W;
    const cy = rnd() * H;
    const hue = hues[Math.floor(rnd() * hues.length)] + (rnd() - 0.5) * 30;
    const puffs = 70 + Math.floor(rnd() * 80);
    for (let p = 0; p < puffs; p++) {
      const a = rnd() * Math.PI * 2;
      const d = Math.pow(rnd(), 1.6) * (140 + rnd() * 180);
      const px = cx + Math.cos(a) * d * 1.4;
      const py = cy + Math.sin(a) * d;
      const r = 18 + rnd() * 90;
      const grad = g.createRadialGradient(px, py, 0, px, py, r);
      grad.addColorStop(0, `hsla(${hue}, 90%, ${48 + rnd() * 22}%, ${0.028 + rnd() * 0.035})`);
      grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  // stars
  for (let s = 0; s < 240; s++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = rnd() * 1.3 + 0.2;
    g.fillStyle = `hsla(${hues[0]}, 60%, ${82 + rnd() * 16}%, ${0.35 + rnd() * 0.6})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}

function paintWeb(g: CanvasRenderingContext2D, rnd: () => number, hues: number[]) {
  darkBase(g, rnd, hues);
  const nodes: { x: number; y: number; r: number }[] = [];
  const count = 120 + Math.floor(rnd() * 50);
  for (let i = 0; i < count; i++) nodes.push({ x: rnd() * W, y: rnd() * H, r: 1 + Math.pow(rnd(), 2.4) * 4.2 });

  g.globalCompositeOperation = 'lighter';
  // connect each node to its 2-3 nearest — synapse links
  for (const n of nodes) {
    const near = nodes
      .filter((m) => m !== n)
      .map((m) => ({ m, d: (m.x - n.x) ** 2 + (m.y - n.y) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 2 + Math.floor(rnd() * 2));
    for (const { m, d } of near) {
      const dist = Math.sqrt(d);
      if (dist > 260) continue;
      const hue = hues[Math.floor(rnd() * hues.length)];
      g.strokeStyle = `hsla(${hue}, 90%, 62%, ${Math.max(0.02, 0.16 - dist / 1900)})`;
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(n.x, n.y);
      const mx = (n.x + m.x) / 2 + (rnd() - 0.5) * 36;
      const my = (n.y + m.y) / 2 + (rnd() - 0.5) * 36;
      g.quadraticCurveTo(mx, my, m.x, m.y);
      g.stroke();
    }
  }
  // glowing nodes; a few hot "active thoughts"
  for (const n of nodes) {
    const hot = rnd() < 0.07;
    const hue = hues[Math.floor(rnd() * hues.length)];
    const r = hot ? n.r * 2.4 : n.r;
    const grad = g.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 5);
    grad.addColorStop(0, `hsla(${hue}, 95%, ${hot ? 78 : 64}%, ${hot ? 0.85 : 0.4})`);
    grad.addColorStop(1, 'hsla(0,0%,0%,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(n.x, n.y, r * 5, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}

function paintAurora(g: CanvasRenderingContext2D, rnd: () => number, hues: number[]) {
  darkBase(g, rnd, hues);
  const noise = makeNoise(rnd);
  g.globalCompositeOperation = 'lighter';
  const ribbons = 5 + Math.floor(rnd() * 3);
  for (let rIdx = 0; rIdx < ribbons; rIdx++) {
    const hue = hues[rIdx % hues.length] + (rnd() - 0.5) * 24;
    const baseY = (0.18 + 0.64 * rnd()) * H;
    const amp = 60 + rnd() * 150;
    const thick = 70 + rnd() * 150;
    const phase = rnd() * 10;
    for (let x = -10; x <= W + 10; x += 5) {
      const t = x / W;
      const yC = baseY + Math.sin(t * (2.5 + rnd() * 0.1) * Math.PI + phase) * amp + (noise(t * 3, rIdx) - 0.5) * 130;
      const grad = g.createLinearGradient(0, yC - thick, 0, yC + thick);
      grad.addColorStop(0, 'hsla(0,0%,0%,0)');
      grad.addColorStop(0.5, `hsla(${hue}, 95%, 58%, ${0.018 + rnd() * 0.012})`);
      grad.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = grad;
      g.fillRect(x, yC - thick, 6, thick * 2);
    }
  }
  // sparse stars above
  for (let s = 0; s < 130; s++) {
    g.fillStyle = `hsla(0, 0%, ${85 + rnd() * 15}%, ${0.25 + rnd() * 0.5})`;
    g.beginPath();
    g.arc(rnd() * W, rnd() * H * 0.6, rnd() * 1.1 + 0.2, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}

const PAINTERS: Record<string, (g: CanvasRenderingContext2D, rnd: () => number, hues: number[]) => void> = {
  flow: paintFlow,
  nebula: paintNebula,
  web: paintWeb,
  aurora: paintAurora,
};

/** Paint one dream → JPEG data-URL. Same (style, seed, hues) ⇒ same dream. */
export function generateDream(opts: { styleId: string; seedText?: string; hues: number[] }): string {
  const seedText = (opts.seedText || '').trim() || `сон-${Date.now()}`;
  const rnd = mulberry32(hashSeed(`${opts.styleId}::${seedText}`));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  if (!g) return '';
  (PAINTERS[opts.styleId] ?? paintFlow)(g, rnd, opts.hues.length ? opts.hues : [265, 285, 320]);
  // soft vignette so HUD windows stay readable on top
  const vig = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);
  return canvas.toDataURL('image/jpeg', 0.82);
}
