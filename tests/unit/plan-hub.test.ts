// Этап 58: хаб «Единая воронка: данные». Разбор листов «Все СК» и плана по СК, месяц из ячейки, ранрейт линейно и по
// профилю дней недели, ссылка на хаб. Правки по проверке: сломанные листы не проходят молча, повторы, дни факта по
// правилу владельца (факт по вчерашний день), выручка с апсейлом, названия СК без учёта регистра и пробелов
import { describe, expect, it } from "vitest";
import {
  FACT_LAG_DAYS,
  HUB_SHEETS,
  REVENUE_FACT_COLUMNS,
  cellError,
  daysIn,
  factDay,
  isTotal,
  monthOf,
  nameList,
  parseHubSource,
  readSkPlan,
  readVseSk,
  runRate,
  skKey,
  snapshotDayIn,
  snapshotMonths,
} from "@/lib/plan/hub";
import { HUB_FAKE_SK, hubImitation } from "@/lib/plan/hub-imitation";
import type { Grid } from "@/lib/plan/lrf";

describe("месяц из ячейки", () => {
  it("дата числом Google, ISO со временем, «2026-10» и «01.10.2026»", () => {
    expect(monthOf(46296)).toBe("2026-10"); // 1 октября 2026
    expect(monthOf("2026-10-01 0:00:00")).toBe("2026-10");
    expect(monthOf("2026-10")).toBe("2026-10");
    expect(monthOf("01.10.2026")).toBe("2026-10");
    expect(monthOf("октябрь")).toBeNull();
    expect(monthOf(12)).toBeNull();
  });
  it("дата со временем: время дня отбрасывается, 30 сентября после полудня остаётся сентябрём", () => {
    expect(monthOf(46295.6)).toBe("2026-09"); // 30.09.2026 14:24
    expect(monthOf(46326.99)).toBe("2026-10"); // 31.10.2026 23:45
  });
  it("дней в месяце", () => {
    expect(daysIn("2026-10")).toBe(31);
    expect(daysIn("2028-02")).toBe(29);
  });
});

describe("правила владельца: день факта и выручка", () => {
  it("факт по вчерашний день: день загрузки минус один", () => {
    expect(FACT_LAG_DAYS).toBe(1);
    expect(factDay("2026-10-22")).toBe("2026-10-21");
    expect(factDay("2026-11-01")).toBe("2026-10-31");
    expect(factDay("2027-01-01")).toBe("2026-12-31");
  });
  it("снимок 1-го числа закрывает прошлый месяц и ничего не даёт текущему; после конца месяца это последний день", () => {
    expect(snapshotDayIn("2026-10-22", "2026-10")).toBe("2026-10-21");
    expect(snapshotDayIn("2026-11-01", "2026-10")).toBe("2026-10-31");
    expect(snapshotDayIn("2026-11-01", "2026-11")).toBeNull();
    expect(snapshotDayIn("2026-11-05", "2026-10")).toBe("2026-10-31");
    expect(snapshotDayIn("2026-10-02", "2026-10")).toBe("2026-10-01");
    expect(snapshotDayIn("2026-10-22", "2026-11")).toBeNull();
  });
  it("снимок хранит текущий месяц и прошлый; 1-го числа только прошлый, через год тоже", () => {
    expect(snapshotMonths("2026-10-22")).toEqual(["2026-10", "2026-09"]);
    expect(snapshotMonths("2027-01-02")).toEqual(["2027-01", "2026-12"]);
    expect(snapshotMonths("2026-11-01")).toEqual(["2026-10"]);
    expect(snapshotMonths("2027-01-01")).toEqual(["2026-12"]);
  });
  it("выручка-факт из выручки полисов и выручки апсейла", () => {
    expect(REVENUE_FACT_COLUMNS.map((c) => c.name)).toEqual(["POLICIES_REVENUE_WO_VAT", "UPSALE_REVENUE_WO_VAT"]);
  });
});

describe("названия и ячейки", () => {
  it("ключ СК без регистра и лишних пробелов, итог распознаётся в любом написании", () => {
    expect(skKey("  Альфа  Страхование ")).toBe(skKey("альфа страхование"));
    for (const t of ["Итого", "ИТОГО", "итого:", " Всего "]) expect(isTotal(t)).toBe(true);
    expect(isTotal("Итого Альфа")).toBe(false);
  });
  it("ошибки формул отличаются от текста и чисел", () => {
    for (const e of ["#REF!", "#N/A", "#VALUE!", "#DIV/0!", "#NAME?", "#ERROR!", "Loading..."]) expect(cellError(e)).toBe(e);
    expect(cellError("Альфа")).toBeNull();
    expect(cellError(12)).toBeNull();
    expect(cellError(null)).toBeNull();
  });
  it("список названий обрезается с хвостом «и ещё»", () => {
    expect(nameList(["А", "Б", "А"])).toBe("А, Б");
    expect(nameList(["А", "Б", "В"], 2)).toBe("А, Б и ещё 1");
  });
});

const VSE_HEAD = ["MONTH", "EXTRA", "PARTNER_NAME", "POOL", "WITH_UPSALE", "POLICIES_CNT", "POLICIES_INCOME", "POLICIES_REVENUE_VAT_INCLUDED", "POLICIES_REVENUE_WO_VAT", "UPSALE_REVENUE_WO_VAT"];

describe("лист «Все СК»", () => {
  it("колонки по заголовкам, пул и апсейл как логические, лишние колонки не мешают, выручка с апсейлом", () => {
    const grid = [
      VSE_HEAD,
      [46296, "x", "АльфаСтрахование", "False", "False", 1200, 8_400_000, 1_500_000, 1_229_508, 0],
      [46296, "x", "АльфаСтрахование", "True", "True", 300, 2_700_000, 0, 0, 172_131],
      ["", "", "", "", "", "", "", "", "", ""],
      // Google отдаёт флажки логическими значениями: разбор принимает их наравне с текстом
      ["2026-09-01", "x", "Ингосстрах", true, false, 900, null, null, 800_000, null],
    ] as unknown as Grid;
    const r = readVseSk(grid);
    expect(r.problems).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.months).toEqual(["2026-09", "2026-10"]);
    expect(r.rows).toEqual([
      { month: "2026-10", sk: "АльфаСтрахование", pool: false, upsale: false, policies: 1200, premium: 8_400_000, revenue: 1_229_508 },
      { month: "2026-10", sk: "АльфаСтрахование", pool: true, upsale: true, policies: 300, premium: 2_700_000, revenue: 172_131 },
      { month: "2026-09", sk: "Ингосстрах", pool: true, upsale: false, policies: 900, premium: null, revenue: 800_000 },
    ]);
  });
  it("нет колонки апсейла: выручка без апсейла и предупреждение, не блок", () => {
    const grid = [
      ["MONTH", "PARTNER_NAME", "POOL", "WITH_UPSALE", "POLICIES_CNT", "POLICIES_REVENUE_WO_VAT"],
      [46296, "Ингосстрах", "False", "True", 100, 50_000],
    ];
    const r = readVseSk(grid);
    expect(r.problems).toEqual([]);
    expect(r.rows[0]!.revenue).toBe(50_000);
    expect(r.warnings.join(" ")).toMatch(/нет колонки UPSALE_REVENUE_WO_VAT, выручка-факт по СК без выручки апсейла/);
  });
  it("без листа или без нужных колонок объясняет, чего не хватает", () => {
    expect(readVseSk(undefined).problems[0]).toMatch(/не найден/);
    expect(readVseSk([["Дата", "СК"]]).problems[0]).toMatch(/MONTH, PARTNER_NAME, POLICIES_CNT/);
    expect(readVseSk([["MONTH", "PARTNER_NAME", "POLICIES_CNT"]]).problems[0]).toMatch(/пустой/);
  });
  it("строка с СК и нечитаемым числом полисов или без месяца не выпадает молча: проблема с названием СК", () => {
    const grid = [VSE_HEAD, [46296, "x", "АльфаСтрахование", "False", "False", 1200, 1, 1, 1, 0], [46296, "x", "Ингосстрах", "False", "False", "", 1, 1, 1, 0], ["", "x", "Росгосстрах", "False", "False", 10, 1, 1, 1, 0]];
    const r = readVseSk(grid as Grid);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/не прочитаны строки у СК Ингосстрах, Росгосстрах/);
    expect(r.problems[0]).toMatch(/строка 3, POLICIES_CNT «пусто»/);
  });
  it("ошибка формулы в нужной ячейке это проблема с названием СК, в чужой колонке не мешает", () => {
    const grid = [VSE_HEAD, [46296, "#REF!", "АльфаСтрахование", "False", "False", 1200, 1, "#N/A", 1, 0], [46296, "x", "Ингосстрах", "False", "False", "#N/A", 1, 1, 1, 0], [46296, "x", "Росгосстрах", "False", "False", 5, 1, 1, "#VALUE!", 0]];
    const r = readVseSk(grid as Grid);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/ошибки в ячейках у СК Ингосстрах, Росгосстрах \(например, Ингосстрах: строка 3, POLICIES_CNT #N\/A\)/);
    expect(r.rows.map((x) => x.sk)).toEqual(["АльфаСтрахование"]);
  });
  it("строки месяцев вне снимка пропускаются без проверок; итог листа не считается СК", () => {
    const grid = [VSE_HEAD, ["2026-05-01", "x", "Ингосстрах", "False", "False", "#N/A", 1, 1, 1, 0], [46296, "x", "Итого", "False", "False", 99_999, 1, 1, 1, 0], [46296, "x", "Ингосстрах", "False", "False", 10, 1, 1, 1, 0]];
    const r = readVseSk(grid as Grid, ["2026-10", "2026-09"]);
    expect(r.problems).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.months).toEqual(["2026-05", "2026-10"]);
  });
  it("повтор ключа после нормализации пробелов и регистра складывается в одну строку", () => {
    const grid = [
      VSE_HEAD,
      [46296, "x", "Альфа Страхование", "False", "False", 100, 1000, 0, 10, 1],
      [46296, "x", "  Альфа  Страхование ", "False", "False", 50, null, 0, 5, null],
      [46296, "x", "альфа страхование", "False", "False", 1, 1, 0, null, null],
      [46296, "x", "Альфа Страхование", "True", "False", 7, 1, 0, 1, 0],
    ];
    const r = readVseSk(grid as Grid);
    expect(r.problems).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({ month: "2026-10", sk: "Альфа Страхование", pool: false, upsale: false, policies: 151, premium: 1001, revenue: 16 });
  });
});

const PLAN_HEAD = ["СК", "Раздел", "Канал", "Регион", "Код", "Показатель", "2026-09", "2026-10", "FY2026", "FY2027"];

describe("лист «План ОСАГО по СК»", () => {
  it("шапка после примечания, только раздел «Воронка» по всем каналам и регионам, только нужные коды", () => {
    const grid = [
      ["Источник: модель ОСАГО СК × каналы × регионы"],
      [],
      PLAN_HEAD,
      ["АльфаСтрахование", "Воронка", "Все каналы", "Все регионы", "pol", "Полисы", 100, 110, 1200, 1300],
      ["АльфаСтрахование", "Воронка", "Все каналы", "Все регионы", "kv_tot", "КВ", 0.14, 0.15, 0.14, 0.15],
      ["АльфаСтрахование", "Воронка", "Все каналы", "Все регионы", "traffic", "Трафик", 1, 1, 1, 1],
      ["АльфаСтрахование", "Каналы", "b2c", "Все регионы", "pol", "Полисы b2c", 1, 1, 1, 1],
      ["АльфаСтрахование", "Воронка", "Все каналы", "Москва", "pol", "Полисы Москва", 1, 1, 1, 1],
      ["ИТОГО", "Воронка", "Все каналы", "Все регионы", "pol", "Полисы", 100, 110, 1200, 1300],
    ];
    const r = readSkPlan(grid, "2026-10");
    expect(r.problems).toEqual([]);
    expect(r.periods).toEqual(["2026-09", "2026-10", "FY2026", "FY2027"]);
    expect(r.rows.filter((x) => x.sk === "АльфаСтрахование" && x.metric === "pol").map((x) => [x.period, x.value])).toEqual([["2026-09", 100], ["2026-10", 110], ["FY2026", 1200], ["FY2027", 1300]]);
    expect(r.rows.filter((x) => x.metric === "kv_tot").length).toBe(4);
    expect(r.rows.some((x) => x.value === 1)).toBe(false);
    expect(r.rows.filter((x) => x.sk === "ИТОГО").length).toBe(4);
  });
  it("без шапки или периодов объясняет", () => {
    expect(readSkPlan(undefined).problems[0]).toMatch(/не найден/);
    expect(readSkPlan([["Компания", "Код"]]).problems[0]).toMatch(/шапка/);
    expect(readSkPlan([["СК", "Код", "Показатель"]]).problems[0]).toMatch(/периодов/);
  });
  it("сломанный лист: подписи на месте, значения #REF! и #N/A. Это проблема с названием СК, а не пустой план", () => {
    const grid = [
      PLAN_HEAD,
      ["АльфаСтрахование", "Воронка", "Все каналы", "Все регионы", "pol", "Полисы", "#REF!", "#REF!", "#REF!", "#REF!"],
      ["Ингосстрах", "Воронка", "Все каналы", "Все регионы", "pol", "Полисы", "#N/A", "#N/A", "#N/A", "#N/A"],
    ];
    const r = readSkPlan(grid, "2026-10");
    expect(r.problems.join(" ")).toMatch(/ошибки в ячейках у СК АльфаСтрахование, Ингосстрах \(например, АльфаСтрахование: pol 2026-09 #REF!\)/);
    expect(r.problems.join(" ")).toMatch(/у полисов за 2026-10 нет ни одного числа/);
  });
  it("у полисов за текущий месяц нет ни одного числа или пропала колонка месяца: проблема", () => {
    const empty = [PLAN_HEAD, ["АльфаСтрахование", "Воронка", "Все каналы", "Все регионы", "pol", "Полисы", 100, "", 1, 1]];
    expect(readSkPlan(empty, "2026-10").problems).toEqual([`Лист «${HUB_SHEETS.skPlan}»: у полисов за 2026-10 нет ни одного числа`]);
    const noMonth = [["СК", "Раздел", "Канал", "Регион", "Код", "Показатель", "2026-09", "FY2026"], ["АльфаСтрахование", "Воронка", "Все каналы", "Все регионы", "pol", "Полисы", 100, 1]];
    expect(readSkPlan(noMonth, "2026-10").problems[0]).toMatch(/нет колонки текущего месяца 2026-10/);
    // Без месяца (разбор без проверки текущего месяца) лист читается
    expect(readSkPlan(noMonth).problems).toEqual([]);
  });
  it("повтор строки СК это проблема с названием СК; итог в разных написаниях тоже повтор", () => {
    const grid = [
      PLAN_HEAD,
      ["АльфаСтрахование", "Воронка", "Все каналы", "Все регионы", "pol", "Полисы", 100, 110, 1, 1],
      [" альфастрахование ", "Воронка", "Все каналы", "Все регионы", "pol", "Полисы", 100, 110, 1, 1],
      ["Итого", "Воронка", "Все каналы", "Все регионы", "pol", "Полисы", 100, 110, 1, 1],
      ["ВСЕГО", "Воронка", "Все каналы", "Все регионы", "pol", "Полисы", 100, 110, 1, 1],
    ];
    const r = readSkPlan(grid, "2026-10");
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/строка повторяется у СК альфастрахование, ИТОГО \(например, альфастрахование: pol, строки 2 и 3\)/);
  });
  it("канал и регион сравниваются точно: «Всего b2c» и «Все каналы кроме b2b» не берутся, регистр и пробелы не в счёт", () => {
    const grid = [
      PLAN_HEAD,
      ["АльфаСтрахование", "Воронка", "Всего b2c", "Все регионы", "pol", "Полисы", 1, 1, 1, 1],
      ["АльфаСтрахование", "Воронка", "Все каналы кроме b2b", "Все регионы", "pol", "Полисы", 2, 2, 2, 2],
      ["АльфаСтрахование", "Воронка", " ВСЕ  КАНАЛЫ ", "все регионы", "pol", "Полисы", 100, 110, 1200, 1300],
    ];
    const r = readSkPlan(grid, "2026-10");
    expect(r.problems).toEqual([]);
    expect(r.rows.map((x) => x.value)).toEqual([100, 110, 1200, 1300]);
  });
  it("периоды датой (Google отдаёт числом) и текстом даты, объединённые ячейки СК и Раздела протягиваются вниз", () => {
    const grid = [
      ["СК", "Раздел", "Канал", "Регион", "Код", "Показатель", 46266, 46296, "2026-11-01", "FY2026"],
      ["АльфаСтрахование", "Воронка", "Все каналы", "Все регионы", "pol", "Полисы", 100, 110, 120, 1200],
      ["", "", "Все каналы", "Все регионы", "kv_tot", "КВ", 0.1, 0.1, 0.1, 0.1],
      ["", "Каналы", "b2c", "Все регионы", "pol", "Полисы b2c", 1, 1, 1, 1],
      ["", "", "Все каналы", "Все регионы", "rev", "Выручка не из воронки", 9, 9, 9, 9],
      ["Ингосстрах", "Воронка", "Все каналы", "Все регионы", "pol", "Полисы", 50, 55, 60, 600],
    ];
    const r = readSkPlan(grid, "2026-10");
    expect(r.problems).toEqual([]);
    expect(r.periods).toEqual(["2026-09", "2026-10", "2026-11", "FY2026"]);
    expect(r.rows.filter((x) => x.sk === "АльфаСтрахование" && x.metric === "kv_tot")).toHaveLength(4);
    expect(r.rows.some((x) => x.value === 1 || x.value === 9)).toBe(false);
    expect(r.rows.filter((x) => x.sk === "Ингосстрах").map((x) => x.value)).toEqual([50, 55, 60, 600]);
  });
  it("повтор колонки периода (текстом и датой) это проблема, а не ошибка уникальности при загрузке", () => {
    const grid = [["СК", "Раздел", "Канал", "Регион", "Код", "2026-10", 46296], ["АльфаСтрахование", "Воронка", "Все каналы", "Все регионы", "pol", 1, 1]];
    expect(readSkPlan(grid, "2026-10").problems[0]).toMatch(/колонка периода 2026-10 повторяется/);
  });
  it("сломанная подпись строки (ошибка в колонке «Код» или «СК») это проблема", () => {
    const grid = [PLAN_HEAD, ["АльфаСтрахование", "Воронка", "Все каналы", "Все регионы", "pol", "Полисы", 100, 110, 1, 1], ["Ингосстрах", "Воронка", "Все каналы", "Все регионы", "#REF!", "Полисы", 100, 110, 1, 1]];
    expect(readSkPlan(grid, "2026-10").problems[0]).toMatch(/ошибки в ячейках у СК Ингосстрах \(например, Ингосстрах: строка 3, подпись #REF!\)/);
  });
});

describe("ранрейт по снимкам", () => {
  const month = "2026-10";
  it("один снимок: линейно по дням, профиля нет", () => {
    const r = runRate(month, [{ day: "2026-10-10", mtd: 1000 }])!;
    expect(r.elapsed).toBe(10);
    expect(r.linear).toBe(3100);
    expect(r.profile).toBeNull();
    expect(r.forecast).toBe(3100);
    expect(r.unstable).toBe(false);
  });
  it("снимки другого месяца не учитываются, без снимков null", () => {
    expect(runRate(month, [{ day: "2026-09-30", mtd: 5000 }])).toBeNull();
    expect(runRate(month, [])).toBeNull();
  });
  it("при 14 дневных снимках подряд считает по профилю дней недели: выходные слабее, остаток месяца по календарю", () => {
    // Будни 120 в день, выходные 40: 1 октября 2026 это четверг
    let mtd = 0;
    const snaps: { day: string; mtd: number }[] = [];
    for (let d = 1; d <= 15; d++) {
      const wd = new Date(Date.UTC(2026, 9, d)).getUTCDay();
      mtd += wd === 0 || wd === 6 ? 40 : 120;
      snaps.push({ day: `2026-10-${String(d).padStart(2, "0")}`, mtd });
    }
    const r = runRate(month, snaps)!;
    expect(r.elapsed).toBe(15);
    // Остаток 16..31 октября: 11 будней и 5 выходных дней
    expect(r.profile).toBe(mtd + 11 * 120 + 5 * 40);
    expect(r.forecast).toBe(r.profile);
    expect(Math.round(r.linear)).toBe(Math.round((mtd / 15) * 31));
  });
  it("пропуск дня не даёт дневного факта, профиль ждёт 14 известных дней", () => {
    const snaps = Array.from({ length: 15 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, mtd: (i + 1) * 100 })).filter((s) => s.day !== "2026-10-08");
    const r = runRate(month, snaps)!;
    expect(r.profile).toBeNull();
    expect(r.forecast).toBe(3100);
  });
  it("расхождение методов больше 10% помечается как нестабильное", () => {
    // Первые 14 дней по 100, потом один день 5000: профиль понедельника рванёт
    const snaps = Array.from({ length: 15 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, mtd: (i + 1) * 100 }));
    snaps.push({ day: "2026-10-16", mtd: 1500 + 5000 });
    const r = runRate(month, snaps)!;
    expect(r.profile).not.toBeNull();
    expect(r.unstable).toBe(true);
  });
  it("закрытие месяца: снимок 1-го числа следующего месяца становится последним днём, ранрейт равен итогу", () => {
    const day = snapshotDayIn("2026-11-01", month)!;
    const r = runRate(month, [{ day: snapshotDayIn("2026-10-22", month)!, mtd: 2100 }, { day, mtd: 3000 }])!;
    expect(r.day).toBe("2026-10-31");
    expect(r.elapsed).toBe(31);
    expect(r.linear).toBe(3000);
  });
});

describe("имитация хаба", () => {
  it("читается обоими разборами, план ИТОГО равен сумме СК, строка канала отсекается, факт по вчерашний день", () => {
    const grids = hubImitation("2026-10-21", "2026-09");
    const vse = readVseSk(grids[HUB_SHEETS.vseSk]);
    const plan = readSkPlan(grids[HUB_SHEETS.skPlan], "2026-10");
    expect(vse.problems).toEqual([]);
    expect(vse.warnings).toEqual([]);
    expect(plan.problems).toEqual([]);
    expect(new Set(vse.rows.map((r) => r.sk)).size).toBe(HUB_FAKE_SK.length);
    const total = plan.rows.find((r) => r.sk === "ИТОГО" && r.metric === "pol" && r.period === "2026-10")!.value!;
    const sum = plan.rows.filter((r) => r.sk !== "ИТОГО" && r.metric === "pol" && r.period === "2026-10").reduce((s, r) => s + r.value!, 0);
    expect(total).toBe(sum);
    expect(plan.rows.some((r) => r.value === 1)).toBe(false);
    // Снимок 21-го: факт по 20 число, примерно 20/31 от месяца
    const oct = vse.rows.filter((r) => r.month === "2026-10").reduce((s, r) => s + r.policies, 0);
    const monthly = HUB_FAKE_SK.reduce((s, x) => s + x.monthly, 0);
    expect(oct / monthly).toBeCloseTo(20 / 31, 2);
    // Выручка пула из выручки апсейла: колонка апсейла входит в выручку-факт
    expect(vse.rows.find((r) => r.month === "2026-10" && r.pool)!.revenue).toBeGreaterThan(0);
  });
  it("1-го числа строк текущего месяца ещё нет, прошлый месяц целиком", () => {
    const vse = readVseSk(hubImitation("2026-11-01", "2026-10")[HUB_SHEETS.vseSk]);
    expect(vse.months).toEqual(["2026-10"]);
  });
});

describe("ссылка на хаб", () => {
  it("из ссылки и как есть, мусор отвергается", () => {
    expect(parseHubSource("https://docs.google.com/spreadsheets/d/1KFYKwsRcxC98rHwxbAnV2s29IxQCicq4PVnB0AOEzsg/edit#gid=0")).toBe("1KFYKwsRcxC98rHwxbAnV2s29IxQCicq4PVnB0AOEzsg");
    expect(parseHubSource("1KFYKwsRcxC98rHwxbAnV2s29IxQCicq4PVnB0AOEzsg")).toBe("1KFYKwsRcxC98rHwxbAnV2s29IxQCicq4PVnB0AOEzsg");
    expect(parseHubSource("хаб")).toBeNull();
  });
});
