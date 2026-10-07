// Панель «Мои команды» (этап 16): руководитель за пару минут видит, что с задачами его людей.
// По своей команде и командам на уровень ниже: сдача weekly, в работе, просрочено, требует уточнений, давно не обновлялись.
// По людям выбранной команды: открытые задачи, просрочка, переносы срока за месяц, просьбы к человеку.
// «Требует внимания»: до семи задач поддерева, которые просрочены, заблокированы или давно не обновлялись.

import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { dbDate, isoFromDbDate, moscowToday } from "@/lib/tasks/dates";
import { currentReportingKey, weekSettings } from "@/lib/weekly/service";
import { deadlineOf, weekNumberOf } from "@/lib/weekly/weeks";
import { diffDays, type IsoDate } from "@/domain/dates";
import type { PersonSlug } from "@/domain/types";
import { ancestorsOf, loadTeamNodes, scopeOf, subtreeOf, TOP_TEAM, type ScopeSubject, type TeamNode } from "./scope";
import { expectedOf, expectingTeams, leadersOf, teamDeadline } from "./rhythm";
import { seesTask } from "@/lib/tasks/watch";

export type WeeklyLight = { expected: number; submitted: number; late: number; absent: number; deadline: string; passed: boolean; closed: boolean };

export type PanelTask = {
  number: number;
  title: string;
  status: "proposed" | "in-progress" | "clarify";
  blocked: boolean;
  atRisk: boolean;
  due: IsoDate;
  /** Дней просрочки, 0: не просрочена */
  overdue: number;
  stale: boolean;
  owner: PersonSlug | null;
  ownerName: string;
  team: string;
  teamName: string;
  /** Можно попросить ответственного обновить задачу */
  canAsk: boolean;
};

export type PanelTeam = {
  id: string;
  name: string;
  leader: { slug: PersonSlug; fullName: string } | null;
  /** Своя команда или команда уровнем ниже */
  level: "self" | "below";
  people: number;
  weekly: WeeklyLight;
  inWork: number;
  overdue: number;
  clarify: number;
  stale: number;
  proposed: number;
  /** Сколько команд ещё ниже: в них можно спуститься */
  below: number;
};

export type PanelPerson = {
  slug: PersonSlug;
  fullName: string;
  position: string | null;
  leader: boolean;
  /** Состояние weekly за отчётную неделю. optional: weekly от него нигде не ждут */
  weekly: { state: "submitted" | "late" | "draft" | "not-started"; optional: boolean; absent: boolean };
  open: number;
  overdue: number;
  stale: number;
  /** Переносы срока его задач за последние 30 дней */
  transfers: number;
  /** Предложенные ему задачи, которые ещё не приняли */
  requests: number;
  tasks: PanelTask[];
};

export type Panel = {
  team: { id: string; name: string };
  /** Путь по командам сверху вниз. link: команду можно открыть в панели */
  path: { id: string; name: string; link: boolean }[];
  teams: PanelTeam[];
  people: PanelPerson[];
  attention: PanelTask[];
  staleDays: number;
  reportingNumber: number;
};

const OPEN = ["PROPOSED", "IN_PROGRESS", "CLARIFY"] as const;
const STATUS = { PROPOSED: "proposed", IN_PROGRESS: "in-progress", CLARIFY: "clarify" } as const;
const ATTENTION = 7;

/** Какую команду открыть: запрошенную, если видна, иначе первую свою, иначе топ-команду */
export function pickPanelTeam(nodes: TeamNode[], visible: Set<string>, personId: string, requested: string | null | undefined): string | null {
  const active = nodes.filter((n) => n.active && visible.has(n.id));
  if (requested && active.some((n) => n.id === requested)) return requested;
  const led = active.find((n) => n.leaderId === personId && n.id !== TOP_TEAM);
  if (led) return led.id;
  if (active.some((n) => n.id === TOP_TEAM)) return TOP_TEAM;
  return active.find((n) => n.members.includes(personId))?.id ?? active[0]?.id ?? null;
}

/** Сдача weekly за отчётную неделю по командам: тот же счёт, что на странице «Структура» */
export async function weeklyLights(nodes: TeamNode[]) {
  const [reporting, settings, people] = await Promise.all([
    currentReportingKey(),
    weekSettings(),
    prisma.person.findMany({ where: { active: true, role: { not: "OBSERVER" } }, select: { id: true } }),
  ]);
  const week = await prisma.week.findUnique({
    where: { start: dbDate(reporting) },
    include: { reports: { select: { authorId: true, state: true } }, absences: { select: { personId: true } }, teamCloses: { select: { teamId: true } } },
  });
  const leaders = leadersOf(nodes);
  const now = Date.now();
  const department = week?.deadline ?? deadlineOf(reporting, settings.deadline);
  const stateOf = new Map((week?.reports ?? []).map((r) => [r.authorId, r.state]));
  const absent = new Set((week?.absences ?? []).map((a) => a.personId));
  const closedTeams = new Set((week?.teamCloses ?? []).map((c) => c.teamId));
  const counted = new Set(people.map((p) => p.id));
  const sent = (id: string) => stateOf.get(id) === "SUBMITTED" || stateOf.get(id) === "LATE";
  const light = (node: TeamNode): WeeklyLight => {
    const expected = expectedOf(node, leaders).filter((id) => counted.has(id));
    const inCount = expected.filter((id) => !absent.has(id) || sent(id));
    const deadline = teamDeadline(reporting, node, department);
    return {
      expected: inCount.length,
      submitted: inCount.filter((id) => stateOf.get(id) === "SUBMITTED").length,
      late: inCount.filter((id) => stateOf.get(id) === "LATE").length,
      absent: expected.filter((id) => absent.has(id) && !sent(id)).length,
      deadline: deadline.toISOString(),
      passed: now > deadline.getTime(),
      closed: !!week?.closedAt || closedTeams.has(node.id),
    };
  };
  const personState = (id: string): PanelPerson["weekly"] => {
    const s = stateOf.get(id);
    return {
      state: s === "SUBMITTED" ? "submitted" : s === "LATE" ? "late" : s === "DRAFT" ? "draft" : "not-started",
      optional: expectingTeams(id, nodes, leaders).length === 0,
      absent: absent.has(id),
    };
  };
  return { reporting, light, personState };
}

export async function teamPanel(subject: ScopeSubject & { management?: boolean }, requested: string | null | undefined, today: IsoDate = moscowToday()): Promise<Panel | null> {
  const [nodes, functional, staleDays] = await Promise.all([
    loadTeamNodes(prisma),
    prisma.person.findMany({ where: { functionalManagerId: subject.id }, select: { id: true } }),
    getSetting<number>("tasks.staleDays", 14),
  ]);
  const scope = scopeOf(nodes, subject, functional.map((p) => p.id));
  const visible = new Set(scope.all ? nodes.map((n) => n.id) : scope.visible);
  const id = pickPanelTeam(nodes, visible, subject.id, requested);
  if (!id) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const selected = byId.get(id)!;
  const children = nodes.filter((n) => n.active && n.parentId === id && n.id !== id && visible.has(n.id));
  const rows = [selected, ...children];
  const subtree = subtreeOf(nodes, id).filter((t) => visible.has(t));
  const peopleIds = [...new Set([...(selected.leaderId ? [selected.leaderId] : []), ...selected.members])];

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [tasks, people, transfers, lights] = await Promise.all([
    prisma.task.findMany({
      where: { archivedAt: null, status: { in: [...OPEN] }, OR: [{ teamId: { in: subtree } }, { ownerId: { in: peopleIds } }] },
      select: {
        number: true,
        title: true,
        status: true,
        state: true,
        due: true,
        whereUpdatedAt: true,
        teamId: true,
        ownerId: true,
        createdById: true,
        owner: { select: { slug: true, fullName: true } },
        coExecutors: { select: { personId: true } },
      },
      orderBy: { due: "asc" },
    }),
    prisma.person.findMany({ where: { id: { in: peopleIds }, active: true, role: { not: "OBSERVER" } }, select: { id: true, slug: true, fullName: true, position: true, sortOrder: true }, orderBy: [{ sortOrder: "asc" }, { fullName: "asc" }] }),
    prisma.taskTransfer.findMany({
      where: { at: { gte: since30 }, task: { ownerId: { in: peopleIds }, archivedAt: null } },
      select: { task: { select: { ownerId: true, teamId: true, createdById: true, coExecutors: { select: { personId: true } } } } },
    }),
    weeklyLights(nodes),
  ]);

  // Задачи людей из чужих команд показываем только те, что человек видит и так (этап 14): участник, автор, руководитель людей
  const sees = (t: { teamId: string; ownerId: string | null; createdById: string | null; coExecutors: { personId: string }[] }) => seesTask(scope, t, subject.id);
  const seen = tasks.filter(sees);
  const view = (t: (typeof seen)[number]): PanelTask => {
    const due = isoFromDbDate(t.due);
    const late = t.status !== "PROPOSED" ? Math.max(0, diffDays(due, today)) : 0;
    return {
      number: t.number,
      title: t.title,
      status: STATUS[t.status as keyof typeof STATUS],
      blocked: t.state === "BLOCKED",
      atRisk: t.state === "AT_RISK",
      due,
      overdue: late,
      stale: t.status !== "PROPOSED" && diffDays(isoFromDbDate(t.whereUpdatedAt), today) > staleDays,
      owner: (t.owner?.slug as PersonSlug | undefined) ?? null,
      ownerName: t.owner?.fullName ?? "Все лидеры",
      team: t.teamId,
      teamName: byId.get(t.teamId)?.name ?? "Команда",
      canAsk: !!t.ownerId && t.ownerId !== subject.id && t.status !== "PROPOSED" && (!!subject.management || scope.leads.includes(t.teamId) || (t.teamId !== TOP_TEAM && scope.leadPeople.includes(t.ownerId))),
    };
  };
  const all = seen.map((t) => ({ row: t, view: view(t) }));

  const teamRow = (n: TeamNode, level: PanelTeam["level"]): PanelTeam => {
    const inTeam = subtreeOf(nodes, n.id).filter((t) => visible.has(t));
    const own = level === "self" ? all.filter((x) => x.row.teamId === n.id) : all.filter((x) => inTeam.includes(x.row.teamId));
    return {
      id: n.id,
      name: n.name,
      leader: n.leaderId ? leaderOf(n.leaderId) : null,
      level,
      people: new Set([...(n.leaderId ? [n.leaderId] : []), ...n.members]).size,
      weekly: lights.light(n),
      inWork: own.filter((x) => x.view.status === "in-progress").length,
      overdue: own.filter((x) => x.view.overdue > 0).length,
      clarify: own.filter((x) => x.view.status === "clarify").length,
      stale: own.filter((x) => x.view.stale).length,
      proposed: own.filter((x) => x.view.status === "proposed").length,
      below: nodes.filter((c) => c.active && c.parentId === n.id && visible.has(c.id)).length,
    };
  };
  const leaderPeople = await prisma.person.findMany({ where: { id: { in: rows.map((r) => r.leaderId).filter((x): x is string => !!x) } }, select: { id: true, slug: true, fullName: true } });
  const leaderOf = (pid: string) => {
    const p = leaderPeople.find((x) => x.id === pid);
    return p ? { slug: p.slug as PersonSlug, fullName: p.fullName } : null;
  };

  const transfersBy = new Map<string, number>();
  // Переносы только по задачам, которые руководитель и так видит
  for (const t of transfers) if (t.task.ownerId && sees(t.task)) transfersBy.set(t.task.ownerId, (transfersBy.get(t.task.ownerId) ?? 0) + 1);

  const attention = all
    .filter((x) => subtree.includes(x.row.teamId) && x.view.status !== "proposed" && (x.view.overdue > 0 || x.view.blocked || x.view.stale))
    .sort((a, b) => b.view.overdue - a.view.overdue || Number(b.view.blocked) - Number(a.view.blocked) || Number(b.view.stale) - Number(a.view.stale) || a.view.due.localeCompare(b.view.due))
    .slice(0, ATTENTION)
    .map((x) => x.view);

  const ancestors = ancestorsOf(nodes, id).reverse();
  return {
    team: { id, name: selected.name },
    path: [...ancestors.filter((a) => a !== id).map((a) => ({ id: a, name: byId.get(a)?.name ?? "Команда", link: visible.has(a) })), { id, name: selected.name, link: false }],
    teams: rows.map((n, i) => teamRow(n, i === 0 ? "self" : "below")),
    people: people.map((p) => {
      const mine = all.filter((x) => x.row.ownerId === p.id);
      return {
        slug: p.slug as PersonSlug,
        fullName: p.fullName,
        position: p.position,
        leader: p.id === selected.leaderId,
        weekly: lights.personState(p.id),
        open: mine.filter((x) => x.view.status !== "proposed").length,
        overdue: mine.filter((x) => x.view.overdue > 0).length,
        stale: mine.filter((x) => x.view.stale).length,
        transfers: transfersBy.get(p.id) ?? 0,
        requests: mine.filter((x) => x.view.status === "proposed").length,
        tasks: mine.map((x) => x.view),
      };
    }),
    attention,
    staleDays,
    reportingNumber: weekNumberOf(lights.reporting),
  };
}
