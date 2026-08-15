import type { Metadata } from 'next';
import DensityEye from '@/components/eye/DensityEye';

export const metadata: Metadata = {
  title: 'EYE · проекция плотности — GAME',
  description: 'Глаз, который проявляется сам: миллионы шагов по аттрактору складываются в плотность, а плотность — в изображение.',
};

export default function EyePage() {
  return <DensityEye />;
}
