/**
 * BaseAgent — the shared skeleton every specialized agent extends.
 *
 * It supplies identity (id/name/role/description/capabilities), a default
 * `canHandle` (always true; specialized agents narrow it) and an `output()`
 * helper that guarantees a well-formed, clamped AgentOutput.
 */

import { clamp01 } from './nlp';
import type { Agent, AgentContext, AgentInput, AgentOutput, AgentRole } from './types';

export interface AgentOutputDraft {
  summary: string;
  insights?: string[];
  actions?: string[];
  risks?: string[];
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export abstract class BaseAgent implements Agent {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly role: AgentRole;
  abstract readonly description: string;
  abstract readonly capabilities: string[];

  abstract run(input: AgentInput, context: AgentContext): Promise<AgentOutput>;

  /** Default: every agent can handle every input. Specialized agents override. */
  canHandle(_input: AgentInput, _context: AgentContext): boolean {
    return true;
  }

  /** Build a normalized AgentOutput; fills agentId/role and clamps confidence. */
  protected output(draft: AgentOutputDraft): AgentOutput {
    return {
      agentId: this.id,
      role: this.role,
      summary: draft.summary,
      insights: draft.insights ?? [],
      actions: draft.actions ?? [],
      risks: draft.risks,
      confidence: clamp01(draft.confidence ?? 0.5),
      metadata: draft.metadata,
    };
  }
}
