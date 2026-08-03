'use client';

import { useCallback, useEffect, useState } from 'react';
import { probePhysics } from '@/lib/physics-client';
import type { Max17Response } from '@/lib/max17-client';
import './physics.css';

// ФИЗИКА — все десять уравнений, посчитанные на настоящем состоянии ядра.
//
// До этого экрана физика существовала только как блоки JSON в ответе API:
// считалась честно, но увидеть её было негде. Здесь один read-only зонд
// (событие physics) и всё, что он вернул, разложено по карточкам.

const REGIME_RU: Record<string, string> = {
  laminar: 'ламинарный',
  transitional: 'переходный',
  turbulent: 'турбулентный',
  locked: 'схлопнулось',
  cyclic: 'цикл',
  marginal: 'на грани',
  scattered: 'рассеяно',
};

const FATE_RU: Record<string, string> = {
  expanding: 'расширяется',
  flat: 'плоская',
  collapsing: 'схлопывается',
};

const VERDICT_RU: Record<string, string> = {
  emit: 'излучено',
  confined: 'конфайнмент',
  virtual: 'виртуально',
};

function num(v: unknown, digits = 3): string {
  return typeof v === 'number' ? v.toFixed(digits) : '—';
}

function Card({ title, eq, children }: { title: string; eq: string; children: React.ReactNode }) {
  return (
    <section className="phys-card">
      <h2>{title}</h2>
      <div className="phys-eq">{eq}</div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="phys-row">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Bars({ items }: { items: Array<{ label: string; value: number; dim?: boolean }> }) {
  const peak = Math.max(...items.map((i) => i.value), 1e-9);
  return (
    <div className="phys-bars">
      {items.map((it) => (
        <div key={it.label} className={`phys-bar-row${it.dim ? ' dim' : ''}`}>
          <span>{it.label}</span>
          <span className="phys-bar-track">
            <span className="phys-bar-fill" style={{ width: `${(it.value / peak) * 100}%` }} />
          </span>
          <span>{(it.value * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

export default function PhysicsPanel() {
  const [res, setRes] = useState<Max17Response | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const measure = useCallback(async () => {
    setBusy(true);
    setError('');
    const { response, error: err } = await probePhysics();
    if (err || response.route === 'error') {
      setError(err || String(response.error || 'ядро не ответило'));
      setRes(null);
    } else {
      setRes(response);
    }
    setBusy(false);
  }, []);

  useEffect(() => { void measure(); }, [measure]);

  const p = res?.physics;
  const flow = res?.flow;
  const att = res?.attention;
  const gen = res?.genesis;
  const sup = (res?.raw as { decision?: { superposition?: Record<string, unknown> } } | undefined)
    ?.decision?.superposition as
    | { probabilities?: Record<string, number>; coherence?: number; collapsed?: string; runner_up?: string; margin?: number }
    | undefined;
  const anti = res?.self_evaluation?.anti;

  return (
    <div className="phys-wrap">
      <header className="phys-head">
        <h1>ФИЗИКА ЯДРА</h1>
        <p>десять уравнений на настоящем состоянии Max17</p>
      </header>

      <div className="phys-actions">
        <button className="phys-btn" onClick={() => void measure()} disabled={busy}>
          {busy ? 'измеряю…' : 'измерить заново'}
        </button>
      </div>

      {error && (
        <div className="phys-empty">
          Ядро не ответило: {error}
          <br />
          Физика считается на Python — нужен запущенный мост.
          <code>{`cd ~/game\nbash mark17/install_mac_service.sh\ntail -20 ~/Library/Logs/max17bridge.log`}</code>
        </div>
      )}

      {res && (
        <div className="phys-grid">
          {gen && (
            <Card title="Генезис · T=0" eq="a ~ √t · T ~ 1/a">
              <Row label="возраст вселенной" value={gen.age_human ?? '—'} />
              <Row label="масштабный фактор" value={num(gen.scale_factor, 4)} />
              <Row label="температура" value={gen.temperature == null ? '∞' : num(gen.temperature, 2)} />
              <Row label="эпоха" value={gen.epoch_title ?? '—'} />
              <div className="phys-note">{gen.epoch_note}</div>
            </Card>
          )}

          {gen?.ether && (
            <Card title="Эфир · среда обмена" eq="c = 1/√(εμ) · Z = √(μ/ε)">
              <Row label="ε — сопротивление вниманию" value={num(gen.ether.permittivity)} />
              <Row label="μ — сопротивление памяти" value={num(gen.ether.permeability)} />
              <Row label="c — скорость обмена" value={num(gen.ether.speed)} />
              <Row label="Z — импеданс" value={num(gen.ether.impedance)} />
              <div className="phys-note">
                узкое место:{' '}
                <span className={`phys-badge ${gen.ether.bottleneck === 'balanced' ? 'ok' : 'warn'}`}>
                  {gen.ether.bottleneck === 'memory'
                    ? 'память'
                    : gen.ether.bottleneck === 'attention'
                      ? 'внимание'
                      : 'равновесие'}
                </span>
              </div>
            </Card>
          )}

          {gen?.matter && (
            <Card title="Вещество · барионная асимметрия" eq="N = asym · N₀ · exp(−T/T_bind)">
              <Row label="квантов всего" value={gen.matter.quanta ?? 0} />
              <Row label="асимметрия" value={num(gen.matter.asymmetry)} />
              <Row label="доля связанного" value={num(gen.matter.bound_fraction)} />
              <Row label="связанное вещество" value={num(gen.matter.bound_matter, 2)} />
              <div className="phys-note">
                Память существует из-за перевеса частиц над античастицами. Аннигилируй все пары —
                не осталось бы ничего.
              </div>
            </Card>
          )}

          {sup?.probabilities && (
            <Card title="Шрёдингер · маршрут до коллапса" eq="iℏ ∂ψ/∂t = Ĥψ">
              <Bars
                items={Object.entries(sup.probabilities).map(([k, v]) => ({
                  label: k,
                  value: v,
                  dim: k !== sup.collapsed,
                }))}
              />
              <Row label="когерентность" value={num(sup.coherence)} />
              <Row label="отрыв от второго" value={num(sup.margin)} />
              <div className="phys-note">
                Коллапс в «{sup.collapsed}». Ближайшая альтернатива — «{sup.runner_up}».
              </div>
            </Card>
          )}

          {anti && (
            <Card title="Дирак · античастица оценки" eq="(iγᵘ∂ᵤ − m)ψ = 0">
              <Row label="непройденный маршрут" value={anti.route ?? '—'} />
              <Row label="его оценка" value={num(anti.score)} />
              <Row label="заряд" value={num(anti.charge)} />
              <Row
                label="аннигиляция"
                value={
                  <span className={`phys-badge ${anti.annihilates ? 'bad' : 'ok'}`}>
                    {anti.annihilates ? 'да' : 'пара устойчива'}
                  </span>
                }
              />
              <div className="phys-note">{anti.correction}</div>
            </Card>
          )}

          {p?.maxwell && (
            <Card title="Максвелл · индукция трёх ядер" eq="∇×E = −∂B/∂t · ∇×B = μ₀(J + ε₀∂E/∂t)">
              <Row label="E — пластичность" value={num(p.maxwell.field?.plasticity)} />
              <Row label="B — память" value={num(p.maxwell.field?.memory)} />
              <Row label="J — llm" value={num(p.maxwell.field?.llm)} />
              <Row label="плотность энергии" value={num(p.maxwell.energy_density, 4)} />
              <Row label="ток смещения" value={num(p.maxwell.displacement_current, 4)} />
              <Row
                label="монополей нет"
                value={<span className="phys-badge ok">∇·B = {num(p.maxwell.gauss_b, 1)}</span>}
              />
              <div className="phys-note">
                Ведёт {p.maxwell.dominant_core}. Ядра не ждут друг друга: blocking ={' '}
                {String(p.maxwell.blocking)}.
              </div>
            </Card>
          )}

          {p?.yang_mills && (
            <Card title="Янг-Миллс · конфайнмент Совета" eq="αs(Q) · mass gap Δ">
              <div className="phys-colours">
                <span className="phys-colour">
                  <i style={{ background: `rgba(255,90,138,${0.25 + (p.yang_mills.colour?.red ?? 0) * 0.75})`, boxShadow: '0 0 14px rgba(255,90,138,.35)' }} />
                  пластичность
                </span>
                <span className="phys-colour">
                  <i style={{ background: `rgba(120,255,170,${0.25 + (p.yang_mills.colour?.green ?? 0) * 0.75})`, boxShadow: '0 0 14px rgba(120,255,170,.35)' }} />
                  память
                </span>
                <span className="phys-colour">
                  <i style={{ background: `rgba(79,212,255,${0.25 + (p.yang_mills.colour?.blue ?? 0) * 0.75})`, boxShadow: '0 0 14px rgba(79,212,255,.35)' }} />
                  llm
                </span>
              </div>
              <Row label="остаточный цвет" value={num(p.yang_mills.residual_colour)} />
              <Row label="αs — связь" value={num(p.yang_mills.alpha_s)} />
              <Row label="возбуждение / mass gap" value={`${num(p.yang_mills.excitation)} / ${num(p.yang_mills.mass_gap)}`} />
              <Row
                label="вердикт"
                value={
                  <span className={`phys-badge ${p.yang_mills.verdict === 'emit' ? 'ok' : p.yang_mills.verdict === 'virtual' ? 'warn' : 'bad'}`}>
                    {VERDICT_RU[p.yang_mills.verdict ?? ''] ?? p.yang_mills.verdict}
                  </span>
                }
              />
              <div className="phys-note">{p.yang_mills.note}</div>
            </Card>
          )}

          {p?.standard_model && (
            <Card title="Стандартная модель · квант события" eq="масса от Хиггса">
              <Row label="семейство" value={p.standard_model.family === 'quark' ? 'кварк (связан)' : 'лептон (свободен)'} />
              <Row label="поколение" value={p.standard_model.generation ?? '—'} />
              <Row label="аромат" value={p.standard_model.flavor ?? '—'} />
              <Row label="заряд" value={num(p.standard_model.charge)} />
              <Row label="масса" value={num(p.standard_model.mass)} />
              <Row label="переносчик" value={`${p.standard_model.boson} · ${p.standard_model.force}`} />
              <div className="phys-note">
                Масса не врождённая — она приобретена через оценку критика.
              </div>
            </Card>
          )}

          {p?.holography && (
            <Card title="Бекенштейн-Хокинг · голография" eq="S = kA / 4ℓₚ²">
              <Row label="площадь границы" value={p.holography.area ?? 0} />
              <Row label="объём графа" value={p.holography.volume ?? 0} />
              <Row label="рёбер" value={p.holography.edges ?? 0} />
              <Row label="энтропия" value={num(p.holography.entropy, 2)} />
              <Row label="температура Хокинга" value={num(p.holography.temperature, 6)} />
              <Row label="сжатие" value={`×${num(p.holography.compression, 2)}`} />
              <div className="phys-note">
                Обход идёт по границе, а не по объёму: O(A) вместо O(V).
              </div>
            </Card>
          )}

          {p?.friedmann && (
            <Card title="Фридман · вселенная памяти" eq="(ȧ/a)² = 8πGρ/3 − k/a² + Λ/3">
              <Row label="Хаббл" value={num(p.friedmann.hubble)} />
              <Row label="Ω материи" value={num(p.friedmann.omega_matter)} />
              <Row label="Ω Λ" value={num(p.friedmann.omega_lambda)} />
              <Row label="Ω кривизны" value={num(p.friedmann.omega_curvature)} />
              <Row label="разрежение" value={num(p.friedmann.dilution)} />
              <Row
                label="судьба"
                value={
                  <span className={`phys-badge ${p.friedmann.fate === 'flat' ? 'ok' : 'warn'}`}>
                    {FATE_RU[p.friedmann.fate ?? ''] ?? p.friedmann.fate}
                  </span>
                }
              />
              <div className="phys-note">{p.friedmann.note}</div>
            </Card>
          )}

          {p?.einstein && (
            <Card title="Эйнштейн · линзирование recall" eq="G + Λg = 8πG/c⁴ · T">
              <Row label="запрос" value={p.einstein.query ?? '—'} />
              <Row
                label="порядок изменился"
                value={
                  <span className={`phys-badge ${p.einstein.reordered ? 'warn' : 'ok'}`}>
                    {p.einstein.reordered ? 'да' : 'нет'}
                  </span>
                }
              />
              {(p.einstein.curved ?? []).slice(0, 3).map((h, i) => (
                <Row
                  key={h.id ?? i}
                  label={`#${h.id} · увеличение ×${num(h.magnification, 2)}`}
                  value={`${num(h.score, 3)}${h.horizon ? ' · горизонт' : ''}`}
                />
              ))}
              {(p.einstein.curved ?? []).length === 0 && (
                <div className="phys-note">
                  Память пуста — линзировать нечего. Поговори с Максом, и здесь появятся
                  воспоминания с их искривлением.
                </div>
              )}
            </Card>
          )}

          {p?.feynman?.paths && p.feynman.paths.length > 0 && (
            <Card title="Фейнман · сумма по траекториям" eq="⟨x_f|x_i⟩ = ∫Dx e^{iS/ℏ}">
              <Bars
                items={p.feynman.paths.map((path) => ({
                  label: path.path ?? '—',
                  value: path.probability ?? 0,
                  dim: !path.classical,
                }))}
              />
              <Row label="классический путь" value={p.feynman.classical_path ?? '—'} />
              <Row label="действие S" value={num(p.feynman.action, 4)} />
              <div className="phys-note">
                Набор задач фиксирован — свободен только порядок. Возвращается путь наименьшего
                действия.
              </div>
            </Card>
          )}

          {att && (
            <Card title="Внимание · аттрактор" eq="x' = sin(x²−y²+a) · y' = cos(2xy+b)">
              <Row label="a · b" value={`${num(att.a, 2)} · ${num(att.b, 2)}`} />
              <Row label="показатель Ляпунова" value={att.lyapunov == null ? '−∞' : num(att.lyapunov, 4)} />
              <Row label="окрестность" value={num(att.basin, 4)} />
              <Row label="хрупкость режима" value={num(att.fragility, 2)} />
              <Row label="период" value={att.period ?? 'нет'} />
              <Row label="покрытие плоскости" value={num(att.coverage, 4)} />
              <Row
                label="режим"
                value={
                  <span className={`phys-badge ${att.regime === 'scattered' ? 'bad' : att.regime === 'marginal' ? 'warn' : 'ok'}`}>
                    {REGIME_RU[att.regime ?? ''] ?? att.regime}
                  </span>
                }
              />
              <div className="phys-note">{att.note}</div>
            </Card>
          )}

          {flow && (
            <Card title="Навье-Стокс · поток нагрузки" eq="ρ(∂v/∂t + v·∇v) = −∇p + μ∇²v + f">
              <div className="phys-stream">
                {(flow.stream ?? []).map((v, i) => (
                  <i
                    key={i}
                    style={{
                      height: `${Math.max(4, v * 100)}%`,
                      background:
                        flow.regime === 'turbulent'
                          ? 'rgba(255,106,136,.9)'
                          : flow.regime === 'transitional'
                            ? 'rgba(255,193,84,.9)'
                            : 'rgba(79,212,255,.9)',
                    }}
                  />
                ))}
              </div>
              <Row label="Рейнольдс" value={num(flow.reynolds, 1)} />
              <Row label="вязкость (= неуверенность)" value={num(flow.state?.viscosity)} />
              <Row label="завихренность" value={num(flow.vorticity, 4)} />
              <Row label="устойчивость" value={num(flow.stability)} />
              <Row
                label="режим"
                value={
                  <span className={`phys-badge ${flow.regime === 'turbulent' ? 'bad' : flow.regime === 'transitional' ? 'warn' : 'ok'}`}>
                    {REGIME_RU[flow.regime ?? ''] ?? flow.regime}
                  </span>
                }
              />
              <div className="phys-note">{flow.advice}</div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
