// Дерево подчинённых (этап 34): люди департамента по полю «Руководитель» из структуры. Видят все, как и структуру.
// Кадровых полей нет: должность, подразделение, руководители, команды. Вакансии подразделения видны руководителям
// этой ветки, владельцу и администраторам, как на странице подразделений

import { prisma } from "@/lib/db";
import { loadScope, type ScopeSubject } from "@/lib/org/scope";

export type TreePerson = {
  slug: string;
  fullName: string;
  position: string | null;
  unit: string | null;
  /** Административный руководитель в дереве: null у корня */
  manager: string | null;
  /** Функциональный руководитель: видит работу, но не управляет задачами */
  functional: string | null;
  /** Прямые подчинённые по порядку */
  reports: string[];
  /** Всего людей ниже, включая подчинённых подчинённых */
  total: number;
  /** Глубина от корня */
  depth: number;
  /** Команды, которыми человек руководит, и где он участник */
  leads: { id: string; name: string }[];
  memberOf: { id: string; name: string }[];
  /** Открытые вакансии подразделений, которыми он руководит. null: не видны этому человеку */
  vacancies: string[] | null;
  /** Задачи и цели этого человека видны смотрящему: свои, люди его команд и команд ниже, функциональные, управление */
  work: boolean;
};

export type PeopleTree = {
  people: Record<string, TreePerson>;
  /** Корни: люди без руководителя в дереве. Первым руководитель департамента */
  roots: string[];
  /** Сколько людей с руководителем вне дерева или в петле: поставлены в корни */
  orphans: number;
  /** С кого начинать: я, если у меня есть подчинённые, иначе мой руководитель, иначе первый корень */
  start: string | null;
  /** Структура загружена: есть хоть у кого-то руководитель */
  loaded: boolean;
};

export async function peopleTree(viewer: ScopeSubject): Promise<PeopleTree> {
  const [people, teams, units, vacancies, scope] = await Promise.all([
    prisma.person.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { fullName: "asc" }],
      select: { id: true, slug: true, fullName: true, position: true, managerId: true, functionalManagerId: true, unit: { select: { name: true, active: true } } },
    }),
    prisma.team.findMany({ where: { active: true }, select: { id: true, name: true, leaderId: true, members: { select: { personId: true } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.orgUnit.findMany({ where: { active: true }, select: { id: true, headId: true, parentId: true, kind: true } }),
    prisma.vacancy.findMany({ where: { closedAt: null }, select: { unitId: true, position: true }, orderBy: { createdAt: "asc" } }),
    loadScope(prisma, viewer),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const slugOf = (id: string | null) => (id ? (byId.get(id)?.slug ?? null) : null);

  // Руководитель вне активных людей или петля (А под Б, Б под А): человек встаёт в корни, чтобы его было видно.
  // Из петли выходят только её участники: кто под петлёй, остаётся под своим руководителем
  const managerOf = new Map<string, string | null>();
  let orphans = 0;
  const upOf = (id: string) => {
    const m = byId.get(id)?.managerId ?? null;
    return m && m !== id && byId.has(m) ? m : null;
  };
  for (const p of people) {
    let m = upOf(p.id);
    if (p.managerId && !m) orphans += 1;
    const seen = new Set<string>();
    for (let cur = m; cur; cur = upOf(cur)) {
      if (cur === p.id) {
        m = null;
        orphans += 1;
        break;
      }
      if (seen.has(cur)) break;
      seen.add(cur);
    }
    managerOf.set(p.id, m);
  }

  const reports = new Map<string, string[]>();
  for (const p of people) {
    const m = managerOf.get(p.id);
    if (m) reports.set(m, [...(reports.get(m) ?? []), p.id]);
  }
  // Сначала руководители (у кого есть подчинённые), потом по алфавиту
  const order = (ids: string[]) =>
    [...ids].sort((a, b) => Number(reports.has(b)) - Number(reports.has(a)) || byId.get(a)!.fullName.localeCompare(byId.get(b)!.fullName, "ru"));

  const totals = new Map<string, number>();
  const total = (id: string, guard = new Set<string>()): number => {
    if (totals.has(id)) return totals.get(id)!;
    if (guard.has(id)) return 0;
    guard.add(id);
    const n = (reports.get(id) ?? []).reduce((s, c) => s + 1 + total(c, guard), 0);
    totals.set(id, n);
    return n;
  };

  // Вакансии: руководителям своей ветки подразделений, владельцу и администраторам. Общий логин без режима управления
  // их не видит, какой бы профиль ни выбрали (как в scope)
  const allVacancies = !viewer.limited && (viewer.role === "OWNER" || viewer.role === "ADMIN");
  const unitChildren = new Map<string, string[]>();
  for (const u of units) if (u.parentId) unitChildren.set(u.parentId, [...(unitChildren.get(u.parentId) ?? []), u.id]);
  const visibleUnits = new Set<string>();
  const mark = (id: string, guard = new Set<string>()) => {
    if (guard.has(id)) return;
    guard.add(id);
    visibleUnits.add(id);
    for (const c of unitChildren.get(id) ?? []) mark(c, guard);
  };
  if (!viewer.limited) for (const u of units) if (u.headId === viewer.id) mark(u.id);
  // Если человек руководит подразделениями в разных ветках, видны вакансии только тех, что в ветке смотрящего
  const vacanciesOf = (personId: string): string[] | null => {
    const headed = units.filter((u) => u.headId === personId);
    if (!headed.length) return [];
    const shown = allVacancies ? headed : headed.filter((u) => visibleUnits.has(u.id));
    if (!shown.length) return null;
    const ids = new Set(shown.map((u) => u.id));
    return vacancies.filter((v) => ids.has(v.unitId)).map((v) => v.position);
  };

  // Чья работа видна смотрящему: те же правила, что у задач (scope)
  const visibleTeams = new Set(scope.visible);
  const workPeople = new Set<string>([viewer.id, ...scope.functional, ...scope.leadPeople]);
  for (const t of teams) if (visibleTeams.has(t.id)) [t.leaderId, ...t.members.map((m) => m.personId)].forEach((id) => id && workPeople.add(id));

  const depthOf = new Map<string, number>();
  const roots = order(people.filter((p) => !managerOf.get(p.id)).map((p) => p.id));
  // Первым руководитель департамента: голова подразделения верхнего уровня
  const head = units.find((u) => u.kind === "DEPARTMENT" && u.headId)?.headId;
  if (head && roots.includes(head)) roots.splice(roots.indexOf(head), 1), roots.unshift(head);
  const walk = (id: string, depth: number, guard = new Set<string>()) => {
    if (guard.has(id)) return;
    guard.add(id);
    depthOf.set(id, depth);
    for (const c of reports.get(id) ?? []) walk(c, depth + 1, guard);
  };
  for (const r of roots) walk(r, 0);

  const out: Record<string, TreePerson> = {};
  for (const p of people) {
    out[p.slug] = {
      slug: p.slug,
      fullName: p.fullName,
      position: p.position,
      // Выключенное подразделение не показываем: человек мог остаться в нём со старой загрузки
      unit: p.unit?.active ? p.unit.name : null,
      manager: slugOf(managerOf.get(p.id) ?? null),
      functional: slugOf(p.functionalManagerId),
      reports: order(reports.get(p.id) ?? []).map((id) => byId.get(id)!.slug),
      total: total(p.id),
      depth: depthOf.get(p.id) ?? 0,
      leads: teams.filter((t) => t.leaderId === p.id).map((t) => ({ id: t.id, name: t.name })),
      memberOf: teams.filter((t) => t.members.some((m) => m.personId === p.id)).map((t) => ({ id: t.id, name: t.name })),
      vacancies: vacanciesOf(p.id),
      work: scope.all || workPeople.has(p.id),
    };
  }
  const me = byId.get(viewer.id);
  const loaded = people.some((p) => managerOf.get(p.id));
  const start = me ? (reports.has(me.id) ? me.slug : (slugOf(managerOf.get(me.id) ?? null) ?? byId.get(roots[0] ?? "")?.slug ?? null)) : (byId.get(roots[0] ?? "")?.slug ?? null);
  return { people: out, roots: roots.map((id) => byId.get(id)!.slug), orphans, start, loaded };
}
