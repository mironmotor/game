import EvolutionForge from '@/components/evolution/EvolutionForge';

export const metadata = {
  title: 'Эволюционная кузница — 1 трлн синапсов',
  description: 'Фрактальная эволюция: z = z²·c + abs(c), рост до 10¹² синапсов за 2000 лет.',
};

export default function EvolutionPage() {
  return (
    <EvolutionForge />
  );
}
