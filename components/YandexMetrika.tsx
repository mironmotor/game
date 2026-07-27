/**
 * Яндекс.Метрика — счётчик mir.care (для Яндекс.Директа на РФ).
 *
 * Считает ТОЛЬКО боевой прод: в dev-режиме не грузится, иначе локальная
 * разработка (localhost:3000) засоряла бы статистику и портила данные,
 * по которым потом оптимизируются рекламные кампании.
 *
 * Включён вебвизор (запись сессий) — как в выданном коде счётчика.
 */

const COUNTER_ID = 111037211;

export default function YandexMetrika() {
  // В dev не считаем — только реальные посетители боевого сайта.
  if (process.env.NODE_ENV !== 'production') return null;

  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `
(function(m,e,t,r,i,k,a){
    m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
    m[i].l=1*new Date();
    for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
    k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
})(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=${COUNTER_ID}', 'ym');

ym(${COUNTER_ID}, 'init', {ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});
          `.trim(),
        }}
      />
      <noscript>
        <div>
          <img
            src={`https://mc.yandex.ru/watch/${COUNTER_ID}`}
            style={{ position: 'absolute', left: '-9999px' }}
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}
