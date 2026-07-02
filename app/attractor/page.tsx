import Attractor from '@/components/attractor/Attractor';

export const metadata = {
  title: 'Хаос-аттрактор — 3D',
  description: 'Живые хаотические аттракторы (Thomas, Lorenz, Aizawa, Halvorsen) в 3D.',
};

export default function AttractorPage() {
  return <Attractor />;
}
