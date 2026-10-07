// Разбор недельного отчёта (этап 24, модуль М9): вкладка TOTAL файла Weekly Sravni. Строка узнаётся по ключу из пяти
// ячеек (статья, интерфейс, продукт, мапинг, комментарий), недели по шапке «Week» с датами «Date from» и «Date to».
// Вставка строк и столбцов разбор не ломает: ищем по подписям, а не по номерам

import type { Cell, Grid } from "@/lib/sheet/client";
import type { IsoDate } from "@/domain/dates";

export type ReportWeek = { number: number; from: IsoDate; to: IsoDate; col: number };

export type ReportRow = {
  key: string;
  article: string;
  iface: string;
  product: string;
  mapping: string;
  comment: string;
  /** Порядок в отчёте */
  ord: number;
  /** Значения по неделям отчёта: null, если ячейка пустая или не число */
  values: { week: IsoDate; value: number | null }[];
};

export type ParsedReport = { weeks: ReportWeek[]; rows: ReportRow[] };

export class ReportFormatError extends Error {}

const text = (c: Cell | undefined): string => (c === undefined || c === null ? "" : String(c).replace(/\s+/g, " ").trim());

/** Дата из ячейки: ISO-строка, серийное число Google или текст «2026-09-07 00:00:00» */
export function cellDate(c: Cell | undefined): IsoDate | null {
  if (c === undefined || c === null || c === "") return null;
  if (typeof c === "number") {
    if (c < 20000 || c > 80000) return null;
    return new Date(Math.round((c - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(c).trim());
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(String(c).trim());
  if (d) return `${d[3]}-${d[2]}-${d[1]}`;
  return null;
}

/** Число из ячейки: пустое, текст и ошибки формул дают null */
export function cellNumber(c: Cell | undefined): number | null {
  if (c === undefined || c === null || c === "") return null;
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const s = String(c).trim().replace(/\s/g, "").replace(",", ".");
  if (!s || /^#/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Найти строку и колонку подписи (например, «Week») в первых строках */
function find(grid: Grid, label: string, maxRows = 12): { r: number; c: number } | null {
  for (let r = 0; r < Math.min(maxRows, grid.length); r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) if (text(row[c]).toLowerCase() === label.toLowerCase()) return { r, c };
  }
  return null;
}

/**
 * Разобрать вкладку. Колонки ключа: пять ячеек слева от колонки подписей шапки («Week»). Недели: все колонки правее,
 * где в строке «Week» стоит номер, а в «Date from» дата. У строк-итогов, где заполнен только комментарий,
 * статья берётся из первой строки с ключом ниже: так итог «OSAGO» под выручкой отличается от итога «OSAGO» под трафиком.
 * Одинаковые ключи получают порядковый хвост «#2», «#3»
 */
export function parseReport(grid: Grid): ParsedReport {
  const week = find(grid, "Week");
  const from = find(grid, "Date from");
  const to = find(grid, "Date to");
  if (!week || !from) throw new ReportFormatError("В вкладке нет шапки с «Week» и «Date from»: это не недельный отчёт");
  const labelCol = week.c;
  const keyCols = [labelCol - 4, labelCol - 3, labelCol - 2, labelCol - 1, labelCol];
  if (keyCols[0]! < 0) throw new ReportFormatError("Слева от шапки меньше пяти колонок ключа");
  const weeks: ReportWeek[] = [];
  const headerRow = grid[week.r] ?? [];
  for (let c = labelCol + 1; c < headerRow.length; c++) {
    const number = cellNumber(headerRow[c]);
    const start = cellDate(grid[from.r]?.[c]);
    if (number === null || !start) continue;
    const end = to ? cellDate(grid[to.r]?.[c]) : null;
    weeks.push({ number: Math.round(number), from: start, to: end ?? start, col: c });
  }
  if (!weeks.length) throw new ReportFormatError("В шапке не нашлось ни одной недели с датой");

  // Сначала собираем сырые строки, потом подставляем статью итогам из строки ниже
  const headerRows = new Set([week.r, from.r, ...(to ? [to.r] : [])]);
  type Raw = { r: number; cells: string[] };
  const raws: Raw[] = [];
  for (let r = 0; r < grid.length; r++) {
    if (headerRows.has(r)) continue;
    const row = grid[r] ?? [];
    const cells = keyCols.map((c) => text(row[c]));
    if (!cells.some(Boolean)) continue;
    // Служебные подписи шапки и пояснения без цифр
    if (!weeks.some((w) => cellNumber(row[w.col]) !== null)) continue;
    raws.push({ r, cells });
  }
  const rows: ReportRow[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i]!;
    const [a, b, c, d, e] = raw.cells as [string, string, string, string, string];
    let article = a;
    if (!article) {
      // Итог: статья от первой строки ниже, у которой она есть
      for (let j = i + 1; j < raws.length && j < i + 60; j++) {
        if (raws[j]!.cells[0]) {
          article = raws[j]!.cells[0]!;
          break;
        }
      }
    }
    const base = [article, b, c, d, e].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const key = n === 1 ? base : `${base}#${n}`;
    const row = grid[raw.r] ?? [];
    rows.push({
      key,
      article,
      iface: b,
      product: c,
      mapping: d,
      comment: e,
      ord: rows.length,
      values: weeks.map((w) => ({ week: w.from, value: cellNumber(row[w.col]) })),
    });
  }
  return { weeks, rows };
}

/** Подпись строки для выбора и для экрана: без повторов одинаковых частей */
export function rowLabel(row: Pick<ReportRow, "article" | "iface" | "product" | "mapping" | "comment">): string {
  const parts: string[] = [];
  for (const p of [row.article, row.iface, row.product, row.mapping, row.comment]) {
    if (p && !parts.some((x) => x.toLowerCase() === p.toLowerCase())) parts.push(p);
  }
  return parts.join(" / ");
}

export type Unit = "count" | "mln" | "pct";

/** Единица по статье и виду чисел: доли меньше единицы это проценты, деньги в млн, остальное штуки */
export function guessUnit(row: Pick<ReportRow, "article" | "comment" | "values">): Unit {
  const label = `${row.article} ${row.comment}`.toLowerCase();
  if (/\bcr\b|share|доля|%|conversion|конверс/.test(label)) return "pct";
  if (/revenue|margin|expenses|выручка|маржа|расход|comission|commission|payments|purchase|promo/.test(label)) return "mln";
  const nums = row.values.map((v) => v.value).filter((v): v is number => v !== null);
  if (nums.length && nums.every((v) => Math.abs(v) <= 1)) return "pct";
  if (nums.length && nums.every((v) => Number.isInteger(v))) return "count";
  return "mln";
}

/** Число для экрана: штуки с разделителем тысяч, млн с одним знаком, проценты из долей */
export function formatValue(value: number | null, unit: Unit): string {
  if (value === null) return "нет";
  if (unit === "pct") return `${ru(value * 100, 1)}%`;
  if (unit === "mln") return `${ru(value, 1, Math.abs(value) < 100 ? 1 : 0)} млн`;
  return ru(Math.round(value), 0);
}

/** Число по-русски с обычным пробелом между разрядами */
export function ru(value: number, maxFraction: number, minFraction = 0): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: maxFraction, minimumFractionDigits: minFraction }).replace(/\u00a0/g, " ");
}

/** Изменение к прошлой неделе: проценты для штук и денег, пункты для долей */
export function formatDelta(value: number | null, prev: number | null, unit: Unit): string | null {
  if (value === null || prev === null) return null;
  if (unit === "pct") {
    const pp = (value - prev) * 100;
    return `${pp > 0 ? "+" : ""}${ru(pp, 1)} п.п.`;
  }
  if (prev === 0) return null;
  const pct = ((value - prev) / Math.abs(prev)) * 100;
  return `${pct > 0 ? "+" : ""}${ru(pct, 1)}%`;
}
