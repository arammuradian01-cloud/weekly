// Чтение живых данных для замера перед пересборкой экрана «Сдать weekly» (этап 87).
//
// Только чтение: findMany и findUnique, ни одной записи в базу. Правило шаблона автора берётся из приложения
// (templateForAuthor), правило переезда и предел строки — из src/lib/weekly-measure/survey.ts, который опирается на
// entryBlockKey, entryText и BLOCK_LIMITS. Строка подключения приходит из переменной окружения, как у остальных
// команд в scripts/.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { dbDate, isoFromDbDate } from "@/lib/tasks/dates";
import { currentReportingKey } from "@/lib/weekly/service";
import { loadTeamNodes, teamPeopleIds, type TeamNode } from "@/lib/org/scope";
import { authorTemplateTeams, templateForAuthor } from "@/lib/weekly-blocks/author";
import { cleanTemplate, effectiveTemplate } from "@/lib/weekly-blocks/types";
import { survey, type MeasureAuthor, type MeasureEntry, type MeasureInput, type MeasureTeam, type MeasureWeek, type Survey } from "./survey";

/** Период по умолчанию: 12 недель на привычку и 4 последние недели на выборку миграции (решение 8) */
export const PERIOD_WEEKS = 12;
export const RECENT_WEEKS = 4;

const NO_AUTHOR = "Без автора (общая запись)";

const entrySelect = {
  id: true,
  weekId: true,
  authorId: true,
  section: true,
  what: true,
  fact: true,
  impact: true,
  next: true,
  help: true,
  links: true,
  author: { select: { fullName: true } },
  direction: { select: { code: true } },
  block: { select: { code: true, label: true } },
  type: { select: { code: true } },
} satisfies Prisma.WeeklyEntrySelect;

const linkCount = (value: unknown): number => (Array.isArray(value) ? value.filter((l) => !!l && typeof l === "object" && typeof (l as { url?: unknown }).url === "string").length : 0);

/** Команды человека по порядку правила шаблона: сначала те, что ждут его weekly, затем остальные (как в templateForAuthor) */
function orderOf(personId: string, nodes: TeamNode[]): string[] {
  return authorTemplateTeams(personId, nodes).map((n) => n.id);
}

/** Команды, чей отчёт видит записи человека: где он руководитель или участник */
const showingOf = (personId: string, nodes: TeamNode[]): string[] => nodes.filter((n) => n.active && teamPeopleIds(n).includes(personId)).map((n) => n.id);

export type CollectOptions = { weeks?: number; recent?: number; now?: Date };

/** Живые данные замера: недели периода, записи, команды с шаблонами, авторы с их командами */
export async function collect(opts: CollectOptions = {}): Promise<MeasureInput> {
  const take = Math.max(opts.recent ?? RECENT_WEEKS, opts.weeks ?? PERIOD_WEEKS);
  const recent = opts.recent ?? RECENT_WEEKS;
  const reporting = await currentReportingKey(opts.now);
  const weekRows = await prisma.week.findMany({
    where: { start: { lte: dbDate(reporting) } },
    orderBy: { start: "desc" },
    take,
    select: { id: true, start: true, isoNumber: true, isoYear: true },
  });
  const weeks: MeasureWeek[] = weekRows.map((w) => {
    const key = isoFromDbDate(w.start);
    return { key, number: w.isoNumber, year: w.isoYear, current: key === reporting };
  });
  const keyOfWeek = new Map(weekRows.map((w, i) => [w.id, weeks[i]!.key]));

  const rows = weekRows.length
    ? await prisma.weeklyEntry.findMany({ where: { weekId: { in: weekRows.map((w) => w.id) } }, select: entrySelect, orderBy: [{ createdAt: "asc" }] })
    : [];
  const entries: MeasureEntry[] = rows.map((e) => ({
    id: e.id,
    weekKey: keyOfWeek.get(e.weekId) ?? "",
    authorId: e.authorId,
    authorName: e.author?.fullName ?? NO_AUTHOR,
    direction: e.direction.code,
    block: e.block.code,
    blockLabel: e.block.label,
    type: e.type.code,
    section: e.section,
    what: e.what,
    fact: e.fact,
    impact: e.impact,
    next: e.next,
    help: e.help,
    links: linkCount(e.links),
  }));

  const nodes = await loadTeamNodes(prisma);
  const live = nodes.filter((n) => n.active);
  const templateRows = await prisma.teamWeeklyTemplate.findMany({ select: { teamId: true, blocks: true } });
  const teams: MeasureTeam[] = live.map((n) => {
    const blocks = cleanTemplate(templateRows.find((r) => r.teamId === n.id)?.blocks ?? null);
    return { id: n.id, name: n.name, template: blocks.length ? blocks : null, effective: effectiveTemplate(blocks) };
  });

  // Авторы замера: все, кто сдавал записи за период, и все, кто состоит в двух и более командах
  const everyone = new Set<string>();
  for (const n of live) for (const id of teamPeopleIds(n)) everyone.add(id);
  const candidates = new Set<string>();
  for (const id of everyone) if (orderOf(id, nodes).length >= 2) candidates.add(id);
  for (const e of entries) if (e.authorId) candidates.add(e.authorId);

  const people = candidates.size ? await prisma.person.findMany({ where: { id: { in: [...candidates] } }, select: { id: true, fullName: true } }) : [];
  const authors: MeasureAuthor[] = [];
  for (const id of candidates) {
    const own = await templateForAuthor(id, prisma);
    authors.push({
      personId: id,
      name: people.find((p) => p.id === id)?.fullName ?? entries.find((e) => e.authorId === id)?.authorName ?? id,
      order: orderOf(id, nodes),
      showing: showingOf(id, nodes),
      templateTeamId: own?.teamId ?? null,
    });
  }

  return { weeks, recent, entries, teams, authors, teamsTotal: live.length };
}

/** Замер целиком: прочитать живые данные и посчитать пять ответов */
export async function measure(opts: CollectOptions = {}): Promise<Survey> {
  return survey(await collect(opts));
}
