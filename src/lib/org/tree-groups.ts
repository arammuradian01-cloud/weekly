// Подчинённые на схеме по подразделениям (этап 57, просьба Арама 21.10: «дорисовать структуру до конца, вместо списка
// всех людей»). Когда руководителей отделов и секторов в файле не отметили, у руководителя управления десятки прямых
// подчинённых. Плоская сетка из 27 карточек не показывает, кто в каком отделе и секторе. Раскладываем прямых
// подчинённых по подразделениям его ветки на всю глубину: управление, отделы, сектора, направления. Без обращения к
// базе: работает в браузере на данных дерева.

import type { PeopleTree, TreePerson, TreeUnit } from "./people-tree";

export type ReportGroup = {
  unit: TreeUnit;
  /** Прямые подчинённые, которые числятся прямо в этом подразделении */
  people: string[];
  children: ReportGroup[];
  /** Людей в ветке группы: сами подчинённые и все, кто под ними */
  total: number;
};

export type GroupedReports = {
  /** Подразделение, которым руководит человек (или его собственное): от него раскладываются группы */
  root: TreeUnit;
  /** Подчинённые прямо в корневом подразделении */
  direct: string[];
  groups: ReportGroup[];
  /** Подчинённые из подразделений вне его ветки или без подразделения */
  other: string[];
};

/** Глубина подразделения от верха структуры: из нескольких подразделений руководителя берём самое верхнее */
function depthOf(units: Record<string, TreeUnit>, id: string): number {
  let d = 0;
  const seen = new Set<string>();
  for (let cur = units[id]?.parentId; cur && !seen.has(cur); cur = units[cur]?.parentId ?? null) {
    seen.add(cur);
    d += 1;
  }
  return d;
}

/**
 * Прямые подчинённые человека по подразделениям. null: раскладывать нечего (подчинённых нет, подразделение не
 * известно или все в одном подразделении), тогда схема показывает обычную сетку
 */
export function groupReports(person: TreePerson, tree: Pick<PeopleTree, "people" | "units">): GroupedReports | null {
  const units = tree.units ?? {};
  if (!person.reports.length) return null;
  const headed = Object.values(units)
    .filter((u) => u.head === person.slug)
    .sort((a, b) => depthOf(units, a.id) - depthOf(units, b.id) || a.order - b.order);
  const root = headed[0] ?? (person.unitId ? units[person.unitId] : undefined);
  if (!root) return null;

  const byUnit = new Map<string, ReportGroup>();
  const top: ReportGroup[] = [];
  const direct: string[] = [];
  const other: string[] = [];
  /** Группа подразделения со всеми родителями до корня. null: подразделение вне ветки корня */
  const groupOf = (unitId: string): ReportGroup | null => {
    const chain: TreeUnit[] = [];
    const seen = new Set<string>();
    for (let cur: TreeUnit | undefined = units[unitId]; cur && !seen.has(cur.id); cur = cur.parentId ? units[cur.parentId] : undefined) {
      if (cur.id === root.id) {
        let parent: ReportGroup | null = null;
        for (const u of chain.reverse()) {
          let g = byUnit.get(u.id);
          if (!g) {
            g = { unit: u, people: [], children: [], total: 0 };
            byUnit.set(u.id, g);
            (parent ? parent.children : top).push(g);
          }
          parent = g;
        }
        return parent;
      }
      seen.add(cur.id);
      chain.push(cur);
    }
    return null;
  };

  for (const slug of person.reports) {
    const r = tree.people[slug];
    if (!r) continue;
    if (!r.unitId) other.push(slug);
    else if (r.unitId === root.id) direct.push(slug);
    else {
      const g = groupOf(r.unitId);
      if (g) g.people.push(slug);
      else other.push(slug);
    }
  }
  if (!top.length) return null;

  const weight = (slug: string) => 1 + (tree.people[slug]?.total ?? 0);
  const finish = (list: ReportGroup[]): ReportGroup[] => {
    for (const g of list) {
      g.children = finish(g.children);
      g.total = g.people.reduce((s, x) => s + weight(x), 0) + g.children.reduce((s, c) => s + c.total, 0);
    }
    return list.sort((a, b) => a.unit.order - b.unit.order);
  };
  return { root, direct, groups: finish(top), other };
}

const KIND_LABELS: Record<string, string> = {
  COMPANY: "Компания",
  DEPARTMENT: "Департамент",
  MANAGEMENT: "Управление",
  DIVISION: "Отдел",
  SECTOR: "Сектор",
  STREAM: "Направление",
  FUNCTION: "Функция",
  EXTERNAL: "Внешняя функция",
};

/** Подпись подразделения без повтора вида (ошибка «Функция Функция: …» из этапа 53) */
export function unitTitle(unit: Pick<TreeUnit, "name" | "kind">): { kind: string | null; name: string } {
  const label = KIND_LABELS[unit.kind] ?? null;
  if (!label) return { kind: null, name: unit.name };
  // Вид уже есть в названии: «Финансовый департамент», «Функция: аналитика», «Отдел аналитики»
  return unit.name.toLowerCase().replace(/ё/g, "е").includes(label.toLowerCase()) ? { kind: null, name: unit.name } : { kind: label, name: unit.name };
}
