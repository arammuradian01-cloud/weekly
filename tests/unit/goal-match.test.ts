// Подбор цели к задаче по тексту (этап 55). После проверки кода: осторожная автоподстановка, номера целей без
// ложных совпадений с процентами и датами, словоформы. Реалистичные пары из проверки записаны здесь же.
import { describe, expect, it } from "vitest";
import { bestGoal, mentionsCode, rankGoals, sameStem, stem, tokens } from "@/lib/goals/match";

const GOALS = [
  { id: "osago", code: "РТ-1", title: "Рост выручки ОСАГО до 120 млн в месяц", metric: "Выручка ОСАГО, млн" },
  { id: "kasko", code: "РТ-2", title: "Запуск КАСКО в партнёрском канале", metric: "Продажи КАСКО у партнёров" },
  { id: "crm", code: "РТ-3", title: "Снизить отток клиентов через CRM-рассылки", metric: "Доля повторных покупок" },
  { id: "mortgage", code: "РТ-4", title: "Ипотечное страхование: конверсия в оплату 12%", metric: "Конверсия ипотечного страхования" },
];

const BOARD = [
  { id: "РТ-1", code: "РТ-1", title: "Подписка ОСАГО запущена и имеет P&L", metric: "Выручка подписки, млн" },
  { id: "РТ-2", code: "РТ-2", title: "Доля Сравни на рынке ОСАГО 12%" },
  { id: "РТ-3", code: "РТ-3", title: "Партнёрский канал: выручка 40 млн в квартал" },
  { id: "РТ-4", code: "РТ-4", title: "Запуск онлайн-продаж КАСКО с тремя страховыми" },
  { id: "РТ-5", code: "РТ-5", title: "Тарифная политика ВЗР: маржа не ниже 25%" },
  { id: "РТ-6", code: "РТ-6", title: "Снижение CAC платного трафика на 15%" },
  { id: "РТ-7", code: "РТ-7", title: "NPS клиентов после покупки полиса не ниже 60" },
  { id: "РТ-8", code: "РТ-8", title: "Короткие полисы КАСКО на 1-30 дней" },
];
// Та же команда, но цели пронумерованы как в таблице целей: «5», «6», ... «12»
const TABLE = BOARD.map((g, i) => ({ ...g, id: String(i + 5), code: String(i + 5) }));
const best = (text: string, goals: typeof GOALS | typeof BOARD = BOARD) => bestGoal(rankGoals(text, goals));

describe("основы слов", () => {
  it("словоформы совпадают, общие слова не считаются", () => {
    expect(stem("калькуляторов")).toBe(stem("калькулятор"));
    expect(stem("выручки")).toBe(stem("выручкой"));
    expect(stem("клиентов")).toBe(stem("клиенты"));
    expect(stem("доле")).toBe(stem("доля"));
    expect(sameStem(stem("партнёрском"), stem("партнёров"))).toBe(true);
    expect(sameStem(stem("конверсией"), stem("конверсия"))).toBe(true);
    expect(sameStem(stem("тарифу"), stem("тарифная"))).toBe(true);
    expect(sameStem(stem("страховых"), stem("страховые"))).toBe(true);
    expect(sameStem(stem("продукт"), stem("продажи"))).toBe(false);
    expect(tokens("Обновить калькулятор ОСАГО для партнёров и CRM")).toEqual(expect.arrayContaining([stem("осаго"), "crm"]));
    expect(tokens("и в на для")).toEqual([]);
    expect(tokens("Запуск роста клиентов страховой компании")).toEqual([]);
    expect(tokens("CR 24% в B2B, NPS и CAC")).toEqual(["cr", "b2b", "nps", "cac"]);
    expect(tokens("2027 10% 1.5")).toEqual([]);
  });
});

describe("подбор цели по тексту задачи", () => {
  it("два и больше совпавших слова подставляют цель", () => {
    expect(best("Выручка ОСАГО: обновить коэффициенты калькулятора", GOALS)).toBe("osago");
    expect(best("Подключить КАСКО у двух новых партнёров", GOALS)).toBe("kasko");
    expect(best("Письмо клиентам об оттоке: сегмент для CRM", GOALS)).toBe("crm");
    expect(best("Поднять конверсию ипотечного страхования на шаге оплаты", GOALS)).toBe("mortgage");
  });

  it.each([
    ["Подготовить расчёт P&L подписки ОСАГО на 2027", "РТ-1"],
    ["Отчёт по доле рынка ОСАГО за сентябрь", "РТ-2"],
    ["Согласовать с СК надбавку к тарифу ВЗР", "РТ-5"],
    ["Перераспределить бюджет платного трафика", "РТ-6"],
    ["Запустить опрос NPS после покупки", "РТ-7"],
    ["Подготовить материалы по РТ-3 к встрече", "РТ-3"],
  ])("«%s»: %s", (text, want) => expect(best(text)).toBe(want));

  it.each([
    // Одно общее слово: цель не подставляется, только показывается первой в списке
    "Найти точки роста в воронке",
    "Запуск новой версии лендинга",
    "Встреча со страховыми компаниями по комиссии",
    "Обзвонить клиентов с незавершённой оплатой",
    "Обновить тексты на странице полиса",
    "Интеграция с Ингосстрахом по КАСКО",
    "Согласовать график отпусков",
    "Подготовить презентацию для встречи",
  ])("«%s»: без подстановки", (text) => expect(best(text)).toBeNull());

  it("одно совпадение остаётся подсказкой: сходство есть, подстановки нет", () => {
    const r = rankGoals("Выкатить экран оплаты подписки", BOARD);
    expect(r[0]).toMatchObject({ id: "РТ-1", matches: 1 });
    expect(r[0]!.score).toBeGreaterThanOrEqual(0.2);
    expect(bestGoal(r)).toBeNull();
    expect(rankGoals("Что угодно", [])).toEqual([]);
  });

  it("длинный текст не ломает подбор и не тормозит", () => {
    const long = "анализ рынка ОСАГО КАСКО ВЗР NPS CAC выручка партнёры ".repeat(400);
    const t = performance.now();
    const r = rankGoals(long.slice(0, 2000), BOARD);
    expect(performance.now() - t).toBeLessThan(100);
    expect(r).toHaveLength(BOARD.length);
  });
});

describe("номера целей", () => {
  it("номер с буквами: «РТ-2», «рт 2», «РТ–2»; соседний номер не совпадает", () => {
    expect(mentionsCode("Сделать по РТ-2 до пятницы", "РТ-2")).toBe(true);
    expect(mentionsCode("сделать по рт 2", "РТ-2")).toBe(true);
    expect(mentionsCode("по РТ–2.", "РТ-2")).toBe(true);
    expect(mentionsCode("сделать по рт-21", "РТ-2")).toBe(false);
    expect(mentionsCode("Отчёт по D1", "D1")).toBe(true);
    expect(mentionsCode("Отчёт по Д1", "D1")).toBe(false);
  });

  it.each([
    ["Позвонить в 5 часов", "5"],
    ["Поднять конверсию на 10% на шаге оплаты", "10"],
    ["Отчёт к 12 ноября", "12"],
    ["Подключить 12 банков", "1.2"],
    ["Встреча 21.10 с Ренессансом", "2.1"],
    ["Запустить в 1 квартале", "В1"],
    ["Отчёт к 2 числу", "К2"],
  ])("«%s» не про цель %s", (text, code) => expect(mentionsCode(text, code)).toBe(false));

  it("цифровой номер только с пометкой: «№10», «#10», «цель 10»", () => {
    expect(mentionsCode("По №10: план на ноябрь", "10")).toBe(true);
    expect(mentionsCode("По # 10 план", "10")).toBe(true);
    expect(mentionsCode("Работаем на цель 1.2", "1.2")).toBe(true);
    expect(best("Поднять конверсию на 10% на шаге оплаты", TABLE)).toBeNull();
  });

  it("два номера в тексте: ничего не подставляем", () => {
    const goals = [
      { id: "a", code: "РТ-1", title: "Скоринг убыточности" },
      { id: "b", code: "РТ-2", title: "Короткие полисы" },
    ];
    expect(bestGoal(rankGoals("Связать РТ-1 и РТ-2", goals))).toBeNull();
    expect(bestGoal(rankGoals("Задача по РТ-2", goals))).toBe("b");
  });
});
