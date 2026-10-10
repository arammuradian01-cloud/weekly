// Имитация листов LRF партнёрского канала для тестов и показа без ключа (этап 35б). Раскладка как в настоящем LRF b2b:
// названия строк в колонке F, ключи продукта, типа и партнёра в колонках B, C и E, сверху строка версий и строка месяцев.
// Партнёры и цифры выдуманы, но согласованы: суммы партнёров дают итог листа и LBE в P&L b2b

import { lrfMonth } from "./spec";
import type { Grid } from "./lrf";

type P = {
  name: string;
  /** Ключ партнёра в колонке E: у «Прочие» пусто */
  key: string;
  product: "OSAGO" | "Mortgage insurance" | "Travel insurance";
  kind: string;
  cap: number | null;
  pol: number;
  rpu: number | null;
  /** Конверсия в кросс и выручка на кросс-полис: только ОСАГО */
  cr?: number;
  rpuUp?: number;
  comm: number;
};

const OSAGO_CPA: P[] = [
  { name: "Банк Север", key: "Банк Север", product: "OSAGO", kind: "FinancialOrganization", cap: 50_000, pol: 20_000, rpu: 1_000, cr: 0.1, rpuUp: 800, comm: 0.8 },
  { name: "СК Восток / отказной", key: "СК Восток", product: "OSAGO", kind: "FinancialOrganization", cap: 3_000, pol: 1_500, rpu: 900, cr: 0, rpuUp: 0, comm: 0.55 },
  { name: "Банк Юг", key: "Банк Юг", product: "OSAGO", kind: "FinancialOrganization", cap: 40_000, pol: 0, rpu: null, cr: 0, rpuUp: 0, comm: 0.85 },
  { name: "Сервис штрафов", key: "Сервис штрафов", product: "OSAGO", kind: "IndustrySpecific", cap: 30_000, pol: 12_000, rpu: 850, cr: 0.12, rpuUp: 700, comm: 1 },
  { name: "Прочие", key: "", product: "OSAGO", kind: "CpaNetwork", cap: 5_000, pol: 2_000, rpu: 950, cr: 0.1, rpuUp: 750, comm: 0.85 },
];

const OSAGO_AGENTS: P[] = [
  { name: "Агент API Один", key: "Агент API Один", product: "OSAGO", kind: "Agents (partnership)", cap: 20_000, pol: 5_000, rpu: 1_300, cr: 0.1, rpuUp: 900, comm: 0.95 },
];
/** Обычные агенты ОСАГО: блок «AGENTS» без ёмкости, как в настоящем листе */
const OSAGO_PLAIN_AGENTS: P = { name: "AGENTS", key: "", product: "OSAGO", kind: "Agents", cap: null, pol: 10_000, rpu: 1_200, cr: 0.1, rpuUp: 850, comm: 0.9 };

const RED_CPA: P[] = [
  { name: "Банк Север", key: "Банк Север", product: "Mortgage insurance", kind: "FinancialOrganization", cap: 1_500, pol: 800, rpu: 2_000, comm: 0.85 },
  { name: "Прочие", key: "", product: "Mortgage insurance", kind: "Web", cap: 2_000, pol: 100, rpu: 2_500, comm: 0.9 },
  { name: "CPA-сеть Путешествия", key: "CPA-сеть Путешествия", product: "Travel insurance", kind: "CpaNetwork", cap: 10_000, pol: 300, rpu: 300, comm: 0.85 },
];

const RED_AGENTS: P[] = [
  { name: "AGENTS", key: "Agents", product: "Mortgage insurance", kind: "Agents", cap: null, pol: 1_200, rpu: 3_000, comm: 0.85 },
  { name: "AGENTS", key: "", product: "Travel insurance", kind: "Agents", cap: null, pol: 200, rpu: 1_100, comm: 0.7 },
];

type Money = { pol: number; core: number; cross: number; up: number; revenue: number; costs: number };

/** Цифры партнёра в месяце: k масштабирует объёмы, доли и выручка на полис те же */
function money(p: P, k: number): Money {
  const pol = p.pol * k;
  const core = p.rpu === null ? 0 : (pol * p.rpu) / 1e6;
  const cross = p.cr !== undefined ? pol * p.cr : 0;
  const up = p.rpuUp !== undefined ? (cross * p.rpuUp) / 1e6 : 0;
  const revenue = core + up;
  return { pol, core, cross, up, revenue, costs: revenue * p.comm };
}

const LABEL = 5;
type Cells = (string | number | null)[];

/** Сетка листа партнёров: колонки месяцев с версией LBE (первая колонка с ACT прошлого месяца, чтобы проверить выбор) */
function frame(title: string, months: string[]): { grid: Grid; first: number; width: number } {
  const first = 8;
  const width = first + months.length;
  const versions: Cells = Array(width).fill(null);
  const names: Cells = Array(width).fill(null);
  versions[LABEL] = title;
  versions[7] = "ACT";
  names[7] = lrfMonth(months[months.length - 1]!);
  months.forEach((m, i) => {
    versions[first + i] = "LBE";
    names[first + i] = lrfMonth(m);
  });
  return { grid: [versions, names, []], first, width };
}

function builder(title: string, months: string[]) {
  const { grid, first, width } = frame(title, months);
  const row = (label: string, values: ((k: number) => number | null) | null, keys?: [string, string, string]) => {
    const r: Cells = Array(width).fill(null);
    r[LABEL] = label;
    if (keys) [r[1], r[2], r[4]] = keys;
    if (values) months.forEach((_, i) => (r[first + i] = values(1 + i * 0.1)));
    grid.push(r);
  };
  return { grid, row };
}

/** Блок партнёра как в LRF: имя, ёмкость, доля, полисы, выручка на полис, кросс, выручка, расходы, комиссия, маржа */
function block(row: ReturnType<typeof builder>["row"], p: P, osago: boolean, agents: boolean) {
  const keys = (product: string): [string, string, string] => [product, p.kind, p.key];
  const m = (k: number) => money(p, k);
  const header = p.cap === null;
  row(p.name, header ? null : (k) => m(k).pol);
  if (!header) {
    row("TOTAL POLICIES", (k) => p.cap! * k);
    row("share Sravni of total policies, %", (k) => m(k).pol / (p.cap! * k));
  }
  // У агентов ипотеки полисы без ключа, а ключи в строках разбивки «Agents», как в настоящем листе
  if (header && !osago && p.key) {
    row("Sravni policies", (k) => m(k).pol);
    row("Agents", null, [p.product, p.kind, p.key]);
  } else row(osago ? "Sravni OSAGO policies" : "Sravni policies", (k) => m(k).pol, keys(p.product));
  row("revenue per policy, rub", p.rpu === null ? null : () => p.rpu);
  if (osago) {
    row("Sravni revenue w/o UpSale (RUB MLN)", (k) => m(k).core, keys("OSAGO"));
    row("CR: OSAGO policy -> UpSale policy (%)", () => p.cr ?? null);
    row("Sravni cross-sale policies", (k) => m(k).cross, keys("Mini-CASCO"));
    row("revenue per UpSale policy, rub", () => p.rpuUp ?? null);
    row("Sravni UpSale revenue (RUB MLN)", (k) => m(k).up, keys("Mini-CASCO"));
  }
  row("Sravni TOTAL REVENUE (RUB MLN)", (k) => m(k).revenue, osago ? undefined : keys(p.product));
  row(agents ? "Payments to agents (RUB MLN)" : "Partners costs (RUB MLN)", (k) => m(k).costs, keys(p.product));
  row(agents ? "Agents commission, %" : "Partners commission, %", () => p.comm);
  row("Sravni MARGIN (RUB MLN)", (k) => m(k).revenue - m(k).costs);
  row("Margin (% of revenue)", (k) => (m(k).revenue ? 1 - p.comm : null));
  row("", null);
}

const sum = (list: P[], k: number, pick: (x: Money) => number) => list.reduce((s, p) => s + pick(money(p, k)), 0);

function osagoCpa(months: string[]): Grid {
  const { grid, row } = builder("OSAGO", months);
  row("SRAVNI TOTAL OSAGO POLICIES", (k) => sum(OSAGO_CPA, k, (x) => x.pol));
  row("for information:", null);
  row("Sravni TOTAL REVENUE (RUB MLN)", (k) => sum(OSAGO_CPA, k, (x) => x.revenue));
  row("Partners costs (RUB MLN)", (k) => sum(OSAGO_CPA, k, (x) => x.costs));
  // Итог по типу партнёров: блок без ключей, он не читается
  const fin = OSAGO_CPA.filter((p) => p.kind === "FinancialOrganization");
  row("FINANCIAL ORGANIZATION", (k) => sum(fin, k, (x) => x.pol) / fin.reduce((s, p) => s + (p.cap ?? 0) * k, 0));
  row("TOTAL POLICIES", (k) => fin.reduce((s, p) => s + (p.cap ?? 0) * k, 0));
  row("Sravni OSAGO policies", (k) => sum(fin, k, (x) => x.pol));
  row("Sravni TOTAL REVENUE (RUB MLN)", (k) => sum(fin, k, (x) => x.revenue));
  row("where of:", null);
  for (const p of fin) block(row, p, true, false);
  row("SPECIFIC", null);
  block(row, OSAGO_CPA[3]!, true, false);
  row("CPA NETWORK", null);
  block(row, OSAGO_CPA[4]!, true, false);
  row("CHECK REVENUE", () => 1);
  return grid;
}

function osagoAgents(months: string[]): Grid {
  const { grid, row } = builder("OSAGO", months);
  const all = [OSAGO_PLAIN_AGENTS, ...OSAGO_AGENTS];
  row("SRAVNI TOTAL OSAGO POLICIES", (k) => sum(all, k, (x) => x.pol));
  row("Sravni TOTAL REVENUE (RUB MLN)", (k) => sum(all, k, (x) => x.revenue));
  row("Payments to agents (RUB MLN)", (k) => sum(all, k, (x) => x.costs));
  block(row, OSAGO_PLAIN_AGENTS, true, true);
  row("AGENTS API", (k) => sum(OSAGO_AGENTS, k, (x) => x.pol) / OSAGO_AGENTS.reduce((s, p) => s + (p.cap ?? 0) * k, 0));
  row("TOTAL POLICIES", (k) => OSAGO_AGENTS.reduce((s, p) => s + (p.cap ?? 0) * k, 0));
  row("Sravni OSAGO policies", (k) => sum(OSAGO_AGENTS, k, (x) => x.pol));
  for (const p of OSAGO_AGENTS) block(row, p, true, true);
  return grid;
}

function red(months: string[], list: P[], agents: boolean): Grid {
  const { grid, row } = builder("RED", months);
  row("SRAVNI TOTAL RED POLICIES", (k) => sum(list, k, (x) => x.pol));
  row("Sravni TOTAL REVENUE (RUB MLN)", (k) => sum(list, k, (x) => x.revenue));
  row(agents ? "Payments to agents (RUB MLN)" : "Partners costs (RUB MLN)", (k) => sum(list, k, (x) => x.costs));
  for (const product of ["Mortgage insurance", "Travel insurance"] as const) {
    const mine = list.filter((p) => p.product === product);
    row(product.toUpperCase(), null);
    if (!agents) row("TOTAL Sravni policies", (k) => sum(mine, k, (x) => x.pol));
    for (const p of mine) block(row, p, false, agents);
  }
  // Бронирование в прогноз не входит: блок с ключами неизвестного продукта пропускается
  row("BOOKING", null);
  row("AGENTS", () => 0);
  row("Sravni deals", () => 0, ["Booking", "Agents", ""]);
  row("Sravni TOTAL REVENUE (RUB MLN)", () => 0, ["Booking", "Agents", ""]);
  return grid;
}

/** P&L b2b: бюджет канала по продуктам. LBE равен сумме партнёров, бюджет свой */
function pnl(months: string[]): Grid {
  const first = 6;
  const width = first + months.length * 2;
  const nums: Cells = Array(width).fill(null);
  const versions: Cells = Array(width).fill(null);
  const names: Cells = Array(width).fill(null);
  nums[4] = "b2b (RUB MLN)";
  months.forEach((m, i) => {
    const short = `${lrfMonth(m).slice(0, 3)}'${m.slice(2, 4)}`;
    for (const [j, v] of [
      [0, "LBE"],
      [1, "BUD"],
    ] as const) {
      nums[first + i * 2 + j] = Number(m.slice(5));
      versions[first + i * 2 + j] = v;
      names[first + i * 2 + j] = short;
    }
  });
  const grid: Grid = [nums, versions, names];
  const row = (d: string, e: string, lbe: ((k: number) => number) | null, bud: number | null = null) => {
    const r: Cells = Array(width).fill(null);
    r[3] = d || null;
    r[4] = e;
    months.forEach((_, i) => {
      const k = 1 + i * 0.1;
      r[first + i * 2] = lbe ? lbe(k) : null;
      r[first + i * 2 + 1] = bud === null ? null : bud * k;
    });
    grid.push(r);
  };
  type Part = { list: P[]; bud: Record<string, [revenue: number, costs: number]> };
  const products: [string, P["product"]][] = [
    ["OSAGO", "OSAGO"],
    ["Mortgage insurance", "Mortgage insurance"],
    ["Travel insurance", "Travel insurance"],
  ];
  const section = (title: string, part: Part, costsTitle: string) => {
    row("", title, null);
    row("", "TOTAL REVENUE", (k) => sum(part.list, k, (x) => x.revenue));
    for (const [name, code] of products) row("Revenue", name, (k) => sum(part.list.filter((p) => p.product === code), k, (x) => x.revenue), part.bud[name]?.[0] ?? 0);
    row("", costsTitle, (k) => sum(part.list, k, (x) => x.costs));
    for (const [name, code] of products) row("Marketing expenses", name, (k) => sum(part.list.filter((p) => p.product === code), k, (x) => x.costs), part.bud[name]?.[1] ?? 0);
    row("", "PROMO MARGIN", (k) => sum(part.list, k, (x) => x.revenue - x.costs));
    for (const [name, code] of products) row("", name, (k) => sum(part.list.filter((p) => p.product === code), k, (x) => x.revenue - x.costs), (part.bud[name]?.[0] ?? 0) - (part.bud[name]?.[1] ?? 0));
    // Маржа в процентах после промо-маржи: не читается
    row("", "Margin, % of revenue", null);
    for (const [name] of products) row("", name, () => 0.1, 0.1);
  };
  const cpa = [...OSAGO_CPA, ...RED_CPA];
  const wayback = cpa.filter((p) => /отказной/.test(p.name));
  // Сверху итог по всем каналам: он не читается, читается разбивка по каналам
  row("", "TOTAL REVENUE", (k) => sum([...cpa, ...OSAGO_AGENTS, OSAGO_PLAIN_AGENTS, ...RED_AGENTS], k, (x) => x.revenue));
  row("Revenue", "OSAGO", () => 999, 999);
  row("", "SPLIT BY CHANNEL:", null);
  section("PARTNERS", { list: cpa.filter((p) => !wayback.includes(p)), bud: { OSAGO: [40, 34], "Mortgage insurance": [2, 1.7], "Travel insurance": [0.12, 0.1] } }, "PARTNER COSTS");
  section("WAYBACK", { list: wayback, bud: { OSAGO: [1, 0.6] } }, "WAYBACK COMMISSION");
  section("AGETNS", { list: [OSAGO_PLAIN_AGENTS, ...OSAGO_AGENTS, ...RED_AGENTS], bud: { OSAGO: [18, 16.5], "Mortgage insurance": [3, 2.6], "Travel insurance": [0.2, 0.15] } }, "PAYMENTS TO AGENTS");
  return grid;
}

/** Листы партнёрского канала с префиксом таблицы-связки */
export function partnersImitation(months: string[]): Record<string, Grid> {
  return {
    "B2B. CPA & WAYBACK OSAGO LRF": osagoCpa(months),
    "B2B. AGENTS OSAGO LRF": osagoAgents(months),
    "B2B. CPA & WAYBACK RED LRF": red(months, RED_CPA, false),
    "B2B. AGENTS RED LRF": red(months, RED_AGENTS, true),
    "B2B. PnL_b2b": pnl(months),
  };
}
