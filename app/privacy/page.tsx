import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Политика конфиденциальности — mir.care',
  description: 'Какие данные собирает mir.care, зачем и как ими управлять.',
};

const UPDATED = '26 июля 2026';
const CONTACT = 'mironbocharov48@gmail.com';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-cyan-100 sm:text-xl">{title}</h2>
      <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-white/70">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#0a0818] px-5 py-12">
      <article className="mx-auto max-w-[760px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-cyan-300/60">mir.care</p>
        <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">Политика конфиденциальности</h1>
        <p className="mt-2 text-[13px] text-white/45">Обновлено: {UPDATED}</p>

        <p className="mt-6 text-[14px] leading-relaxed text-white/70">
          Здесь честно и простыми словами описано, какие данные собирает сайт mir.care, зачем они нужны,
          кому передаются и как вы можете ими управлять. Пользуясь сайтом, вы соглашаетесь с этой политикой.
        </p>

        <Section title="1. Кто обрабатывает данные">
          <p>
            Оператор персональных данных — Мирон Бочаров, владелец сайта mir.care.
            Связь по любым вопросам о данных: <a className="text-cyan-300 underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </p>
        </Section>

        <Section title="2. Какие данные мы собираем">
          <p><b className="text-white/85">Автоматически, у всех посетителей</b> (через Яндекс.Метрику):</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>IP-адрес, тип устройства, браузер, операционная система, разрешение экрана;</li>
            <li>источник перехода, страницы и время просмотра, действия на странице (клики, прокрутка);</li>
            <li>запись сессии («Вебвизор») — обезличенная запись ваших действий на странице для анализа удобства;</li>
            <li>файлы cookie и идентификаторы, которые ставит счётчик.</li>
          </ul>

          <p className="pt-2"><b className="text-white/85">Если вы входите через Google</b> — только то, что передаёт Google при входе:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>адрес электронной почты, имя и фото профиля.</li>
          </ul>
          <p>Пароль от Google-аккаунта мы <b className="text-white/85">не видим и не храним</b> — вход происходит на стороне Google.</p>

          <p className="pt-2"><b className="text-white/85">Что вы вводите сами:</b></p>
          <ul className="list-disc space-y-1 pl-5">
            <li>сообщения и запросы к ассистенту MAX, задачи, заметки;</li>
            <li>прогресс обучения и внутриигровой баланс MIRCOIN, привязанные к вашему аккаунту.</li>
          </ul>
          <p>
            Часть данных (задачи, настройки интерфейса) хранится <b className="text-white/85">только в вашем браузере</b>
            {' '}(localStorage) и на сервер не передаётся.
          </p>
        </Section>

        <Section title="3. Зачем мы это делаем">
          <ul className="list-disc space-y-1 pl-5">
            <li>чтобы сайт работал: вход в аккаунт, сохранение прогресса и баланса;</li>
            <li>чтобы отвечать на ваши запросы к ассистенту;</li>
            <li>чтобы понимать, как людям удобнее пользоваться сайтом, и улучшать его;</li>
            <li>чтобы оценивать эффективность рекламы и не показывать её тем, кому она не нужна.</li>
          </ul>
        </Section>

        <Section title="4. Кому передаются данные">
          <p>Мы не продаём ваши данные. Они передаются только сервисам, без которых сайт не работает:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b className="text-white/85">Яндекс.Метрика</b> (ООО «Яндекс») — веб-аналитика и реклама.
              {' '}<a className="text-cyan-300 underline" href="https://yandex.ru/legal/confidential/" target="_blank" rel="noreferrer">Политика Яндекса</a>.
            </li>
            <li>
              <b className="text-white/85">Google</b> — вход через Google-аккаунт и часть ИИ-функций.
              {' '}<a className="text-cyan-300 underline" href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Политика Google</a>.
            </li>
            <li>
              <b className="text-white/85">Провайдеры ИИ-моделей</b> — чтобы ассистент мог ответить, текст вашего
              запроса передаётся модели, которая формирует ответ. Пожалуйста,
              {' '}<b className="text-white/85">не отправляйте в чат пароли, банковские данные и чужие персональные данные</b>.
            </li>
            <li>
              <b className="text-white/85">Сервис синтеза речи</b> — если включена озвучка, текст ответа передаётся
              для преобразования в голос.
            </li>
          </ul>
          <p>Данные также могут быть переданы государственным органам, если этого прямо требует закон.</p>
        </Section>

        <Section title="5. Файлы cookie">
          <p>
            Сайт использует cookie: технические (чтобы вы оставались в аккаунте и сохранялся выбранный язык)
            и аналитические (счётчик Яндекс.Метрики). Аналитические cookie можно отключить в настройках браузера
            или через{' '}
            <a className="text-cyan-300 underline" href="https://yandex.ru/support/metrica/general/opt-out.html" target="_blank" rel="noreferrer">
              страницу отказа Яндекс.Метрики
            </a>
            . Без технических cookie вход в аккаунт работать не будет.
          </p>
        </Section>

        <Section title="6. Сколько храним">
          <p>
            Данные аккаунта (почта, имя, прогресс, баланс) хранятся, пока вы пользуетесь сайтом, и удаляются
            по вашему запросу. Статистика Метрики хранится по правилам Яндекса. Данные в вашем браузере вы можете
            удалить сами — очисткой данных сайта в настройках браузера.
          </p>
        </Section>

        <Section title="7. Ваши права">
          <p>В соответствии с ФЗ-152 «О персональных данных» вы вправе:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>узнать, какие ваши данные у нас есть;</li>
            <li>потребовать их исправить или удалить;</li>
            <li>отозвать согласие на обработку;</li>
            <li>пожаловаться в Роскомнадзор.</li>
          </ul>
          <p>
            Напишите на <a className="text-cyan-300 underline" href={`mailto:${CONTACT}`}>{CONTACT}</a> — ответим
            и выполним запрос в срок, установленный законом (до 30 дней).
          </p>
        </Section>

        <Section title="8. Дети">
          <p>Сайт не предназначен для детей младше 14 лет и не собирает их данные осознанно.</p>
        </Section>

        <Section title="9. Изменения">
          <p>
            Мы можем обновлять эту политику. Актуальная версия всегда находится на этой странице,
            дата последнего изменения указана вверху.
          </p>
        </Section>

        <p className="mt-10 border-t border-white/10 pt-5 text-[13px] text-white/40">
          Вопросы о данных: <a className="text-cyan-300 underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>
          {' · '}
          <a className="text-cyan-300 underline" href="/">на главную</a>
        </p>
      </article>
    </main>
  );
}
