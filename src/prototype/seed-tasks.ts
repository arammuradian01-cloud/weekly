// 51 выдуманная задача той же структуры, что вкладка «Задачи» в Insurance&Invest Bord.
// Названия компаний вымышлены (СК А, банк Д, агрегатор Е), реальных условий и цифр здесь нет.

import type { DirectionCode, PriorityCode, SourceCode, StateCode, StatusCode } from "./dictionaries";
import type { Owner, PersonSlug } from "./types";

export type TaskSeed = {
  n: number;
  owner: Owner;
  dir: DirectionCode;
  pr: PriorityCode;
  st: StatusCode;
  state?: StateCode;
  /** Срок: дней от сегодня (минус значит в прошлом) */
  due: number;
  title: string;
  outcome: string;
  where: string;
  /** Сколько дней назад обновляли «Где сейчас» */
  updated?: number;
  co?: PersonSlug[];
  blockedBy?: string;
  /** Переносы: на сколько дней каждый раз сдвигали срок и почему */
  transfers?: { days: number; reason: string; by: PersonSlug }[];
  source?: { kind: SourceCode; note: string };
  createdBy?: PersonSlug;
  created?: number;
  closed?: number;
  resolution?: string;
  links?: { title: string; url: string }[];
  comments?: { a: PersonSlug; t: string; ago: number; time?: string }[];
};

const meeting = (note: string) => ({ kind: "meeting" as const, note });

export const TASK_SEEDS: TaskSeed[] = [
  {
    n: 1, owner: "golovkin", dir: "osago", pr: "critical", st: "in-progress", state: "at-risk", due: -3,
    title: "Пересобрать ранжирование выдачи ОСАГО по марже",
    outcome: "Новая формула ранжирования в проде, маржа на полис не ниже прошлого месяца",
    where: "Формулу согласовали с аналитикой, ждём слот разработки на следующий спринт",
    updated: 4, source: { kind: "ceo", note: "Поручение CEO на встрече топ-команды" }, created: 34,
    comments: [
      { a: "muradyan", t: "Влад, если слот не дают, поднимаю вопрос на понедельничной встрече.", ago: 3, time: "11:20" },
      { a: "golovkin", t: "Принял, до четверга дам точную дату от разработки.", ago: 3, time: "12:05" },
    ],
  },
  {
    n: 2, owner: "reva", dir: "product", pr: "high", st: "in-progress", state: "on-track", due: 5,
    title: "Упростить шаг ввода данных авто в ОСАГО",
    outcome: "Конверсия шага выше на 3 п.п. по итогам A/B теста",
    where: "Тест запущен 50 на 50, набираем выборку до пятницы", updated: 2,
    source: meeting("Встреча команды"), created: 20,
    links: [{ title: "Макет нового шага", url: "https://example.com/maket-shag-avto" }],
  },
  {
    n: 3, owner: "loginova", dir: "red", pr: "high", st: "in-progress", state: "on-track", due: 12,
    title: "Запустить продажу ВЗР с годовым полисом",
    outcome: "Годовой ВЗР в выдаче у двух СК, первые продажи",
    where: "СК А прислала тарифы, СК Б на согласовании", updated: 3, source: meeting("Встреча команды"), created: 27,
  },
  {
    n: 4, owner: "fatyanov", dir: "kasko", pr: "critical", st: "in-progress", state: "blocked", due: -6,
    title: "Согласовать с СК А новые условия КВ по КАСКО",
    outcome: "Подписанное допсоглашение с новыми условиями с 1 числа",
    where: "Андеррайтинг СК А не отвечает вторую неделю", updated: 6,
    blockedBy: "Ждём ответ андеррайтинга СК А. Помочь может Арам через куратора СК",
    transfers: [{ days: 7, reason: "СК А перенесла комитет на неделю", by: "fatyanov" }],
    source: { kind: "ceo", note: "Поручение CEO" }, created: 41,
    comments: [
      { a: "fatyanov", t: "Комитет СК А сдвинули, новый срок поставил с запасом.", ago: 13, time: "16:40" },
      { a: "muradyan", t: "Напишу куратору сегодня.", ago: 2, time: "09:15" },
    ],
  },
  {
    n: 5, owner: "sakhibullina", dir: "partners", pr: "high", st: "in-progress", state: "on-track", due: 9,
    title: "Подключить банк Д к витрине ОСАГО",
    outcome: "Виджет ОСАГО в приложении банка Д, первые 100 полисов",
    where: "Интеграция на тесте у банка, юристы согласовали договор", updated: 1, co: ["golovkin"],
    source: meeting("Встреча команды"), created: 30,
  },
  {
    n: 6, owner: "afanasyev", dir: "partners", pr: "medium", st: "clarify", state: "on-track", due: 2,
    title: "Собрать отчёт по качеству трафика агрегатора Е",
    outcome: "Отчёт по доле отказов и конверсии трафика агрегатора Е за квартал",
    where: "Не ясно, считаем ли повторные заявки. Жду ответ от аналитики", updated: 5, source: meeting("Встреча команды"), created: 12,
  },
  {
    n: 7, owner: "cheychenets", dir: "deposits", pr: "high", st: "done", state: "on-track", due: -5,
    title: "Вывести вклады банка Ж в топ выдачи по ставке",
    outcome: "Вклады банка Ж в топ-3 выдачи по ставке",
    where: "Вклады в топе с понедельника", updated: 4, closed: 4, resolution: "Вклады банка Ж в топ-3 с 29.09, конверсия в заявку выросла",
    source: meeting("Встреча команды"), created: 25,
  },
  {
    n: 8, owner: "muradyan", dir: "department", pr: "critical", st: "in-progress", state: "on-track", due: 10,
    title: "Защитить бюджет 2027 по направлению",
    outcome: "Бюджет 2027 утверждён на комитете без урезания маркетинга",
    where: "Презентация собрана, сверяем цифры с финансами", updated: 1,
    source: { kind: "ceo", note: "Поручение CEO" }, created: 21, co: ["golovkin"],
  },
  {
    n: 9, owner: "all", dir: "department", pr: "medium", st: "in-progress", state: "at-risk", due: 1,
    title: "Обновить цели квартала в борде лидера",
    outcome: "У каждого лидера в борде цели Q4 с метриками и сроками",
    where: "Обновили 5 из 7 лидеров", updated: 2, source: meeting("Встреча команды"), createdBy: "muradyan", created: 9,
  },
  {
    n: 10, owner: "golovkin", dir: "osago", pr: "high", st: "in-progress", state: "at-risk", due: 3,
    title: "Разобрать рост отказов СК Б по ОСАГО в регионах",
    outcome: "Понятная причина роста отказов и план с СК Б",
    where: "Выгрузили отказы по регионам, ждём встречу с СК Б", updated: 18, source: meeting("Встреча команды"), created: 26,
  },
  {
    n: 11, owner: "reva", dir: "product", pr: "medium", st: "in-progress", state: "on-track", due: 20,
    title: "Описать CJM повторной покупки ОСАГО",
    outcome: "Карта пути клиента при продлении с точками потерь", where: "Собрали данные по продлениям за год", updated: 6,
    source: { kind: "other", note: "Инициатива продукта" }, created: 15,
  },
  {
    n: 12, owner: "loginova", dir: "red", pr: "medium", st: "done", due: -8,
    title: "Сравнить тарифы ДВС у трёх СК",
    outcome: "Таблица тарифов ДВС с рекомендацией по выдаче", where: "Таблица отправлена Араму", updated: 8, closed: 8,
    resolution: "Сравнение готово, рекомендация принята", source: meeting("Встреча команды"), created: 22,
    links: [{ title: "Сравнение тарифов ДВС", url: "https://example.com/dvs-tarify" }],
  },
  {
    n: 13, owner: "fatyanov", dir: "kasko", pr: "high", st: "in-progress", state: "at-risk", due: -2,
    title: "Запустить калькулятор КАСКО по VIN",
    outcome: "Калькулятор по VIN на сайте, доля заявок без ручного ввода от 30%",
    where: "Партнёр по VIN-базе отдаёт данные с ошибками, разбираемся", updated: 3,
    transfers: [
      { days: 10, reason: "Задержка договора с поставщиком VIN-базы", by: "fatyanov" },
      { days: 7, reason: "Нашли ошибки в данных поставщика", by: "fatyanov" },
    ],
    source: meeting("Встреча команды"), created: 48, co: ["reva"],
  },
  {
    n: 14, owner: "sakhibullina", dir: "partners", pr: "medium", st: "clarify", due: -1,
    title: "Подготовить шаблон договора для новых партнёров",
    outcome: "Шаблон договора согласован с юристами", where: "Юристы просят уточнить схему выплат", updated: 7,
    source: meeting("Встреча команды"), created: 19,
  },
  {
    n: 15, owner: "afanasyev", dir: "partners", pr: "low", st: "done", due: -10,
    title: "Проверить выплаты вознаграждения партнёрам за сентябрь",
    outcome: "Реестр выплат сверен, расхождений нет", where: "Сверено", updated: 9, closed: 9,
    resolution: "Расхождений нет, реестр передан в финансы", source: { kind: "other", note: "Регулярная задача" }, created: 14,
  },
  {
    n: 16, owner: "cheychenets", dir: "deposits", pr: "medium", st: "in-progress", state: "on-track", due: 6,
    title: "Добавить фильтр «пополняемый вклад» в выдачу",
    outcome: "Фильтр в выдаче вкладов на сайте и в приложении", where: "Дизайн готов, в разработке", updated: 2,
    source: { kind: "weekly", note: "Запись weekly Евгения Ч." }, created: 11,
  },
  {
    n: 17, owner: "golovkin", dir: "osago", pr: "medium", st: "cancelled", due: -4,
    title: "Настроить ежедневный отчёт по доле СК в продажах",
    outcome: "Ежедневный отчёт в почте у лидеров", where: "Отменена", updated: 12, closed: 12,
    resolution: "Такой отчёт уже делает команда аналитики, дублировать не стали", source: meeting("Встреча команды"), created: 24,
  },
  {
    n: 18, owner: "reva", dir: "product", pr: "high", st: "in-progress", state: "on-track", due: 4,
    title: "Переделать страницу результата ОСАГО на мобильных",
    outcome: "Новая страница результата в проде на мобильных", where: "Финальные правки дизайна", updated: 1,
    source: meeting("Встреча команды"), created: 18,
  },
  {
    n: 19, owner: "loginova", dir: "red", pr: "high", st: "in-progress", state: "blocked", due: 7,
    title: "Подключить ипотечное страхование СК В",
    outcome: "Ипотечное страхование СК В в выдаче", where: "Нет API у СК В, ищем обходной вариант", updated: 16,
    blockedBy: "У СК В нет API. Нужен контакт в ИТ СК, помочь может Влад", source: meeting("Встреча команды"), created: 33,
  },
  {
    n: 20, owner: "fatyanov", dir: "kasko", pr: "medium", st: "failed", due: -12,
    title: "Собрать причины отказов в КАСКО за квартал",
    outcome: "Разбор причин отказов по СК", where: "Не выполнена", updated: 12, closed: 11,
    resolution: "Не хватило данных от СК, перенесли в цели Q1", source: meeting("Встреча команды"), created: 40,
  },
  {
    n: 21, owner: "sakhibullina", dir: "partners", pr: "critical", st: "in-progress", state: "at-risk", due: 2,
    title: "Перезаключить договор с агрегатором Е на новых ставках",
    outcome: "Новый договор подписан, ставки не выше согласованных", where: "Агрегатор Е просит ещё 0,5 п.п., торгуемся", updated: 1,
    source: { kind: "ceo", note: "Поручение CEO" }, created: 16, co: ["afanasyev"],
    comments: [{ a: "afanasyev", t: "Подготовил расчёт, при каких ставках канал остаётся в плюсе.", ago: 1, time: "18:30" }],
  },
  {
    n: 22, owner: "sakhibullina", dir: "partners", pr: "medium", st: "proposed", due: 14,
    title: "Запустить промо для клиентов банка Д",
    outcome: "Промокод на ОСАГО для клиентов банка Д в приложении", where: "Предложена Павлом", updated: 2,
    source: { kind: "other", note: "Предложение лидера" }, createdBy: "afanasyev", created: 2,
  },
  {
    n: 23, owner: "cheychenets", dir: "deposits", pr: "low", st: "in-progress", state: "on-track", due: 25,
    title: "Обновить тексты карточек инвестпродуктов",
    outcome: "Новые тексты на всех карточках", where: "Тексты у редактора", updated: 9,
    source: { kind: "other", note: "Бэклог" }, created: 13,
  },
  {
    n: 24, owner: "muradyan", dir: "department", pr: "high", st: "in-progress", state: "on-track", due: 14,
    title: "Провести ревизию грейдов команды",
    outcome: "Грейды и вилки по каждой роли согласованы с HR", where: "Матрица грейдов готова, обсуждаем с HR", updated: 3,
    source: { kind: "other", note: "Защита структуры" }, created: 18,
  },
  {
    n: 25, owner: "golovkin", dir: "osago", pr: "critical", st: "done", due: -2,
    title: "Вернуть долю СК Б в выдаче после сбоя API",
    outcome: "Доля СК Б в выдаче на уровне до сбоя", where: "Вернули", updated: 2, closed: 2,
    resolution: "API СК Б стабилен, доля восстановлена за 3 дня", source: meeting("Встреча команды"), created: 9,
  },
  {
    n: 26, owner: "reva", dir: "product", pr: "medium", st: "in-progress", state: "on-track", due: 8,
    title: "Провести 5 интервью с покупателями КАСКО",
    outcome: "5 интервью и выводы для дорожной карты КАСКО", where: "Проведено 3 из 5", updated: 4, co: ["fatyanov"],
    source: meeting("Встреча команды"), created: 17,
  },
  {
    n: 27, owner: "loginova", dir: "red", pr: "low", st: "in-progress", state: "on-track", due: 30,
    title: "Собрать идеи по ИФЛ для бэклога",
    outcome: "Список гипотез по ИФЛ с оценкой", where: "Собрано 8 идей", updated: 11,
    source: { kind: "other", note: "Бэклог" }, created: 20,
  },
  {
    n: 28, owner: "fatyanov", dir: "kasko", pr: "high", st: "clarify", due: 5,
    title: "Договориться о пилоте КАСКО по подписке с СК А",
    outcome: "Согласованные условия пилота и дата старта", where: "СК А хочет понять объёмы, готовим оценку", updated: 3,
    source: { kind: "ceo", note: "Поручение CEO" }, created: 10,
  },
  {
    n: 29, owner: "sakhibullina", dir: "partners", pr: "medium", st: "in-progress", state: "on-track", due: 11,
    title: "Настроить отчёт по продажам партнёров в разрезе продуктов",
    outcome: "Еженедельный отчёт по партнёрам и продуктам", where: "Структура отчёта согласована", updated: 5,
    source: meeting("Встреча команды"), created: 14,
  },
  {
    n: 30, owner: "afanasyev", dir: "partners", pr: "high", st: "in-progress", state: "at-risk", due: 15,
    title: "Найти трёх новых партнёров в автосегменте",
    outcome: "Три подписанных партнёра из автосегмента", where: "Переговоры с двумя дилерами", updated: 19,
    source: meeting("Встреча команды"), created: 37,
  },
  {
    n: 31, owner: "cheychenets", dir: "deposits", pr: "critical", st: "in-progress", state: "on-track", due: 1,
    title: "Согласовать с банком Ж эксклюзивную ставку для Сравни",
    outcome: "Эксклюзивная ставка на сайте с понедельника", where: "Банк согласовал, ждём подписи", updated: 1,
    source: { kind: "ceo", note: "Поручение CEO" }, created: 8,
  },
  {
    n: 32, owner: "golovkin", dir: "osago", pr: "medium", st: "done", due: -6,
    title: "Обновить FAQ по ОСАГО после изменений закона",
    outcome: "Обновлённый FAQ на сайте", where: "Опубликовано", updated: 6, closed: 6,
    resolution: "FAQ обновлён и опубликован", source: { kind: "other", note: "Изменение закона" }, created: 15,
    links: [{ title: "Страница FAQ", url: "https://example.com/osago-faq" }],
  },
  {
    n: 33, owner: "reva", dir: "product", pr: "high", st: "in-progress", state: "on-track", due: -1,
    title: "Запустить A/B тест нового оффера на главной ОСАГО",
    outcome: "Результаты теста и решение по офферу", where: "Тест стартовал с задержкой на два дня", updated: 2,
    source: meeting("Встреча команды"), created: 12,
  },
  {
    n: 34, owner: "sakhibullina", dir: "red", pr: "medium", st: "proposed", due: 21,
    title: "Подготовить коробочный ВЗР для партнёров",
    outcome: "Коробка ВЗР с ценой и материалами для партнёров", where: "Предложена Светой", updated: 1,
    source: { kind: "other", note: "Предложение лидера" }, createdBy: "loginova", created: 1,
  },
  {
    n: 35, owner: "fatyanov", dir: "kasko", pr: "low", st: "cancelled", due: -9,
    title: "Обновить список СК в калькуляторе КАСКО",
    outcome: "Актуальный список СК", where: "Отменена", updated: 10, closed: 10,
    resolution: "Список обновится сам с запуском калькулятора по VIN", source: { kind: "other", note: "Бэклог" }, created: 30,
  },
  {
    n: 36, owner: "sakhibullina", dir: "partners", pr: "high", st: "in-progress", state: "on-track", due: 18,
    title: "Запустить реферальную программу для агентов",
    outcome: "Программа запущена, 50 агентов подключено", where: "Условия согласованы, готовим лендинг", updated: 4,
    source: meeting("Встреча команды"), created: 23,
  },
  {
    n: 37, owner: "afanasyev", dir: "partners", pr: "medium", st: "clarify", due: 3,
    title: "Разобрать жалобы партнёров на скорость выплат",
    outcome: "Срок выплат партнёрам не больше 10 рабочих дней", where: "Ждём от финансов текущий регламент", updated: 6,
    source: { kind: "weekly", note: "Запись weekly Павла" }, created: 10,
  },
  {
    n: 38, owner: "cheychenets", dir: "deposits", pr: "medium", st: "in-progress", state: "at-risk", due: 21,
    title: "Подготовить запуск сравнения брокерских счетов",
    outcome: "Раздел сравнения брокерских счетов на сайте", where: "Двое из пяти брокеров не дали данные", updated: 7,
    source: { kind: "other", note: "Цели квартала" }, created: 29,
  },
  {
    n: 39, owner: "muradyan", dir: "department", pr: "high", st: "in-progress", state: "on-track", due: 12,
    title: "Согласовать с ИТ и ИБ сервер для ресурса weekly",
    outcome: "Согласованный сервер и разрешение на рабочие данные", where: "Отправили запрос в ИБ", updated: 1,
    source: { kind: "other", note: "Проект weekly" }, created: 1,
  },
  {
    n: 40, owner: "all", dir: "department", pr: "low", st: "in-progress", state: "on-track", due: 6,
    title: "Заполнить карточки зон ответственности в Notion",
    outcome: "У каждого лидера заполнена карточка зоны", where: "Заполнили 4 из 7", updated: 5,
    source: meeting("Встреча команды"), createdBy: "golovkin", created: 12,
  },
  {
    n: 41, owner: "golovkin", dir: "osago", pr: "high", st: "in-progress", state: "at-risk", due: 9,
    title: "Сократить время ответа СК в выдаче до 3 секунд",
    outcome: "95% ответов СК в выдаче быстрее 3 секунд", where: "Две СК отвечают дольше 5 секунд", updated: 3, co: ["reva"],
    source: meeting("Встреча команды"), created: 28,
  },
  {
    n: 42, owner: "reva", dir: "product", pr: "medium", st: "done", due: -3,
    title: "Согласовать дизайн-систему форм с командой платформы",
    outcome: "Единые компоненты форм в дизайн-системе", where: "Согласовано", updated: 3, closed: 3,
    resolution: "Компоненты форм приняты в дизайн-систему", source: { kind: "other", note: "Платформа" }, created: 21,
  },
  {
    n: 43, owner: "loginova", dir: "red", pr: "high", st: "in-progress", state: "at-risk", due: -4,
    title: "Вывести ВЗР в топ поиска по запросу «страховка в Турцию»",
    outcome: "Страница ВЗР в топ-3 поиска по запросу", where: "Позиция 6, ждём индексации новых страниц", updated: 5,
    transfers: [{ days: 14, reason: "SEO-подрядчик сдвинул выпуск страниц", by: "loginova" }],
    source: meeting("Встреча команды"), created: 39,
  },
  {
    n: 44, owner: "fatyanov", dir: "kasko", pr: "medium", st: "in-progress", state: "on-track", due: 10,
    title: "Подготовить сравнение КАСКО и мини-КАСКО для лендинга",
    outcome: "Блок сравнения на лендинге КАСКО", where: "Текст готов, нужен дизайн", updated: 4,
    source: { kind: "other", note: "Маркетинг" }, created: 11,
  },
  {
    n: 45, owner: "sakhibullina", dir: "partners", pr: "low", st: "done", due: -7,
    title: "Обновить презентацию для партнёров",
    outcome: "Новая презентация с цифрами Q3", where: "Готово", updated: 7, closed: 7,
    resolution: "Презентация обновлена и разослана", source: { kind: "other", note: "Регулярная задача" }, created: 16,
  },
  {
    n: 46, owner: "afanasyev", dir: "partners", pr: "high", st: "failed", due: -5,
    title: "Вернуть партнёра З после паузы в сентябре",
    outcome: "Партнёр З возобновил продажи", where: "Не выполнена", updated: 5, closed: 5,
    resolution: "Партнёр выбрал другой канал, вернёмся к разговору в Q1", source: meeting("Встреча команды"), created: 31,
  },
  {
    n: 47, owner: "cheychenets", dir: "deposits", pr: "high", st: "in-progress", state: "on-track", due: 4,
    title: "Запустить ежемесячную рассылку по ставкам вкладов",
    outcome: "Первая рассылка ушла, открываемость от 25%", where: "Шаблон письма согласован", updated: 2,
    source: meeting("Встреча команды"), created: 13,
  },
  {
    n: 48, owner: "golovkin", dir: "osago", pr: "low", st: "in-progress", state: "on-track", due: 2,
    title: "Проверить корректность цен СК В в выдаче",
    outcome: "Цены СК В в выдаче совпадают с полисом", where: "Проверили 200 расчётов, расхождений 2", updated: 1,
    source: { kind: "other", note: "Жалобы клиентов" }, created: 6,
  },
  {
    n: 49, owner: "golovkin", dir: "product", pr: "high", st: "proposed", due: 28,
    title: "Собрать требования к личному кабинету страхователя",
    outcome: "Документ требований к личному кабинету", where: "Предложена Тарасом", updated: 1,
    source: { kind: "other", note: "Предложение лидера" }, createdBy: "reva", created: 1,
  },
  {
    n: 50, owner: "loginova", dir: "red", pr: "medium", st: "clarify", due: -2,
    title: "Разобрать падение конверсии ипотечного страхования",
    outcome: "Причина падения и план восстановления", where: "Не ясно, связано ли с изменением ставок банков", updated: 8,
    source: { kind: "weekly", note: "Запись weekly Светы" }, created: 15,
  },
  {
    n: 51, owner: "muradyan", dir: "department", pr: "medium", st: "in-progress", state: "on-track", due: 1,
    title: "Подготовить weekly для CEO за неделю",
    outcome: "Отчёт CEO отправлен до среды", where: "Ждём weekly лидеров до понедельника", updated: 0,
    source: { kind: "other", note: "Регулярная задача" }, created: 3,
  },
];
