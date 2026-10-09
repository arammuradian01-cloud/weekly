// Структура департамента для страницы «Структура» и раздела настроек (этап 14).
// Видят все: это та же схема, что висит у HR. Вакансии видят только руководители своей ветки, владелец и администраторы.

import { prisma } from "@/lib/db";
import type { Role, UnitKind } from "@/generated/prisma/enums";
import { UNIT_KIND_LABELS } from "./service";
import { TOP_TEAM, loadTeamNodes } from "./scope";
import type { TeamRhythm } from "./rhythm";
import { weeklyLights } from "./panel";
import { dbDate, moscowToday } from "@/lib/tasks/dates";

export type UnitView = {
  id: string;
  name: string;
  kind: UnitKind;
  kindLabel: string;
  parentId: string | null;
  depth: number;
  active: boolean;
  head: { slug: string; fullName: string; position: string | null } | null;
  headNote: string | null;
  people: { slug: string; fullName: string; position: string | null; manager: string | null; functional: string | null; role: Role; active: boolean }[];
  /** null: вакансии этому человеку не видны */
  vacancies: string[] | null;
  /** Сколько человек во всей ветке, включая подразделения ниже */
  total: number;
};

export type TeamView = {
  id: string;
  name: string;
  kind: "TOP" | "UNIT" | "CUSTOM";
  leader: { slug: string; fullName: string } | null;
  parentId: string | null;
  unitId: string | null;
  active: boolean;
  members: { slug: string; fullName: string; position: string | null }[];
  openTasks: number;
  /** Открытые задачи со сроком в прошлом */
  overdue: number;
  /** Ритм weekly команды (этап 15) */
  rhythm: TeamRhythm;
  /** Сдача weekly за отчётную неделю: от кого ждём, кто сдал, кто с опозданием, кого нет на неделе */
  weekly: { expected: number; submitted: number; late: number; absent: number; deadline: string; passed: boolean; closed: boolean };
};

export type StructureView = { units: UnitView[]; teams: TeamView[]; unplaced: { slug: string; fullName: string; position: string | null; role: Role }[] };

export async function structureView(viewer: { id: string; role: Role; limited?: boolean }, opts: { includeInactive?: boolean } = {}): Promise<StructureView> {
  const [units, people, vacancies, teams, open, overdue, nodes] = await Promise.all([
    prisma.orgUnit.findMany({ where: opts.includeInactive ? {} : { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { head: { select: { slug: true, fullName: true, position: true } } } }),
    prisma.person.findMany({
      where: opts.includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: "asc" }, { fullName: "asc" }],
      include: { manager: { select: { fullName: true } }, functionalManager: { select: { fullName: true } } },
    }),
    prisma.vacancy.findMany({ where: { closedAt: null }, orderBy: { createdAt: "asc" } }),
    prisma.team.findMany({
      where: opts.includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { leader: { select: { slug: true, fullName: true } }, members: { include: { person: { select: { slug: true, fullName: true, position: true, active: true, sortOrder: true } } } } },
    }),
    prisma.task.groupBy({ by: ["teamId"], where: { status: { in: ["IN_PROGRESS", "CLARIFY", "PROPOSED"] }, archivedAt: null }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["teamId"], where: { status: { in: ["IN_PROGRESS", "CLARIFY"] }, archivedAt: null, due: { lt: dbDate(moscowToday()) } }, _count: { _all: true } }),
    loadTeamNodes(prisma),
  ]);
  // Сдача weekly за отчётную неделю по командам (этап 15): тот же счёт, что в панели «Мои команды»
  const lights = await weeklyLights(nodes);
  const weeklyOf = (id: string): TeamView["weekly"] => lights.light(nodes.find((n) => n.id === id)!);
  const overdueByTeam = new Map(overdue.map((o) => [o.teamId, o._count._all]));
  const byId = new Map(units.map((u) => [u.id, u]));
  const children = new Map<string | null, typeof units>();
  for (const u of units) {
    const parent = u.parentId && byId.has(u.parentId) ? u.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), u]);
  }
  // Ветки, где человек руководитель: в них он видит вакансии. Общий логин без режима управления не видит их никогда:
  // профиль в нём выбирают сами, руководителем он не считается (как в scope)
  const allVacancies = !viewer.limited && (viewer.role === "OWNER" || viewer.role === "ADMIN");
  const headed = new Set<string>();
  const ordered: { unit: (typeof units)[number]; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number, underViewer: boolean) => {
    for (const u of children.get(parent) ?? []) {
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      const mine = !viewer.limited && (underViewer || u.headId === viewer.id);
      if (mine) headed.add(u.id);
      ordered.push({ unit: u, depth });
      walk(u.id, depth + 1, mine);
    }
  };
  walk(null, 0, false);
  const peopleOf = new Map<string, typeof people>();
  for (const p of people) if (p.unitId) peopleOf.set(p.unitId, [...(peopleOf.get(p.unitId) ?? []), p]);
  const totals = new Map<string, number>();
  const total = (id: string, guard = new Set<string>()): number => {
    if (totals.has(id)) return totals.get(id)!;
    if (guard.has(id)) return 0;
    guard.add(id);
    const n = (peopleOf.get(id)?.length ?? 0) + (children.get(id) ?? []).reduce((s, c) => s + total(c.id, guard), 0);
    totals.set(id, n);
    return n;
  };
  const openByTeam = new Map(open.map((o) => [o.teamId, o._count._all]));
  return {
    units: ordered.map(({ unit: u, depth }) => ({
      id: u.id,
      name: u.name,
      kind: u.kind,
      kindLabel: UNIT_KIND_LABELS[u.kind],
      parentId: u.parentId,
      depth,
      active: u.active,
      head: u.head,
      headNote: u.headNote,
      people: (peopleOf.get(u.id) ?? []).map((p) => ({ slug: p.slug, fullName: p.fullName, position: p.position, manager: p.manager?.fullName ?? null, functional: p.functionalManager?.fullName ?? null, role: p.role, active: p.active })),
      vacancies: allVacancies || headed.has(u.id) ? vacancies.filter((v) => v.unitId === u.id).map((v) => v.position) : null,
      total: total(u.id),
    })),
    teams: teams
      .map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        leader: t.leader,
        parentId: t.parentId,
        unitId: t.unitId,
        active: t.active,
        members: t.members
          .map((m) => m.person)
          .filter((p) => opts.includeInactive || p.active)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.fullName.localeCompare(b.fullName, "ru"))
          .map((p) => ({ slug: p.slug, fullName: p.fullName, position: p.position })),
        openTasks: openByTeam.get(t.id) ?? 0,
        overdue: overdueByTeam.get(t.id) ?? 0,
        rhythm: nodes.find((n) => n.id === t.id)!.rhythm,
        weekly: weeklyOf(t.id),
      }))
      .sort((a, b) => Number(b.id === TOP_TEAM) - Number(a.id === TOP_TEAM)),
    unplaced: people.filter((p) => !p.unitId && p.active).map((p) => ({ slug: p.slug, fullName: p.fullName, position: p.position, role: p.role })),
  };
}
