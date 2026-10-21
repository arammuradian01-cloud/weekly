// Собранный отчёт CEO (этап 61): то, что видит CEO, и предпросмотр на вкладке «Weekly для CEO» в разборе встречи. Те же
// части, что собирает страница «Отчёт CEO» для владельца: цифры недели, итог прогноза месяца, разделы, решения недели,
// благодарности, «Мои встречи недели». Разделы и встречи приходят снимком (что ушло CEO) или из черновика, цифры,
// решения и благодарности собираются живыми за ту неделю. Цифры отдаются по уровню зрителя (этап 57): numbersLevel и
// briefFor, у генерального директора все цифры.

import { prisma } from "@/lib/db";
import type { WeekKey } from "@/domain/types";
import type { Actor } from "@/lib/tasks/service";
import { dbDate } from "@/lib/tasks/dates";
import { TOP_TEAM } from "@/lib/org/scope";
import { weekNumbers } from "@/lib/numbers/service";
import type { WeekNumbers } from "@/lib/numbers/text";
import { briefFor, numbersLevel, type NumbersLevel } from "@/lib/plan/access";
import { planAsOfWeek, planBrief, planMonthOfWeek, type PlanBrief } from "@/lib/plan/processes";
import { ceoDecisions, currentReportingKey, type CeoDecision } from "@/lib/weekly/service";
import { weekNumberOf } from "@/lib/weekly/weeks";

export type CeoContext = {
  week: WeekKey;
  weekNumber: number;
  level: NumbersLevel;
  /** Цифры недели: только если выбраны и видны по уровню */
  numbers: WeekNumbers | null;
  /** Итог прогноза месяца по уровню зрителя */
  plan: PlanBrief | null;
  decisions: CeoDecision[];
  thanks: { name: string; text: string }[];
};

/** «Арам М.»: как благодарности подписаны на странице «Отчёт CEO» */
const compact = (fullName: string) => {
  const [last, first] = fullName.split(" ");
  return first ? `${first} ${last!.charAt(0)}.` : (last ?? fullName);
};

/** Благодарности weekly топ-команды за неделю: из них их собирает и страница «Отчёт CEO» */
async function weekThanks(key: WeekKey): Promise<{ name: string; text: string }[]> {
  const top = await prisma.team.findUnique({ where: { id: TOP_TEAM }, select: { leaderId: true, members: { select: { personId: true } } } });
  const ids = [...new Set([...(top?.leaderId ? [top.leaderId] : []), ...(top?.members.map((m) => m.personId) ?? [])])];
  if (!ids.length) return [];
  const rows = await prisma.weeklyReport.findMany({
    where: { week: { start: dbDate(key) }, authorId: { in: ids }, thanks: { not: null } },
    select: { thanks: true, author: { select: { fullName: true, sortOrder: true } } },
  });
  return rows
    .filter((r) => r.thanks?.trim())
    .sort((a, b) => a.author.sortOrder - b.author.sortOrder)
    .map((r) => ({ name: compact(r.author.fullName), text: r.thanks!.trim() }));
}

/** Живые части отчёта CEO за неделю глазами зрителя: цифры по его уровню, решения и благодарности недели */
export async function ceoContext(actor: Actor, key: WeekKey): Promise<CeoContext> {
  const level = await numbersLevel({ personId: actor.personId, role: actor.role, management: actor.management });
  const weekNumber = weekNumberOf(key);
  const reporting = await currentReportingKey();
  const [numbers, plan, decisions, thanks] = await Promise.all([
    level !== "none" ? weekNumbers(key) : Promise.resolve(null),
    level !== "none" ? planBrief(actor, planMonthOfWeek(key), planAsOfWeek(key, reporting, weekNumber)).catch(() => null) : Promise.resolve(null),
    ceoDecisions(key),
    weekThanks(key),
  ]);
  return { week: key, weekNumber, level, numbers: numbers?.figures.length ? numbers : null, plan: briefFor(level, plan), decisions, thanks };
}
