// Палитра оттенков, заранее переведённая в RGB.
//
// В цикле частиц не должно быть ни строк, ни разбора CSS-цвета: именно
// построение `hsla(...)` и отдельный вызов отрисовки на каждую частицу были
// настоящим потолком (не сам счёт). С этой таблицей стоимость частицы —
// несколько арифметических операций, поэтому их число может расти свободно.

export const HUE_STEPS = 240;

export const HUE_LUT = (() => {
  const lut = new Float32Array(HUE_STEPS * 3);
  for (let i = 0; i < HUE_STEPS; i++) {
    const h = (i / HUE_STEPS) * 360;
    const s = 0.95;
    const l = 0.6;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hp < 1) [r, g, b] = [c, x, 0];
    else if (hp < 2) [r, g, b] = [x, c, 0];
    else if (hp < 3) [r, g, b] = [0, c, x];
    else if (hp < 4) [r, g, b] = [0, x, c];
    else if (hp < 5) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const m = l - c / 2;
    lut[i * 3] = (r + m) * 255;
    lut[i * 3 + 1] = (g + m) * 255;
    lut[i * 3 + 2] = (b + m) * 255;
  }
  return lut;
})();

/** Индекс в таблице (уже умноженный на 3) для произвольного угла оттенка. */
export function hueIndex(hue: number): number {
  const h = (((hue % 360) + 360) % 360) * (HUE_STEPS / 360);
  return (h | 0) * 3;
}
