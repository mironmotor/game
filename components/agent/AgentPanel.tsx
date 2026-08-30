'use client';

import './agent.css';
import type { Max17Agent } from '@/lib/max17-client';

// Панель автономного агента. Всё, что здесь показано, агент решил сам:
// ни одна цифра не подписана вручную и ни одно действие не выбрано человеком.
//
// Читается сверху вниз как обоснование решения:
//   что я сделал → почему (F = E − T·S) → чего мне не хватает (влечения)
//   → что ещё рассматривал → чему научился на прошлом такте.

const ACTION_COLORS: Record<string, string> = {
  bloom: '#ff2fd0',
  hush: '#6a8bff',
  weave: '#59ffb2',
  scatter: '#ffb14e',
  tint: '#c07bff',
  hold: '#00f2ff',
  watch: '#8c8ca8',
};

const DRIVE_COLORS: Record<string, string> = {
  care: '#ff6a8a',
  growth: '#ff2fd0',
  order: '#59ffb2',
  novelty: '#ffb14e',
};

export const agentColor = (key?: string) => ACTION_COLORS[key ?? ''] ?? '#ff8ae8';

/** Строка в панели «Эфира»: одна фраза о том, что агент делает прямо сейчас. */
export function AgentLine({ agent }: { agent: Max17Agent | null | undefined }) {
  if (!agent?.action) return null;
  const c = agentColor(agent.action.key);
  return (
    <div className="ag-line" style={{ borderColor: `${c}44`, background: `${c}12` }}>
      <span className="ag-line-dot" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
      <span className="ag-line-act" style={{ color: c }}>
        {agent.action.title}
      </span>
      <span className="ag-line-mood">{agent.mood}</span>
    </div>
  );
}

export default function AgentPanel({ agent }: { agent: Max17Agent | null | undefined }) {
  if (!agent || agent.ok === false || !agent.action) {
    return (
      <div className="ag-panel">
        <div className="ag-head">
          <span className="ag-title">АГЕНТ</span>
        </div>
        <div className="ag-empty">
          {agent?.error
            ? `Такт агента упал: ${agent.error}`
            : 'Агент рождается вместе с миром — впусти голос, и он начнёт жить.'}
        </div>
      </div>
    );
  }

  const { action, thermo, drives = [], considered = [], learned, journal = [] } = agent;
  const c = agentColor(action.key);
  // Температура — единственная ручка между «вылизывать» и «рисковать».
  const heat = Math.min(1, (thermo?.temperature ?? 0) / 1.15);

  return (
    <div className="ag-panel">
      <div className="ag-head">
        <span className="ag-title">АГЕНТ</span>
        <span className="ag-id">
          {agent.agent_id} · такт {agent.tick}
        </span>
      </div>

      {/* Что делает прямо сейчас */}
      <div className="ag-act" style={{ borderColor: `${c}55`, background: `${c}14` }}>
        <div className="ag-act-top">
          <b style={{ color: c }}>{action.title}</b>
          <span className="ag-trust" title="доверие к этому действию">
            доверие {Math.round(action.trust * 100)}%
          </span>
        </div>
        <div className="ag-act-note">{action.note}</div>
        <div className="ag-mood" style={{ color: c }}>
          {agent.mood}
        </div>
      </div>

      {/* Ровно та формула, по которой выбор и сделан */}
      {thermo && (
        <div className="ag-thermo">
          <div className="ag-thermo-law">F = E − T·S</div>
          <div className="ag-thermo-nums">
            <Num k="F" v={thermo.free_energy} accent />
            <Num k="E" v={thermo.energy} />
            <Num k="T" v={thermo.temperature} />
            <Num k="S" v={thermo.entropy} />
          </div>
          <div className="ag-heat-track" title="холодный агент наводит порядок, горячий — рискует">
            <div
              className="ag-heat-fill"
              style={{ width: `${Math.round(heat * 100)}%` }}
            />
          </div>
          <div className="ag-heat-legend">
            <span>вылизывает</span>
            <span>рискует</span>
          </div>
        </div>
      )}

      {/* Влечения: чего агенту не хватает в мире */}
      <div className="ag-block">
        <div className="ag-block-title">ВЛЕЧЕНИЯ</div>
        {drives.map((d) => (
          <div key={d.key} className="ag-drive" title={d.note}>
            <div className="ag-drive-head">
              <span>{d.title}</span>
              <span className={d.deficit > 0.12 ? 'ag-hungry' : ''}>
                {Math.round(d.value * 100)}% / {Math.round(d.target * 100)}%
              </span>
            </div>
            <div className="ag-drive-track">
              <div
                className="ag-drive-fill"
                style={{
                  width: `${Math.round(Math.min(1, d.value) * 100)}%`,
                  background: DRIVE_COLORS[d.key] ?? '#ff8ae8',
                }}
              />
              <div
                className="ag-drive-target"
                style={{ left: `${Math.round(d.target * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Альтернативы: агент обязан уметь объясниться, а не просто решить */}
      {considered.length > 0 && (
        <div className="ag-block">
          <div className="ag-block-title">ЧТО ЕЩЁ РАССМАТРИВАЛ</div>
          <ConsideredChart considered={considered} />
        </div>
      )}

      {/* Обучение: сверка обещанного с тем, каким мир стал */}
      <div className="ag-block">
        <div className="ag-block-title">ЧЕМУ НАУЧИЛСЯ</div>
        {learned ? (
          <div className="ag-learn">
            <div className="ag-learn-row">
              <span>«{learned.title}»</span>
              <b className={learned.trust_after >= learned.trust_before ? 'ag-up' : 'ag-down'}>
                {Math.round(learned.trust_before * 100)}% →{' '}
                {Math.round(learned.trust_after * 100)}%
              </b>
            </div>
            <div className="ag-learn-note">
              промах {learned.error.toFixed(3)} · сбылось на{' '}
              {Math.round(learned.accuracy * 100)}%
            </div>
          </div>
        ) : (
          <div className="ag-learn-note">Первый такт — сверять пока не с чем.</div>
        )}
      </div>

      {/* Дневник: агент помнит себя между сессиями */}
      {journal.length > 1 && (
        <div className="ag-block">
          <div className="ag-block-title">ДНЕВНИК</div>
          <div className="ag-journal">
            {journal.slice(0, 6).map((j) => (
              <div key={j.tick} className="ag-journal-row">
                <span className="ag-journal-tick">#{j.tick}</span>
                <span
                  className="ag-journal-act"
                  style={{ color: agentColor(j.action) }}
                >
                  {j.action}
                </span>
                <span className="ag-journal-f">{j.free_energy.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {agent.say && <div className="ag-say">{agent.say}</div>}
    </div>
  );
}

/**
 * Свободная энергия по всем вариантам. Ниже — лучше, поэтому столбики
 * растут вниз от нуля и выбранный всегда самый длинный.
 */
function ConsideredChart({
  considered,
}: {
  considered: NonNullable<Max17Agent['considered']>;
}) {
  const values = considered.map((c) => c.free_energy);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = Math.max(1e-6, hi - lo);

  return (
    <div className="ag-alts">
      {considered.map((c) => {
        const fill = (hi - c.free_energy) / span; // лучший вариант — полная полоса
        const col = agentColor(c.key);
        return (
          <div key={c.key} className={`ag-alt ${c.chosen ? 'chosen' : ''}`}>
            <span className="ag-alt-name" style={{ color: c.chosen ? col : undefined }}>
              {c.title}
            </span>
            <span className="ag-alt-track">
              <span
                className="ag-alt-fill"
                style={{
                  width: `${Math.round(fill * 100)}%`,
                  background: col,
                  opacity: c.chosen ? 1 : 0.35,
                }}
              />
            </span>
            <span className="ag-alt-f">{c.free_energy.toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Num({ k, v, accent }: { k: string; v: number; accent?: boolean }) {
  return (
    <div className="ag-num">
      <span>{k}</span>
      <b className={accent ? 'ag-num-accent' : ''}>{v.toFixed(2)}</b>
    </div>
  );
}
