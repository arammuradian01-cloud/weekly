// Разбор таблицы целей (этап 17): ячейки, скопированные из вкладки целей в Bord или из своей таблицы, файл CSV.
// Чистые функции без базы. Понимает и формат вкладок целей в бордах лидеров («№», «Запланировано», «Целевые»,
// «Start», «Как проверяем», «Закрытие», разделы «Запланировано на Q4 2026»), и простую таблицу с колонками
// ID, Квартал, Команда, Владелец, Цель, Метрика, База, Целевое значение, Родительская цель, Ссылка, Итог.

export type GoalResult = "IN_PROGRESS" | "ACHIEVED" | "PARTIAL" | "MISSED" | "DROPPED";

export type GoalRow = {
  line: number;
  code: string;
  quarter: string;
  title: string;
  description: string;
  metric: string;
  base: string;
  target: string;
  owner: string;
  team: string;
  parent: string;
  link: string;
  result: GoalResult;
};

export type GoalProblem = { line: number; text: string };

type Key = "code" | "quarter" | "team" | "owner" | "title" | "description" | "metric" | "base" | "target" | "parent" | "link" | "result";

const COLUMNS: Record<Key, string[]> = {
  code: ["id", "№", "номер", "код", "№ цели", "id цели"],
  quarter: ["квартал", "период"],
  team: ["команда", "подразделение"],
  owner: ["владелец", "ответственный", "лидер", "владелец цели"],
  title: ["цель", "запланировано", "название", "название цели", "цель квартала"],
  description: ["артефакт-описание", "описание", "артефакт", "проблема - что ожидаю", "что ожидаю"],
  metric: ["метрика", "как проверяем", "done когда", "критерий", "критерий достижения"],
  base: ["база", "start", "старт", "значение на старте"],
  target: ["целевое значение", "целевые", "цель (значение)", "target", "целевое"],
  parent: ["родительская цель", "сквозная цель", "родитель", "цель выше"],
  link: ["ссылка", "ссылка на борд", "борд"],
  result: ["итог", "закрытие", "итог квартала", "результат квартала", "статус"],
};

/** Разделы вкладок целей, где целей нет: договорённости, бэклог, свалка */
const STOP = /^(договор[её]нност|бэклог|backlog|свалка)/i;
const QUARTER_WORDS: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4 };

const norm = (s: string) => s.replace(/\s+/g, " ").replace(/ё/g, "е").trim().toLowerCase();
const clean = (s: string | undefined) => (s ?? "").replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
/** Многострочный текст (описание): переносы строк остаются, пробелы внутри строки схлопываются, пустых строк не больше одной подряд */
const cleanLines = (s: string | undefined) =>
  (s ?? "")
    .replace(/[—–]/g, "-")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** «Q4 2026», «4 кв. 2026», «IV квартал 2026», «2026-Q4»: в вид «2026-Q4». null: не квартал */
export function normalizeQuarter(text: string): string | null {
  const t = norm(text);
  let m = /(\d{4})\s*[-\s]?\s*q\s*([1-4])/.exec(t);
  if (m) return `${m[1]}-Q${m[2]}`;
  m = /q\s*([1-4])\s*[-\s']*\s*(\d{4}|\d{2})\b/.exec(t);
  if (m) return `${m[2]!.length === 2 ? `20${m[2]}` : m[2]}-Q${m[1]}`;
  m = /\b([1-4])\s*(?:-?й\s*)?кв(?:\.|артал)?\s*(\d{4})/.exec(t);
  if (m) return `${m[2]}-Q${m[1]}`;
  m = /\b(iv|iii|ii|i)\s*кв(?:\.|артал)?\s*(\d{4})/.exec(t);
  if (m) return `${m[2]}-Q${QUARTER_WORDS[m[1]!]}`;
  return null;
}

export function quarterLabel(q: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(q);
  return m ? `Q${m[2]} ${m[1]}` : q;
}

/** Квартал по дате: для целей без квартала и выбора по умолчанию */
export function quarterOf(iso: string): string {
  const [y, mo] = iso.split("-").map(Number);
  return `${y}-Q${Math.floor((mo! - 1) / 3) + 1}`;
}

export function resultOf(text: string): GoalResult {
  const t = norm(text);
  if (!t) return "IN_PROGRESS";
  if (/(^|\s)(не достигнут|не выполнен|не соответствует|провал)/.test(t)) return "MISSED";
  if (/частичн/.test(t)) return "PARTIAL";
  if (/(снят|отмен|перенос)/.test(t)) return "DROPPED";
  if (/(достигнут|выполнен|соответствует|готово)/.test(t)) return "ACHIEVED";
  return "IN_PROGRESS";
}

function splitTable(text: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const lines = body.split(/\r?\n/).slice(0, 20);
  const delim = lines.some((l) => l.includes("\t")) ? "\t" : lines.reduce((s, l) => s + (l.split(";").length - 1), 0) > lines.reduce((s, l) => s + (l.split(",").length - 1), 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Цели из таблицы. defaultQuarter: квартал для строк без своего квартала и вне раздела «Запланировано на …».
 * Строка заголовков ищется в первых 15 строках: в ней должна быть колонка цели
 */
export function readGoalsTable(input: string | string[][], defaultQuarter: string): { rows: GoalRow[]; problems: GoalProblem[] } {
  const table = typeof input === "string" ? splitTable(input) : input.map((r) => r.map((c) => String(c ?? "")));
  const problems: GoalProblem[] = [];
  let headerAt = -1;
  const col: Partial<Record<Key, number>> = {};
  for (let i = 0; i < Math.min(15, table.length) && headerAt < 0; i++) {
    const header = table[i]!.map((h) => norm(h));
    const titleAt = header.findIndex((h) => COLUMNS.title.includes(h));
    if (titleAt < 0) continue;
    headerAt = i;
    for (const [key, names] of Object.entries(COLUMNS) as [Key, string[]][]) {
      const at = header.findIndex((h) => names.includes(h));
      if (at >= 0) col[key] = at;
    }
  }
  if (headerAt < 0) return { rows: [], problems: [{ line: 0, text: "Нет колонки цели: в строке заголовков нужна колонка «Цель» или «Запланировано»" }] };
  const get = (r: string[], key: Key) => (col[key] === undefined ? "" : clean(r[col[key]!]));
  let quarter = defaultQuarter;
  const rows: GoalRow[] = [];
  const seen = new Map<string, number>();
  for (let i = headerAt + 1; i < table.length; i++) {
    const r = table[i]!;
    const line = i + 1;
    const cells = r.map((c) => clean(c)).filter(Boolean);
    if (!cells.length) continue;
    const first = cells[0]!;
    if (STOP.test(first)) break;
    // Раздел «Запланировано на Q4 2026»: одна ячейка с кварталом или строка со словом «Запланировано». Строка цели
    // с кварталом в названии («Подготовить запуск к Q1 2027») разделом не считается: у неё есть номер или колонка цели
    const joined = cells.join(" ");
    const titled = !!get(r, "title") && !/^запланировано/i.test(get(r, "title"));
    const sectionQuarter = !titled && (cells.length === 1 || /^запланировано/i.test(joined)) ? normalizeQuarter(joined) : null;
    if (sectionQuarter && !get(r, "metric") && !get(r, "target")) {
      quarter = sectionQuarter;
      continue;
    }
    // Повтор строки заголовков ниже по вкладке
    if (norm(get(r, "title")) && COLUMNS.title.includes(norm(get(r, "title")))) continue;
    const title = get(r, "title");
    if (!title) {
      if (get(r, "target") || get(r, "metric")) problems.push({ line, text: "Нет названия цели" });
      continue;
    }
    if (title.length > 300) problems.push({ line, text: "Название цели длиннее 300 знаков: сократите до одной мысли" });
    const ownQuarter = get(r, "quarter") ? normalizeQuarter(get(r, "quarter")) : null;
    if (get(r, "quarter") && !ownQuarter) problems.push({ line, text: `Квартал «${get(r, "quarter")}» не понят: пишите как «Q4 2026»` });
    const code = get(r, "code");
    const q = ownQuarter ?? quarter;
    if (code) {
      // Номер уникален внутри квартала и команды: у разных команд свои номера 1, 2, 3
      const key = `${q}/${norm(get(r, "team"))}/${code}`;
      if (seen.has(key)) problems.push({ line, text: `Цель ${code} за ${quarterLabel(q)} уже есть в строке ${seen.get(key)}` });
      else seen.set(key, line);
    }
    const link = get(r, "link");
    if (link && !/^https?:\/\//i.test(link)) problems.push({ line, text: "Ссылка должна начинаться с https://" });
    rows.push({
      line,
      code,
      quarter: q,
      title: title.slice(0, 300),
      description: (col.description === undefined ? "" : cleanLines(r[col.description])).slice(0, 2000),
      metric: get(r, "metric").slice(0, 500),
      base: get(r, "base").slice(0, 120),
      target: get(r, "target").slice(0, 300),
      owner: get(r, "owner"),
      team: get(r, "team"),
      parent: get(r, "parent"),
      link,
      result: resultOf(get(r, "result")),
    });
  }
  if (!rows.length && !problems.length) problems.push({ line: headerAt + 1, text: "Под заголовком нет ни одной цели" });
  return { rows, problems };
}
