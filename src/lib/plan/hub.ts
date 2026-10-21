// Хаб данных «Единая воронка: данные» (этап 58): чистые функции без базы.
//
// Хаб это Google-таблица Арама с вкладками-зеркалами боевых листов (префикс «src.») и витринами. Ресурс читает из него
// два листа: «src.Все СК data_runrate» (продажи ОСАГО по СК за месяц нарастающим итогом, обновляется день в день) и
// «План ОСАГО по СК» (модель «ОСАГО СК × каналы × регионы»: план 2027, факт и ранрейт 2026 по СК). Хаб и боевые файлы
// ресурс не меняет.
//
// Дневной факт по СК получается из снимков: снимок каждый день, факт за день = разница с предыдущим снимком того же
// месяца. Ранрейт месяца считается линейно по дням и по профилю дней недели, когда дневных снимков накопилось достаточно

import { cellNumber, type Cell, type Grid } from "./lrf";

export const HUB_SHEETS = {
  vseSk: "src.Все СК data_runrate",
  skPlan: "План ОСАГО по СК",
} as const;

/** Показатели модели по СК, которые ресурс хранит: полисы всего, без пула, пул, премия, выручка, КВ */
export const SK_METRICS = ["pol", "np", "pool", "prem_tot", "rev", "kv_tot"] as const;
export type SkMetric = (typeof SK_METRICS)[number];
export const SK_METRIC_LABELS: Record<SkMetric, string> = {
  pol: "Полисы, шт",
  np: "Полисы без пула, шт",
  pool: "Полисы пула, шт",
  prem_tot: "Премия, млн",
  rev: "Выручка, млн",
  kv_tot: "КВ, %",
};
/** Показатели, которые видят только управление и команды продуктов и каналов (решение Арама 21.10): комиссии и выручка по СК */
export const SK_SENSITIVE: SkMetric[] = ["rev", "kv_tot"];

export const SK_TOTAL = "ИТОГО";
export const HUB_LIMITS = { vseSkRows: 5000, skPlanRows: 6000, cols: 60, minProfileDays: 14 };

const text = (c: Cell) => (c === null || c === undefined ? "" : String(c).replace(/ /g, " ").replace(/\s+/g, " ").trim());
const norm = (c: Cell) => text(c).toLowerCase();

/** Месяц из ячейки: дата числом дней от 30.12.1899, строка «2026-10-01», «2026-10» или «01.10.2026» */
export function monthOf(c: Cell): string | null {
  if (typeof c === "number" && c > 30_000 && c < 80_000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86_400_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const t = text(c);
  let m = /^(\d{4})-(\d{2})(?:-\d{2})?(?:[ T].*)?$/.exec(t);
  if (m) return `${m[1]}-${m[2]}`;
  m = /^\d{2}\.(\d{2})\.(\d{4})$/.exec(t);
  if (m) return `${m[2]}-${m[1]}`;
  return null;
}

const bool = (c: Cell) => {
  if (typeof c === "boolean") return c;
  const t = norm(c);
  return t === "true" || t === "1" || t === "да";
};

export type SkMonthRow = { month: string; sk: string; pool: boolean; upsale: boolean; policies: number; premium: number | null; revenue: number | null };

/**
 * Лист «src.Все СК data_runrate»: колонки MONTH, PARTNER_NAME, POOL, WITH_UPSALE, POLICIES_CNT, POLICIES_INCOME,
 * POLICIES_REVENUE_WO_VAT и дальше. Колонки ищутся по заголовкам, поэтому вставка колонок в источнике разбор не ломает.
 * Правый блок того же листа (недельный срез с WEEK) не читается
 */
export function readVseSk(grid: Grid | undefined): { rows: SkMonthRow[]; problem: string | null } {
  if (!grid || grid.length === 0) return { rows: [], problem: `Лист «${HUB_SHEETS.vseSk}» не найден в хабе` };
  const head = grid[0] ?? [];
  const col = (name: string) => head.findIndex((c) => norm(c) === name.toLowerCase());
  const cMonth = col("MONTH");
  const cSk = col("PARTNER_NAME");
  const cPool = col("POOL");
  const cUps = col("WITH_UPSALE");
  const cPol = col("POLICIES_CNT");
  const cPrem = col("POLICIES_INCOME");
  const cRev = col("POLICIES_REVENUE_WO_VAT");
  if (cMonth < 0 || cSk < 0 || cPol < 0) return { rows: [], problem: `Лист «${HUB_SHEETS.vseSk}»: нет колонок MONTH, PARTNER_NAME, POLICIES_CNT` };
  const rows: SkMonthRow[] = [];
  for (const row of grid.slice(1)) {
    const month = monthOf(row[cMonth]);
    const sk = text(row[cSk]);
    const policies = cellNumber(row[cPol]);
    if (!month || !sk || policies === null) continue;
    rows.push({
      month,
      sk,
      pool: cPool >= 0 ? bool(row[cPool]) : false,
      upsale: cUps >= 0 ? bool(row[cUps]) : false,
      policies,
      premium: cPrem >= 0 ? cellNumber(row[cPrem]) : null,
      revenue: cRev >= 0 ? cellNumber(row[cRev]) : null,
    });
  }
  return { rows, problem: rows.length ? null : `Лист «${HUB_SHEETS.vseSk}» пустой` };
}

export type SkPlanRow = { period: string; sk: string; metric: SkMetric; value: number | null };

/**
 * Лист «План ОСАГО по СК» хаба: широкая таблица СК, Раздел, Канал, Регион, Код, Показатель и колонки периодов
 * (2026-01 … FY2027). Берутся только строки раздела «Воронка» по всем каналам и регионам и показатели SK_METRICS.
 * Шапка ищется по колонке «Код» в первых пяти строках: перед таблицей может стоять строка примечания
 */
export function readSkPlan(grid: Grid | undefined): { rows: SkPlanRow[]; problem: string | null } {
  if (!grid || grid.length === 0) return { rows: [], problem: `Лист «${HUB_SHEETS.skPlan}» не найден в хабе` };
  const headIndex = grid.slice(0, 5).findIndex((row) => row.some((c) => norm(c) === "код") && row.some((c) => norm(c) === "ск"));
  if (headIndex < 0) return { rows: [], problem: `Лист «${HUB_SHEETS.skPlan}»: не найдена шапка с колонками «СК» и «Код»` };
  const head = grid[headIndex]!;
  const col = (name: string) => head.findIndex((c) => norm(c) === name);
  const cSk = col("ск");
  const cSection = col("раздел");
  const cChannel = col("канал");
  const cRegion = col("регион");
  const cCode = col("код");
  const periods = head.map((c, j) => ({ j, period: text(c) })).filter((x) => /^(\d{4}-\d{2}|FY\d{4})$/.test(x.period));
  if (!periods.length) return { rows: [], problem: `Лист «${HUB_SHEETS.skPlan}»: нет колонок периодов` };
  const rows: SkPlanRow[] = [];
  for (const row of grid.slice(headIndex + 1)) {
    const sk = text(row[cSk]);
    const code = text(row[cCode]) as SkMetric;
    if (!sk || !(SK_METRICS as readonly string[]).includes(code)) continue;
    if (cSection >= 0 && norm(row[cSection]) !== "воронка") continue;
    if (cChannel >= 0 && !/^все/.test(norm(row[cChannel]))) continue;
    if (cRegion >= 0 && !/^все/.test(norm(row[cRegion]))) continue;
    for (const { j, period } of periods) rows.push({ period, sk, metric: code, value: cellNumber(row[j]) });
  }
  return { rows, problem: rows.length ? null : `Лист «${HUB_SHEETS.skPlan}»: нет строк раздела «Воронка»` };
}

/** Дней в месяце «2026-10» */
export const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

export type SkDaily = { day: string; mtd: number; delta: number | null };

export type RunRate = {
  /** Последний снимок: факт с начала месяца и его день */
  mtd: number;
  day: string;
  elapsed: number;
  /** Линейно по дням */
  linear: number;
  /** По профилю дней недели: null, пока дневных снимков меньше HUB_LIMITS.minProfileDays */
  profile: number | null;
  /** Что показываем как прогноз: профиль, когда он есть, иначе линейно */
  forecast: number;
  /** Расхождение методов больше 10%: месяц нестабильный, показываются оба */
  unstable: boolean;
};

/**
 * Ранрейт месяца по снимкам нарастающего итога. Снимки идут по дням, пропуски дней допустимы: дневной факт известен
 * только там, где есть снимок и предыдущий снимок. Профиль дней недели строится по известным дневным фактам: средний факт
 * каждого дня недели, остаток месяца считается по календарю
 */
export function runRate(month: string, snapshots: { day: string; mtd: number }[]): RunRate | null {
  const days = daysIn(month);
  const sorted = [...snapshots].filter((s) => s.day.startsWith(month)).sort((a, b) => a.day.localeCompare(b.day));
  const last = sorted[sorted.length - 1];
  if (!last) return null;
  const elapsed = Number(last.day.slice(8, 10));
  const linear = elapsed > 0 ? (last.mtd / elapsed) * days : last.mtd;
  // Дневные факты: разница соседних по календарю снимков; первый снимок месяца даёт факт за все дни до него
  const daily: SkDaily[] = sorted.map((s, i) => {
    const prev = sorted[i - 1];
    const prevDay = prev ? Number(prev.day.slice(8, 10)) : 0;
    const d = Number(s.day.slice(8, 10));
    return { day: s.day, mtd: s.mtd, delta: prev && d - prevDay === 1 ? s.mtd - prev.mtd : null };
  });
  const known = daily.filter((d): d is SkDaily & { delta: number } => d.delta !== null);
  let profile: number | null = null;
  if (known.length >= HUB_LIMITS.minProfileDays) {
    const byWeekday = new Map<number, number[]>();
    for (const d of known) {
      const wd = new Date(`${d.day}T00:00:00Z`).getUTCDay();
      byWeekday.set(wd, [...(byWeekday.get(wd) ?? []), d.delta]);
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const overall = avg(known.map((d) => d.delta));
    let rest = 0;
    for (let d = elapsed + 1; d <= days; d++) {
      const wd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, d)).getUTCDay();
      const xs = byWeekday.get(wd);
      rest += xs && xs.length ? avg(xs) : overall;
    }
    profile = last.mtd + rest;
  }
  const forecast = profile ?? linear;
  const unstable = profile !== null && Math.abs(profile - linear) > 0.1 * Math.max(Math.abs(linear), 1e-9);
  return { mtd: last.mtd, day: last.day, elapsed, linear, profile, forecast, unstable };
}

/** ID таблицы хаба из ссылки или как есть */
export function parseHubSource(input: string): string | null {
  const raw = String(input ?? "").trim();
  const id = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(raw)?.[1] ?? raw;
  return /^[a-zA-Z0-9_-]{25,100}$/.test(id) ? id : null;
}
