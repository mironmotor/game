const DEFAULT_BASE_PATH = '/game';

export function normalizeBasePath(value: string | undefined): string {
  const basePath = value ?? DEFAULT_BASE_PATH;
  if (!basePath || basePath === '/') return '';

  const withLeadingSlash = basePath.startsWith('/') ? basePath : `/${basePath}`;
  return withLeadingSlash.replace(/\/$/, '');
}

/**
 * Единственный правильный способ собрать адрес внутри сайта.
 *
 * Читать process.env.NEXT_PUBLIC_BASE_PATH напрямую нельзя: next.config кладёт
 * туда «/», когда сайт стоит в корне (сборка mir.care идёт с GAME_BASE_PATH='').
 * Тогда `${base}/api/max17` превращается в «//api/max17» — это протокольно
 * относительный адрес, и браузер идёт на хост api, а не на свой сервер. Отсюда
 * и «ядро недоступно» на живом ядре: запрос до сайта просто не доходил.
 * normalizeBasePath сводит «/» и пустоту к «», а неизвестность — к /game.
 */
export const appBasePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
export const authBasePath = `${appBasePath}/api/auth`;
