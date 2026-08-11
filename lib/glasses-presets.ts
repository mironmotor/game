/**
 * Параметры очков, под которые считается HUD.
 *
 * Разрешение само по себе ничего не говорит: 1920 пикселей на 40° и 1920 на
 * 100° — это разная читаемость. Значение имеет угловой размер, поэтому здесь
 * из разрешения и поля зрения считается PPD (пикселей на градус), а из него —
 * минимальный кегль, который вообще имеет смысл ставить.
 */

export interface GlassesPreset {
  id: string;
  label: string;
  /** Пиксели на глаз, по горизонтали и вертикали. */
  width: number;
  height: number;
  /** Диагональное поле зрения в градусах — так его указывают производители. */
  fovDiagonal: number;
  /** Один глаз или два. Монокуляру нельзя доверять глубину и центровку. */
  ocularity: 'моно' | 'стерео';
  note: string;
}

export const PRESETS: GlassesPreset[] = [
  {
    id: 'xreal-air',
    label: 'Xreal Air / Viture',
    width: 1920,
    height: 1080,
    fovDiagonal: 46,
    ocularity: 'стерео',
    note: 'birdbath, подключаются как второй монитор по USB-C',
  },
  {
    id: 'rayban-display',
    label: 'Ray-Ban Display',
    width: 600,
    height: 600,
    fovDiagonal: 20,
    ocularity: 'моно',
    note: 'экран только в правом стекле, произвольный интерфейс не поставить',
  },
  {
    id: 'focals',
    label: 'Ретинальный (тип Focals)',
    width: 400,
    height: 300,
    fovDiagonal: 15,
    ocularity: 'моно',
    note: 'лазер прямо на сетчатку, фокус не нужен, поле зрения крошечное',
  },
  {
    id: 'diy-birdbath',
    label: 'Самодельный birdbath',
    width: 800,
    height: 480,
    fovDiagonal: 30,
    ocularity: 'моно',
    note: 'микро-OLED + светоделитель + вогнутое зеркало на клипсе',
  },
];

/**
 * Пикселей на градус по горизонтали.
 *
 * Производители дают диагональ, а раскладку считать надо по горизонтали,
 * поэтому диагональ раскладывается по соотношению сторон.
 */
export function pixelsPerDegree(preset: GlassesPreset): number {
  const diagonalPx = Math.hypot(preset.width, preset.height);
  const horizontalFov = preset.fovDiagonal * (preset.width / diagonalPx);
  return preset.width / horizontalFov;
}

/**
 * Наименьший разумный кегль в пикселях этого экрана.
 *
 * Порог — высота прописной около 20 угловых минут (треть градуса). Ниже текст
 * технически различим, но читать бегущую строку в движении уже нельзя, а очки
 * носят именно в движении. Кегль примерно в полтора раза больше высоты
 * прописной, отсюда множитель.
 */
export function minFontPx(preset: GlassesPreset): number {
  return Math.ceil((pixelsPerDegree(preset) / 3) * 1.5);
}

/**
 * Безопасная зона — доля кадра, на которую можно рассчитывать.
 *
 * У birdbath края заметно мылят и разводят цвет, у волноводов падает яркость к
 * краям, а на монокуляре крайние 20% вообще воспринимаются хуже. Всё, что
 * важно, живёт в центре.
 */
export const SAFE_AREA = 0.62;
