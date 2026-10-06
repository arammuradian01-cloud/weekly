// Загрузка структуры департамента из таблицы (этап 14). Владелец выгружает лист структуры в CSV или копирует
// ячейки из Google-таблицы, ресурс показывает, что добавится, изменится и уйдёт, и только по подтверждению применяет.
//
// Колонки (заголовки по-русски, порядок любой, лишние колонки не читаются):
//   ФИО, Должность, Управление, Отдел, Сектор, Направление, Руководитель, Функциональный руководитель, Почта, Руководит, Статус
// - путь подразделения: Управление, Отдел, Сектор, Направление; пустые уровни пропускаются, корень: департамент;
// - «Руководит»: да, если человек руководит самым глубоким подразделением своей строки;
// - «Статус»: «вакансия», или ФИО начинается со слова «вакансия»: строка становится пустым местом, человека не заводим;
// - «Руководитель»: ФИО административного руководителя. Пусто: руководитель подразделения, а для руководителя
//   подразделения: руководитель подразделения уровнем выше.
// Кадровые колонки (сокращение, тип договора, даты, комментарии по заменам) не читаются вовсе.

import { NameIndex, normName, personNameFromBord, type NamedPerson } from "@/lib/bord/names";

export const IMPORT_COLUMNS = {
  name: ["фио", "сотрудник", "имя"],
  position: ["должность", "позиция", "position"],
  management: ["управление"],
  division: ["отдел"],
  sector: ["сектор"],
  stream: ["направление", "группа"],
  manager: ["руководитель", "подчиняется", "административный руководитель"],
  functional: ["функциональный руководитель", "матричный руководитель"],
  email: ["почта", "email", "e-mail"],
  head: ["руководит", "руководит подразделением"],
  status: ["статус"],
} as const;

type ColumnKey = keyof typeof IMPORT_COLUMNS;

export type ImportRow = {
  line: number;
  name: string;
  position: string;
  path: string[];
  manager: string;
  functional: string;
  email: string;
  head: boolean;
  vacancy: boolean;
};

export type ImportProblem = { line: number; text: string };

/** Разбор CSV с разделителем: запятая, точка с запятой или табуляция (так копируются ячейки из Google-таблицы) */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const counts = { "\t": firstLine.split("\t").length, ";": firstLine.split(";").length, ",": firstLine.split(",").length };
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0]) as "\t" | ";" | ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
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
      if (ch === "\r" && clean[i + 1] === "\n") i++;
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

const cleanCell = (v: string | undefined) => (v ?? "").replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
const isDash = (v: string) => !v || v === "-" || v.toLowerCase() === "n/a";
const yes = (v: string) => ["да", "1", "yes", "true", "+", "руководитель"].includes(v.toLowerCase());

export function readStructureTable(text: string): { rows: ImportRow[]; problems: ImportProblem[] } {
  const table = parseDelimited(text).filter((r) => r.some((c) => c.trim()));
  const problems: ImportProblem[] = [];
  if (!table.length) return { rows: [], problems: [{ line: 0, text: "Файл пустой" }] };
  const header = table[0]!.map((h) => normName(h));
  const col: Partial<Record<ColumnKey, number>> = {};
  for (const [key, names] of Object.entries(IMPORT_COLUMNS) as [ColumnKey, readonly string[]][]) {
    // Сначала точное имя колонки, потом начало: «Функциональный руководитель» не должен поймать «Руководитель»
    const exact = header.findIndex((h) => names.includes(h));
    if (exact >= 0) col[key] = exact;
  }
  if (col.name === undefined) return { rows: [], problems: [{ line: 1, text: "Нет колонки «ФИО»: первая строка файла должна быть заголовком" }] };
  const get = (r: string[], key: ColumnKey) => (col[key] === undefined ? "" : cleanCell(r[col[key]!]));
  const rows: ImportRow[] = [];
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const name = get(r, "name");
    const status = get(r, "status").toLowerCase();
    const position = isDash(get(r, "position")) ? "" : get(r, "position");
    const path = (["management", "division", "sector", "stream"] as ColumnKey[]).map((k) => get(r, k)).filter((v) => !isDash(v));
    const vacancy = status.startsWith("ваканс") || /^ваканс/i.test(name);
    if (!name && !vacancy) {
      if (position || path.length) problems.push({ line, text: "Нет ФИО" });
      return;
    }
    if (!vacancy && name.split(" ").filter(Boolean).length < 2) {
      problems.push({ line, text: `«${name}»: нужны фамилия и имя` });
      return;
    }
    if (vacancy && !position) {
      problems.push({ line, text: "Вакансия без должности" });
      return;
    }
    rows.push({
      line,
      name: vacancy ? "" : name,
      position,
      path,
      manager: isDash(get(r, "manager")) ? "" : get(r, "manager"),
      functional: isDash(get(r, "functional")) ? "" : get(r, "functional"),
      email: get(r, "email").toLowerCase(),
      head: yes(get(r, "head")),
      vacancy,
    });
  });
  return { rows, problems };
}

export const pathKey = (path: string[]) => path.map((p) => normName(p)).join(" / ");

/** Фамилия и имя без отчества: «антонов дмитрий» */
export const nameKey2 = (name: string) => normName(name).split(" ").slice(0, 2).join(" ");

/** Уровень подразделения: по первому слову названия («Сектор телемаркетинга»), иначе по глубине пути */
export function kindOfDepth(depth: number, name = ""): "MANAGEMENT" | "DIVISION" | "SECTOR" | "STREAM" | "FUNCTION" {
  const first = normName(name).split(" ")[0] ?? "";
  if (first.startsWith("управлен")) return "MANAGEMENT";
  if (first.startsWith("отдел")) return "DIVISION";
  if (first.startsWith("сектор")) return "SECTOR";
  if (first.startsWith("направлен") || first.startsWith("групп")) return "STREAM";
  if (first.startsWith("функц")) return "FUNCTION";
  return (["MANAGEMENT", "DIVISION", "SECTOR", "STREAM"] as const)[Math.min(depth, 3)]!;
}

export type ExistingPerson = NamedPerson & {
  slug: string;
  position: string | null;
  unitPath: string | null;
  manager: string | null;
  functional: string | null;
  email: string | null;
  active: boolean;
};

export type PlannedPerson = {
  line: number;
  /** id человека ресурса или null: новый */
  id: string | null;
  fullName: string;
  shortName: string;
  position: string;
  path: string[];
  head: boolean;
  managerName: string;
  functionalName: string;
  email: string;
  /** Что поменяется у человека ресурса: «должность: было, стало» */
  changes: string[];
};

export type StructurePlan = {
  units: { add: string[]; keep: number; remove: string[] };
  people: { add: PlannedPerson[]; change: PlannedPerson[]; same: number; missing: { slug: string; fullName: string }[] };
  vacancies: { path: string[]; position: string }[];
  problems: ImportProblem[];
  /** Все строки людей в порядке файла: для применения */
  planned: PlannedPerson[];
};

/** Человек по ФИО из файла: точное ФИО, фамилия и имя без отчества, или фамилия плюс короткое имя */
export function matchPerson(index: NameIndex, people: ExistingPerson[], name: string): { person?: ExistingPerson; ambiguous?: boolean } {
  const hit = index.find(name);
  if (hit.person) return { person: people.find((p) => p.id === hit.person!.id) };
  const w = normName(name).split(" ");
  const sameSurname = people.filter((p) => normName(p.fullName).split(" ")[0] === w[0]);
  if (sameSurname.length === 1 && w[1]) {
    const p = sameSurname[0]!;
    const first = normName(p.fullName).split(" ")[1] ?? "";
    const short = normName(p.shortName);
    if (first.startsWith(w[1]) || w[1].startsWith(first) || short === w[1]) return { person: p };
  }
  return hit.ambiguous || sameSurname.length > 1 ? { ambiguous: true } : {};
}

export function planStructure(rows: ImportRow[], problems: ImportProblem[], existingUnits: string[], people: ExistingPerson[]): StructurePlan {
  const index = new NameIndex(people);
  const plannedUnits = new Map<string, string[]>();
  for (const r of rows) for (let d = 1; d <= r.path.length; d++) plannedUnits.set(pathKey(r.path.slice(0, d)), r.path.slice(0, d));
  const existing = new Set(existingUnits);
  const out: StructurePlan = {
    units: {
      add: [...plannedUnits.entries()].filter(([k]) => !existing.has(k)).map(([, p]) => p.join(" / ")),
      keep: [...plannedUnits.keys()].filter((k) => existing.has(k)).length,
      remove: existingUnits.filter((k) => !plannedUnits.has(k)),
    },
    people: { add: [], change: [], same: 0, missing: [] },
    vacancies: rows.filter((r) => r.vacancy).map((r) => ({ path: r.path, position: r.position })),
    problems: [...problems],
    planned: [],
  };
  const seen = new Map<string, number>();
  // Руководителя пишут и с отчеством, и без: сравниваем фамилию и имя
  const fileKeys = new Set(rows.filter((r) => !r.vacancy).map((r) => nameKey2(r.name)));
  const knownName = (name: string) => fileKeys.has(nameKey2(name)) || !!matchPerson(index, people, name).person;

  for (const r of rows) {
    if (r.vacancy) continue;
    const hit = matchPerson(index, people, r.name);
    if (hit.ambiguous) {
      out.problems.push({ line: r.line, text: `«${r.name}»: похоже на нескольких людей ресурса или на знакомую фамилию с другим именем. Напишите ФИО так, как в «Людях и ролях»` });
      continue;
    }
    const key = hit.person?.id ?? normName(r.name);
    if (seen.has(key)) {
      out.problems.push({ line: r.line, text: `«${r.name}» уже есть в строке ${seen.get(key)}: человек может быть в структуре только один раз` });
      continue;
    }
    seen.set(key, r.line);
    for (const [label, value] of [["Руководитель", r.manager], ["Функциональный руководитель", r.functional]] as const) {
      if (value && !knownName(value)) out.problems.push({ line: r.line, text: `${label} «${value}» не найден ни в файле, ни среди людей ресурса` });
    }
    const { fullName, shortName } = hit.person ? { fullName: hit.person.fullName, shortName: hit.person.shortName } : personNameFromBord(r.name);
    const planned: PlannedPerson = {
      line: r.line,
      id: hit.person?.id ?? null,
      fullName,
      shortName,
      position: r.position,
      path: r.path,
      head: r.head,
      managerName: r.manager,
      functionalName: r.functional,
      email: r.email,
      changes: [],
    };
    if (hit.person) {
      const p = hit.person;
      const unit = r.path.length ? r.path.join(" / ") : "департамент";
      if ((p.position ?? "") !== r.position) planned.changes.push(`должность: ${p.position || "нет"}, станет ${r.position || "нет"}`);
      if (pathKey(r.path) !== (p.unitPath ?? "")) planned.changes.push(`подразделение: станет ${unit}`);
      if (r.manager && nameKey2(p.manager ?? "") !== nameKey2(r.manager)) planned.changes.push(`руководитель: станет ${r.manager}`);
      if (r.functional && nameKey2(p.functional ?? "") !== nameKey2(r.functional)) planned.changes.push(`функциональный руководитель: станет ${r.functional}`);
      if (r.email && r.email !== (p.email ?? "")) planned.changes.push(`почта: станет ${r.email}`);
      if (!p.active) planned.changes.push("снова включён");
      if (planned.changes.length) out.people.change.push(planned);
      else out.people.same += 1;
    } else {
      out.people.add.push(planned);
    }
    out.planned.push(planned);
  }
  const matched = new Set(out.planned.map((p) => p.id).filter(Boolean));
  out.people.missing = people.filter((p) => p.active && p.unitPath !== null && !matched.has(p.id)).map((p) => ({ slug: p.slug, fullName: p.fullName }));
  return out;
}
