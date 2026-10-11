import { describe, expect, it } from "vitest";
import { lrfImitation } from "@/lib/plan/imitation";
import { cellNumber, findColumns, readLrf, rowLabel } from "@/lib/plan/lrf";
import { compute, deltaPct, derive, rollUp, rowsOf } from "@/lib/plan/model";
import { PRODUCTS, lrfMonth, productOf, topLevel } from "@/lib/plan/spec";

// Прогноз месяца по драйверам (этап 32): чтение листов LRF и пересчёт прогноза от корректировок драйверов

const OCT = "2026-10";

describe("чтение LRF", () => {
  it("метка месяца и числа из ячеек", () => {
    expect(lrfMonth("2026-10")).toBe("Oct_2026");
    expect(lrfMonth("2027-01")).toBe("Jan_2027");
    expect(cellNumber(12.5)).toBe(12.5);
    expect(cellNumber("1 234,5")).toBe(1234.5);
    expect(cellNumber("15%")).toBe(0.15);
    expect(cellNumber("-")).toBeNull();
    expect(cellNumber("#DIV/0!")).toBeNull();
    expect(cellNumber("")).toBeNull();
    expect(rowLabel([null, "  CR: WEB (%):  "])).toBe("CR: WEB (%):");
    expect(rowLabel([null, "12", "TOTAL REVENUE"])).toBe("TOTAL REVENUE");
  });

  it("колонки LBE и BUD нужного месяца, а не соседнего", () => {
    const grids = lrfImitation([OCT, "2026-11"]);
    const osago = findColumns(grids["OSAGO_KEY METRICS"]!, OCT);
    expect(osago.problem).toBeNull();
    expect(osago.columns).toEqual({ LBE: 3, BUD: 4 });
    expect(findColumns(grids["OSAGO_KEY METRICS"]!, "2026-11").columns).toEqual({ LBE: 5, BUD: 6 });
    expect(findColumns(grids["OSAGO_KEY METRICS"]!, "2026-12").problem).toMatch(/Нет колонки LBE Dec_2026 и BUD Dec_2026/);
  });

  it("все продукты и группа RED читаются без пропусков", () => {
    const read = readLrf(lrfImitation([OCT, "2026-11"]), OCT);
    expect(read.problems).toEqual([]);
    for (const p of read.products) {
      expect(p.problem, p.code).toBeNull();
      expect(p.missing, p.code).toEqual([]);
      expect(p.warnings, p.code).toEqual([]);
    }
    expect(read.groups.map((g) => [g.code, g.missing])).toEqual([["red", []]]);
  });

  it("повторяющиеся строки берутся по якорю: конверсия в продажу, а не в «Not sale», B2C из полисов, а не из трафика", () => {
    const read = readLrf(lrfImitation([OCT, "2026-11"]), OCT);
    const osago = read.products.find((p) => p.code === "osago")!;
    expect(osago.values.LBE.crWeb).toBe(0.1);
    expect(osago.values.LBE.crApp).toBe(0.25);
    expect(osago.values.BUD.crWeb).toBe(0.16);
    expect(osago.values.LBE.unitsB2c).toBe(225_000);
    expect(osago.values.LBE.unitsB2b).toBe(150_000);
    expect(osago.values.LBE.revenue).toBe(450);
    expect(osago.values.BUD.revenue).toBe(440);
    const kasko = read.products.find((p) => p.code === "kasko")!;
    expect(kasko.values.LBE.crWeb).toBe(0.19);
    expect(kasko.values.LBE.crApp).toBe(0.16);
    expect(kasko.values.LBE.unitsB2b).toBe(250);
    expect(kasko.values.LBE.revenue).toBe(14.4);
    // RED: у каждого продукта свой раздел, трафик и выручка свои
    const travel = read.products.find((p) => p.code === "red-travel")!;
    const mortgage = read.products.find((p) => p.code === "red-mortgage")!;
    expect(travel.values.LBE.trafficWeb).toBe(70_000);
    expect(mortgage.values.LBE.trafficWeb).toBe(140_000);
    expect(travel.values.LBE.units).toBeCloseTo(70_000 * 0.14 + 15_000 * 0.3 + 3_000, 6);
    expect(travel.values.LBE.rpu).toBe(930);
    const deposits = read.products.find((p) => p.code === "deposits")!;
    expect(deposits.values.LBE.units).toBe(56_000);
    // Выручка лидогенерации, а не FULL-DEAL с тем же названием строки
    expect(deposits.values.LBE.revenueCore).toBeCloseTo(56_000 * 134e-6, 9);
  });

  it("второй месяц читается из своих колонок", () => {
    const nov = readLrf(lrfImitation([OCT, "2026-11"]), "2026-11");
    const osago = nov.products.find((p) => p.code === "osago")!;
    expect(osago.values.LBE.revenue).toBeCloseTo(495, 9);
    expect(osago.values.LBE.crWeb).toBe(0.1);
    expect(nov.products.flatMap((p) => p.warnings)).toEqual([]);
  });

  it("продукты RED ищутся по строке трафика, а не по названию: строчные названия в итоге RED не мешают", () => {
    const grid = lrfImitation([OCT])["RED_KEY METRICS"]!;
    // В итоге RED есть строки «Travel insurance» и «Tick bite insurance» выше разделов продуктов
    expect(grid.findIndex((r) => rowLabel(r) === "Travel insurance")).toBeLessThan(grid.findIndex((r) => rowLabel(r) === "TRAVEL INSURANCE"));
    const read = readLrf(lrfImitation([OCT]), OCT);
    const units = (code: string) => read.products.find((p) => p.code === code)!.values.LBE.units!;
    const sum = ["red-mortgage", "red-travel", "red-accident", "red-property", "red-tick"].reduce((s, c) => s + units(c), 0);
    expect(sum).toBeCloseTo(read.groups[0]!.values.LBE.units!, 6);
    expect(units("red-tick")).toBeLessThan(units("red-property"));
  });

  it("строки не сходятся: предупреждение с продуктом и версией", () => {
    const grids = lrfImitation([OCT]);
    const grid = grids["OSAGO_KEY METRICS"]!;
    const row = grid.find((r) => rowLabel(r) === "B2C")!;
    row[3] = 100_000;
    const osago = readLrf(grids, OCT).products.find((p) => p.code === "osago")!;
    expect(osago.warnings).toEqual(["ОСАГО: трафик и конверсия не дают продажи B2C в LBE", "ОСАГО: B2C и B2B не сходятся с продажами всего в LBE"]);
  });

  it("нет листа: понятная проблема, остальные продукты читаются", () => {
    const grids = lrfImitation([OCT]);
    delete grids["CASCO LRF"];
    const read = readLrf(grids, OCT);
    expect(read.problems).toEqual(["Нет листа «CASCO LRF»"]);
    expect(read.products.find((p) => p.code === "kasko")!.problem).toMatch(/Нет листа/);
    expect(read.products.find((p) => p.code === "osago")!.problem).toBeNull();
  });
});

describe("пересчёт прогноза от драйверов", () => {
  const read = readLrf(lrfImitation([OCT]), OCT);
  const lbe = (code: string) => read.products.find((p) => p.code === code)!.values.LBE;

  it("без корректировок прогноз совпадает с LBE у всех продуктов", () => {
    for (const p of PRODUCTS) {
      const L = derive(lbe(p.code));
      const out = compute(p, lbe(p.code), {});
      for (const k of ["units", "revenue", "promoMargin", "directMargin"] as const) {
        if (L[k] == null) continue;
        expect(out[k], `${p.code} ${k}`).toBeCloseTo(L[k]!, 9);
      }
    }
  });

  it("производные: прочая выручка и расходы на продвижение", () => {
    const L = derive(lbe("osago"));
    // Прочая выручка: ретро-бонусы и прочее сверх выручки от продаж с апсейлами
    expect(L.revenueCore).toBe(420);
    expect(L.otherRevenue).toBeCloseTo(30, 9);
    expect(L.promoCosts).toBeCloseTo(280, 9);
  });

  it("конверсия сайта ОСАГО выше: растут полисы, выручка и обе маржи на одну сумму", () => {
    const spec = productOf("osago")!;
    const out = compute(spec, lbe("osago"), { crWeb: 0.12 });
    // +2 п.п. на 1,5 млн посетителей: +30 000 полисов B2C
    expect(out.unitsB2c).toBeCloseTo(255_000, 6);
    expect(out.units).toBeCloseTo(405_000, 6);
    // Выручка от продаж растёт пропорционально полисам: 420 × 405/375
    expect(out.revenue).toBeCloseTo(420 * (405 / 375) + 30, 6);
    const gain = out.revenue! - 450;
    expect(out.promoMargin).toBeCloseTo(170 + gain, 6);
    expect(out.directMargin).toBeCloseTo(150 + gain, 6);
  });

  it("выручка на полис и расходы на продвижение", () => {
    const spec = productOf("osago")!;
    const out = compute(spec, lbe("osago"), { rpu: 1_210, promoCosts: 300 });
    expect(out.units).toBeCloseTo(375_000, 6);
    expect(out.revenue).toBeCloseTo(420 * 1.1 + 30, 6);
    expect(out.promoMargin).toBeCloseTo(492 - 300, 6);
    expect(out.directMargin).toBeCloseTo(150 + (192 - 170), 6);
  });

  it("продажи B2B и трафик приложения КАСКО", () => {
    const spec = productOf("kasko")!;
    const L = derive(lbe("kasko"));
    const out = compute(spec, lbe("kasko"), { unitsB2b: 350, trafficApp: 20_000 });
    expect(out.unitsB2c).toBeCloseTo(L.unitsB2c! + 1_000 * 0.16, 6);
    expect(out.units).toBeCloseTo(L.units! + 100 + 160, 6);
  });

  it("вклады: клики задаются числом", () => {
    const spec = productOf("deposits")!;
    const out = compute(spec, lbe("deposits"), { units: 61_600 });
    const core = 56_000 * 134e-6;
    expect(out.revenue).toBeCloseTo(17.3 + core * 0.1, 9);
  });

  it("итог RED: значение группы по LBE плюс изменения продуктов", () => {
    const group = read.groups[0]!.values.LBE;
    const parts = PRODUCTS.filter((p) => p.group === "red").map((p) => ({ lbe: lbe(p.code), current: compute(p, lbe(p.code), {}) }));
    const same = rollUp(group, parts);
    expect(same.revenue).toBeCloseTo(group.revenue!, 9);
    expect(same.directMargin).toBeCloseTo(group.directMargin!, 9);
    const travel = productOf("red-travel")!;
    const changed = parts.map((p, i) => (PRODUCTS.filter((x) => x.group === "red")[i]!.code === "red-travel" ? { ...p, current: compute(travel, p.lbe, { promoCosts: derive(p.lbe).promoCosts! - 5 }) } : p));
    const up = rollUp(group, changed);
    expect(up.revenue).toBeCloseTo(group.revenue!, 9);
    expect(up.promoMargin).toBeCloseTo(group.promoMargin! + 5, 9);
    expect(up.directMargin).toBeCloseTo(group.directMargin! + 5, 9);
  });

  it("отклонение в процентах и состав строк экрана", () => {
    expect(deltaPct(110, 100)).toBeCloseTo(10, 9);
    expect(deltaPct(-90, -100)).toBeCloseTo(10, 9);
    expect(deltaPct(5, 0)).toBeNull();
    expect(deltaPct(null, 5)).toBeNull();
    const osagoRows = rowsOf(productOf("osago")!);
    expect(osagoRows.filter((r) => r.kind === "driver").map((r) => r.key)).toEqual(["trafficWeb", "trafficApp", "crWeb", "crApp", "unitsB2b", "rpu", "otherRevenue", "promoCosts"]);
    expect(osagoRows.filter((r) => r.kind === "result").map((r) => r.key)).toEqual(["unitsB2c", "units", "revenue", "promoMargin", "directMargin"]);
    // У КАСКО нет строки прямой маржи в LRF: её нет и на экране
    expect(rowsOf(productOf("kasko")!).some((r) => r.key === "directMargin")).toBe(false);
    expect(topLevel().map((t) => t.code)).toEqual(["osago", "kasko", "red", "deposits"]);
  });
});

describe("числа на экране и ввод", () => {
  it("формат показателей: штуки, доли, рубли, миллионы", async () => {
    const { formatPlan, formatPlanDelta, inputValue, parsePlanInput, driverBounds } = await import("@/lib/plan/format");
    expect(formatPlan(1_547_218.143, "count")).toBe("1 547 218");
    expect(formatPlan(0.1, "pct")).toBe("10,0%");
    expect(formatPlan(0.1038201978, "pct")).toBe("10,4%");
    expect(formatPlan(0.0432, "pct")).toBe("4,32%");
    expect(formatPlan(1069.94, "rub")).toBe("1 070 ₽");
    expect(formatPlan(479.236, "mln")).toBe("479,2");
    expect(formatPlan(14.454, "mln")).toBe("14,45");
    expect(formatPlan(null, "mln")).toBe("нет");
    expect(formatPlanDelta(0.12, 0.1, "pct")).toEqual({ text: "+2 п.п.", pct: null, sign: 1 });
    expect(formatPlanDelta(440, 450, "mln")).toEqual({ text: "-10", pct: "-2,2%", sign: -1 });
    expect(formatPlanDelta(5, 5, "mln")).toEqual({ text: "0", pct: null, sign: 0 });
    expect(formatPlanDelta(null, 5, "mln")).toBeNull();
    expect(inputValue(0.1038201978, "pct")).toBe("10,382");
    expect(inputValue(1_547_218.143, "count")).toBe("1547218");
    expect(parsePlanInput("10,5", "pct")).toBeCloseTo(0.105, 12);
    expect(parsePlanInput("1 500 000", "count")).toBe(1_500_000);
    expect(parsePlanInput("12%", "pct")).toBeCloseTo(0.12, 12);
    expect(parsePlanInput("", "count")).toBeNull();
    expect(parsePlanInput("1e5", "count")).toBeNaN();
    expect(parsePlanInput("десять", "count")).toBeNaN();
    expect(driverBounds("pct", 1.0146)).toEqual({ min: 0, max: 1.0146 * 5 });
    expect(driverBounds("mln", 30).min).toBe(-300);
  });
});

describe("крайние случаи LRF и пересчёта", () => {
  it("нет строк продаж в LBE: без корректировок выручка как в LBE, а не с нуля", () => {
    const kasko = productOf("kasko")!;
    const lbe = { rpu: 680, revenueCore: 9.5, revenue: 14.4, promoMargin: 8 };
    const out = compute(kasko, lbe, {});
    expect(out.revenue).toBeCloseTo(14.4, 9);
    expect(out.units).toBeNull();
    expect(out.promoMargin).toBeCloseTo(8, 9);
  });

  it("сезонный продукт с нулём продаж: без корректировок как в LBE, продажи добавляют выручку", () => {
    const deposits = productOf("deposits")!;
    const lbe = { units: 0, rpu: 150, revenueCore: 0.2, revenue: 0.3, promoMargin: 0.1, directMargin: 0.05 };
    expect(compute(deposits, lbe, {}).revenue).toBeCloseTo(0.3, 12);
    const up = compute(deposits, lbe, { units: 1_000 });
    expect(up.revenue).toBeCloseTo(0.3 + 0.15, 12);
    expect(up.directMargin).toBeCloseTo(0.05 + 0.15, 12);
  });

  it("месяц в шапке датой, прочерки и ошибки формул не названия строк", () => {
    const serial = (Date.UTC(2026, 9, 1) - Date.UTC(1899, 11, 30)) / 86_400_000;
    const grid = [[null, "LBE", "BUD", "LBE"], ["Sep_2026", serial, serial, "Nov_2026"]];
    expect(findColumns(grid, OCT).columns).toEqual({ LBE: 1, BUD: 2 });
    // Строка данных без названия тоже не шапка
    expect(findColumns([[null, "LBE", "BUD"], [null, "Sep_2026", "Sep_2026"], [null, 46_300, 46_310]], OCT).problem).toMatch(/Нет колонки/);
    // Число в строке с названием это цифра, а не месяц: нет октября, значит нет колонки
    const sep = [[null, "LBE", "BUD"], [null, "Sep_2026", "Sep_2026"], [null, "TOTAL OSAGO Web (MAU)", 46_300]];
    expect(findColumns(sep, OCT).problem).toMatch(/Нет колонки/);
    expect(rowLabel(["-", "PROMO MARGIN"])).toBe("PROMO MARGIN");
    expect(rowLabel(["#REF!", "TOTAL REVENUE"])).toBe("TOTAL REVENUE");
  });

  it("нет строки продаж B2C: поиск не съезжает на выручку b2c ниже", () => {
    const grids = lrfImitation([OCT]);
    grids["OSAGO_KEY METRICS"] = grids["OSAGO_KEY METRICS"]!.filter((r) => rowLabel(r) !== "B2C");
    const osago = readLrf(grids, OCT).products.find((p) => p.code === "osago")!;
    expect(osago.missing).toContain("unitsB2c");
  });

  it("границы при нуле в LBE широкие", async () => {
    const { driverBounds } = await import("@/lib/plan/format");
    expect(driverBounds("count", 0).max).toBe(10_000_000);
    expect(driverBounds("count", 400).max).toBe(4_000);
    expect(driverBounds("mln", 0)).toEqual({ min: -1_000, max: 1_000 });
  });
});
