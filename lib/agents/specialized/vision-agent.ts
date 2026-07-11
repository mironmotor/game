import { BaseAgent } from '../base-agent';
import type { AgentContext, AgentInput, AgentOutput, AgentRole } from '../types';

/**
 * Vision Agent — visual context, scene, images, camera.
 *
 * It owns no camera logic itself; it reads through a VisionInputAdapter. With no
 * adapter wired it reports "not connected" honestly instead of fabricating a scene.
 */
export class VisionAgent extends BaseAgent {
  readonly id = 'vision-agent';
  readonly name = 'Vision Agent';
  readonly role: AgentRole = 'vision';
  readonly description = 'Зрение: визуальный контекст, сцена, изображения, камера.';
  readonly capabilities = ['scene-context', 'image-understanding', 'camera-presence'];

  async run(input: AgentInput, context: AgentContext): Promise<AgentOutput> {
    const vision = context.services?.vision;

    if (!vision || !vision.isAvailable()) {
      return this.output({
        summary: 'Визуальный канал не подключён — работаю без сцены.',
        insights: ['Камера/изображения недоступны (нет активного VisionInputAdapter).'],
        confidence: 0.2,
        metadata: { available: false },
      });
    }

    const obs = await vision.observe(input, context);
    if (!obs.available) {
      return this.output({
        summary: obs.description || 'Сцена недоступна.',
        confidence: 0.2,
        metadata: { available: false },
      });
    }

    const insights: string[] = [];
    if (obs.description) insights.push(`Сцена: ${obs.description}`);
    if (typeof obs.faces === 'number') insights.push(`Лиц в кадре: ${obs.faces}`);
    if (obs.labels?.length) insights.push(`Объекты: ${obs.labels.join(', ')}`);

    return this.output({
      summary: obs.description || 'Есть визуальный контекст сцены.',
      insights,
      confidence: 0.7,
      metadata: { available: true, observation: obs },
    });
  }
}
