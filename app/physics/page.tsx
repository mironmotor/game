import PhysicsPanel from '@/components/physics/PhysicsPanel';

// БЕЗ AuthGate — намеренно. Физика read-only и ничего в ядре не меняет, а
// Firebase Auth отказывает на превью-доменах Vercel (auth/unauthorized-domain).
// Экран, который нельзя открыть, бесполезен.

export const metadata = {
  title: 'ФИЗИКА ЯДРА — десять уравнений Max17',
  description:
    'Эйнштейн, Шрёдингер, Дирак, Максвелл, Стандартная модель, Янг-Миллс, Фридман, ' +
    'Бекенштейн-Хокинг, Фейнман, Навье-Стокс — на настоящем состоянии ядра.',
};

export default function PhysicsPage() {
  return <PhysicsPanel />;
}
