/**
 * Новостной раздел mir.care.
 *
 * Статья хранится не как готовый HTML, а как список типизированных блоков.
 * Причина простая: раздел обязан говорить на языке читателя, а машинный
 * перевод сплошной вёрстки ломает разметку и тихо теряет куски текста.
 * Блоки переводятся по одному, форма проверяется на выходе, и если модель
 * вернула не ту структуру — читатель видит оригинал, а не кашу.
 */

export type ArticleBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'quote'; text: string; attribution?: string }
  /** Врезка с проверяемой цифрой: крупное число + подпись + необязательный источник. */
  | { kind: 'stat'; value: string; label: string; note?: string }
  /** Спокойная врезка «что это значит» — контекст, а не сенсация. */
  | { kind: 'note'; title: string; text: string };

export interface ArticleSource {
  org: string;
  title: string;
  url: string;
}

/** Один язык статьи: заголовок, подводка, тело. */
export interface ArticleContent {
  title: string;
  /** Подзаголовок под заголовком — одно предложение, суть. */
  dek: string;
  blocks: ArticleBlock[];
  /**
   * Теги живут здесь, а не в Article, потому что читатель их видит.
   * Общий список на языке автора показывал бы «климат, Индонезия» под
   * английским заголовком — мелочь, которая сразу выдаёт недоделанный раздел.
   */
  tags: string[];
}

export interface Article {
  slug: string;
  /** ISO-8601. Дата публикации в UTC. */
  publishedAt: string;
  updatedAt?: string;
  /** Подпись автора. В разделе это «М» — корреспондент, пишущий анонимно. */
  author: string;
  /** Язык, на котором статья написана человеком. Эталон для перевода. */
  originLocale: string;
  /**
   * Языки, вычитанные руками. Всё остальное переводится ядром на лету
   * и помечается в интерфейсе как машинный перевод — читатель должен
   * знать, что текст перед ним не вычитан человеком.
   */
  content: Record<string, ArticleContent>;
  sources: ArticleSource[];
}

/** Что уходит клиенту: контент + честная пометка о происхождении перевода. */
export interface LocalizedArticle extends ArticleContent {
  slug: string;
  publishedAt: string;
  updatedAt?: string;
  author: string;
  tags: string[];
  locale: string;
  originLocale: string;
  /** human — вычитано; machine — переведено ядром; origin — язык оригинала. */
  translation: 'origin' | 'human' | 'machine';
  sources: ArticleSource[];
}
