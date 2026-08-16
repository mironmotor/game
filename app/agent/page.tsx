import AgentStudio from '@/components/agent/AgentStudio';

export const metadata = {
  title: 'Облик агента — персонаж Max17',
  description: 'Собери своего агента: форма ядра, глаза, аура, характер, цвет. Облик сохраняется и используется в других режимах.',
};

export default function AgentPage() {
  return <AgentStudio />;
}
