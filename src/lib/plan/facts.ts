// Факт месяца по дням (этап 35): разбор вставки из отчёта аналитиков и темп к прогнозу. Чистые функции без базы.
//
// Формат: первая строка заголовки, разделитель табуляция (вставка из таблицы), точка с запятой или запятая.
// Узкий вид: «Дата», «Продукт», «Показатель», «Значение». Широкий вид: «Дата», «Продукт» и колонки показателей:
// «Продажи», «Выручка, млн», «Промо-маржа, млн». Выручку и маржу можно дать в рублях: «Выручка, руб»

import { PRODUCTS } from "./spec";

export type FactMetric = "units" | "revenue" | "promoMargin";

export const FACT_METRICS: { key: FactMetric; label: string; unit: "count" | "mln" }[] = [
  { key: "units", label: "Продажи", unit: "count" },
  { key: "revenue", label: "Выручка, млн", unit: "mln" },
  { key: "promoMargin", label: "Промо-маржа, млн", unit: "mln" },
];

export const FACT_LIMITS = { rows: 5000, problems: 12, monthsBack: 13, maxMlnPerDay: 10_000, maxUnitsPerDay: 10_000_000 };

/** Один день продукта: YYYY-MM-DD */
export type FactEntry = { product: string; metric: FactMetric; day: string; value: number };

export type ParsedFacts = { entries: FactEntry[]; problems: string[]; rows: number };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ALIASES: Record<string, string> = {
  осаго: "osago",
  каско: "kasko",
  ипотека: "red-mortgage",
  "ипотечное страхование": "red-mortgage",
  взр: "red-travel",
  "страхование путешественников": "red-travel",
  нс: "red-accident",
  "несчастный случай": "red-accident",
  имущество: "red-property",
  клещ: "red-tick",
  вклады: "deposits",
  депозиты: "deposits",
};

export function productCode(cell: string): string | null {
  const c = norm(cell);
  if (!c) return null;
  for (const p of PRODUCTS) if (norm(p.label) === c || p.code === c) return p.code;
  return ALIASES[c] ?? null;
}

/** Ячейка начинается с одного из слов. \b в JavaScript не видит границу у русских букв, поэтому граница своя */
const head = (cell: string, words: string) => new RegExp(`^(${words})(?=$|[^a-zа-я0-9])`).test(cell);

/** Показатель по заголовку или ячейке: ключ и множитель до единиц хранения (млн руб. для денег) */
export function metricOf(cell: string): { key: FactMetric; scale: number } | null {
  const c = norm(cell);
  // Деньги хранятся в миллионах: «млрд» в тысячу раз больше, «тыс. руб» в тысячу раз меньше, просто рубли в миллион
  const money = /(млрд|bln)/.test(c) ? 1000 : /(млн|mln)/.test(c) ? 1 : /(тыс|thousand|k ?rub)/.test(c) ? 1e-3 : /(руб|rub|₽)/.test(c) ? 1e-6 : 1;
  if (head(c, "продажи|полисы|лиды|клики|units|sales")) return { key: "units", scale: 1 };
  if (head(c, "выручка|revenue")) return { key: "revenue", scale: money };
  if (head(c, "промо-?маржа|промо маржа|promo[ -]?margin")) return { key: "promoMargin", scale: money };
  return null;
}

/** Дата: 07.10.2026, 07.10.26 или 2026-10-07. null: не дата */
export function dayOf(cell: string): string | null {
  const c = cell.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(c);
  if (match) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]!.length === 2 ? `20${match[3]}` : match[3]);
  } else if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c))) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Число из ячейки: пробелы между разрядами, запятая или точка, минус любого вида. Проценты и текст не числа */
export function numberOf(cell: string): number | null {
  const c = cell.replace(/[\s   ]/g, "").replace(/[−–]/g, "-");
  if (!/^-?\d+([.,]\d+)?$/.test(c)) return null;
  const n = Number(c.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

type Delimiter = "\t" | ";" | ",";

/** Разделитель по строке заголовков: табуляция (вставка из таблицы), точка с запятой, запятая */
function delimiterOf(line: string): Delimiter {
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  return ",";
}

/** Строка CSV с кавычками: «"15,8"» остаётся одной ячейкой, «""» внутри кавычек это кавычка. open: кавычка не закрыта */
export function splitRow(line: string, delimiter: Delimiter): string[] & { open?: boolean } {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return Object.assign(out, { open: quoted });
}

const firstDayBack = (today: string, months: number) => {
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};

/** Разбор вставки. today: сегодня по Москве, будущие дни не принимаются */
export function parseFacts(text: string, today: string): ParsedFacts {
  const lines = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== "");
  const problems: string[] = [];
  const entries: FactEntry[] = [];
  if (!lines.length) return { entries, problems: ["Вставьте строки из отчёта: первая строка с заголовками"], rows: 0 };
  if (lines.length - 1 > FACT_LIMITS.rows) return { entries, problems: [`Не больше ${FACT_LIMITS.rows} строк за раз`], rows: lines.length - 1 };
  const delimiter = delimiterOf(lines[0]!);
  const split = (l: string) => splitRow(l, delimiter);
  const titles = split(lines[0]!).map((h) => norm(h));
  const dateCol = titles.findIndex((h) => head(h, "дата|день|date|day"));
  const productCol = titles.findIndex((h) => head(h, "продукт|product"));
  const metricCol = titles.findIndex((h) => head(h, "показатель|metric"));
  const valueCol = titles.findIndex((h) => head(h, "значение|факт|value"));
  const wide = titles.map((h, i) => ({ i, m: i === dateCol || i === productCol ? null : metricOf(h) })).filter((x): x is { i: number; m: { key: FactMetric; scale: number } } => !!x.m);
  const long = metricCol >= 0 && valueCol >= 0;
  if (dateCol < 0 || productCol < 0 || (!long && !wide.length)) {
    return { entries, problems: ["Первая строка: заголовки «Дата», «Продукт» и «Показатель» со «Значением» или колонки «Продажи», «Выручка, млн», «Промо-маржа, млн»"], rows: lines.length - 1 };
  }
  // Запятая-разделитель вместе с запятой в заголовке «Выручка, млн» или в дробях «15,8» сдвигает колонки без ошибки. Поэтому
  // через запятую принимается только узкий вид из четырёх колонок: лишняя запятая в значении даёт лишнюю колонку и ошибку
  if (delimiter === ",") {
    const used = titles.filter((h) => h !== "").length;
    if (!long || used !== 4 || titles.slice(0, 4).some((h) => h === "")) {
      return { entries, problems: ["Через запятую загружается только узкий вид: «Дата», «Продукт», «Показатель», «Значение». Широкую таблицу скопируйте прямо из таблицы или разделите точкой с запятой"], rows: lines.length - 1 };
    }
  }
  const from = firstDayBack(today, FACT_LIMITS.monthsBack);
  const seen = new Set<string>();
  const add = (row: number, product: string, metric: { key: FactMetric; scale: number }, day: string, raw: string) => {
    const n = numberOf(raw);
    if (n === null) return problems.push(`Строка ${row}: «${raw.trim().slice(0, 30)}» не число`);
    // Перевод единиц без хвостов двоичной арифметики: 0,0059 млрд это ровно 5,9 млн
    const value = metric.scale === 1 ? n : Math.round(n * metric.scale * 1e9) / 1e9;
    if (metric.key === "units") {
      if (value < 0) return problems.push(`Строка ${row}: продажи не могут быть меньше нуля`);
      // «13,450» из английской таблицы читается как 13,45: продажи только целым числом
      if (!Number.isInteger(value)) return problems.push(`Строка ${row}: продажи целым числом, без дробей и разделителя тысяч «,»`);
      if (value > FACT_LIMITS.maxUnitsPerDay) return problems.push(`Строка ${row}: слишком много продаж за день, проверьте число`);
    } else if (Math.abs(value) > FACT_LIMITS.maxMlnPerDay) {
      return problems.push(`Строка ${row}: больше ${String(FACT_LIMITS.maxMlnPerDay).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} млн за день. Если это рубли, напишите в заголовке «Выручка, руб»`);
    }
    const key = `${product}:${metric.key}:${day}`;
    if (seen.has(key)) return problems.push(`Строка ${row}: этот день продукта и показатель уже есть выше`);
    seen.add(key);
    entries.push({ product, metric: metric.key, day, value });
    return 0;
  };
  for (let r = 1; r < lines.length; r++) {
    const row = r + 1;
    const cells = split(lines[r]!);
    if (cells.open) {
      problems.push(`Строка ${row}: кавычка не закрыта`);
      continue;
    }
    // При запятой значимы только четыре колонки: всё, что правее, значит запятую внутри значения
    const limit = delimiter === "," ? 4 : titles.length;
    if (cells.length > limit && cells.slice(limit).some((c) => c.trim() !== "")) {
      problems.push(`Строка ${row}: колонок больше, чем в заголовке. Похоже, дробь записана через запятую при разделителе-запятой`);
      continue;
    }
    const day = dayOf(cells[dateCol] ?? "");
    if (!day) {
      problems.push(`Строка ${row}: дата не разобрана, нужен вид 07.10.2026`);
      continue;
    }
    if (day > today) {
      problems.push(`Строка ${row}: ${day.split("-").reverse().join(".")} ещё не наступило`);
      continue;
    }
    if (day < from) {
      problems.push(`Строка ${row}: дата старше ${FACT_LIMITS.monthsBack} месяцев`);
      continue;
    }
    const product = productCode(cells[productCol] ?? "");
    if (!product) {
      problems.push(`Строка ${row}: продукт «${(cells[productCol] ?? "").trim().slice(0, 30)}» не найден`);
      continue;
    }
    if (long) {
      const metric = metricOf(cells[metricCol] ?? "");
      if (!metric) {
        problems.push(`Строка ${row}: показатель «${(cells[metricCol] ?? "").trim().slice(0, 30)}» не найден: продажи, выручка или промо-маржа`);
        continue;
      }
      add(row, product, metric, day, cells[valueCol] ?? "");
    } else {
      for (const w of wide) {
        const raw = cells[w.i] ?? "";
        if (raw.trim() === "") continue;
        add(row, product, w.m, day, raw);
      }
    }
  }
  if (!problems.length && !entries.length) problems.push("В строках нет значений");
  const shown = problems.slice(0, FACT_LIMITS.problems);
  if (problems.length > shown.length) shown.push(`И ещё ${problems.length - shown.length} строк с ошибками`);
  return { entries, problems: shown, rows: lines.length - 1 };
}

export const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

export type Pace = {
  /** Факт с начала месяца по последний день с данными */
  toDate: number;
  /** Последний день с фактом: номер дня месяца */
  elapsed: number;
  days: number;
  /** Дней с фактом из elapsed: пропуски видны */
  withData: number;
  /** Прогноз на дату при равномерном темпе: прогноз × прошедшие дни / дни месяца */
  planToDate: number | null;
  /** Выполнение прогноза на дату: факт / прогноз на дату */
  execution: number | null;
  /** Месяц при текущем темпе: факт / прошедшие дни × дни месяца */
  runRate: number;
  /** Темп месяца минус прогноз */
  gap: number | null;
};

/** Темп к прогнозу при равномерном распределении по дням месяца */
export function pace(daily: { day: string; value: number }[], month: string, forecast: number | null): Pace | null {
  const inMonth = daily.filter((d) => d.day.startsWith(month));
  if (!inMonth.length) return null;
  const days = daysInMonth(month);
  const elapsed = Math.max(...inMonth.map((d) => Number(d.day.slice(8, 10))));
  const toDate = inMonth.reduce((s, d) => s + d.value, 0);
  const runRate = (toDate / elapsed) * days;
  const planToDate = forecast === null ? null : (forecast * elapsed) / days;
  return {
    toDate,
    elapsed,
    days,
    withData: new Set(inMonth.map((d) => d.day)).size,
    planToDate,
    execution: planToDate ? toDate / planToDate : null,
    runRate,
    gap: forecast === null ? null : runRate - forecast,
  };
}
