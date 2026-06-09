'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, Cpu, Cloud, HardDrive, Check } from 'lucide-react';
import { getLlmConfig, setLlmModel, type LlmPreset, type LlmRoleRoute } from '@/lib/max17-client';

export function ModelSwitcher({ onClose }: { onClose: () => void }) {
  const [presets, setPresets] = useState<LlmPreset[]>([]);
  const [roles, setRoles] = useState<LlmRoleRoute[]>([]);
  const [envModel, setEnvModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      const c = await getLlmConfig();
      if (c.ok && c.presets) {
        setPresets(c.presets);
        setRoles(c.roles || []);
        setEnvModel(c.env_model || '');
      } else {
        setError(c.error || 'Не удалось получить список моделей.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const pick = async (id: string, role?: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const c = await setLlmModel(id, role);
      if (c.ok && c.presets) {
        setPresets(c.presets);
        setRoles(c.roles || []);
      } else {
        setError(c.error || 'Не удалось переключить.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-[112px] left-1/2 z-20 flex max-h-[min(60vh,440px)] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-cyan-300/30 bg-black/80 shadow-[0_0_28px_rgba(0,242,255,0.18)] backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-cyan-300/20 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-cyan-100/85">
          <Cpu size={14} />
          <span>Модель ИИ</span>
        </div>
        <button type="button" onClick={onClose} className="hud-icon-btn" aria-label="Закрыть">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2 text-[11px] text-cyan-100/80">
        {busy && presets.length === 0 && (
          <div className="flex items-center gap-2 text-cyan-100/55">
            <Loader2 size={13} className="animate-spin" /> загрузка…
          </div>
        )}
        {error && <div className="text-amber-300/80">⚠ {error}</div>}

        {roles.length > 0 && (
          <div className="space-y-1.5 border-b border-cyan-300/15 pb-2">
            <div className="text-[9px] uppercase tracking-[0.18em] text-cyan-100/45">Роли</div>
            {roles.map((role) => (
              <label
                key={role.id}
                className="flex items-center justify-between gap-2 rounded-md border border-cyan-300/10 bg-cyan-300/[0.03] px-2.5 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-cyan-100/90">{role.label}</span>
                  <span className="block truncate text-[9px] uppercase tracking-[0.1em] text-cyan-100/40">
                    {role.auto ? 'auto' : role.active} · {role.model || role.resolved || envModel}
                  </span>
                </span>
                <select
                  disabled={busy}
                  value={role.active || 'auto'}
                  onChange={(event) => void pick(event.target.value, role.id)}
                  className="max-w-[150px] shrink-0 rounded border border-cyan-300/20 bg-black/70 px-2 py-1 text-[10px] text-cyan-100 outline-none"
                >
                  <option value="auto">Auto</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.available}>
                      {p.id}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}

        <div className="text-[9px] uppercase tracking-[0.18em] text-cyan-100/45">Глобальный fallback</div>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={busy || !p.available}
            onClick={() => void pick(p.id)}
            className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition ${
              p.active
                ? 'border-cyan-300/60 bg-cyan-300/15'
                : p.available
                  ? 'border-cyan-300/15 bg-cyan-300/[0.03] hover:bg-cyan-300/10'
                  : 'border-white/5 bg-white/[0.02] opacity-50'
            }`}
          >
            <span className="mt-0.5 shrink-0">
              {p.active ? <Check size={13} className="text-cyan-300" /> : p.local ? <HardDrive size={13} /> : <Cloud size={13} />}
            </span>
            <span className="min-w-0">
              <span className="block text-cyan-100/90">{p.label}</span>
              <span className="block text-[9px] uppercase tracking-[0.1em] text-cyan-100/45">
                {p.model}
                {p.active ? ' · активна' : !p.available ? ' · нужен ключ' : ''}
              </span>
            </span>
          </button>
        ))}
        <p className="pt-1 text-[9px] leading-relaxed text-cyan-100/40">
          Переключение мгновенное (без перезапуска). Auto выбирает модель по роли: чат отдельно,
          код-агент и архитектор отдельно, bulk-задачи отдельно.
          Облачные модели требуют ключ в <code>.env.local</code> (GEMINI_API_KEY / GROQ_API_KEY).
          Локальные — запущенную Ollama.
        </p>
      </div>
    </div>
  );
}
