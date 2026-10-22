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
/**
 * Лимиты чтения и правила ранрейта. minRunRateDays: ранрейт и «К плану» показываются с этого числа дней факта в месяце
 * (раньше линейная экстраполяция с одного-двух дней пляшет). factDrop: итог «Все СК» за месяц упал против прошлого снимка
 * больше этой доли: снимок не пишется (лист мог обрезаться)
 */
export const HUB_LIMITS = { vseSkRows: 5000, skPlanRows: 6000, cols: 60, minProfileDays: 14, minRunRateDays: 3, factDrop: 0.01, aliases: 300, aliasLength: 200 };

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

/** Ранрейт месяца показывается, когда дней факта (последний день с фактом, число месяца) не меньше minRunRateDays */
export const runRateReady = (elapsed: number) => elapsed >= HUB_LIMITS.minRunRateDays;
/** С какого числа месяца появляется ранрейт: дни факта плюс сдвиг факта (факт по вчерашний день) */
export const RUN_RATE_FROM_DAY = HUB_LIMITS.minRunRateDays + FACT_LAG_DAYS;

// ---------- Ячейки и названия ----------

const text = (c: Cell) => (c === null || c === undefined ? "" : String(c).replace(/ /g, " ").replace(/\s+/g, " ").trim());
const norm = (c: Cell) => text(c).toLowerCase();

// Кавычки всех видов, дефисы и тире всех видов, знаки препинания, которые встречаются в названиях СК
const QUOTES = /["'`«»´‘-‟‹›]/g;
const DASHES = /[-‐-―−]/g;
const PUNCT = /[.,;:()[\]№]/g;
/**
 * Форма собственности и типовые слова, которые срезаются с начала и конца названия: «АО», «ПАО», «СК», «Страховая
 * компания». Слово «страхование» и всё остальное не трогается: «Сбербанк страхование» и «Сбербанк страхование жизни»
 * остаются разными СК
 */
const LEGAL_WORDS: string[][] = [
  ["публичное", "акционерное", "общество"],
  ["общество", "с", "ограниченной", "ответственностью"],
  ["акционерное", "общество"],
  ["страховая", "компания"],
  ...["ао", "пао", "оао", "зао", "нао", "ооо", "сао", "спао", "осао", "ск"].map((w) => [w]),
];

/**
 * Ключ названия СК: так сводятся названия из двух листов и повторы. Без учёта регистра, пробелов, кавычек, ё/е, дефисов и
 * формы собственности: «САО «ВСК»» и «ВСК», «ПАО СК «Росгосстрах»» и «Росгосстрах», «Альфа-Страхование» и
 * «АльфаСтрахование» сводятся. Если от названия ничего не остаётся («СК»), ключ из него целиком
 */
export function skKey(name: Cell): string {
  const words = norm(name).replace(/ё/g, "е").replace(QUOTES, " ").replace(DASHES, " ").replace(PUNCT, " ").split(" ").filter(Boolean);
  let core = words;
  for (let changed = true; changed; ) {
    changed = false;
    for (const phrase of LEGAL_WORDS) {
      const n = phrase.length;
      if (core.length > n && phrase.every((w, i) => core[i] === w)) {
        core = core.slice(n);
        changed = true;
      }
      if (core.length > n && phrase.every((w, i) => core[core.length - n + i] === w)) {
        core = core.slice(0, core.length - n);
        changed = true;
      }
    }
  }
  return core.join("");
}

/** Справочник соответствий названий СК: «название в «Все СК»» к «названию в плане» (настройка plan.skAliases) */
export type SkAliases = Record<string, string>;

/** Справочник из настройки: только строки к строкам, не длиннее лимита */
export function aliasesOf(value: unknown): SkAliases {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: SkAliases = {};
  for (const [from, to] of Object.entries(value as Record<string, unknown>).slice(0, HUB_LIMITS.aliases)) {
    if (typeof to === "string" && text(from) && text(to)) out[text(from).slice(0, HUB_LIMITS.aliasLength)] = text(to).slice(0, HUB_LIMITS.aliasLength);
  }
  return out;
}

/** Справочник текстом для поля: «название = название» по строке */
export const aliasText = (aliases: SkAliases) =>
  Object.entries(aliases)
    .map(([from, to]) => `${from} = ${to}`)
    .join("\n");

/**
 * Разбор поля справочника: строка «название в «Все СК» = название в плане», пустые строки пропускаются. Названия, которые и
 * так сводятся, повтор левой части и название и слева, и справа (цепочка) это ошибки: справочник должен читаться однозначно
 */
export function parseAliases(input: string): { aliases: SkAliases; problems: string[] } {
  const aliases: SkAliases = {};
  const problems: string[] = [];
  const left = new Map<string, number>();
  const right = new Map<string, number>();
  String(input ?? "")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const n = i + 1;
      if (!text(raw)) return;
      const at = raw.indexOf("=");
      const from = at < 0 ? "" : text(raw.slice(0, at));
      const to = at < 0 ? "" : text(raw.slice(at + 1));
      if (!from || !to) return void problems.push(`Строка ${n}: нужно «название в «Все СК» = название в плане»`);
      if (from.length > HUB_LIMITS.aliasLength || to.length > HUB_LIMITS.aliasLength) return void problems.push(`Строка ${n}: название длиннее ${HUB_LIMITS.aliasLength} знаков`);
      const [a, b] = [skKey(from), skKey(to)];
      if (a === b) return void problems.push(`Строка ${n}: «${from}» и «${to}» и так сводятся (регистр, пробелы, кавычки, ё, дефисы и форма собственности не в счёт)`);
      if (left.has(a)) return void problems.push(`Строка ${n}: «${from}» уже есть в строке ${left.get(a)}`);
      if (right.has(a) || left.has(b)) return void problems.push(`Строка ${n}: одно название стоит и слева, и справа в разных строках. Сведите к одному названию из плана`);
      left.set(a, n);
      right.set(b, n);
      aliases[from] = to;
    });
  if (Object.keys(aliases).length > HUB_LIMITS.aliases) problems.push(`Не больше ${HUB_LIMITS.aliases} строк соответствия`);
  return { aliases, problems };
}

/**
 * Ключ СК с учётом справочника: название из справочника сводится к названию в плане. Применяется к обоим листам, поэтому
 * строка, записанная наоборот («название в плане = название в «Все СК»»), тоже сводит СК
 */
export function aliasKeys(aliases: SkAliases): (name: Cell) => string {
  const map = new Map(Object.entries(aliases).map(([from, to]) => [skKey(from), skKey(to)]));
  return (name: Cell) => {
    const k = skKey(name);
    return map.get(k) ?? k;
  };
}

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

/** «в 1 ячейке», «в 5 ячейках» */
const inCells = (n: number) => `${n.toLocaleString("ru-RU")} ${n % 10 === 1 && n % 100 !== 11 ? "ячейке" : "ячейках"}`;

/** Сетка без единой непустой ячейки: лист есть, но пустой */
const blank = (grid: Grid) => grid.every((row) => !row || row.every((c) => text(c) === ""));

/** Счётчик ячеек с ошибками по СК для предупреждения: сколько, у каких СК, первый пример */
type ErrorTally = { count: number; bySk: Map<string, string> };
const tally = (): ErrorTally => ({ count: 0, bySk: new Map() });
function note(t: ErrorTally, sk: string, example: string, cells = 1) {
  t.count += cells;
  if (!t.bySk.has(sk)) t.bySk.set(sk, example);
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
 * (месяц, СК по skKey, пул, апсейл) складываются, об этом предупреждение со счётчиком. Строка с СК, но без месяца или без
 * числа полисов, строка с месяцем и ненулевыми полисами, но без PARTNER_NAME, и ошибка формулы в нужной ячейке блокируют
 * снимок: иначе факт по СК молча стал бы меньше
 */
export function readVseSk(grid: Grid | undefined, keep?: readonly string[]): VseSkRead {
  const sheet = `Лист «${HUB_SHEETS.vseSk}»`;
  if (!grid) return { rows: [], months: [], problems: [`${sheet} не найден в хабе`], warnings: [] };
  if (blank(grid)) return { rows: [], months: [], problems: [`${sheet} пустой`], warnings: [] };
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
  const firstLine = new Map<string, number>();
  const months = new Set<string>();
  const errors = new Map<string, string>();
  const dropped = new Map<string, string>();
  const unnamed: number[] = [];
  let repeats = 0;
  let repeatExample = "";
  grid.slice(1).forEach((row, i) => {
    const line = i + 2;
    const sk = text(row[c.sk]);
    if (isTotal(sk)) return;
    const month = monthOf(row[c.month]);
    if (month && keep && !keep.includes(month)) {
      if (sk) months.add(month);
      return;
    }
    if (!sk) {
      // Полисы без названия СК: чьи они, не понять. Пустая строка и строка с нулём не в счёт
      const n = cellNumber(row[c.pol]);
      if (month && (cellError(row[c.pol]) !== null || (n !== null && n !== 0))) unnamed.push(line);
      return;
    }
    if (month) months.add(month);
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
      repeats += 1;
      if (!repeatExample) repeatExample = `${prev.sk}, строки ${firstLine.get(key)} и ${line}`;
    } else {
      acc.set(key, { month, sk, pool, upsale, policies, premium, revenue: rev });
      firstLine.set(key, line);
    }
  });
  const lines = unnamed.length > 8 ? `${unnamed.slice(0, 8).join(", ")} и ещё ${unnamed.length - 8}` : unnamed.join(", ");
  const problems = [
    bySk(sheet, "ошибки в ячейках", errors),
    bySk(sheet, "не прочитаны строки", dropped, "Без них факт по СК был бы неполным"),
    unnamed.length ? `${sheet}: пустое PARTNER_NAME при ненулевых полисах, ${unnamed.length === 1 ? "строка" : "строки"} ${lines}. Чьи это полисы, не понять, а без них факт по СК был бы неполным` : null,
  ].filter((p): p is string => p !== null);
  if (repeats) warnings.push(`${sheet}: строки с одинаковыми месяцем, СК, пулом и апсейлом сложены в одну, повторов: ${repeats} (например, ${repeatExample})`);
  const rows = [...acc.values()];
  if (!rows.length && !months.size && !problems.length) problems.push(`${sheet} пустой`);
  return { rows, months: [...months].sort(), problems, warnings };
}

export type SkPlanRow = { period: string; sk: string; metric: SkMetric; value: number | null };
export type SkPlanRead = { rows: SkPlanRow[]; periods: string[]; problems: string[]; warnings: string[] };

/** Период из шапки плана: «FY2027» как есть, месяц текстом или датой (Google отдаёт дату числом) через monthOf */
function periodOf(c: Cell): string | null {
  const t = text(c);
  if (/^FY\d{4}$/i.test(t)) return t.toUpperCase();
  return monthOf(c);
}

/** Подпись строки плана: текст или ошибка формулы (тогда значение неизвестно) */
type Label = { text: string; error: string | null };
const EMPTY: Label = { text: "", error: null };
const labelOf = (c: Cell): Label => {
  const error = cellError(c);
  return { text: error ? "" : text(c), error };
};
const present = (l: Label) => l.error !== null || l.text !== "";
const sameLabel = (a: Label, b: Label, key: (c: Cell) => string = norm) => (a.error !== null || b.error !== null ? a.error === b.error : key(a.text) === key(b.text));

/**
 * Лист «План ОСАГО по СК» хаба: широкая таблица СК, Раздел, Канал, Регион, Код, Показатель и колонки периодов
 * (2026-01 … FY2027). Берутся только строки раздела «Воронка» по всем каналам и всем регионам и показатели SK_METRICS.
 * Шапка ищется по колонке «Код» в первых пяти строках: перед таблицей может стоять строка примечания. Объединённые ячейки
 * (значение только в первой строке) протягиваются вниз по старшинству: СК, внутри СК Раздел, внутри Раздела Канал, внутри
 * Канала Регион. Смена СК сбрасывает Раздел, Канал и Регион: подпись чужой СК не протягивается.
 *
 * month: текущий месяц. Без его колонки или без единого числа полисов за него у СК (итог не в счёт) план не загружается:
 * сломанный лист не должен затереть план пустыми строками. Блокируют только ошибки, без которых план неверен: ошибка в
 * полисах за текущий месяц у отобранной строки и ошибка в подписи строки, которая по остальным подписям проходит отбор
 * (непонятно, чья она). Остальные ошибки формул (КВ за год, премия прошлого месяца, подписи чужих каналов и регионов)
 * записываются пустыми и показываются предупреждением: сколько ячеек и у каких СК. Повтор строки СК тоже блокирует
 */
export function readSkPlan(grid: Grid | undefined, month?: string): SkPlanRead {
  const sheet = `Лист «${HUB_SHEETS.skPlan}»`;
  const none = (problem: string): SkPlanRead => ({ rows: [], periods: [], problems: [problem], warnings: [] });
  if (!grid) return none(`${sheet} не найден в хабе`);
  if (blank(grid)) return none(`${sheet} пустой`);
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
  const labelErrors = new Map<string, string>();
  const polErrors = new Map<string, string>();
  const repeats = new Map<string, string>();
  const nulled = tally();
  const skipped = tally();
  const seen = new Map<string, number>();
  const labelCols: [string, number][] = (
    [
      ["СК", cSk],
      ["Раздел", cSection],
      ["Канал", cChannel],
      ["Регион", cRegion],
      ["Код", cCode],
    ] as [string, number][]
  ).filter(([, j]) => j >= 0);
  let sk = EMPTY;
  let section = EMPTY;
  let channel = EMPTY;
  let region = EMPTY;
  grid.slice(headIndex + 1).forEach((row, i) => {
    const line = headIndex + i + 2;
    const skCell = labelOf(row[cSk]);
    if (present(skCell) && !sameLabel(skCell, sk, skKey)) {
      sk = skCell;
      section = channel = region = EMPTY;
    }
    if (cSection >= 0 && present(labelOf(row[cSection])) && !sameLabel(labelOf(row[cSection]), section)) {
      section = labelOf(row[cSection]);
      channel = region = EMPTY;
    }
    if (cChannel >= 0 && present(labelOf(row[cChannel])) && !sameLabel(labelOf(row[cChannel]), channel)) {
      channel = labelOf(row[cChannel]);
      region = EMPTY;
    }
    if (cRegion >= 0 && present(labelOf(row[cRegion]))) region = labelOf(row[cRegion]);
    const code = labelOf(row[cCode]);
    // Отбор: каждое условие да, нет или неизвестно (в подписи ошибка формулы, своя или протянутая сверху)
    const test = (l: Label, ok: (t: string) => boolean): boolean | null => (l.error ? null : ok(l.text));
    const checks: [string, boolean | null, Label][] = [
      ["СК", test(sk, (t) => t !== ""), sk],
      ["Код", test(code, (t) => (SK_METRICS as readonly string[]).includes(t)), code],
      ...(cSection >= 0 ? ([["Раздел", test(section, (t) => norm(t) === "воронка"), section]] as [string, boolean | null, Label][]) : []),
      ...(cChannel >= 0 ? ([["Канал", test(channel, (t) => norm(t) === "все каналы"), channel]] as [string, boolean | null, Label][]) : []),
      ...(cRegion >= 0 ? ([["Регион", test(region, (t) => norm(t) === "все регионы"), region]] as [string, boolean | null, Label][]) : []),
    ];
    const who = sk.error || !sk.text ? `строка ${line}` : isTotal(sk.text) ? SK_TOTAL : sk.text;
    if (checks.some(([, ok]) => ok === false)) {
      // Строка ресурсу не нужна: ошибка в её подписи загрузке не мешает, но о ней стоит знать
      const own = labelCols.map(([name, j]) => [name, cellError(row[j])] as const).filter(([, e]) => e);
      if (own.length) note(skipped, who, `строка ${line}, ${own[0]![0]} ${own[0]![1]}`, own.length);
      return;
    }
    const broken = checks.filter(([, ok]) => ok === null);
    if (broken.length) {
      // По остальным подписям строка проходит отбор, но чья она и что в ней, не понять
      if (!labelErrors.has(who)) labelErrors.set(who, `строка ${line}, ${broken.map(([name, , l]) => `${name} ${l.error}`).join(", ")}`);
      return;
    }
    const name = isTotal(sk.text) ? SK_TOTAL : sk.text;
    const metric = code.text as SkMetric;
    const key = `${skKey(name)}|${metric}`;
    const before = seen.get(key);
    if (before !== undefined) {
      if (!repeats.has(name)) repeats.set(name, `${metric}, строки ${before} и ${line}`);
      return;
    }
    seen.set(key, line);
    for (const { j, period } of periods) {
      const e = cellError(row[j]);
      if (e && month && period === month && metric === "pol") {
        if (!polErrors.has(name)) polErrors.set(name, `строка ${line}, ${e}`);
      } else if (e) note(nulled, name, `${metric} ${period} ${e}`);
      rows.push({ period, sk: name, metric, value: e ? null : cellNumber(row[j]) });
    }
  });
  const labelList = [...labelErrors.entries()].map(([who, detail]) => (who.startsWith("строка ") ? detail : `${who}, ${detail}`));
  const problems = [
    labelList.length ? `${sheet}: ошибки в подписях нужных для загрузки строк (${nameList(labelList, 3)}): чья это строка и что в ней, не понять` : null,
    month ? bySk(sheet, `ошибки в полисах за ${month}`, polErrors) : null,
    bySk(sheet, "строка повторяется", repeats),
  ].filter((p): p is string => p !== null);
  if (!rows.length && !problems.length) problems.push(`${sheet}: нет строк раздела «Воронка»`);
  if (month && seen.size && !polErrors.size) {
    const hasNumber = (total: boolean) => rows.some((r) => r.period === month && r.metric === "pol" && r.value !== null && (r.sk === SK_TOTAL) === total);
    if (!hasNumber(false)) problems.push(`${sheet}: у полисов за ${month} нет ни одного числа у СК${hasNumber(true) ? ", число есть только в итоге" : ""}`);
  }
  const warnings: string[] = [];
  const example = (t: ErrorTally) => [...t.bySk.entries()][0]!;
  if (nulled.count) {
    const [first, ex] = example(nulled);
    warnings.push(`${sheet}: ошибки формул в ${inCells(nulled.count)} у СК ${nameList([...nulled.bySk.keys()], 5)} (например, ${first}: ${ex}). Эти ячейки загрузятся пустыми, остальной план загрузится`);
  }
  if (skipped.count) {
    const [first, ex] = example(skipped);
    const named = [...skipped.bySk.keys()].filter((k) => !k.startsWith("строка "));
    warnings.push(`${sheet}: ошибки формул в ${inCells(skipped.count)} подписей строк, которые ресурс не берёт (${named.length ? `у СК ${nameList(named, 5)}; ` : ""}например, ${first.startsWith("строка ") ? ex : `${first}: ${ex}`}). Загрузке не мешают`);
  }
  return { rows, periods: periods.map((p) => p.period), problems, warnings };
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
  /** По профилю дней недели: null, пока дней с дневным фактом (снимок за день и за предыдущий день) меньше HUB_LIMITS.minProfileDays */
  profile: number | null;
  /** Что показываем как прогноз: профиль, когда он есть, иначе линейно */
  forecast: number;
  /** Расхождение методов больше 10%: месяц нестабильный, показываются оба */
  unstable: boolean;
};

/**
 * Ранрейт месяца по снимкам нарастающего итога. day у снимка это день факта (snapshotDayIn), а не день загрузки. Снимки
 * идут по дням, пропуски дней допустимы: дневной факт известен только там, где есть снимок и снимок предыдущего дня.
 * Профиль дней недели строится по известным дневным фактам: средний факт каждого дня недели, остаток месяца считается по
 * календарю. Показывать ранрейт или нет (runRateReady), решает вызывающий
 */
export function runRate(month: string, snapshots: { day: string; mtd: number }[]): RunRate | null {
  const days = daysIn(month);
  const sorted = [...snapshots].filter((s) => s.day.startsWith(month)).sort((a, b) => a.day.localeCompare(b.day));
  const last = sorted[sorted.length - 1];
  if (!last) return null;
  const elapsed = Number(last.day.slice(8, 10));
  const linear = elapsed > 0 ? (last.mtd / elapsed) * days : last.mtd;
  // Дневные факты: разница соседних по календарю снимков. Первый снимок месяца дневного факта не даёт, даже снимок за
  // 1-е число: предыдущего снимка нет, с него только начинается отсчёт
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
