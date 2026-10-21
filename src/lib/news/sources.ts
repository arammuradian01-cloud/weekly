// Стартовый список источников (этап 60): публичные ленты RSS и Atom регулятора, союзов и СМИ.
// Это предложение на подтверждение Арама (README, раздел «На подтверждение Араму»): адреса лент меняются,
// и недоступный источник виден владельцу в «Настройках», где его можно поправить или выключить.
// Сид добавляет список один раз, в пустую таблицу.
//
// strict: общие деловые ленты (Интерфакс, ТАСС, РБК, финансовые рубрики Коммерсанта и Ведомостей) пишут обо всём,
// поэтому новость с них привязывается к продукту только по двум разным признакам (проверка 21.10).

export type SourceSeed = { name: string; url: string; strict?: boolean };

export const DEFAULT_SOURCES: SourceSeed[] = [
  { name: "Банк России: пресс-релизы", url: "https://www.cbr.ru/rss/RssPress" },
  { name: "Банк России: новости", url: "https://www.cbr.ru/rss/RssNews" },
  { name: "РСА: новости", url: "https://autoins.ru/novosti/podpiska-na-novosti/rss/" },
  { name: "Всероссийский союз страховщиков", url: "https://ins-union.ru/rss/" },
  { name: "АСН: агентство страховых новостей", url: "https://www.asn-news.ru/rss" },
  { name: "Страхование сегодня (insur-info.ru)", url: "https://www.insur-info.ru/rss/news/" },
  { name: "Банки.ру: новости", url: "https://www.banki.ru/xml/news.rss" },
  { name: "Frank Media", url: "https://frankmedia.ru/feed" },
  { name: "Коммерсантъ: финансы", url: "https://www.kommersant.ru/RSS/section-finance.xml", strict: true },
  { name: "Ведомости: финансы", url: "https://www.vedomosti.ru/rss/rubric/finance", strict: true },
  { name: "РБК: главные новости", url: "https://rssexport.rbc.ru/rbcnews/news/30/full.rss", strict: true },
  { name: "Интерфакс: все новости", url: "https://www.interfax.ru/rss.asp", strict: true },
  { name: "ТАСС: все новости", url: "https://tass.ru/rss/v2.xml", strict: true },
];
