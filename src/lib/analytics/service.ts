// Панель «Аналитика» (этап 27, модуль М12): как идут weekly, задачи, просьбы и цели в команде и командах ниже за 8 недель,
// и карточка по каждому лидеру уровнем ниже. Общего рейтинга нет: карточки в порядке структуры.
//
// Кто видит: владелец и администраторы любую команду, руководитель команды свою команду и команды ниже.
// Общий вход team панели не видит. Панель только читает: ничего не пишет и не меняет.
//
// Счёт:
// - weekly по отчётным неделям, состав команд сегодняшний. Ждём weekly от тех же людей, что и страница «Структура»;
//   человек, которого завели после срока недели, за эту неделю не считается;
// - задачи по календарным неделям, текущая неделя идёт: закрыто, переносы срока, просрочено на конец недели;
// - просьбы к людям команды: медиана рабочих часов от просьбы до ответа (принял, отклонил или выполнил);
// - цели текущего квартала команды и команд ниже. В риске: отметил владелец или просрочено от трети открытых задач цели.

import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { dbDate, isoFromDbDate, moscowToday } from "@/lib/tasks/dates";
import { currentReportingKey, weekSettings } from "@/lib/weekly/service";
import { deadlineOf, weekKeyOf, weekNumberOf } from "@/lib/weekly/weeks";
import { diffDays, type IsoDate } from "@/domain/dates";
import type { PersonSlug, WeekKey } from "@/domain/types";
import { quarterOf } from "@/lib/goals/parse";
import { ancestorsOf, loadTeamNodes, orderTeams, scopeOf, seesAll, subtreeOf, teamPeopleIds, TOP_TEAM, type ScopeSubject, type TeamNode } from "@/lib/org/scope";
import { expectedOf, expectingTeams, leadersOf, teamDeadline } from "@/lib/org/rhythm";
import {
  cardTeams,
  countCells,
  lastWeeks,
  median,
  overdueAt,
  share,
  weekEndMoment,
  weeklyCell,
  workingHoursBetween,
  type TaskHistory,
  type WeeklyCell,
  type WeeklyCounts,
} from "./rules";

export type WeeklyPoint = WeeklyCounts & { key: WeekKey; number: number; current: boolean; onTimeShare: number | null; submittedShare: number | null };
export type TaskPoint = { key: WeekKey; number: number; current: boolean; closed: number; transfers: number; overdue: number; answerHours: number | null; answered: number };
/** inWork: «В работе», как на странице «Мои команды»; просрочка, давность и блокировка считаются по принятым задачам (в работе и требуют уточнений) */
export type AreaNow = { inWork: number; overdue: number; stale: number; blocked: number; clarify: number; proposed: number };
export type AreaRequests = { waiting: number; accepted: number; overdue: number; medianHours: number | null; answered: number };
export type AreaGoals = { quarter: string; total: number; onTrack: number; atRisk: number; achieved: number; partial: number; missed: number; dropped: number };

export type LeaderCard = {
  key: string;
  /** active: false, если руководителя выключили в ресурсе или он наблюдатель: его weekly не считается */
  leader: { slug: PersonSlug; fullName: string; position: string | null; active: boolean } | null;
  teams: { id: string; name: string; below: boolean }[];
  people: number;
  /** Свой weekly лидера по отчётным неделям. optional: weekly от него нигде не ждут */
  weekly: { cells: { key: WeekKey; number: number; cell: WeeklyCell }[]; onTime: number; due: number; optional: boolean };
  now: AreaNow;
  closed: number;
  transfers: number;
  /** Просрочено на конец каждой недели, по порядку недель */
  overdue: number[];
  requests: AreaRequests;
  goals: AreaGoals;
};

export type Analytics = {
  team: { id: string; name: string };
  path: { id: string; name: string; link: boolean }[];
  options: { id: string; name: string; depth: number }[];
  weekly: WeeklyPoint[];
  tasks: TaskPoint[];
  now: AreaNow;
  requests: AreaRequests;
  goals: AreaGoals;
  leaders: LeaderCard[];
  /** Сколько людей и команд в счёте */
  people: number;
  teams: number;
  staleDays: number;
  reportingNumber: number;
};

const OPEN = ["PROPOSED", "IN_PROGRESS", "CLARIFY"] as const;

/** Какие команды человек может открыть в аналитике */
export function analyticsTeams(nodes: TeamNode[], subject: ScopeSubject): Set<string> {
  // Общий вход и наблюдатель аналитику не видят, даже если наблюдатель указан руководителем команды
  if (subject.limited || subject.role === "OBSERVER") return new Set();
  const active = nodes.filter((n) => n.active);
  if (seesAll(subject.role)) return new Set(active.map((n) => n.id));
  const scope = scopeOf(nodes, subject);
  return new Set(scope.leads);
}

function pickTeam(nodes: TeamNode[], allowed: Set<string>, personId: string, requested: string | null | undefined): string | null {
  const active = nodes.filter((n) => n.active && allowed.has(n.id));
  if (requested && active.some((n) => n.id === requested)) return requested;
  if (active.some((n) => n.id === TOP_TEAM)) return TOP_TEAM;
  const ordered = orderTeams(active).map((x) => x.node);
  // Своя команда ближе к верху дерева, иначе первая доступная
  return ordered.find((n) => n.leaderId === personId)?.id ?? ordered[0]?.id ?? null;
}

export async function teamAnalytics(subject: ScopeSubject, requested: string | null | undefined, now = new Date()): Promise<Analytics | null> {
  const [nodes, staleDays, reporting, settings] = await Promise.all([loadTeamNodes(prisma), getSetting<number>("tasks.staleDays", 14), currentReportingKey(now), weekSettings()]);
  const allowed = analyticsTeams(nodes, subject);
  const id = pickTeam(nodes, allowed, subject.id, requested);
  if (!id) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const selected = byId.get(id)!;
  const active = nodes.filter((n) => n.active);
  const subtree = subtreeOf(active, id).filter((t) => allowed.has(t));
  const subtreeSet = new Set(subtree);
  const today = moscowToday(now);

  const reportingWeeks = lastWeeks(reporting);
  const calendarWeeks = lastWeeks(weekKeyOf(today));
  // Полночь понедельника по Москве: в UTC это 21:00 воскресенья
  const mskStart = (key: WeekKey) => new Date(dbDate(key).getTime() - 3 * 60 * 60 * 1000);
  const windowStart = mskStart(calendarWeeks[0]);
  // Просьбы считаются за те же 8 календарных недель, что и график ответа
  const since = windowStart;

  const leaders = leadersOf(nodes);
  const peopleIds = [...new Set(subtree.flatMap((t) => teamPeopleIds(byId.get(t)!)))];
  const cardNodes = cardTeams(nodes, id, allowed);
  const cardLeaders = cardNodes.map((n) => n.leaderId).filter((x): x is string => !!x);

  const [people, leaderRows, weeks, tasks, requests, goals] = await Promise.all([
    prisma.person.findMany({
      where: { id: { in: [...new Set([...peopleIds, ...cardLeaders])] }, active: true, role: { not: "OBSERVER" } },
      select: { id: true, slug: true, fullName: true, position: true, createdAt: true },
    }),
    // Имена руководителей карточек: и выключенных, чтобы карточка не говорила «руководитель не назначен»
    prisma.person.findMany({ where: { id: { in: cardLeaders } }, select: { id: true, slug: true, fullName: true, position: true } }),
    prisma.week.findMany({
      where: { start: { in: reportingWeeks.map(dbDate) } },
      select: { start: true, deadline: true, reports: { select: { authorId: true, state: true } }, absences: { select: { personId: true } } },
    }),
    prisma.task.findMany({
      where: {
        teamId: { in: subtree },
        AND: [{ OR: [{ status: { in: [...OPEN] } }, { closedAt: { gte: windowStart } }] }, { OR: [{ archivedAt: null }, { archivedAt: { gte: windowStart } }] }],
      },
      select: {
        teamId: true,
        status: true,
        state: true,
        due: true,
        whereUpdatedAt: true,
        createdAt: true,
        closedAt: true,
        archivedAt: true,
        transfers: { where: { at: { gte: windowStart } }, select: { at: true, fromDue: true } },
      },
    }),
    prisma.helpRequest.findMany({
      where: { addresseeId: { in: peopleIds }, OR: [{ createdAt: { gte: since } }, { status: { in: ["OPEN", "ACCEPTED"] } }] },
      select: { addresseeId: true, status: true, createdAt: true, answeredAt: true, due: true, acceptedDue: true },
    }),
    prisma.goal.findMany({
      where: { quarter: quarterOf(today), teamId: { in: subtree } },
      select: { teamId: true, atRisk: true, result: true, tasks: { where: { archivedAt: null, status: { in: ["IN_PROGRESS", "CLARIFY"] } }, select: { due: true } } },
    }),
  ]);

  const personById = new Map(people.map((p) => [p.id, p]));
  const weekByKey = new Map(
    weeks.map((w) => [
      isoFromDbDate(w.start),
      { deadline: w.deadline, state: new Map(w.reports.map((r) => [r.authorId, r.state as string])), absent: new Set(w.absences.map((a) => a.personId)) },
    ]),
  );

  // ---------- weekly: клетка по каждому человеку и неделе ----------
  const expectingCache = new Map<string, TeamNode[]>();
  const expectingOf = (personId: string): TeamNode[] => {
    let list = expectingCache.get(personId);
    if (!list) {
      list = expectingTeams(personId, nodes, leaders);
      expectingCache.set(personId, list);
    }
    return list;
  };
  const cellCache = new Map<string, WeeklyCell>();
  const cellOf = (personId: string, key: WeekKey, expected: boolean): WeeklyCell => {
    const cacheKey = `${personId}/${key}/${expected}`;
    const hit = cellCache.get(cacheKey);
    if (hit) return hit;
    const p = personById.get(personId);
    const w = weekByKey.get(key);
    const department = w?.deadline ?? deadlineOf(key, settings.deadline);
    // Срок человека: самый ранний из сроков команд, которые ждут его weekly (как personDeadline, но команды считаются один раз)
    let deadline = department;
    for (const n of expectingOf(personId)) {
      const d = teamDeadline(key, n, department);
      if (d.getTime() < deadline.getTime()) deadline = d;
    }
    const state = w?.state.get(personId) ?? null;
    // Человека завели после срока недели: за неё с него не спрашиваем
    const existed = !!p && p.createdAt.getTime() <= deadline.getTime();
    const cell = weeklyCell(expected && existed, state, !!w?.absent.has(personId), now.getTime() > deadline.getTime());
    cellCache.set(cacheKey, cell);
    return cell;
  };
  const expectedIn = (teamIds: string[]): string[] => {
    const set = new Set<string>();
    for (const t of teamIds) {
      const n = byId.get(t);
      if (n?.active) for (const pid of expectedOf(n, leaders)) if (personById.has(pid)) set.add(pid);
    }
    return [...set];
  };
  const weeklySeries = (teamIds: string[]): WeeklyPoint[] => {
    const expected = expectedIn(teamIds);
    return reportingWeeks.map((key) => {
      const counts = countCells(expected.map((pid) => cellOf(pid, key, true)));
      return {
        key,
        number: weekNumberOf(key),
        current: key === reporting,
        ...counts,
        onTimeShare: share(counts.onTime, counts.expected - counts.pending),
        submittedShare: share(counts.onTime + counts.late, counts.expected - counts.pending),
      };
    });
  };

  // ---------- задачи: просрочка на конец каждой недели считается один раз на задачу ----------
  const ends = calendarWeeks.map((key) => weekEndMoment(key, now));
  const starts = calendarWeeks.map(mskStart);
  const weekIndex = (at: Date | null): number => {
    if (!at) return -1;
    const t = at.getTime();
    for (let i = calendarWeeks.length - 1; i >= 0; i--) if (t >= starts[i].getTime()) return t <= ends[i].moment.getTime() || ends[i].current ? i : -1;
    return -1;
  };
  const rows = tasks.map((t) => {
    const history: TaskHistory = {
      status: t.status,
      due: isoFromDbDate(t.due),
      createdAt: t.createdAt,
      closedAt: t.closedAt,
      archivedAt: t.archivedAt,
      transfers: t.transfers.map((x) => ({ at: x.at, fromDue: x.fromDue ? isoFromDbDate(x.fromDue) : null })),
    };
    const open = t.archivedAt === null && (OPEN as readonly string[]).includes(t.status);
    // Принятая: в работе или требует уточнений. Предложенную ещё никто не взял
    const accepted = open && t.status !== "PROPOSED";
    return {
      teamId: t.teamId,
      overdueBy: ends.map((e) => overdueAt(history, e.moment, e.day)),
      closedIn: t.status === "DONE" || t.status === "PARTIAL" ? weekIndex(t.closedAt) : -1,
      transfersIn: t.transfers.map((x) => weekIndex(x.at)).filter((i) => i >= 0),
      accepted,
      inWork: open && t.status === "IN_PROGRESS",
      proposed: open && t.status === "PROPOSED",
      overdue: accepted && diffDays(history.due, today) > 0,
      stale: accepted && diffDays(isoFromDbDate(t.whereUpdatedAt), today) > staleDays,
      blocked: accepted && t.state === "BLOCKED",
      clarify: open && t.status === "CLARIFY",
    };
  });

  const requestRows = requests.map((r) => {
    const open = r.status === "OPEN" || r.status === "ACCEPTED";
    const due = isoFromDbDate(r.acceptedDue ?? r.due);
    return {
      addresseeId: r.addresseeId,
      waiting: r.status === "OPEN",
      accepted: r.status === "ACCEPTED",
      overdue: open && diffDays(due, today) > 0,
      hours: r.answeredAt && r.createdAt.getTime() >= since.getTime() ? workingHoursBetween(r.createdAt, r.answeredAt) : null,
      week: weekIndex(r.createdAt),
    };
  });

  const goalRows = goals.map((g) => {
    const late = g.tasks.filter((t) => diffDays(isoFromDbDate(t.due), today) > 0).length;
    const risky = g.result === "IN_PROGRESS" && (g.atRisk || (g.tasks.length > 0 && late / g.tasks.length >= 0.3));
    return { teamId: g.teamId, result: g.result, risky };
  });

  const area = (teamIds: string[]) => {
    const teams = new Set(teamIds);
    const people = new Set(teamIds.flatMap((t) => (byId.get(t) ? teamPeopleIds(byId.get(t)!) : [])).filter((pid) => personById.has(pid)));
    const ts = rows.filter((r) => teams.has(r.teamId));
    const rq = requestRows.filter((r) => people.has(r.addresseeId));
    const gs = goalRows.filter((g) => teams.has(g.teamId));
    const now: AreaNow = {
      inWork: ts.filter((r) => r.inWork).length,
      overdue: ts.filter((r) => r.overdue).length,
      stale: ts.filter((r) => r.stale).length,
      blocked: ts.filter((r) => r.blocked).length,
      clarify: ts.filter((r) => r.clarify).length,
      proposed: ts.filter((r) => r.proposed).length,
    };
    const answered = rq.filter((r) => r.hours !== null);
    const requests: AreaRequests = {
      waiting: rq.filter((r) => r.waiting).length,
      accepted: rq.filter((r) => r.accepted).length,
      overdue: rq.filter((r) => r.overdue).length,
      medianHours: median(answered.map((r) => r.hours!)),
      answered: answered.length,
    };
    const goals: AreaGoals = {
      quarter: quarterOf(today),
      total: gs.length,
      onTrack: gs.filter((g) => g.result === "IN_PROGRESS" && !g.risky).length,
      atRisk: gs.filter((g) => g.risky).length,
      achieved: gs.filter((g) => g.result === "ACHIEVED").length,
      partial: gs.filter((g) => g.result === "PARTIAL").length,
      missed: gs.filter((g) => g.result === "MISSED").length,
      dropped: gs.filter((g) => g.result === "DROPPED").length,
    };
    const series: TaskPoint[] = calendarWeeks.map((key, i) => {
      const week = answered.filter((r) => r.week === i);
      return {
        key,
        number: weekNumberOf(key),
        current: ends[i].current,
        closed: ts.filter((r) => r.closedIn === i).length,
        transfers: ts.reduce((s, r) => s + r.transfersIn.filter((x) => x === i).length, 0),
        overdue: ts.filter((r) => r.overdueBy[i]).length,
        answerHours: median(week.map((r) => r.hours!)),
        answered: week.length,
      };
    });
    return { now, requests, goals, series, people };
  };

  const total = area(subtree);

  // ---------- карточки лидеров: лидер и его команды; один человек ведёт несколько команд: одна карточка ----------
  const groups = new Map<string, TeamNode[]>();
  for (const n of cardNodes) {
    const key = n.leaderId ?? `team:${n.id}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const leaderCards: LeaderCard[] = [...groups.entries()].map(([key, teams]) => {
    const teamIds = [...new Set(teams.flatMap((t) => subtreeOf(active, t.id)))].filter((t) => subtreeSet.has(t));
    const a = area(teamIds);
    const leaderId = teams[0].leaderId;
    const leader = leaderId ? leaderRows.find((p) => p.id === leaderId) : undefined;
    const counted = !!leaderId && personById.has(leaderId);
    const optional = !leaderId || !counted || expectingOf(leaderId).length === 0;
    const cells = reportingWeeks.map((wk) => ({ key: wk, number: weekNumberOf(wk), cell: leaderId ? cellOf(leaderId, wk, !optional) : ("none" as WeeklyCell) }));
    return {
      key,
      leader: leader ? { slug: leader.slug as PersonSlug, fullName: leader.fullName, position: leader.position, active: counted } : null,
      teams: teams.map((t) => ({ id: t.id, name: t.name, below: active.some((c) => c.parentId === t.id && c.id !== t.id && allowed.has(c.id)) })),
      people: a.people.size,
      weekly: {
        cells,
        onTime: cells.filter((c) => c.cell === "on-time").length,
        due: cells.filter((c) => c.cell !== "none" && c.cell !== "pending" && c.cell !== "absent").length,
        optional,
      },
      now: a.now,
      closed: a.series.reduce((s, w) => s + w.closed, 0),
      transfers: a.series.reduce((s, w) => s + w.transfers, 0),
      overdue: a.series.map((w) => w.overdue),
      requests: a.requests,
      goals: a.goals,
    };
  });

  const options = orderTeams(active.filter((n) => allowed.has(n.id))).map(({ node, depth }) => ({ id: node.id, name: node.name, depth }));
  const ancestors = ancestorsOf(nodes, id).reverse();
  return {
    team: { id, name: selected.name },
    path: [...ancestors.filter((x) => x !== id).map((x) => ({ id: x, name: byId.get(x)?.name ?? "Команда", link: allowed.has(x) })), { id, name: selected.name, link: false }],
    options,
    weekly: weeklySeries(subtree),
    tasks: total.series,
    now: total.now,
    requests: total.requests,
    goals: total.goals,
    leaders: leaderCards,
    people: total.people.size,
    teams: subtree.length,
    staleDays,
    reportingNumber: weekNumberOf(reporting),
  };
}

export type { IsoDate };
