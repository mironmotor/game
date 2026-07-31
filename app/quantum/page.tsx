import QuantumDream from '@/components/quantum/QuantumDream';
import AuthGate from '@/components/auth/AuthGate';
import AccountChip from '@/components/auth/AccountChip';

export const metadata = {
  title: 'КВАНТОВЫЙ СОН ∴ G = MIRON',
  description: 'Симуляция системы в режиме сна/облика. Сны-рилс, резонанс реальной жизни, формула G = MIRON.',
};

export default function QuantumPage() {
  return (
    <AuthGate>
      <AccountChip />
      <QuantumDream />
    </AuthGate>
  );
}
