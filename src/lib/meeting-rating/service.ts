// Анонимная оценка встреч на сервере (этап 29).
//
// «Кто ответил» пишется отдельной строкой (человек, команда, месяц), без времени и без записи в журнале. Сам ответ
// отдельной строкой не хранится: он добавляется в урну команды за месяц, где только сколько раз поставили каждую
// оценку и тексты «что убрать» в случайном порядке. По базе видно, что человек ответил, но не что именно. Остаётся
// одно: тот, у кого есть две копии базы до и после ответа одного человека, увидит разницу в урне. Это доступ
// владельца к хостингу, руководитель команды так не может.
// Отвечают только при личном входе: по общему логину можно выбрать чужой профиль и ответить за другого.

import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { moscowToday } from "@/lib/tasks/dates";
import { personalLogin } from "@/lib/one-on-one/rules";
import { loadTeamNodes, type ScopeSubject, type TeamNode } from "@/lib/org/scope";
import { analyticsTeams } from "@/lib/analytics/service";
import {
  addToBox,
  boxTotal,
  closesOn,
  EMPTY_BOX,
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
  type RatingBox,
  type RatingSummary,
} from "./rules";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export type RateTeam = { id: string; name: string; leaderName: string | null; voted: boolean };
export type RateMonth = { month: Month; label: string; closesLabel: string; teams: RateTeam[] };
/** leads: человек руководит командой, её встречи оценивают участники */
export type MyRatings = { locked: string | null; months: RateMonth[]; leads: boolean };

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
  if (locked) return { locked, months: [], leads: false };
  const today = moscowToday(now);
  const months = openMonths(today);
  const nodes = await loadTeamNodes(prisma);
  const teams = myTeams(nodes, actor.personId);
  const leads = nodes.some((n) => n.active && n.leaderId === actor.personId);
  if (!teams.length) return { locked: null, months: [], leads };
  const [votes, leaders] = await Promise.all([
    prisma.meetingRatingVote.findMany({ where: { personId: actor.personId, month: { in: months } }, select: { teamId: true, month: true } }),
    prisma.person.findMany({ where: { id: { in: teams.flatMap((t) => (t.leaderId ? [t.leaderId] : [])) } }, select: { id: true, fullName: true } }),
  ]);
  const voted = new Set(votes.map((v) => `${v.teamId}/${v.month}`));
  const names = new Map(leaders.map((p) => [p.id, p.fullName]));
  return {
    locked: null,
    leads,
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
  const teamId = node!.id;
  try {
    await prisma.$transaction(async (tx) => {
      // Строка «кто ответил»: уникальна на человека, команду и месяц. Вторая вкладка с тем же ответом упрётся сюда
      await tx.meetingRatingVote.create({ data: { teamId, month, personId: actor.personId } });
      // Урна: создаётся первым ответом, дальше меняется под замком строки, чтобы два ответа не потеряли друг друга
      await tx.$executeRaw`INSERT INTO meeting_rating_boxes ("teamId", "month") VALUES (${teamId}, ${month}) ON CONFLICT DO NOTHING`;
      const [box] = await tx.$queryRaw<RatingBox[]>`SELECT counts, remove FROM meeting_rating_boxes WHERE "teamId" = ${teamId} AND "month" = ${month} FOR UPDATE`;
      const next = addToBox({ counts: box?.counts ?? EMPTY_BOX.counts, remove: box?.remove ?? [] }, score, remove, () => randomInt(0, 2 ** 31) / 2 ** 31);
      await tx.meetingRatingBox.update({ where: { teamId_month: { teamId, month } }, data: { counts: next.counts, remove: next.remove } });
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
  /** Смотрящий сам ответил за этот месяц: итог для него от четырёх ответов */
  selfVoted: boolean;
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
  const [votes, boxes, raters, mine] = await Promise.all([
    prisma.meetingRatingVote.groupBy({ by: ["month"], where: { teamId, month: { in: open } }, _count: { _all: true } }),
    prisma.meetingRatingBox.findMany({ where: { teamId, month: { in: closed } }, select: { month: true, counts: true, remove: true } }),
    eligiblePeople(ratersOf(node)),
    // Ответил ли сам смотрящий: для него порог на один выше
    prisma.meetingRatingVote.findMany({ where: { teamId, personId: subject.id, month: { in: closed } }, select: { month: true } }),
  ]);
  const openCount = new Map(votes.map((v) => [v.month, v._count._all]));
  const byMonth = new Map<Month, RatingBox>(boxes.map((b) => [b.month, { counts: b.counts, remove: b.remove }]));
  const selfVoted = new Set(mine.map((v) => v.month));
  const view = (month: Month, isOpenMonth: boolean): RatingMonthView => {
    const box = byMonth.get(month) ?? EMPTY_BOX;
    return {
      month,
      label: monthLabel(month),
      open: isOpenMonth,
      closesLabel: dayLabel(closesOn(month)),
      answered: isOpenMonth ? (openCount.get(month) ?? 0) : boxTotal(box),
      selfVoted: selfVoted.has(month),
      summary: isOpenMonth || !resultsVisible(month, today) ? null : summarize(box, { selfVoted: selfVoted.has(month) }),
    };
  };
  return { team: { id: node.id, name: node.name }, raters: raters.size, months: [...open.map((m) => view(m, true)), ...closed.map((m) => view(m, false))] };
}
