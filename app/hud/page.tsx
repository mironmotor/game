import GlassesHud from '@/components/hud/GlassesHud';

export const metadata = {
  title: 'HUD для очков — GAME',
  description: 'Интерфейс под просвечивающий экран очков: чёрное значит прозрачное, кегль считается из поля зрения, всё важное в центре кадра.',
};

export default function HudPage() {
  return <GlassesHud />;
}
