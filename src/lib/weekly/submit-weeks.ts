// Weekly за прошлые недели (этап 73). Решение Арама 23.10: «нет возможности отправить weekly за старые недели, если они
// не были отправлены». Сервер и раньше разрешал писать свой weekly за прошлую неделю, пока она открыта (canEditWeekly),
// а экран сдачи всегда брал отчётную неделю. Здесь то, что нужно экрану сдачи для любой недели:
// - переключатель: отчётная и прошлые недели с состоянием «сдан», «сдан с опозданием», «черновик», «не сдан», «закрыта»;
// - кто может открыть закрытую неделю;
// - отправлен ли уже отчёт руководителю (или отчёт команды), куда идут записи автора: тогда записи попадут в ленту и в
//   отчёт команды, но в отправленный отчёт сами не войдут.

import { prisma } from "@/lib/db";
import type { WeekKey } from "@/domain/types";
import { dbDate, isoFromDbDate } from "@/lib/tasks/dates";
import { TOP_TEAM, loadTeamNodes, teamPeopleIds } from "@/lib/org/scope";
import { closedFor, expectingTeams, leadersOf } from "@/lib/org/rhythm";
import { currentReportingKey, STATE_CODE } from "./service";
import { shiftWeek, weekEndOf, weekNumberOf } from "./weeks";
import { SUBMIT_WEEKS, closedWeekHint, submitWeekState, type SentReportNote, type SubmitWeekState } from "./rules";

export type SubmitWeekOption = {
  key: WeekKey;
  number: number;
  start: string;
  end: string;
  reporting: boolean;
  /** Неделя закрыта для weekly этого человека: закрыл администратор или все команды, которые ждут его weekly */
  closed: boolean;
  state: SubmitWeekState;
  submittedAt?: string;
};

const names = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => (v && typeof v === "object" ? String((v as { name?: unknown }).name ?? "") : "")).filter(Boolean) : [];

/**
 * Недели для переключателя экрана сдачи: отчётная и прошлые (SUBMIT_WEEKS штук), свежие первыми. selected: открытая
 * неделя старше списка, она тоже попадает в список. Строки недель не создаются: неделя без строки открыта и пуста
 */
export async function submitWeeks(personId: string, selected?: WeekKey | null, now = new Date()): Promise<SubmitWeekOption[]> {
  const reporting = await currentReportingKey(now);
  const keys = Array.from({ length: SUBMIT_WEEKS }, (_, i) => shiftWeek(reporting, -i));
  if (selected && selected < keys[keys.length - 1]! && selected <= reporting) keys.push(selected);
  const [rows, nodes] = await Promise.all([
    prisma.week.findMany({ where: { start: { in: keys.map((k) => dbDate(k)) } }, select: { id: true, start: true, isoNumber: true, closedAt: true } }),
    loadTeamNodes(prisma),
  ]);
  const ids = rows.map((r) => r.id);
  const [reports, closes] = ids.length
    ? await Promise.all([
        prisma.weeklyReport.findMany({ where: { authorId: personId, weekId: { in: ids } }, select: { weekId: true, state: true, submittedAt: true } }),
        prisma.teamWeekClose.findMany({ where: { weekId: { in: ids } }, select: { weekId: true, teamId: true } }),
      ])
    : [[], []];
  const leaders = leadersOf(nodes);
  return keys.map((key) => {
    const row = rows.find((r) => isoFromDbDate(r.start) === key);
    const report = row ? reports.find((r) => r.weekId === row.id) : undefined;
    const closedTeams = new Set(row ? closes.filter((c) => c.weekId === row.id).map((c) => c.teamId) : []);
    const closed = row ? closedFor(personId, nodes, row.closedAt !== null, closedTeams, leaders) : false;
    const state = report ? STATE_CODE[report.state] : "not-started";
    return {
      key,
      number: row?.isoNumber ?? weekNumberOf(key),
      start: key,
      end: weekEndOf(key),
      reporting: key === reporting,
      closed,
      state: submitWeekState(state, closed),
      ...(report?.submittedAt ? { submittedAt: report.submittedAt.toISOString() } : {}),
    };
  });
}

/** Кто закрыл неделю для weekly человека и кто может её открыть. null: неделя для него открыта */
export async function closedWeekText(personId: string, key: WeekKey): Promise<string | null> {
  const row = await prisma.week.findUnique({ where: { start: dbDate(key) }, select: { id: true, isoNumber: true, closedAt: true } });
  if (!row) return null;
  if (row.closedAt) return closedWeekHint(row.isoNumber, true, []);
  const [nodes, closes] = await Promise.all([loadTeamNodes(prisma), prisma.teamWeekClose.findMany({ where: { weekId: row.id }, select: { teamId: true } })]);
  const closedTeams = new Set(closes.map((c) => c.teamId));
  const leaders = leadersOf(nodes);
  if (!closedFor(personId, nodes, false, closedTeams, leaders)) return null;
  let teams = expectingTeams(personId, nodes, leaders);
  if (!teams.length) teams = nodes.filter((n) => n.active && n.members.includes(personId));
  const people = await prisma.person.findMany({ where: { id: { in: teams.map((t) => t.leaderId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
  return closedWeekHint(
    row.isoNumber,
    false,
    teams.filter((t) => closedTeams.has(t.id)).map((t) => ({ name: t.name, leader: people.find((p) => p.id === t.leaderId)?.fullName ?? null })),
  );
}

/**
 * Отправленные отчёты руководителю за неделю, куда идут записи человека: отчёты команд, где он руководитель или
 * участник (отчёт команды собирается из weekly её людей), и отчёт команды страхования и инвестиций (бывший отчёт CEO),
 * если он в ней
 */
export async function sentReportsFor(personId: string, key: WeekKey): Promise<SentReportNote[]> {
  const week = await prisma.week.findUnique({ where: { start: dbDate(key) }, select: { id: true } });
  if (!week) return [];
  const nodes = (await loadTeamNodes(prisma)).filter((n) => n.active && teamPeopleIds(n).includes(personId));
  if (!nodes.length) return [];
  const others = nodes.filter((n) => n.id !== TOP_TEAM);
  const [top, teams] = await Promise.all([
    nodes.some((n) => n.id === TOP_TEAM) ? prisma.ceoReport.findUnique({ where: { weekId: week.id }, select: { sentAt: true, sentTo: true } }) : Promise.resolve(null),
    others.length
      ? prisma.teamWeeklyReport.findMany({ where: { weekId: week.id, teamId: { in: others.map((n) => n.id) }, sentAt: { not: null } }, select: { teamId: true, sentAt: true, sentTo: true } })
      : Promise.resolve([]),
  ]);
  const out: SentReportNote[] = [];
  if (top?.sentAt) out.push({ team: nodes.find((n) => n.id === TOP_TEAM)!.name, at: top.sentAt.toISOString(), to: names(top.sentTo) });
  for (const r of teams) out.push({ team: others.find((n) => n.id === r.teamId)?.name ?? "", at: r.sentAt!.toISOString(), to: names(r.sentTo) });
  return out;
}
