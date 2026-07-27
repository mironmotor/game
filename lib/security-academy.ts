export type CyberLabModuleId =
  | 'scope'
  | 'network'
  | 'linux'
  | 'web'
  | 'tools'
  | 'labs'
  | 'reporting';

export type CyberLabModule = {
  id: CyberLabModuleId;
  number: string;
  title: string;
  shortTitle: string;
  objective: string;
  drills: string[];
  completion: string;
  tutorStarter: string;
  resource?: { label: string; href: string };
};

export const CYBER_LAB_MODULES: CyberLabModule[] = [
  {
    id: 'scope',
    number: '01',
    title: 'Право и Scope',
    shortTitle: 'Scope',
    objective: 'Отличать авторизованный аудит от несанкционированного доступа до первого запроса к цели.',
    drills: [
      'Проверить владельца, письменное разрешение и допустимые домены.',
      'Сформулировать стоп-условия: данные, сервисы и методы вне scope.',
      'Зафиксировать безопасный proof-of-concept без вреда для пользователей.',
    ],
    completion: 'Я могу назвать владельца, scope и стоп-условия до теста.',
    tutorStarter: 'Помоги мне составить короткий pre-flight checklist для легального тестирования своей веб-лаборатории.',
  },
  {
    id: 'network',
    number: '02',
    title: 'Интернет как система',
    shortTitle: 'HTTP',
    objective: 'Понимать путь запроса: DNS, TLS, HTTP, cookies, sessions и API.',
    drills: [
      'Открыть DevTools на собственной локальной странице.',
      'Найти request, response, status и cookie без изменения данных.',
      'Объяснить, где проходит граница браузер - API - база.',
    ],
    completion: 'Я умею прочитать один HTTP-запрос и назвать его контекст.',
    tutorStarter: 'Объясни мне на безопасном примере, чем отличаются cookie, session и bearer token.',
  },
  {
    id: 'linux',
    number: '03',
    title: 'Linux, Python и Git',
    shortTitle: 'Base',
    objective: 'Собрать спокойную техническую базу для автоматизации, чтения кода и воспроизводимых заметок.',
    drills: [
      'Разобрать права файлов, процесс и локальный порт в своей среде.',
      'Написать маленький Python-скрипт, который читает собственный лог.',
      'Сохранить наблюдение и вывод в Git-ветке.',
    ],
    completion: 'Я могу повторить свой опыт и показать, откуда взялся результат.',
    tutorStarter: 'Дай мне безопасную тренировку Python на разборе локального HTTP-лога без сетевого сканирования.',
  },
  {
    id: 'web',
    number: '04',
    title: 'Web Security',
    shortTitle: 'Web',
    objective: 'Различать классы рисков: access control, injection, XSS, SSRF, загрузки файлов и API-авторизацию.',
    drills: [
      'Сначала описать модель угроз и ожидаемое правило доступа.',
      'Проверить один сценарий только в учебной лаборатории.',
      'Записать влияние, минимальное доказательство и безопасную рекомендацию.',
    ],
    completion: 'Я описываю риск через правило доступа и влияние, а не через эффектный эксплойт.',
    tutorStarter: 'Объясни разницу между IDOR/BOLA и обычной ошибкой авторизации только на вымышленном API-примере.',
    resource: { label: 'PortSwigger Web Security Academy', href: 'https://portswigger.net/web-security' },
  },
  {
    id: 'tools',
    number: '05',
    title: 'Наблюдение, не атака',
    shortTitle: 'Tools',
    objective: 'Использовать DevTools и Burp Suite как приборы наблюдения в своей лаборатории.',
    drills: [
      'Сопоставить действие в интерфейсе с HTTP-запросом.',
      'Повторить только безвредный запрос против учебного приложения.',
      'Сохранить evidence без токенов, персональных данных и чужого трафика.',
    ],
    completion: 'Я умею объяснить, что именно наблюдаю, и не выхожу за scope.',
    tutorStarter: 'Проведи меня по безопасному чтению запроса в DevTools на localhost без изменения данных.',
    resource: { label: 'PortSwigger Training', href: 'https://portswigger.net/training' },
  },
  {
    id: 'labs',
    number: '06',
    title: 'Легальные лаборатории',
    shortTitle: 'Labs',
    objective: 'Практиковаться только на специально уязвимых приложениях и официальных учебных целях.',
    drills: [
      'Выбрать одну учебную лабораторию и её тему.',
      'Пройти задание до безопасного подтверждения.',
      'Задокументировать чему научился, не перенося шаги на реальные цели.',
    ],
    completion: 'Моя практика изолирована, воспроизводима и никому не вредит.',
    tutorStarter: 'Помоги выбрать первую тему в WebGoat или PortSwigger для полного новичка и объясни, что я буду изучать.',
    resource: { label: 'OWASP WebGoat', href: 'https://owasp.org/www-project-webgoat/' },
  },
  {
    id: 'reporting',
    number: '07',
    title: 'Responsible disclosure',
    shortTitle: 'Report',
    objective: 'Превращать найденную проблему в ясный, проверяемый и полезный отчёт.',
    drills: [
      'Сверить программу и опубликованный scope перед работой.',
      'Описать impact, безопасное воспроизведение и remediation.',
      'Отправить report только через официальный канал программы.',
    ],
    completion: 'Я умею писать отчёт, который помогает закрыть риск, а не создаёт шум.',
    tutorStarter: 'Помоги составить шаблон vulnerability report для вымышленной уязвимости в учебной лаборатории.',
    resource: { label: 'HackerOne Bug Bounty Programs', href: 'https://www.hackerone.com/bug-bounty-programs' },
  },
];

export const CYBER_LAB_BOUNDARY =
  'Только свои системы, учебные лаборатории или явно разрешённый bug bounty scope. Никаких чужих целей, обхода защиты, кражи данных, нарушений доступности или скрытности.';

const SECURITY_TERMS = /\b(?:pentest|penetration|ethical\s*hacking|bug\s*bounty|web\s*security|sql\s*injection|xss|ssrf|idor|bola|rce|уязвим|пентест|этичн(?:ый|ого)\s+хакинг|багбаунти|взлом|инъекц|авторизац|доступ)\b/i;
const ACTIVE_HARM_TERMS = /(?:взломать|обойти|обход|получить\s+доступ|украсть|слить\s+данные|эксфильтр|фишинг|ddos|ддос|brute\s*force|брут|reverse\s*shell|webshell|ransom|чуж(?:ой|ого|их)|без\s+разрешени)/i;
const SAFE_CONTEXT_TERMS = /(?:localhost|127\.0\.0\.1|::1|webgoat|portswigger|academy|лаборатор|lab\b|ctf|свой|собственн|разрешени|scope|bug\s*bounty|hackerone|bugcrowd)/i;

export function getCyberLabModule(id: unknown) {
  return CYBER_LAB_MODULES.find((module) => module.id === id) ?? CYBER_LAB_MODULES[0];
}

export function isSecurityLearningTopic(text: string) {
  return SECURITY_TERMS.test(text);
}

// Явные маркеры несанкционированности перебивают "безопасный контекст":
// иначе слово "разрешени" в "без разрешения" ложно засчитывалось как safe.
const EXPLICIT_UNAUTHORIZED = /без\s+(?:разрешени|согласи|авторизац)|несанкционир|чуж(?:ой|ого|им|их|ому)/i;

export function isPotentiallyUnsafeSecurityRequest(text: string) {
  // Триггер — намерение вреда (ACTIVE_HARM ловит и русские формы «взломать»
  // и т.п.), а не узкий словарь тем. Явная несанкционированность («без
  // разрешения», «чужой») блокирует безусловно; иначе — если нет признаков
  // безопасной учебной среды (localhost, WebGoat, свой scope).
  if (!ACTIVE_HARM_TERMS.test(text)) return false;
  if (EXPLICIT_UNAUTHORIZED.test(text)) return true;
  return !SAFE_CONTEXT_TERMS.test(text);
}

export function securityTutorSystemPrompt(module: CyberLabModule) {
  return [
    'Ты MAX, наставник режима Cyber Lab в GAME Ultra. Отвечай по-русски, кратко и практично.',
    CYBER_LAB_BOUNDARY,
    'Разрешены: концепции, модели угроз, чтение кода, безопасная автоматизация на собственных данных, подготовка отчётов, работа с локальными лабораториями и публичным scope.',
    'Не давай инструкции, payloads, команды или код для получения несанкционированного доступа, обхода защиты, скрытности, кражи данных, вреда сервису или атаки на реальную цель.',
    'Если вопрос выходит за границу, спокойно останови его и предложи безопасный аналог в localhost, WebGoat или PortSwigger.',
    `Текущий модуль: ${module.number} ${module.title}. Цель: ${module.objective}`,
    'Строй ответ так: 1) короткий принцип, 2) один безопасный шаг в лаборатории, 3) что записать в заметки.',
  ].join('\n');
}

export function securityTutorFallback(module: CyberLabModule) {
  return `MAX: ${module.objective} Начни с того, чтобы ${module.drills[0].toLowerCase()} Затем зафиксируй: ${module.completion}`;
}

export function blockedSecurityReply() {
  return `MAX: я не буду вести к чужой цели или обходу защиты. ${CYBER_LAB_BOUNDARY} Давай перенесём сценарий в localhost, WebGoat или в опубликованный scope и разберём безопасную модель угроз.`;
}
