import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { getMyWeekly, getWeekView } from "@/lib/weekly/service";
import { isWeekKey } from "@/lib/weekly/weeks";
import { WeeklyFeed, type AuthorFocus } from "@/components/weekly/weekly-feed";
import { ALL_TEAMS, audienceOf, currentTeam, feedTeamFor, subjectOf } from "@/lib/org/current";
import { promotableFrom } from "@/lib/org/rhythm";
import { TOP_TEAM } from "@/domain/teams";
import { prisma } from "@/lib/db";
import type { PersonSlug } from "@/domain/types";

export const metadata: Metadata = { title: "Weekly" };

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export default async function WeeklyPage({ searchParams }: { searchParams: Promise<{ week?: string; author?: string }> }) {
  const ctx = await requireContext();
  const { person } = ctx;
  const { week, author } = await searchParams;
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
  // Этап 39: ссылка «Weekly» из дерева подчинённых открывает ленту с отбором по автору. Если человека нет в ленте
  // выбранной команды, лента подсказывает, в какой из видимых команд он есть
  const focus = await authorFocus(typeof author === "string" ? author : undefined, team);
  // Этап 73: «Напомнить не сдавшим» у руководителя показанной команды (и топ-команды) при личном входе и в режиме управления
  const shownTeam = team.id && team.id !== ALL_TEAMS ? team.id : null;
  const leadsShown = !!shownTeam && (team.scope.leads.includes(shownTeam) || team.nodes.some((n) => n.id === shownTeam && n.leaderId === person.id));
  const remind = ctx.management ? { teamId: shownTeam } : leadsShown && ctx.via !== "TEAM" && person.role !== "OBSERVER" ? { teamId: shownTeam } : null;
  return (
    <WeeklyFeed
      // Ключ только по неделе: живое обновление экрана перечитывает адрес с отбором, и фильтры не должны сбрасываться
      key={view.week.key}
      view={view}
      myReport={mine.report}
      promoteFrom={promoteFrom}
      teamWeek={teamWeek}
      promoteClosed={promoteClosed}
      focus={focus}
      remind={remind}
    />
  );
}

async function authorFocus(slug: string | undefined, team: Awaited<ReturnType<typeof currentTeam>>): Promise<AuthorFocus | null> {
  if (!slug || !SLUG.test(slug)) return null;
  const who = await prisma.person.findUnique({ where: { slug }, select: { id: true, slug: true, fullName: true } });
  if (!who) return null;
  const where = feedTeamFor(team, who.id);
  return { slug: who.slug as PersonSlug, name: who.fullName, here: where.here, team: where.team, current: team.name };
}

async function slugsOf(ids: string[]): Promise<PersonSlug[]> {
  if (!ids.length) return [];
  return (await prisma.person.findMany({ where: { id: { in: ids } }, select: { slug: true } })).map((p) => p.slug as PersonSlug);
}
