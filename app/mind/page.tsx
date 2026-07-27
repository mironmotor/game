import SelfAwareness from '@/components/mind/SelfAwareness';
import AuthGate from '@/components/auth/AuthGate';
import AccountChip from '@/components/auth/AccountChip';

export const metadata = {
  title: 'САМОСОЗНАНИЕ — Макс о себе',
  description: 'Макс смотрит на своё реальное состояние (память, синапсы, действия) и решает, что делать дальше.',
};

export default function MindPage() {
  return (
    <AuthGate>
      <AccountChip />
      <SelfAwareness />
    </AuthGate>
  );
}
