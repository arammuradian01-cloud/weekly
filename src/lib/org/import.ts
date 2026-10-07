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
  managerId: string | null;
  functional: string | null;
  functionalId: string | null;
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
  /**
   * Руководители, найденные по имени: id человека ресурса или «file:строка» для нового человека из этого же файла.
   * null: колонка пустая, руководителем станет руководитель подразделения
   */
  managerKey: string | null;
  functionalKey: string | null;
  email: string;
  /** Что поменяется у человека ресурса: «должность: было, стало» */
  changes: string[];
};

/** Ключ человека в плане: id человека ресурса или «file:строка» нового */
export const plannedKey = (p: Pick<PlannedPerson, "id" | "line">) => p.id ?? `file:${p.line}`;

export type StructurePlan = {
  units: { add: string[]; keep: number; remove: string[] };
  people: { add: PlannedPerson[]; change: PlannedPerson[]; same: number; missing: { slug: string; fullName: string }[] };
  vacancies: { path: string[]; position: string }[];
  problems: ImportProblem[];
  /** Все строки людей в порядке файла: для применения */
  planned: PlannedPerson[];
};

/** Человек по ФИО из файла: точное ФИО, фамилия и имя без отчества, или фамилия плюс короткое имя */
export function matchPerson<T extends NamedPerson>(index: NameIndex, people: T[], name: string): { person?: T; ambiguous?: boolean } {
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

/** existingUnits: пути включённых подразделений ресурса, как их показывать («Управление / Отдел») */
export function planStructure(rows: ImportRow[], problems: ImportProblem[], existingUnits: string[][], people: ExistingPerson[]): StructurePlan {
  const index = new NameIndex(people);
  const plannedUnits = new Map<string, string[]>();
  for (const r of rows) for (let d = 1; d <= r.path.length; d++) plannedUnits.set(pathKey(r.path.slice(0, d)), r.path.slice(0, d));
  const existing = new Set(existingUnits.map((p) => pathKey(p)));
  const out: StructurePlan = {
    units: {
      add: [...plannedUnits.entries()].filter(([k]) => !existing.has(k)).map(([, p]) => p.join(" / ")),
      keep: [...plannedUnits.keys()].filter((k) => existing.has(k)).length,
      remove: [...new Map(existingUnits.map((p) => [pathKey(p), p])).entries()].filter(([k]) => !plannedUnits.has(k)).map(([, p]) => p.join(" / ")),
    },
    people: { add: [], change: [], same: 0, missing: [] },
    vacancies: rows.filter((r) => r.vacancy).map((r) => ({ path: r.path, position: r.position })),
    problems: [...problems],
    planned: [],
  };
  const seen = new Map<string, number>();

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
      managerKey: null,
      functionalKey: null,
      email: r.email,
      changes: [],
    };
    if (hit.person) {
      const p = hit.person;
      const unit = r.path.length ? r.path.join(" / ") : "департамент";
      if ((p.position ?? "") !== r.position) planned.changes.push(`должность: ${p.position || "нет"}, станет ${r.position || "нет"}`);
      if (pathKey(r.path) !== (p.unitPath ?? "")) planned.changes.push(`подразделение: станет ${unit}`);
      if (r.email && r.email !== (p.email ?? "")) planned.changes.push(`почта: станет ${r.email}`);
      if (!p.active) planned.changes.push("снова включён");
      if (planned.changes.length) out.people.change.push(planned);
      else out.people.same += 1;
    } else {
      out.people.add.push(planned);
    }
    out.planned.push(planned);
  }
  // Руководители: ищем одним и тем же способом среди людей ресурса и новых людей из файла. То же самое найдёт загрузка
  const everyone: NamedPerson[] = [
    ...people.map((p) => ({ id: p.id, fullName: p.fullName, shortName: p.shortName })),
    ...out.planned.filter((p) => !p.id).map((p) => ({ id: plannedKey(p), fullName: p.fullName, shortName: p.shortName })),
  ];
  const all = new NameIndex(everyone);
  const byKey = new Map(out.planned.map((p) => [plannedKey(p), p]));
  const nameOfKey = (k: string) => everyone.find((p) => p.id === k)?.fullName ?? k;
  for (const p of out.planned) {
    for (const [label, value, field] of [
      ["Руководитель", p.managerName, "managerKey"],
      ["Функциональный руководитель", p.functionalName, "functionalKey"],
    ] as const) {
      if (!value) continue;
      const hit = matchPerson(all, everyone, value);
      if (hit.ambiguous) out.problems.push({ line: p.line, text: `${label} «${value}» подходит нескольким людям: напишите полное ФИО` });
      else if (!hit.person) out.problems.push({ line: p.line, text: `${label} «${value}» не найден ни в файле, ни среди людей ресурса` });
      else if (hit.person.id === plannedKey(p)) out.problems.push({ line: p.line, text: `${label} не может быть самим человеком` });
      else p[field] = hit.person.id;
    }
    if (p.id) {
      const was = people.find((x) => x.id === p.id)!;
      if (p.managerKey && p.managerKey !== was.managerId) p.changes.push(`руководитель: станет ${nameOfKey(p.managerKey)}`);
      if (p.functionalKey && p.functionalKey !== was.functionalId) p.changes.push(`функциональный руководитель: станет ${nameOfKey(p.functionalKey)}`);
      if (p.changes.length && !out.people.change.includes(p)) {
        out.people.change.push(p);
        out.people.same -= 1;
      }
    }
  }
  // Петли подчинения: А подчиняется Б, Б подчиняется А. Руководителей людей вне файла берём из ресурса
  const managerOf = (k: string): string | null => {
    const planned = byKey.get(k);
    if (planned) return planned.managerKey;
    return people.find((x) => x.id === k)?.managerId ?? null;
  };
  const reported = new Set<string>();
  for (const p of out.planned) {
    const seenChain = new Set<string>([plannedKey(p)]);
    let cur = p.managerKey;
    while (cur) {
      if (seenChain.has(cur)) {
        const loop = [...seenChain].map(nameOfKey).join(", ");
        if (!reported.has(loop)) out.problems.push({ line: p.line, text: `Петля подчинения: ${loop}` });
        reported.add(loop);
        break;
      }
      seenChain.add(cur);
      cur = managerOf(cur);
    }
  }
  const matched = new Set(out.planned.map((p) => p.id).filter(Boolean));
  out.people.missing = people.filter((p) => p.active && p.unitPath !== null && !matched.has(p.id)).map((p) => ({ slug: p.slug, fullName: p.fullName }));
  return out;
}
