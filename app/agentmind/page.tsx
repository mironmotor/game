import EfirReality from '@/components/efir/EfirReality';

export const metadata = {
  title: 'Разум агента — он решает сам',
  description:
    'Первый автономный житель мира Max17. Смотрит на мир голосом, хочет от него своего и выбирает действие по свободной энергии F = E − T·S. Ошибся в предсказании — сам себе снижает доверие к действию.',
};

export default function AgentMindPage() {
  return <EfirReality variant="agent" />;
}
