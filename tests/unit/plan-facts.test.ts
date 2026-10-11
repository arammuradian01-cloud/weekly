// Этап 35: факт месяца по дням (разбор вставки из отчёта аналитиков, темп к прогнозу), месяц недели и текст сводки
import { describe, expect, it } from "vitest";
import { dayOf, daysInMonth, metricOf, numberOf, pace, parseFacts, productCode } from "@/lib/plan/facts";
import { planBriefText, planMonthOfWeek, type PlanBrief } from "@/lib/plan/brief";

const today = "2026-10-09";

describe("разбор факта по дням", () => {
  it("широкий вид из таблицы: табуляция, запятая в дробях, пробелы в разрядах", () => {
    const text = ["Дата\tПродукт\tПродажи\tВыручка, млн\tПромо-маржа, млн", "01.10.2026\tОСАГО\t13 450\t15,8\t5,9", "01.10.2026\tКАСКО\t2100\t3,2\t", "02.10.2026\tосаго\t12 900\t15,1\t-0,4"].join("\n");
    const r = parseFacts(text, today);
    expect(r.problems).toEqual([]);
    expect(r.rows).toBe(3);
    expect(r.entries).toEqual([
      { product: "osago", metric: "units", day: "2026-10-01", value: 13450 },
      { product: "osago", metric: "revenue", day: "2026-10-01", value: 15.8 },
      { product: "osago", metric: "promoMargin", day: "2026-10-01", value: 5.9 },
      { product: "kasko", metric: "units", day: "2026-10-01", value: 2100 },
      { product: "kasko", metric: "revenue", day: "2026-10-01", value: 3.2 },
      { product: "osago", metric: "units", day: "2026-10-02", value: 12900 },
      { product: "osago", metric: "revenue", day: "2026-10-02", value: 15.1 },
      { product: "osago", metric: "promoMargin", day: "2026-10-02", value: -0.4 },
    ]);
  });

  it("узкий вид через точку с запятой, деньги в рублях переводятся в миллионы, ISO-даты", () => {
    const text = ["дата;продукт;показатель;значение", "2026-10-03;Ипотечное страхование;Выручка, руб;2 500 000", "2026-10-03;ВЗР;Полисы;340", "2026-10-03;Вклады;клики;1200"].join("\n");
    const r = parseFacts(text, today);
    expect(r.problems).toEqual([]);
    expect(r.entries).toEqual([
      { product: "red-mortgage", metric: "revenue", day: "2026-10-03", value: 2.5 },
      { product: "red-travel", metric: "units", day: "2026-10-03", value: 340 },
      { product: "deposits", metric: "units", day: "2026-10-03", value: 1200 },
    ]);
  });

  it("ошибки по строкам: дата, будущий день, продукт, показатель, число, повтор, рубли без пометки, отрицательные продажи", () => {
    const text = [
      "Дата,Продукт,Показатель,Значение",
      "31.02.2026,ОСАГО,Продажи,10",
      "10.10.2026,ОСАГО,Продажи,10",
      "01.10.2026,Ипотека и всё,Продажи,10",
      "01.10.2026,ОСАГО,Конверсия,10",
      "01.10.2026,ОСАГО,Продажи,10%",
      "01.10.2026,ОСАГО,Продажи,10",
      "01.10.2026,ОСАГО,Продажи,11",
      "01.10.2026,ОСАГО,Выручка,15800000",
      "01.10.2026,КАСКО,Продажи,-5",
      "01.01.2025,КАСКО,Продажи,5",
    ].join("\n");
    const r = parseFacts(text, today);
    expect(r.problems).toEqual([
      "Строка 2: дата не разобрана, нужен вид 07.10.2026",
      "Строка 3: 10.10.2026 ещё не наступило",
      "Строка 4: продукт «Ипотека и всё» не найден",
      "Строка 5: показатель «Конверсия» не найден: продажи, выручка или промо-маржа",
      "Строка 6: «10%» не число",
      "Строка 8: этот день продукта и показатель уже есть выше",
      "Строка 9: больше 10 000 млн за день. Если это рубли, напишите в заголовке «Выручка, руб»",
      "Строка 10: продажи не могут быть меньше нуля",
      "Строка 11: дата старше 13 месяцев",
    ]);
  });

  it("без заголовков и пустая вставка не разбираются; длинный список ошибок сокращается", () => {
    expect(parseFacts("", today).problems).toEqual(["Вставьте строки из отчёта: первая строка с заголовками"]);
    expect(parseFacts("01.10.2026\tОСАГО\t100", today).problems[0]).toMatch(/Первая строка: заголовки/);
    const many = ["Дата\tПродукт\tПродажи", ...Array.from({ length: 20 }, () => "нет\tОСАГО\t1")].join("\n");
    const r = parseFacts(many, today);
    expect(r.problems).toHaveLength(13);
    expect(r.problems[12]).toBe("И ещё 8 строк с ошибками");
    expect(parseFacts("Дата\tПродукт\tПродажи\n01.10.2026\tОСАГО\t", today).problems).toEqual(["В строках нет значений"]);
  });

  it("запятая-разделитель: заголовок с запятой и дробь через запятую не сдвигают колонки молча", () => {
    // Заголовок «Выручка, млн» через запятую: колонки не понять
    const shifted = parseFacts(["Дата,Продукт,Продажи,Выручка, млн,Промо-маржа, млн", "01.10.2026,ОСАГО,13450,15,8,5,9"].join("\n"), today);
    expect(shifted.problems[0]).toMatch(/Через запятую загружается только узкий вид/);
    expect(shifted.entries).toEqual([]);
    // Широкий вид через запятую без запятых в заголовке: «15,8» совпало бы с числом колонок, поэтому не принимается
    expect(parseFacts(["Дата,Продукт,Выручка млн,Промо-маржа млн", "01.10.2026,ОСАГО,15,8"].join("\n"), today).problems[0]).toMatch(/только узкий вид/);
    // Узкий вид: дробь через запятую даёт лишнюю колонку
    const extra = parseFacts(["Дата,Продукт,Показатель,Значение", "01.10.2026,ОСАГО,Выручка,15,8"].join("\n"), today);
    expect(extra.problems).toEqual(["Строка 2: колонок больше, чем в заголовке. Похоже, дробь записана через запятую при разделителе-запятой"]);
    // Пустая колонка в конце заголовка не мешает; CSV с кавычками из Excel разбирается
    const quoted = parseFacts(["\uFEFFДата,Продукт,Показатель,Значение,", '01.10.2026,ОСАГО,"Выручка, млн","15,8"', "01.10.2026,ОСАГО,Продажи,13450"].join("\n"), today);
    expect(quoted.problems).toEqual([]);
    expect(quoted.entries).toEqual([
      { product: "osago", metric: "revenue", day: "2026-10-01", value: 15.8 },
      { product: "osago", metric: "units", day: "2026-10-01", value: 13450 },
    ]);
    // Пустая колонка в конце заголовка не спасает дробь через запятую
    expect(parseFacts(["Дата,Продукт,Показатель,Значение,", "01.10.2026,ОСАГО,Выручка,15,8"].join("\n"), today).problems[0]).toMatch(/колонок больше, чем в заголовке/);
    // Незакрытая кавычка не склеивает ячейки
    expect(parseFacts(["Дата\tПродукт\tПродажи\tВыручка", '01.10.2026\tОСАГО\t"100\t15'].join("\n"), today).problems).toEqual(["Строка 2: кавычка не закрыта"]);
  });

  it("продажи целым числом; тысячи и миллиарды рублей переводятся в миллионы", () => {
    const r = parseFacts(["Дата;Продукт;Продажи;Выручка, тыс. руб;Промо-маржа, млрд", "01.10.2026;ОСАГО;13,450;15 800;0,0059"].join("\n"), today);
    expect(r.problems).toEqual(["Строка 2: продажи целым числом, без дробей и разделителя тысяч «,»"]);
    expect(r.entries).toEqual([
      { product: "osago", metric: "revenue", day: "2026-10-01", value: 15.8 },
      { product: "osago", metric: "promoMargin", day: "2026-10-01", value: 5.9 },
    ]);
  });

  it("мелкие разборщики", () => {
    expect(dayOf("7.10.26")).toBe("2026-10-07");
    expect(dayOf("2026-02-30")).toBeNull();
    expect(numberOf("−1 234,5")).toBe(-1234.5);
    expect(numberOf("1.2.3")).toBeNull();
    expect(productCode("Несчастный случай")).toBe("red-accident");
    expect(productCode("нс")).toBe("red-accident");
    expect(productCode("клещ")).toBe("red-tick");
    expect(metricOf("Промо маржа, ₽")).toEqual({ key: "promoMargin", scale: 1e-6 });
    expect(metricOf("Выручка, млн руб")).toEqual({ key: "revenue", scale: 1 });
    expect(metricOf("Лиды")).toEqual({ key: "units", scale: 1 });
  });
});

describe("темп к прогнозу", () => {
  it("факт с начала месяца, прогноз на дату, выполнение и месяц при этом темпе", () => {
    const daily = [
      { day: "2026-10-01", value: 10 },
      { day: "2026-10-02", value: 12 },
      { day: "2026-10-04", value: 9 },
      { day: "2026-09-30", value: 100 },
    ];
    const p = pace(daily, "2026-10", 310)!;
    expect(p.toDate).toBe(31);
    expect(p.elapsed).toBe(4);
    expect(p.withData).toBe(3);
    expect(p.days).toBe(31);
    expect(p.planToDate).toBeCloseTo(40, 9);
    expect(p.execution).toBeCloseTo(0.775, 9);
    expect(p.runRate).toBeCloseTo(240.25, 9);
    expect(p.gap).toBeCloseTo(-69.75, 9);
    expect(pace([], "2026-10", 310)).toBeNull();
    expect(pace(daily, "2026-10", null)!.execution).toBeNull();
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
  });
});

describe("сводка для отчёта CEO", () => {
  it("месяц недели по её четвергу", () => {
    expect(planMonthOfWeek("2026-09-28")).toBe("2026-10");
    expect(planMonthOfWeek("2026-09-21")).toBe("2026-09");
    expect(planMonthOfWeek("2026-10-26")).toBe("2026-10");
  });

  it("текст: итог, корректировки и кто ждёт проверки", () => {
    const t = (forecast: number, lbe: number, budget: number) => ({ forecast, lbe, budget });
    const brief: PlanBrief = {
      month: "2026-10",
      monthLabel: "октябрь 2026",
      total: { revenue: { ...t(1210, 1200, 1300), without: [] }, promoMargin: { ...t(400, 410, 380), without: [] }, directMargin: { ...t(300, 310, 300), without: [] } },
      rows: [],
      reasons: [{ product: "ОСАГО", metric: "Конверсия сайта", value: "4,1%", lbe: "4,5%", reason: "Конверсия", comment: "Первая неделя ниже плана", author: "Головкин Владислав", at: "2026-10-06T07:00:00.000Z" }],
      waiting: [{ product: "КАСКО", owners: ["Фатьянов Евгений", "Рева Тарас"] }],
      pulledAt: "2026-10-05T07:00:00.000Z",
      partners: null,
      partnerReasons: [],
      partnersMore: 0,
    };
    expect(planBriefText(brief)).toEqual([
      "Октябрь 2026, итог по продуктам",
      "Выручка: прогноз 1 210,0 млн, LBE 1 200,0, бюджет 1 300,0, к бюджету -6,9%",
      "Промо-маржа: прогноз 400,0 млн, LBE 410,0, бюджет 380,0, к бюджету +5,3%",
      "Прямая маржа: прогноз 300,0 млн, LBE 310,0, бюджет 300,0, к бюджету 0,0%",
      "Корректировки команд:",
      "- ОСАГО, конверсия сайта: 4,1% вместо 4,5% по LBE. Конверсия: Первая неделя ниже плана (Головкин Владислав)",
      "Ждут проверки после загрузки LBE: КАСКО. Проверяют: Фатьянов Евгений, Рева Тарас",
    ]);
    // Этап 35б: партнёрский канал отдельной строкой после итога, он внутри продуктов
    const withPartners = planBriefText({ ...brief, partners: { revenue: t(200, 196.3, 193.9), margin: t(20, 20.3, 10.6), adjusted: 1, partners: 83, review: null, owners: [] } });
    expect(withPartners[4]).toBe("Партнёрский канал, внутри продуктов: выручка прогноз 200,0 млн, LBE 196,3, бюджет 193,9, к бюджету +3,1%; маржа прогноз 20,00 млн, LBE 20,30, бюджет 10,60, к бюджету +88,7%");
  });
});
