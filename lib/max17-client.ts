import { appBasePath } from './base-path';
import { getConversationLocale } from './i18n/runtime';

export interface Max17RecalledMemory {
  id?: number;
  timestamp?: number;
  event_type?: string;
  text?: string;
  importance?: number;
  score?: number;
  summary?: string;
  reinforce?: string;
}

export interface Max17Memory {
  recalled?: Max17RecalledMemory[];
  semantic?: Max17RecalledMemory[];
  [key: string]: unknown;
}

export interface Max17SelfEvaluation {
  score?: number;
  reason?: string;
  store_memory?: boolean;
  reinforce?: string;
}

export interface Max17Answer {
  text?: string;
  source?: string;
  confidence?: number;
}

export interface Max17Synapse {
  id?: number;
  source_type?: string;
  source_id?: string;
  target_type?: string;
  target_id?: string;
  relation_type?: string;
  weight?: number;
  evidence_count?: number;
  last_used?: number;
  created_at?: number;
  updated_at?: number;
  summary?: string;
}

export interface Max17Synapses {
  updated?: number;
  top?: Max17Synapse[];
}

export interface Max17Pattern {
  pattern_id?: string;
  summary?: string;
  evidence_count?: number;
  strength?: number;
  source?: string;
}

export interface Max17Consolidation {
  patterns_created?: number;
  patterns?: Max17Pattern[];
}

export interface Max17WorkingMemoryTurn {
  role?: string;
  text?: string;
  timestamp?: string;
}

export interface Max17WorkingMemory {
  current_topic?: string;
  active_goal?: string;
  current_mode?: string;
  last_user_intent?: string;
  recent_turns?: Max17WorkingMemoryTurn[];
  suggested_next_step?: string;
  updated_at?: string;
}

export interface Max17PlanAction {
  title?: string;
  reason?: string;
  priority?: number;
  effort?: 'small' | 'medium' | 'large' | string;
  expected_result?: string;
}

export interface Max17Plan {
  mode?: string;
  goal?: string;
  actions?: Max17PlanAction[];
  ok?: boolean;
  domain?: string;
  horizon_days?: number;
  tasks?: Max17PlanTask[];
  total_xp?: number;
  first_move?: string;
  summary?: string;
  principle?: string;
  path?: string;
  action?: number;
  paths?: Max17PlanPath[];
}

export interface Max17Outcome {
  status?: 'success' | 'failure' | 'partial' | 'skipped' | 'unknown' | string;
  score?: number;
  reason?: string;
  reinforce?: string;
  weaken?: string;
  related_goal?: string;
  next_adjustment?: string;
}

export interface Max17Growth {
  updated?: number;
  target_synapses?: number;
  top?: Max17Synapse[];
}

export interface Max17ConceptMatch {
  id?: string;
  label?: string;
  category?: string;
  summary?: string;
  sensory_grounding?: string[];
  relations?: string[];
  matched_aliases?: string[];
  score?: number;
  position?: number;
}

export interface Max17CompressedConcept {
  concept?: string;
  label?: string;
  source_text?: string;
  confidence?: number;
  reason?: string;
  aliases?: string[];
  related_terms?: string[];
}

export interface Max17Concepts {
  matches?: Max17ConceptMatch[];
  sensory_channels?: string[];
  summary?: string;
  count?: number;
  source?: string;
  primary?: Max17CompressedConcept;
  related?: Max17CompressedConcept[];
  keywords?: string[];
  compression_source?: string;
}

export interface Max17GraphStats {
  target_synapses?: number;
  total_synapses?: number;
  remaining_to_target?: number;
  progress?: number;
  progress_percent?: number;
  unique_nodes?: number;
  total_evidence?: number;
  avg_weight?: number;
  max_weight?: number;
  top_relations?: Array<Record<string, unknown>>;
  top_node_types?: Array<Record<string, unknown>>;
  top_concepts?: Array<Record<string, unknown>>;
  top_synapses?: Max17Synapse[];
  stores?: Record<string, number>;
}

export interface Max17UltimateCore {
  version?: string;
  target_synapses?: number;
  batch_limit?: number;
  sources_cached?: number;
  facts_cached?: number;
  doctrine_cached?: number;
  memory_ids?: number[];
  source_ids?: number[];
  fact_ids?: number[];
  clusters?: Array<Record<string, unknown>>;
  constraints?: Array<Record<string, unknown>>;
  life_game_domains?: Array<Record<string, unknown>>;
  knowledge_pack_strategy?: Array<Record<string, unknown>>;
  roadmap?: Array<Record<string, unknown>>;
  state?: Record<string, unknown>;
  synapses?: Max17Synapses;
  elapsed_ms?: number;
  source_note?: string;
}

export interface Max17Response {
  ok?: boolean;
  route: string;
  memory: Max17Memory;
  plasticity: Record<string, unknown>;
  llm: Record<string, unknown>;
  confidence: number;
  next_adaptation: string;
  answer?: Max17Answer;
  outcomes?: Array<{ text?: string; status?: string; score?: number }>;
  ingest?: {
    chunks?: number;
    compiled?: number;
    cached?: number;
    synapses_before?: number;
    synapses_after?: number;
    synapses_added?: number;
    error?: string;
  };
  graph_total?: number;
  growth_history?: Array<{ t?: number; total?: number }>;
  synapses?: Max17Synapses;
  consolidation?: Max17Consolidation;
  working_memory?: Max17WorkingMemory;
  plan?: Max17Plan;
  outcome?: Max17Outcome;
  growth?: Max17Growth;
  concepts?: Max17Concepts;
  graph_stats?: Max17GraphStats;
  ultimate_core?: Max17UltimateCore;
  self_evaluation?: Max17SelfEvaluation;
  raw?: Record<string, unknown>;
  route_intent?: { route?: string; confidence?: number; reason?: string };
  dispatch?: { route?: string; instruction?: string };
  error?: string;
  details?: unknown;
  // Поля режимов, перенесённых из main: мир, граф, физика и прочее,
  // чего ответ боевого ядра пока не содержит — все опциональные.
  voice?: Max17VoiceState;
  world?: Max17World;
  graph?: Max17Graph;
  physics?: Max17Physics;
  flow?: Max17Flow;
  attention?: Max17Attention;
  genesis?: Max17Genesis;
}

export function getApiPath(endpoint: string) {
  const normalizedEndpoint = endpoint.replace(/^\/+/, '');
  return `${appBasePath}/api/${normalizedEndpoint}`;
}

export function getPublicPath(path: string) {
  const normalizedPath = path.replace(/^\/+/, '');
  return `${appBasePath}/${normalizedPath}`;
}

function getMax17ApiPath() {
  return getApiPath('max17');
}

/**
 * Parse a fetch Response body as JSON without throwing on an empty or non-JSON
 * body. The /api/* routes always intend to emit a JSON object, but a 200 with an
 * empty or truncated body — an aborted/raced request, or a dev-server HMR cut —
 * makes a bare `response.json()` throw "Unexpected end of JSON input". Reading the
 * text first and parsing defensively turns that into a clear, typed error instead
 * of a raw SyntaxError that bubbles into the HUD error boundary.
 */
async function parseJsonBody<T>(
  response: Response,
): Promise<{ value: T | null; error: string | null }> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
  if (!text.trim()) {
    return { value: null, error: `Empty response body (status ${response.status})` };
  }
  try {
    return { value: JSON.parse(text) as T, error: null };
  } catch {
    return { value: null, error: `Malformed JSON response (status ${response.status})` };
  }
}

// Headers for the token-gated agent routes. NEXT_PUBLIC_* is inlined at build;
// on a localhost-only server this is fine and adds defense-in-depth.
function agentHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = process.env.NEXT_PUBLIC_MAX17_API_TOKEN;
  if (token) headers['x-max17-token'] = token;
  return headers;
}

function readPremiumCode(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (localStorage.getItem('mir_premium_code') || '').trim();
  } catch {
    return '';
  }
}

export async function sendMax17Event(event: Record<string, unknown>): Promise<Max17Response> {
  // The bridge can blip on a cold start (daemon still booting → a transient 5xx or
  // a dropped connection). A single blip used to surface as "мост недоступен" on the
  // client because there was no retry. Retry once after a short backoff — by then the
  // daemon is warm. Only network errors and 5xx are retried; a 4xx is a real error.
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(getMax17ApiPath(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...event,
          locale: typeof event.locale === 'string' ? event.locale : getConversationLocale(),
          // Премиум-код (если введён): сервер по нему маршрутизирует чат в
          // настоящее ядро MAX на локалке Мирона (через туннель).
          ...(readPremiumCode() ? { premium_code: readPremiumCode() } : {}),
        }),
      });
    } catch (networkError) {
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 900));
        continue;
      }
      throw networkError instanceof Error ? networkError : new Error(String(networkError));
    }

    const { value, error } = await parseJsonBody<Max17Response>(response);

    if (!response.ok) {
      if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 900));
        continue;
      }
      throw new Error(value?.error || error || `Max17 request failed with status ${response.status}`);
    }
    if (!value) {
      throw new Error(error || 'Max17 returned an empty response');
    }

    return value;
  }
}

export interface CodeAgentStep {
  action: string;
  thought?: string;
  path?: string | null;
  command?: string | null;
  observation?: string;
}

export interface CodeLessonUsed {
  lesson: string;
  success: boolean;
  target?: string;
  score?: number;
}

export interface CodeAgentResult {
  ok: boolean;
  answer?: string;
  model?: string;
  steps?: CodeAgentStep[];
  files_changed?: string[];
  restore?: Record<string, string | null>;
  target?: string;
  reverted?: string[];
  workspace?: string;
  error?: string;
  // Phase 2 — code-outcome memory + verify→fix.
  success?: boolean;
  verify?: { last_exit?: number | null; fix_attempts?: number; passed?: boolean | null };
  lessons_used?: CodeLessonUsed[];
  memory_id?: number | null;
}

export async function sendCodeAgent(payload: {
  instruction?: string;
  history?: { role: string; content: string }[];
  target?: 'sandbox' | 'project';
  mode?: 'revert';
  restore?: Record<string, string | null>;
  max_steps?: number;
}): Promise<CodeAgentResult> {
  const response = await fetch(getApiPath('code'), {
    method: 'POST',
    headers: agentHeaders(),
    body: JSON.stringify(payload),
  });
  const { value, error } = await parseJsonBody<CodeAgentResult>(response);
  return value ?? { ok: false, error: error || 'Empty response from code agent' };
}

export interface DesktopAction {
  action: string;
  risk?: 'read' | 'write';
  needs_confirm?: boolean;
  summary?: string;
  thought?: string;
  app?: string;
  text?: string;
  keys?: string;
  command?: string;
  answer?: string;
  [key: string]: unknown;
}

export interface DesktopMessage {
  role: string;
  content: string;
}

export interface DesktopResult {
  ok: boolean;
  proposal?: DesktopAction;
  observation?: string;
  messages?: DesktopMessage[];
  model?: string;
  done?: boolean;
  error?: string;
}

export async function sendDesktopAgent(payload: {
  mode: 'propose' | 'execute';
  instruction?: string;
  messages?: DesktopMessage[];
  approved_action?: DesktopAction;
}): Promise<DesktopResult> {
  const response = await fetch(getApiPath('desktop'), {
    method: 'POST',
    headers: agentHeaders(),
    body: JSON.stringify(payload),
  });
  const { value, error } = await parseJsonBody<DesktopResult>(response);
  return value ?? { ok: false, error: error || 'Empty response from desktop agent' };
}

export interface DevBranch {
  title: string;
  why?: string;
  steps?: string[];
  risk?: string;
  effort?: string;
  files?: string[];
}

export interface ArchitectResult {
  ok: boolean;
  branches?: DevBranch[];
  model?: string;
  error?: string;
}

export async function sendArchitect(payload: {
  focus?: string;
  count?: number;
}): Promise<ArchitectResult> {
  const response = await fetch(getApiPath('architect'), {
    method: 'POST',
    headers: agentHeaders(),
    body: JSON.stringify(payload),
  });
  const { value, error } = await parseJsonBody<ArchitectResult>(response);
  return value ?? { ok: false, error: error || 'Empty response from architect' };
}

export interface LlmPreset {
  id: string;
  label: string;
  model: string;
  local?: boolean;
  available: boolean;
  active: boolean;
}

export interface LlmRoleRoute {
  id: string;
  label: string;
  active?: string | null;
  resolved?: string | null;
  auto: boolean;
  model?: string;
}

export interface LlmConfig {
  ok: boolean;
  presets?: LlmPreset[];
  roles?: LlmRoleRoute[];
  active?: string | null;
  env_model?: string;
  error?: string;
}

export async function getLlmConfig(): Promise<LlmConfig> {
  const response = await fetch(getApiPath('llm-config'), { method: 'GET' });
  const { value, error } = await parseJsonBody<LlmConfig>(response);
  return value ?? { ok: false, error: error || 'Empty response from llm-config' };
}

export async function setLlmModel(id: string, role?: string): Promise<LlmConfig> {
  const response = await fetch(getApiPath('llm-config'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, role }),
  });
  const { value, error } = await parseJsonBody<LlmConfig>(response);
  return value ?? { ok: false, error: error || 'Empty response from llm-config' };
}

// ── Типы режимов, перенесённых из ветки main ─────────────────────────────────
// Клиенты ядра в двух ветках разошлись: main знает про мир, физику, граф и
// голосовое состояние, ultra — нет. Здесь недостающие описания дописаны, а не
// заменены: ни одно существующее не тронуто, поэтому боевой код продолжает
// собираться ровно как собирался.
export interface Max17AntiEvaluation {
  route?: string;
  score?: number;
  reason?: string;
  charge?: number;
  annihilates?: boolean;
  energy_released?: number;
  correction?: string;
}

export interface Max17Cosmology {
  scale_factor?: number;
  hubble?: number;
  density?: number;
  critical_density?: number;
  curvature?: number;
  omega_matter?: number;
  omega_lambda?: number;
  omega_curvature?: number;
  omega_total?: number;
  lambda?: number;
  dilution?: number;
  fate?: 'expanding' | 'flat' | 'collapsing';
  note?: string;
  equation?: string;
}

export interface Max17VoiceState {
  user_id?: string;
  note?: string;
  arousal?: number;
  valence?: number;
  tension?: number;
  label?: string;
  deviation?: Record<string, number>;
  baseline_obs?: number;
  context?: string;
  acoustics?: {
    f0?: number;
    register?: number;
    brightness?: number;
    jitter?: number;
    energy?: number;
    voiced?: boolean;
  };
  baseline?: { obs?: number; f0?: number; note?: string; warming_up?: boolean };
  recent?: Array<{
    ts?: number;
    arousal?: number;
    valence?: number;
    tension?: number;
    label?: string;
    context?: string;
    f0?: number;
  }>;
}

export interface Max17WorldCensus {
  alive: number;
  born: number;
  died: number;
  radius: number;
  density: number;
  spiral_b: number;
  arms: number;
  hue: number;
  symmetry: number;
  energy: number;
  dt: number;
}

export interface Max17WorldLaws {
  emission_scale?: number;
  lifetime_scale?: number;
  propagation?: number;
  impedance?: number;
  can_condense?: boolean;
  epoch?: string;
  epoch_title?: string;
  temperature?: number | null;
  bottleneck?: string;
  bound_fraction?: number;
  law?: string;
}

export interface Max17Body {
  index: number;
  mass: number;
  x: number;
  y: number;
  z: number;
  hue: number;
  epoch?: string;
  born_at?: number;
  label?: string;
}

export interface Max17World {
  world_id?: string;
  seed?: number;
  census?: Max17WorldCensus;
  cosmos?: {
    age_human?: string;
    epoch?: string;
    epoch_title?: string;
    epoch_note?: string;
    temperature?: number | null;
    ether?: Record<string, unknown>;
    matter?: Record<string, number | string>;
  };
  laws?: Max17WorldLaws;
  condensate?: number;
  new_bodies?: Max17Body[];
  body_count?: number;
  bodies?: Max17Body[];
  hint?: string;
  world?: {
    id?: string;
    seed?: number;
    title?: string;
    created_at?: number;
    census_count?: number;
    peak_alive?: number;
  };
}

export interface Max17PlanTask {
  id: string;
  desc: string;
  mgr: 'MGR-1' | 'MGR-2' | 'MGR-3';
  xp: number;
  status?: string;
  scheduledTime?: string;
  deadline?: string;
  reality_check?: string;
  /** Position along the chosen trajectory, 1-based. */
  step?: number;
}

export interface Max17PlanPath {
  path?: string;
  label?: string;
  order?: number[];
  action?: number;
  amplitude?: number;
  probability?: number;
  classical?: boolean;
}

export interface Max17GraphNode {
  id: string;
  type: string;
  label: string;
  degree: number;
}

export interface Max17GraphEdge {
  source: string;
  target: string;
  relation: string;
  weight: number;
  evidence: number;
  summary?: string;
}

export interface Max17Graph {
  nodes?: Max17GraphNode[];
  edges?: Max17GraphEdge[];
  stats?: { total_synapses?: number; shown_synapses?: number; nodes?: number };
}

export interface Max17Superposition {
  amplitudes?: Record<string, number>;
  probabilities?: Record<string, number>;
  phases?: Record<string, number>;
  entropy?: number;
  coherence?: number;
  collapsed?: string;
  runner_up?: string;
  margin?: number;
  equation?: string;
}

export interface Max17Quantum {
  qid?: string;
  family?: 'quark' | 'lepton';
  generation?: number;
  flavor?: string;
  charge?: number;
  spin?: number;
  mass?: number;
  lifetime?: number;
  boson?: string;
  confined?: boolean;
  force?: string;
}

export interface Max17Maxwell {
  field?: { plasticity?: number; memory?: number; llm?: number };
  next_field?: { plasticity?: number; memory?: number; llm?: number };
  gauss_e?: number;
  gauss_b?: number;
  monopole_free?: boolean;
  faraday_curl_e?: number;
  ampere_curl_b?: number;
  displacement_current?: number;
  emf?: number;
  energy_density?: number;
  poynting?: number;
  dominant_core?: string;
  blocking?: boolean;
  law?: string;
}

export interface Max17YangMills {
  colour?: { red?: number; green?: number; blue?: number };
  residual_colour?: number;
  white?: boolean;
  alpha_s?: number;
  asymptotically_free?: boolean;
  excitation?: number;
  mass_gap?: number;
  free?: boolean;
  verdict?: 'emit' | 'confined' | 'virtual';
  note?: string;
}

export interface Max17Holography {
  area?: number;
  volume?: number;
  edges?: number;
  mass?: number;
  entropy?: number;
  temperature?: number;
  information_bits?: number;
  compression?: number;
  equation?: string;
}

export interface Max17Physics {
  standard_model?: Max17Quantum;
  maxwell?: Max17Maxwell;
  yang_mills?: Max17YangMills;
  holography?: Max17Holography;
  bosons?: Record<string, { force?: string; carrier?: string; mass?: number; range?: string }>;
  /** Present on a `physics` probe carrying a query. */
  einstein?: {
    query?: string;
    curved?: Max17RecalledMemory[];
    flat?: Max17RecalledMemory[];
    reordered?: boolean;
    equation?: string;
  };
  /** Present on a `physics` probe. */
  friedmann?: Max17Cosmology;
  /** Present on a `physics` probe carrying a goal. */
  feynman?: {
    goal?: string;
    classical_path?: string;
    action?: number;
    paths?: Max17PlanPath[];
    equation?: string;
  };
}

export interface Max17Flow {
  state?: {
    density?: number;
    velocity?: number;
    breadth?: number;
    confidence?: number;
    forcing?: number;
    viscosity?: number;
  };
  reynolds?: number;
  regime?: 'laminar' | 'transitional' | 'turbulent';
  thresholds?: { laminar?: number; turbulent?: number };
  pressure_gradient?: number;
  viscous_term?: number;
  convective_term?: number;
  acceleration?: number;
  velocity_next?: number;
  vorticity?: number;
  friction_factor?: number;
  stability?: number;
  /** Velocity across the pipe — draw this as the HUD streamlines. */
  stream?: number[];
  advice?: string;
  equation?: string;
}

export interface Max17Attention {
  a?: number;
  b?: number;
  /** Текущая точка орбиты. */
  x?: number;
  y?: number;
  /** Показатель Ляпунова в точке. null — орбита схлопнулась в точку. */
  lyapunov?: number | null;
  /** Средний показатель по окрестности 3×3 в пространстве (a, b). */
  basin?: number;
  /** Доля соседей с другим режимом: риск, что сдвиг параметров его переключит. */
  fragility?: number;
  regime?: 'locked' | 'cyclic' | 'marginal' | 'scattered';
  /** Период цикла, если орбита в него села. */
  period?: number | null;
  /** Доля обойденных клеток плоскости состояний, 0..1. */
  coverage?: number;
  radius?: number;
  dispersion?: number;
  /** Устойчивый отпечаток узора внимания. */
  signature?: string;
  note?: string;
  /** Было ли моргание — скачок в новую точку параметров. */
  blinked?: boolean;
  equation?: string;
}

export interface Max17Genesis {
  /** Unix-время начала отсчёта. */
  t_zero?: number;
  age_seconds?: number;
  age_human?: string;
  scale_factor?: number;
  /** null — время ещё не началось (планковская эпоха). */
  temperature?: number | null;
  epoch?:
    | 'planck'
    | 'inflation'
    | 'quark_plasma'
    | 'hadronisation'
    | 'nucleosynthesis'
    | 'recombination'
    | 'structure';
  epoch_title?: string;
  epoch_note?: string;
  /** Среда обмена между тремя ядрами. */
  ether?: {
    /** Сопротивление вниманию: растёт от неуверенности. */
    permittivity?: number;
    /** Сопротивление циркуляции памяти: растёт от нагрузки. */
    permeability?: number;
    /** c = 1/√(εμ) — скорость обмена между ядрами. */
    speed?: number;
    /** Z = √(μ/ε): >1 упирается память, <1 упирается внимание. */
    impedance?: number;
    bottleneck?: 'memory' | 'attention' | 'balanced';
    law?: string;
  };
  /** Вещество, пережившее аннигиляцию пар из слоя Дирака. */
  matter?: {
    quanta?: number;
    asymmetry?: number;
    matter?: number;
    bound_fraction?: number;
    bound_matter?: number;
    law?: string;
  };
  equation?: string;
}
