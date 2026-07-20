import MaxSim from '@/components/simulation/MaxSim';
import AuthGate from '@/components/auth/AuthGate';
import AccountChip from '@/components/auth/AccountChip';

export const metadata = {
  title: 'Симуляция Макса — управляемый хаос',
  description: '3D-мир частиц, которым управляет ядро Max: промпт меняет форму, палитру и динамику.',
};

export default function SimulationPage() {
  return (
    <AuthGate>
      <AccountChip />
      <MaxSim />
    </AuthGate>
  );
}
