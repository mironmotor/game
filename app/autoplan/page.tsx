import AutoPlan from '@/components/autoplan/AutoPlan';
import AuthGate from '@/components/auth/AuthGate';
import Paywall from '@/components/auth/Paywall';
import AccountChip from '@/components/auth/AccountChip';

export const metadata = {
  title: 'Автоплан — ядро Max',
  description: 'Детерминированный планировщик: цель → MGR-план на ядре mark17, без LLM.',
};

export default function AutoPlanPage() {
  return (
    <AuthGate>
      <AccountChip />
      <Paywall feature="autoplan">
        <AutoPlan />
      </Paywall>
    </AuthGate>
  );
}
