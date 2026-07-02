import NeuralBrain from '@/components/brain/NeuralBrain';

export const metadata = {
  title: 'EdgeAI — Нейро-мозг агента',
  description: 'Визуализатор нейросети: слои, нейроны, синапсы и живой прогон сигнала.',
};

export default function BrainPage() {
  return <NeuralBrain />;
}
