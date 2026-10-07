// Черновик weekly из фактов недели на сервере (этап 22б, модуль М6): какие факты предложить человеку, добавить факт
// записью, скрыть ненужный. Факт, который уже стал записью или скрыт, второй раз не предлагается.

import { prisma } from "@/lib/db";
import { toCalendar, addDays } from "@/domain/dates";
import type { DirectionCode } from "@/domain/dictionaries";
import type { PersonSlug, WeekKey, WeeklyEntry } from "@/domain/types";
import { moscowDateTime } from "@/lib/week";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { dbDate, moscowIso } from "@/lib/tasks/dates";
import { taskListInclude, toTaskDto } from "@/lib/tasks/dto";
import { isWeekKey, shiftWeek, weekEndOf } from "./weeks";
import { loadTeamNodes, TOP_TEAM } from "@/lib/org/scope";
import { PROMISE_GRACE_DAYS } from "./promises";
import { requestFact, taskFacts, type WeekFact } from "./facts";
import { canEdit, saveEntry, weekContext } from "./service";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

const FACT_KEY = /^(closed|moved|blocked|request):[0-9:-]{1,40}$/;

/** Границы недели по Москве: с понедельника до конца понедельника после неё */
function bounds(key: WeekKey) {
  const end = weekEndOf(key);
  return { start: key, end, from: moscowDateTime(toCalendar(key)), until: moscowDateTime(toCalendar(addDays(end, PROMISE_GRACE_DAYS + 1))) };
}

/** Кто смотрит. limited: общий логин без режима управления, видит только просьбы внутри топ-команды (этап 21) */
export type FactsViewer = { limited?: boolean };

/** Все факты недели человека, без учёта добавленных и скрытых */
async function allFacts(personId: string, key: WeekKey, viewer: FactsViewer = {}): Promise<WeekFact[]> {
  const b = bounds(key);
  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId }, select: { slug: true, defaultDirection: { select: { code: true } } } });
  const [taskRows, requests] = await Promise.all([
    prisma.task.findMany({
      where: {
        ownerId: personId,
        archivedAt: null,
        OR: [
          { closedAt: { gte: b.from, lt: b.until } },
          { transfers: { some: { at: { gte: b.from, lt: b.until } } } },
          { state: "BLOCKED", status: { in: ["IN_PROGRESS", "CLARIFY"] } },
        ],
      },
      include: taskListInclude,
      orderBy: { number: "asc" },
    }),
    prisma.helpRequest.findMany({
      where: { addresseeId: personId, status: "DONE", closedAt: { gte: b.from, lt: b.until } },
      include: { author: { select: { fullName: true } } },
      orderBy: { number: "asc" },
    }),
  ]);
  const tasks = taskRows.map((row) => toTaskDto({ ...row, comments: [] }));
  const direction = (person.defaultDirection?.code ?? "department") as DirectionCode;
  // По общему логину просьбы видны только между людьми топ-команды, как в самих просьбах
  let shown = requests;
  if (viewer.limited) {
    const topNode = (await loadTeamNodes(prisma)).find((n) => n.id === TOP_TEAM);
    const top = new Set([...(topNode?.leaderId ? [topNode.leaderId] : []), ...(topNode?.members ?? [])]);
    shown = requests.filter((r) => top.has(r.authorId) && top.has(personId));
  }
  return [
    ...taskFacts(tasks, person.slug as PersonSlug, { start: b.start, end: b.end }),
    ...shown.map((r) => requestFact({ number: r.number, text: r.text, author: r.author.fullName, closedAt: moscowIso(r.closedAt!), answer: r.answer }, direction)),
  ];
}

/** Ключи фактов, которые человек уже добавил записью или скрыл в неделе */
async function usedKeys(personId: string, key: WeekKey): Promise<string[]> {
  const week = await prisma.week.findUnique({ where: { start: dbDate(key) }, select: { id: true } });
  if (!week) return [];
  const [used, report] = await Promise.all([
    prisma.weeklyEntry.findMany({ where: { weekId: week.id, authorId: personId, factKey: { not: null } }, select: { factKey: true } }),
    prisma.weeklyReport.findUnique({ where: { weekId_authorId: { weekId: week.id, authorId: personId } }, select: { hiddenFacts: true } }),
  ]);
  return [...used.map((u) => u.factKey!), ...(report?.hiddenFacts ?? [])];
}

/**
 * Факты, которые стоит предложить: ещё не записи и не скрыты. Окно недели захватывает понедельник после неё, и это же
 * понедельник следующей недели: факт, добавленный или скрытый на прошлой неделе, второй раз не предлагается
 */
export async function weekFacts(personId: string, key: WeekKey, viewer: FactsViewer = {}): Promise<WeekFact[]> {
  if (!isWeekKey(key)) return [];
  const [facts, mine, prev] = await Promise.all([allFacts(personId, key, viewer), usedKeys(personId, key), usedKeys(personId, shiftWeek(key, -1))]);
  const skip = new Set([...mine, ...prev]);
  return facts.filter((f) => !skip.has(f.key));
}

/** Какие ключи уже заняты: экран пересчитывает факты по задачам сам и убирает занятые (этап 22) */
export async function skippedFactKeys(personId: string, key: WeekKey): Promise<string[]> {
  if (!isWeekKey(key)) return [];
  const [mine, prev] = await Promise.all([usedKeys(personId, key), usedKeys(personId, shiftWeek(key, -1))]);
  return [...new Set([...mine, ...prev])];
}

/** Блок или тип, скрытый в справочнике: берём первый открытый, чтобы факт всё равно стал записью */
async function openCode(kind: "WEEKLY_BLOCK" | "ENTRY_TYPE", wanted: string): Promise<string> {
  const item = await prisma.dictionaryItem.findFirst({ where: { kind, code: wanted, active: true }, select: { code: true } });
  if (item) return wanted;
  const first = await prisma.dictionaryItem.findFirst({ where: { kind, active: true }, orderBy: { sortOrder: "asc" }, select: { code: true } });
  return first?.code ?? wanted;
}

/** Факт недели записью weekly: тип, блок и продукт из факта, правится потом как обычная запись */
export async function addFact(actor: Actor, key: WeekKey, factKey: string): Promise<WeeklyEntry> {
  if (!FACT_KEY.test(String(factKey))) fail("Такого факта нет");
  const limited = actor.via === "TEAM" && !actor.management;
  const fact = (await allFacts(actor.personId, key, { limited })).find((f) => f.key === factKey);
  if (!fact) return fail("Факт уже не актуален: обновите страницу");
  const [block, type] = await Promise.all([openCode("WEEKLY_BLOCK", fact.block), openCode("ENTRY_TYPE", fact.type)]);
  return saveEntry(actor, { week: key, direction: fact.direction, block, type, what: fact.what, details: fact.details, factKey: fact.key });
}

/** Скрыть факт: больше не предлагается в этом weekly. Скрыть можно только факт, который есть */
export async function hideFact(actor: Actor, key: WeekKey, factKey: string): Promise<void> {
  if (!FACT_KEY.test(String(factKey))) fail("Такого факта нет");
  const limited = actor.via === "TEAM" && !actor.management;
  if (!(await allFacts(actor.personId, key, { limited })).some((f) => f.key === factKey)) fail("Факт уже не актуален: обновите страницу");
  await prisma.$transaction(async (tx) => {
    const { row, info, reporting } = await weekContext(tx, key, actor.personId);
    canEdit(info, reporting, actor, actor.slug);
    const report = await tx.weeklyReport.upsert({
      where: { weekId_authorId: { weekId: row.id, authorId: actor.personId } },
      update: {},
      create: { weekId: row.id, authorId: actor.personId, state: "DRAFT" },
    });
    if (report.hiddenFacts.includes(factKey)) return;
    await tx.weeklyReport.update({ where: { id: report.id }, data: { hiddenFacts: { push: factKey } } });
  });
}
