import EvolutionForge from '@/components/evolution/EvolutionForge';
import AuthGate from '@/components/auth/AuthGate';
import Paywall from '@/components/auth/Paywall';
import AccountChip from '@/components/auth/AccountChip';

export const metadata = {
  title: 'Эволюционная кузница — 1 трлн синапсов',
  description: 'Фрактальная эволюция: z = z²·c + abs(c), рост до 10¹² синапсов за 2000 лет.',
};

export default function EvolutionPage() {
  return (
    <AuthGate>
      <AccountChip />
      <Paywall feature="evolution">
        <EvolutionForge />
      </Paywall>
    </AuthGate>
  );
}
