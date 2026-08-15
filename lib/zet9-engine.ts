export type PlanetKey =
  | 'sun'
  | 'moon'
  | 'mercury'
  | 'venus'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'
  | 'pluto';

export interface BirthData {
  date: string;
  time: string;
  timezone: number;
  latitude: number;
  longitude: number;
  place: string;
}

export interface AstroPoint {
  key: PlanetKey;
  name: string;
  glyph: string;
  longitude: number;
  sign: string;
  signGlyph: string;
  signIndex: number;
  degree: number;
  minute: number;
  retrograde: boolean;
}

export interface AstroAspect {
  left: PlanetKey;
  right: PlanetKey;
  leftName: string;
  rightName: string;
  type: string;
  glyph: string;
  angle: number;
  orb: number;
  tone: 'flow' | 'tension' | 'neutral';
}

export interface Zet9Chart {
  julianDay: number;
  utcIso: string;
  planets: AstroPoint[];
  houses: number[];
  ascendant: number;
  midheaven: number;
  aspects: AstroAspect[];
  dominantElement: string;
  dominantMode: string;
}

export const ZODIAC = [
  { name: 'Овен', glyph: '♈', element: 'Огонь', mode: 'Кардинальный' },
  { name: 'Телец', glyph: '♉', element: 'Земля', mode: 'Фиксированный' },
  { name: 'Близнецы', glyph: '♊', element: 'Воздух', mode: 'Мутабельный' },
  { name: 'Рак', glyph: '♋', element: 'Вода', mode: 'Кардинальный' },
  { name: 'Лев', glyph: '♌', element: 'Огонь', mode: 'Фиксированный' },
  { name: 'Дева', glyph: '♍', element: 'Земля', mode: 'Мутабельный' },
  { name: 'Весы', glyph: '♎', element: 'Воздух', mode: 'Кардинальный' },
  { name: 'Скорпион', glyph: '♏', element: 'Вода', mode: 'Фиксированный' },
  { name: 'Стрелец', glyph: '♐', element: 'Огонь', mode: 'Мутабельный' },
  { name: 'Козерог', glyph: '♑', element: 'Земля', mode: 'Кардинальный' },
  { name: 'Водолей', glyph: '♒', element: 'Воздух', mode: 'Фиксированный' },
  { name: 'Рыбы', glyph: '♓', element: 'Вода', mode: 'Мутабельный' },
] as const;

export const PLANETS: Record<PlanetKey, { name: string; glyph: string }> = {
  sun: { name: 'Солнце', glyph: '☉' },
  moon: { name: 'Луна', glyph: '☽' },
  mercury: { name: 'Меркурий', glyph: '☿' },
  venus: { name: 'Венера', glyph: '♀' },
  mars: { name: 'Марс', glyph: '♂' },
  jupiter: { name: 'Юпитер', glyph: '♃' },
  saturn: { name: 'Сатурн', glyph: '♄' },
  uranus: { name: 'Уран', glyph: '♅' },
  neptune: { name: 'Нептун', glyph: '♆' },
  pluto: { name: 'Плутон', glyph: '♇' },
};

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export function norm(value: number): number {
  return ((value % 360) + 360) % 360;
}

function sinDeg(value: number): number {
  return Math.sin(value * DEG);
}

function cosDeg(value: number): number {
  return Math.cos(value * DEG);
}

function atan2Deg(y: number, x: number): number {
  return Math.atan2(y, x) * RAD;
}

function solveEccentricAnomaly(meanAnomaly: number, eccentricity: number): number {
  const mean = norm(meanAnomaly);
  let eccentric = mean + eccentricity * RAD * sinDeg(mean) * (1 + eccentricity * cosDeg(mean));
  for (let i = 0; i < 5; i += 1) {
    eccentric -=
      (eccentric - eccentricity * RAD * sinDeg(eccentric) - mean) /
      (1 - eccentricity * cosDeg(eccentric));
  }
  return eccentric;
}

interface Elements {
  node: number;
  inclination: number;
  perihelion: number;
  axis: number;
  eccentricity: number;
  anomaly: number;
}

function orbitalPosition(elements: Elements): { x: number; y: number; z: number; radius: number; trueAnomaly: number } {
  const E = solveEccentricAnomaly(elements.anomaly, elements.eccentricity);
  const xv = elements.axis * (cosDeg(E) - elements.eccentricity);
  const yv = elements.axis * Math.sqrt(1 - elements.eccentricity ** 2) * sinDeg(E);
  const trueAnomaly = atan2Deg(yv, xv);
  const radius = Math.hypot(xv, yv);
  const argument = trueAnomaly + elements.perihelion;
  const x =
    radius *
    (cosDeg(elements.node) * cosDeg(argument) -
      sinDeg(elements.node) * sinDeg(argument) * cosDeg(elements.inclination));
  const y =
    radius *
    (sinDeg(elements.node) * cosDeg(argument) +
      cosDeg(elements.node) * sinDeg(argument) * cosDeg(elements.inclination));
  const z = radius * sinDeg(argument) * sinDeg(elements.inclination);
  return { x, y, z, radius, trueAnomaly };
}

function sunPosition(d: number): { longitude: number; x: number; y: number; meanAnomaly: number; perihelion: number } {
  const perihelion = 282.9404 + 4.70935e-5 * d;
  const eccentricity = 0.016709 - 1.151e-9 * d;
  const meanAnomaly = 356.047 + 0.9856002585 * d;
  const E = solveEccentricAnomaly(meanAnomaly, eccentricity);
  const xv = cosDeg(E) - eccentricity;
  const yv = Math.sqrt(1 - eccentricity ** 2) * sinDeg(E);
  const trueAnomaly = atan2Deg(yv, xv);
  const radius = Math.hypot(xv, yv);
  const longitude = norm(trueAnomaly + perihelion);
  return {
    longitude,
    x: radius * cosDeg(longitude),
    y: radius * sinDeg(longitude),
    meanAnomaly: norm(meanAnomaly),
    perihelion: norm(perihelion),
  };
}

function elementsFor(key: Exclude<PlanetKey, 'sun' | 'moon'>, d: number): Elements {
  switch (key) {
    case 'mercury':
      return { node: 48.3313 + 3.24587e-5 * d, inclination: 7.0047 + 5e-8 * d, perihelion: 29.1241 + 1.01444e-5 * d, axis: 0.387098, eccentricity: 0.205635 + 5.59e-10 * d, anomaly: 168.6562 + 4.0923344368 * d };
    case 'venus':
      return { node: 76.6799 + 2.4659e-5 * d, inclination: 3.3946 + 2.75e-8 * d, perihelion: 54.891 + 1.38374e-5 * d, axis: 0.72333, eccentricity: 0.006773 - 1.302e-9 * d, anomaly: 48.0052 + 1.6021302244 * d };
    case 'mars':
      return { node: 49.5574 + 2.11081e-5 * d, inclination: 1.8497 - 1.78e-8 * d, perihelion: 286.5016 + 2.92961e-5 * d, axis: 1.523688, eccentricity: 0.093405 + 2.516e-9 * d, anomaly: 18.6021 + 0.5240207766 * d };
    case 'jupiter':
      return { node: 100.4542 + 2.76854e-5 * d, inclination: 1.303 - 1.557e-7 * d, perihelion: 273.8777 + 1.64505e-5 * d, axis: 5.20256, eccentricity: 0.048498 + 4.469e-9 * d, anomaly: 19.895 + 0.0830853001 * d };
    case 'saturn':
      return { node: 113.6634 + 2.3898e-5 * d, inclination: 2.4886 - 1.081e-7 * d, perihelion: 339.3939 + 2.97661e-5 * d, axis: 9.55475, eccentricity: 0.055546 - 9.499e-9 * d, anomaly: 316.967 + 0.0334442282 * d };
    case 'uranus':
      return { node: 74.0005 + 1.3978e-5 * d, inclination: 0.7733 + 1.9e-8 * d, perihelion: 96.6612 + 3.0565e-5 * d, axis: 19.18171 - 1.55e-8 * d, eccentricity: 0.047318 + 7.45e-9 * d, anomaly: 142.5905 + 0.011725806 * d };
    case 'neptune':
      return { node: 131.7806 + 3.0173e-5 * d, inclination: 1.77 - 2.55e-7 * d, perihelion: 272.8461 - 6.027e-6 * d, axis: 30.05826 + 3.313e-8 * d, eccentricity: 0.008606 + 2.15e-9 * d, anomaly: 260.2471 + 0.005995147 * d };
    case 'pluto':
      return { node: 110.30347, inclination: 17.14175, perihelion: 113.76329, axis: 39.48168677, eccentricity: 0.24880766, anomaly: 14.53 + 0.0039757 * d };
  }
}

function moonLongitude(d: number, sun: ReturnType<typeof sunPosition>): number {
  const node = 125.1228 - 0.0529538083 * d;
  const inclination = 5.1454;
  const perihelion = 318.0634 + 0.1643573223 * d;
  const anomaly = 115.3654 + 13.0649929509 * d;
  const pos = orbitalPosition({ node, inclination, perihelion, axis: 60.2666, eccentricity: 0.0549, anomaly });
  let longitude = atan2Deg(pos.y, pos.x);
  const lunarMeanLongitude = norm(node + perihelion + anomaly);
  const solarMeanLongitude = norm(sun.perihelion + sun.meanAnomaly);
  const elongation = norm(lunarMeanLongitude - solarMeanLongitude);
  const argumentLatitude = norm(lunarMeanLongitude - node);
  longitude +=
    -1.274 * sinDeg(anomaly - 2 * elongation) +
    0.658 * sinDeg(2 * elongation) -
    0.186 * sinDeg(sun.meanAnomaly) -
    0.059 * sinDeg(2 * anomaly - 2 * elongation) -
    0.057 * sinDeg(anomaly - 2 * elongation + sun.meanAnomaly) +
    0.053 * sinDeg(anomaly + 2 * elongation) +
    0.046 * sinDeg(2 * elongation - sun.meanAnomaly) +
    0.041 * sinDeg(anomaly - sun.meanAnomaly) -
    0.035 * sinDeg(elongation) -
    0.031 * sinDeg(anomaly + sun.meanAnomaly) -
    0.015 * sinDeg(2 * argumentLatitude - 2 * elongation) +
    0.011 * sinDeg(anomaly - 4 * elongation);
  return norm(longitude);
}

export function longitudeAt(key: PlanetKey, julianDay: number): number {
  const d = julianDay - 2451543.5;
  const sun = sunPosition(d);
  if (key === 'sun') return sun.longitude;
  if (key === 'moon') return moonLongitude(d, sun);
  const helio = orbitalPosition(elementsFor(key, d));
  return norm(atan2Deg(helio.y + sun.y, helio.x + sun.x));
}

function signedDelta(to: number, from: number): number {
  return ((to - from + 540) % 360) - 180;
}

export function julianFromBirth(input: BirthData): { julianDay: number; utcIso: string } {
  const [year, month, day] = input.date.split('-').map(Number);
  const [hour = 0, minute = 0] = input.time.split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) throw new Error('Нужны корректные дата и время');
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - input.timezone * 3_600_000;
  const utc = new Date(utcMs);
  if (Number.isNaN(utc.getTime())) throw new Error('Не удалось собрать дату');
  return { julianDay: utcMs / 86_400_000 + 2440587.5, utcIso: utc.toISOString() };
}

export function anglesFor(julianDay: number, latitude: number, longitude: number): { ascendant: number; midheaven: number } {
  const T = (julianDay - 2451545) / 36525;
  const gmst = norm(280.46061837 + 360.98564736629 * (julianDay - 2451545) + 0.000387933 * T ** 2 - T ** 3 / 38710000);
  const sidereal = norm(gmst + longitude);
  const obliquity = 23.439291 - 0.0130042 * T;
  const safeLatitude = Math.max(-66, Math.min(66, latitude));
  const ascendant = norm(
    atan2Deg(
      -cosDeg(sidereal),
      sinDeg(obliquity) * Math.tan(safeLatitude * DEG) + cosDeg(obliquity) * sinDeg(sidereal),
    ) + 180,
  );
  const midheaven = norm(atan2Deg(sinDeg(sidereal), cosDeg(sidereal) * cosDeg(obliquity)));
  return { ascendant, midheaven };
}

function pointFor(key: PlanetKey, julianDay: number): AstroPoint {
  const longitude = longitudeAt(key, julianDay);
  const signIndex = Math.floor(longitude / 30) % 12;
  const withinSign = longitude % 30;
  const degree = Math.floor(withinSign);
  const minute = Math.floor((withinSign - degree) * 60);
  const speed = signedDelta(longitudeAt(key, julianDay + 0.5), longitudeAt(key, julianDay - 0.5));
  return {
    key,
    ...PLANETS[key],
    longitude,
    sign: ZODIAC[signIndex].name,
    signGlyph: ZODIAC[signIndex].glyph,
    signIndex,
    degree,
    minute,
    retrograde: !['sun', 'moon'].includes(key) && speed < 0,
  };
}

const ASPECTS = [
  { type: 'Соединение', glyph: '☌', angle: 0, orb: 8, tone: 'neutral' as const },
  { type: 'Секстиль', glyph: '⚹', angle: 60, orb: 4, tone: 'flow' as const },
  { type: 'Квадрат', glyph: '□', angle: 90, orb: 6, tone: 'tension' as const },
  { type: 'Тригон', glyph: '△', angle: 120, orb: 6, tone: 'flow' as const },
  { type: 'Оппозиция', glyph: '☍', angle: 180, orb: 8, tone: 'tension' as const },
];

function buildAspects(planets: AstroPoint[]): AstroAspect[] {
  const result: AstroAspect[] = [];
  for (let i = 0; i < planets.length; i += 1) {
    for (let j = i + 1; j < planets.length; j += 1) {
      const separation = Math.abs(signedDelta(planets[j].longitude, planets[i].longitude));
      for (const aspect of ASPECTS) {
        const orb = Math.abs(separation - aspect.angle);
        if (orb <= aspect.orb) {
          result.push({
            left: planets[i].key,
            right: planets[j].key,
            leftName: planets[i].name,
            rightName: planets[j].name,
            type: aspect.type,
            glyph: aspect.glyph,
            angle: aspect.angle,
            orb,
            tone: aspect.tone,
          });
          break;
        }
      }
    }
  }
  return result.sort((a, b) => a.orb - b.orb);
}

function dominant(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Смешанный';
}

export function calculateZet9Chart(input: BirthData): Zet9Chart {
  if (!input.date || !input.time) throw new Error('Укажи дату и точное время');
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) throw new Error('Широта должна быть от -90 до 90');
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) throw new Error('Долгота должна быть от -180 до 180');
  const { julianDay, utcIso } = julianFromBirth(input);
  const order: PlanetKey[] = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
  const planets = order.map((key) => pointFor(key, julianDay));
  const { ascendant, midheaven } = anglesFor(julianDay, input.latitude, input.longitude);
  const houses = Array.from({ length: 12 }, (_, index) => norm(ascendant + index * 30));
  const coreSigns = [...planets.slice(0, 7).map((planet) => planet.signIndex), Math.floor(ascendant / 30)];
  return {
    julianDay,
    utcIso,
    planets,
    houses,
    ascendant,
    midheaven,
    aspects: buildAspects(planets),
    dominantElement: dominant(coreSigns.map((index) => ZODIAC[index].element)),
    dominantMode: dominant(coreSigns.map((index) => ZODIAC[index].mode)),
  };
}

export function formatZodiacLongitude(longitude: number): string {
  const normalized = norm(longitude);
  const sign = ZODIAC[Math.floor(normalized / 30) % 12];
  const within = normalized % 30;
  const degree = Math.floor(within);
  const minute = Math.floor((within - degree) * 60);
  return `${degree}°${String(minute).padStart(2, '0')}′ ${sign.glyph} ${sign.name}`;
}

export function buildZet9Summary(input: BirthData, chart: Zet9Chart): string {
  const keyPlanets = chart.planets.slice(0, 7).map(
    (planet) => `${planet.name}: ${planet.degree}°${String(planet.minute).padStart(2, '0')}′ ${planet.sign}${planet.retrograde ? ' R' : ''}`,
  );
  return [
    `ZET9 Core: ${input.date} ${input.time} UTC${input.timezone >= 0 ? '+' : ''}${input.timezone}, ${input.place}.`,
    ...keyPlanets,
    `ASC: ${formatZodiacLongitude(chart.ascendant)}; MC: ${formatZodiacLongitude(chart.midheaven)}.`,
    `Доминанта: ${chart.dominantElement}, ${chart.dominantMode}.`,
    `Точные аспекты: ${chart.aspects.slice(0, 8).map((aspect) => `${aspect.leftName} ${aspect.glyph} ${aspect.rightName} (${aspect.orb.toFixed(1)}°)`).join(', ') || 'нет'}.`,
  ].join(' ');
}
