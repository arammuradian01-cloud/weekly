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
import { isWeekKey, weekEndOf } from "./weeks";
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

/** Все факты недели человека, без учёта добавленных и скрытых */
async function allFacts(personId: string, key: WeekKey): Promise<WeekFact[]> {
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
  return [
    ...taskFacts(tasks, person.slug as PersonSlug, { start: b.start, end: b.end }),
    ...requests.map((r) => requestFact({ number: r.number, text: r.text, author: r.author.fullName, closedAt: moscowIso(r.closedAt!), answer: r.answer }, direction)),
  ];
}

/** Факты, которые стоит предложить: ещё не записи и не скрыты */
export async function weekFacts(personId: string, key: WeekKey): Promise<WeekFact[]> {
  if (!isWeekKey(key)) return [];
  const week = await prisma.week.findUnique({ where: { start: dbDate(key) }, select: { id: true } });
  const [facts, used, report] = await Promise.all([
    allFacts(personId, key),
    week ? prisma.weeklyEntry.findMany({ where: { weekId: week.id, authorId: personId, factKey: { not: null } }, select: { factKey: true } }) : [],
    week ? prisma.weeklyReport.findUnique({ where: { weekId_authorId: { weekId: week.id, authorId: personId } }, select: { hiddenFacts: true } }) : null,
  ]);
  const skip = new Set([...used.map((u) => u.factKey!), ...(report?.hiddenFacts ?? [])]);
  return facts.filter((f) => !skip.has(f.key));
}

/** Факт недели записью weekly: тип, блок и продукт из факта, правится потом как обычная запись */
export async function addFact(actor: Actor, key: WeekKey, factKey: string): Promise<WeeklyEntry> {
  if (!FACT_KEY.test(String(factKey))) fail("Такого факта нет");
  const fact = (await allFacts(actor.personId, key)).find((f) => f.key === factKey);
  if (!fact) return fail("Факт уже не актуален: обновите страницу");
  return saveEntry(actor, { week: key, direction: fact.direction, block: fact.block, type: fact.type, what: fact.what, details: fact.details, factKey: fact.key });
}

/** Скрыть факт: больше не предлагается в этом weekly */
export async function hideFact(actor: Actor, key: WeekKey, factKey: string): Promise<void> {
  if (!FACT_KEY.test(String(factKey))) fail("Такого факта нет");
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
