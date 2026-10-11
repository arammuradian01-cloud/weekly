// Имитация листов LRF для тестов и показа без ключа (этап 32). Названия строк и порядок как в настоящем LRF, цифры
// выдуманы, но согласованы: трафик × конверсия даёт продажи B2C, продажи × выручка на продажу дают выручку от продаж

import { lrfMonth } from "./spec";
import type { Grid } from "./lrf";

type Row = [label: string, lbe?: number | null, bud?: number | null];

/** Лист в формате LRF: строка версий, строка месяцев, строки показателей. labelCol: колонка названий */
function sheet(rows: Row[], months: string[], labelCol = 1): Grid {
  const first = labelCol + 2;
  const width = first + months.length * 2;
  const versions: (string | null)[] = Array(width).fill(null);
  const names: (string | null)[] = Array(width).fill(null);
  months.forEach((m, i) => {
    versions[first + i * 2] = "LBE";
    versions[first + i * 2 + 1] = "BUD";
    names[first + i * 2] = lrfMonth(m);
    names[first + i * 2 + 1] = lrfMonth(m);
  });
  const grid: Grid = [Array(width).fill(null), versions, names, []];
  for (const [label, lbe, bud] of rows) {
    const row: (string | number | null)[] = Array(width).fill(null);
    row[labelCol] = label;
    // Доли и выручка на продажу в следующих месяцах те же, объёмы чуть выше: видно, что берётся колонка нужного месяца
    const flat = /CR|%|per /i.test(label);
    months.forEach((_, i) => {
      const k = flat ? 1 : 1 + i * 0.1;
      row[first + i * 2] = lbe == null ? null : lbe * k;
      row[first + i * 2 + 1] = bud == null ? null : bud * k;
    });
    grid.push(row);
  }
  return grid;
}

// ОСАГО: продажи 375 000 = 225 000 B2C (1,5 млн × 10% + 0,3 млн × 25%) + 150 000 B2B, выручка на полис 1 100 руб.,
// выручка от продаж с апсейлами 420 млн, прочая выручка 30 млн. Повтор «CR: WEB» в блоке «Not sale» как в настоящем листе
const OSAGO: Row[] = [
  ["OSAGO"],
  ["MARKET"],
  ["Market volume OSAGO", 4_200_000, 4_000_000],
  ["TOTAL OSAGO TRAFFIC (MAU)"],
  ["TOTAL OSAGO Web (MAU)", 1_500_000, 1_250_000],
  ["SEA", 600_000, 390_000],
  ["SEO", 300_000, 360_000],
  ["TOTAL OSAGO App (MAU)", 300_000, 300_000],
  ["POLICIES"],
  ["CR: end-to-end / B2C (%)", 0.125, 0.18],
  ["CR: WEB (%):", 0.1, 0.16],
  ["CR: APP (%):", 0.25, 0.34],
  ["where of:"],
  ["CR: end-to-end / Not sale (%)", 0.018, 0.026],
  ["CR: WEB (%):", 0.016, 0.023],
  ["CR: APP (%):", 0.028, 0.035],
  ["POLICIES (units)", 375_000, 504_000],
  ["B2C", 225_000, 302_000],
  ["Web", 150_000, 200_000],
  ["App", 75_000, 102_000],
  ["B2B", 150_000, 202_000],
  ["Partners", 120_000, 160_000],
  ["REVENUE PER POLICY (RUB) (w/o Pool | Cross)", 1_100, 800],
  ["Average market price per policy (RUB)", 8_000, 6_200],
  ["Sravni comission (%)", 0.125, 0.125],
  ["REVENUE: b2c + b2b (RUB MLN)", 420, 410],
  ["OSAGO (w/o upsale)", 350, 360],
  ["Pool UpSale", 50, 40],
  ["TOTAL REVENUE", 450, 440],
  ["b2c", 240, 230],
  ["b2b", 180, 180],
  ["Retro-bonus", 30, 30],
  ["PROMO MARGIN", 170, 110],
  ["Promo margin (% o Revenue)", 0.38, 0.25],
  ["DIRECT MARGIN", 150, 80],
  ["technical rows:"],
  ["CHECK REVENUE", 1, 1],
];

/** Продукт RED: [название, код в строках трафика, масштаб, выручка на полис, есть ли строка-заголовок над разделом] */
const RED_PRODUCTS: [name: string, code: string, k: number, rpu: number, title: boolean][] = [
  ["MORTGAGE INSURANCE", "MI", 1, 2_200, false],
  ["TRAVEL INSURANCE", "TI", 0.5, 930, true],
  ["ACCIDENT INSURANCE", "AI", 0.3, 490, true],
  ["PROPERTY INSURANCE", "PI", 0.2, 1_540, true],
  ["TICK BITE INSURANCE", "TBI", 0.01, 150, true],
];

type RedFigures = { web: number; app: number; b2c: number; b2b: number; units: number; core: number; revenue: number; pm: number };

function redFigures(k: number, rpu: number, version: "LBE" | "BUD"): RedFigures {
  const [web, app, crWeb, crApp, b2b, check, other, pm] =
    version === "LBE" ? [140_000 * k, 30_000 * k, 0.14, 0.3, 6_000 * k, rpu, 2 * k, 40 * k] : [95_000 * k, 26_000 * k, 0.15, 0.19, 5_000 * k, rpu * 0.85, 2 * k, 20 * k];
  const b2c = web * crWeb + app * crApp;
  const units = b2c + b2b;
  const core = (units * check) / 1e6;
  return { web, app, b2c, b2b, units, core, revenue: core + other, pm };
}

function redProduct([name, code, k, rpu, title]: (typeof RED_PRODUCTS)[number]): Row[] {
  const L = redFigures(k, rpu, "LBE");
  const B = redFigures(k, rpu, "BUD");
  return [
    ...(title ? ([[name]] as Row[]) : []),
    [`TOTAL ${name} TRAFFIC (MAU)`, L.web + L.app, B.web + B.app],
    [`TOTAL ${code} Web (MAU)`, L.web, B.web],
    ["SEA", L.web * 0.45, B.web * 0.45],
    [`TOTAL ${code} App (MAU)`, L.app, B.app],
    ["POLICIES"],
    ["CR: end-to-end / B2C (%)", L.b2c / (L.web + L.app), B.b2c / (B.web + B.app)],
    ["CR: WEB (%):", 0.14, 0.15],
    ["CR: APP (%):", 0.3, 0.19],
    ["POLICIES (units)", L.units, B.units],
    ["B2C", L.b2c, B.b2c],
    ["Web", L.web * 0.14, B.web * 0.15],
    ["App", L.app * 0.3, B.app * 0.19],
    ["B2B", L.b2b, B.b2b],
    ["Revenue per policy (RUB)", rpu, rpu * 0.85],
    ["REVENUE (RUB MLN)", L.core, B.core],
    ["TOTAL REVENUE", L.revenue, B.revenue],
    ["b2c", L.core * 0.8, B.core * 0.8],
    ["PROMO MARGIN", L.pm, B.pm],
  ];
}

/** Лист RED: итог группы с разбивкой по продуктам строчными названиями («Travel insurance»), потом разделы продуктов */
function red(): Row[] {
  const figures = RED_PRODUCTS.map(([name, , k, rpu]) => ({ name: name.charAt(0) + name.slice(1).toLowerCase(), L: redFigures(k, rpu, "LBE"), B: redFigures(k, rpu, "BUD") }));
  const total = (pick: (f: RedFigures) => number, extra: [number, number] = [0, 0]): Row => [
    "",
    figures.reduce((s, f) => s + pick(f.L), 0) + extra[0],
    figures.reduce((s, f) => s + pick(f.B), 0) + extra[1],
  ];
  const split = (pick: (f: RedFigures) => number): Row[] => figures.map((f) => [f.name, pick(f.L), pick(f.B)]);
  const named = (label: string, row: Row): Row => [label, row[1], row[2]];
  return [
    ["TOTAL RED"],
    ["TOTAL TRAFFIC (MAU)"],
    named("TOTAL Web (MAU)", total((f) => f.web)),
    ...split((f) => f.web),
    ["POLICIES"],
    named("POLICIES (units)", total((f) => f.units)),
    ...split((f) => f.units),
    ["B2C", total((f) => f.b2c)[1], total((f) => f.b2c)[2]],
    ["B2B", total((f) => f.b2b)[1], total((f) => f.b2b)[2]],
    named("TOTAL REVENUE", total((f) => f.revenue, [5, 2])),
    ...split((f) => f.revenue),
    ["Booking", 0.1, 0.1],
    named("PROMO MARGIN", total((f) => f.pm, [3, 1])),
    ...split((f) => f.pm),
    ["DIRECT MARGIN", 60, 20],
    ...RED_PRODUCTS.flatMap(redProduct),
    ["technical rows:"],
    ["CHECK REVENUE", 1, 1],
  ];
}

const CASCO: Row[] = [
  ["TOTAL REVENUE CASCO", 14.4, 13.5],
  ["Leadgen", 10.76, 9.48],
  ["TOTAL: B2C + B2B"],
  ["TOTAL traffic (MAU)", 85_000, 86_500],
  ["CR: Traffic -> Lead (%)", 0.185, 0.178],
  ["Leads (units)", 66_000 * 0.19 + 19_000 * 0.16 + 250, 63_000 * 0.18 + 23_000 * 0.17 + 50],
  ["b2c", 66_000 * 0.19 + 19_000 * 0.16, 63_000 * 0.18 + 23_000 * 0.17],
  ["WEB", 66_000 * 0.19, 63_000 * 0.18],
  ["b2b", 250, 50],
  ["Sales (units)", 479, 500],
  ["WEB"],
  ["Web traffic (MAU)", 66_000, 63_000],
  ["SEA", 23_000, 15_800],
  ["CR: Traffic -> Lead (%)", 0.19, 0.18],
  ["Leads (units)", 66_000 * 0.19, 63_000 * 0.18],
  ["APP"],
  ["App traffic (MAU)", 19_000, 23_000],
  ["CR: Traffic -> Lead (%)", 0.16, 0.17],
  ["Leads (units)", 19_000 * 0.16, 23_000 * 0.17],
  ["TOTAL REVENUE (RUB MLN)", 14.4, 13.5],
  ["REVENUE", (66_000 * 0.19 + 19_000 * 0.16 + 250) * 680e-6, (63_000 * 0.18 + 23_000 * 0.17 + 50) * 550e-6],
  ["revenue per lead (rub)", 680, 550],
  ["PROMO MARGIN (RUB MLN)", 8.2, 8.6],
  ["Margin (% of revenue)", 0.57, 0.64],
];

const DEPOSITS: Row[] = [
  ["DEPOSITS"],
  ["Кол-во банков", 11, 13],
  ["TOTAL DEPOSITS Web (MAU)", 256_000, 803_000],
  ["FULL-DEAL"],
  ["DEALS (units)", 82, 3_765],
  ["REVENUE PER DEPOSIT (RUB)", 550, 750],
  ["REVENUE (RUB MLN)", 0.045, 2.8],
  ["LEADGEN"],
  ["CLICKS (units)", 56_000, 123_000],
  ["REVENUE PER CLICK (RUB)", 134, 110],
  ["REVENUE (RUB MLN)", 56_000 * 134e-6, 123_000 * 110e-6],
  ["TOTAL REVENUE (RUB MLN)", 17.3, 26.3],
  ["PROMO MARGIN (RUB MLN)", 13.6, 17.3],
  ["DIRECT MARGIN (RUB MLN)", 6, 7.8],
  ["technical rows:"],
];

/** Листы LRF с колонками LBE и BUD для каждого из месяцев */
export function lrfImitation(months: string[]): Record<string, Grid> {
  return {
    "OSAGO_KEY METRICS": sheet(OSAGO, months),
    "RED_KEY METRICS": sheet(red(), months),
    "CASCO LRF": sheet(CASCO, months, 7),
    "DEPOSITS_KEY METRICS": sheet(DEPOSITS, months),
  };
}
