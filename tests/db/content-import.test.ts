// Этап 67: импорт наполнения на настоящей базе. Права (владелец при личном входе в режиме управления), предпросмотр
// ничего не пишет, загрузка одной транзакцией через службы задач и целей, повтор того же пакета ничего не дублирует,
// обновление записи с тем же ключом не трогает поля, которые правили в ресурсе, цель из борда с тем же номером
// находится и не дублируется, ошибка правила откатывает всё. Пакет синтетический: tests/fixtures/content-import
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import { parsePackage, type ContentPackage } from "@/lib/content-import/package";
import { applyContentImport, previewContentImport } from "@/lib/content-import/service";
import { TOP_TEAM } from "@/lib/org/scope";

const FIXTURE = readFileSync("tests/fixtures/content-import/package.json", "utf8");
const raw = () => JSON.parse(FIXTURE) as Record<string, unknown> & { tasks: Record<string, unknown>[]; goals: Record<string, unknown>[]; decisions: Record<string, unknown>[]; links: Record<string, unknown>[] };
const pkgOf = (value: unknown): ContentPackage => {
  const { pkg, problems } = parsePackage(JSON.stringify(value));
  expect(problems).toEqual([]);
  return pkg;
};
const personal = async (slug: string, management: "OWNER" | "ADMIN" | null = null): Promise<tasks.Actor> => ({ ...(await tasks.actorFor(slug, management)), via: "PASSWORD" });
const viaTeam = async (slug: string, management: "OWNER" | "ADMIN" | null = null): Promise<tasks.Actor> => ({ ...(await tasks.actorFor(slug, management)), via: "TEAM" });
const owner = () => personal("muradyan", "OWNER");
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const lastLogId = async () => (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
const imported = async (kind: string, key: string) => prisma.contentImportKey.findUnique({ where: { kind_key: { kind, key } } });
const taskByKey = async (key: string) => {
  const k = await imported("task", key);
  return k ? prisma.task.findUniqueOrThrow({ where: { id: k.entityId }, include: { coExecutors: { include: { person: true } }, links: true, transfers: true } }) : null;
};

async function reset() {
  await prisma.contentImportKey.deleteMany();
  await prisma.decisionTask.deleteMany();
  await prisma.decision.deleteMany();
  await prisma.inboxEvent.deleteMany();
  await prisma.task.updateMany({ data: { goalId: null } });
  await prisma.taskTransfer.deleteMany();
  await prisma.taskLink.deleteMany();
  await prisma.taskCoExecutor.deleteMany();
  await prisma.task.deleteMany();
  await prisma.goal.deleteMany();
}

beforeEach(reset);
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

describe("права", () => {
  it("загружает только владелец при личном входе в режиме управления", async () => {
    const pkg = pkgOf(raw());
    await expectRule(previewContentImport(await personal("muradyan"), pkg), /владелец при личном входе в режиме управления/);
    await expectRule(applyContentImport(await viaTeam("muradyan", "OWNER"), pkg), /владелец при личном входе/);
    await expectRule(applyContentImport(await personal("golovkin", "ADMIN"), pkg), /владелец/);
    await expectRule(applyContentImport(await personal("reva"), pkg), /владелец/);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.contentImportKey.count()).toBe(0);
  });
});

describe("предпросмотр и загрузка", () => {
  it("предпросмотр считает, что добавится и кого нет, и ничего не пишет", async () => {
    const since = await lastLogId();
    const p = await previewContentImport(await owner(), pkgOf(raw()));
    expect(p.tasks).toEqual({ add: 4, update: 0, skip: 1 });
    expect(p.goals).toEqual({ add: 2, update: 0, skip: 0 });
    expect(p.decisions).toEqual({ add: 2, update: 0, skip: 0 });
    expect(p.links).toEqual({ add: 2, update: 0, skip: 0 });
    expect(p.missingPeople).toEqual(["Иванов Пётр", "Сидоров Никто"]);
    expect(p.missingTeams).toEqual([]);
    expect(p.notes.map((n) => n.text).join("\n")).toMatch(/ответственный «Иванов Пётр» не найден/);
    expect(p.notes.map((n) => n.text).join("\n")).toMatch(/соисполнитель «Сидоров Никто» не найден/);
    // Открытые новые задачи: Головкин и Фатьянов («Все лидеры» и закрытая задача Логиновой не в счёт)
    expect(p.notified).toBe(2);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.goal.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { id: { gt: since } } })).toBe(0);
  });

  it("загрузка ставит задачи через службу задач от имени владельца, закрывает историю, связывает решения и цели", async () => {
    const since = await lastLogId();
    const res = await applyContentImport(await owner(), pkgOf(raw()));
    expect(res.applied.tasks).toHaveLength(4);
    expect(res.applied).toMatchObject({ goals: 2, decisions: 2, links: 2 });
    const me = await prisma.person.findUniqueOrThrow({ where: { slug: "muradyan" } });

    const open = (await taskByKey("task.test.open-1"))!;
    expect(open).toMatchObject({ status: "IN_PROGRESS", priority: "HIGH", createdById: me.id, teamId: TOP_TEAM, sourceCode: "meeting", sourceNote: "Тестовая встреча", whereNow: "Собраны данные по двум выдуманным партнёрам", outcome: "Сводка в одном файле - с выводами" });
    expect(open.sourceDate?.toISOString().slice(0, 10)).toBe("2026-10-13");
    expect(open.links.map((l) => l.url)).toEqual(["https://example.com/doc"]);

    // Задача из истории со сроком в прошлом и закрытая с итогом; события «Мне» о ней нет
    const done = (await taskByKey("task.test.done-1"))!;
    expect(done).toMatchObject({ status: "DONE", resolution: "Разбор готов, ссылка в тестовой папке" });
    expect(done.due.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(done.closedAt).not.toBeNull();
    expect(await prisma.inboxEvent.count({ where: { taskId: done.id } })).toBe(0);
    // Открытая задача: ответственный узнаёт о ней в «Мне»
    expect(await prisma.inboxEvent.count({ where: { taskId: open.id, kind: "TASK_ASSIGNED" } })).toBe(1);

    const all = (await taskByKey("task.test.all-1"))!;
    expect(all).toMatchObject({ ownerAll: true, ownerId: null, status: "CLARIFY" });
    const co = (await taskByKey("task.test.co-1"))!;
    expect(co.coExecutors.map((c) => c.person.slug)).toEqual(["sakhibullina"]);
    expect(await imported("task", "task.test.missing-1")).toBeNull();

    // Цели: цель департамента и цель Ревы под ней; задачи привязаны
    const dept = await prisma.goal.findFirstOrThrow({ where: { code: "ТД-1" } });
    const reva = await prisma.goal.findFirstOrThrow({ where: { code: "ТР-1" }, include: { owner: true } });
    expect(dept).toMatchObject({ quarter: "2026-Q4", teamId: TOP_TEAM, metric: "Число тестовых запусков", target: "3", link: "https://example.com/board/test" });
    expect(reva).toMatchObject({ parentId: dept.id });
    expect(reva.owner?.slug).toBe("reva");
    expect(open.id && (await prisma.task.findUniqueOrThrow({ where: { id: open.id } })).goalId).toBe(dept.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: co.id } })).goalId).toBe(reva.id);

    // Решения: без встречи, с датой, владельцем и задачами; отменённое с причиной
    const d1 = await prisma.decision.findFirstOrThrow({ where: { text: "Тестовые сводки ведём в одном файле" }, include: { tasks: true, owner: true } });
    expect(d1).toMatchObject({ meetingId: null, teamId: TOP_TEAM, status: "ACTIVE" });
    expect(d1.date.toISOString().slice(0, 10)).toBe("2026-10-13");
    expect(d1.owner?.slug).toBe("golovkin");
    expect(d1.tasks.map((t) => t.taskId).sort()).toEqual([open.id, done.id].sort());
    const d2 = await prisma.decision.findFirstOrThrow({ where: { text: "Выдуманный партнёр получает скидку" } });
    expect(d2).toMatchObject({ status: "CANCELLED", cancelReason: "Передумали на следующей тестовой встрече" });

    // Журнал: каждая задача записана службой задач, в конце одна запись импорта с числами
    const log = await prisma.auditLog.findMany({ where: { id: { gt: since } }, orderBy: { id: "asc" } });
    expect(log.filter((l) => l.action === "task.create")).toHaveLength(4);
    const summary = log.filter((l) => l.action === "content.import");
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ entity: "content", entityId: "Синтетический пакет для тестов", actorName: "Мурадян Арам", via: "PASSWORD" });
    expect(String(summary[0]!.after)).toBe(
      "Задачи: новых 4, обновлено 0, пропущено 1. Решения: новых 2, обновлено 0, пропущено 0. Цели: новых 2, обновлено 0, пропущено 0. Связи с целями: новых 2, обновлено 0, пропущено 0",
    );
    expect(log.at(-1)!.action).toBe("content.import");
  });

  it("повторная загрузка того же пакета ничего не дублирует и не меняет", async () => {
    await applyContentImport(await owner(), pkgOf(raw()));
    const before = { tasks: await prisma.task.count(), goals: await prisma.goal.count(), decisions: await prisma.decision.count(), keys: await prisma.contentImportKey.count() };
    const preview = await previewContentImport(await owner(), pkgOf(raw()));
    expect(preview.tasks).toEqual({ add: 0, update: 0, skip: 5 });
    expect(preview.goals).toEqual({ add: 0, update: 0, skip: 2 });
    expect(preview.decisions).toEqual({ add: 0, update: 0, skip: 2 });
    expect(preview.links).toEqual({ add: 0, update: 0, skip: 2 });
    expect(preview.notes[0]).toEqual({ what: "Без изменений", text: "10 записей уже загружено в том же виде" });
    const since = await lastLogId();
    const res = await applyContentImport(await owner(), pkgOf(raw()));
    expect(res.applied).toEqual({ tasks: [], goals: 0, decisions: 0, links: 0 });
    expect({ tasks: await prisma.task.count(), goals: await prisma.goal.count(), decisions: await prisma.decision.count(), keys: await prisma.contentImportKey.count() }).toEqual(before);
    // В журнале только запись о самой загрузке
    expect((await prisma.auditLog.findMany({ where: { id: { gt: since } } })).map((l) => l.action)).toEqual(["content.import"]);
  });

  it("запись с тем же ключом обновляется, а поля, которые правили в ресурсе, загрузка не трогает", async () => {
    await applyContentImport(await owner(), pkgOf(raw()));
    const open = (await taskByKey("task.test.open-1"))!;
    // В ресурсе Головкин поправил «где сейчас»
    await tasks.updateWhere(await personal("golovkin"), open.number, "Головкин написал своё");
    const next = raw();
    next.tasks[0]!.title = "Собрать тестовую сводку по всем выдуманным партнёрам";
    next.tasks[0]!.due = "2026-12-22";
    next.tasks[0]!.whereNow = "Пакет думает иначе";
    next.tasks[0]!.status = "done";
    next.tasks[0]!.resolution = "Сводка готова";
    next.goals[0]!.target = "5";
    next.decisions[0]!.text = "Тестовые сводки ведём в одном общем файле";
    const preview = await previewContentImport(await owner(), pkgOf(next));
    expect(preview.tasks).toEqual({ add: 0, update: 1, skip: 4 });
    expect(preview.goals.update).toBe(1);
    expect(preview.decisions.update).toBe(1);
    await applyContentImport(await owner(), pkgOf(next));
    const after = (await taskByKey("task.test.open-1"))!;
    expect(after.title).toBe("Собрать тестовую сводку по всем выдуманным партнёрам");
    expect(after.whereNow).toBe("Головкин написал своё");
    expect(after.status).toBe("DONE");
    expect(after.resolution).toBe("Сводка готова");
    // Срок перенесён службой задач с причиной (до закрытия)
    expect(after.due.toISOString().slice(0, 10)).toBe("2026-12-22");
    expect(after.transfers.map((t) => t.reason)).toEqual(["Срок обновлён из пакета наполнения"]);
    expect((await prisma.goal.findFirstOrThrow({ where: { code: "ТД-1" } })).target).toBe("5");
    expect(await prisma.decision.count({ where: { text: "Тестовые сводки ведём в одном общем файле" } })).toBe(1);
    // Ещё раз тот же изменённый пакет: без изменений
    const again = await previewContentImport(await owner(), pkgOf(next));
    expect(again.tasks.update + again.goals.update + again.decisions.update).toBe(0);
  });

  it("цель с тем же номером в команде уже есть: ключ привязывается к ней, заполняются только пустые поля", async () => {
    const me = await prisma.person.findUniqueOrThrow({ where: { slug: "muradyan" } });
    const existing = await prisma.goal.create({ data: { quarter: "2026-Q4", code: "ТД-1", title: "Цель из борда", teamId: TOP_TEAM, ownerId: me.id, metric: "Метрика из борда", source: "leader-board:test" } });
    const preview = await previewContentImport(await owner(), pkgOf(raw()));
    expect(preview.goals).toEqual({ add: 1, update: 1, skip: 0 });
    expect(preview.notes.map((n) => n.text).join("\n")).toMatch(/ТД-1 уже есть в ресурсе: загрузка заполнит только пустые поля/);
    await applyContentImport(await owner(), pkgOf(raw()));
    expect(await prisma.goal.count({ where: { code: "ТД-1" } })).toBe(1);
    const g = await prisma.goal.findUniqueOrThrow({ where: { id: existing.id } });
    expect(g).toMatchObject({ title: "Цель из борда", metric: "Метрика из борда", target: "3", base: "0", link: "https://example.com/board/test" });
    expect((await imported("goal", "goal.test.dept-1"))!.entityId).toBe(existing.id);
  });

  it("связь с целью по номеру из ресурса и с задачей по номеру; чужая цель задачи не перезаписывается", async () => {
    await applyContentImport(await owner(), pkgOf(raw()));
    const all = (await taskByKey("task.test.all-1"))!;
    const next = raw();
    next.links.push({ key: "link.test.3", task: { number: all.number }, goal: { code: "ТД-1" } });
    // Задаче 2 в ресурсе уже поставили другую цель руками
    const co = (await taskByKey("task.test.co-1"))!;
    const dept = await prisma.goal.findFirstOrThrow({ where: { code: "ТД-1" } });
    await prisma.task.update({ where: { id: co.id }, data: { goalId: dept.id } });
    next.links[1]!.goal = { key: "goal.test.dept-1" };
    const p = await previewContentImport(await owner(), pkgOf(next));
    expect(p.links).toEqual({ add: 1, update: 0, skip: 2 });
    expect(p.notes.map((n) => n.text).join("\n")).toMatch(/цель задачи поменяли в ресурсе после прошлой загрузки/);
    await applyContentImport(await owner(), pkgOf(next));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: all.id } })).goalId).toBe(dept.id);
  });

  it("ошибка правила откатывает всю загрузку: база остаётся как была", async () => {
    const since = await lastLogId();
    const bad = raw();
    // Две цели ставят друг друга выше: вторая связь даёт петлю, служба целей её не пускает
    bad.goals[0]!.parent = { key: "goal.test.reva-1" };
    await expectRule(applyContentImport(await owner(), pkgOf(bad)), /Загрузка не прошла, база не тронута\. Цель .*не может стоять ниже самой себя/);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.goal.count()).toBe(0);
    expect(await prisma.decision.count()).toBe(0);
    expect(await prisma.contentImportKey.count()).toBe(0);
    // Журнал тоже откатился: ни задач, ни записи об импорте
    expect(await prisma.auditLog.count({ where: { id: { gt: since } } })).toBe(0);
  });
});
