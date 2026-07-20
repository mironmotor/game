import MaxGraph from '@/components/maxgraph/MaxGraph';
import AuthGate from '@/components/auth/AuthGate';
import Paywall from '@/components/auth/Paywall';
import AccountChip from '@/components/auth/AccountChip';

export const metadata = {
  title: 'Синапс-граф ядра Max',
  description: 'Реальный синапс-граф mark17 — узлы и взвешенные связи, force-directed.',
};

export default function MaxGraphPage() {
  return (
    <AuthGate>
      <AccountChip />
      <Paywall feature="maxgraph">
        <MaxGraph />
      </Paywall>
    </AuthGate>
  );
}
