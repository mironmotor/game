'use client';

import { useMemo, useState } from 'react';
import { Brain, ChevronDown, ChevronUp, Loader2, MapPin, Orbit, RefreshCw, Sparkles } from 'lucide-react';
import { sendMax17Event } from '@/lib/max17-client';
import {
  buildZet9Summary,
  calculateZet9Chart,
  formatZodiacLongitude,
  PLANETS,
  ZODIAC,
  type BirthData,
  type PlanetKey,
  type Zet9Chart,
} from '@/lib/zet9-engine';

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
  { id: 'almaty', label: 'Алматы', latitude: 43.2389, longitude: 76.8897, timezone: 5, timeZone: 'Asia/Almaty' },
  { id: 'kyiv', label: 'Киев', latitude: 50.4501, longitude: 30.5234, timezone: 3, timeZone: 'Europe/Kyiv' },
  { id: 'london', label: 'Лондон', latitude: 51.5072, longitude: -0.1276, timezone: 1, timeZone: 'Europe/London' },
  { id: 'new-york', label: 'Нью-Йорк', latitude: 40.7128, longitude: -74.006, timezone: -4, timeZone: 'America/New_York' },
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

function polar(longitude: number, radius: number, ascendant: number): { x: number; y: number } {
  const angle = (180 - (longitude - ascendant)) * (Math.PI / 180);
  return { x: 180 + Math.cos(angle) * radius, y: 180 - Math.sin(angle) * radius };
}

function aspectColor(tone: 'flow' | 'tension' | 'neutral'): string {
  if (tone === 'flow') return '#46e6b0';
  if (tone === 'tension') return '#ff668f';
  return '#b998ff';
}

function ZodiacWheel({ chart }: { chart: Zet9Chart }) {
  return (
    <svg
      viewBox="0 0 360 360"
      role="img"
      aria-label="Натальная карта ZET9"
      data-testid="zet9-wheel"
      className="aspect-square w-full rounded-2xl bg-[radial-gradient(circle_at_center,rgba(114,65,180,0.16),rgba(2,3,14,0.92)_70%)]"
    >
      <defs>
        <filter id="zet9-glow">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id="zet9-core">
          <stop offset="0%" stopColor="#fff2b0" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#d666ff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#4d2c9e" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="180" cy="180" r="158" fill="none" stroke="#a87aff" strokeOpacity="0.36" strokeWidth="1.5" />
      <circle cx="180" cy="180" r="134" fill="none" stroke="#8d67d5" strokeOpacity="0.42" />
      <circle cx="180" cy="180" r="96" fill="none" stroke="#8d67d5" strokeOpacity="0.32" />
      <circle cx="180" cy="180" r="55" fill="url(#zet9-core)" opacity="0.82" />

      {ZODIAC.map((sign, index) => {
        const edge = polar(index * 30, 158, chart.ascendant);
        const inner = polar(index * 30, 134, chart.ascendant);
        const label = polar(index * 30 + 15, 146, chart.ascendant);
        return (
          <g key={sign.name}>
            <line x1={inner.x} y1={inner.y} x2={edge.x} y2={edge.y} stroke="#c8a7ff" strokeOpacity="0.45" />
            <text x={label.x} y={label.y + 5} textAnchor="middle" fill="#decaff" fontSize="15">{sign.glyph}</text>
          </g>
        );
      })}

      {chart.houses.map((cusp, index) => {
        const outer = polar(cusp, 133, chart.ascendant);
        const inner = polar(cusp, 55, chart.ascendant);
        const label = polar(cusp + 15, 121, chart.ascendant);
        return (
          <g key={cusp}>
            <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke={index === 0 ? '#ffcf69' : '#7b65aa'} strokeOpacity={index === 0 ? 0.95 : 0.42} strokeWidth={index === 0 ? 1.7 : 0.75} />
            <text x={label.x} y={label.y + 3} textAnchor="middle" fill="#8f7fae" fontSize="8">{index + 1}</text>
          </g>
        );
      })}

      {chart.aspects.slice(0, 18).map((aspect) => {
        const left = chart.planets.find((planet) => planet.key === aspect.left);
        const right = chart.planets.find((planet) => planet.key === aspect.right);
        if (!left || !right) return null;
        const a = polar(left.longitude, 88, chart.ascendant);
        const b = polar(right.longitude, 88, chart.ascendant);
        return <line key={`${aspect.left}-${aspect.right}-${aspect.type}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={aspectColor(aspect.tone)} strokeOpacity="0.36" strokeWidth="0.8" />;
      })}

      {chart.planets.map((planet, index) => {
        const radius = 105 + (index % 2) * 12;
        const p = polar(planet.longitude, radius, chart.ascendant);
        return (
          <g key={planet.key} filter="url(#zet9-glow)">
            <circle cx={p.x} cy={p.y} r="10" fill="#100d25" stroke="#dba9ff" strokeOpacity="0.72" />
            <text x={p.x} y={p.y + 4.5} textAnchor="middle" fill="#f2ddff" fontSize="13">{planet.glyph}</text>
          </g>
        );
      })}

      <text x="180" y="176" textAnchor="middle" fill="#f4dcff" fontSize="14" fontWeight="700" letterSpacing="2">ZET9</text>
      <text x="180" y="191" textAnchor="middle" fill="#b99bd5" fontSize="8" letterSpacing="1.5">CORE · LOCAL</text>
      <text x="14" y="175" fill="#ffd47a" fontSize="9" fontWeight="700">ASC</text>
      <text x="180" y="14" textAnchor="middle" fill="#e5c7ff" fontSize="8">MC {formatZodiacLongitude(chart.midheaven).split(' ').slice(0, 2).join(' ')}</text>
    </svg>
  );
}

export default function Zet9Panel() {
  const [expanded, setExpanded] = useState(true);
  const [placeId, setPlaceId] = useState(PLACES[0].id);
  const [draft, setDraft] = useState<BirthData>(initialBirthData);
  const [profile, setProfile] = useState<BirthData>(draft);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  const chart = useMemo(() => calculateZet9Chart(profile), [profile]);

  function choosePlace(id: string) {
    const place = PLACES.find((item) => item.id === id);
    if (!place) return;
    setPlaceId(place.id);
    setDraft((current) => ({
      ...current,
      place: place.label,
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: zoneOffsetForLocalTime(place.timeZone, current.date, current.time, place.timezone),
    }));
  }

  function changeLocalDateTime(field: 'date' | 'time', value: string) {
    const place = PLACES.find((item) => item.id === placeId) ?? PLACES[0];
    setDraft((current) => {
      const next = { ...current, [field]: value };
      return {
        ...next,
        timezone: zoneOffsetForLocalTime(place.timeZone, next.date, next.time, place.timezone),
      };
    });
  }

  function calculate() {
    setError('');
    setNote('');
    try {
      calculateZet9Chart(draft);
      setProfile({ ...draft });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function rememberInCore() {
    if (saving) return;
    setSaving(true);
    setNote('');
    try {
      const summary = buildZet9Summary(profile, chart);
      await sendMax17Event({ type: 'memory_store', text: summary, source: 'godmode_zet9' });
      setNote('Карта записана в локальную память MAX17');
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Не удалось записать карту');
    } finally {
      setSaving(false);
    }
  }

  const bigThree = [
    chart.planets.find((planet) => planet.key === 'sun'),
    chart.planets.find((planet) => planet.key === 'moon'),
  ].filter(Boolean);

  return (
    <section data-testid="zet9-panel" className="overflow-hidden rounded-xl border border-violet-400/30 bg-[linear-gradient(145deg,rgba(80,40,126,0.17),rgba(9,8,26,0.82))] shadow-[inset_0_1px_rgba(255,255,255,0.04)]">
      <button
        type="button"
        data-testid="zet9-toggle"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-3 text-left transition hover:bg-violet-400/[0.06]"
      >
        <div className="grid h-9 w-9 place-items-center rounded-xl border border-violet-300/25 bg-violet-500/15 text-violet-200">
          <Orbit className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-violet-50">
            ZET9 Core
            <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[9px] uppercase tracking-wider text-emerald-200">локально</span>
          </div>
          <div className="text-[10px] text-white/40">Натальная карта · планеты · дома · аспекты</div>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[10px] text-violet-200/70">
          {expanded ? 'свернуть' : 'открыть карту'}
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-violet-400/15 p-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(280px,1.1fr)]">
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] uppercase tracking-wider text-white/45">
                  Дата рождения
                  <input type="date" value={draft.date} onChange={(event) => changeLocalDateTime('date', event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/35 px-2.5 py-2 text-xs normal-case text-white outline-none focus:border-violet-400/50" />
                </label>
                <label className="text-[10px] uppercase tracking-wider text-white/45">
                  Точное время
                  <input type="time" value={draft.time} onChange={(event) => changeLocalDateTime('time', event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/35 px-2.5 py-2 text-xs normal-case text-white outline-none focus:border-violet-400/50" />
                </label>
              </div>

              <label className="block text-[10px] uppercase tracking-wider text-white/45">
                <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> Место рождения</span>
                <select onChange={(event) => choosePlace(event.target.value)} value={placeId} className="mt-1 w-full rounded-lg border border-white/10 bg-black/35 px-2.5 py-2 text-xs normal-case text-white outline-none focus:border-violet-400/50">
                  {PLACES.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}
                </select>
              </label>

              <div className="grid grid-cols-3 gap-2">
                <label className="text-[9px] uppercase tracking-wider text-white/35">
                  Широта
                  <input type="number" step="0.0001" min="-90" max="90" value={draft.latitude} onChange={(event) => setDraft((current) => ({ ...current, latitude: Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-white/10 bg-black/35 px-2 py-1.5 text-xs normal-case text-white outline-none" />
                </label>
                <label className="text-[9px] uppercase tracking-wider text-white/35">
                  Долгота
                  <input type="number" step="0.0001" min="-180" max="180" value={draft.longitude} onChange={(event) => setDraft((current) => ({ ...current, longitude: Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-white/10 bg-black/35 px-2 py-1.5 text-xs normal-case text-white outline-none" />
                </label>
                <label className="text-[9px] uppercase tracking-wider text-white/35">
                  UTC
                  <input type="number" step="0.5" min="-12" max="14" value={draft.timezone} onChange={(event) => setDraft((current) => ({ ...current, timezone: Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-white/10 bg-black/35 px-2 py-1.5 text-xs normal-case text-white outline-none" />
                </label>
              </div>

              <div className="text-[9px] text-white/30">
                {PLACES.find((place) => place.id === placeId)?.timeZone} · исторический UTC вычисляется по дате рождения
              </div>

              <button type="button" data-testid="zet9-calculate" onClick={calculate} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-500/25 px-3 py-2 text-xs font-semibold text-violet-50 transition hover:bg-violet-400/40">
                <RefreshCw className="h-3.5 w-3.5" /> Рассчитать натальную карту
              </button>

              {error && <div className="rounded-lg border border-rose-400/20 bg-rose-400/10 px-2.5 py-2 text-[11px] text-rose-100">{error}</div>}

              <div className="grid grid-cols-3 gap-1.5">
                {bigThree.map((planet) => planet && (
                  <div key={planet.key} className="rounded-lg border border-white/8 bg-white/[0.035] p-2 text-center">
                    <div className="text-lg text-violet-200">{planet.glyph}</div>
                    <div className="text-[9px] text-white/35">{planet.name}</div>
                    <div className="text-[10px] font-medium text-white/75">{planet.signGlyph} {planet.sign}</div>
                  </div>
                ))}
                <div className="rounded-lg border border-white/8 bg-white/[0.035] p-2 text-center">
                  <div className="text-lg text-amber-200">ASC</div>
                  <div className="text-[9px] text-white/35">Асцендент</div>
                  <div className="text-[10px] font-medium text-white/75">{formatZodiacLongitude(chart.ascendant).split(' ').slice(1).join(' ')}</div>
                </div>
              </div>

              <div className="rounded-lg border border-white/8 bg-black/20 p-2.5 text-[10px] leading-relaxed text-white/50">
                <Sparkles className="mr-1 inline h-3 w-3 text-violet-300" />
                Доминанта: <span className="text-violet-100">{chart.dominantElement}</span> · {chart.dominantMode}. MC: {formatZodiacLongitude(chart.midheaven)}.
              </div>
            </div>

            <div className="min-w-0">
              <ZodiacWheel chart={chart} />
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-white/8 bg-black/20 p-2.5">
              <div className="mb-2 text-[10px] uppercase tracking-widest text-violet-200/70">Планеты</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                {chart.planets.map((planet) => (
                  <div key={planet.key} className="flex items-center gap-1.5 border-b border-white/[0.04] py-1 text-[10px]">
                    <span className="w-4 text-center text-sm text-violet-200">{planet.glyph}</span>
                    <span className="text-white/55">{PLANETS[planet.key as PlanetKey].name}</span>
                    <span className="ml-auto text-white/80">{planet.degree}°{String(planet.minute).padStart(2, '0')}′ {planet.signGlyph}{planet.retrograde ? ' ℞' : ''}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-white/8 bg-black/20 p-2.5">
              <div className="mb-2 text-[10px] uppercase tracking-widest text-violet-200/70">Точные аспекты</div>
              <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                {chart.aspects.slice(0, 12).map((aspect) => (
                  <div key={`${aspect.left}-${aspect.right}-${aspect.type}`} className="flex items-center gap-2 rounded-md bg-white/[0.025] px-2 py-1 text-[10px] text-white/55">
                    <span style={{ color: aspectColor(aspect.tone) }} className="text-sm">{aspect.glyph}</span>
                    <span>{PLANETS[aspect.left].glyph} {aspect.leftName}</span>
                    <span className="text-white/25">—</span>
                    <span>{PLANETS[aspect.right].glyph} {aspect.rightName}</span>
                    <span className="ml-auto text-white/35">{aspect.orb.toFixed(1)}°</span>
                  </div>
                ))}
                {!chart.aspects.length && <div className="text-[10px] text-white/30">Мажорных аспектов в орбе нет.</div>}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={rememberInCore} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:opacity-40">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
              Запомнить в ядре
            </button>
            {note && <span className="text-[10px] text-emerald-200/75">{note}</span>}
            <span className="ml-auto text-[9px] text-white/25">локальные эфемериды · равные дома · preview</span>
          </div>
        </div>
      )}
    </section>
  );
}
