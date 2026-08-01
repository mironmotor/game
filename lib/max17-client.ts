export interface Max17RecalledMemory {
  id?: number;
  timestamp?: number;
  event_type?: string;
  text?: string;
  importance?: number;
  score?: number;
  summary?: string;
  reinforce?: string;
  /** Gravitational lensing applied to this hit during recall. */
  magnification?: number;
  /** Fraction of wall-clock time this memory experienced as proper time. */
  dilation?: number;
  /** True when the query passed inside this memory's Schwarzschild radius. */
  horizon?: boolean;
}

export interface Max17Memory {
  recalled?: Max17RecalledMemory[];
  semantic?: Max17RecalledMemory[];
  [key: string]: unknown;
}

/** Dirac antiparticle: the evaluation of the route that was not taken. */
export interface Max17AntiEvaluation {
  route?: string;
  score?: number;
  reason?: string;
  charge?: number;
  annihilates?: boolean;
  energy_released?: number;
  correction?: string;
}

export interface Max17SelfEvaluation {
  score?: number;
  reason?: string;
  store_memory?: boolean;
  reinforce?: string;
  anti?: Max17AntiEvaluation;
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

/** Friedmann reading of the memory universe during sleep. */
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

export interface Max17Consolidation {
  patterns_created?: number;
  patterns?: Max17Pattern[];
  /** Patterns thinned out below the survival floor by the Lambda term. */
  evaporated?: Max17Pattern[];
  cosmology?: Max17Cosmology;
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

/** One trajectory in the Feynman sum over histories. */
export interface Max17PlanPath {
  path?: string;
  label?: string;
  order?: number[];
  action?: number;
  amplitude?: number;
  probability?: number;
  classical?: boolean;
}

export interface Max17Plan {
  ok?: boolean;
  goal?: string;
  domain?: string;
  horizon_days?: number;
  tasks?: Max17PlanTask[];
  total_xp?: number;
  first_move?: string;
  summary?: string;
  principle?: string;
  /** Name of the stationary-action trajectory that was chosen. */
  path?: string;
  /** Action S of the chosen trajectory. */
  action?: number;
  paths?: Max17PlanPath[];
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

/** Schrödinger: the routing state vector before it collapsed. */
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

/** Standard Model: the canonised quantum this event became. */
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

/** Maxwell: non-blocking induction between plasticity, memory and llm. */
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

/** Yang-Mills: colour confinement and the mass gap of the Council. */
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

/** Bekenstein-Hawking: the holographic boundary of the synapse graph. */
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

/** Navier-Stokes: cognitive load as pipe flow, for the HUD. */
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

/**
 * Динамика внимания: отображение fractal eye
 *   x' = sin(x² − y² + a),  y' = cos(2xy + b)
 * с параметрами, снятыми с настоящего состояния ядра.
 */
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

export interface Max17Response {
  ok?: boolean;
  route: string;
  memory: Max17Memory;
  plasticity: Record<string, unknown>;
  llm: Record<string, unknown>;
  confidence: number;
  next_adaptation: string;
  answer?: Max17Answer;
  synapses?: Max17Synapses;
  consolidation?: Max17Consolidation;
  self_evaluation?: Max17SelfEvaluation;
  voice?: Max17VoiceState;
  plan?: Max17Plan;
  graph?: Max17Graph;
  physics?: Max17Physics;
  flow?: Max17Flow;
  attention?: Max17Attention;
  raw?: Record<string, unknown>;
  error?: string;
  details?: unknown;
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export async function sendMax17Event(event: Record<string, unknown>): Promise<Max17Response> {
  const response = await fetch(`${BASE_PATH}/api/max17`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });

  const payload = (await response.json()) as Max17Response;

  if (!response.ok) {
    throw new Error(payload.error || `Max17 request failed with status ${response.status}`);
  }

  return payload;
}
