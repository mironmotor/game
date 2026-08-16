import AutoPlan from '@/components/autoplan/AutoPlan';

export const metadata = {
  title: 'Автоплан — ядро Max',
  description: 'Детерминированный планировщик: цель → MGR-план на ядре mark17, без LLM.',
};

export default function AutoPlanPage() {
  return (
    <AutoPlan />
  );
}
