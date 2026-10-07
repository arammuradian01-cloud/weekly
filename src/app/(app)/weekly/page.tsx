import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { getMyWeekly, getWeekView } from "@/lib/weekly/service";
import { isWeekKey } from "@/lib/weekly/weeks";
import { WeeklyFeed } from "@/components/weekly/weekly-feed";
import { ALL_TEAMS, audienceOf, currentTeam, subjectOf } from "@/lib/org/current";
import { promotableFrom } from "@/lib/org/rhythm";
import { TOP_TEAM } from "@/domain/teams";
import { prisma } from "@/lib/db";
import type { PersonSlug } from "@/domain/types";

export const metadata: Metadata = { title: "Weekly" };

export default async function WeeklyPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await requireContext();
  const { person } = ctx;
  const { week } = await searchParams;
  // Лента выбранной команды (этап 14)
  const team = await currentTeam(subjectOf(ctx));
  const view = await getWeekView(isWeekKey(week) ? week : null, new Date(), audienceOf(team));
  const mine = await getMyWeekly(person.id, view.reportingKey);
  // Этап 15: чьи записи я могу поднять наверх, и может ли закрыть неделю выбранной команды
  const limited = subjectOf(ctx).limited;
  const promoteFrom = limited ? [] : await slugsOf([...promotableFrom(person.id, team.nodes)]);
  const teamWeek =
    team.id && team.id !== ALL_TEAMS && team.id !== TOP_TEAM && (ctx.management || team.scope.leads.includes(team.id)) && ctx.person.role !== "OBSERVER"
      ? { id: team.id, name: team.name }
      : null;
  // Поднимать наверх можно, пока открыт мой weekly за показанную неделю: он закрывается по моим командам, а не по показанной
  const forWeek = view.week.key === view.reportingKey ? mine : await getMyWeekly(person.id, view.week.key);
  const promoteClosed = !ctx.management && forWeek.week.closed;
  return <WeeklyFeed key={view.week.key} view={view} myReport={mine.report} promoteFrom={promoteFrom} teamWeek={teamWeek} promoteClosed={promoteClosed} />;
}

async function slugsOf(ids: string[]): Promise<PersonSlug[]> {
  if (!ids.length) return [];
  return (await prisma.person.findMany({ where: { id: { in: ids } }, select: { slug: true } })).map((p) => p.slug as PersonSlug);
}
