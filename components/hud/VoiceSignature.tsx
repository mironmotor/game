'use client';

import { useEffect, useRef, useState } from 'react';
import { X, AudioLines, BarChart3, Loader2 } from 'lucide-react';
import { VoiceSignatureEngine, type VoiceReading } from './voice-signature';

/** Strip the leading emoji from a verdict label → a clean RU state word. */
function cleanState(label: string): string {
  return label.replace(/^[^\p{L}]+/u, '').split(',')[0].trim();
}

// Max's violet family — calm violet → tense magenta (never green, unlike the
// original signature's mood scale: this is Max's identity colour).
function moodHue(tension: number, valence: number): number {
  return 275 + tension * 50 - (valence - 0.5) * 30;
}

export function VoiceSignature({
  onClose,
  onObservation,
  contextText = '',
}: {
  onClose: () => void;
  onObservation: (payload: Record<string, unknown>) => void;
  contextText?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<VoiceSignatureEngine | null>(null);
  const lastEmitRef = useRef(0);
  const lastStatRef = useRef(0);
  const [reading, setReading] = useState<VoiceReading | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const engine = new VoiceSignatureEngine();
    engine.ctxText = contextText;
    engineRef.current = engine;
    let mounted = true;

    void engine.start((r) => {
      if (!mounted) return;
      draw(canvasRef.current, r);
      const now = performance.now();
      // Throttle React re-render (stats) to ~7fps; the canvas draws every frame.
      if (now - lastStatRef.current > 140) {
        lastStatRef.current = now;
        setReading(r);
      }
      // Ship a reading to Max's core at most every 6s while actually speaking.
      if (r.feats.voiced && r.obs >= 0 && now - lastEmitRef.current > 6000 && (r.arousal > 0 || r.tension > 0)) {
        lastEmitRef.current = now;
        onObservation({
          type: 'voice_observation',
          voice: {
            arousal: round(r.arousal),
            valence: round(r.valence),
            tension: round(r.tension),
            jitter: round(r.feats.jitter),
            shimmer: round(r.feats.shimmer),
            hnr: Math.round(r.feats.hnr),
            f0: Math.round(r.feats.f0),
            f1: Math.round(r.feats.f1),
            f2: Math.round(r.feats.f2),
            rate: round(r.feats.rate),
            brightness: round(r.feats.brightness),
            constriction: round(r.feats.constriction),
            register: round(r.feats.register),
            energy: round(r.feats.energy),
            stability: round(r.stability),
            trend: r.trend,
            label: cleanState(r.label),
          },
          text: contextText.slice(0, 140),
        });
      }
    }).then((ok) => {
      if (mounted && !ok) setError('Микрофон недоступен — разреши доступ в браузере.');
    });

    return () => {
      mounted = false;
      engine.stop();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hue = reading ? moodHue(reading.tension, reading.valence) : 280;

  return (
    <div className="fixed bottom-[112px] left-1/2 z-20 flex max-h-[min(76vh,560px)] w-[min(360px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border bg-black/85 shadow-[0_0_30px_rgba(168,85,247,0.28)] backdrop-blur-md"
      style={{ borderColor: `hsla(${hue},70%,55%,.5)` }}>
      <div className="flex items-center justify-between border-b border-fuchsia-300/20 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-fuchsia-100/85">
          <AudioLines size={14} />
          <span>Голос Макса</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowStats((v) => !v)}
            className={`hud-icon-btn ${showStats ? 'active' : ''}`}
            aria-label="Статистика для разработчика"
            title="Статки аналитика: F0 / jitter / shimmer / HNR / форманты"
          >
            <BarChart3 size={15} />
          </button>
          <button type="button" onClick={onClose} className="hud-icon-btn" aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2 px-3 py-3">
        <canvas
          ref={canvasRef}
          width={520}
          height={520}
          className="aspect-square w-[200px]"
          style={{ filter: `drop-shadow(0 0 18px hsla(${hue},85%,55%,.35))` }}
        />

        {error ? (
          <div className="text-center text-[11px] text-amber-300/85">⚠ {error}</div>
        ) : !reading ? (
          <div className="flex items-center gap-2 text-[11px] text-fuchsia-100/55">
            <Loader2 size={13} className="animate-spin" /> поднимаю микрофон…
          </div>
        ) : (
          <>
            <div className="text-center">
              <div className="text-[15px] font-medium text-fuchsia-50">{reading.label}</div>
              {reading.desc && <div className="text-[10px] text-fuchsia-100/55">{reading.desc}</div>}
              {reading.warming && (
                <div className="mt-0.5 text-[9px] text-amber-200/70">учу твой голос ({reading.obs} набл.) — строю норму</div>
              )}
            </div>

            <div className="w-full space-y-1.5">
              <AxisBar label="Возбуждение" value={reading.arousal} color="#d946ef" />
              <AxisBar label="Позитив" value={reading.valence} color="#a855f7" />
              <AxisBar label="Напряжение" value={reading.tension} color="#f472b6" />
            </div>

            <div className="flex w-full justify-between text-[9px] uppercase tracking-[0.1em] text-fuchsia-100/40">
              <span>стабильность: {reading.stability > 0.7 ? 'высокая' : reading.stability > 0.4 ? 'средняя' : 'низкая'}</span>
              <span>{reading.trend === 'up' ? '↑ напряжение растёт' : reading.trend === 'down' ? '↓ расслабляется' : '→ ровно'}</span>
            </div>
          </>
        )}

        {showStats && reading && (
          <div className="mt-1 grid w-full grid-cols-2 gap-x-3 gap-y-1 rounded border border-fuchsia-300/15 bg-fuchsia-300/[0.04] px-2.5 py-2 text-[10px] text-fuchsia-100/70">
            <Stat k="F0 / нота" v={reading.feats.f0 ? `${Math.round(reading.feats.f0)} Гц · ${reading.note}` : '—'} />
            <Stat k="форманты F1/F2" v={reading.feats.f1 ? `${Math.round(reading.feats.f1)} / ${Math.round(reading.feats.f2)}` : '—'} />
            <Stat k="jitter · дрожь" v={pct(reading.feats.jitter)} />
            <Stat k="shimmer · сила" v={pct(reading.feats.shimmer)} />
            <Stat k="HNR · чистота" v={`${Math.round(reading.feats.hnr)} дБ`} />
            <Stat k="темп речи" v={pct(reading.feats.rate)} />
            <Stat k="яркость" v={pct(reading.feats.brightness)} />
            <Stat k="зажатость" v={pct(reading.feats.constriction)} />
            <Stat k="регистр" v={pct(reading.feats.register)} />
            <Stat k="энергия" v={pct(reading.feats.energy)} />
          </div>
        )}

        <p className="text-center text-[9px] leading-relaxed text-fuchsia-100/35">
          Локально (Web Audio), наружу уходят только числа. Раз в ~6с состояние пишется в память Макса и связывается мостами с тем, что ты говоришь.
        </p>
      </div>
    </div>
  );
}

function AxisBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[78px] shrink-0 text-[9px] uppercase tracking-[0.08em] text-fuchsia-100/55">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
      <span className="w-[30px] shrink-0 text-right text-[9px] tabular-nums text-fuchsia-100/60">{Math.round(value * 100)}%</span>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-fuchsia-100/45">{k}</span>
      <span className="shrink-0 tabular-nums text-fuchsia-100/85">{v}</span>
    </div>
  );
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const pct = (v: number) => `${Math.round((v || 0) * 100)}%`;

// ===== violet voice-core visualization (signature draw(), Max palette) =====
function draw(canvas: HTMLCanvasElement | null, r: VoiceReading) {
  if (!canvas) return;
  const g = canvas.getContext('2d');
  if (!g) return;
  const W = canvas.width;
  const H = canvas.height;
  const cx = W / 2;
  const cy = H / 2;
  const innerR = 76;
  const maxLen = Math.min(W, H) / 2 - innerR - 30;
  const tv = r.overtones;
  const F0 = r.feats.f0;

  g.clearRect(0, 0, W, H);

  const harm = new Set<number>();
  if (F0) for (let k = 1; k <= 16; k++) {
    const idx = Math.round(12 * Math.log2((F0 * k) / 65.4064));
    if (idx >= 0 && idx < 60) harm.add(idx);
  }

  const stateHue = moodHue(r.tension, r.valence);
  let level = 0;
  for (let i = 0; i < 60; i++) level += tv[i];
  level = Math.min(1, level / 16);

  // violet nucleus glow
  const cg = g.createRadialGradient(cx, cy, 3, cx, cy, innerR * (0.85 + level));
  cg.addColorStop(0, `hsla(${stateHue},90%,70%,.95)`);
  cg.addColorStop(1, `hsla(${stateHue},90%,45%,0)`);
  g.fillStyle = cg;
  g.beginPath();
  g.arc(cx, cy, innerR * (0.85 + level), 0, Math.PI * 2);
  g.fill();

  // formant rings — "shape of the vocal tract"
  ([
    [r.feats.f1, 2800, 'rgba(196,160,255,'],
    [r.feats.f2, 2800, 'rgba(244,140,255,'],
  ] as [number, number, string][]).forEach(([fv, fmax, col]) => {
    if (!fv) return;
    const rr = innerR + Math.min(1, fv / fmax) * maxLen;
    g.strokeStyle = col + '0.35)';
    g.lineWidth = 1.5;
    g.setLineDash([4, 6]);
    g.beginPath();
    g.arc(cx, cy, rr, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  });

  // overtone rays in Max's violet → magenta spectrum
  for (let i = 0; i < 60; i++) {
    const v = tv[i];
    const ang = -Math.PI / 2 + (i / 60) * Math.PI * 2;
    const len = v * maxLen;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const x1 = cx + ca * innerR;
    const y1 = cy + sa * innerR;
    const x2 = cx + ca * (innerR + len);
    const y2 = cy + sa * (innerR + len);
    const hue = 250 + (i / 60) * 80; // 250 blue-violet → 330 magenta
    const isH = harm.has(i);
    g.lineCap = 'round';
    g.lineWidth = isH ? 5 : 2.5;
    g.strokeStyle = `hsl(${hue},100%,${52 + v * 28}%)`;
    g.shadowBlur = isH ? 14 : v > 0.3 ? 8 : 0;
    g.shadowColor = `hsl(${hue},100%,62%)`;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
    if (isH && len > 6) {
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.beginPath();
      g.arc(x2, y2, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.shadowBlur = 0;
}
