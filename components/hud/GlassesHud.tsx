'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AvatarCanvas from '@/components/agent/AvatarCanvas';
import { type AvatarConfig, DEFAULT_AVATAR, loadAvatar, palette } from '@/lib/agent-avatar';
import { type GlassesPreset, minFontPx, pixelsPerDegree, PRESETS, SAFE_AREA } from '@/lib/glasses-presets';

/**
 * HUD для очков.
 *
 * Главное отличие от остальных режимов: чёрный здесь означает «прозрачно».
 * Просвечивающий экран складывает свою картинку с реальным миром, вычитать он
 * не умеет — значит, тёмного не существует, а всё бледное просто теряется на
 * фоне улицы. Отсюда правила, которым подчинён весь этот файл:
 *
 *   - фон строго #000 и никаких панелей с подложкой;
 *   - ничего полупрозрачного: элемент либо горит, либо его нет;
 *   - никаких градиентов и теней — на просвете они превращаются в муть;
 *   - кегль не ниже расчётного минимума для выбранных очков;
 *   - всё важное внутри центральных 62% кадра;
 *   - белого текста нет.
 *
 * Последнее правило неочевидно, пока не посмотришь на стенд с включённым
 * просветом: белый — худший выбор из возможных. Улица, асфальт, бетон, небо в
 * облаках сами по себе бело-серые, и белые буквы ложатся ровно в цвет фона.
 * Обвести их тёмным нельзя — тёмного на просвечивающем экране не существует.
 * Поэтому различает не яркость, а тон: в авиационных ИЛС не случайно всё
 * зелёное. Здесь текст берёт основной цвет облика агента.
 *
 * Кадр рисуется в настоящих пикселях выбранных очков и лишь потом целиком
 * масштабируется под окно. Иначе проверка была бы самообманом: на ноутбуке всё
 * читается, а в очках оказывается вдвое мельче.
 */

interface CoreState {
  /** unknown — ещё не спросили или не дозвонились, down — ядро точно молчит. */
  status: 'unknown' | 'alive' | 'down';
  memories: number | null;
  confidence: number | null;
  thought: string;
  error: string;
}

const IDLE: CoreState = { status: 'unknown', memories: null, confidence: null, thought: '', error: '' };

// Сколько промахов подряд считать молчанием ядра. Один — это ещё не поломка:
// холодный старт после деплоя и мигнувший вайфай выглядят точно так же.
const SILENCE_AFTER_MISSES = 2;

export default function GlassesHud() {
  const [preset, setPreset] = useState<GlassesPreset>(PRESETS[0]);
  const [avatar, setAvatar] = useState<AvatarConfig>(DEFAULT_AVATAR);
  const [showWorld, setShowWorld] = useState(true);
  const [showSafe, setShowSafe] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const [core, setCore] = useState<CoreState>(IDLE);
  const [now, setNow] = useState('--:--');
  const [scale, setScale] = useState(1);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Промахи подряд — счётчик живёт в ref: он про связь, а не про кадр.
  const misses = useRef(0);

  // Аватар лежит в localStorage, которого на сервере нет: прочитать его можно
  // только после монтирования. Правило про каскадные перерисовки здесь не про
  // нас — это одноразовая инициализация, а не цепочка обновлений.
  useEffect(() => setAvatar(loadAvatar()), []);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 20_000);
    return () => clearInterval(id);
  }, []);

  // Кадр вписывается в окно целиком, с обеих сторон — иначе широкий пресет
  // обрежется по краям, а обрезанный край это ровно то, что мы проверяем.
  useEffect(() => {
    const fit = () => {
      const pad = 120;
      const k = Math.min(
        (window.innerWidth - 40) / preset.width,
        (window.innerHeight - pad) / preset.height,
        1.6,
      );
      setScale(Math.max(0.18, k));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [preset]);

  const pull = useCallback(async () => {
    // Промах не стирает то, что ядро уже рассказало: цифры на просвете нужнее
    // пустых прочерков, а объявлять ядро молчащим с первой осечки — враньё.
    const miss = (message: string) => {
      misses.current += 1;
      setCore((prev) => ({
        ...prev,
        status: misses.current >= SILENCE_AFTER_MISSES ? 'down' : prev.status,
        error: message,
      }));
    };
    try {
      const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
      const res = await fetch(`${base}/api/max17`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'system_state', source: 'glasses-hud' }),
      });
      const data = await res.json();
      if (data?.ok === false) {
        miss(String(data.error || 'ядро не ответило'));
        return;
      }
      // Первый же удачный ответ возвращает «на связи», сколько бы промахов ни
      // было до него.
      misses.current = 0;
      setCore({
        status: 'alive',
        memories: Number(data?.memory?.stats?.memories ?? data?.memory?.count ?? NaN) || null,
        confidence: Number(data?.plasticity?.confidence ?? data?.confidence ?? NaN) || null,
        thought: String(data?.plasticity?.hint || data?.next_adaptation || '').slice(0, 90),
        error: '',
      });
    } catch (err) {
      miss(err instanceof Error ? err.message : 'нет связи');
    }
  }, []);

  // Опрос ядра по таймеру: первый вызов сразу, дальше раз в полминуты.
  // Состояние здесь меняется по приходу данных, а не в ответ на рендер.
  useEffect(() => {
    pull();
    const id = setInterval(pull, 30_000);
    return () => clearInterval(id);
  }, [pull]);

  const ppd = useMemo(() => pixelsPerDegree(preset), [preset]);
  const minFont = useMemo(() => minFontPx(preset), [preset]);
  const pal = palette(avatar);

  // Вся типографика — производная от минимального кегля, а не подобранные
  // числа. Смена очков меняет раскладку целиком, и ничего не надо переверстывать.
  const f = {
    small: minFont,
    body: Math.round(minFont * 1.25),
    big: Math.round(minFont * 2.1),
  };
  const inset = ((1 - SAFE_AREA) / 2) * 100;

  return (
    <main className="min-h-screen bg-[#08080b] text-white">
      {/* ── сцена ───────────────────────────────────────────────────────────── */}
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 py-6">
        <div
          style={{
            width: preset.width * scale,
            height: preset.height * scale,
            position: 'relative',
          }}
        >
          {/* Имитация реального мира за стеклом: без неё чёрный фон выглядит
              чёрным, и любая тусклая деталь кажется читаемой. */}
          {showWorld && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 8 * scale,
                overflow: 'hidden',
                background:
                  'linear-gradient(160deg,#9fb4c9 0%,#c9d4dd 28%,#8a9aa8 46%,#e8e2d6 62%,#6f7c88 100%)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'repeating-linear-gradient(72deg, rgba(0,0,0,0.16) 0 3%, rgba(255,255,255,0.12) 3% 7%)',
                }}
              />
            </div>
          )}

          <div
            ref={boxRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: preset.width,
              height: preset.height,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              // Экран очков складывает свет с миром — screen делает ровно это.
              mixBlendMode: showWorld ? 'screen' : 'normal',
              background: '#000',
              borderRadius: 8,
              overflow: 'hidden',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {showSafe && (
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  top: `${inset}%`,
                  left: `${inset}%`,
                  right: `${inset}%`,
                  bottom: `${inset}%`,
                  border: '2px dashed rgba(255,255,255,0.35)',
                }}
              />
            )}

            <div
              style={{
                position: 'absolute',
                top: `${inset}%`,
                left: `${inset}%`,
                right: `${inset}%`,
                bottom: `${inset}%`,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              {/* Верх: время и состояние связи. Одна строка, ничего лишнего. */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: f.big, fontWeight: 800, color: pal.main, lineHeight: 1 }}>{now}</span>
                <span
                  style={{
                    fontSize: f.small,
                    fontWeight: 800,
                    letterSpacing: 2,
                    color: core.status === 'down' ? '#ff9b3d' : pal.main,
                  }}
                >
                  {core.status === 'alive' ? 'ЯДРО НА СВЯЗИ' : core.status === 'down' ? 'ЯДРО МОЛЧИТ' : 'ЯДРО · ПРОВЕРКА'}
                </span>
              </div>

              {/* Центр: агент и его состояние. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: f.body * 1.2 }}>
                <AvatarCanvas
                  config={avatar}
                  size={Math.round(preset.height * 0.3)}
                  variant="glasses"
                  listening
                />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: f.big,
                      fontWeight: 800,
                      letterSpacing: 4,
                      color: pal.main,
                      lineHeight: 1.1,
                    }}
                  >
                    {avatar.name}
                  </div>
                  <div style={{ fontSize: f.small, fontWeight: 800, letterSpacing: 2, color: pal.main }}>
                    {core.memories !== null ? `ПАМЯТЬ ${core.memories}` : 'ПАМЯТЬ —'}
                    {core.confidence !== null && `   ТОЧНОСТЬ ${Math.round(core.confidence * 100)}%`}
                  </div>
                </div>
              </div>

              {/* Низ: одна мысль. Не абзац — на ходу читается только строка. */}
              <div style={{ fontSize: f.body, fontWeight: 800, lineHeight: 1.3, color: pal.main }}>
                {core.status === 'alive'
                  ? core.thought || 'Ядро на связи, сказать нечего.'
                  : core.status === 'down'
                    ? `Мост не отвечает${core.error ? `: ${core.error}` : ''}`
                    : 'Спрашиваю ядро…'}
              </div>
            </div>
          </div>
        </div>

        {/* ── настройки стенда ────────────────────────────────────────────── */}
        {showPanel && (
          <section className="w-full max-w-3xl px-4 text-[12px]">
            <div className="mb-3 flex flex-wrap gap-2">
              {PRESETS.map((p) => {
                const on = p.id === preset.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPreset(p)}
                    className="rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider active:scale-95"
                    style={{
                      color: on ? pal.main : 'rgba(255,255,255,0.6)',
                      borderColor: on ? `${pal.main}88` : 'rgba(255,255,255,0.16)',
                      background: on ? `${pal.main}1f` : 'transparent',
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            <div className="mb-3 flex flex-wrap gap-4 text-[11px]">
              <Toggle label="Просвет" on={showWorld} onChange={setShowWorld} />
              <Toggle label="Безопасная зона" on={showSafe} onChange={setShowSafe} />
              <button type="button" onClick={() => setShowPanel(false)} className="opacity-50 underline">
                скрыть стенд
              </button>
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-4">
              <Stat k="Разрешение" v={`${preset.width}×${preset.height}`} />
              <Stat k="Поле зрения" v={`${preset.fovDiagonal}° по диагонали`} />
              <Stat k="Пикселей на градус" v={ppd.toFixed(0)} />
              <Stat k="Минимальный кегль" v={`${minFont} px`} />
            </dl>
            <p className="mt-2 text-[11px] leading-relaxed opacity-45">
              {preset.ocularity === 'моно' && 'Монокуляр: картинка только в одном глазу. '}
              {preset.note}. Кадр показан в настоящих пикселях очков и целиком масштабирован
              под окно — то, что не читается здесь, не прочитается и там.
            </p>
          </section>
        )}
        {!showPanel && (
          <button type="button" onClick={() => setShowPanel(true)} className="text-[11px] opacity-40 underline">
            показать стенд
          </button>
        )}
      </div>
    </main>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="opacity-75">{label}</span>
    </label>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="opacity-40">{k}</dt>
      <dd className="m-0 font-bold opacity-85">{v}</dd>
    </div>
  );
}
