// Этап 76 на настоящей базе: миграция удаления «Один на один» (повтор безопасен, задачи из тем остаются обычными
// задачами, события очереди и таблицы удалены, журнал понятен), старые события и записи журнала не ломают экраны,
// строки «Не сдан weekly за неделю N» на «Моей неделе»
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import { inboxCount, listInbox, markDone } from "@/lib/inbox/service";
import { journalEvents } from "@/lib/journal";
import { MISSED_WEEKS_BACK, currentReportingKey, ensureWeek, missedWeeks } from "@/lib/weekly/service";
import { shiftWeek } from "@/lib/weekly/weeks";
import { TOP_TEAM } from "@/lib/org/scope";
import { dbDate, moscowToday } from "@/lib/tasks/dates";

const OLD = readFileSync("prisma/migrations/20261011220000_one_on_one/migration.sql", "utf8");
const NEW = readFileSync("prisma/migrations/20261023120000_remove_one_on_one/migration.sql", "utf8");
const TABLES = ["one_on_one_pairs", "one_on_ones", "one_on_one_topics", "one_on_one_notes"];

let db: pg.Client;
const idOf = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;
const tableCount = async () => Number((await db.query(`SELECT count(*) AS n FROM unnest($1::text[]) t WHERE to_regclass('public.' || t) IS NOT NULL`, [TABLES])).rows[0].n);
const typeCount = async () => Number((await db.query(`SELECT count(*) AS n FROM pg_type WHERE typname IN ('OneOnOneStatus', 'OneOnOneTopicStatus')`)).rows[0].n);

beforeAll(async () => {
  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { number: { gte: 7600, lt: 7610 } } });
  await db.end();
  await prisma.$disconnect();
});

describe("миграция удаления «Один на один»", () => {
  it("после миграций таблиц и типов нет; повтор на чистой базе ничего не ломает", async () => {
    expect(await tableCount()).toBe(0);
    expect(await typeCount()).toBe(0);
    expect(await prisma.inboxEvent.count({ where: { kind: "ONE_ON_ONE" } })).toBe(0);
    await db.query(NEW);
    await db.query(NEW);
    expect(await tableCount()).toBe(0);
  });

  it("с данными: задачи из тем остаются обычными задачами с подписью источника, события и таблицы удалены, в журнале одна понятная запись", async () => {
    const [aram, reva] = [await idOf("muradyan"), await idOf("reva")];
    const directionId = (await prisma.dictionaryItem.findFirstOrThrow({ where: { kind: "DIRECTION", code: "department" } })).id;
    const today = moscowToday();
    const task = (number: number, sourceNote: string | null) =>
      prisma.task.create({
        data: { number, title: `Задача из темы ${number}`, outcome: "Договорились", directionId, due: dbDate(today), whereUpdatedAt: dbDate(today), teamId: TOP_TEAM, ownerId: reva, createdById: aram, sourceCode: "other", sourceNote },
      });
    // Подпись стёрли после постановки; у второй задачи своя подпись, её не трогаем
    const erased = await task(7601, null);
    const own = await task(7602, "Своя подпись");

    // Таблицы этапа 28 как на рабочей базе до этапа 76: миграция этапа 28 повторяемая и создаёт их заново
    await db.query(OLD);
    expect(await tableCount()).toBe(4);
    await db.query(`INSERT INTO one_on_one_pairs (id, "managerId", "reportId") VALUES ('p76', $1, $2)`, [aram, reva]);
    await db.query(`INSERT INTO one_on_ones (id, "pairId", date, status, notes, "updatedAt") VALUES ('m76a', 'p76', CURRENT_DATE - 7, 'DONE', 'Личное содержимое встречи', now()), ('m76b', 'p76', CURRENT_DATE + 7, 'PLANNED', '', now())`);
    await db.query(
      `INSERT INTO one_on_one_topics (id, "pairId", "authorId", text, status, "meetingId", "taskId") VALUES ('t76a', 'p76', $1, 'Тема А', 'DISCUSSED', 'm76a', $2), ('t76b', 'p76', $1, 'Тема Б', 'DISCUSSED', 'm76a', $3), ('t76c', 'p76', $1, 'Тема В', 'OPEN', NULL, NULL)`,
      [reva, erased.id, own.id],
    );
    await db.query(`INSERT INTO one_on_one_notes (id, "meetingId", "authorId", text, "updatedAt") VALUES ('n76', 'm76a', $1, 'Личная заметка', now())`, [aram]);
    const event = await prisma.inboxEvent.create({ data: { recipientId: reva, kind: "ONE_ON_ONE", subject: "1on1:p76", actorName: "Мурадян Арам", text: "Встреча один на один назначена" } });
    const mark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? 0n;

    await db.query(NEW);
    // Повтор после перезапуска контейнера: таблиц уже нет, второй записи в журнал и ошибок нет
    await db.query(NEW);

    expect(await tableCount()).toBe(0);
    expect(await typeCount()).toBe(0);
    expect(await prisma.inboxEvent.findUnique({ where: { id: event.id } })).toBeNull();
    // Задачи на месте: источник «Другое», подпись вернулась только стёртой
    const after = await prisma.task.findMany({ where: { number: { in: [7601, 7602] } }, orderBy: { number: "asc" }, select: { number: true, sourceCode: true, sourceNote: true, ownerId: true } });
    expect(after).toEqual([
      { number: 7601, sourceCode: "other", sourceNote: "Встреча один на один", ownerId: reva },
      { number: 7602, sourceCode: "other", sourceNote: "Своя подпись", ownerId: reva },
    ]);
    // Задачи работают как обычные: статус, «где сейчас», карточка
    const actor = await tasks.actorFor("reva");
    await tasks.updateWhere(actor, 7601, "Договор у юристов");
    await tasks.changeStatus(actor, 7601, "done", "Подписали");
    const card = await tasks.getTask(7601);
    expect(card).toMatchObject({ number: 7601, status: "done", source: { kind: "other", note: "Встреча один на один" } });

    // Журнал: одна системная запись со счётом, без содержимого встреч, на экране журнала словами
    const rows = await prisma.auditLog.findMany({ where: { id: { gt: mark }, action: "system.oneOnOne.removed" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "SYSTEM", entity: "one-on-one", actorId: null });
    expect(String(rows[0]!.after)).toContain("пар 1, встреч 2, тем 3");
    expect(String(rows[0]!.after)).toContain("Задачи из тем (2)");
    expect(JSON.stringify({ ...rows[0], id: String(rows[0]!.id) })).not.toMatch(/Личн|Тема [АБВ]/);
    const page = await journalEvents({ limit: 20 });
    const shown = page.events.find((e) => e.id === `a${rows[0]!.id}`);
    expect(shown).toMatchObject({ kind: "system", by: "system", source: "system", object: "Раздел «Один на один» удалён" });
  });

  it("старые записи журнала о встречах один на один читаются словами, экран журнала не падает", async () => {
    await prisma.auditLog.create({ data: { action: "oneOnOne.topic.add", entity: "one-on-one", entityId: "p-old", actorName: "Рева Тарас", after: "тема" } });
    const page = await journalEvents({ limit: 5 });
    expect(page.events[0]).toMatchObject({ object: "Встреча один на один (раздел удалён)", kind: "system" });
  });
});

describe("старое событие встречи один на один в очереди", () => {
  it("если оно где-то осталось: видно строкой без ссылки, считается и разбирается без ошибок", async () => {
    const reva = await idOf("reva");
    const before = await inboxCount(reva);
    const left = await prisma.inboxEvent.create({ data: { recipientId: reva, kind: "ONE_ON_ONE", subject: "1on1:left", text: "Встреча один на один перенесена" } });
    try {
      const item = (await listInbox(reva)).items.find((i) => i.subject === "1on1:left");
      expect(item).toMatchObject({ taskNumber: null, entryId: null, requestNumber: null, text: "Встреча один на один перенесена" });
      expect(await inboxCount(reva)).toBe(before + 1);
      expect(await markDone(await tasks.actorFor("reva"), "1on1:left")).toBe(1);
      expect((await listInbox(reva)).items.some((i) => i.subject === "1on1:left")).toBe(false);
    } finally {
      await prisma.inboxEvent.deleteMany({ where: { id: left.id } });
    }
  });
});

describe("«Не сдан weekly за неделю N»", () => {
  it("прошлые открытые недели без сданного weekly, до четырёх, свежие сверху; сданные, отсутствие, закрытые и до прихода в ресурс не считаются", async () => {
    const reva = await idOf("reva");
    const person = await prisma.person.findUniqueOrThrow({ where: { id: reva }, select: { createdAt: true } });
    const reporting = await currentReportingKey();
    const keys = Array.from({ length: MISSED_WEEKS_BACK + 1 }, (_, i) => shiftWeek(reporting, -(i + 1)));
    const weeks = [];
    for (const key of keys) weeks.push(await ensureWeek(prisma, key));
    const ids = weeks.map((w) => w.id);
    const reset = async () => {
      await prisma.weeklyReport.deleteMany({ where: { authorId: reva, weekId: { in: ids } } });
      await prisma.absence.deleteMany({ where: { personId: reva, weekId: { in: ids } } });
      await prisma.week.updateMany({ where: { id: { in: ids } }, data: { closedAt: null } });
    };
    try {
      await reset();
      await prisma.person.update({ where: { id: reva }, data: { createdAt: new Date("2020-01-01T00:00:00Z") } });
      // Ничего не сдано: четыре последние недели, пятая уже за окном
      expect((await missedWeeks(reva)).map((w) => w.key)).toEqual(keys.slice(0, 4));
      expect((await missedWeeks(reva))[0]).toMatchObject({ key: keys[0], number: weeks[0]!.isoNumber, start: keys[0] });

      // Неделя -1 сдана, -2 с опозданием, -3 черновик (не сдан), -4 отсутствие
      await prisma.weeklyReport.create({ data: { weekId: ids[0]!, authorId: reva, state: "SUBMITTED", submittedAt: new Date(), headline: "Сдано" } });
      await prisma.weeklyReport.create({ data: { weekId: ids[1]!, authorId: reva, state: "LATE", submittedAt: new Date(), headline: "Сдано позже" } });
      await prisma.weeklyReport.create({ data: { weekId: ids[2]!, authorId: reva, state: "DRAFT", headline: "Черновик" } });
      await prisma.absence.create({ data: { personId: reva, weekId: ids[3]! } });
      expect((await missedWeeks(reva)).map((w) => w.key)).toEqual([keys[2]]);

      // Неделю закрыли после встречи: строки нет
      await prisma.week.update({ where: { id: ids[2]! }, data: { closedAt: new Date() } });
      expect(await missedWeeks(reva)).toEqual([]);

      // Человек пришёл в ресурс после срока этих недель: их не было у него
      await reset();
      await prisma.person.update({ where: { id: reva }, data: { createdAt: new Date() } });
      expect(await missedWeeks(reva)).toEqual([]);

      // Выключенный и наблюдатель: строк нет
      await prisma.person.update({ where: { id: reva }, data: { createdAt: new Date("2020-01-01T00:00:00Z"), active: false } });
      expect(await missedWeeks(reva)).toEqual([]);
    } finally {
      await reset();
      await prisma.person.update({ where: { id: reva }, data: { createdAt: person.createdAt, active: true } });
    }
  });
});
