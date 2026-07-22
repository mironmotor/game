import TgBigIdea from '@/components/telegram/TgBigIdea';

// Telegram Mini App: генератор Big Idea на ядре Max.
// БЕЗ AuthGate — в Telegram пользователь уже опознан, Firebase-логин не нужен.
export const metadata = {
  title: 'Big Idea — Max',
  description: 'Генератор Big Idea на ядре Max прямо в Telegram.',
};

export default function TgPage() {
  return <TgBigIdea />;
}
