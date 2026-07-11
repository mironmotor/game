import { BaseAgent } from '../base-agent';
import type { AgentContext, AgentInput, AgentOutput, AgentRole } from '../types';

/**
 * Voice Agent — voice, speech, intonation, energy, emotional state.
 *
 * Reads through a VoiceInputAdapter. With no microphone wired it reports
 * "not connected" rather than guessing an emotion.
 */
export class VoiceAgent extends BaseAgent {
  readonly id = 'voice-agent';
  readonly name = 'Voice Agent';
  readonly role: AgentRole = 'voice';
  readonly description = 'Голос: речь, интонация, энергия, эмоциональное состояние.';
  readonly capabilities = ['transcript', 'energy', 'emotion-estimate'];

  async run(input: AgentInput, context: AgentContext): Promise<AgentOutput> {
    const voice = context.services?.voice;

    if (!voice || !voice.isAvailable()) {
      return this.output({
        summary: 'Голосовой канал не подключён — оцениваю только текст.',
        insights: ['Аудио недоступно (нет активного VoiceInputAdapter).'],
        confidence: 0.2,
        metadata: { available: false },
      });
    }

    const obs = await voice.observe(input, context);
    if (!obs.available) {
      return this.output({
        summary: obs.description || 'Голос недоступен.',
        confidence: 0.2,
        metadata: { available: false },
      });
    }

    const insights: string[] = [];
    if (obs.emotion) insights.push(`Эмоциональный тон: ${obs.emotion}.`);
    if (typeof obs.energy === 'number') insights.push(`Энергия голоса: ${Math.round(obs.energy * 100)}%.`);
    if (obs.transcript) insights.push(`Расшифровка: «${obs.transcript}».`);

    return this.output({
      summary: obs.emotion ? `Слышу состояние: ${obs.emotion}.` : 'Есть голосовой сигнал.',
      insights,
      confidence: 0.65,
      metadata: { available: true, observation: obs },
    });
  }
}
