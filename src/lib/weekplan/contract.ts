// Этап 81: факт к плану по неделям. Чистые функции без базы: чтение трёх листов таблицы недель «Недели 2026-2027
// страхование» (этап 4 единой воронки) и листа факта.
//
// - «Справочник строк»: строки плана, ключ line_id и разрезы (продукт, срез, канал, контрагент, регион, тип продажи,
//   показатель, единица). Шапка там, где первая ячейка «line_id».
// - «План для DWH»: бюджет и LRF в плоском виде, зерно line_id × версия × часть недели. Неделя на стыке месяцев разбита
//   на две части, строки «только по месяцам» (ретро, EV, медиа, VAS) идут по месяцам без недели.
// - Факт по неделям: одна строка на line_id и неделю. Пока DWH не готов, это вкладка «Факт Weekly для приложения» той же
//   таблицы недель (факт Weekly Sravni), потом таблица «Факт по неделям» из BI. Колонки ищутся по шапке, так что оба
//   вида читаются одним кодом.
//
// Таблицу недель и таблицу факта ресурс только читает

export type Cell = string | number | boolean | null | undefined;
export type Grid = Cell[][];

export const WEEKPLAN_TABS = {
  dict: "Справочник строк",
  plan: "План для DWH",
  /** Факт Weekly Sravni в формате выгрузки BI: читается, пока нет таблицы факта из BI */
  appFact: "Факт Weekly для приложения",
  /** Вкладка таблицы факта из BI (ТЗ аналитикам, раздел 7) */
  biFact: "Факт по неделям",
} as const;

/** Таблица недель по умолчанию (этап 4 единой воронки): из неё читаются справочник, план и, пока нет BI, факт */
export const WEEKPLAN_SHEET_ID = "1VFo-cgGvwhgvb4lQcUCUVhsLnOVSlK_MaEsfv4vGp4A";

export const WEEKPLAN_LIMITS = {
  dictRows: 1000,
  planRows: 60_000,
  /** План читается кусками: один ответ Google на 60 тысяч строк слишком тяжёлый */
  planChunk: 10_000,
  factRows: 40_000,
  problems: 12,
  /** Строк факта стало меньше этой доли от прошлого чтения: факт не заменяется (лист мог обрезаться) */
  factShrink: 0.5,
  /** Разница значений меньше этого не считается правкой при фиксации */
  epsilon: 1e-6,
} as const;

export type Version = "BUD" | "LRF";
export const VERSION_LABEL: Record<Version, string> = { BUD: "Бюджет", LRF: "LRF" };

export type Unit = "шт" | "млн ₽";

export const CUTS = ["итог", "канал", "тип продажи", "страховая", "регион", "партнёр", "только месяц"] as const;
export type Cut = (typeof CUTS)[number];

export type PlanLine = {
  id: string;
  ord: number;
  product: string;
  cut: Cut;
  channel: string;
  counterparty: string;
  region: string;
  saleType: string;
  metric: string;
  unit: Unit;
  monthOnly: boolean;
  /** Подпись строки во вкладках недель: «Полисы b2c» */
  label: string;
};

export type PlanValue = {
  lineId: string;
  version: Version;
  /** Понедельник недели ГГГГ-ММ-ДД; пусто у строк «только по месяцам» */
  week: string;
  /** Первое число месяца ГГГГ-ММ-ДД */
  month: string;
  /** 1 или 2: часть недели в месяце; 0: строка «только по месяцам» */
  part: number;
  value: number;
};

export type FactValue = { lineId: string; week: string; value: number; updatedAt: string | null; source: string | null };

export type Read<T> = { rows: T[]; problems: string[]; warnings: string[] };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const LINE_ID = /^[A-Z0-9_]+(\.[A-Z0-9_]+)+$/;
const ERROR_RE = /^#(REF!|N\/A|ERROR!|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!)/i;

const text = (c: Cell) => (c === null || c === undefined ? "" : String(c).trim());
const norm = (c: Cell) => text(c).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");

/** Серийный номер даты Google (дни с 30.12.1899) в ГГГГ-ММ-ДД */
export function serialDay(n: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000).toISOString().slice(0, 10);
}

/** Дата из ячейки: текст ГГГГ-ММ-ДД, ДД.ММ.ГГГГ или серийное число. null: не дата */
export function dayOf(c: Cell): string | null {
  if (typeof c === "number") return c > 20_000 && c < 80_000 ? serialDay(c) : null;
  const t = text(c);
  if (ISO.test(t)) return validDay(t) ? t : null;
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) {
    const d = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
    return validDay(d) ? d : null;
  }
  const s = /^(\d{4}-\d{2}-\d{2})[ T]/.exec(t);
  return s && validDay(s[1]!) ? s[1]! : null;
}

const validDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};

/** Понедельник ли: неделя в плане и факте начинается с понедельника */
export const isMonday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() === 1;

export function addDays(day: string, n: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** Понедельник недели, в которую попадает день */
export function mondayOf(day: string): string {
  const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((wd + 6) % 7));
}

/** Число из ячейки: число как есть, текст с пробелами и запятой. null: пусто или не число */
export function numberOf(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const t = text(c).replace(/[\s ]/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Строка шапки: первая строка (в пределах первых 20), где первая ячейка «line_id» */
function headerRow(grid: Grid): number {
  for (let r = 0; r < Math.min(grid.length, 20); r++) if (norm(grid[r]?.[0]) === "line_id") return r;
  return -1;
}

/** Колонка по одному из названий шапки (без учёта регистра и ё) */
function column(head: Cell[], names: string[]): number {
  const want = names.map((n) => norm(n));
  return head.findIndex((h) => want.includes(norm(h)));
}

const limitProblems = (list: string[], what: string) =>
  list.length > WEEKPLAN_LIMITS.problems ? [...list.slice(0, WEEKPLAN_LIMITS.problems), `${what}: ещё ${list.length - WEEKPLAN_LIMITS.problems} таких строк`] : list;

/** «Справочник строк»: шапка с line_id, Продукт, Срез, Канал, Контрагент, Регион, Тип продажи, Показатель, Ед., Только по месяцам */
export function readDict(grid: Grid | undefined): Read<PlanLine> {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!grid?.length) return { rows: [], problems: [`Лист «${WEEKPLAN_TABS.dict}» пуст или его нет`], warnings };
  const h = headerRow(grid);
  if (h < 0) return { rows: [], problems: [`В листе «${WEEKPLAN_TABS.dict}» нет шапки с колонкой line_id`], warnings };
  const head = grid[h]!;
  const col = {
    product: column(head, ["Продукт"]),
    cut: column(head, ["Срез"]),
    channel: column(head, ["Канал"]),
    counterparty: column(head, ["Контрагент"]),
    region: column(head, ["Регион"]),
    saleType: column(head, ["Тип продажи"]),
    metric: column(head, ["Показатель"]),
    unit: column(head, ["Ед.", "Ед"]),
    monthOnly: column(head, ["Только по месяцам"]),
    label: column(head, ["Подпись в «Недели: бюджет»", "Подпись"]),
  };
  const missing = Object.entries(col)
    .filter(([k, i]) => i < 0 && k !== "region" && k !== "label")
    .map(([k]) => k);
  if (missing.length) return { rows: [], problems: [`В шапке «${WEEKPLAN_TABS.dict}» нет колонок: ${missing.join(", ")}`], warnings };
  const rows: PlanLine[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (let r = h + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const id = text(row[0]);
    if (!id) continue;
    const at = `строка ${r + 1}`;
    if (!LINE_ID.test(id)) {
      bad.push(`${at}: line_id «${id.slice(0, 40)}» не похож на ключ вида OS.TOT.S`);
      continue;
    }
    if (seen.has(id)) {
      bad.push(`${at}: line_id ${id} повторяется`);
      continue;
    }
    const cut = text(row[col.cut]) as Cut;
    if (!CUTS.includes(cut)) {
      bad.push(`${at}: у ${id} неизвестный срез «${text(row[col.cut])}»`);
      continue;
    }
    const unit = text(row[col.unit]);
    if (unit !== "шт" && unit !== "млн ₽") {
      bad.push(`${at}: у ${id} единица «${unit}», ждём «шт» или «млн ₽»`);
      continue;
    }
    seen.add(id);
    const label = col.label >= 0 ? text(row[col.label]) : "";
    rows.push({
      id,
      ord: rows.length,
      product: text(row[col.product]),
      cut,
      channel: text(row[col.channel]) || "все",
      counterparty: text(row[col.counterparty]) || "все",
      region: col.region >= 0 ? text(row[col.region]) || "все" : "все",
      saleType: text(row[col.saleType]) || "все",
      metric: text(row[col.metric]),
      unit,
      monthOnly: norm(row[col.monthOnly]) === "да",
      label: label && !ERROR_RE.test(label) ? label : id,
    });
  }
  problems.push(...limitProblems(bad, "Справочник"));
  if (!rows.length && !problems.length) problems.push(`В листе «${WEEKPLAN_TABS.dict}» нет строк под шапкой`);
  return { rows, problems, warnings };
}

/** Строка 3 листа плана: сверка с вкладками недель. «не ок» значит план разошёлся с вкладками недель */
function planCheck(grid: Grid, h: number): string | null {
  for (let r = 0; r < h; r++) {
    const row = grid[r] ?? [];
    if (!norm(row[0]).startsWith("проверка")) continue;
    if (row.some((c) => norm(c) === "не ок")) return `В листе «${WEEKPLAN_TABS.plan}» сверка с вкладками недель показывает «не ок» (строка ${r + 1}): план разошёлся с вкладками недель, загружать его нельзя`;
    if (row.some((c) => ERROR_RE.test(text(c)))) return `В листе «${WEEKPLAN_TABS.plan}» в строке сверки ошибка формулы (строка ${r + 1})`;
  }
  return null;
}

/**
 * «План для DWH»: колонки по шапке. Части 1 и 2 у недели, «месяц» у строк только по месяцам. Строка с line_id не из
 * справочника, с ошибкой формулы или с кривой датой не загружается, загрузка всего плана тогда не проходит: план без
 * части строк дал бы неверный итог
 */
export function readPlan(grid: Grid | undefined, lines: PlanLine[]): Read<PlanValue> & { rowsRead: number } {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!grid?.length) return { rows: [], rowsRead: 0, problems: [`Лист «${WEEKPLAN_TABS.plan}» пуст или его нет`], warnings };
  const h = headerRow(grid);
  if (h < 0) return { rows: [], rowsRead: 0, problems: [`В листе «${WEEKPLAN_TABS.plan}» нет шапки с колонкой line_id`], warnings };
  const head = grid[h]!;
  const col = { version: column(head, ["Версия"]), week: column(head, ["Неделя с"]), month: column(head, ["Месяц"]), part: column(head, ["Часть"]), value: column(head, ["Значение"]) };
  const missing = Object.entries(col)
    .filter(([, i]) => i < 0)
    .map(([k]) => k);
  if (missing.length) return { rows: [], rowsRead: 0, problems: [`В шапке «${WEEKPLAN_TABS.plan}» нет колонок: ${missing.join(", ")}`], warnings };
  const check = planCheck(grid, h);
  if (check) problems.push(check);
  const byId = new Map(lines.map((l) => [l.id, l]));
  const rows: PlanValue[] = [];
  const bad: string[] = [];
  const unknown = new Set<string>();
  const seen = new Set<string>();
  let rowsRead = 0;
  for (let r = h + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const id = text(row[0]);
    if (!id) continue;
    rowsRead += 1;
    const at = `строка ${r + 1}`;
    const line = byId.get(id);
    if (!line) {
      unknown.add(id);
      continue;
    }
    const v = text(row[col.version]);
    const version: Version | null = v === "Бюджет" ? "BUD" : v === "LRF" ? "LRF" : null;
    if (!version) {
      bad.push(`${at}: версия «${v}», ждём «Бюджет» или «LRF»`);
      continue;
    }
    const month = dayOf(row[col.month]);
    if (!month || !month.endsWith("-01")) {
      bad.push(`${at}: месяц «${text(row[col.month])}» не первое число месяца`);
      continue;
    }
    const partText = norm(row[col.part]);
    const part = partText === "месяц" ? 0 : partText === "1" ? 1 : partText === "2" ? 2 : -1;
    if (part < 0) {
      bad.push(`${at}: часть «${text(row[col.part])}», ждём 1, 2 или «месяц»`);
      continue;
    }
    if ((part === 0) !== line.monthOnly) {
      bad.push(`${at}: у ${id} ${line.monthOnly ? "строка только по месяцам, а часть недели" : "строка по неделям, а часть «месяц»"}`);
      continue;
    }
    let week = "";
    if (part > 0) {
      const w = dayOf(row[col.week]);
      if (!w || !isMonday(w)) {
        bad.push(`${at}: неделя «${text(row[col.week])}» не понедельник`);
        continue;
      }
      // Часть недели лежит в своём месяце: неделя начинается не позже конца месяца и кончается не раньше его начала
      if (addDays(w, 6) < month || w > addDays(nextMonth(month), -1)) {
        bad.push(`${at}: неделя ${w} не попадает в месяц ${month}`);
        continue;
      }
      week = w;
    }
    const raw = row[col.value];
    if (ERROR_RE.test(text(raw))) {
      bad.push(`${at}: ошибка формулы ${text(raw)} у ${id}`);
      continue;
    }
    const value = numberOf(raw) ?? (text(raw) === "" ? 0 : null);
    if (value === null) {
      bad.push(`${at}: значение «${text(raw).slice(0, 30)}» у ${id} не число`);
      continue;
    }
    const key = `${id}|${version}|${week}|${month}|${part}`;
    if (seen.has(key)) {
      bad.push(`${at}: строка ${id}, ${v}, ${week || month} повторяется`);
      continue;
    }
    seen.add(key);
    rows.push({ lineId: id, version, week, month, part, value });
  }
  if (unknown.size) bad.unshift(`line_id нет в справочнике: ${[...unknown].slice(0, 8).join(", ")}${unknown.size > 8 ? ` и ещё ${unknown.size - 8}` : ""}`);
  problems.push(...limitProblems(bad, "План"));
  for (const version of ["BUD", "LRF"] as const) if (!rows.some((x) => x.version === version) && !problems.length) problems.push(`В листе «${WEEKPLAN_TABS.plan}» нет строк версии «${VERSION_LABEL[version]}»`);
  // У каждой строки справочника должен быть план в обеих версиях: иначе экран покажет «нет плана» без объяснения
  const covered = new Set(rows.map((x) => `${x.lineId}|${x.version}`));
  const empty = lines.filter((l) => !covered.has(`${l.id}|BUD`) || !covered.has(`${l.id}|LRF`)).map((l) => l.id);
  if (empty.length && rows.length) warnings.push(`Нет плана в одной из версий у строк: ${empty.slice(0, 8).join(", ")}${empty.length > 8 ? ` и ещё ${empty.length - 8}` : ""}`);
  return { rows, rowsRead, problems, warnings };
}

export function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/**
 * Факт по неделям: line_id, неделя (week_start или «Неделя с»), значение (value или «Значение»), по желанию время
 * обновления и источник или статус. Пустое значение пропускается: неделя ещё не наступила. Строка «только по месяцам»
 * или line_id не из справочника пропускается с предупреждением: факт остальных строк от этого не страдает
 */
export function readFact(grid: Grid | undefined, lines: PlanLine[], tab: string): Read<FactValue> {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!grid?.length) return { rows: [], problems: [`Лист «${tab}» пуст или его нет`], warnings };
  const h = headerRow(grid);
  if (h < 0) return { rows: [], problems: [`В листе «${tab}» нет шапки с колонкой line_id`], warnings };
  const head = grid[h]!;
  const col = {
    week: column(head, ["week_start", "Неделя с", "Неделя"]),
    value: column(head, ["value", "Значение"]),
    updated: column(head, ["updated_at", "Обновлено"]),
    source: column(head, ["source", "Статус", "Источник"]),
  };
  if (col.week < 0 || col.value < 0) return { rows: [], problems: [`В шапке «${tab}» нет колонок недели (week_start или «Неделя с») и значения (value или «Значение»)`], warnings };
  const byId = new Map(lines.map((l) => [l.id, l]));
  const rows: FactValue[] = [];
  const bad: string[] = [];
  const unknown = new Set<string>();
  const monthly = new Set<string>();
  const index = new Map<string, number>();
  let repeats = 0;
  for (let r = h + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const id = text(row[0]);
    if (!id) continue;
    const line = byId.get(id);
    if (!line) {
      unknown.add(id);
      continue;
    }
    if (line.monthOnly) {
      monthly.add(id);
      continue;
    }
    const raw = row[col.value];
    if (text(raw) === "") continue;
    const at = `строка ${r + 1}`;
    if (ERROR_RE.test(text(raw))) {
      bad.push(`${at}: ошибка формулы ${text(raw)} у ${id}`);
      continue;
    }
    const value = numberOf(raw);
    if (value === null) {
      bad.push(`${at}: значение «${text(raw).slice(0, 30)}» у ${id} не число`);
      continue;
    }
    const week = dayOf(row[col.week]);
    if (!week || !isMonday(week)) {
      bad.push(`${at}: неделя «${text(row[col.week])}» у ${id} не понедельник`);
      continue;
    }
    const upd = col.updated >= 0 ? row[col.updated] : null;
    const updatedAt = typeof upd === "number" ? updatedText(upd) : text(upd) || null;
    const fact: FactValue = { lineId: id, week, value, updatedAt, source: col.source >= 0 ? text(row[col.source]) || null : null };
    // Одна строка на line_id и неделю: повтор заменяет прежнюю (последняя выгрузка важнее), об этом предупреждение
    const key = `${id}|${week}`;
    const was = index.get(key);
    if (was !== undefined) {
      rows[was] = fact;
      repeats += 1;
    } else {
      index.set(key, rows.length);
      rows.push(fact);
    }
  }
  problems.push(...limitProblems(bad, "Факт"));
  if (unknown.size) warnings.push(`В факте есть line_id, которых нет в справочнике, они пропущены: ${[...unknown].slice(0, 8).join(", ")}${unknown.size > 8 ? ` и ещё ${unknown.size - 8}` : ""}`);
  if (monthly.size) warnings.push(`В факте есть строки «только по месяцам», по неделям они не читаются: ${[...monthly].slice(0, 5).join(", ")}`);
  if (repeats) warnings.push(`В факте ${repeats} повторов line_id и недели: взято последнее значение`);
  return { rows, problems, warnings };
}

/** Время обновления серийным числом Google в «ГГГГ-ММ-ДД ЧЧ:ММ» */
function updatedText(n: number): string {
  const ms = Date.UTC(1899, 11, 30) + n * 86_400_000;
  return new Date(Math.round(ms / 60_000) * 60_000).toISOString().slice(0, 16).replace("T", " ");
}

/** ID таблицы из ссылки или как есть. null: не похоже на Google-таблицу */
export function parseSheetId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const id = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(raw)?.[1] ?? raw;
  return /^[a-zA-Z0-9_-]{25,100}$/.test(id) ? id : null;
}
