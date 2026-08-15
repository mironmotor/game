/**
 * Джйотиш — ведическая астрология. Не перевод западной карты, а другая система.
 *
 * Отличий три, и каждое меняет результат, а не подпись:
 *
 * ЗОДИАК СИДЕРИЧЕСКИЙ. Западная астрология считает от точки весеннего
 * равноденствия, которая из-за прецессии земной оси уползла от звёзд почти на
 * 24 градуса за две тысячи лет. Джйотиш считает от самих звёзд, поэтому из
 * тропической долготы вычитается аянамша — накопленный сдвиг. На практике это
 * значит, что большинство людей здесь оказываются в предыдущем знаке.
 *
 * ДЕВЯТЬ ГРАХ, А НЕ ДЕСЯТЬ ПЛАНЕТ. Урана, Нептуна и Плутона в джйотише нет —
 * их не видно глазом, и традиция их не знает. Зато обязательны Раху и Кету,
 * лунные узлы: точки пересечения орбиты Луны с эклиптикой, где случаются
 * затмения. Это не тела, а места, и движутся они назад.
 *
 * НАКШАТРЫ И ДАШИ. Кроме двенадцати знаков небо делится на 27 лунных стоянок
 * по 13°20'. Накшатра Луны при рождении задаёт вимшоттари-дашу — расписание
 * планетных периодов на 120 лет вперёд. Именно даши, а не аспекты, отвечают в
 * джйотише на вопрос «когда».
 *
 * Эфемериды берутся из zet9-engine: положения планет от системы координат не
 * зависят, считать их заново было бы дублированием.
 */

import { anglesFor, julianFromBirth, longitudeAt, norm, type BirthData } from '@/lib/zet9-engine';

export type { BirthData };

export type GrahaKey =
  | 'sun'
  | 'moon'
  | 'mars'
  | 'mercury'
  | 'jupiter'
  | 'venus'
  | 'saturn'
  | 'rahu'
  | 'ketu';

export const GRAHAS: Record<GrahaKey, { name: string; sanskrit: string; glyph: string }> = {
  sun: { name: 'Солнце', sanskrit: 'Сурья', glyph: '☉' },
  moon: { name: 'Луна', sanskrit: 'Чандра', glyph: '☽' },
  mars: { name: 'Марс', sanskrit: 'Мангала', glyph: '♂' },
  mercury: { name: 'Меркурий', sanskrit: 'Будха', glyph: '☿' },
  jupiter: { name: 'Юпитер', sanskrit: 'Гуру', glyph: '♃' },
  venus: { name: 'Венера', sanskrit: 'Шукра', glyph: '♀' },
  saturn: { name: 'Сатурн', sanskrit: 'Шани', glyph: '♄' },
  rahu: { name: 'Раху', sanskrit: 'Раху', glyph: '☊' },
  ketu: { name: 'Кету', sanskrit: 'Кету', glyph: '☋' },
};

/** Раши — знаки сидерического зодиака. */
export const RASHIS = [
  { name: 'Меша', ru: 'Овен', element: 'Огонь', lord: 'mars' },
  { name: 'Вришабха', ru: 'Телец', element: 'Земля', lord: 'venus' },
  { name: 'Митхуна', ru: 'Близнецы', element: 'Воздух', lord: 'mercury' },
  { name: 'Карка', ru: 'Рак', element: 'Вода', lord: 'moon' },
  { name: 'Симха', ru: 'Лев', element: 'Огонь', lord: 'sun' },
  { name: 'Канья', ru: 'Дева', element: 'Земля', lord: 'mercury' },
  { name: 'Тула', ru: 'Весы', element: 'Воздух', lord: 'venus' },
  { name: 'Вришчика', ru: 'Скорпион', element: 'Вода', lord: 'mars' },
  { name: 'Дхану', ru: 'Стрелец', element: 'Огонь', lord: 'jupiter' },
  { name: 'Макара', ru: 'Козерог', element: 'Земля', lord: 'saturn' },
  { name: 'Кумбха', ru: 'Водолей', element: 'Воздух', lord: 'saturn' },
  { name: 'Мина', ru: 'Рыбы', element: 'Вода', lord: 'jupiter' },
] as const;

/**
 * 27 накшатр. Владелец задаёт порядок вимшоттари-даши и повторяется циклом
 * из девяти — поэтому по накшатре Луны сразу известно, какой период идёт.
 */
export const NAKSHATRAS: Array<{ name: string; ru: string; lord: GrahaKey }> = [
  { name: 'Ашвини', ru: 'всадники-целители', lord: 'ketu' },
  { name: 'Бхарани', ru: 'несущая', lord: 'venus' },
  { name: 'Криттика', ru: 'режущая', lord: 'sun' },
  { name: 'Рохини', ru: 'растущая', lord: 'moon' },
  { name: 'Мригашира', ru: 'голова оленя', lord: 'mars' },
  { name: 'Ардра', ru: 'влажная', lord: 'rahu' },
  { name: 'Пунарвасу', ru: 'вновь светлая', lord: 'jupiter' },
  { name: 'Пушья', ru: 'питающая', lord: 'saturn' },
  { name: 'Ашлеша', ru: 'обвивающая', lord: 'mercury' },
  { name: 'Магха', ru: 'великая', lord: 'ketu' },
  { name: 'Пурва Пхалгуни', ru: 'ранняя красная', lord: 'venus' },
  { name: 'Уттара Пхалгуни', ru: 'поздняя красная', lord: 'sun' },
  { name: 'Хаста', ru: 'ладонь', lord: 'moon' },
  { name: 'Читра', ru: 'сияющая', lord: 'mars' },
  { name: 'Свати', ru: 'самостоятельная', lord: 'rahu' },
  { name: 'Вишакха', ru: 'разветвлённая', lord: 'jupiter' },
  { name: 'Анурадха', ru: 'следующая за', lord: 'saturn' },
  { name: 'Джьештха', ru: 'старшая', lord: 'mercury' },
  { name: 'Мула', ru: 'корень', lord: 'ketu' },
  { name: 'Пурва Ашадха', ru: 'ранняя непобедимая', lord: 'venus' },
  { name: 'Уттара Ашадха', ru: 'поздняя непобедимая', lord: 'sun' },
  { name: 'Шравана', ru: 'слышащая', lord: 'moon' },
  { name: 'Дхаништха', ru: 'богатейшая', lord: 'mars' },
  { name: 'Шатабхиша', ru: 'сто целителей', lord: 'rahu' },
  { name: 'Пурва Бхадрапада', ru: 'ранняя счастливая', lord: 'jupiter' },
  { name: 'Уттара Бхадрапада', ru: 'поздняя счастливая', lord: 'saturn' },
  { name: 'Ревати', ru: 'богатая', lord: 'mercury' },
];

/** Длительности вимшоттари-даши в годах. Сумма — ровно 120. */
export const DASHA_YEARS: Record<GrahaKey, number> = {
  ketu: 7,
  venus: 20,
  sun: 6,
  moon: 10,
  mars: 7,
  rahu: 18,
  jupiter: 16,
  saturn: 19,
  mercury: 17,
};

const DASHA_ORDER: GrahaKey[] = ['ketu', 'venus', 'sun', 'moon', 'mars', 'rahu', 'jupiter', 'saturn', 'mercury'];

const NAKSHATRA_ARC = 360 / 27; // 13°20'
const PADA_ARC = NAKSHATRA_ARC / 4; // 3°20'

/**
 * Аянамша Лахири — официальная в Индии и самая распространённая.
 *
 * Считается линейно от эпохи J2000: на 1 января 2000 года сдвиг составлял
 * 23°51'23", и растёт примерно на 50.29 угловой секунды в год. Линейного
 * приближения здесь достаточно: расхождение с точным значением набирает
 * секунды дуги за столетие, а знак и накшатра меняются на градусах.
 */
export function ayanamsa(julianDay: number): number {
  const yearsFromJ2000 = (julianDay - 2451545) / 365.25;
  return 23.85639 + 0.0139528 * yearsFromJ2000;
}

/** Средний лунный узел — Раху. Кету всегда напротив. */
function rahuLongitude(julianDay: number): number {
  const T = (julianDay - 2451545) / 36525;
  // Средняя долгота восходящего узла: движется назад, отсюда минус.
  return norm(125.0445479 - 1934.1362891 * T + 0.0020754 * T ** 2 + T ** 3 / 467441);
}

export interface Graha {
  key: GrahaKey;
  name: string;
  sanskrit: string;
  glyph: string;
  longitude: number;
  rashiIndex: number;
  rashi: string;
  rashiRu: string;
  degree: number;
  minute: number;
  nakshatraIndex: number;
  nakshatra: string;
  nakshatraLord: GrahaKey;
  pada: number;
  house: number;
  retrograde: boolean;
}

export interface DashaPeriod {
  lord: GrahaKey;
  name: string;
  startIso: string;
  endIso: string;
  years: number;
  current: boolean;
}

export interface JyotishChart {
  julianDay: number;
  utcIso: string;
  ayanamsa: number;
  lagnaLongitude: number;
  lagnaRashiIndex: number;
  grahas: Graha[];
  dashas: DashaPeriod[];
  currentDasha: DashaPeriod | null;
  moonNakshatra: { index: number; name: string; ru: string; lord: GrahaKey; pada: number };
}

function placeIn(siderealLongitude: number, lagnaRashiIndex: number) {
  const rashiIndex = Math.floor(siderealLongitude / 30) % 12;
  const within = siderealLongitude % 30;
  const nakshatraIndex = Math.floor(siderealLongitude / NAKSHATRA_ARC) % 27;
  const pada = Math.floor((siderealLongitude % NAKSHATRA_ARC) / PADA_ARC) + 1;
  // Дома цельнознаковые: в джйотише знак лагны целиком и есть первый дом,
  // без деления по градусам — так считает классическая традиция.
  const house = ((rashiIndex - lagnaRashiIndex + 12) % 12) + 1;
  return {
    rashiIndex,
    degree: Math.floor(within),
    minute: Math.floor((within - Math.floor(within)) * 60),
    nakshatraIndex,
    pada,
    house,
  };
}

/**
 * Вимшоттари-даша от накшатры Луны.
 *
 * Луна на момент рождения стоит где-то внутри своей накшатры, и пройденная
 * часть — это уже израсходованная доля периода её владельца. Отсюда «баланс»:
 * первый период всегда неполный, и именно он определяет, куда попадут все
 * последующие. Ошибка в минутах рождения сдвигает всю цепочку на месяцы.
 */
function buildDashas(moonLongitude: number, birthIso: string): DashaPeriod[] {
  const nakshatraIndex = Math.floor(moonLongitude / NAKSHATRA_ARC) % 27;
  const startLord = NAKSHATRAS[nakshatraIndex].lord;
  const traversed = (moonLongitude % NAKSHATRA_ARC) / NAKSHATRA_ARC;

  const startIdx = DASHA_ORDER.indexOf(startLord);
  const birth = new Date(birthIso).getTime();
  const now = Date.now();
  const YEAR_MS = 365.2425 * 24 * 3600 * 1000;

  const out: DashaPeriod[] = [];
  let cursor = birth - traversed * DASHA_YEARS[startLord] * YEAR_MS;
  for (let i = 0; i < 9; i += 1) {
    const lord = DASHA_ORDER[(startIdx + i) % 9];
    const years = DASHA_YEARS[lord];
    const start = cursor;
    const end = cursor + years * YEAR_MS;
    out.push({
      lord,
      name: GRAHAS[lord].name,
      startIso: new Date(start).toISOString(),
      endIso: new Date(end).toISOString(),
      years,
      current: now >= start && now < end,
    });
    cursor = end;
  }
  return out;
}

export function calculateJyotishChart(input: BirthData): JyotishChart {
  if (!input.date || !input.time) throw new Error('Укажи дату и точное время рождения');
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
    throw new Error('Широта должна быть от -90 до 90');
  }
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    throw new Error('Долгота должна быть от -180 до 180');
  }

  const { julianDay, utcIso } = julianFromBirth(input);
  const shift = ayanamsa(julianDay);
  const { ascendant } = anglesFor(julianDay, input.latitude, input.longitude);

  const lagna = norm(ascendant - shift);
  const lagnaRashiIndex = Math.floor(lagna / 30) % 12;

  const visible: Array<{ key: GrahaKey; tropical: number }> = [
    { key: 'sun', tropical: longitudeAt('sun', julianDay) },
    { key: 'moon', tropical: longitudeAt('moon', julianDay) },
    { key: 'mars', tropical: longitudeAt('mars', julianDay) },
    { key: 'mercury', tropical: longitudeAt('mercury', julianDay) },
    { key: 'jupiter', tropical: longitudeAt('jupiter', julianDay) },
    { key: 'venus', tropical: longitudeAt('venus', julianDay) },
    { key: 'saturn', tropical: longitudeAt('saturn', julianDay) },
  ];

  const rahu = rahuLongitude(julianDay);
  visible.push({ key: 'rahu', tropical: rahu });
  visible.push({ key: 'ketu', tropical: norm(rahu + 180) });

  const grahas: Graha[] = visible.map(({ key, tropical }) => {
    const sidereal = norm(tropical - shift);
    const placed = placeIn(sidereal, lagnaRashiIndex);
    const meta = GRAHAS[key];
    return {
      key,
      name: meta.name,
      sanskrit: meta.sanskrit,
      glyph: meta.glyph,
      longitude: sidereal,
      rashi: RASHIS[placed.rashiIndex].name,
      rashiRu: RASHIS[placed.rashiIndex].ru,
      rashiIndex: placed.rashiIndex,
      degree: placed.degree,
      minute: placed.minute,
      nakshatraIndex: placed.nakshatraIndex,
      nakshatra: NAKSHATRAS[placed.nakshatraIndex].name,
      nakshatraLord: NAKSHATRAS[placed.nakshatraIndex].lord,
      pada: placed.pada,
      house: placed.house,
      // Узлы всегда идут назад — это свойство самих узлов, а не видимости.
      retrograde: key === 'rahu' || key === 'ketu',
    };
  });

  const moon = grahas.find((g) => g.key === 'moon')!;
  const dashas = buildDashas(moon.longitude, utcIso);

  return {
    julianDay,
    utcIso,
    ayanamsa: shift,
    lagnaLongitude: lagna,
    lagnaRashiIndex,
    grahas,
    dashas,
    currentDasha: dashas.find((d) => d.current) ?? null,
    moonNakshatra: {
      index: moon.nakshatraIndex,
      name: NAKSHATRAS[moon.nakshatraIndex].name,
      ru: NAKSHATRAS[moon.nakshatraIndex].ru,
      lord: NAKSHATRAS[moon.nakshatraIndex].lord,
      pada: moon.pada,
    },
  };
}

export function formatSidereal(longitude: number): string {
  const value = norm(longitude);
  const rashi = RASHIS[Math.floor(value / 30) % 12];
  const within = value % 30;
  const degree = Math.floor(within);
  const minute = Math.floor((within - degree) * 60);
  return `${degree}°${String(minute).padStart(2, '0')}' ${rashi.name}`;
}

/** Сводка для ядра MAX: только посчитанное, без толкований. */
export function buildJyotishSummary(input: BirthData, chart: JyotishChart): string {
  const lines = [
    `Ведическая карта · ${input.place || 'без места'} · ${input.date} ${input.time}`,
    `Аянамша (Лахири): ${chart.ayanamsa.toFixed(3)}°`,
    `Лагна: ${formatSidereal(chart.lagnaLongitude)} (${RASHIS[chart.lagnaRashiIndex].ru})`,
    `Накшатра Луны: ${chart.moonNakshatra.name}, пада ${chart.moonNakshatra.pada}, владелец ${GRAHAS[chart.moonNakshatra.lord].name}`,
  ];
  if (chart.currentDasha) {
    const end = new Date(chart.currentDasha.endIso).toISOString().slice(0, 10);
    lines.push(`Текущая махадаша: ${chart.currentDasha.name}, до ${end}`);
  }
  lines.push('Грахи:');
  for (const g of chart.grahas) {
    lines.push(
      `  ${g.glyph} ${g.name} — ${g.degree}°${String(g.minute).padStart(2, '0')}' ${g.rashi}` +
        `, дом ${g.house}, накшатра ${g.nakshatra} (пада ${g.pada})${g.retrograde ? ', ретро' : ''}`,
    );
  }
  return lines.join('\n');
}
