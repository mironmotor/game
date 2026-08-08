import ModesHub, { type BuildInfo } from '@/components/modes/ModesHub';

export const metadata = {
  title: 'Все режимы — GAME',
  description: 'Витрина: каждый режим и каждая команда ядра Max17 на одной странице, плюс данные текущей сборки.',
};

/**
 * Данные сборки читаются здесь, на сервере, во время билда.
 *
 * Не через NEXT_PUBLIC_*: тогда пришлось бы заводить переменные вручную в
 * каждом окружении. Vercel и так подставляет VERCEL_GIT_*, а локально
 * подставится «локальная сборка» — этого достаточно, чтобы по странице было
 * видно, что именно сейчас развёрнуто.
 */
function buildInfo(): BuildInfo {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
  return {
    sha: sha ? sha.slice(0, 7) : 'локальная сборка',
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? '',
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? 'local',
    env: process.env.VERCEL_ENV ?? 'development',
    builtAt: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
  };
}

export default function ModesPage() {
  return <ModesHub build={buildInfo()} />;
}
