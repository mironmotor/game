'use client';

/**
 * Ведическая карта (джйотиш) вместо западной ZET9.
 *
 * Карта рисуется квадратом, а не колесом, и это не стилизация: в Индии её так
 * и чертят. Стилей два, и они переключаются, потому что читают по-разному.
 *
 * СЕВЕРНАЯ (по умолчанию) — ромбами. На местах стоят ДОМА: верхний ромб всегда
 * первый, дальше против часовой стрелки. Знаки при этом переезжают, поэтому в
 * каждой ячейке подписан их номер — без него карту не прочесть.
 *
 * ЮЖНАЯ — квадратами. Наоборот: знаки прибиты к своим местам, а дома считаются
 * от лагны. Спор о том, какая правильнее, идёт веками; обе показывают одно и
 * то же небо, и выбор — дело привычки, а не точности.
 *
 * Расчёт живёт в lib/jyotish-engine.ts и идёт целиком в браузере — дата
 * рождения никуда не отправляется, пока человек сам не нажмёт «записать в
 * память MAX».
 */

import { useMemo, useState } from 'react';
import { Loader2, MapPin, RefreshCw, Sparkles, Star } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';
import {
  buildJyotishSummary,
  calculateJyotishChart,
  formatSidereal,
  GRAHAS,
  RASHIS,
  type BirthData,
  type JyotishChart,
} from '@/lib/jyotish-engine';

interface PlacePreset {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  timezone: number;
  timeZone: string;
}

const PLACES: PlacePreset[] = [
  { id: 'tolyatti', label: 'Тольятти · Самарская область', latitude: 53.5303, longitude: 49.3461, timezone: 4, timeZone: 'Europe/Samara' },
  { id: 'denpasar', label: 'Бали / Денпасар', latitude: -8.65, longitude: 115.2167, timezone: 8, timeZone: 'Asia/Makassar' },
  { id: 'moscow', label: 'Москва', latitude: 55.7558, longitude: 37.6173, timezone: 3, timeZone: 'Europe/Moscow' },
  { id: 'delhi', label: 'Дели', latitude: 28.6139, longitude: 77.209, timezone: 5.5, timeZone: 'Asia/Kolkata' },
  { id: 'almaty', label: 'Алматы', latitude: 43.2389, longitude: 76.8897, timezone: 5, timeZone: 'Asia/Almaty' },
  { id: 'new-york', label: 'Нью-Йорк', latitude: 40.7128, longitude: -74.006, timezone: -4, timeZone: 'America/New_York' },
];

/**
 * Южноиндийская сетка: знак всегда на своём месте, меняются только планеты.
 * Овен вторая клетка сверху слева, дальше по часовой стрелке.
 */
const GRID: Array<{ rashi: number; row: number; col: number }> = [
  { rashi: 11, row: 0, col: 0 }, { rashi: 0, row: 0, col: 1 }, { rashi: 1, row: 0, col: 2 }, { rashi: 2, row: 0, col: 3 },
  { rashi: 10, row: 1, col: 0 }, { rashi: 3, row: 1, col: 3 },
  { rashi: 9, row: 2, col: 0 }, { rashi: 4, row: 2, col: 3 },
  { rashi: 8, row: 3, col: 0 }, { rashi: 7, row: 3, col: 1 }, { rashi: 6, row: 3, col: 2 }, { rashi: 5, row: 3, col: 3 },
];

function zonedParts(at: Date, timeZone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(
    formatter.formatToParts(at)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
}

/** Смещение зоны на конкретную дату — иначе летнее время сдвинет карту на час. */
function zoneOffsetForLocalTime(timeZone: string, date: string, time: string, fallback: number): number {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return fallback;
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let utcGuess = localAsUtc;
  let offset = fallback;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = zonedParts(new Date(utcGuess), timeZone);
    const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    offset = (representedAsUtc - utcGuess) / 3_600_000;
    utcGuess = localAsUtc - offset * 3_600_000;
  }
  return Math.round(offset * 4) / 4;
}

function initialBirthData(): BirthData {
  const home = PLACES[0];
  const now = zonedParts(new Date(), home.timeZone);
  const date = `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;
  const time = `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`;
  return {
    date,
    time,
    timezone: zoneOffsetForLocalTime(home.timeZone, date, time, home.timezone),
    latitude: home.latitude,
    longitude: home.longitude,
    place: home.label,
  };
}

/**
 * Северная карта — ромбами. Здесь на местах стоят ДОМА, а знаки переезжают:
 * верхний ромб всегда первый дом, дальше против часовой стрелки. Поэтому в
 * каждой ячейке подписан номер знака — без него карту не прочесть, ведь
 * геометрия про дома ничего о знаках не говорит.
 *
 * В южной наоборот: знаки прибиты к местам, а дома считаются от лагны. Обе
 * читают одну и ту же карту, спор о том, какая правильнее, идёт веками, и
 * выбор здесь — дело привычки, а не точности.
 *
 * Разметка классическая: квадрат, обе диагонали и ромб по серединам сторон.
 * Двенадцать областей — четыре ромба по сторонам и восемь треугольников.
 */
const NORTH_CELLS: Array<{ house: number; points: string; label: [number, number] }> = [
  { house: 1, points: '50,0 75,25 50,50 25,25', label: [50, 22] },
  { house: 2, points: '50,0 25,25 0,0', label: [25, 11] },
  { house: 3, points: '0,0 25,25 0,50', label: [10, 26] },
  { house: 4, points: '0,50 25,25 50,50 25,75', label: [22, 50] },
  { house: 5, points: '0,50 25,75 0,100', label: [10, 74] },
  { house: 6, points: '0,100 25,75 50,100', label: [25, 89] },
  { house: 7, points: '50,100 25,75 50,50 75,75', label: [50, 78] },
  { house: 8, points: '50,100 75,75 100,100', label: [75, 89] },
  { house: 9, points: '100,100 75,75 100,50', label: [90, 74] },
  { house: 10, points: '100,50 75,75 50,50 75,25', label: [78, 50] },
  { house: 11, points: '100,50 75,25 100,0', label: [90, 26] },
  { house: 12, points: '100,0 75,25 50,0', label: [75, 11] },
];

function NorthChart({ chart }: { chart: JyotishChart }) {
  const byHouse = useMemo(() => {
    const map = new Map<number, JyotishChart['grahas']>();
    for (const g of chart.grahas) {
      const list = map.get(g.house) ?? [];
      list.push(g);
      map.set(g.house, list);
    }
    return map;
  }, [chart]);

  return (
    <svg viewBox="-2 -2 104 104" className="aspect-square w-full rounded-2xl bg-[#0b0713]" role="img" aria-label="Ведическая карта, северный стиль">
      <rect x="0" y="0" width="100" height="100" fill="none" stroke="rgba(251,191,36,0.35)" strokeWidth="0.6" />
      <line x1="0" y1="0" x2="100" y2="100" stroke="rgba(251,191,36,0.25)" strokeWidth="0.4" />
      <line x1="100" y1="0" x2="0" y2="100" stroke="rgba(251,191,36,0.25)" strokeWidth="0.4" />
      <polygon points="50,0 100,50 50,100 0,50" fill="none" stroke="rgba(251,191,36,0.3)" strokeWidth="0.4" />

      {NORTH_CELLS.map((cell) => {
        // Знак в доме: от лагны по кругу — первый дом это знак лагны.
        const rashiIndex = (chart.lagnaRashiIndex + cell.house - 1) % 12;
        const here = byHouse.get(cell.house) ?? [];
        const isLagna = cell.house === 1;
        return (
          <g key={cell.house}>
            {isLagna && <polygon points={cell.points} fill="rgba(251,191,36,0.07)" />}
            <text x={cell.label[0]} y={cell.label[1]} textAnchor="middle" fontSize="3.4" fill="rgba(255,255,255,0.32)">
              {rashiIndex + 1}
            </text>
            {here.map((g, i) => (
              <text
                key={g.key}
                x={cell.label[0]}
                y={cell.label[1] + 4.6 + i * 4.2}
                textAnchor="middle"
                fontSize="3.9"
                fill={g.retrograde ? '#fda4af' : '#fde68a'}
              >
                {g.glyph}
                <tspan fontSize="2.6" fill="rgba(255,255,255,0.4)"> {g.degree}</tspan>
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function RashiChart({ chart }: { chart: JyotishChart }) {
  const byRashi = useMemo(() => {
    const map = new Map<number, JyotishChart['grahas']>();
    for (const g of chart.grahas) {
      const list = map.get(g.rashiIndex) ?? [];
      list.push(g);
      map.set(g.rashiIndex, list);
    }
    return map;
  }, [chart]);

  return (
    <div className="grid aspect-square w-full grid-cols-4 grid-rows-4 gap-px rounded-2xl bg-amber-400/20 p-px">
      {Array.from({ length: 16 }, (_, i) => {
        const row = Math.floor(i / 4);
        const col = i % 4;
        const cell = GRID.find((c) => c.row === row && c.col === col);
        if (!cell) {
          // Центр карты пуст по традиции — там пишут имя и время рождения.
          if (row === 1 && col === 1) {
            return (
              <div key={i} className="col-span-2 row-span-2 flex flex-col items-center justify-center bg-[#0b0713] text-center">
                <Star className="mb-1 h-4 w-4 text-amber-300/70" />
                <div className="text-[10px] uppercase tracking-widest text-amber-300/60">Лагна</div>
                <div className="text-sm font-semibold text-amber-100">{RASHIS[chart.lagnaRashiIndex].name}</div>
                <div className="text-[10px] text-white/40">{RASHIS[chart.lagnaRashiIndex].ru}</div>
                <div className="mt-1 text-[9px] text-white/30">аянамша {chart.ayanamsa.toFixed(2)}°</div>
              </div>
            );
          }
          return null;
        }
        const isLagna = cell.rashi === chart.lagnaRashiIndex;
        const here = byRashi.get(cell.rashi) ?? [];
        return (
          <div
            key={i}
            className={`relative flex flex-col gap-0.5 bg-[#0b0713] p-1 ${isLagna ? 'ring-1 ring-inset ring-amber-400/70' : ''}`}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-[9px] text-white/35">{RASHIS[cell.rashi].name}</span>
              {isLagna && <span className="text-[8px] font-bold text-amber-300">ЛГ</span>}
            </div>
            <div className="flex flex-wrap gap-x-1 gap-y-0.5">
              {here.map((g) => (
                <span
                  key={g.key}
                  title={`${g.name} · ${g.degree}°${String(g.minute).padStart(2, '0')}' · ${g.nakshatra} пада ${g.pada}`}
                  className={`text-[11px] font-semibold ${g.retrograde ? 'text-rose-300' : 'text-amber-100'}`}
                >
                  {g.glyph}
                  <span className="ml-0.5 text-[8px] text-white/40">{g.degree}</span>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function JyotishPanel() {
  const [birth, setBirth] = useState<BirthData>(initialBirthData);
  const [placeId, setPlaceId] = useState(PLACES[0].id);
  const [style, setStyle] = useState<'north' | 'south'>('north');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const chart = useMemo(() => {
    try {
      return { ok: true as const, value: calculateJyotishChart(birth) };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : 'Не удалось построить карту' };
    }
  }, [birth]);

  function choosePlace(id: string) {
    const place = PLACES.find((p) => p.id === id);
    if (!place) return;
    setPlaceId(id);
    setBirth((prev) => ({
      ...prev,
      latitude: place.latitude,
      longitude: place.longitude,
      place: place.label,
      timezone: zoneOffsetForLocalTime(place.timeZone, prev.date, prev.time, place.timezone),
    }));
  }

  function patch(part: Partial<BirthData>) {
    setBirth((prev) => {
      const next = { ...prev, ...part };
      const place = PLACES.find((p) => p.id === placeId);
      if (place && (part.date || part.time)) {
        next.timezone = zoneOffsetForLocalTime(place.timeZone, next.date, next.time, place.timezone);
      }
      return next;
    });
  }

  async function remember() {
    if (!chart.ok || busy) return;
    setBusy(true);
    setNote('');
    try {
      const summary = buildJyotishSummary(birth, chart.value);
      await sendMax17Event({ type: 'memory_store', text: summary, source: 'godmode_jyotish' });
      setNote('Карта записана в память MAX17');
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Не удалось записать карту');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-1.5 sm:grid-cols-2">
        <label className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">
          <span className="text-[10px] uppercase tracking-widest text-white/35">дата</span>
          <input
            type="date"
            value={birth.date}
            onChange={(e) => patch({ date: e.target.value })}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-white/85 outline-none"
          />
        </label>
        <label className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">
          <span className="text-[10px] uppercase tracking-widest text-white/35">время</span>
          <input
            type="time"
            value={birth.time}
            onChange={(e) => patch({ time: e.target.value })}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-white/85 outline-none"
          />
        </label>
      </div>

      <label className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">
        <MapPin className="h-3.5 w-3.5 flex-none text-amber-300/70" />
        <select
          value={placeId}
          onChange={(e) => choosePlace(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-white/85 outline-none [&>option]:bg-[#0b0713]"
        >
          {PLACES.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <span className="flex-none text-[10px] text-white/30">UTC{birth.timezone >= 0 ? '+' : ''}{birth.timezone}</span>
      </label>

      {!chart.ok && (
        <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-2 text-[11px] text-rose-200">{chart.error}</div>
      )}

      {chart.ok && (
        <>
          <div className="flex gap-1">
            {(['north', 'south'] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setStyle(id)}
                className={`flex-1 rounded-lg border px-2 py-1 text-[11px] transition ${
                  style === id
                    ? 'border-amber-400/60 bg-amber-400/15 text-amber-100'
                    : 'border-white/10 bg-white/[0.03] text-white/45 hover:bg-white/10'
                }`}
              >
                {id === 'north' ? 'Северная · ромбы' : 'Южная · квадраты'}
              </button>
            ))}
          </div>

          {style === 'north' ? <NorthChart chart={chart.value} /> : <RashiChart chart={chart.value} />}

          <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-2">
            <div className="text-[10px] uppercase tracking-widest text-amber-300/60">Накшатра Луны</div>
            <div className="text-sm font-semibold text-amber-100">
              {chart.value.moonNakshatra.name} · пада {chart.value.moonNakshatra.pada}
            </div>
            <div className="text-[11px] text-white/45">
              {chart.value.moonNakshatra.ru} · владелец {GRAHAS[chart.value.moonNakshatra.lord].name}
            </div>
          </div>

          {chart.value.currentDasha && (
            <div className="rounded-lg border border-violet-400/25 bg-violet-400/[0.06] p-2">
              <div className="text-[10px] uppercase tracking-widest text-violet-300/60">Идёт махадаша</div>
              <div className="text-sm font-semibold text-violet-100">
                {chart.value.currentDasha.name} · {chart.value.currentDasha.years} лет
              </div>
              <div className="text-[11px] text-white/45">
                до {new Date(chart.value.currentDasha.endIso).toLocaleDateString('ru-RU')}
              </div>
            </div>
          )}

          <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.02] p-2">
            {chart.value.grahas.map((g) => (
              <div key={g.key} className="flex items-center gap-1.5 text-[11px]">
                <span className="w-4 flex-none text-amber-200">{g.glyph}</span>
                <span className="w-20 flex-none text-white/70">{g.name}</span>
                <span className="w-24 flex-none font-mono text-white/50">
                  {g.degree}°{String(g.minute).padStart(2, '0')}&apos;
                </span>
                <span className="min-w-0 flex-1 truncate text-white/45">{g.rashi} · {g.nakshatra}</span>
                <span className="flex-none text-white/30">д{g.house}</span>
                {g.retrograde && <span className="flex-none text-rose-300/70">R</span>}
              </div>
            ))}
          </div>

          <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-lg border border-white/10 bg-white/[0.02] p-2">
            <div className="mb-1 text-[10px] uppercase tracking-widest text-white/35">Вимшоттари · 120 лет</div>
            {chart.value.dashas.map((d) => (
              <div
                key={d.lord + d.startIso}
                className={`flex items-center gap-2 text-[11px] ${d.current ? 'text-violet-200' : 'text-white/40'}`}
              >
                <span className="w-20 flex-none">{d.name}</span>
                <span className="flex-none font-mono">{d.years}л</span>
                <span className="min-w-0 flex-1 truncate">
                  {new Date(d.startIso).getFullYear()} — {new Date(d.endIso).getFullYear()}
                </span>
                {d.current && <span className="flex-none text-[9px] font-bold">СЕЙЧАС</span>}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void remember()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-amber-400/90 px-3 py-1.5 text-[12px] font-semibold text-amber-950 transition hover:bg-amber-300 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Записать в память MAX
            </button>
            <button
              type="button"
              onClick={() => setBirth(initialBirthData())}
              className="rounded-lg border border-white/10 px-2 py-1.5 text-white/50 transition hover:bg-white/10"
              title="Сбросить на сейчас"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            {note && <span className="text-[11px] text-white/50">{note}</span>}
          </div>

          <div className="text-[10px] leading-relaxed text-white/30">
            Сидерический зодиак, аянамша Лахири {chart.value.ayanamsa.toFixed(3)}°. Дома цельнознаковые от лагны.
            Раху и Кету — лунные узлы, всегда напротив друг друга и всегда ретроградны.
            Расчёт идёт в браузере: дата рождения никуда не уходит, пока не нажмёшь «записать».
          </div>
        </>
      )}
    </div>
  );
}
