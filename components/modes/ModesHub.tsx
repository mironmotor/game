'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AvatarCanvas from '@/components/agent/AvatarCanvas';
import { type AvatarConfig, DEFAULT_AVATAR, loadAvatar, palette } from '@/lib/agent-avatar';
import { GROUPS, HIDDEN_COMMANDS, type HiddenCommand, MODES } from '@/lib/modes-catalog';
import { appBasePath } from '@/lib/base-path';

/**
 * Витрина: все режимы и все команды ядра на одной странице.
 *
 * Смысл в том, чтобы ничего не осталось «известным только по памяти». Режимы —
 * ссылками, события ядра — кнопками с формой. Раньше половина возможностей
 * вызывалась исключительно через curl, и об этом надо было знать заранее.
 */

export interface BuildInfo {
  sha: string;
  message: string;
  branch: string;
  builtAt: string;
  env: string;
}

interface BridgeStatus {
  /** alive — ядро ответило, down — ответило «стою», unknown — проверить не вышло. */
  state: 'alive' | 'unknown' | 'down';
  source: string;
  environment: string;
  hint: string;
}

// Раз в столько перепроверяем ядро. Страница живёт часами, а первая проверка
// вполне могла попасть на холодный старт после деплоя.
const BRIDGE_POLL_MS = 45_000;

export default function ModesHub({ build }: { build: BuildInfo }) {
  const [avatar, setAvatar] = useState<AvatarConfig>(DEFAULT_AVATAR);
  const [mounted, setMounted] = useState(false);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);

  useEffect(() => {
    setAvatar(loadAvatar());
    setMounted(true);
  }, []);

  // Состояние ядра проверяется сразу при открытии, а не после первой упавшей
  // команды: иначе о поломке узнаёшь, только нажав кнопку и получив «fetch
  // failed», по которому всё равно ничего не понять.
  //
  // Но одной проверки при монтировании мало: она застывала на весь сеанс, и
  // единственная неудача (холодный старт, мигнувшая сеть) навсегда вешала
  // красное «Ядро недоступно» поверх работающего ядра. Поэтому опрос по кругу,
  // плюс внеочередной при возврате на вкладку, и падение сети больше не
  // считается приговором ядру — оно про сеть, а не про ядро.
  useEffect(() => {
    let mountedNow = true;
    let inFlight = false;

    const check = async () => {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const d = await fetch(`${appBasePath}/api/max17`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'bridge_health' }),
        }).then((r) => r.json());
        if (!mountedNow) return;
        const state: BridgeStatus['state'] = d?.ok || d?.state === 'alive' ? 'alive' : d?.state === 'down' ? 'down' : 'unknown';
        setBridge({
          state,
          source: String(d?.source || d?.bridge || ''),
          environment: String(d?.environment || ''),
          hint: String(d?.hint || ''),
        });
      } catch {
        if (!mountedNow) return;
        // Ответ не дошёл: про ядро это не говорит ничего. Уже подтверждённое
        // «живое» не сбрасываем — иначе один блип сети снова врёт про ядро.
        setBridge((prev) =>
          prev?.state === 'alive'
            ? prev
            : { state: 'unknown', source: '', environment: '', hint: 'Проверка не дошла до сервера.' },
        );
      } finally {
        inFlight = false;
      }
    };

    void check();
    const id = setInterval(() => void check(), BRIDGE_POLL_MS);
    const onVisible = () => void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mountedNow = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const pal = palette(avatar);

  return (
    <main
      className="min-h-screen text-white"
      style={{ background: `radial-gradient(ellipse at 50% -10%, ${pal.deep} 0%, #05030c 55%, #000 100%)` }}
    >
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* ── шапка ───────────────────────────────────────────────────────── */}
        <header className="mb-8 flex items-center gap-4">
          {mounted && (
            <Link href="/agent" title="Настроить облик" className="shrink-0">
              <AvatarCanvas config={avatar} size={92} />
            </Link>
          )}
          <div>
            <h1
              className="m-0 text-2xl font-extrabold tracking-wide"
              style={{ background: `linear-gradient(90deg, ${pal.main}, ${pal.accent})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
            >
              ВСЕ РЕЖИМЫ
            </h1>
            <p className="m-0 mt-1 text-[11px] leading-relaxed opacity-55">
              {MODES.length} режимов · {HIDDEN_COMMANDS.length} команд ядра
              <br />
              <span className="opacity-70">Агент: {avatar.name}</span>
            </p>
          </div>
        </header>

        {/* ── состояние ядра ──────────────────────────────────────────────── */}
        {/* Красная плашка — только когда ядро точно стоит. «Не смогли
            проверить» — отдельная тихая строка: заявлять по ней, что ядро
            недоступно, было враньём, из-за которого владелец и видел
            «ядро стоит» на работающем ядре. */}
        {bridge?.state === 'down' && (
          <div className="mb-7 rounded-2xl border p-4" style={{ borderColor: '#ff9b3d55', background: '#ff9b3d12' }}>
            <div className="text-[12px] font-bold uppercase tracking-[2px]" style={{ color: '#ff9b3d' }}>
              Ядро недоступно — команды не сработают
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed opacity-75">{bridge.hint}</p>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] opacity-45">
              {bridge.source && <span>источник: {bridge.source}</span>}
              {bridge.environment && <span>окружение: {bridge.environment}</span>}
            </div>
          </div>
        )}
        {bridge?.state === 'unknown' && (
          <p className="mb-7 text-[11px] leading-relaxed opacity-45">
            Не удалось проверить ядро — {bridge.hint || 'ответ не пришёл вовремя'}. Команды, скорее всего, работают;
            проверю ещё раз меньше чем через минуту.
          </p>
        )}

        {/* ── режимы ──────────────────────────────────────────────────────── */}
        {GROUPS.map((group) => (
          <section key={group} className="mb-8">
            <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[4px] opacity-40">{group}</h2>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {MODES.filter((m) => m.group === group).map((m) => (
                <Link
                  key={m.href}
                  href={m.href}
                  className="group rounded-2xl border p-3.5 transition active:scale-[0.98]"
                  style={{ borderColor: `${m.color}33`, background: `${m.color}0d` }}
                >
                  <div className="text-[13px] font-bold tracking-wide" style={{ color: m.color }}>
                    △∞ {m.label}
                  </div>
                  <div className="mt-1 text-[11px] leading-snug opacity-55">{m.about}</div>
                </Link>
              ))}
            </div>
          </section>
        ))}

        {/* ── команды ядра ────────────────────────────────────────────────── */}
        <section className="mb-8">
          <h2 className="mb-1 text-[10px] font-bold uppercase tracking-[4px] opacity-40">
            Команды ядра
          </h2>
          <p className="mb-4 max-w-xl text-[11px] leading-relaxed opacity-45">
            Эти события ядро принимало всегда, но вызвать их можно было только запросом руками.
            Теперь у каждой — кнопка. Ответ показывается как есть, без приукрашивания.
          </p>
          {/* items-start: раскрытая карточка иначе растягивает соседнюю по высоте. */}
          <div className="grid items-start gap-2.5 sm:grid-cols-2">
            {HIDDEN_COMMANDS.map((cmd) => (
              <CommandCard key={cmd.event} cmd={cmd} />
            ))}
          </div>
        </section>

        {/* ── сборка ──────────────────────────────────────────────────────── */}
        <footer className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-[11px]">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[3px] opacity-40">Сборка</div>
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <Row k="Коммит" v={build.sha} />
            <Row k="Ветка" v={build.branch} />
            <Row k="Окружение" v={build.env} />
            <Row k="Собрано" v={build.builtAt} />
          </dl>
          {build.message && <p className="mt-2 opacity-50">{build.message}</p>}
        </footer>
      </div>
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 opacity-40">{k}:</dt>
      <dd className="m-0 truncate font-mono opacity-75">{v || '—'}</dd>
    </div>
  );
}

function CommandCard({ cmd }: { cmd: HiddenCommand }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [hands, setHands] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const run = useCallback(async () => {
    setBusy(true);
    setResult('');
    try {
      const body: Record<string, unknown> = { type: cmd.event, source: 'modes-hub' };
      for (const [k, v] of Object.entries(values)) {
        if (!v.trim()) continue;
        // Список строк ядро ждёт массивом, а в форме он набирается построчно.
        body[k] = k === 'items' ? v.split('\n').map((s) => s.trim()).filter(Boolean) : v;
      }
      if (cmd.dangerous) body.allow_execute = hands;

      const res = await fetch(`${appBasePath}/api/max17`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setResult(`Не дошло до ядра: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [cmd, values, hands]);

  return (
    <div className="rounded-2xl border p-3.5" style={{ borderColor: `${cmd.color}33`, background: `${cmd.color}0d` }}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full text-left">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-bold tracking-wide" style={{ color: cmd.color }}>
            ⌘ {cmd.label}
          </span>
          <span className="font-mono text-[10px] opacity-35">{cmd.event}</span>
        </div>
        <div className="mt-1 text-[11px] leading-snug opacity-55">{cmd.about}</div>
      </button>

      {open && (
        <div className="mt-3 space-y-2.5">
          {cmd.fields?.map((f) =>
            f.multiline ? (
              <textarea
                key={f.name}
                rows={3}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                placeholder={f.placeholder}
                aria-label={f.label}
                className="w-full resize-y rounded-xl border bg-black/40 px-3 py-2 text-[12px] outline-none placeholder:opacity-30"
                style={{ borderColor: `${cmd.color}33` }}
              />
            ) : (
              <input
                key={f.name}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                placeholder={f.placeholder}
                aria-label={f.label}
                className="w-full rounded-xl border bg-black/40 px-3 py-2 text-[12px] outline-none placeholder:opacity-30"
                style={{ borderColor: `${cmd.color}33` }}
              />
            ),
          )}

          {cmd.dangerous && (
            <label className="flex items-start gap-2 text-[11px] leading-snug opacity-75">
              <input type="checkbox" checked={hands} onChange={(e) => setHands(e.target.checked)} className="mt-0.5" />
              <span>
                Включить руки — ядро выполнит выбранное действие, а не только предложит.
                Команды ограничены белым списком, пути — папкой проекта.
              </span>
            </label>
          )}

          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="rounded-full border px-4 py-2 text-[11px] font-bold uppercase tracking-[2px] active:scale-95 disabled:opacity-40"
            style={{ color: cmd.color, borderColor: `${cmd.color}66`, background: `${cmd.color}1a` }}
          >
            {busy ? 'Идёт…' : 'Выполнить'}
          </button>

          {result && (
            <pre className="max-h-64 overflow-auto rounded-xl border border-white/10 bg-black/60 p-3 text-[10px] leading-relaxed">
              {result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
