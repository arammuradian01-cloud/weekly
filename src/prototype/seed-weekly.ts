// Выдуманные weekly за три недели: текущая отчётная (offset 0) и две прошлые.

import type { BlockCode, DirectionCode, EntryTypeCode, WeeklyStateCode } from "./dictionaries";
import type { PersonSlug } from "./types";

export type EntrySeed = {
  w: 0 | 1 | 2;
  a: PersonSlug;
  dir: DirectionCode;
  block: BlockCode;
  type: EntryTypeCode;
  what: string;
  details?: string;
  impact?: string;
  next?: string;
  help?: string;
  ceo?: boolean;
  task?: number;
  links?: { title: string; url: string }[];
};

export type HeadlineSeed = { w: 0 | 1 | 2; a: PersonSlug; state: WeeklyStateCode; headline: string; at?: string };

export const HEADLINES: HeadlineSeed[] = [
  { w: 0, a: "muradyan", state: "not-started", headline: "" },
  { w: 0, a: "golovkin", state: "submitted", headline: "Вернули долю СК Б в выдаче, ранжирование по марже упёрлось в разработку", at: "пт, 17:42" },
  { w: 0, a: "reva", state: "submitted", headline: "Запустили A/B тест шага ввода авто, страница результата почти готова", at: "вс, 21:10" },
  { w: 0, a: "loginova", state: "draft", headline: "Годовой ВЗР: тарифы СК А получены" },
  { w: 0, a: "fatyanov", state: "submitted", headline: "СК А держит паузу по КВ, калькулятор по VIN тормозит из-за данных", at: "пн, 10:05" },
  { w: 0, a: "sakhibullina", state: "draft", headline: "" },
  { w: 0, a: "afanasyev", state: "not-started", headline: "" },
  { w: 0, a: "cheychenets", state: "submitted", headline: "Вклады банка Ж в топе, эксклюзивная ставка согласована", at: "сб, 12:30" },

  { w: 1, a: "muradyan", state: "submitted", headline: "Бюджет 2027: собрали презентацию, финансы сверяют цифры", at: "пн, 16:20" },
  { w: 1, a: "golovkin", state: "submitted", headline: "Сбой API СК Б: потеряли долю на три дня", at: "пн, 11:00" },
  { w: 1, a: "reva", state: "submitted", headline: "Согласовали дизайн-систему форм с платформой", at: "пн, 09:40" },
  { w: 1, a: "loginova", state: "submitted", headline: "Сравнение тарифов ДВС готово, рекомендация принята", at: "пн, 17:55" },
  { w: 1, a: "fatyanov", state: "late", headline: "Комитет СК А сдвинули на неделю", at: "вт, 09:15" },
  { w: 1, a: "sakhibullina", state: "submitted", headline: "Банк Д согласовал договор, интеграция на тесте", at: "пн, 14:10" },
  { w: 1, a: "afanasyev", state: "late", headline: "Партнёр З ушёл в другой канал", at: "вт, 10:30" },
  { w: 1, a: "cheychenets", state: "submitted", headline: "Фильтр «пополняемый вклад» ушёл в разработку", at: "пн, 12:00" },

  { w: 2, a: "muradyan", state: "submitted", headline: "Защитили структуру департамента", at: "пн, 15:00" },
  { w: 2, a: "golovkin", state: "submitted", headline: "FAQ по ОСАГО обновлён под новый закон", at: "пн, 13:20" },
  { w: 2, a: "reva", state: "submitted", headline: "Начали интервью с покупателями КАСКО", at: "пн, 10:10" },
  { w: 2, a: "loginova", state: "submitted", headline: "СК В без API, ищем обходной путь для ипотеки", at: "пн, 16:45" },
  { w: 2, a: "fatyanov", state: "submitted", headline: "Причины отказов в КАСКО собрать не успели", at: "пн, 17:30" },
  { w: 2, a: "sakhibullina", state: "submitted", headline: "Презентация для партнёров обновлена", at: "пн, 11:25" },
  { w: 2, a: "afanasyev", state: "submitted", headline: "Сверили выплаты партнёрам за сентябрь", at: "пн, 12:40" },
  { w: 2, a: "cheychenets", state: "submitted", headline: "Банк Ж готов обсуждать эксклюзивную ставку", at: "пн, 14:55" },
];

export const ENTRY_SEEDS: EntrySeed[] = [
  // Текущая неделя
  {
    w: 0, a: "golovkin", dir: "osago", block: "key-changes", type: "result",
    what: "Вернули долю СК Б в выдаче после сбоя API за три дня",
    details: "СК Б починила API, мы сняли ручное понижение в ранжировании и проверили цены на 300 расчётах.",
    impact: "Доля СК Б вернулась к уровню до сбоя, потерь по выручке за неделю почти нет.", ceo: true, task: 25,
  },
  {
    w: 0, a: "golovkin", dir: "osago", block: "risks", type: "risk",
    what: "Ранжирование по марже не успеваем: нет слота разработки",
    impact: "Каждая неделя задержки держит маржу на полис на уровне прошлого месяца.",
    next: "Договориться о слоте на следующий спринт", help: "Нужна помощь Арама: приоритет у CTO", ceo: true, task: 1,
  },
  {
    w: 0, a: "golovkin", dir: "osago", block: "partners", type: "event",
    what: "СК Б согласилась на встречу по росту отказов в регионах", next: "Встреча в среду, принесём выгрузку по регионам", task: 10,
  },
  {
    w: 0, a: "golovkin", dir: "department", block: "team", type: "plan",
    what: "Закрываем найм аналитика встречи до конца месяца", next: "Два финальных интервью на этой неделе",
  },
  {
    w: 0, a: "reva", dir: "product", block: "product", type: "event",
    what: "Запустили A/B тест упрощённого шага ввода данных авто",
    details: "Тест 50 на 50 на всём трафике ОСАГО, результат будет к пятнице.", task: 2,
    links: [{ title: "Дашборд теста", url: "https://example.com/ab-shag-avto" }],
  },
  {
    w: 0, a: "reva", dir: "product", block: "product", type: "result",
    what: "Новая страница результата ОСАГО на мобильных прошла дизайн-ревью", next: "Выкатка на 10% трафика в четверг", task: 18,
  },
  {
    w: 0, a: "reva", dir: "kasko", block: "product", type: "event",
    what: "Провели 3 из 5 интервью с покупателями КАСКО",
    details: "Главная боль: непонятно, что входит в полис. Двое из трёх уходили считать к агенту.", ceo: true, task: 26,
  },
  {
    w: 0, a: "reva", dir: "osago", block: "risks", type: "risk",
    what: "A/B тест оффера на главной стартовал на два дня позже",
    impact: "Решение по офферу сдвигается на неделю.", task: 33,
  },
  {
    w: 0, a: "loginova", dir: "red", block: "partners", type: "event",
    what: "СК А прислала тарифы на годовой ВЗР", next: "Ждём СК Б, потом ставим в выдачу", task: 3,
  },
  {
    w: 0, a: "loginova", dir: "red", block: "risks", type: "risk",
    what: "Ипотека СК В стоит: у СК нет API",
    help: "Нужен контакт в ИТ СК В, может помочь Влад", task: 19,
  },
  {
    w: 0, a: "loginova", dir: "red", block: "key-changes", type: "event",
    what: "Конверсия ипотечного страхования упала на неделе", details: "Проверяем связь со ставками банков.", task: 50,
  },
  {
    w: 0, a: "fatyanov", dir: "kasko", block: "partners", type: "risk",
    what: "СК А вторую неделю не отвечает по новым условиям КВ",
    impact: "Без новых условий КАСКО в канале остаётся на старой марже.", help: "Нужна помощь Арама через куратора СК А", ceo: true, task: 4,
  },
  {
    w: 0, a: "fatyanov", dir: "kasko", block: "product", type: "risk",
    what: "Калькулятор по VIN: поставщик отдаёт данные с ошибками", next: "Сверяем 1000 VIN вручную, решаем про второго поставщика", task: 13,
  },
  {
    w: 0, a: "fatyanov", dir: "kasko", block: "partners", type: "plan",
    what: "Готовим оценку объёмов для пилота КАСКО по подписке", next: "Отправить СК А до среды", task: 28,
  },
  {
    w: 0, a: "fatyanov", dir: "kasko", block: "key-changes", type: "event",
    what: "Текст сравнения КАСКО и мини-КАСКО для лендинга готов", task: 44,
  },
  {
    w: 0, a: "sakhibullina", dir: "partners", block: "partners", type: "event",
    what: "Агрегатор Е просит ещё 0,5 п.п. к ставке", help: "Нужно решение Арама по потолку ставки", task: 21,
  },
  {
    w: 0, a: "sakhibullina", dir: "partners", block: "partners", type: "result",
    what: "Банк Д: интеграция ОСАГО на тесте, юристы согласовали договор", task: 5,
  },
  {
    w: 0, a: "cheychenets", dir: "deposits", block: "key-changes", type: "result",
    what: "Вклады банка Ж в топ-3 выдачи по ставке", impact: "Конверсия в заявку по вкладам выросла заметно к прошлой неделе.", ceo: true, task: 7,
  },
  {
    w: 0, a: "cheychenets", dir: "deposits", block: "partners", type: "result",
    what: "Банк Ж согласовал эксклюзивную ставку для Сравни", next: "Подписание и запуск с понедельника", ceo: true, task: 31,
  },
  {
    w: 0, a: "cheychenets", dir: "deposits", block: "risks", type: "risk",
    what: "Двое из пяти брокеров не дают данные для сравнения счетов", next: "Запускаем без них, добавим позже", task: 38,
  },
  {
    w: 0, a: "cheychenets", dir: "deposits", block: "team", type: "plan",
    what: "Первая рассылка по ставкам вкладов уйдёт в четверг", task: 47,
  },

  // Прошлая неделя
  { w: 1, a: "muradyan", dir: "department", block: "key-changes", type: "event", what: "Собрали презентацию бюджета 2027, финансы сверяют цифры", task: 8, ceo: true },
  { w: 1, a: "muradyan", dir: "department", block: "team", type: "plan", what: "Ревизия грейдов: матрица готова, обсуждаем с HR", task: 24 },
  { w: 1, a: "golovkin", dir: "osago", block: "risks", type: "risk", what: "Сбой API СК Б: три дня без СК Б в выдаче", impact: "Потеряли часть продаж ОСАГО за три дня.", ceo: true, task: 25 },
  { w: 1, a: "golovkin", dir: "osago", block: "product", type: "event", what: "Две СК отвечают в выдаче дольше 5 секунд", task: 41 },
  { w: 1, a: "reva", dir: "product", block: "product", type: "result", what: "Согласовали дизайн-систему форм с командой платформы", task: 42 },
  { w: 1, a: "reva", dir: "product", block: "product", type: "plan", what: "Готовим A/B тест шага ввода данных авто", task: 2 },
  { w: 1, a: "loginova", dir: "red", block: "key-changes", type: "result", what: "Сравнение тарифов ДВС у трёх СК готово", task: 12 },
  { w: 1, a: "loginova", dir: "red", block: "risks", type: "risk", what: "SEO-подрядчик сдвинул выпуск страниц ВЗР на две недели", task: 43 },
  { w: 1, a: "fatyanov", dir: "kasko", block: "partners", type: "event", what: "СК А перенесла комитет по КВ на неделю", task: 4 },
  { w: 1, a: "sakhibullina", dir: "partners", block: "partners", type: "result", what: "Банк Д согласовал договор, интеграция на тесте", task: 5, ceo: true },
  { w: 1, a: "sakhibullina", dir: "partners", block: "team", type: "plan", what: "Запускаем реферальную программу для агентов", task: 36 },
  { w: 1, a: "afanasyev", dir: "partners", block: "partners", type: "risk", what: "Партнёр З выбрал другой канал", task: 46 },
  { w: 1, a: "afanasyev", dir: "partners", block: "partners", type: "event", what: "Партнёры жалуются на срок выплат", task: 37, help: "Нужен регламент выплат от финансов" },
  { w: 1, a: "cheychenets", dir: "deposits", block: "product", type: "event", what: "Фильтр «пополняемый вклад» ушёл в разработку", task: 16 },

  // Позапрошлая неделя
  { w: 2, a: "muradyan", dir: "department", block: "team", type: "result", what: "Защитили структуру департамента", ceo: true },
  { w: 2, a: "golovkin", dir: "osago", block: "key-changes", type: "result", what: "FAQ по ОСАГО обновлён под новый закон", task: 32 },
  { w: 2, a: "reva", dir: "kasko", block: "product", type: "event", what: "Начали интервью с покупателями КАСКО", task: 26 },
  { w: 2, a: "loginova", dir: "red", block: "risks", type: "risk", what: "У СК В нет API для ипотечного страхования", task: 19 },
  { w: 2, a: "fatyanov", dir: "kasko", block: "risks", type: "risk", what: "Не успели собрать причины отказов в КАСКО", task: 20 },
  { w: 2, a: "sakhibullina", dir: "partners", block: "partners", type: "result", what: "Обновили презентацию для партнёров", task: 45 },
  { w: 2, a: "afanasyev", dir: "partners", block: "partners", type: "result", what: "Сверили выплаты партнёрам за сентябрь", task: 15 },
  { w: 2, a: "cheychenets", dir: "deposits", block: "partners", type: "event", what: "Банк Ж готов обсуждать эксклюзивную ставку", task: 31 },
];
