// Этап 58: хаб «Единая воронка: данные». Разбор листов «Все СК» и плана по СК, месяц из ячейки, ранрейт линейно и по
// профилю дней недели, ссылка на хаб
import { describe, expect, it } from "vitest";
import { HUB_SHEETS, daysIn, monthOf, parseHubSource, readSkPlan, readVseSk, runRate } from "@/lib/plan/hub";
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
  it("дней в месяце", () => {
    expect(daysIn("2026-10")).toBe(31);
    expect(daysIn("2028-02")).toBe(29);
  });
});

describe("лист «Все СК»", () => {
  it("колонки по заголовкам, пул и апсейл как логические, лишние колонки не мешают", () => {
    const grid = [
      ["MONTH", "EXTRA", "PARTNER_NAME", "POOL", "WITH_UPSALE", "POLICIES_CNT", "POLICIES_INCOME", "POLICIES_REVENUE_VAT_INCLUDED", "POLICIES_REVENUE_WO_VAT"],
      [46296, "x", "АльфаСтрахование", "False", "False", 1200, 8_400_000, 1_500_000, 1_229_508],
      [46296, "x", "АльфаСтрахование", "True", "True", 300, 2_700_000, 0, 0],
      ["", "", "", "", "", "", "", "", ""],
      // Google отдаёт флажки логическими значениями: разбор принимает их наравне с текстом
      ["2026-09-01", "x", "Ингосстрах", true, false, 900, null, null, 800_000],
    ] as unknown as Grid;
    const r = readVseSk(grid);
    expect(r.problem).toBeNull();
    expect(r.rows).toEqual([
      { month: "2026-10", sk: "АльфаСтрахование", pool: false, upsale: false, policies: 1200, premium: 8_400_000, revenue: 1_229_508 },
      { month: "2026-10", sk: "АльфаСтрахование", pool: true, upsale: true, policies: 300, premium: 2_700_000, revenue: 0 },
      { month: "2026-09", sk: "Ингосстрах", pool: true, upsale: false, policies: 900, premium: null, revenue: 800_000 },
    ]);
  });
  it("без листа или без нужных колонок объясняет, чего не хватает", () => {
    expect(readVseSk(undefined).problem).toMatch(/не найден/);
    expect(readVseSk([["Дата", "СК"]]).problem).toMatch(/MONTH, PARTNER_NAME, POLICIES_CNT/);
    expect(readVseSk([["MONTH", "PARTNER_NAME", "POLICIES_CNT"]]).problem).toMatch(/пустой/);
  });
});

describe("лист «План ОСАГО по СК»", () => {
  it("шапка после примечания, только раздел «Воронка» по всем каналам и регионам, только нужные коды", () => {
    const grid = [
      ["Источник: модель ОСАГО СК × каналы × регионы"],
      [],
      ["СК", "Раздел", "Канал", "Регион", "Код", "Показатель", "2026-09", "2026-10", "FY2026", "FY2027"],
      ["АльфаСтрахование", "Воронка", "Все каналы", "Все регионы", "pol", "Полисы", 100, 110, 1200, 1300],
      ["АльфаСтрахование", "Воронка", "Все каналы", "Все регионы", "kv_tot", "КВ", 0.14, 0.15, 0.14, 0.15],
      ["АльфаСтрахование", "Воронка", "Все каналы", "Все регионы", "traffic", "Трафик", 1, 1, 1, 1],
      ["АльфаСтрахование", "Каналы", "b2c", "Все регионы", "pol", "Полисы b2c", 1, 1, 1, 1],
      ["АльфаСтрахование", "Воронка", "Все каналы", "Москва", "pol", "Полисы Москва", 1, 1, 1, 1],
      ["ИТОГО", "Воронка", "Все каналы", "Все регионы", "pol", "Полисы", 100, 110, 1200, 1300],
    ];
    const r = readSkPlan(grid);
    expect(r.problem).toBeNull();
    expect(r.rows.filter((x) => x.sk === "АльфаСтрахование" && x.metric === "pol").map((x) => [x.period, x.value])).toEqual([["2026-09", 100], ["2026-10", 110], ["FY2026", 1200], ["FY2027", 1300]]);
    expect(r.rows.filter((x) => x.metric === "kv_tot").length).toBe(4);
    expect(r.rows.some((x) => x.value === 1)).toBe(false);
    expect(r.rows.filter((x) => x.sk === "ИТОГО").length).toBe(4);
  });
  it("без шапки или периодов объясняет", () => {
    expect(readSkPlan(undefined).problem).toMatch(/не найден/);
    expect(readSkPlan([["Компания", "Код"]]).problem).toMatch(/шапка/);
    expect(readSkPlan([["СК", "Код", "Показатель"]]).problem).toMatch(/периодов/);
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
});

describe("имитация хаба", () => {
  it("читается обоими разборами, план ИТОГО равен сумме СК, строка канала отсекается", () => {
    const grids = hubImitation("2026-10-21", "2026-09");
    const vse = readVseSk(grids[HUB_SHEETS.vseSk]);
    const plan = readSkPlan(grids[HUB_SHEETS.skPlan]);
    expect(vse.problem).toBeNull();
    expect(plan.problem).toBeNull();
    expect(new Set(vse.rows.map((r) => r.sk)).size).toBe(HUB_FAKE_SK.length);
    const total = plan.rows.find((r) => r.sk === "ИТОГО" && r.metric === "pol" && r.period === "2026-10")!.value!;
    const sum = plan.rows.filter((r) => r.sk !== "ИТОГО" && r.metric === "pol" && r.period === "2026-10").reduce((s, r) => s + r.value!, 0);
    expect(total).toBe(sum);
    expect(plan.rows.some((r) => r.value === 1)).toBe(false);
    // Текущий месяц по 21 число: примерно 21/31 от месяца
    const oct = vse.rows.filter((r) => r.month === "2026-10").reduce((s, r) => s + r.policies, 0);
    const monthly = HUB_FAKE_SK.reduce((s, x) => s + x.monthly, 0);
    expect(oct / monthly).toBeCloseTo(21 / 31, 2);
  });
});

describe("ссылка на хаб", () => {
  it("из ссылки и как есть, мусор отвергается", () => {
    expect(parseHubSource("https://docs.google.com/spreadsheets/d/1KFYKwsRcxC98rHwxbAnV2s29IxQCicq4PVnB0AOEzsg/edit#gid=0")).toBe("1KFYKwsRcxC98rHwxbAnV2s29IxQCicq4PVnB0AOEzsg");
    expect(parseHubSource("1KFYKwsRcxC98rHwxbAnV2s29IxQCicq4PVnB0AOEzsg")).toBe("1KFYKwsRcxC98rHwxbAnV2s29IxQCicq4PVnB0AOEzsg");
    expect(parseHubSource("хаб")).toBeNull();
  });
});
