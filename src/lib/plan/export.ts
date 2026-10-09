// Выгрузка прогноза месяца в Excel (этап 35): сводка по продуктам, драйверы, все корректировки, факт по дням и загрузки
// LBE. Числа числами, единицы в заголовках, время московское

import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { derive } from "./model";
import { UNITS, metricLabel, productOf, type MetricKey, type PlanUnit } from "./spec";
import { planLabel, summarize } from "./summary";
import { FACT_METRICS, pace } from "./facts";
import type { MonthPlanView } from "./types";

const MSK = 3 * 60 * 60 * 1000;
const msk = (d: Date | string) => new Date(new Date(d).getTime() + MSK);
const REASONS: Record<string, string> = { TRAFFIC: "Трафик", CONVERSION: "Конверсия", CHECK_KV: "Средний чек или КВ", PARTNER_SK: "Партнёр или СК", BUDGET_BASE: "Бюджетная база", OTHER: "Другое" };

type Col = { header: string; width: number; fmt?: string };

function sheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: unknown[][]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}

/** Значение для ячейки: доли как доли (формат процента), остальное как есть */
const cell = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : v);
const fmtOf = (unit: PlanUnit) => (unit === "pct" ? "0.00%" : unit === "count" ? "#,##0" : unit === "rub" ? "#,##0.00" : "#,##0.0");
const unitName = (unit: PlanUnit) => (unit === "pct" ? "%" : unit === "count" ? "шт." : unit === "rub" ? "руб." : "млн руб.");

export async function buildPlanExport(view: MonthPlanView): Promise<{ buffer: Buffer; file: string; rows: number }> {
  const month = view.month;
  const [adjustments, facts, pulls] = await Promise.all([
    prisma.planAdjustment.findMany({ where: { month }, include: { author: { select: { fullName: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.planFact.findMany({ where: { month }, orderBy: [{ product: "asc" }, { metric: "asc" }, { day: "asc" }] }),
    prisma.planPull.findMany({ where: { month }, orderBy: { at: "asc" }, select: { at: true, byName: true } }),
  ]);
  const summary = summarize({ products: view.products.map((p) => ({ code: p.code, lbe: p.lbe, budget: p.budget, drivers: p.drivers })), groups: view.groups });
  const wb = new ExcelJS.Workbook();
  wb.creator = "Weekly";
  wb.created = new Date();

  // Сводка: продукты и группы, три результата, бюджет, LBE, прогноз и отклонения
  const top: unknown[][] = [];
  const addTop = (label: string, kind: string, t: { revenue: { budget: number | null; lbe: number | null; forecast: number | null }; promoMargin: typeof t.revenue; directMargin: typeof t.revenue }, adjusted: number | null) => {
    for (const [name, x] of [
      ["Выручка, млн руб.", t.revenue],
      ["Промо-маржа, млн руб.", t.promoMargin],
      ["Прямая маржа, млн руб.", t.directMargin],
    ] as const) {
      top.push([label, kind, name, cell(x.budget), cell(x.lbe), cell(x.forecast), x.forecast !== null && x.lbe !== null ? x.forecast - x.lbe : null, x.forecast !== null && x.budget !== null ? x.forecast - x.budget : null, adjusted]);
    }
  };
  for (const t of summary.top) {
    if (t.kind === "product") addTop(t.label, "продукт", t, t.adjusted);
    else {
      addTop(t.label, "группа", t, t.adjusted);
      for (const code of t.parts) {
        const p = summary.products.find((x) => x.code === code)!;
        addTop(planLabel(code), `продукт группы ${t.label}`, p, p.adjusted);
      }
    }
  }
  addTop("Итого по продуктам", "итог", summary.total, null);
  sheet(
    wb,
    "Сводка",
    [
      { header: "Продукт", width: 26 },
      { header: "Уровень", width: 20 },
      { header: "Показатель", width: 24 },
      { header: "Бюджет", width: 14, fmt: "#,##0.0" },
      { header: "LBE", width: 14, fmt: "#,##0.0" },
      { header: "Прогноз", width: 14, fmt: "#,##0.0" },
      { header: "Прогноз минус LBE", width: 18, fmt: "#,##0.0" },
      { header: "Прогноз минус бюджет", width: 20, fmt: "#,##0.0" },
      { header: "Корректировок", width: 14 },
    ],
    top,
  );

  // Драйверы и результат по продуктам: каждый показатель в своих единицах
  const ws = sheet(
    wb,
    "Драйверы",
    [
      { header: "Продукт", width: 24 },
      { header: "Показатель", width: 30 },
      { header: "Вид", width: 12 },
      { header: "Единицы", width: 10 },
      { header: "Бюджет", width: 14 },
      { header: "LBE", width: 14 },
      { header: "Прогноз", width: 14 },
      { header: "Скорректирован", width: 14 },
      { header: "Последняя корректировка: причина", width: 24 },
      { header: "Обоснование", width: 48 },
      { header: "Кто", width: 24 },
    ],
    [],
  );
  for (const p of summary.products) {
    const data = view.products.find((x) => x.code === p.code)!;
    for (const r of p.rows) {
      const unit = UNITS[r.key];
      const last = data.last[r.key];
      const row = ws.addRow([productOf(p.code)!.label, metricLabel(p.spec, r.key), r.kind === "driver" ? "драйвер" : "результат", unitName(unit), cell(r.budget), cell(r.lbe), cell(r.forecast), r.adjusted ? "да" : "", last?.reasonLabel ?? "", last?.comment ?? "", last?.author.name ?? ""]);
      for (const c of [5, 6, 7]) row.getCell(c).numFmt = fmtOf(unit);
    }
  }

  // Все корректировки месяца по порядку
  const adjRows = adjustments.map((a) => {
    const spec = productOf(a.product);
    const metric = a.metric as MetricKey;
    const unit = UNITS[metric] ?? "count";
    const lbe = view.products.find((p) => p.code === a.product);
    return { unit, row: [msk(a.createdAt), spec?.label ?? a.product, spec ? metricLabel(spec, metric) : a.metric, unitName(unit), cell(lbe ? (derive(lbe.lbe)[metric] ?? null) : null), cell(a.previous), a.value === null ? "как в LBE" : a.value, REASONS[a.reason] ?? a.reason, a.comment, a.author.fullName] };
  });
  const wsAdj = sheet(
    wb,
    "Корректировки",
    [
      { header: "Когда", width: 18, fmt: "dd.mm.yyyy hh:mm" },
      { header: "Продукт", width: 24 },
      { header: "Показатель", width: 30 },
      { header: "Единицы", width: 10 },
      { header: "LBE", width: 14 },
      { header: "Было", width: 14 },
      { header: "Стало", width: 14 },
      { header: "Причина", width: 22 },
      { header: "Обоснование", width: 48 },
      { header: "Кто", width: 24 },
    ],
    [],
  );
  // Каждое значение в своих единицах: конверсия процентом, полисы целыми
  for (const { unit, row } of adjRows) {
    const r = wsAdj.addRow(row);
    for (const c of [5, 6, 7]) r.getCell(c).numFmt = fmtOf(unit);
  }

  // Факт по дням и темп к прогнозу
  const wsFacts = sheet(
    wb,
    "Факт по дням",
    [
      { header: "Дата", width: 12, fmt: "dd.mm.yyyy" },
      { header: "Продукт", width: 24 },
      { header: "Показатель", width: 22 },
      { header: "Значение", width: 16 },
      { header: "Загрузил", width: 24 },
    ],
    [],
  );
  for (const f of facts) {
    const r = wsFacts.addRow([f.day, planLabel(f.product), FACT_METRICS.find((m) => m.key === f.metric)?.label ?? f.metric, f.value, f.loadedBy]);
    r.getCell(4).numFmt = f.metric === "units" ? "#,##0" : "#,##0.000";
  }
  const paceRows: unknown[][] = [];
  for (const p of summary.products) {
    for (const m of FACT_METRICS) {
      const daily = facts.filter((f) => f.product === p.code && f.metric === m.key).map((f) => ({ day: f.day.toISOString().slice(0, 10), value: f.value }));
      const forecast = m.key === "units" ? p.units.forecast : m.key === "revenue" ? p.revenue.forecast : p.promoMargin.forecast;
      const x = pace(daily, month, forecast);
      if (!x) continue;
      paceRows.push([productOf(p.code)!.label, m.label, x.elapsed, x.withData, cell(x.toDate), cell(forecast), cell(x.planToDate), cell(x.execution), cell(x.runRate), cell(x.gap)]);
    }
  }
  if (paceRows.length) {
    const wsPace = sheet(
      wb,
      "Темп к прогнозу",
      [
        { header: "Продукт", width: 24 },
        { header: "Показатель", width: 22 },
        { header: "Прошло дней", width: 12 },
        { header: "Дней с фактом", width: 14 },
        { header: "Факт с начала месяца", width: 20, fmt: "#,##0.0" },
        { header: "Прогноз месяца", width: 16, fmt: "#,##0.0" },
        { header: "Прогноз на дату", width: 16, fmt: "#,##0.0" },
        { header: "Выполнение на дату", width: 18, fmt: "0.0%" },
        { header: "Месяц при этом темпе", width: 20, fmt: "#,##0.0" },
        { header: "Темп минус прогноз", width: 18, fmt: "#,##0.0" },
      ],
      paceRows,
    );
    wsPace.getCell("A1").note = "Темп считается равномерно по дням месяца";
  }

  sheet(
    wb,
    "Загрузки LBE",
    [
      { header: "Когда", width: 18, fmt: "dd.mm.yyyy hh:mm" },
      { header: "Кто загрузил", width: 24 },
    ],
    pulls.map((p) => [msk(p.at), p.byName]),
  );

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const file = `prognoz-${month}.xlsx`;
  return { buffer, file, rows: top.length + adjRows.length + facts.length };
}
