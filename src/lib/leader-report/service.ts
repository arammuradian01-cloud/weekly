// Раздел «Отчёт руководителю» (этап 73+81): две вкладки, «Отправленные» и «Полученные».
//
// Вкладка «Полученные» это экран получателя этапа 73а (PR #84 Codex, ветка etap-73a-otchet-moey-komandy): полученные
// сводные отчёты и сданные weekly своих сотрудников. К полученному отчёту здесь добавлен комментарий руководителя
// (этап 73+81). Вкладка «Отправленные» показывает ровно ту версию, которая ушла, и ответы в обсуждении.
//
// Ничего не пересобирается: отправленные снимки этапа 66 только читаются, права считаются на сервере.

import { prisma } from "@/lib/db";
import type { WeekKey } from "@/domain/types";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { TOP_TEAM, loadTeamNodes, scopeOf, type TeamNode } from "@/lib/org/scope";
import { expectedOf, expectingTeams, leadersOf } from "@/lib/org/rhythm";
import { ceoSentReports, isCeo, type CeoInboxView } from "@/lib/ceo/report";
import { currentReportingKey, getWeekView } from "@/lib/weekly/service";
import { isWeekKey, shiftWeek, weekNumberOf } from "@/lib/weekly/weeks";
import { reportComments, type ReportCommentsView } from "./comments";
import { receivedReportsOf, reportWeeksOf, sentReportsOf, type SentReport } from "./reports";
import { defaultTab, isReportTab, type ReportTab } from "./rules";

const sentTo = (id: string) => ({ array_contains: [{ id }] });

/** Кто в разделе: команды, которыми человек руководит, и открыт ли ему раздел вообще */
export type LeaderReportScope = { allowed: boolean; canLead: boolean; teams: TeamNode[]; nodes: TeamNode[] };

/** Кому считаем доступ: столько полей, сколько нужно оболочке страниц, без полного Actor */
export type ReportViewer = Pick<Actor, "personId" | "role" | "via" | "management">;

/**
 * Общий логин не удостоверяет человека: даже режим управления по нему не открывает чужую переписку с руководителем.
 * Раздел открыт при личном входе тем, кто руководит командой, кто CEO, кому отчёты отправляли, и владельцам с
 * администраторами в режиме управления: они и так ведут отчёт CEO и отчёты команд
 */
export async function leaderReportScope(actor: ReportViewer): Promise<LeaderReportScope> {
  // Расчёт идёт на каждой странице (пункт меню), поэтому выходим как можно раньше и считаем остальное разом
  if (actor.via === "TEAM" || actor.role === "OBSERVER") return { allowed: false, canLead: false, teams: [], nodes: [] };
  const nodes = await loadTeamNodes(prisma);
  const scope = scopeOf(nodes, { id: actor.personId, role: actor.role });
  const teams = nodes.filter((n) => n.active && (n.leaderId === actor.personId || scope.leads.includes(n.id)));
  const canLead = teams.length > 0;
  if (canLead || actor.management === "OWNER" || actor.management === "ADMIN") return { allowed: true, canLead, teams, nodes };
  // Прежний получатель остаётся с доступом, даже если больше не руководит командой: отправленное ему не исчезает
  const [ceo, team, ceoReports] = await Promise.all([
    isCeo(actor.personId),
    prisma.teamWeeklyReport.count({ where: { sentAt: { not: null }, sentTo: sentTo(actor.personId), team: { active: true } } }),
    prisma.ceoReport.count({ where: { sentAt: { not: null }, sentTo: sentTo(actor.personId) } }),
  ]);
  return { allowed: ceo || team + ceoReports > 0, canLead, teams, nodes };
}

/** Виден ли человеку пункт меню «Отчёт руководителю»: тот же расчёт, что у страницы */
export async function canSeeLeaderReport(actor: ReportViewer): Promise<boolean> {
  return (await leaderReportScope(actor)).allowed;
}

/** Кто читает личный weekly: руководители команд, в чью ленту он попадает по действующим правилам */
export async function weeklyReaders(personId: string): Promise<{ team: string; leader: string | null }[]> {
  const nodes = await loadTeamNodes(prisma);
  const expected = expectingTeams(personId, nodes);
  const teams = nodes.filter((n) => n.active && (expected.some((t) => t.id === n.id) || n.members.includes(personId)) && n.leaderId !== personId);
  const ids = [...new Set(teams.flatMap((t) => (t.leaderId ? [t.leaderId] : [])))];
  const people = await prisma.person.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, fullName: true } });
  return teams.map((t) => ({ team: t.name, leader: people.find((p) => p.id === t.leaderId)?.fullName ?? null }));
}

/** Отчёт с его перепиской: так его показывают обе вкладки */
export type ReportWithComments = { report: SentReport; comments: ReportCommentsView };

/** Weekly одного сотрудника в «Полученных» */
export type PersonWeeklyRow = Awaited<ReturnType<typeof peopleWeekly>>[number];

/** Сводный заголовок раздела: что открыто и за какую неделю */
export type LeaderReportView = {
  tab: ReportTab;
  key: WeekKey;
  number: number;
  reporting: WeekKey;
  prev: WeekKey;
  next: WeekKey | null;
  /** Недели, за которые в разделе есть отчёты: подсказка под переключателем */
  weeks: { key: WeekKey; number: number }[];
  canLead: boolean;
  /** «Отправленные»: мои отправленные отчёты за эту неделю и куда идти собирать отчёт */
  sent: ReportWithComments[];
  drafts: { teamId: string; teamName: string; href: string }[];
  /** «Полученные»: отчёты, отправленные мне, и weekly моих сотрудников */
  received: ReportWithComments[];
  ceo: CeoInboxView | null;
  teams: { id: string; name: string }[];
  team: { id: string; name: string } | null;
  people: PersonWeeklyRow[];
  expected: { required: number; submitted: number; absent: number };
};

/** Weekly сотрудников выбранной команды за неделю: сданные с содержимым, несданные только состоянием */
async function peopleWeekly(team: TeamNode, nodes: TeamNode[], key: WeekKey) {
  const memberIds = [
    ...new Set(team.id === TOP_TEAM ? [...team.members, ...(team.leaderId ? [team.leaderId] : [])] : team.members.filter((id) => id !== team.leaderId)),
  ];
  const feed = await getWeekView(key, new Date(), {
    personIds: expectedOf(team, leadersOf(nodes)),
    authorIds: memberIds,
    teamIds: [team.id],
    shared: false,
    includeInactiveSubmitted: true,
  });
  const names = await prisma.person.findMany({ where: { id: { in: memberIds } }, select: { slug: true, fullName: true, active: true } });
  return feed.reports.map((r) => {
    const person = names.find((p) => p.slug === r.author);
    const submitted = r.state === "submitted" || r.state === "late";
    return {
      ...r,
      name: person?.fullName ?? r.author,
      inactive: person?.active === false,
      // Здесь читают сданный weekly: содержимое черновика в данные страницы не уходит
      headline: submitted ? r.headline : "",
      thanks: submitted ? r.thanks : undefined,
      entries: submitted
        ? feed.entries
            .filter((e) => e.author === r.author || e.promoted?.some((p) => p.by === r.author))
            // В одном отчёте видна только фраза его автора: чужое пояснение не передаём даже в данных страницы
            .map((e) => ({ ...e, ...(e.promoted ? { promoted: e.promoted.map((p) => (p.by === r.author ? p : { by: p.by })) } : {}) }))
        : [],
    };
  });
}

async function withComments(actor: Actor, reports: SentReport[]): Promise<ReportWithComments[]> {
  return Promise.all(reports.map(async (report) => ({ report, comments: await reportComments(actor, report) })));
}

/**
 * Раздел целиком. wantedWeek: неделя из адреса, не позже отчётной; без неё отчётная. wantedTeam: команда, чьи weekly
 * сотрудников читают в «Полученных». wantedTab: вкладка из адреса
 */
export async function leaderReportView(actor: Actor, params: { week?: string; team?: string; tab?: string } = {}): Promise<LeaderReportView> {
  const scope = await leaderReportScope(actor);
  if (!scope.allowed) throw new TaskRuleError("Раздел «Отчёт руководителю» открыт руководителям команд и тем, кому отчёты отправляют, при личном входе");
  const reporting = await currentReportingKey();
  const key = isWeekKey(params.week) && params.week <= reporting ? (params.week as WeekKey) : reporting;
  // Недели раздела и вкладка по умолчанию считаются по лёгкому списку, без снимков отчётов
  const [history, weekSent, weekReceived] = await Promise.all([reportWeeksOf(actor), sentReportsOf(actor, [key]), receivedReportsOf(actor, [key])]);
  const tab = isReportTab(params.tab) ? params.tab : defaultTab({ canLead: scope.canLead, hasSent: history.hasSent, hasReceived: history.hasReceived });
  const team = params.team ? scope.teams.find((t) => t.id === params.team) : (scope.teams.find((t) => t.leaderId === actor.personId) ?? scope.teams[0]);
  if (params.team && !team) throw new TaskRuleError("Weekly этой команды вам недоступны");
  const [sent, received, ceo, people] = await Promise.all([
    tab === "sent" ? withComments(actor, weekSent) : Promise.resolve([]),
    tab === "received" ? withComments(actor, weekReceived) : Promise.resolve([]),
    // Отчёт CEO глазами CEO собирается как на странице «Отчёт CEO»: цифры, решения и благодарности живыми за ту неделю
    tab === "received" && weekReceived.some((r) => r.kind === "ceo") ? ceoSentReports(actor, key, { exact: true }) : Promise.resolve(null),
    tab === "received" && team ? peopleWeekly(team, scope.nodes, key) : Promise.resolve([]),
  ]);
  const required = people.filter((r) => !r.inactive && !r.optional && !r.absent);
  const done = (state: string) => state === "submitted" || state === "late";
  // Собрать отчёт идут туда, где его и собирают: отчёт топ-команды это «Отчёт CEO», у остальных «Weekly команды»
  const drafts = scope.teams.map((t) => ({
    teamId: t.id,
    teamName: t.name,
    href: t.id === TOP_TEAM ? `/ceo-report?week=${key}` : `/weekly/team-report?team=${encodeURIComponent(t.id)}&week=${key}`,
  }));
  return {
    tab,
    key,
    number: weekNumberOf(key),
    reporting,
    prev: shiftWeek(key, -1),
    next: key < reporting ? shiftWeek(key, 1) : null,
    weeks: history.weeks,
    canLead: scope.canLead,
    sent,
    drafts,
    received,
    ceo: ceo?.current?.key === key ? ceo : null,
    teams: scope.teams.map((t) => ({ id: t.id, name: t.name })),
    team: team ? { id: team.id, name: team.name } : null,
    people,
    expected: { required: required.length, submitted: required.filter((r) => done(r.state)).length, absent: people.filter((r) => !r.inactive && r.absent).length },
  };
}
