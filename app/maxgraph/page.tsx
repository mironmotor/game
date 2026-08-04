import MaxGraph from '@/components/maxgraph/MaxGraph';

export const metadata = {
  title: 'Синапс-граф ядра Max',
  description: 'Реальный синапс-граф mark17 — узлы и взвешенные связи, force-directed.',
};

export default function MaxGraphPage() {
  return (
    <MaxGraph />
  );
}
