// Анонимная оценка встреч на сервере (этап 29).
//
// Ответ пишется двумя строками в разные таблицы: «кто ответил» (человек, команда, месяц) и «что ответили» (команда,
// месяц, оценка, текст). Общего ключа, времени и записи в журнале нет: по базе нельзя сказать, чья это оценка.
// Отвечают только при личном входе: по общему логину можно выбрать чужой профиль и ответить за другого.

import { prisma } from "@/lib/db";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { moscowToday } from "@/lib/tasks/dates";
import { personalLogin } from "@/lib/one-on-one/rules";
import { loadTeamNodes, type ScopeSubject, type TeamNode } from "@/lib/org/scope";
import { analyticsTeams } from "@/lib/analytics/service";
import {
  closesOn,
  cleanRemove,
  dayLabel,
  HISTORY_MONTHS,
  isMonth,
  isOpen,
  monthLabel,
  monthOf,
  openMonths,
  promptMonth,
  ratersOf,
  resultsVisible,
  shiftMonth,
  summarize,
  validScore,
  type Month,
  type RatingSummary,
} from "./rules";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export type RateTeam = { id: string; name: string; leaderName: string | null; voted: boolean };
export type RateMonth = { month: Month; label: string; closesLabel: string; teams: RateTeam[] };
export type MyRatings = { locked: string | null; months: RateMonth[] };

const LOCKED_SHARED = "Встречи оценивают при личном входе: по общему логину можно выбрать чужой профиль и ответить за другого.";
const LOCKED_OBSERVER = "Наблюдатель встречи не оценивает.";

function lockedFor(actor: Pick<Actor, "via" | "role">): string | null {
  if (!personalLogin(actor.via)) return LOCKED_SHARED;
  if (actor.role === "OBSERVER") return LOCKED_OBSERVER;
  return null;
}

/** Включённые люди, которые могут оценивать: не наблюдатели */
async function eligiblePeople(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await prisma.person.findMany({ where: { id: { in: ids }, active: true, role: { not: "OBSERVER" } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/** Команды, встречи которых человек оценивает */
function myTeams(nodes: TeamNode[], personId: string): TeamNode[] {
  return nodes.filter((n) => n.active && ratersOf(n).includes(personId));
}

/** Что человек может оценить сейчас: открытые месяцы и команды, отмечено, где ответ уже есть */
export async function myRatings(actor: Actor, now = new Date()): Promise<MyRatings> {
  const locked = lockedFor(actor);
  if (locked) return { locked, months: [] };
  const today = moscowToday(now);
  const months = openMonths(today);
  const nodes = await loadTeamNodes(prisma);
  const teams = myTeams(nodes, actor.personId);
  if (!teams.length) return { locked: null, months: [] };
  const [votes, leaders] = await Promise.all([
    prisma.meetingRatingVote.findMany({ where: { personId: actor.personId, month: { in: months } }, select: { teamId: true, month: true } }),
    prisma.person.findMany({ where: { id: { in: teams.flatMap((t) => (t.leaderId ? [t.leaderId] : [])) } }, select: { id: true, fullName: true } }),
  ]);
  const voted = new Set(votes.map((v) => `${v.teamId}/${v.month}`));
  const names = new Map(leaders.map((p) => [p.id, p.fullName]));
  return {
    locked: null,
    months: months.map((month) => ({
      month,
      label: monthLabel(month),
      closesLabel: dayLabel(closesOn(month)),
      teams: teams.map((t) => ({ id: t.id, name: t.name, leaderName: t.leaderId ? (names.get(t.leaderId) ?? null) : null, voted: voted.has(`${t.id}/${month}`) })),
    })),
  };
}

/** Напоминание на главной: в конце месяца и в первые дни следующего, пока есть неотвеченные команды */
export async function ratingPrompt(actor: Actor, now = new Date()): Promise<{ label: string; closesLabel: string; teams: number } | null> {
  if (lockedFor(actor)) return null;
  const month = promptMonth(moscowToday(now));
  if (!month) return null;
  const mine = await myRatings(actor, now);
  const target = mine.months.find((m) => m.month === month);
  const left = target?.teams.filter((t) => !t.voted).length ?? 0;
  return left ? { label: target!.label, closesLabel: target!.closesLabel, teams: left } : null;
}

export type RatingInput = { teamId: string; month: string; score: unknown; remove?: unknown };

/** Ответ: полезность от 1 до 5 и что убрать. Один раз за месяц на команду, изменить нельзя: ответ не связан с человеком */
export async function submitRating(actor: Actor, input: RatingInput, now = new Date()): Promise<void> {
  const locked = lockedFor(actor);
  if (locked) fail(locked);
  const today = moscowToday(now);
  const month = String(input.month ?? "");
  if (!isMonth(month) || !isOpen(month, today)) fail("Оценка за этот месяц уже закрыта");
  const score = validScore(input.score) ?? fail("Выберите оценку от 1 до 5");
  const remove = cleanRemove(input.remove);
  const nodes = await loadTeamNodes(prisma);
  const node = nodes.find((n) => n.id === String(input.teamId ?? "") && n.active);
  if (!node || !ratersOf(node).includes(actor.personId)) fail("Встречи команды оценивают её участники, кроме руководителя");
  if (!(await eligiblePeople([actor.personId])).has(actor.personId)) fail("Ваш профиль выключен");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.meetingRatingVote.create({ data: { teamId: node!.id, month, personId: actor.personId } });
      await tx.meetingRating.create({ data: { teamId: node!.id, month, score, remove } });
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    fail(`Вы уже ответили за ${monthLabel(month)}. Ответ не связан с вами, поэтому изменить его нельзя`);
  }
}

export type RatingMonthView = {
  month: Month;
  label: string;
  /** Опрос ещё идёт: видно только число ответов */
  open: boolean;
  closesLabel: string;
  answered: number;
  summary: RatingSummary | null;
};

export type RatingResults = { team: { id: string; name: string }; raters: number; months: RatingMonthView[] };

/** Итоги команды для руководителя и руководства: те же права, что у аналитики */
export async function ratingResults(subject: ScopeSubject, teamId: string, now = new Date()): Promise<RatingResults | null> {
  const nodes = await loadTeamNodes(prisma);
  if (!analyticsTeams(nodes, subject).has(teamId)) return null;
  const node = nodes.find((n) => n.id === teamId)!;
  const today = moscowToday(now);
  const open = [...openMonths(today)].reverse();
  const closed: Month[] = [];
  for (let i = 1; closed.length < HISTORY_MONTHS; i++) {
    const m = shiftMonth(monthOf(today), -i);
    if (!open.includes(m)) closed.push(m);
  }
  const [votes, rows, raters] = await Promise.all([
    prisma.meetingRatingVote.groupBy({ by: ["month"], where: { teamId, month: { in: open } }, _count: { _all: true } }),
    prisma.meetingRating.findMany({ where: { teamId, month: { in: closed } }, select: { month: true, score: true, remove: true } }),
    eligiblePeople(ratersOf(node)),
  ]);
  const openCount = new Map(votes.map((v) => [v.month, v._count._all]));
  const byMonth = new Map<Month, { score: number; remove: string }[]>();
  for (const r of rows) byMonth.set(r.month, [...(byMonth.get(r.month) ?? []), r]);
  const view = (month: Month, isOpenMonth: boolean): RatingMonthView => {
    const list = byMonth.get(month) ?? [];
    return {
      month,
      label: monthLabel(month),
      open: isOpenMonth,
      closesLabel: dayLabel(closesOn(month)),
      answered: isOpenMonth ? (openCount.get(month) ?? 0) : list.length,
      summary: isOpenMonth || !resultsVisible(month, today) ? null : summarize(list),
    };
  };
  return { team: { id: node.id, name: node.name }, raters: raters.size, months: [...open.map((m) => view(m, true)), ...closed.map((m) => view(m, false))] };
}
