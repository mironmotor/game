import type { ArticleBlock } from '@/lib/news/types';

/**
 * Рендер тела статьи. Чистая функция от блоков — ни состояния, ни эффектов:
 * один и тот же компонент показывает и серверный вариант, и подъехавший
 * машинный перевод, поэтому вёрстка гарантированно не разъезжается между ними.
 */
export default function ArticleBody({ blocks }: { blocks: ArticleBlock[] }) {
  return (
    <div className="mt-8 space-y-5">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'h2':
            return (
              <h2
                key={index}
                className="pt-6 font-[family-name:var(--font-hud-display)] text-[19px] font-semibold leading-snug text-cyan-100 sm:text-[22px]"
              >
                {block.text}
              </h2>
            );

          case 'p':
            return (
              <p key={index} className="text-[15.5px] leading-[1.75] text-white/75 sm:text-[16.5px]">
                {block.text}
              </p>
            );

          case 'list':
            return (
              <ul key={index} className="list-disc space-y-2 pl-5 text-[15.5px] leading-[1.7] text-white/75">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ul>
            );

          case 'quote':
            return (
              <blockquote
                key={index}
                className="border-s-2 border-cyan-400/40 ps-5 text-[16px] italic leading-[1.7] text-white/80"
              >
                {block.text}
                {block.attribution ? (
                  <footer className="mt-2 text-[13px] not-italic text-white/45">{block.attribution}</footer>
                ) : null}
              </blockquote>
            );

          case 'stat':
            return (
              <figure
                key={index}
                className="my-8 rounded-xl border border-cyan-400/25 bg-cyan-400/[0.04] px-6 py-6 text-center"
              >
                <div className="font-[family-name:var(--font-hud-display)] text-[40px] font-bold leading-none text-cyan-300 sm:text-[52px]">
                  {block.value}
                </div>
                <figcaption className="mx-auto mt-3 max-w-[46ch] text-[14.5px] leading-relaxed text-white/70">
                  {block.label}
                </figcaption>
                {block.note ? (
                  <p className="mx-auto mt-3 max-w-[52ch] text-[12px] leading-relaxed text-white/40">{block.note}</p>
                ) : null}
              </figure>
            );

          case 'note':
            return (
              <aside
                key={index}
                className="my-8 rounded-xl border border-white/10 bg-white/[0.03] px-5 py-5 sm:px-6"
              >
                <h3 className="font-[family-name:var(--font-hud-display)] text-[14px] font-semibold uppercase tracking-[0.12em] text-white/55">
                  {block.title}
                </h3>
                <p className="mt-3 text-[14.5px] leading-[1.7] text-white/65">{block.text}</p>
              </aside>
            );
        }
      })}
    </div>
  );
}
