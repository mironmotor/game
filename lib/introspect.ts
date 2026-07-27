// Клиент саморефлексии Макса: /api/max17 (event: introspect).

export interface Priority {
  action: string;
  why: string;
}

export interface Introspection {
  ok: boolean;
  source: string;
  assessment: string;
  mood: string;
  focus: string;
  priorities: Priority[];
  state: {
    memories: number;
    synapses_total: number;
    recent_actions: string[];
    top_relations: string[];
  };
}

export async function introspectMax(): Promise<Introspection | null> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    const res = await fetch(`${base}/api/max17`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'introspect' }),
    });
    const data = await res.json();
    const i = data?.introspection;
    if (!i?.ok) return null;
    return i as Introspection;
  } catch {
    return null;
  }
}
