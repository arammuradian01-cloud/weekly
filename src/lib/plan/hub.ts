// Хаб данных «Единая воронка: данные» (этап 58): чистые функции без базы.
//
// Хаб это Google-таблица Арама с вкладками-зеркалами боевых листов (префикс «src.») и витринами. Ресурс читает из него
// два листа: «src.Все СК data_runrate» (продажи ОСАГО по СК за месяц нарастающим итогом, обновляется день в день) и
// «План ОСАГО по СК» (модель «ОСАГО СК × каналы × регионы»: план 2027, факт и ранрейт 2026 по СК). Хаб и боевые файлы
// ресурс не меняет.
//
// Дневной факт по СК получается из снимков: снимок каждый день, факт за день = разница с предыдущим снимком того же
// месяца. Ранрейт месяца считается линейно по дням и по профилю дней недели, когда дневных снимков накопилось достаточно.
// Правила владельца (какой день прошёл, из чего выручка-факт) собраны ниже в одном месте

import { addMonths } from "@/lib/forecast/codes";
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

// ---------- Правила владельца (решения Арама 22.10): менять здесь ----------

/**
 * Факт в «Все СК» по вчерашний день: последний день с фактом = день загрузки по Москве минус FACT_LAG_DAYS. Снимок 1-го
 * числа поэтому закрывает прошлый месяц, а текущий месяц до 2-го числа без факта
 */
export const FACT_LAG_DAYS = 1;

/**
 * Выручка-факт ОСАГО по СК с апсейлом, как в плане: сумма этих колонок «Все СК». Колонки нет в листе: выручка без неё и
 * предупреждение в проверке хаба
 */
export const REVENUE_FACT_COLUMNS: readonly { name: string; label: string }[] = [
  { name: "POLICIES_REVENUE_WO_VAT", label: "полисов" },
  { name: "UPSALE_REVENUE_WO_VAT", label: "апсейла" },
];

const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Последний день с фактом в снимке, сделанном в день loadDay («YYYY-MM-DD» по Москве) */
export const factDay = (loadDay: string) => shiftDay(loadDay, -FACT_LAG_DAYS);

/**
 * День месяца month, к которому относится снимок дня loadDay: день факта, если он в этом месяце; последний день месяца,
 * если факт снимка уже после месяца (закрытие и поздние поправки); null, если факт снимка ещё до месяца
 */
export function snapshotDayIn(loadDay: string, month: string): string | null {
  const d = factDay(loadDay);
  const m = d.slice(0, 7);
  if (m === month) return d;
  if (m > month) return `${month}-${String(daysIn(month)).padStart(2, "0")}`;
  return null;
}

/**
 * Месяцы, которые хранит снимок дня: текущий по Москве и прошлый для закрытия, но только те, к которым снимок относится
 * по правилу дня факта. 1-го числа это один прошлый месяц: снимок его закрывает, текущему месяцу он ничего не даёт
 */
export const snapshotMonths = (loadDay: string): string[] => [loadDay.slice(0, 7), addMonths(loadDay.slice(0, 7), -1)].filter((m) => snapshotDayIn(loadDay, m) !== null);

// ---------- Ячейки и названия ----------

const text = (c: Cell) => (c === null || c === undefined ? "" : String(c).replace(/ /g, " ").replace(/\s+/g, " ").trim());
const norm = (c: Cell) => text(c).toLowerCase();

/** Ключ названия СК: без учёта регистра и лишних пробелов. Так сводятся названия из двух листов и повторы */
export const skKey = (name: Cell) => norm(name);

/** Строка итога, а не СК: «Итого», «ИТОГО», «Всего» */
export const isTotal = (name: Cell) => /^(итого|всего):?$/.test(norm(name));

const ERROR_RE = /^(#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|ERROR!|SPILL!|CALC!|GETTING_DATA)|Loading\.\.\.|Загрузка\.\.\.)/i;

/** Ошибка формулы в ячейке (#REF!, #N/A, #VALUE! и т.п.): её текст, иначе null */
export const cellError = (c: Cell): string | null => (typeof c === "string" && ERROR_RE.test(c.trim()) ? c.trim() : null);

/** Список названий для сообщения: первые limit и «ещё N» */
export function nameList(names: string[], limit = 8): string {
  const u = [...new Set(names)];
  return u.length > limit ? `${u.slice(0, limit).join(", ")} и ещё ${u.length - limit}` : u.join(", ");
}

/** Находки по СК для сообщения: какие СК и первый пример */
function bySk(sheet: string, what: string, found: Map<string, string>, tail = ""): string | null {
  if (!found.size) return null;
  const [first, example] = [...found.entries()][0]!;
  return `${sheet}: ${what} у СК ${nameList([...found.keys()], 5)} (например, ${first}: ${example})${tail ? `. ${tail}` : ""}`;
}

/** Месяц из ячейки: дата числом дней от 30.12.1899 (время дня отбрасывается), строка «2026-10-01», «2026-10» или «01.10.2026» */
export function monthOf(c: Cell): string | null {
  if (typeof c === "number" && c > 30_000 && c < 80_000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(c) * 86_400_000);
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

const addNull = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

export type SkMonthRow = { month: string; sk: string; pool: boolean; upsale: boolean; policies: number; premium: number | null; revenue: number | null };

export type VseSkRead = {
  rows: SkMonthRow[];
  /** Все месяцы листа, которые удалось прочитать */
  months: string[];
  /** Блокируют снимок */
  problems: string[];
  /** Не блокируют: снимок загрузится, но человеку стоит знать */
  warnings: string[];
};

/**
 * Лист «src.Все СК data_runrate»: колонки MONTH, PARTNER_NAME, POOL, WITH_UPSALE, POLICIES_CNT, POLICIES_INCOME,
 * выручка (REVENUE_FACT_COLUMNS) и дальше. Колонки ищутся по заголовкам, поэтому вставка колонок в источнике разбор не
 * ломает. Правый блок того же листа (недельный срез с WEEK) не читается.
 *
 * keep: месяцы, которые нужны снимку; строки других месяцев пропускаются без проверок. Строки с одинаковым ключом
 * (месяц, СК без учёта регистра и пробелов, пул, апсейл) складываются. Строка с СК, но без месяца или без числа полисов,
 * и ошибка формулы в нужной ячейке блокируют снимок: иначе факт по СК молча стал бы меньше
 */
export function readVseSk(grid: Grid | undefined, keep?: readonly string[]): VseSkRead {
  const sheet = `Лист «${HUB_SHEETS.vseSk}»`;
  if (!grid || grid.length === 0) return { rows: [], months: [], problems: [`${sheet} не найден в хабе`], warnings: [] };
  const head = grid[0] ?? [];
  const col = (name: string) => head.findIndex((c) => norm(c) === name.toLowerCase());
  const c = { month: col("MONTH"), sk: col("PARTNER_NAME"), pool: col("POOL"), ups: col("WITH_UPSALE"), pol: col("POLICIES_CNT"), prem: col("POLICIES_INCOME") };
  if (c.month < 0 || c.sk < 0 || c.pol < 0) return { rows: [], months: [], problems: [`${sheet}: нет колонок MONTH, PARTNER_NAME, POLICIES_CNT`], warnings: [] };
  const revenue = REVENUE_FACT_COLUMNS.map((r) => ({ ...r, j: col(r.name) }));
  const warnings: string[] = [];
  if (c.pool < 0) warnings.push(`${sheet}: нет колонки POOL, доля пула не посчитается`);
  if (c.ups < 0) warnings.push(`${sheet}: нет колонки WITH_UPSALE, строки с апсейлом и без сложатся`);
  for (const r of revenue) if (r.j < 0) warnings.push(`${sheet}: нет колонки ${r.name}, выручка-факт по СК без выручки ${r.label}`);
  const used: [string, number][] = (
    [
      ["MONTH", c.month],
      ["PARTNER_NAME", c.sk],
      ["POOL", c.pool],
      ["WITH_UPSALE", c.ups],
      ["POLICIES_CNT", c.pol],
      ["POLICIES_INCOME", c.prem],
      ...revenue.map((r) => [r.name, r.j] as [string, number]),
    ] as [string, number][]
  ).filter(([, j]) => j >= 0);

  const acc = new Map<string, SkMonthRow>();
  const months = new Set<string>();
  const errors = new Map<string, string>();
  const dropped = new Map<string, string>();
  grid.slice(1).forEach((row, i) => {
    const line = i + 2;
    const sk = text(row[c.sk]);
    if (!sk || isTotal(sk)) return;
    const month = monthOf(row[c.month]);
    if (month) months.add(month);
    if (month && keep && !keep.includes(month)) return;
    const bad = used.map(([name, j]) => [name, cellError(row[j])] as const).filter(([, e]) => e);
    if (bad.length) {
      if (!errors.has(sk)) errors.set(sk, `строка ${line}, ${bad.map(([name, e]) => `${name} ${e}`).join(", ")}`);
      return;
    }
    const policies = cellNumber(row[c.pol]);
    if (!month || policies === null) {
      const [name, j]: [string, number] = !month ? ["MONTH", c.month] : ["POLICIES_CNT", c.pol];
      if (!dropped.has(sk)) dropped.set(sk, `строка ${line}, ${name} «${text(row[j]) || "пусто"}»`);
      return;
    }
    const pool = c.pool >= 0 ? bool(row[c.pool]) : false;
    const upsale = c.ups >= 0 ? bool(row[c.ups]) : false;
    const premium = c.prem >= 0 ? cellNumber(row[c.prem]) : null;
    const rev = revenue.filter((r) => r.j >= 0).reduce<number | null>((s, r) => addNull(s, cellNumber(row[r.j])), null);
    const key = `${month}|${skKey(sk)}|${pool}|${upsale}`;
    const prev = acc.get(key);
    if (prev) {
      prev.policies += policies;
      prev.premium = addNull(prev.premium, premium);
      prev.revenue = addNull(prev.revenue, rev);
    } else acc.set(key, { month, sk, pool, upsale, policies, premium, revenue: rev });
  });
  const problems = [bySk(sheet, "ошибки в ячейках", errors), bySk(sheet, "не прочитаны строки", dropped, "Без них факт по СК был бы неполным")].filter((p): p is string => p !== null);
  const rows = [...acc.values()];
  if (!rows.length && !months.size && !problems.length) problems.push(`${sheet} пустой`);
  return { rows, months: [...months].sort(), problems, warnings };
}

export type SkPlanRow = { period: string; sk: string; metric: SkMetric; value: number | null };
export type SkPlanRead = { rows: SkPlanRow[]; periods: string[]; problems: string[] };

/** Период из шапки плана: «FY2027» как есть, месяц текстом или датой (Google отдаёт дату числом) через monthOf */
function periodOf(c: Cell): string | null {
  const t = text(c);
  if (/^FY\d{4}$/i.test(t)) return t.toUpperCase();
  return monthOf(c);
}

/**
 * Лист «План ОСАГО по СК» хаба: широкая таблица СК, Раздел, Канал, Регион, Код, Показатель и колонки периодов
 * (2026-01 … FY2027). Берутся только строки раздела «Воронка» по всем каналам и всем регионам и показатели SK_METRICS.
 * Шапка ищется по колонке «Код» в первых пяти строках: перед таблицей может стоять строка примечания. Объединённые ячейки
 * СК и Раздела (значение только в первой строке) протягиваются вниз.
 *
 * month: текущий месяц. Без его колонки или без единого числа полисов за него план не загружается: сломанный лист не
 * должен затереть план пустыми строками. Ошибка формулы в нужной ячейке и повтор строки СК тоже блокируют загрузку
 */
export function readSkPlan(grid: Grid | undefined, month?: string): SkPlanRead {
  const sheet = `Лист «${HUB_SHEETS.skPlan}»`;
  const none = (problem: string): SkPlanRead => ({ rows: [], periods: [], problems: [problem] });
  if (!grid || grid.length === 0) return none(`${sheet} не найден в хабе`);
  const headIndex = grid.slice(0, 5).findIndex((row) => row.some((c) => norm(c) === "код") && row.some((c) => norm(c) === "ск"));
  if (headIndex < 0) return none(`${sheet}: не найдена шапка с колонками «СК» и «Код»`);
  const head = grid[headIndex]!;
  const col = (name: string) => head.findIndex((c) => norm(c) === name);
  const cSk = col("ск");
  const cSection = col("раздел");
  const cChannel = col("канал");
  const cRegion = col("регион");
  const cCode = col("код");
  const periods = head.map((c, j) => ({ j, period: periodOf(c) })).filter((x): x is { j: number; period: string } => x.period !== null);
  if (!periods.length) return none(`${sheet}: нет колонок периодов`);
  const twice = periods.map((p) => p.period).filter((p, i, all) => all.indexOf(p) !== i);
  if (twice.length) return none(`${sheet}: колонка периода ${nameList(twice)} повторяется`);
  if (month && !periods.some((p) => p.period === month)) return none(`${sheet}: нет колонки текущего месяца ${month}`);

  const rows: SkPlanRow[] = [];
  const errors = new Map<string, string>();
  const repeats = new Map<string, string>();
  const seen = new Map<string, number>();
  const labels = [cSk, cSection, cChannel, cRegion, cCode].filter((j) => j >= 0);
  let lastSk = "";
  let lastSection = "";
  grid.slice(headIndex + 1).forEach((row, i) => {
    const line = headIndex + i + 2;
    const labelError = labels.map((j) => cellError(row[j])).find((e) => e !== null);
    if (labelError) {
      // Подпись строки сломана: не понять, чья это строка, поэтому это проблема, а не пропуск
      errors.set(text(row[cSk]) || lastSk || `строка ${line}`, `строка ${line}, подпись ${labelError}`);
      return;
    }
    const skCell = text(row[cSk]);
    if (skCell) lastSk = skCell;
    if (cSection >= 0 && text(row[cSection])) lastSection = text(row[cSection]);
    const code = text(row[cCode]);
    if (!lastSk || !(SK_METRICS as readonly string[]).includes(code)) return;
    if (cSection >= 0 && norm(lastSection) !== "воронка") return;
    if (cChannel >= 0 && norm(row[cChannel]) !== "все каналы") return;
    if (cRegion >= 0 && norm(row[cRegion]) !== "все регионы") return;
    const sk = isTotal(lastSk) ? SK_TOTAL : lastSk;
    const key = `${skKey(sk)}|${code}`;
    const before = seen.get(key);
    if (before !== undefined) {
      if (!repeats.has(sk)) repeats.set(sk, `${code}, строки ${before} и ${line}`);
      return;
    }
    seen.set(key, line);
    for (const { j, period } of periods) {
      const e = cellError(row[j]);
      if (e) {
        if (!errors.has(sk)) errors.set(sk, `${code} ${period} ${e}`);
        continue;
      }
      rows.push({ period, sk, metric: code as SkMetric, value: cellNumber(row[j]) });
    }
  });
  const problems = [bySk(sheet, "ошибки в ячейках", errors), bySk(sheet, "строка повторяется", repeats)].filter((p): p is string => p !== null);
  if (!rows.length && !problems.length) problems.push(`${sheet}: нет строк раздела «Воронка»`);
  if (month && seen.size && !rows.some((r) => r.period === month && r.metric === "pol" && r.value !== null)) problems.push(`${sheet}: у полисов за ${month} нет ни одного числа`);
  return { rows, periods: periods.map((p) => p.period), problems };
}

/** Дней в месяце «2026-10» */
export const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

export type SkDaily = { day: string; mtd: number; delta: number | null };

export type RunRate = {
  /** Последний день с фактом: факт с начала месяца и его день */
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
 * Ранрейт месяца по снимкам нарастающего итога. day у снимка это день факта (snapshotDayIn), а не день загрузки. Снимки
 * идут по дням, пропуски дней допустимы: дневной факт известен только там, где есть снимок и предыдущий снимок. Профиль
 * дней недели строится по известным дневным фактам: средний факт каждого дня недели, остаток месяца считается по календарю
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
