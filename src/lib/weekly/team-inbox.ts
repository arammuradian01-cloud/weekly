// Этап 73а: входящие weekly глазами получателя. Чтение использует прежнюю модель команд и отправленные снимки.
import { prisma } from "@/lib/db";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { loadTeamNodes, scopeOf, type TeamNode } from "@/lib/org/scope";
import { expectedOf, expectingTeams, leadersOf } from "@/lib/org/rhythm";
import { ceoSentReports, isCeo } from "@/lib/ceo/report";
import { dbDate } from "@/lib/tasks/dates";
import { currentReportingKey, getWeekView } from "./service";
import { isWeekKey } from "./weeks";
import { TOP_TEAM } from "@/domain/teams";

const sentTo = (id: string) => ({ array_contains: [{ id }] });

/** Общий вход не удостоверяет получателя: даже режим управления не открывает его личные входящие. */
export async function teamInboxScope(actor: Actor) {
  if (actor.via === "TEAM") return { allowed: false, teams: [] as TeamNode[] };
  const nodes = await loadTeamNodes(prisma);
  const scope = scopeOf(nodes, { id: actor.personId, role: actor.role });
  const teams = nodes.filter((n) => n.active && (n.leaderId === actor.personId || scope.leads.includes(n.id)));
  if (teams.length || await isCeo(actor.personId)) return { allowed: true, teams };
  // Сохраняем доступ прежнего получателя, даже если он больше не руководит командой, как в чтении снимков.
  const [team, ceo] = await Promise.all([
    prisma.teamWeeklyReport.count({ where: { sentAt: { not: null }, sentTo: sentTo(actor.personId), team: { active: true } } }),
    prisma.ceoReport.count({ where: { sentAt: { not: null }, sentTo: sentTo(actor.personId) } }),
  ]);
  return { allowed: team + ceo > 0, teams };
}

/** Кто читает личный weekly: руководители команд, в чью ленту он попадает по действующим правилам. */
export async function weeklyReaders(personId: string) {
  const nodes = await loadTeamNodes(prisma);
  const expected = expectingTeams(personId, nodes);
  const teams = nodes.filter((n) => n.active && (expected.some((t) => t.id === n.id) || n.members.includes(personId)) && n.leaderId !== personId);
  const ids = [...new Set(teams.flatMap((t) => t.leaderId ? [t.leaderId] : []))];
  const people = await prisma.person.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, fullName: true } });
  return teams.map((t) => ({ team: t.name, leader: people.find((p) => p.id === t.leaderId)?.fullName ?? null }));
}

export async function teamInboxView(actor: Actor, wantedWeek?: string, wantedTeam?: string) {
  const scope = await teamInboxScope(actor);
  if (!scope.allowed) throw new TaskRuleError("Отчёт по своей команде доступен руководителям и получателям отчётов при личном входе");
  const reporting = await currentReportingKey();
  const key = isWeekKey(wantedWeek) && wantedWeek <= reporting ? wantedWeek : reporting;
  const team = wantedTeam
    ? scope.teams.find((t) => t.id === wantedTeam)
    : scope.teams.find((t) => t.leaderId === actor.personId) ?? scope.teams[0];
  if (wantedTeam && !team) throw new TaskRuleError("Weekly этой команды вам недоступны");
  const [received, ceo, nodes] = await Promise.all([
    prisma.teamWeeklyReport.findMany({
      where: { week: { start: dbDate(key) }, sentAt: { not: null }, sentTo: sentTo(actor.personId), team: { active: true } },
      select: { id: true, team: { select: { id: true, name: true } }, sentAt: true, sentById: true, updatedAt: true },
      orderBy: { sentAt: "desc" },
    }),
    ceoSentReports(actor, key, { exact: true }),
    loadTeamNodes(prisma),
  ]);
  const senders = await prisma.person.findMany({ where: { id: { in: received.flatMap((r) => r.sentById ? [r.sentById] : []) } }, select: { id: true, fullName: true } });
  const memberIds = team ? [...new Set(team.id === TOP_TEAM ? [...team.members, ...(team.leaderId ? [team.leaderId] : [])] : team.members.filter((id) => id !== team.leaderId))] : [];
  const feed = team ? await getWeekView(key, new Date(), { personIds: expectedOf(team, leadersOf(nodes)), authorIds: memberIds, teamIds: [team.id], shared: false }) : null;
  const names = await prisma.person.findMany({ where: { id: { in: memberIds }, active: true }, select: { slug: true, fullName: true } });
  const reports = feed?.reports.map((r) => {
    const submitted = r.state === "submitted" || r.state === "late";
    return {
      ...r,
      name: names.find((p) => p.slug === r.author)?.fullName ?? r.author,
      // Здесь читают сданный weekly. В статусе черновика не передаём его содержимое браузеру.
      headline: submitted ? r.headline : "",
      thanks: submitted ? r.thanks : undefined,
      entries: submitted ? feed.entries.filter((e) => e.author === r.author || e.promoted?.some((p) => p.by === r.author)) : [],
    };
  }) ?? [];
  return {
    key, reporting, teams: scope.teams.map((t) => ({ id: t.id, name: t.name })), team: team ? { id: team.id, name: team.name } : null,
    reports,
    received: received.map((r) => ({ id: r.id, team: r.team, at: r.sentAt!.toISOString(), by: senders.find((p) => p.id === r.sentById)?.fullName ?? null, editedAfter: r.updatedAt > r.sentAt! })),
    ceo: ceo?.current?.key === key ? ceo : null,
  };
}
