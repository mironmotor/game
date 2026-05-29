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
  working_memory?: Max17WorkingMemory;
  plan?: Max17Plan;
  outcome?: Max17Outcome;
  self_evaluation?: Max17SelfEvaluation;
  raw?: Record<string, unknown>;
  error?: string;
  details?: unknown;
}

const FALLBACK_BASE_PATH = '/game';

function normalizeBasePath(basePath: string | undefined) {
  if (!basePath || basePath === '/') {
    return '';
  }
  return basePath.startsWith('/') ? basePath : `/${basePath}`;
}

function getMax17ApiPath() {
  const envBasePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
  if (envBasePath) {
    return `${envBasePath}/api/max17`;
  }

  const fallbackBasePath = normalizeBasePath(FALLBACK_BASE_PATH);
  if (
    typeof window !== 'undefined' &&
    fallbackBasePath &&
    (window.location.pathname === fallbackBasePath ||
      window.location.pathname.startsWith(`${fallbackBasePath}/`))
  ) {
    return `${fallbackBasePath}/api/max17`;
  }

  return '/api/max17';
}

export async function sendMax17Event(event: Record<string, unknown>): Promise<Max17Response> {
  const response = await fetch(getMax17ApiPath(), {
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
