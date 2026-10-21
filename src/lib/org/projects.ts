// Weekly-проекты руководителей (этап 57). Решение Арама 21.10: приложение для всей компании. Готовые команды
// департаментов собраны по структуре (страхование и инвестиции, Money, партнёрка и другие), и любой руководитель
// перетаскивает к себе готовую команду или отдельных людей, чтобы собрать свой weekly-проект. Люди своей ветки входят
// сразу, люди из других веток после согласия своего непосредственного руководителя по структуре (как в этапе 53).
//
// Проект это обычная команда со своим weekly и задачами: руководитель проекта ведёт её, видит weekly и задачи
// участников в ней. Проект встаёт под команду, которой руководитель уже руководит по структуре, иначе под топ-команду.

import { prisma } from "@/lib/db";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { TOP_TEAM } from "./scope";
import { addTeamMember } from "./service";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

const NAME_MAX = 120;

/**
 * Кто собирает проекты: руководители (по роли, по команде или по подразделению в структуре), администраторы и
 * владельцы при личном входе. Руководители из загруженной структуры приходят с ролью сотрудника, поэтому для них
 * смотрим, руководят ли они командой или подразделением
 */
export async function canCreateProject(actor: Pick<Actor, "personId" | "role" | "via" | "management">): Promise<boolean> {
  if (actor.role === "OBSERVER") return false;
  if (actor.via === "TEAM" && !actor.management) return false;
  if (actor.role !== "EMPLOYEE") return true;
  const [teams, units] = await Promise.all([
    prisma.team.count({ where: { leaderId: actor.personId, active: true } }),
    prisma.orgUnit.count({ where: { headId: actor.personId, active: true } }),
  ]);
  return teams + units > 0;
}

export type ProjectUnit = { id: string; name: string; kind: string; parentId: string | null; head: string | null; active: boolean };
export type ProjectPerson = { slug: string; fullName: string; position: string | null; unitId: string | null };
export type ProjectView = {
  id: string;
  name: string;
  kind: "UNIT" | "CUSTOM";
  members: { slug: string; fullName: string; external: boolean }[];
  waiting: { slug: string; fullName: string; approver: string }[];
};
export type ProjectsView = { units: ProjectUnit[]; people: ProjectPerson[]; projects: ProjectView[]; canCreate: boolean; me: string };

/** Всё для страницы проектов: подразделения и люди компании, проекты, которыми человек руководит */
export async function projectsView(actor: Actor): Promise<ProjectsView> {
  const [units, people, teams] = await Promise.all([
    prisma.orgUnit.findMany({ where: { active: true }, select: { id: true, name: true, kind: true, parentId: true, active: true, head: { select: { slug: true } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.person.findMany({ where: { active: true, role: { not: "OBSERVER" } }, select: { slug: true, fullName: true, position: true, unitId: true }, orderBy: [{ fullName: "asc" }] }),
    prisma.team.findMany({
      // Топ-команду собирают на странице структуры в режиме управления, здесь только свои команды и проекты
      where: { leaderId: actor.personId, active: true, kind: { not: "TOP" } },
      select: {
        id: true,
        name: true,
        kind: true,
        members: { select: { external: true, person: { select: { slug: true, fullName: true, active: true } } } },
        joinRequests: { where: { status: "PENDING" }, select: { person: { select: { slug: true, fullName: true } }, approver: { select: { fullName: true } } } },
      },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
    }),
  ]);
  return {
    units: units.map((u) => ({ id: u.id, name: u.name, kind: u.kind, parentId: u.parentId, head: u.head?.slug ?? null, active: u.active })),
    people,
    projects: teams.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind as ProjectView["kind"],
      members: t.members.filter((m) => m.person.active).map((m) => ({ slug: m.person.slug, fullName: m.person.fullName, external: m.external })).sort((a, b) => a.fullName.localeCompare(b.fullName, "ru")),
      waiting: t.joinRequests.map((r) => ({ slug: r.person.slug, fullName: r.person.fullName, approver: r.approver.fullName })),
    })),
    canCreate: await canCreateProject(actor),
    me: actor.slug,
  };
}

/** Люди подразделения со всеми подразделениями ниже: при перетаскивании целой команды */
export async function unitPeople(unitId: string): Promise<string[]> {
  const units = await prisma.orgUnit.findMany({ where: { active: true }, select: { id: true, parentId: true } });
  const below = new Set<string>([unitId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units) if (u.parentId && below.has(u.parentId) && !below.has(u.id)) {
      below.add(u.id);
      grew = true;
    }
  }
  const people = await prisma.person.findMany({ where: { active: true, role: { not: "OBSERVER" }, unitId: { in: [...below] } }, select: { slug: true } });
  return people.map((p) => p.slug);
}

/** Новый weekly-проект: команда, которой руководит тот, кто её собирает */
export async function createProject(actor: Actor, input: { name: string }): Promise<{ id: string; name: string }> {
  if (!(await canCreateProject(actor))) fail(actor.via === "TEAM" && !actor.management ? "Проект собирают, войдя лично, со своим логином и паролем" : "Проекты собирают руководители");
  const name = String(input?.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) fail("Напишите название проекта");
  if (name.length > NAME_MAX) fail(`Название длиннее ${NAME_MAX} знаков`);
  return prisma.$transaction(async (tx) => {
    const same = await tx.team.findFirst({ where: { leaderId: actor.personId, active: true, name } });
    if (same) fail(`Проект «${name}» у вас уже есть`);
    // Под команду, которой человек руководит по структуре: её руководитель выше видит проект в дереве команд
    const own = await tx.team.findFirst({ where: { leaderId: actor.personId, active: true, kind: { in: ["TOP", "UNIT"] } }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }], select: { id: true } });
    const count = await tx.team.count();
    const team = await tx.team.create({ data: { name, kind: "CUSTOM", leaderId: actor.personId, parentId: own?.id ?? TOP_TEAM, sortOrder: (count + 1) * 10 } });
    await tx.auditLog.create({
      data: { action: "team.create", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "team", entityId: team.id, field: "Weekly-проект создан", after: `${name}, руководитель ${actor.fullName}`, ip: actor.ip ?? null, via: actor.via ?? null },
    });
    return { id: team.id, name };
  });
}

export type AddPeopleResult = { added: string[]; requested: { name: string; approver: string }[]; skipped: { name: string; reason: string }[] };

/**
 * Люди в проект пачкой: каждый по правилам этапа 53 (своя ветка сразу, чужая с согласия руководителя). Ошибка одного
 * не останавливает остальных: такие люди возвращаются с причиной
 */
export async function addProjectPeople(actor: Actor, teamId: string, slugs: string[]): Promise<AddPeopleResult> {
  const list = [...new Set((Array.isArray(slugs) ? slugs : []).map(String))].slice(0, 600);
  if (!list.length) fail("Выберите людей");
  const names = new Map((await prisma.person.findMany({ where: { slug: { in: list } }, select: { slug: true, fullName: true } })).map((p) => [p.slug, p.fullName]));
  const out: AddPeopleResult = { added: [], requested: [], skipped: [] };
  for (const slug of list) {
    const name = names.get(slug) ?? slug;
    try {
      const r = await addTeamMember(actor, teamId, slug);
      if (r.added) out.added.push(name);
      else out.requested.push({ name, approver: r.pendingWith ?? "" });
    } catch (error) {
      if (!(error instanceof TaskRuleError)) throw error;
      // Нет права на саму команду: дальше пробовать бессмысленно
      if (/меняют её руководитель|войдя лично|Наблюдатель команды/.test(error.message)) throw error;
      out.skipped.push({ name, reason: error.message });
    }
  }
  return out;
}
