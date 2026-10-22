// Экран «Связать задачи с целями» (этап 65): цели человека и его команд на квартал и «Мои задачи», которые он ведёт
// или видел. Только чтение: связь меняет сервис задач (setTaskGoal), права те же.
//
// Цели: личные цели человека, цели команд, где он участник или руководитель, цели команд ниже (руководитель видит
// подчинённые команды по структуре и привязывает их задачи по правилам сервиса задач) и цели команд выше, на которые
// они работают. Чужие личные цели из бордов лидеров видны только руководителю их команды или команды выше. Снятые
// цели не показываем: к ним задачу не привязать.
//
// «Мои задачи»: что человек ведёт или вёл (ответственный, соисполнитель, поставил) и что он видел: задачи его команд
// и команд ниже, задачи, где он комментировал, где его упомянули, и задачи, за которыми он следит. Всё только среди
// задач, которые он видит по правилам сервиса задач. Открытые все, закрытые только за квартал, без отменённых и архива.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { ancestorsOf, loadTeamNodes, orderTeams, scopeOf, visibleTasksWhere } from "@/lib/org/scope";
import { seesTask } from "@/lib/tasks/watch";
import { statusCode } from "@/lib/tasks/codes";
import { isoFromDbDate, moscowIso, moscowToday } from "@/lib/tasks/dates";
import { fromLeaderBoard } from "./personal";
import { quarterOf } from "./parse";
import { goalProgress } from "./progress";
import { RESULT_LABELS, quartersList } from "./service";
import { REASON_ORDER, canChangeGoal, quarterRange, type LinkGoal, type LinkReason, type LinkTask } from "./links";

const QUARTER = /^\d{4}-Q[1-4]$/;
/**
 * Сколько задач команд и команд ниже брать за раз: открытых и закрытых за квартал. Свои задачи (ответственный,
 * соисполнитель, поставил, комментировал, упомянут, следит) приходят все, без предела: их не должно вытеснить
 * множество задач большой команды
 */
const LIMITS = { open: 500, closed: 200 };

export type GoalLinkBoard = {
  quarter: string;
  quarters: string[];
  goals: LinkGoal[];
  tasks: LinkTask[];
  /** Наблюдатель: только смотрит */
  observer: boolean;
  /** Общий логин без режима управления: видна только топ-команда, цель меняется только у своих задач */
  limited: boolean;
  /** Задач больше, чем помещается в список: остальные найдутся в разделе «Задачи» */
  truncated: boolean;
};

type Who = { personId: string; role: Role; management?: "OWNER" | "ADMIN" | null; limited?: boolean };

const taskSelect = {
  id: true,
  number: true,
  title: true,
  status: true,
  due: true,
  closedAt: true,
  teamId: true,
  ownerId: true,
  ownerAll: true,
  createdById: true,
  approverId: true,
  goalId: true,
  owner: { select: { slug: true, fullName: true } },
  coExecutors: { select: { personId: true, person: { select: { slug: true } } } },
  goal: { select: { id: true, title: true, code: true, quarter: true } },
} satisfies Prisma.TaskSelect;

type TaskPick = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

/** limits: предел задач команд, по умолчанию LIMITS; тесты ставят маленький, чтобы проверить, что свои задачи не режутся */
export async function goalLinkBoard(who: Who, opts: { quarter?: string | null; limits?: { open: number; closed: number } } = {}): Promise<GoalLinkBoard> {
  const limits = opts.limits ?? LIMITS;
  const today = moscowToday();
  const current = quarterOf(today);
  const quarter = opts.quarter && QUARTER.test(opts.quarter) ? opts.quarter : current;
  const range = quarterRange(quarter)!;
  const me = who.personId;
  const [nodes, functional] = await Promise.all([loadTeamNodes(prisma), prisma.person.findMany({ where: { functionalManagerId: me }, select: { id: true } })]);
  const scope = scopeOf(nodes, { id: me, role: who.role, limited: who.limited }, functional.map((f) => f.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const order = new Map(orderTeams(nodes).map((x, i) => [x.node.id, i]));
  const member = scope.member;
  // Команды ниже: подчинённые команды руководителя по структуре (scope.leads без своих команд). Общий логин без
  // режима управления ничем не руководит, у него их нет
  const below = scope.leads.filter((t) => !member.includes(t)).sort((a, b) => (order.get(a) ?? 9999) - (order.get(b) ?? 9999));
  const above = [...new Set(member.flatMap((t) => ancestorsOf(nodes, t)))].filter((t) => !member.includes(t) && !below.includes(t));

  // ---------- Цели ----------
  const rows = await prisma.goal.findMany({
    where: { quarter, result: { not: "DROPPED" }, OR: [{ teamId: { in: [...member, ...below, ...above] } }, { ownerId: me }] },
    include: {
      owner: { select: { id: true, slug: true, fullName: true } },
      facts: { orderBy: [{ at: "desc" }, { id: "desc" }], take: 1, select: { value: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { createdAt: "asc" }],
  });
  const goals: LinkGoal[] = rows
    .map((g) => {
      const team = byId.get(g.teamId);
      const boardOwner = fromLeaderBoard(g) && g.owner ? g.owner.slug : null;
      const personal = !!boardOwner && g.ownerId !== (team?.leaderId ?? null);
      return { g, team, boardOwner, personal };
    })
    // Чужая личная цель из борда лидера: только руководителю её команды или команды выше
    .filter(({ g, team, personal }) => g.ownerId === me || !personal || team?.leaderId === me || scope.leads.includes(g.teamId))
    .map(({ g, team, boardOwner, personal }) => {
      const fact = g.facts[0]?.value ?? null;
      // «Мои цели»: цели, где человек владелец не как руководитель команды (личные). Цели своей команды у руководителя
      // остаются в группе команды: так видно, чья это цель
      const group: LinkGoal["group"] = g.ownerId === me && team?.leaderId !== me ? "mine" : member.includes(g.teamId) ? "team" : below.includes(g.teamId) ? "below" : "above";
      return {
        goal: {
          id: g.id,
          code: g.code,
          title: g.title,
          quarter: g.quarter,
          team: { id: g.teamId, name: team?.name ?? "Команда" },
          owner: g.owner?.fullName ?? null,
          group,
          result: g.result === "IN_PROGRESS" ? null : RESULT_LABELS[g.result],
          fact,
          target: g.target,
          numeric: goalProgress(g.base, g.target, fact),
          boardOwner,
          personal,
        },
        rank: [{ mine: 0, team: 1, below: 2, above: 3 }[group], order.get(g.teamId) ?? 9999] as const,
      };
    })
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1])
    .map((x) => x.goal);

  // ---------- Задачи ----------
  const start = new Date(`${range.start}T00:00:00+03:00`);
  const end = new Date(`${range.end}T00:00:00+03:00`);
  // Свои задачи: ведёт, поставил, комментировал, упомянут, следит. Отдельным запросом без предела
  const personal: Prisma.TaskWhereInput = {
    OR: [
      { ownerId: me },
      { createdById: me },
      { coExecutors: { some: { personId: me } } },
      { comments: { some: { OR: [{ authorId: me }, { mentions: { has: me } }] } } },
      { watchers: { some: { personId: me } } },
    ],
  };
  // Задачи своих команд и команд ниже: с пределом, о котором экран честно пишет. Свои задачи из них уже пришли первым
  // запросом и склеиваются по номеру (условие NOT здесь не годится: на пустом ответственном оно молча отбросило бы
  // задачи «Все лидеры» и задачи без автора)
  const teams = [...member, ...below];
  const teamOnly: Prisma.TaskWhereInput | null = teams.length ? { teamId: { in: teams } } : null;
  const seenBy = {
    comments: { where: { OR: [{ authorId: me }, { mentions: { has: me } }] }, select: { authorId: true }, take: 5 },
    watchers: { where: { personId: me }, select: { personId: true } },
  } satisfies Prisma.TaskSelect;
  const visibleOnly: Prisma.TaskWhereInput[] = [{ archivedAt: null }, visibleTasksWhere(scope, me)];
  const openWhere: Prisma.TaskWhereInput = { status: { in: ["PROPOSED", "IN_PROGRESS", "CLARIFY"] } };
  const closedWhere: Prisma.TaskWhereInput = { status: { in: ["DONE", "PARTIAL", "FAILED"] }, closedAt: { gte: start, lt: end } };
  const select = { ...taskSelect, ...seenBy };
  const [mineOpen, mineClosed, open, closed, linked] = await Promise.all([
    prisma.task.findMany({ where: { AND: [...visibleOnly, personal, openWhere] }, select, orderBy: [{ due: "asc" }, { number: "asc" }] }),
    prisma.task.findMany({ where: { AND: [...visibleOnly, personal, closedWhere] }, select, orderBy: [{ closedAt: "desc" }, { number: "desc" }] }),
    teamOnly ? prisma.task.findMany({ where: { AND: [...visibleOnly, teamOnly, openWhere] }, select, orderBy: [{ due: "asc" }, { number: "asc" }], take: limits.open + 1 }) : Promise.resolve([]),
    teamOnly
      ? prisma.task.findMany({ where: { AND: [...visibleOnly, teamOnly, closedWhere] }, select, orderBy: [{ closedAt: "desc" }, { number: "desc" }], take: limits.closed + 1 })
      : Promise.resolve([]),
    // Задачи под целями экрана: цифры карточки и раскрытый список из одного набора, без отменённых
    goals.length ? prisma.task.findMany({ where: { goalId: { in: goals.map((g) => g.id) }, archivedAt: null, status: { not: "CANCELLED" } }, select: taskSelect }) : Promise.resolve([]),
  ]);
  const truncated = open.length > limits.open || closed.length > limits.closed;

  const toLink = (t: TaskPick, mine: boolean, reasons: LinkReason[]): LinkTask => {
    const status = statusCode(t.status);
    const due = isoFromDbDate(t.due);
    return {
      number: t.number,
      title: t.title,
      status,
      closed: status === "done" || status === "partial" || status === "failed" || status === "cancelled",
      due,
      closedAt: t.closedAt ? moscowIso(t.closedAt) : null,
      owner: t.ownerAll || !t.owner ? "Все лидеры" : t.owner.fullName,
      team: { id: t.teamId, name: byId.get(t.teamId)?.name ?? "Команда" },
      goal: t.goal ? { id: t.goal.id, title: t.goal.title, code: t.goal.code, quarter: t.goal.quarter } : null,
      mine,
      reasons,
      canLink: canChangeGoal(t, who, scope),
      chain: ancestorsOf(nodes, t.teamId),
      people: [...new Set([...(t.owner && !t.ownerAll ? [t.owner.slug] : []), ...t.coExecutors.map((c) => c.person.slug)])],
      quarters: [...new Set([current, quarterOf(due)])],
    };
  };

  const tasks = new Map<number, LinkTask>();
  for (const t of [...mineOpen, ...mineClosed, ...open.slice(0, limits.open), ...closed.slice(0, limits.closed)]) {
    if (tasks.has(t.number)) continue;
    const has: Record<LinkReason, boolean> = {
      owner: t.ownerId === me,
      co: t.coExecutors.some((c) => c.personId === me),
      author: t.createdById === me,
      comment: t.comments.some((c) => c.authorId === me),
      mention: t.comments.some((c) => c.authorId !== me),
      watch: t.watchers.length > 0,
      team: member.includes(t.teamId),
      below: below.includes(t.teamId),
    };
    tasks.set(t.number, toLink(t, true, REASON_ORDER.filter((r) => has[r])));
  }
  // Задачи под целями экрана, которые человек видит, но не ведёт: они видны в раскрытой карточке цели
  for (const t of linked) if (!tasks.has(t.number) && seesTask(scope, t, me)) tasks.set(t.number, toLink(t, false, []));

  return {
    quarter,
    quarters: await quartersList(),
    goals,
    tasks: [...tasks.values()],
    observer: who.role === "OBSERVER",
    limited: !!who.limited,
    truncated,
  };
}
