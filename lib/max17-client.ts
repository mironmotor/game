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
  growth?: Max17Growth;
  concepts?: Max17Concepts;
  graph_stats?: Max17GraphStats;
  self_evaluation?: Max17SelfEvaluation;
  raw?: Record<string, unknown>;
  route_intent?: { route?: string; confidence?: number; reason?: string };
  dispatch?: { route?: string; instruction?: string };
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

function getApiPath(endpoint: string) {
  const envBasePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
  if (envBasePath) {
    return `${envBasePath}/api/${endpoint}`;
  }

  const fallbackBasePath = normalizeBasePath(FALLBACK_BASE_PATH);
  if (
    typeof window !== 'undefined' &&
    fallbackBasePath &&
    (window.location.pathname === fallbackBasePath ||
      window.location.pathname.startsWith(`${fallbackBasePath}/`))
  ) {
    return `${fallbackBasePath}/api/${endpoint}`;
  }

  return `/api/${endpoint}`;
}

function getMax17ApiPath() {
  return getApiPath('max17');
}

// Headers for the token-gated agent routes. NEXT_PUBLIC_* is inlined at build;
// on a localhost-only server this is fine and adds defense-in-depth.
function agentHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = process.env.NEXT_PUBLIC_MAX17_API_TOKEN;
  if (token) headers['x-max17-token'] = token;
  return headers;
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
  return (await response.json()) as CodeAgentResult;
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
  return (await response.json()) as DesktopResult;
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
  return (await response.json()) as ArchitectResult;
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
  return (await response.json()) as LlmConfig;
}

export async function setLlmModel(id: string, role?: string): Promise<LlmConfig> {
  const response = await fetch(getApiPath('llm-config'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, role }),
  });
  return (await response.json()) as LlmConfig;
}
