// Weekly-команды (этап 64). Решение Арама 22.10: управление командами было размазано по «Структуре» (вкладка
// «Команды») и «Weekly-проектам», теперь один экран «Люди», «Weekly-команды». Здесь всё для экрана: список команд,
// которые человек видит, права на каждую по правилам сервисов, люди для поиска и тонкие обёртки над сервисами
// команд и проектов. Новых правил нет: добавляют людей addProjectPeople (этап 57, согласие руководителя по этапу 53),
// убирают removeTeamMember, переименовывают и закрывают renameProject и closeProject для проектов и updateTeam
// владельцем для остальных команд. Каждая правка пишется в журнал теми же сервисами.
//
// Кто что видит в списке:
// - владелец и администратор в режиме управления: все команды компании;
// - руководитель: команды, которыми он руководит (по структуре и свои проекты), команды ниже своих (им он задаёт
//   ритм weekly) и команды, где он участник;
// - остальные: команды, где они участники, только для просмотра;
// - общий логин без режима управления: как в остальном ресурсе, только топ-команда и только просмотр.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { canManagePeople } from "@/lib/admin/service";
import * as org from "./service";
import * as projects from "./projects";
import { TOP_TEAM, loadTeamNodes, orderTeams, scopeOf } from "./scope";
import { weeklyLights, type WeeklyLight } from "./panel";
import type { TeamRhythm } from "./rhythm";
import { canCancelRequest, sortTeams, teamRights, type ManagementOff, type ParentChoice, type RightsSubject, type TeamRelation, type TeamRights } from "./team-rights";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

const OPEN = ["IN_PROGRESS", "CLARIFY", "PROPOSED"] as const;

export type TeamPerson = { slug: string; fullName: string; position: string | null; unit: string | null };
export type TeamMemberView = TeamPerson & { external: boolean; auto: boolean };
export type TeamWaitingView = { id: string; slug: string; fullName: string; approver: string; requestedBy: string | null; canCancel: boolean };

export type WeeklyTeam = {
  id: string;
  name: string;
  kind: "TOP" | "UNIT" | "CUSTOM";
  /** Weekly-проект руководителя (этап 57): его переименовывает и закрывает сам руководитель */
  project: boolean;
  active: boolean;
  leader: TeamPerson | null;
  parent: { id: string; name: string } | null;
  /** Участники без руководителя, по алфавиту */
  members: TeamMemberView[];
  /** Ждут согласия своего руководителя. Видят руководитель команды, тот, кто просил, согласующий и владелец */
  waiting: TeamWaitingView[];
  rhythm: TeamRhythm;
  /** Сдача weekly за отчётную неделю: тот же счёт, что в «Структуре» и панели руководителя */
  weekly: WeeklyLight;
  openTasks: number;
  relation: TeamRelation;
  rights: TeamRights;
};

/** Человек для поиска при добавлении. manager: короткое имя руководителя, по нему экран помечает «другая ветка» */
export type PickPerson = TeamPerson & { unitId: string | null; manager: string | null };
/** Подразделение для помощника «Собрать из структуры» */
export type PickUnit = { id: string; name: string; kind: string; parentId: string | null; head: string | null };

export type JoinRequestView = org.JoinRequestView;

export type WeeklyTeamsView = {
  teams: WeeklyTeam[];
  /** Закрытые команды: владелец может вернуть */
  closed: { id: string; name: string; kind: "TOP" | "UNIT" | "CUSTOM" }[];
  /** Люди компании для поиска: только тем, кто может добавлять людей или собирать команды */
  people: PickPerson[];
  units: PickUnit[];
  /** Команды для выбора «Команда выше»: владельцу. С руководителем и командой выше: поиск и без команд ниже (этап 70) */
  parents: ParentChoice[];
  /** Кто может руководить топ-командой: владельцы ресурса */
  owners: string[];
  /** Ваших сотрудников зовут в команды других веток: решаете вы */
  toApprove: JoinRequestView[];
  mode: "all" | "mine" | "shared";
  /** Владелец в режиме управления: люди других веток входят сразу, команды можно пересобрать по структуре */
  owner: boolean;
  /** Режим управления доступен, но выключен: экран объясняет, что в нём станет видно и доступно */
  managementOff: ManagementOff;
  canCreate: boolean;
  me: string;
};

const teamSelect = {
  id: true,
  name: true,
  kind: true,
  project: true,
  active: true,
  leaderId: true,
  parentId: true,
  leader: { select: { slug: true, fullName: true, position: true, unit: { select: { name: true, active: true } } } },
  members: { select: { personId: true, external: true, auto: true, person: { select: { slug: true, fullName: true, position: true, active: true, unit: { select: { name: true, active: true } } } } } },
  joinRequests: {
    where: { status: "PENDING" as const },
    orderBy: { createdAt: "asc" as const },
    select: { id: true, requestedById: true, approverId: true, person: { select: { slug: true, fullName: true } }, approver: { select: { fullName: true } }, requestedBy: { select: { fullName: true } } },
  },
} as const;

type UnitRef = { name: string; active: boolean } | null;
const unitName = (u: UnitRef) => (u?.active ? u.name : null);

type TeamRow = Prisma.TeamGetPayload<{ select: typeof teamSelect }>;

/** Кто смотрит и дерево команд: общее для списка и для команды из адреса */
async function viewContext(actor: Actor) {
  const shared = actor.via === "TEAM" && !actor.management;
  const owner = canManagePeople(actor);
  const nodes = await loadTeamNodes(prisma);
  // Общий логин без режима управления видит только топ-команду и ничем не руководит (как везде в ресурсе)
  const scope = scopeOf(nodes, { id: actor.personId, role: actor.role, limited: shared });
  const personal = !shared && actor.role !== "OBSERVER";
  const subject: RightsSubject = { me: actor.personId, owner, personal, leads: new Set(scope.leads) };
  return { actor, shared, owner, personal, all: actor.role !== "OBSERVER" && actor.management !== null, nodes, scope, subject };
}
type ViewContext = Awaited<ReturnType<typeof viewContext>>;

/** Команда для экрана: состав, ждущие согласия, сдача weekly и права по правилам сервисов */
function teamOf(ctx: ViewContext, row: TeamRow, parent: { id: string; name: string } | null, light: WeeklyLight, openTasks: number): WeeklyTeam {
  const { actor, shared, owner, subject } = ctx;
  const node = ctx.nodes.find((n) => n.id === row.id)!;
  // Ждущих согласия видят те же, кому их показывали раньше: руководитель команды, просивший, согласующий, владелец
  const seesWaiting = (r: TeamRow["joinRequests"][number]) => !shared && (owner || row.leaderId === actor.personId || r.approverId === actor.personId || r.requestedById === actor.personId);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    project: row.project,
    active: row.active,
    leader: row.leader ? { slug: row.leader.slug, fullName: row.leader.fullName, position: row.leader.position, unit: unitName(row.leader.unit) } : null,
    parent,
    members: row.members
      .filter((m) => m.person.active && m.personId !== row.leaderId)
      .map((m) => ({ slug: m.person.slug, fullName: m.person.fullName, position: m.person.position, unit: unitName(m.person.unit), external: m.external, auto: m.auto }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "ru")),
    waiting: row.joinRequests.filter(seesWaiting).map((r) => ({
      id: r.id,
      slug: r.person.slug,
      fullName: r.person.fullName,
      approver: r.approver.fullName,
      requestedBy: r.requestedBy?.fullName ?? null,
      canCancel: canCancelRequest(subject, row, r.requestedById),
    })),
    rhythm: node.rhythm,
    weekly: light,
    openTasks,
    relation: row.leaderId === actor.personId ? "leader" : subject.leads.has(row.id) ? "below" : row.members.some((m) => m.personId === actor.personId) ? "member" : "other",
    // Права всегда по правилам сервисов, и для команды из адреса: руководитель выше задаёт ритм и по ссылке
    rights: teamRights(subject, row),
  };
}

/**
 * Всё для экрана «Weekly-команды», кроме выбранной команды. Не зависит от адреса: его считает layout экрана, и смена
 * команды в адресе его не пересчитывает (этап 70). Выбранную команду считает страница (focusTeam)
 */
export async function teamsView(actor: Actor): Promise<WeeklyTeamsView> {
  const ctx = await viewContext(actor);
  const { shared, owner, personal, all, nodes, scope } = ctx;
  const [rows, open, canCreate] = await Promise.all([
    prisma.team.findMany({ select: teamSelect, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.task.groupBy({ by: ["teamId"], where: { status: { in: [...OPEN] }, archivedAt: null }, _count: { _all: true } }),
    projects.canCreateProject(actor),
  ]);
  const active = nodes.filter((n) => n.active);
  // Команды ниже своих тоже в списке: их руководитель задаёт им ритм weekly (setTeamRhythm, scope.leads)
  const mine = new Set([...scope.member, ...scope.leads]);
  const listed = orderTeams(all ? active : active.filter((n) => mine.has(n.id))).map((x) => x.node);
  const lights = listed.length ? await weeklyLights(nodes) : null;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const openBy = new Map(open.map((o) => [o.teamId, o._count._all]));
  const parentOf = (row: TeamRow) => {
    const parent = row.parentId ? byId.get(row.parentId) : undefined;
    return parent ? { id: parent.id, name: parent.name } : null;
  };

  const teams = sortTeams(listed.map((n) => byId.get(n.id)!).map((row) => teamOf(ctx, row, parentOf(row), lights!.light(nodes.find((n) => n.id === row.id)!), openBy.get(row.id) ?? 0)));
  // Люди и подразделения нужны только тем, кто добавляет людей или собирает команды: остальным не отправляем
  const picks = canCreate || teams.some((t) => t.rights.members);
  const [people, units, toApprove] = await Promise.all([
    picks
      ? prisma.person.findMany({
          where: { active: true, role: { not: "OBSERVER" } },
          select: { slug: true, fullName: true, position: true, role: true, unitId: true, unit: { select: { name: true, active: true } }, manager: { select: { slug: true } } },
          orderBy: [{ fullName: "asc" }],
        })
      : Promise.resolve([]),
    picks ? prisma.orgUnit.findMany({ where: { active: true }, select: { id: true, name: true, kind: true, parentId: true, head: { select: { slug: true } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }) : Promise.resolve([]),
    // Решение по запросу принимают, войдя лично: под общим логином профиль выбирают сами
    personal ? org.joinRequestsFor(actor).then((r) => r.toApprove) : Promise.resolve([]),
  ]);
  const owners = owner ? (await prisma.person.findMany({ where: { active: true, role: "OWNER" }, select: { slug: true } })).map((p) => p.slug) : [];
  // «Команда выше» (этап 70): все команды, и закрытые тоже. Закрытую выбрать нельзя, но через неё идёт ветка: команда
  // под закрытой командой ниже выбираемой всё равно ниже неё, сервер такое кольцо не пропустит (subtreeOf)
  const parents = owner
    ? [...orderTeams(active), ...orderTeams(nodes.filter((n) => !n.active))].map(({ node }) => ({ id: node.id, name: node.name, parentId: node.parentId, leader: byId.get(node.id)?.leader?.fullName ?? null, active: node.active }))
    : [];
  return {
    teams,
    closed: owner ? rows.filter((r) => !r.active).map((r) => ({ id: r.id, name: r.name, kind: r.kind })) : [],
    people: people.map((p) => ({ slug: p.slug, fullName: p.fullName, position: p.position, unit: unitName(p.unit), unitId: p.unitId, manager: p.manager?.slug ?? null })),
    units: units.map((u) => ({ id: u.id, name: u.name, kind: u.kind, parentId: u.parentId, head: u.head?.slug ?? null })),
    parents,
    owners,
    toApprove,
    mode: shared ? "shared" : all ? "all" : "mine",
    owner,
    managementOff: actor.management ? null : actor.role === "OWNER" ? "owner" : actor.role === "ADMIN" ? "admin" : null,
    canCreate,
    me: actor.slug,
  };
}

/**
 * Команда из адреса (?team=) для карточки: свежие данные одной команды, в том числе той, которой нет в списке
 * человека (ссылка из «Мне»: только просмотр, права те же, что везде). Закрытой или неизвестной команды нет. Смена
 * команды на экране пересчитывает только это, а не весь экран (этап 70)
 */
export async function focusTeam(actor: Actor, id: string): Promise<WeeklyTeam | null> {
  const ctx = await viewContext(actor);
  const node = ctx.nodes.find((n) => n.id === id && n.active);
  if (!node) return null;
  const [row, openTasks, lights] = await Promise.all([
    prisma.team.findUnique({ where: { id }, select: teamSelect }),
    prisma.task.count({ where: { teamId: id, status: { in: [...OPEN] }, archivedAt: null } }),
    weeklyLights(ctx.nodes),
  ]);
  if (!row) return null;
  const parent = row.parentId ? ctx.nodes.find((n) => n.id === row.parentId) : undefined;
  return teamOf(ctx, row, parent ? { id: parent.id, name: parent.name } : null, lights.light(node), openTasks);
}

export type CreatedTeam = { id: string; name: string; result: projects.AddPeopleResult | null; /** Другой руководитель, если его сразу назначили */ leader: string | null };

/**
 * Новая команда сразу с людьми одной транзакцией (createProjectWith). Владелец в режиме управления может сразу
 * назначить другого руководителя: команда создаётся с ним, место в дереве и ветка людей считаются по нему
 */
export async function createTeam(actor: Actor, name: string, slugs: string[], leader?: string | null): Promise<CreatedTeam> {
  const other = leader && leader !== actor.slug ? String(leader) : null;
  const created = await projects.createProjectWith(actor, name, slugs, { leader: other });
  return { id: created.id, name: created.name, result: created.result, leader: other ? created.leader : null };
}

async function liveTeam(teamId: string) {
  const team = await prisma.team.findUnique({ where: { id: String(teamId) }, select: { id: true, name: true, project: true, active: true } });
  if (!team || !team.active) fail("Такой команды нет или она закрыта");
  return team!;
}

/** Переименовать: свой проект через сервис проектов (руководитель или владелец), остальные команды правкой владельца */
export async function renameTeam(actor: Actor, teamId: string, name: string): Promise<{ id: string; name: string }> {
  const team = await liveTeam(teamId);
  if (team.project) return projects.renameProject(actor, team.id, name);
  await org.updateTeam(actor, team.id, { name });
  const after = await prisma.team.findUniqueOrThrow({ where: { id: team.id }, select: { name: true } });
  return { id: team.id, name: after.name };
}

/** Закрыть: свой проект через сервис проектов, остальные команды выключает владелец. Ожидающие запросы отменяются в обоих случаях */
export async function closeTeam(actor: Actor, teamId: string): Promise<void> {
  const team = await liveTeam(teamId);
  if (team.project) return projects.closeProject(actor, team.id);
  if (team.id === TOP_TEAM) fail(`Команду «${team.name}» закрыть нельзя`);
  await org.updateTeam(actor, team.id, { active: false });
}
