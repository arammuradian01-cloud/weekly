// Этап 35б: партнёрский канал в прогнозе месяца. Разбор листов LRF b2b, бюджет канала из P&L b2b, пересчёт партнёра от
// LBE, итоги по продуктам и каналам
import { describe, expect, it } from "vitest";
import { partnersImitation } from "@/lib/plan/partners-imitation";
import {
  computePartner,
  derivePartner,
  monthColumn,
  partnerDrivers,
  partnerTotals,
  policiesDelta,
  readPartners,
  readPnl,
  type PartnerLine,
} from "@/lib/plan/partners";
import type { Grid } from "@/lib/plan/lrf";

const OCT = "2026-10";
const read = (months = [OCT, "2026-11"], month = OCT) => readPartners(partnersImitation(months), month);
const byName = (lines: PartnerLine[], label: string, product = "osago") => lines.find((l) => l.label === label && l.product === product)!;

describe("листы партнёрского канала", () => {
  it("партнёры по продуктам и каналам, без итогов по типам и без бронирования", () => {
    const r = read();
    expect(r.found).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.lines.map((l) => `${l.channel} ${l.product} ${l.label}`)).toEqual([
      "cpa osago Банк Север",
      "cpa osago СК Восток / отказной",
      "cpa osago Банк Юг",
      "cpa osago Сервис штрафов",
      "cpa osago Прочие",
      "agents osago Агенты",
      "agents osago Агент API Один",
      "cpa red-mortgage Банк Север",
      "cpa red-mortgage Прочие",
      "cpa red-travel CPA-сеть Путешествия",
      "agents red-mortgage Агенты",
      "agents red-travel Агенты",
    ]);
    expect(new Set(r.lines.map((l) => l.code)).size).toBe(r.lines.length);
    expect(r.lines.map((l) => l.position)).toEqual(r.lines.map((_, i) => i));
  });

  it("значения партнёра: ёмкость, полисы, кросс, выручка, расходы и комиссия из строк блока", () => {
    const north = byName(read().lines, "Банк Север");
    expect(north.kind).toBe("FinancialOrganization");
    expect(north.lbe.capacity).toBe(50_000);
    expect(north.lbe.policies).toBe(20_000);
    expect(north.lbe.rpu).toBe(1_000);
    expect(north.lbe.crUpsale).toBe(0.1);
    expect(north.lbe.upsalePolicies).toBe(2_000);
    expect(north.lbe.revenue).toBeCloseTo(21.6, 9);
    expect(north.lbe.costs).toBeCloseTo(17.28, 9);
    expect(north.lbe.commission).toBe(0.8);
    // У агентов RED ёмкости нет, полисы без ключа, ключи в строках разбивки
    const agents = byName(read().lines, "Агенты", "red-mortgage");
    expect(agents.lbe.capacity).toBeUndefined();
    expect(agents.lbe.policies).toBe(1_200);
    expect(agents.lbe.revenue).toBeCloseTo(3.6, 9);
    expect(agents.lbe.commission).toBe(0.85);
  });

  it("колонка нужного месяца: LBE, а не факт, и следующий месяц со своими цифрами", () => {
    const nov = byName(read([OCT, "2026-11"], "2026-11").lines, "Банк Север");
    expect(nov.lbe.policies).toBeCloseTo(22_000, 6);
    expect(nov.code).toBe(byName(read().lines, "Банк Север").code);
    const grid = partnersImitation([OCT])["B2B. CPA & WAYBACK OSAGO LRF"]!;
    expect(monthColumn(grid, OCT, "LBE")).toBe(8);
    // Факт за октябрь в колонке ACT не берётся за LBE
    expect(monthColumn(grid, OCT, "BUD")).toBeUndefined();
    const pnl = partnersImitation([OCT])["B2B. PnL_b2b"]!;
    expect(monthColumn(pnl, OCT, "LBE")).toBe(6);
    expect(monthColumn(pnl, OCT, "BUD")).toBe(7);
  });

  it("P&L b2b: разбивка по каналам, PARTNERS и WAYBACK вместе, итог сверху и маржа в процентах не читаются", () => {
    const grid = partnersImitation([OCT])["B2B. PnL_b2b"]!;
    const p = readPnl(grid, { LBE: 6, BUD: 7 });
    expect(p.osago!.cpa!.BUD).toEqual({ revenue: 41, costs: 34.6, margin: expect.closeTo(6.4, 9) });
    expect(p.osago!.agents!.BUD.revenue).toBe(18);
    expect(p["red-mortgage"]!.agents!.BUD.costs).toBe(2.6);
    // LBE в P&L равен сумме партнёров
    expect(p.osago!.cpa!.LBE.revenue).toBeCloseTo(21.6 + 1.35 + 11.208 + 2.05, 9);
  });

  it("листов партнёрского канала нет: загрузка продуктов идёт как раньше; части листов нет: проблема", () => {
    expect(readPartners({}, OCT)).toEqual({ lines: [], totals: [], found: false, problems: [], warnings: [] });
    const sheets = partnersImitation([OCT]);
    delete sheets["B2B. AGENTS RED LRF"];
    delete sheets["B2B. PnL_b2b"];
    const r = readPartners(sheets, OCT);
    expect(r.found).toBe(true);
    expect(r.problems).toEqual(["Нет листа «B2B. AGENTS RED LRF»", "Нет листа «B2B. PnL_b2b»: бюджета канала не будет"]);
    // Листы без префикса таблицы-связки тоже читаются: источником может быть сам LRF b2b
    const plain = Object.fromEntries(Object.entries(partnersImitation([OCT])).map(([k, v]) => [k.replace("B2B. ", ""), v]));
    expect(readPartners(plain, OCT).lines).toHaveLength(12);
  });

  it("суммы партнёров не сходятся с итогом листа или с P&L: предупреждение", () => {
    const sheets = partnersImitation([OCT]);
    const grid = sheets["B2B. CPA & WAYBACK OSAGO LRF"] as Grid;
    const total = grid.findIndex((r) => r[5] === "Sravni TOTAL REVENUE (RUB MLN)");
    grid[total]![8] = 999;
    const pnl = sheets["B2B. PnL_b2b"] as Grid;
    const agents = pnl.findIndex((r, i) => i > pnl.findIndex((x) => x[4] === "AGETNS") && r[3] === "Revenue" && r[4] === "OSAGO");
    pnl[agents]![6] = 1;
    expect(readPartners(sheets, OCT).warnings).toEqual(["Лист «CPA & WAYBACK OSAGO LRF»: выручка партнёров не сходятся с итогом листа", "Агенты, ОСАГО: выручка партнёров не сходится с P&L b2b"]);
  });
});

describe("пересчёт партнёра", () => {
  const lines = read().lines;

  it("без корректировок прогноз совпадает с LBE до копейки у каждого партнёра", () => {
    for (const l of lines) {
      const L = derivePartner(l.lbe);
      const cur = computePartner(l.lbe, {});
      for (const k of ["policies", "revenue", "costs", "margin", "share", "upsalePolicies"] as const) expect(cur[k], `${l.label} ${k}`).toBe(L[k]);
    }
  });

  it("полисы +10%: выручка, кросс и расходы +10%, доля Сравни растёт, комиссия та же", () => {
    const north = byName(lines, "Банк Север");
    const cur = computePartner(north.lbe, { policies: 22_000 });
    expect(cur.revenueCore).toBeCloseTo(22, 9);
    expect(cur.upsalePolicies).toBeCloseTo(2_200, 9);
    expect(cur.revenue).toBeCloseTo(21.6 * 1.1, 9);
    expect(cur.costs).toBeCloseTo(17.28 * 1.1, 9);
    expect(cur.margin).toBeCloseTo((21.6 - 17.28) * 1.1, 9);
    expect(cur.share).toBeCloseTo(0.44, 9);
  });

  it("ёмкость меняет только долю; комиссия меняет только расходы и маржу; конверсия в кросс меняет кросс", () => {
    const north = byName(lines, "Банк Север");
    const cap = computePartner(north.lbe, { capacity: 100_000 });
    expect(cap.share).toBeCloseTo(0.2, 9);
    expect(cap.revenue).toBe(derivePartner(north.lbe).revenue);
    const comm = computePartner(north.lbe, { commission: 0.7 });
    expect(comm.revenue).toBe(derivePartner(north.lbe).revenue);
    expect(comm.costs).toBeCloseTo(21.6 * 0.7, 9);
    const cr = computePartner(north.lbe, { crUpsale: 0.2 });
    expect(cr.upsalePolicies).toBeCloseTo(4_000, 9);
    expect(cr.revenue).toBeCloseTo(20 + 3.2, 9);
  });

  it("партнёр без продаж в LBE начинает продавать: выручка из полисов и выручки на полис, расходы по комиссии", () => {
    const south = byName(lines, "Банк Юг");
    expect(derivePartner(south.lbe).revenue).toBe(0);
    const cur = computePartner(south.lbe, { policies: 1_000, rpu: 1_000 });
    expect(cur.revenue).toBeCloseTo(1, 9);
    expect(cur.costs).toBeCloseTo(0.85, 9);
    expect(cur.share).toBeCloseTo(0.025, 9);
  });

  it("конверсия в кросс в драйверах только там, где она есть в LRF", () => {
    expect(partnerDrivers(byName(lines, "Банк Север").lbe)).toEqual(["capacity", "policies", "rpu", "crUpsale", "commission"]);
    expect(partnerDrivers(byName(lines, "Агенты", "red-mortgage").lbe)).toEqual(["capacity", "policies", "rpu", "commission"]);
  });

  it("итоги по продукту и каналу: LBE и прогноз суммой партнёров, бюджет из P&L", () => {
    const r = read();
    const input = r.lines.map((l) => ({ ...l, drivers: l.label === "Банк Север" && l.product === "osago" ? { policies: 22_000 } : {} }));
    const t = partnerTotals(input, r.totals);
    const osagoCpa = t.byPair.get("osago:cpa")!;
    expect(osagoCpa.partners).toBe(5);
    expect(osagoCpa.adjusted).toBe(1);
    expect(osagoCpa.revenue.budget).toBe(41);
    expect(osagoCpa.revenue.forecast! - osagoCpa.revenue.lbe!).toBeCloseTo(2.16, 9);
    expect(osagoCpa.policies.budget).toBeNull();
    expect(t.byProduct.get("osago")!.revenue.budget).toBe(59);
    expect(t.byChannel.get("agents")!.partners).toBe(4);
    expect(t.total.partners).toBe(12);
    expect(policiesDelta(input, "osago")).toBeCloseTo(2_000, 9);
    expect(policiesDelta(input, "red-mortgage")).toBe(0);
  });
});
