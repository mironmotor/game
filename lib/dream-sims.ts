/**
 * Симуляции для режима «Квантовый сон».
 *
 * Здесь считается физика, и только она — ни одного обращения к canvas.
 * Разделение не ради чистоты: симуляцию так можно проверить обычным тестом,
 * прогнав N шагов и посмотрев на числа, а рисование останется рисованием.
 *
 * Все симуляции работают с плоскими Float32Array (x,y,z подряд). Это не
 * микрооптимизация: на 12 тысячах частиц массив объектов даёт заметные паузы
 * сборщика прямо посреди анимации.
 *
 * Договорённость: частицы живут примерно в кубе −1..1, чтобы рендер не
 * подбирал масштаб под каждую симуляцию отдельно.
 */

export type SimId = 'lorenz' | 'nbody' | 'boids' | 'interference' | 'galaxy' | 'orbital';

export interface SimState {
  pos: Float32Array;
  vel: Float32Array;
  count: number;
  /** Служебные данные конкретной симуляции (массивные тела, фазы волн). */
  extra: Float32Array;
  t: number;
}

export interface SimDef {
  id: SimId;
  title: string;
  caption: string;
  /** Сколько частиц. Меньше — для симуляций с взаимодействием. */
  count: number;
  /** Подсказка рендеру: как красить. 'depth' — по глубине, 'speed' — по скорости. */
  tint: 'depth' | 'speed';
  /**
   * Сколько секунд прокрутить до первого кадра.
   *
   * Лоренц стартует из почти одной точки: без разгона первые секунд десять
   * зритель смотрит на пятно, которое только собирается стать бабочкой, и
   * автоподбор масштаба всё это время гонится за растущим облаком.
   */
  warmup: number;
  /**
   * Угол, под которым камера смотрит на сцену, в радианах.
   *
   * Галактика — плоский диск: с общего угла она выглядит полоской и теряет
   * рукава. Такие сцены надо разглядывать сверху, а объёмные — сбоку.
   */
  pitch: number;
  init(state: SimState, rand: () => number): void;
  step(state: SimState, dt: number): void;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Гауссово распределение через Бокса—Мюллера — для облаков и дисков. */
function gauss(rand: () => number): number {
  const u = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// ── Аттрактор Лоренца ────────────────────────────────────────────────────────
// Классика хаоса: траектории расходятся экспоненциально, но остаются на
// «бабочке». Частицы стартуют почти в одной точке — на глазах видно, как
// детерминированная система теряет предсказуемость.
const lorenz: SimDef = {
  id: 'lorenz',
  warmup: 8,
  pitch: 0.35,
  title: 'АТТРАКТОР ЛОРЕНЦА',
  caption: 'Одинаковый старт. Разные судьбы. Разница — в четвёртом знаке.',
  count: 9000,
  tint: 'speed',
  init(state, rand) {
    for (let i = 0; i < state.count; i++) {
      const k = i * 3;
      state.pos[k] = 0.1 + gauss(rand) * 0.02;
      state.pos[k + 1] = gauss(rand) * 0.02;
      state.pos[k + 2] = 20 + gauss(rand) * 0.02;
    }
  },
  step(state, dt) {
    const sigma = 10, rho = 28, beta = 8 / 3;
    // Явная схема Эйлера на Лоренце разваливается при шаге больше ~0.006, но
    // просто обрезать шаг нельзя: тогда симуляция идёт медленнее часов, и
    // «восемь секунд разгона» оказываются тремя. Поэтому дробим dt на подшаги
    // и проходим его целиком.
    const sub = Math.min(8, Math.max(1, Math.ceil(dt / 0.006)));
    const h = dt / sub;
    const { pos, vel, count } = state;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      let x = pos[k], y = pos[k + 1], z = pos[k + 2];
      let dx = 0, dy = 0, dz = 0;
      for (let s = 0; s < sub; s++) {
        dx = sigma * (y - x);
        dy = x * (rho - z) - y;
        dz = x * y - beta * z;
        x += dx * h; y += dy * h; z += dz * h;
      }
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      vel[k] = dx; vel[k + 1] = dy; vel[k + 2] = dz;
    }
    state.t += dt;
  },
};

// ── Ограниченная задача N тел ────────────────────────────────────────────────
// Полное N² на десяти тысячах частиц — это кадр в секунду. Считаем честную
// гравитацию от восьми массивных тел, остальные частицы безмассовые пробники.
// Динамика остаётся настоящей, стоимость линейная.
const BODIES = 8;
const nbody: SimDef = {
  id: 'nbody',
  warmup: 4,
  pitch: 0.4,
  title: 'ГРАВИТАЦИЯ ВОСЬМИ',
  caption: 'Восемь центров тяжести. Всё остальное просто падает.',
  count: 11000,
  tint: 'speed',
  init(state, rand) {
    for (let b = 0; b < BODIES; b++) {
      const k = b * 4;
      state.extra[k] = gauss(rand) * 0.45;
      state.extra[k + 1] = gauss(rand) * 0.45;
      state.extra[k + 2] = gauss(rand) * 0.45;
      state.extra[k + 3] = 0.4 + rand() * 0.9; // масса
    }
    for (let i = 0; i < state.count; i++) {
      const k = i * 3;
      const r = 0.5 + rand() * 0.8;
      const th = rand() * Math.PI * 2;
      const ph = Math.acos(2 * rand() - 1);
      state.pos[k] = r * Math.sin(ph) * Math.cos(th);
      state.pos[k + 1] = r * Math.sin(ph) * Math.sin(th);
      state.pos[k + 2] = r * Math.cos(ph);
      // Начальная скорость поперёк радиуса — иначе всё просто падает в центр.
      state.vel[k] = -state.pos[k + 1] * 0.6;
      state.vel[k + 1] = state.pos[k] * 0.6;
      state.vel[k + 2] = gauss(rand) * 0.1;
    }
  },
  step(state, dt) {
    const h = Math.min(dt, 0.03);
    const { pos, vel, extra, count } = state;
    // Тела медленно кружат сами — иначе картина застывает через десять секунд.
    for (let b = 0; b < BODIES; b++) {
      const k = b * 4;
      const a = state.t * 0.25 + b;
      extra[k] += Math.cos(a) * 0.0016;
      extra[k + 1] += Math.sin(a * 1.3) * 0.0016;
      extra[k + 2] += Math.sin(a * 0.7) * 0.0016;
    }
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      let ax = 0, ay = 0, az = 0;
      for (let b = 0; b < BODIES; b++) {
        const m = b * 4;
        const dx = extra[m] - pos[k];
        const dy = extra[m + 1] - pos[k + 1];
        const dz = extra[m + 2] - pos[k + 2];
        // Смягчение (softening): без него частица у самого центра получает
        // бесконечное ускорение и улетает за экран навсегда.
        const d2 = dx * dx + dy * dy + dz * dz + 0.02;
        const inv = extra[m + 3] / (d2 * Math.sqrt(d2));
        ax += dx * inv; ay += dy * inv; az += dz * inv;
      }
      vel[k] = (vel[k] + ax * h) * 0.999;
      vel[k + 1] = (vel[k + 1] + ay * h) * 0.999;
      vel[k + 2] = (vel[k + 2] + az * h) * 0.999;
      pos[k] += vel[k] * h;
      pos[k + 1] += vel[k + 1] * h;
      pos[k + 2] += vel[k + 2] * h;
    }
    state.t += dt;
  },
};

// ── Стая (боиды Рейнольдса) ──────────────────────────────────────────────────
// Три правила — разделение, выравнивание, сплочение — дают поведение, которого
// ни в одном из них нет. Соседей опрашиваем выборочно: полный перебор здесь
// тоже квадратичный, а на глаз выборка из двадцати неотличима.
const boids: SimDef = {
  id: 'boids',
  warmup: 5,
  pitch: 0.4,
  title: 'СТАЯ',
  caption: 'Ни одна птица не знает, куда летит стая. Стая знает.',
  count: 1400,
  tint: 'speed',
  init(state, rand) {
    for (let i = 0; i < state.count; i++) {
      const k = i * 3;
      state.pos[k] = gauss(rand) * 0.4;
      state.pos[k + 1] = gauss(rand) * 0.4;
      state.pos[k + 2] = gauss(rand) * 0.4;
      state.vel[k] = gauss(rand) * 0.2;
      state.vel[k + 1] = gauss(rand) * 0.2;
      state.vel[k + 2] = gauss(rand) * 0.2;
    }
  },
  step(state, dt) {
    const h = Math.min(dt, 0.033);
    const { pos, vel, count } = state;
    const SAMPLE = 20;
    const VIEW2 = 0.09;
    const NEAR2 = 0.012;
    const MAXV = 0.9;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      let cx = 0, cy = 0, cz = 0;   // сплочение
      let ax = 0, ay = 0, az = 0;   // выравнивание
      let sx = 0, sy = 0, sz = 0;   // разделение
      let n = 0;
      for (let s = 0; s < SAMPLE; s++) {
        const j = ((Math.random() * count) | 0) * 3;
        if (j === k) continue;
        const dx = pos[j] - pos[k];
        const dy = pos[j + 1] - pos[k + 1];
        const dz = pos[j + 2] - pos[k + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > VIEW2) continue;
        n++;
        cx += dx; cy += dy; cz += dz;
        ax += vel[j]; ay += vel[j + 1]; az += vel[j + 2];
        if (d2 < NEAR2) {
          const w = 1 / (d2 + 1e-4);
          sx -= dx * w; sy -= dy * w; sz -= dz * w;
        }
      }
      if (n) {
        const inv = 1 / n;
        vel[k] += (cx * inv * 0.6 + ax * inv * 0.35 + sx * 0.0025) * h;
        vel[k + 1] += (cy * inv * 0.6 + ay * inv * 0.35 + sy * 0.0025) * h;
        vel[k + 2] += (cz * inv * 0.6 + az * inv * 0.35 + sz * 0.0025) * h;
      }
      // Мягкий возврат к центру вместо стенок: стая, отражающаяся от куба,
      // выглядит как аквариум, а не как стая.
      const r2 = pos[k] * pos[k] + pos[k + 1] * pos[k + 1] + pos[k + 2] * pos[k + 2];
      if (r2 > 0.64) {
        const pull = (r2 - 0.64) * 1.6;
        vel[k] -= pos[k] * pull * h;
        vel[k + 1] -= pos[k + 1] * pull * h;
        vel[k + 2] -= pos[k + 2] * pull * h;
      }
      const sp = Math.hypot(vel[k], vel[k + 1], vel[k + 2]);
      if (sp > MAXV) {
        const f = MAXV / sp;
        vel[k] *= f; vel[k + 1] *= f; vel[k + 2] *= f;
      }
      pos[k] += vel[k] * h;
      pos[k + 1] += vel[k + 1] * h;
      pos[k + 2] += vel[k + 2] * h;
    }
    state.t += dt;
  },
};

// ── Интерференция волн ───────────────────────────────────────────────────────
// Сетка частиц, высота каждой — сумма волн от нескольких источников. Ровно то,
// что происходит на воде: там, где гребни совпали, амплитуда складывается.
const SOURCES = 4;
const interference: SimDef = {
  id: 'interference',
  warmup: 1,
  pitch: 0.72,
  title: 'ИНТЕРФЕРЕНЦИЯ',
  caption: 'Две волны в одной точке. Иногда — вдвое. Иногда — ничего.',
  count: 12100, // 110 × 110
  tint: 'depth',
  init(state, rand) {
    const side = Math.round(Math.sqrt(state.count));
    for (let i = 0; i < state.count; i++) {
      const k = i * 3;
      state.pos[k] = ((i % side) / (side - 1)) * 2 - 1;
      state.pos[k + 2] = (Math.floor(i / side) / (side - 1)) * 2 - 1;
      state.pos[k + 1] = 0;
    }
    for (let s = 0; s < SOURCES; s++) {
      const k = s * 4;
      state.extra[k] = (rand() * 2 - 1) * 0.8;      // x источника
      state.extra[k + 1] = (rand() * 2 - 1) * 0.8;  // z источника
      state.extra[k + 2] = 6 + rand() * 10;         // волновое число
      state.extra[k + 3] = 1.5 + rand() * 2.5;      // частота
    }
  },
  step(state, dt) {
    state.t += dt;
    const { pos, vel, extra, count, t } = state;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      const x = pos[k], z = pos[k + 2];
      let hgt = 0;
      for (let s = 0; s < SOURCES; s++) {
        const m = s * 4;
        const d = Math.hypot(x - extra[m], z - extra[m + 1]);
        // Амплитуда падает с расстоянием — иначе дальние источники звучат
        // так же громко, как ближние, и картина превращается в шум.
        hgt += Math.sin(d * extra[m + 2] - t * extra[m + 3]) / (1 + d * 1.6);
      }
      const next = hgt * 0.35;
      vel[k + 1] = next - pos[k + 1];
      pos[k + 1] = next;
    }
  },
};

// ── Спиральная галактика ─────────────────────────────────────────────────────
// Дифференциальное вращение: внутренние орбиты быстрее внешних. Рукава здесь
// не нарисованы — они появляются сами как волна плотности.
const galaxy: SimDef = {
  id: 'galaxy',
  warmup: 2,
  pitch: 1.02,
  title: 'ГАЛАКТИКА',
  caption: 'Рукава не вращаются. Вращается то, из чего они собраны.',
  count: 12000,
  tint: 'depth',
  init(state, rand) {
    for (let i = 0; i < state.count; i++) {
      const k = i * 3;
      const arm = Math.floor(rand() * 2) * Math.PI;
      const r = Math.pow(rand(), 0.6) * 1.05;
      const spread = 0.35 * (1.05 - r);
      const a = arm + r * 4.2 + gauss(rand) * spread;
      state.pos[k] = Math.cos(a) * r;
      state.pos[k + 1] = gauss(rand) * 0.05 * (1.2 - r); // диск тонкий к краю
      state.pos[k + 2] = Math.sin(a) * r;
      state.vel[k] = r;  // храним радиус: пересчитывать его каждый кадр незачем
    }
  },
  step(state, dt) {
    const { pos, vel, count } = state;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      const r = vel[k];
      // Кривая вращения как у настоящих галактик: почти плоская, поэтому
      // угловая скорость падает как 1/r, и рукава закручиваются.
      const omega = 0.55 / (r + 0.12);
      const a = Math.atan2(pos[k + 2], pos[k]) + omega * dt;
      pos[k] = Math.cos(a) * r;
      pos[k + 2] = Math.sin(a) * r;
    }
    state.t += dt;
  },
};

// ── Электронное облако ───────────────────────────────────────────────────────
// Плотность точек повторяет |ψ|² водородоподобной орбитали 3d_z². Частицы не
// летают по траекториям — их и нет: точка означает «здесь вероятно застать».
const PSI2_MAX = 94.61;
const orbital: SimDef = {
  id: 'orbital',
  warmup: 0,
  pitch: 0.3,
  title: 'ОРБИТАЛЬ',
  caption: 'Электрон не летает по орбите. Он — облако вероятности.',
  count: 11000,
  tint: 'depth',
  init(state, rand) {
    // Отбор с отклонением: берём случайную точку, оставляем с вероятностью
    // |ψ|². Прямой формулы для такой выборки нет, а этот способ точный.
    let placed = 0;
    let guard = 0;
    while (placed < state.count && guard < state.count * 200) {
      guard++;
      const x = (rand() * 2 - 1) * 1.15;
      const y = (rand() * 2 - 1) * 1.15;
      const z = (rand() * 2 - 1) * 1.15;
      const r = Math.hypot(x, y, z);
      if (r < 1e-4 || r > 1.15) continue;
      // Ось симметрии — вертикаль, а не глубина: иначе камера, объезжая
      // облако, регулярно смотрит точно вдоль оси, и две доли складываются в
      // ровный шар — ровно то, что орбиталь и не должна напоминать.
      const cos = y / r;
      const rr = r * 5;
      const psi = rr * rr * Math.exp(-rr / 3) * (3 * cos * cos - 1);
      // 94.6 — максимум |ψ|² на этой области, посчитанный, а не подобранный.
      // С заниженной нормой почти каждая точка проходит отбор, и вместо
      // орбитали получается ровный шар: форма исчезает целиком.
      if (rand() < (psi * psi) / PSI2_MAX) {
        const k = placed * 3;
        state.pos[k] = x; state.pos[k + 1] = y; state.pos[k + 2] = z;
        state.vel[k] = rand() * Math.PI * 2; // своя фаза дрожания
        placed++;
      }
    }
    // Если отбор не добрал (маловероятно, но защищаться дешевле, чем ловить
    // дыры в облаке) — досыпаем в тонкую оболочку.
    for (let i = placed; i < state.count; i++) {
      const k = i * 3;
      const th = rand() * Math.PI * 2;
      const ph = Math.acos(2 * rand() - 1);
      const r = 0.5 + rand() * 0.2;
      state.pos[k] = r * Math.sin(ph) * Math.cos(th);
      state.pos[k + 1] = r * Math.sin(ph) * Math.sin(th);
      state.pos[k + 2] = r * Math.cos(ph);
      state.vel[k] = rand() * Math.PI * 2;
    }
  },
  step(state, dt) {
    state.t += dt;
    const { pos, vel, count, t } = state;
    // Облако не движется — оно дышит. Каждая точка дрожит вокруг своего места.
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      const j = Math.sin(t * 1.6 + vel[k]) * 0.0016;
      pos[k] += j;
      pos[k + 1] += j * 0.7;
      pos[k + 2] -= j * 0.5;
    }
  },
};

export const SIMS: SimDef[] = [lorenz, nbody, boids, interference, galaxy, orbital];

export function simById(id: SimId): SimDef {
  return SIMS.find((s) => s.id === id) ?? SIMS[0];
}

export function createSim(def: SimDef, seed: number): SimState {
  const state: SimState = {
    pos: new Float32Array(def.count * 3),
    vel: new Float32Array(def.count * 3),
    extra: new Float32Array(64),
    count: def.count,
    t: 0,
  };
  def.init(state, mulberry32(seed));

  // Разгон до характерного режима. Шаг крупнее кадрового — точность здесь не
  // важна, важно попасть в тот же аттрактор; сами симуляции ограничивают dt
  // изнутри, так что разлететься это не даст.
  const STEP = 1 / 60;
  const steps = Math.min(2000, Math.round(def.warmup / STEP));
  for (let i = 0; i < steps; i++) def.step(state, STEP);
  return state;
}

/**
 * Границы облака — рендер по ним подбирает масштаб.
 * Лоренц живёт в координатах порядка 50, галактика — в единицах; без этого
 * одна симуляция занимала бы весь экран, а другая была бы точкой.
 */
export function bounds(state: SimState): { cx: number; cy: number; cz: number; radius: number } {
  const { pos, count } = state;
  let cx = 0, cy = 0, cz = 0;
  // По каждой восьмой частице: центр и разброс от этого не меняются,
  // а работы в восемь раз меньше.
  const stride = 8;
  let n = 0;
  for (let i = 0; i < count; i += stride) {
    const k = i * 3;
    cx += pos[k]; cy += pos[k + 1]; cz += pos[k + 2];
    n++;
  }
  cx /= n; cy /= n; cz /= n;
  let sum = 0;
  for (let i = 0; i < count; i += stride) {
    const k = i * 3;
    sum += Math.hypot(pos[k] - cx, pos[k + 1] - cy, pos[k + 2] - cz);
  }
  return { cx, cy, cz, radius: Math.max(0.2, (sum / n) * 1.9) };
}
