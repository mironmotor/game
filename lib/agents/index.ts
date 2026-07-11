/**
 * Public entry point for the MAX + 7-agent system.
 *
 * Typical usage:
 *   import { createMax } from '@/lib/agents';
 *   const max = createMax();
 *   const result = await max.processUserInput('Я хочу продвинуть AstroMap и снять 3 Reels');
 */

import agentsConfig from '@/agents.config';
import { InMemoryMemoryStore, NullVisionAdapter, NullVoiceAdapter } from './adapters';
import { EventBus } from './event-bus';
import { MaxOrchestrator } from './orchestrator';
import { GrowthAgent } from './specialized/growth-agent';
import { GuardianAgent } from './specialized/guardian-agent';
import { MemoryAgent } from './specialized/memory-agent';
import { ProductAgent } from './specialized/product-agent';
import { StrategyAgent } from './specialized/strategy-agent';
import { VisionAgent } from './specialized/vision-agent';
import { VoiceAgent } from './specialized/voice-agent';
import type { Agent, AgentServices, AgentsConfig } from './types';

// Types
export * from './types';

// Core
export { EventBus } from './event-bus';
export type { AgentEventName, AgentEventMap, EventHandler } from './event-bus';
export { BaseAgent } from './base-agent';
export type { AgentOutputDraft } from './base-agent';
export { MaxOrchestrator } from './orchestrator';
export type { MaxOrchestratorOptions } from './orchestrator';

// Adapters / stores
export { InMemoryMemoryStore, NullVisionAdapter, NullVoiceAdapter } from './adapters';

// Agents
export { VisionAgent } from './specialized/vision-agent';
export { VoiceAgent } from './specialized/voice-agent';
export { MemoryAgent } from './specialized/memory-agent';
export { StrategyAgent } from './specialized/strategy-agent';
export { ProductAgent } from './specialized/product-agent';
export { GrowthAgent } from './specialized/growth-agent';
export { GuardianAgent } from './specialized/guardian-agent';

/** Instantiate the seven default agents in canonical order. */
export function buildDefaultAgents(): Agent[] {
  return [
    new VisionAgent(),
    new VoiceAgent(),
    new MemoryAgent(),
    new StrategyAgent(),
    new ProductAgent(),
    new GrowthAgent(),
    new GuardianAgent(),
  ];
}

export interface CreateMaxOptions {
  config?: AgentsConfig;
  /** Override or extend the default services (memory/vision/voice/llm). */
  services?: AgentServices;
  /** Provide a custom agent roster (defaults to the seven built-ins). */
  agents?: Agent[];
  bus?: EventBus;
}

/**
 * Assemble a ready-to-use MAX orchestrator with sensible defaults:
 *  - config from agents.config.ts
 *  - an in-memory MemoryStore (swap for persistent later)
 *  - honest null Vision/Voice adapters (swap for camera/mic later)
 */
export function createMax(options: CreateMaxOptions = {}): MaxOrchestrator {
  const config = options.config ?? agentsConfig;
  const services: AgentServices = {
    memory: new InMemoryMemoryStore(),
    vision: new NullVisionAdapter(),
    voice: new NullVoiceAdapter(),
    ...options.services,
  };
  const agents = options.agents ?? buildDefaultAgents();
  const bus = options.bus ?? new EventBus();
  return new MaxOrchestrator({ agents, config, services, bus });
}
