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
  self_evaluation?: Max17SelfEvaluation;
  raw?: Record<string, unknown>;
  error?: string;
  details?: unknown;
}

export async function sendMax17Event(event: Record<string, unknown>): Promise<Max17Response> {
  const response = await fetch('/api/max17', {
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
