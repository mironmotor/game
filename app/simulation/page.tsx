import MaxSim from '@/components/simulation/MaxSim';

export const metadata = {
  title: 'Симуляция Макса — управляемый хаос',
  description: '3D-мир частиц, которым управляет ядро Max: промпт меняет форму, палитру и динамику.',
};

export default function SimulationPage() {
  return (
    <MaxSim />
  );
}
