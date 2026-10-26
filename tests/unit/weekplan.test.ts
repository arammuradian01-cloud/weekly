// Этап 81: факт к плану по неделям. Чтение справочника, плана и факта из таблицы недель, расчёты экрана: факт к
// плану, вторая версия, месяц к дате, прогноз по темпу, неполные недели, сверка партнёров с каналом, фиксация
import { describe, expect, it } from "vitest";
import { WEEKPLAN_TABS, dayOf, isMonday, mondayOf, parseSheetId, readDict, readFact, readPlan, type Grid } from "@/lib/weekplan/contract";
import { IMITATION_FACT_IDS, IMITATION_LINES, imitationWeeks, weekParts, weekPlanImitation } from "@/lib/weekplan/imitation";
import { defaultWeek, figure, fkey, incomplete, itemTable, mkey, partnerChecks, products, series, wkey, type PlanData } from "@/lib/weekplan/view";
import { delta, pct, share, weekLabel } from "@/lib/weekplan/format";
import { fixCutoff, planSums } from "@/lib/weekplan/service";

const TODAY = "2026-10-26";
const grids = weekPlanImitation(TODAY);

function data(): PlanData {
  const dict = readDict(grids[WEEKPLAN_TABS.dict]);
  const plan = readPlan(grids[WEEKPLAN_TABS.plan], dict.rows);
  const fact = readFact(grids[WEEKPLAN_TABS.appFact], dict.rows, WEEKPLAN_TABS.appFact);
  const week = new Map<string, number>();
  const month = new Map<string, number>();
  for (const v of plan.rows) {
    if (v.week) week.set(wkey(v.lineId, v.version, v.week), (week.get(wkey(v.lineId, v.version, v.week)) ?? 0) + v.value);
    month.set(mkey(v.lineId, v.version, v.month), (month.get(mkey(v.lineId, v.version, v.month)) ?? 0) + v.value);
  }
  return { lines: dict.rows, weeks: imitationWeeks(), first: "2026-10-01", last: "2027-12-31", week, month, fact: new Map(fact.rows.map((f) => [fkey(f.lineId, f.week), f.value])) };
}

describe("чтение таблицы недель", () => {
  it("справочник: все строки, разрезы и единицы", () => {
    const d = readDict(grids[WEEKPLAN_TABS.dict]);
    expect(d.problems).toEqual([]);
    expect(d.rows).toHaveLength(IMITATION_LINES.length);
    const sk = d.rows.find((l) => l.id === "OS.SK.ALFA.R")!;
    expect(sk).toMatchObject({ cut: "страховая", counterparty: "АльфаСтрахование", unit: "млн ₽", monthOnly: false, label: "АльфаСтрахование: выручка" });
    expect(d.rows.find((l) => l.id === "OS.MON.RETRO")!.monthOnly).toBe(true);
  });

  it("справочник: кривой line_id, повтор и неизвестный срез не проходят", () => {
    const g = structuredClone(grids[WEEKPLAN_TABS.dict]) as Grid;
    g.push(["os tot", "ОСАГО", "итог"], ["OS.TOT.S", "ОСАГО", "итог", "все", "все", "все", "все", "Продажи", "шт", "", "нет"], ["OS.X.S", "ОСАГО", "что-то", "все", "все", "все", "все", "Продажи", "шт", "", "нет"]);
    const d = readDict(g);
    expect(d.problems.join(" ")).toMatch(/не похож на ключ/);
    expect(d.problems.join(" ")).toMatch(/OS\.TOT\.S повторяется/);
    expect(d.problems.join(" ")).toMatch(/неизвестный срез/);
  });

  it("план: части недели на стыке месяцев, строки только по месяцам, обе версии", () => {
    const dict = readDict(grids[WEEKPLAN_TABS.dict]).rows;
    const p = readPlan(grids[WEEKPLAN_TABS.plan], dict);
    expect(p.problems).toEqual([]);
    // Неделя 26.10-01.11.2026: шесть дней октября и один день ноября
    const parts = p.rows.filter((r) => r.lineId === "OS.TOT.S" && r.version === "BUD" && r.week === "2026-10-26");
    expect(parts.map((r) => [r.month, r.part])).toEqual([
      ["2026-10-01", 1],
      ["2026-11-01", 2],
    ]);
    expect(parts[0]!.value / parts[1]!.value).toBeCloseTo(6, 2);
    expect(p.rows.filter((r) => r.lineId === "OS.MON.RETRO" && r.version === "LRF")).toHaveLength(15);
    expect(p.rows.every((r) => r.part === 0 || isMonday(r.week))).toBe(true);
  });

  it("план: «не ок» в сверке, ошибка формулы и line_id не из справочника блокируют загрузку", () => {
    const dict = readDict(grids[WEEKPLAN_TABS.dict]).rows;
    const g = structuredClone(grids[WEEKPLAN_TABS.plan]) as Grid;
    g[2]![5] = "не ок";
    g[10]![15] = "#N/A";
    g.push(["XX.TOT.S", "Бюджет", "план", "2027-01-04", "2027-01-10", "2027-01-01", 1, "", "", "", "", "", "", "", "шт", 5]);
    const p = readPlan(g, dict);
    const text = p.problems.join(" ");
    expect(text).toMatch(/«не ок»/);
    expect(text).toMatch(/ошибка формулы #N\/A/);
    expect(text).toMatch(/line_id нет в справочнике: XX\.TOT\.S/);
  });

  it("план: неделя не понедельник и часть вне своего месяца не проходят", () => {
    const dict = readDict(grids[WEEKPLAN_TABS.dict]).rows;
    const g = structuredClone(grids[WEEKPLAN_TABS.plan]) as Grid;
    const row = g.findIndex((r) => r[0] === "OS.TOT.S" && r[3] === "2026-10-05");
    g[row]![3] = "2026-10-06";
    const row2 = g.findIndex((r) => r[0] === "OS.TOT.R" && r[3] === "2026-10-05");
    g[row2]![5] = "2026-12-01";
    const text = readPlan(g, dict).problems.join(" ");
    expect(text).toMatch(/не понедельник/);
    expect(text).toMatch(/не попадает в месяц/);
  });

  it("факт: шапка Weekly и шапка BI читаются одинаково, пустые недели пропускаются", () => {
    const dict = readDict(grids[WEEKPLAN_TABS.dict]).rows;
    const f = readFact(grids[WEEKPLAN_TABS.appFact], dict, WEEKPLAN_TABS.appFact);
    expect(f.problems).toEqual([]);
    // Закрыты на 26.10 четыре недели: 28.09, 05.10, 12.10, 19.10
    expect(new Set(f.rows.map((r) => r.week))).toEqual(new Set(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]));
    expect(f.rows).toHaveLength(IMITATION_FACT_IDS.length * 4);
    const bi: Grid = [
      ["line_id", "Неделя с", "Значение", "Обновлено", "Статус"],
      ["OS.TOT.S", 46293, 94376, 46320.5, "предварительно"],
      ["OS.TOT.S", "2026-10-12", "1 234,5", "", ""],
      ["OS.TOT.S", "2026-10-12", 1300, "", ""],
      ["OS.MON.RETRO", "2026-10-05", 5, "", ""],
      ["ZZ.TOT.S", "2026-10-05", 5, "", ""],
    ];
    const b = readFact(bi, dict, WEEKPLAN_TABS.biFact);
    expect(b.problems).toEqual([]);
    expect(b.rows).toEqual([
      { lineId: "OS.TOT.S", week: "2026-09-28", value: 94376, updatedAt: "2026-10-25 12:00", source: "предварительно" },
      { lineId: "OS.TOT.S", week: "2026-10-12", value: 1300, updatedAt: null, source: null },
    ]);
    expect(b.warnings.join(" ")).toMatch(/ZZ\.TOT\.S/);
    expect(b.warnings.join(" ")).toMatch(/только по месяцам/);
    expect(b.warnings.join(" ")).toMatch(/1 повторов/);
  });

  it("факт: неделя не понедельник и текст вместо числа не проходят", () => {
    const dict = readDict(grids[WEEKPLAN_TABS.dict]).rows;
    const f = readFact(
      [
        ["line_id", "week_start", "value"],
        ["OS.TOT.S", "2026-10-06", 5],
        ["OS.TOT.R", "2026-10-05", "много"],
      ],
      dict,
      "x",
    );
    expect(f.problems.join(" ")).toMatch(/не понедельник/);
    expect(f.problems.join(" ")).toMatch(/не число/);
  });

  it("даты и ссылки", () => {
    expect(dayOf(46300)).toBe("2026-10-05");
    expect(dayOf("05.10.2026")).toBe("2026-10-05");
    expect(dayOf("2026-02-30")).toBeNull();
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
    expect(parseSheetId("https://docs.google.com/spreadsheets/d/1VFo-cgGvwhgvb4lQcUCUVhsLnOVSlK_MaEsfv4vGp4A/edit#gid=1")).toBe("1VFo-cgGvwhgvb4lQcUCUVhsLnOVSlK_MaEsfv4vGp4A");
    expect(parseSheetId("не ссылка")).toBeNull();
    expect(weekParts("2026-09-28")).toEqual([["2026-10-01", 4]]);
  });
});

describe("расчёты экрана", () => {
  const d = data();

  it("неделя по умолчанию: последняя закрытая с фактом", () => {
    expect(defaultWeek(d, TODAY)).toBe("2026-10-19");
    expect(defaultWeek({ weeks: d.weeks, fact: new Map() }, TODAY)).toBe("2026-10-19");
    expect(defaultWeek(d, "2026-09-01")).toBe("2026-09-28");
  });

  it("факт к плану и вторая версия по строке и по сумме строк", () => {
    const f = figure(d, ["OS.TOT.S"], "2026-10-12", "BUD");
    const fact = d.fact.get(fkey("OS.TOT.S", "2026-10-12"))!;
    const bud = d.week.get(wkey("OS.TOT.S", "BUD", "2026-10-12"))!;
    const lrf = d.week.get(wkey("OS.TOT.S", "LRF", "2026-10-12"))!;
    expect(f.fact).toBe(fact);
    expect(f.plan).toBeCloseTo(bud, 6);
    expect(f.other).toBeCloseTo(lrf, 6);
    expect(f.vsPlan).toBeCloseTo(fact / bud - 1, 9);
    expect(f.vsOther).toBeCloseTo(fact / lrf - 1, 9);
    const both = figure(d, ["OS.TOT.R", "MI.TOT.R"], "2026-10-12", "LRF");
    expect(both.plan).toBeCloseTo(d.week.get(wkey("OS.TOT.R", "LRF", "2026-10-12"))! + d.week.get(wkey("MI.TOT.R", "LRF", "2026-10-12"))!, 6);
  });

  it("неполная неделя 28.09: процента к плану нет, факт есть", () => {
    expect(incomplete(d, "2026-09-28")).toBe(true);
    expect(incomplete(d, "2027-12-27")).toBe(true);
    expect(incomplete(d, "2026-10-05")).toBe(false);
    const f = figure(d, ["OS.TOT.S"], "2026-09-28", "BUD");
    expect(f.fact).not.toBeNull();
    expect(f.vsPlan).toBeNull();
  });

  it("месяц к дате и прогноз месяца по темпу: недели октября по выбранную", () => {
    const f = figure(d, ["OS.TOT.S"], "2026-10-19", "BUD");
    const weeks = ["2026-10-05", "2026-10-12", "2026-10-19"];
    const fact = weeks.reduce((s, w) => s + d.fact.get(fkey("OS.TOT.S", w))!, 0);
    const plan = weeks.reduce((s, w) => s + d.week.get(wkey("OS.TOT.S", "BUD", w))!, 0);
    expect(f.mtdFact).toBeCloseTo(fact, 6);
    expect(f.mtdPlan).toBeCloseTo(plan, 6);
    expect(f.monthPlan).toBeCloseTo(d.month.get(mkey("OS.TOT.S", "BUD", "2026-10-01"))!, 6);
    expect(f.forecast).toBeCloseTo((fact / plan) * f.monthPlan!, 6);
  });

  it("без факта у части строк: сумма помечена неполной, процента нет", () => {
    const f = figure(d, ["OS.TOT.S", "OS.SK.ALFA.S"], "2026-10-12", "BUD");
    expect(f.partial).toBe(true);
    expect(f.vsPlan).toBeNull();
    expect(figure(d, ["OS.SK.ALFA.S"], "2026-10-12", "BUD").fact).toBeNull();
  });

  it("ряд графика: факт только по неделям, где он есть у всех строк", () => {
    const s = series(d, ["OS.TOT.R", "MI.TOT.R"], "BUD");
    expect(s.weeks).toHaveLength(66);
    expect(s.fact.filter((v) => v !== null)).toHaveLength(4);
    expect(s.plan.every((v) => v !== null)).toBe(true);
  });

  it("таблица среза: позиция строкой, показатели колонками", () => {
    const t = itemTable(
      d,
      d.lines.filter((l) => l.cut === "страховая"),
      "2026-10-12",
      "BUD",
    );
    expect(t.metrics).toEqual(["S", "R"]);
    expect(t.rows.map((r) => r.name)).toEqual(["АльфаСтрахование", "Ингосстрах", "Росгосстрах"]);
    expect(t.rows[0]!.cells.R!.unit).toBe("млн ₽");
  });

  it("продукты по порядку справочника", () => {
    expect(products(d.lines).map((p) => p.code)).toEqual(["OS", "MI", "DE"]);
  });

  it("партнёры RED сходятся с каналом партнёров, у ОСАГО сверки нет", () => {
    const checks = partnerChecks(d, "MI", "2026-10-12");
    expect(checks).toHaveLength(4);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(partnerChecks(d, "OS", "2026-10-12")).toEqual([]);
    const broken = { ...d, week: new Map(d.week) };
    broken.week.set(wkey("MI.PART.BANKI_RU.S", "BUD", "2026-10-12"), 1);
    expect(partnerChecks(broken, "MI", "2026-10-12").filter((c) => !c.ok)).toHaveLength(1);
  });

  it("контрольные суммы плана: ОСАГО, выручка всех продуктов, только по месяцам", () => {
    const dict = readDict(grids[WEEKPLAN_TABS.dict]).rows;
    const plan = readPlan(grids[WEEKPLAN_TABS.plan], dict).rows;
    const sums = planSums(dict, plan);
    expect(sums.map((s) => s.label)).toEqual(["ОСАГО, полисы (OS.TOT.S)", "ОСАГО, выручка от продаж (OS.TOT.R)", "Выручка от продаж всех продуктов", "Только по месяцам (ретро, EV, медиа, VAS)"]);
    expect(sums[3]!.bud).toBeCloseTo(20 * 15, 6);
    const all = plan.filter((v) => v.version === "BUD" && ["OS.TOT.R", "MI.TOT.R", "DE.TOT.R"].includes(v.lineId)).reduce((s, v) => s + v.value, 0);
    expect(sums[2]!.bud).toBeCloseTo(all, 6);
  });
});

describe("фиксация и формат", () => {
  it("последний понедельник 18:00 по Москве", () => {
    // Понедельник 26.10 17:59 по Москве = 14:59 UTC: прошлый понедельник
    expect(fixCutoff(new Date("2026-10-26T14:59:00Z"))).toBe("2026-10-19");
    expect(fixCutoff(new Date("2026-10-26T15:00:00Z"))).toBe("2026-10-26");
    // Воскресенье 01.11 23:30 по Москве
    expect(fixCutoff(new Date("2026-11-01T20:30:00Z"))).toBe("2026-10-26");
  });

  it("числа, проценты, недели", () => {
    expect(pct(0.0523)).toBe("+5,2%");
    expect(pct(-0.1)).toBe("−10,0%");
    expect(share(1.052)).toBe("105,2%");
    expect(delta(110, 100, 0.1, "шт")).toEqual({ text: "+10", pct: "+10,0%", sign: 1 });
    expect(delta(9.5, 10, -0.05, "млн ₽")).toEqual({ text: "−0,5", pct: "−5,0%", sign: -1 });
    expect(weekLabel("2026-10-05", "2026-10-11")).toBe("05.10-11.10.2026");
    expect(weekLabel("2026-12-28", "2027-01-03")).toBe("28.12.2026-03.01.2027");
  });
});
