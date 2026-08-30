import type { Article } from '../types';

export const baliTwoOceansDrought: Article = {
  slug: 'bali-two-oceans-drought',
  publishedAt: '2026-08-31T09:00:00.000Z',
  author: 'М',
  originLocale: 'ru',
  sources: [
    {
      org: 'NOAA Climate Prediction Center',
      title: 'ENSO Diagnostic Discussion, 13 August 2026',
      url: 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_disc_aug2026/ensodisc.shtml',
    },
    {
      org: 'BMKG',
      title: 'BMKG: Puncak Musim Kemarau Agustus 2026, Perkuat Kesiapan Hadapi Dampak El Nino',
      url: 'https://www.bmkg.go.id/siaran-pers/bmkg-puncak-musim-kemarau-agustus-2026-perkuat-kesiapan-hadapi-dampak-el-nino',
    },
    {
      org: 'BMKG',
      title: 'Prakiraan Cuaca Indonesia Sepekan Periode 14–20 Agustus 2026: El Niño Semakin Kuat di Tengah Kemarau',
      url: 'https://www.bmkg.go.id/cuaca/potensi-hujan-sepekan/prakiraan-cuaca-indonesia-sepekan-periode-14-20-agustus-2026-el-nino-semakin-kuat-di-tengah-kemarau-ancaman-kekeringan-kian-meluas',
    },
    {
      org: 'BRIN / Tempo',
      title: 'BRIN Attributes Severe Dry Season Across Indonesia to Super El Nino and IOD+',
      url: 'https://en.tempo.co/read/2093783/brin-attributes-severe-dry-season-across-indonesia-to-super-el-nino-and-iod',
    },
    {
      org: 'Jakarta Globe',
      title: 'BMKG Warns of Drier, Longer Dry Season as El Niño, Positive IOD Converge',
      url: 'https://jakartaglobe.id/news/bmkg-warns-of-drier-longer-dry-season-as-el-nio-positive-iod-converge',
    },
    {
      org: 'BPBD Бали / Tribun Bali',
      title: 'BPBD Bali Catat 158,53 Hektare dan 529 KK Terdampak Kekeringan Periode April–Agustus 2026',
      url: 'https://bali.tribunnews.com/bali/603103/bpbd-bali-catat-15853-hektare-dan-529-kk-terdampak-kekeringan-periode-aprilagustus-2026',
    },
    {
      org: 'BPBD Джембраны / Tribun Bali',
      title: 'Kekeringan Mengintai Jembrana Bali, 971 KK Krisis Air Bersih akibat Kemarau Ekstrem',
      url: 'https://bali.tribunnews.com/bali/603401/kekeringan-mengintai-jembrana-bali-971-kk-krisis-air-bersih-akibat-kemarau-ekstrem',
    },
    {
      org: 'Kompas',
      title: 'BMKG Prediksi Bali Masuk Musim Kemarau 2026 Mulai Maret, Wilayah Mana Saja?',
      url: 'https://www.kompas.com/jawa-timur/read/2026/03/12/135000788/bmkg-prediksi-bali-masuk-musim-kemarau-2026-mulai-maret-wilayah-mana',
    },
  ],
  content: {
    ru: {
      tags: ['климат', 'Индонезия', 'Эль-Ниньо', 'вода'],
      title: 'Бали сушат два океана сразу',
      dek: 'Индекс Эль-Ниньо идёт к рекорду за 76 лет наблюдений, а положительный диполь Индийского океана добивает то, что осталось от муссона. На юге острова это уже видно ногами. Но в отчёты о бедствии попали совсем другие деревни.',
      blocks: [
        {
          kind: 'p',
          text: 'На плато Букит, южной оконечности Бали, поднятой над океаном примерно на двести метров, в конце августа не осталось зелени. Пятнадцать тысяч шагов по грунтовым дорогам между Пандавой и Улувату — и на всём протяжении бурая земля, голые ветки, красная пыль на тех кустах, что ещё держат листву. Рядом идут макаки, которым всё равно: их кормят туристы. На щитах вдоль дороги продают виллы, и на каждом щите — сочная тропическая зелень.',
        },
        {
          kind: 'p',
          text: 'Соблазн прочитать этот пейзаж как конец света велик. Данные говорят кое-что более точное и по-своему более тревожное: остров попал под совпадение двух океанских аномалий, каждая из которых по отдельности умеет устраивать засуху, а вместе они не сходились с 2019 года.',
        },
        { kind: 'h2', text: 'Что показывают приборы' },
        {
          kind: 'p',
          text: 'Центр климатических прогнозов NOAA в бюллетене от 13 августа 2026 года держит статус El Niño Advisory. Индекс Niño 3.4 — ключевая мера аномалии температуры поверхности экваториальной части Тихого океана — за июль составил плюс 1,4 градуса. Само по себе это умеренное событие. Важнее траектория: NOAA оценивает вероятность того, что осенью и зимой 2026–27 годов Эль-Ниньо станет «очень сильным», выше девяноста процентов.',
        },
        {
          kind: 'stat',
          value: '69 %',
          label: 'вероятность, что в октябре–декабре 2026 аномалия превысит +2,5 °C',
          note: 'Это превзошло бы все зафиксированные события Эль-Ниньо начиная с 1950 года. NOAA CPC, 13 августа 2026',
        },
        {
          kind: 'p',
          text: 'Прогноз стоит читать медленно. Речь не о «жарком годе», а о вероятности выхода за верхнюю границу всего, что инструментально измерено за 76 лет. Событие 1997–98 годов, после которого Индонезия горела месяцами, и событие 2015–16 годов, обрушившее урожаи по всей Юго-Восточной Азии, находились примерно на этом уровне — и текущий прогноз ставит две трети шансов на то, что оба будут превзойдены.',
        },
        {
          kind: 'note',
          title: 'Заметка на полях: прогноз догонял реальность',
          text: 'В марте 2026 года индонезийская метеослужба BMKG закладывала в сезонный расчёт слабый Эль-Ниньо на июль–октябрь. К августу событие оказалось заметно сильнее плана. Это обычная история с ENSO: весенние прогнозы традиционно слабое место модели, и апрельский оптимизм регулярно приходится переписывать в августе.',
        },
        { kind: 'h2', text: 'Второй океан' },
        {
          kind: 'p',
          text: 'Эль-Ниньо живёт в Тихом океане. Вторая половина проблемы пришла с запада — из Индийского. Диполь Индийского океана перешёл в положительную фазу: вода у берегов Восточной Африки теплее нормы, а у Суматры и Явы — холоднее. Над холодной водой не растёт конвекция, а без конвекции над Индонезийским архипелагом не собирается дождь. Муссон получает удар с той стороны, с которой обычно приходит влага.',
        },
        {
          kind: 'p',
          text: 'Индонезийское агентство исследований и инноваций BRIN описывает нынешний сезон прямо как наложение супер-Эль-Ниньо и положительного диполя. Прошлое такое совпадение случилось в 2019 году и дало одну из самых тяжёлых засух десятилетия — с торфяными пожарами, дымом над регионом и закрытыми школами.',
        },
        { kind: 'h2', text: 'Что это уже сделало с островом' },
        {
          kind: 'p',
          text: 'По расчёту BMKG сухой сезон пришёл на Бали в марте — раньше нормы: досрочно в него вошли около 65 процентов сезонных зон острова. Характер сезона оценён как «ниже нормы» для девяноста процентов территории Бали, пик отнесён на август–сентябрь, общая продолжительность — порядка шести месяцев. К середине августа в сухом сезоне находилось 79,9 процента территории Индонезии.',
        },
        {
          kind: 'stat',
          value: '79,9 %',
          label: 'территории Индонезии в сухом сезоне к середине августа 2026',
          note: '559 сезонных зон, у большинства — осадки ниже нормы. BMKG',
        },
        {
          kind: 'p',
          text: 'Сводка провинциального управления по чрезвычайным ситуациям BPBD Бали за период с 11 апреля по 28 августа 2026 года: 529 семей в четырнадцати деревнях, 158,53 гектара пострадавших земель, три района — Булеленг на севере, Джембрана на западе, Карангасем на востоке. Развезено 305 тысяч литров питьевой воды: 158 тысяч в Булеленг, 137 тысяч в Джембрану, 10 тысяч в Карангасем. Развозили не только государственные службы — подключились Красный Крест, армия и полиция.',
        },
        {
          kind: 'p',
          text: 'Отдельно по Джембране счёт в течение августа рос на глазах: сначала 596 семей без доступа к чистой воде, затем 971. Бали попал и в сводки BMKG по пожарам — наряду с Западным Калимантаном, Ачехом, Бангка-Белитунгом, Центральной и Восточной Явой.',
        },
        { kind: 'h2', text: 'Почему юг выглядит хуже, чем числится' },
        {
          kind: 'p',
          text: 'В списке пострадавших районов нет Бадунга — того самого, где находится Букит и вся южная курортная зона. Пострадавшими числятся север, запад и восток: сельские районы, где люди зависят от колодцев и богарного земледелия.',
        },
        {
          kind: 'p',
          text: 'Это не значит, что на юге влажнее. Это значит, что там некому попасть в отчёт о бедствии. На Буките нет крестьян с пересохшим колодцем — там туризм, трубы водоканала и водовозы, и засуха превращается не в строку статистики, а в счёт за воду. Одна и та же засуха в деревне выглядит как цистерна с гуманитарной водой, а в двух часах езды — как бурый пейзаж и полный бассейн рядом с ним.',
        },
        {
          kind: 'p',
          text: 'У геологии Букита при этом собственный вклад, и он больше, чем принято думать. Полуостров сложен известняком: дождевая вода не задерживается на поверхности, а уходит вниз по карстовым трещинам. Постоянных рек на Буките нет ни одной. Вулканический хребет в центре острова — Агунг, Батукару, Батур — перехватывает влагу, и низкое плоское плато на юге остаётся в дождевой тени. Центр Бали получает две-три тысячи миллиметров осадков в год, Букит — порядка тысячи. Исторически балийцы называли эту землю tanah tandus, бесплодной: заливные рисовые террасы там невозможны, росли кассава, кукуруза и арахис.',
        },
        {
          kind: 'note',
          title: 'Линза, о которой не пишут в проспектах',
          text: 'Пресная вода на известняковом полуострове стоит линзой поверх солёной — физика простая и безжалостная. Качаешь сильнее, чем восполняет дождь, — линза утончается, и снизу подтягивается морская вода. На человеческих сроках это необратимо. Настоящий индикатор беды на юге Бали не бурая трава, а солоноватый привкус в скважинах и падающий дебит колодцев. Смотреть надо на воду, а не на пейзаж.',
        },
        { kind: 'h2', text: 'Чего нельзя прочитать по бурому цвету' },
        {
          kind: 'p',
          text: 'Здесь нужна честность в обе стороны. Растительность Букита — тропический сухой лес, а не дождевой. Тик, лаунтар, акации сбрасывают листья на засуху намеренно, чтобы не испарять воду. Голый скелет дерева в августе — это не агония, это стратегия, отработанная миллионы лет. После первых дождей тот же склон зеленеет за одну-две недели.',
        },
        {
          kind: 'p',
          text: 'Отличить спячку от смерти можно руками за пять минут. Живое дерево в засуху гибкое: ветка гнётся, а под корой, если снять её ногтем, виден зелёный влажный слой. Мёртвое ломается сухо, кора отслаивается, под ней бурое. Разница принципиальна, потому что защищает сразу от двух ошибок — от паники при виде нормального сезонного пейзажа и от благодушия там, где земля действительно убита.',
        },
        {
          kind: 'p',
          text: 'А убита она чаще всего не климатом. Расчистка под застройку сдирает кустарник и оголяет тонкую красную почву на скале — и участок мертвеет по-настоящему, только убил его бульдозер, а не Эль-Ниньо.',
        },
        { kind: 'h2', text: 'Что будет дальше' },
        {
          kind: 'p',
          text: 'Пик события прогнозируется на октябрь–декабрь. Сильные Эль-Ниньо систематически задерживают приход муссона, поэтому сезон дождей, который в обычный год приходит на Бали в конце октября или ноябре, с высокой вероятностью сдвинется. Зелень вернётся — но позже обычного, возможно, к декабрю. Для сельских районов севера и запада это означает ещё несколько месяцев подвоза воды цистернами.',
        },
        {
          kind: 'note',
          title: 'Что это значит и чего не значит',
          text: 'Эль-Ниньо — естественный цикл, а не глобальное потепление. Он приходит и уходит, и нынешний уйдёт тоже. Но ложится он поверх уже нагретого фона, и рекордное событие почти наверняка сделает 2027 год рекордно жарким по планете — как 2016-й после Эль-Ниньо 2015 года и как 2024-й после события 2023-го. Через несколько месяцев будет вал заголовков о климатической катастрофе, и значительная часть их будет описывать в том числе этот цикл. Разделять одно и другое — работа, которую придётся делать каждому читателю самостоятельно.',
        },
        {
          kind: 'p',
          text: 'Пока же на Буките всё по-старому: бурое плато, макаки вдоль дороги и щиты с обещанием тропической зелени. Щиты снимали в марте.',
        },
      ],
    },
    en: {
      tags: ['climate', 'Indonesia', 'El Niño', 'water'],
      title: 'Bali Is Being Dried by Two Oceans at Once',
      dek: 'The El Niño index is tracking toward a record across 76 years of observation, and a positive Indian Ocean Dipole is finishing off what remained of the monsoon. On the south of the island you can already feel it underfoot. Yet the disaster reports name entirely different villages.',
      blocks: [
        {
          kind: 'p',
          text: 'On the Bukit plateau, the southern tip of Bali lifted some two hundred metres above the ocean, no green was left by the end of August. Fifteen thousand steps along the dirt roads between Pandawa and Uluwatu, and the whole way is brown earth, bare branches, red dust on the leaves of the few shrubs still holding any. Macaques walk alongside, indifferent: tourists feed them. Billboards line the road selling villas, and every billboard shows lush tropical green.',
        },
        {
          kind: 'p',
          text: 'The temptation to read this landscape as the end of the world is strong. The data says something more precise and, in its own way, more troubling: the island has been caught by a convergence of two ocean anomalies, each capable of producing a drought on its own, and together they have not met since 2019.',
        },
        { kind: 'h2', text: 'What the instruments show' },
        {
          kind: 'p',
          text: "NOAA's Climate Prediction Center, in its bulletin of 13 August 2026, maintains El Niño Advisory status. The Niño 3.4 index — the key measure of sea-surface temperature anomaly in the equatorial Pacific — stood at plus 1.4 degrees for July. On its own that is a moderate event. The trajectory matters more: NOAA puts the probability that El Niño becomes a very strong event during the autumn and winter of 2026–27 at above ninety percent.",
        },
        {
          kind: 'stat',
          value: '69 %',
          label: 'probability the anomaly exceeds +2.5 °C during October–December 2026',
          note: 'That would surpass every recorded El Niño event dating back to 1950. NOAA CPC, 13 August 2026',
        },
        {
          kind: 'p',
          text: 'This forecast deserves slow reading. It is not about a hot year. It is about the probability of exceeding the upper bound of everything measured instrumentally in 76 years. The 1997–98 event, after which Indonesia burned for months, and the 2015–16 event, which collapsed harvests across Southeast Asia, sat roughly at this level — and the current forecast gives two-to-one odds that both will be surpassed.',
        },
        {
          kind: 'note',
          title: 'A margin note: the forecast was chasing reality',
          text: 'In March 2026 the Indonesian meteorological agency BMKG built its seasonal outlook around a weak El Niño for July–October. By August the event proved markedly stronger than planned for. This is ordinary with ENSO: spring forecasts are a traditional weak point of the models, and April optimism regularly has to be rewritten in August.',
        },
        { kind: 'h2', text: 'The second ocean' },
        {
          kind: 'p',
          text: 'El Niño lives in the Pacific. The other half of the problem arrived from the west, out of the Indian Ocean. The Indian Ocean Dipole has shifted into its positive phase: water off East Africa is warmer than normal, water off Sumatra and Java colder. Convection does not build over cold water, and without convection no rain gathers over the Indonesian archipelago. The monsoon takes a hit from precisely the direction moisture normally arrives.',
        },
        {
          kind: 'p',
          text: "Indonesia's National Research and Innovation Agency, BRIN, describes the current season directly as a superposition of a super El Niño and a positive dipole. The last such convergence came in 2019 and produced one of the decade's harshest droughts, with peat fires, regional smoke haze and closed schools.",
        },
        { kind: 'h2', text: 'What it has already done to the island' },
        {
          kind: 'p',
          text: "By BMKG's reckoning the dry season reached Bali in March, ahead of normal: roughly 65 percent of the island's seasonal zones entered it early. The season's character is rated below normal for ninety percent of Bali's territory, its peak assigned to August–September, its total length around six months. By mid-August, 79.9 percent of Indonesia's territory was in the dry season.",
        },
        {
          kind: 'stat',
          value: '79.9 %',
          label: "of Indonesia's territory in dry season by mid-August 2026",
          note: '559 seasonal zones, most with below-normal rainfall. BMKG',
        },
        {
          kind: 'p',
          text: 'The provincial disaster management agency BPBD Bali, reporting for 11 April through 28 August 2026: 529 households across fourteen villages, 158.53 hectares of affected land, three regencies — Buleleng in the north, Jembrana in the west, Karangasem in the east. A total of 305,000 litres of drinking water distributed: 158,000 to Buleleng, 137,000 to Jembrana, 10,000 to Karangasem. State services were not alone in the distribution; the Red Cross, the military and the police joined in.',
        },
        {
          kind: 'p',
          text: 'In Jembrana specifically the count climbed visibly through August: first 596 households without access to clean water, then 971. Bali also entered BMKG fire reporting, alongside West Kalimantan, Aceh, Bangka Belitung, Central and East Java.',
        },
        { kind: 'h2', text: 'Why the south looks worse than it counts' },
        {
          kind: 'p',
          text: 'Badung — the regency holding Bukit and the entire southern resort belt — does not appear on the list of affected areas. The affected are the north, west and east: rural districts where people depend on wells and rain-fed farming.',
        },
        {
          kind: 'p',
          text: 'This does not mean the south is wetter. It means there is nobody there to enter a disaster report. Bukit has no farmers with a dry well; it has tourism, utility pipes and water trucks, and drought there converts not into a statistic but into a water bill. The same drought reads in a village as a tanker of relief water, and two hours away as a brown landscape with a full swimming pool beside it.',
        },
        {
          kind: 'p',
          text: "Bukit's geology makes its own contribution, larger than commonly assumed. The peninsula is built of limestone: rainwater does not linger on the surface but drains down through karst fissures. Bukit has not a single permanent river. The volcanic ridge in the island's centre — Agung, Batukaru, Batur — intercepts moisture, leaving the low flat southern plateau in a rain shadow. Central Bali receives two to three thousand millimetres of rainfall a year; Bukit gets on the order of one thousand. Balinese historically called this land tanah tandus, barren: flooded rice terraces are impossible there, and what grew was cassava, corn and peanuts.",
        },
        {
          kind: 'note',
          title: 'The lens the brochures omit',
          text: 'Fresh water on a limestone peninsula sits as a lens floating atop salt water — the physics is simple and unforgiving. Pump harder than rainfall replenishes and the lens thins, drawing seawater up from beneath. On human timescales that is irreversible. The real indicator of trouble in southern Bali is not brown grass but a brackish taste in the boreholes and falling well yields. Watch the water, not the scenery.',
        },
        { kind: 'h2', text: 'What the brown colour cannot tell you' },
        {
          kind: 'p',
          text: "Honesty is owed in both directions here. Bukit's vegetation is tropical dry forest, not rainforest. Teak, lontar palm and acacia shed their leaves in drought deliberately, to stop losing water. A bare skeleton of a tree in August is not agony, it is a strategy refined over millions of years. After the first rains the same slope greens over within a week or two.",
        },
        {
          kind: 'p',
          text: 'Telling dormancy from death takes five minutes and bare hands. A living tree in drought stays flexible: the branch bends, and under the bark, scratched away with a fingernail, a green moist layer shows. Dead wood snaps dry, its bark flaking off over brown beneath. The distinction matters because it guards against two errors at once — panic at an ordinary seasonal landscape, and complacency where the land really has been killed.',
        },
        {
          kind: 'p',
          text: 'And killed it usually is not by climate. Clearing for construction strips the scrub and bares the thin red soil over rock — and the plot dies for real, only the bulldozer killed it, not El Niño.',
        },
        { kind: 'h2', text: 'What comes next' },
        {
          kind: 'p',
          text: 'The peak of the event is forecast for October through December. Strong El Niño events systematically delay the onset of the monsoon, so the rainy season, which in an ordinary year reaches Bali in late October or November, will most likely shift. The green will return — later than usual, possibly by December. For the rural north and west that means several more months of water arriving by tanker.',
        },
        {
          kind: 'note',
          title: 'What this means and what it does not',
          text: 'El Niño is a natural cycle, not global warming. It comes and goes, and this one will go too. But it lands on an already warmed baseline, and a record event will almost certainly make 2027 the hottest year on record globally — as 2016 was after the 2015 El Niño, and 2024 after the 2023 event. In a few months there will be a wave of climate-catastrophe headlines, and a substantial share of them will be describing, among other things, this cycle. Separating the two is work each reader will have to do for themselves.',
        },
        {
          kind: 'p',
          text: 'For now Bukit is unchanged: a brown plateau, macaques along the road, and billboards promising tropical green. The billboards were shot in March.',
        },
      ],
    },
  },
};
