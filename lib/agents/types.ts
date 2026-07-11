/**
 * Shared types for the MAX + 7-agent architecture.
 *
 * Framework-agnostic on purpose: no React / Next / Node imports here, so the
 * agent core can run inside an API route (node runtime), in the browser, or in
 * a worker. MAX is the central orchestrator; the seven agents are specialized
 * "organs" that only ever talk to MAX, never to each other or to the app.
 */

/** The seven specialized agent roles. MAX itself is the orchestrator, not an agent. */
export type AgentRole =
  | 'vision'
  | 'voice'
  | 'memory'
  | 'strategy'
  | 'product'
  | 'growth'
  | 'guardian';

/** Canonical order. Guardian is intentionally last (final stabilization pass). */
export const AGENT_ROLES: AgentRole[] = [
  'vision',
  'voice',
  'memory',
  'strategy',
  'product',
  'growth',
  'guardian',
];

/** Raw input that enters the system, normally from the user via MAX. */
export interface AgentInput {
  /** Primary natural-language text. */
  text: string;
  /** Optional locale hint, e.g. 'ru' | 'en'. Auto-detected if omitted. */
  locale?: string;
  /** Optional references to visual input (resolved by a VisionInputAdapter). */
  images?: VisionRef[];
  /** Optional reference to audio/voice input (resolved by a VoiceInputAdapter). */
  audio?: VoiceRef;
  /** Free-form extra signals. */
  metadata?: Record<string, unknown>;
}

export interface VisionRef {
  id?: string;
  url?: string;
  kind?: 'camera' | 'image' | 'screen' | string;
}

export interface VoiceRef {
  id?: string;
  url?: string;
  durationMs?: number;
}

/** A single conversation turn (history). */
export interface ConversationTurn {
  role: 'user' | 'max' | 'agent' | string;
  text: string;
  timestamp?: string;
}

/** A recalled / stored memory record. */
export interface MemoryRecord {
  id?: string;
  text: string;
  kind?: 'fact' | 'pattern' | 'preference' | 'event' | string;
  score?: number;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

/** A repeating motif detected across memories. */
export interface MemoryPattern {
  id?: string;
  summary: string;
  evidenceCount?: number;
  strength?: number;
}

/** A past outcome relevant to the current goal — what worked / what failed. */
export interface OutcomeMemory {
  text: string;
  status: 'success' | 'failure' | 'partial' | 'skipped' | string;
  score?: number;
}

/**
 * Persistent-memory boundary. Today this is backed by an in-memory stub
 * (InMemoryMemoryStore); later it can wrap the Max17 core or any DB without
 * touching the agents that consume it.
 */
export interface MemoryStore {
  getRelevantMemories(query: string, limit?: number): Promise<MemoryRecord[]>;
  saveMemory(record: MemoryRecord): Promise<MemoryRecord>;
  detectPatterns(records?: MemoryRecord[]): Promise<MemoryPattern[]>;
  /** Optional: outcomes from the most recent recall (what worked / failed). */
  lastOutcomes?(): OutcomeMemory[];
}

export interface VisionObservation {
  available: boolean;
  description?: string;
  faces?: number;
  labels?: string[];
  raw?: Record<string, unknown>;
}

/** Clean adapter for future camera/scene integration (e.g. face-detect.ts). */
export interface VisionInputAdapter {
  isAvailable(): boolean;
  observe(input: AgentInput, context: AgentContext): Promise<VisionObservation>;
}

export interface VoiceObservation {
  available: boolean;
  description?: string;
  transcript?: string;
  /** 0..1 vocal energy. */
  energy?: number;
  emotion?: string;
  raw?: Record<string, unknown>;
}

/** Clean adapter for future microphone/voice integration (e.g. voice-signature.ts). */
export interface VoiceInputAdapter {
  isAvailable(): boolean;
  observe(input: AgentInput, context: AgentContext): Promise<VoiceObservation>;
}

/**
 * Optional generative hook. Agents are deterministic by default (network-free,
 * fast, testable); provide an LlmCaller to upgrade any agent to generative
 * reasoning (e.g. wire it to the Max17 bridge or Gemini).
 */
export type LlmCaller = (
  prompt: string,
  opts?: { role?: string; system?: string; json?: boolean },
) => Promise<string>;

/** Pluggable external services handed to agents through the context. */
export interface AgentServices {
  vision?: VisionInputAdapter;
  voice?: VoiceInputAdapter;
  memory?: MemoryStore;
  llm?: LlmCaller;
}

/** Per-agent on/off toggles. */
export interface AgentsConfig {
  vision: boolean;
  voice: boolean;
  memory: boolean;
  strategy: boolean;
  product: boolean;
  growth: boolean;
  guardian: boolean;
}

/** Shared context handed to every agent on each run. */
export interface AgentContext {
  /** Stable session id (e.g. chat session). */
  sessionId?: string;
  /** Stable user id. */
  userId?: string;
  /** Wall-clock for this run (ISO). Injected for determinism/testability. */
  now: string;
  /** Recent conversation turns, newest last. */
  history?: ConversationTurn[];
  /** Memories MAX pulled for this turn (the Memory Agent reads/writes these). */
  memories?: MemoryRecord[];
  /** Past outcomes relevant to this turn — lets agents avoid what failed. */
  outcomes?: OutcomeMemory[];
  /**
   * Outputs already produced by peer agents this turn. MAX populates this so a
   * late agent (e.g. Guardian) can review peers WITHOUT talking to them directly.
   */
  peerOutputs?: AgentOutput[];
  /** Pluggable external services (vision/voice/memory/llm). All optional. */
  services?: AgentServices;
  /** Active agent toggles. */
  config?: AgentsConfig;
  /** Cooperative cancellation. */
  signal?: AbortSignal;
}

/**
 * The structured result every agent returns — never bare text. This is the
 * contract MAX relies on to filter, merge and synthesize.
 */
export interface AgentOutput {
  agentId: string;
  role: AgentRole;
  summary: string;
  insights: string[];
  actions: string[];
  risks?: string[];
  /** 0..1 self-assessed confidence. */
  confidence: number;
  metadata?: Record<string, unknown>;
}

/** The base contract for any agent in the system. */
export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  description: string;
  capabilities: string[];
  run(input: AgentInput, context: AgentContext): Promise<AgentOutput>;
  /** Optional fast filter so MAX can route selectively. Defaults to true. */
  canHandle?(input: AgentInput, context: AgentContext): boolean;
}

/** A unit of work MAX dispatches to a single agent. */
export interface AgentTask {
  id: string;
  /** Groups all tasks belonging to one processUserInput() run. */
  runId: string;
  agentId: string;
  role: AgentRole;
  input: AgentInput;
  context: AgentContext;
  createdAt: string;
}

export type AgentResultStatus = 'completed' | 'error';

/** The lifecycle-wrapped outcome of running one task. */
export interface AgentResult {
  task: AgentTask;
  status: AgentResultStatus;
  output?: AgentOutput;
  error?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

/** The mission MAX distills for the user ("mission of the day"). */
export interface Mission {
  title: string;
  focus: string[];
  why?: string;
  successCriteria?: string[];
}

export interface PrioritizedAction {
  title: string;
  role: AgentRole;
  /** 1 = highest priority. */
  priority: number;
  effort?: 'small' | 'medium' | 'large';
  reason?: string;
}

export interface AgentInsight {
  role: AgentRole;
  agentId: string;
  summary: string;
  insights: string[];
  confidence: number;
}

/** The single, unified result MAX returns after synthesis. */
export interface MaxSynthesis {
  summary: string;
  /** MAX's voiced final answer — what the orchestrator "says" after the council. */
  answer: string;
  mission: Mission;
  insights: AgentInsight[];
  actions: PrioritizedAction[];
  risks: string[];
  recommendation: string;
  /** 0..1 blended confidence across contributing agents. */
  confidence: number;
  /** Raw per-agent outputs, for transparency / debugging. */
  agents: AgentOutput[];
  meta: {
    ranAgents: AgentRole[];
    skippedAgents: AgentRole[];
    erroredAgents: AgentRole[];
    durationMs: number;
    /** True when the answer/mission/actions were refined by the LLM (deep mode). */
    deep?: boolean;
    /** True when MAX escalated to deep on its own due to low confidence. */
    autoEscalated?: boolean;
  };
}

export type OrchestratorStatus =
  | 'idle'
  | 'routing'
  | 'collecting'
  | 'synthesizing'
  | 'done'
  | 'error';

/** Snapshot of MAX's internal state for one run. */
export interface OrchestratorState {
  status: OrchestratorStatus;
  runId?: string;
  input?: AgentInput;
  tasks: AgentTask[];
  results: AgentResult[];
  synthesis?: MaxSynthesis;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}
