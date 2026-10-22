// Этап 67: импорт наполнения на настоящей базе. Права (владелец при личном входе в режиме управления), предпросмотр
// ничего не пишет, загрузка одной транзакцией через службы задач и целей, повтор того же пакета ничего не дублирует,
// обновление записи с тем же ключом не трогает поля, которые правили в ресурсе (и после нескольких загрузок), цель из
// борда с тем же номером находится и её поля борда не перезаписываются, сроки и даты закрытия из истории, номера задач
// берутся заранее и не держат настройку номеров, кадровые сведения и решения без команды не грузятся, вероятные дубли
// пропускаются, удалённая цель и правила служб не роняют загрузку, перезаливка из выгрузки чистит ключи удалённых
// задач, ошибка правила откатывает всё. Пакет синтетический: tests/fixtures/content-import
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import { parsePackage, type ContentPackage } from "@/lib/content-import/package";
import { applyContentImport, previewContentImport } from "@/lib/content-import/service";
import { updateGoal } from "@/lib/goals/service";
import { reloadFromBord } from "@/lib/admin/reload";
import { TOP_TEAM } from "@/lib/org/scope";
import { dbDate, moscowToday } from "@/lib/tasks/dates";
import { addDays, formatLong } from "@/domain/dates";

// Шаг загрузки посреди транзакции: связь задачи с целью идёт после постановки задач. Тест подкладывает сюда проверку
// (номера задач не заперты) или ошибку правила (откат всей загрузки)
const hooks = vi.hoisted(() => ({ beforeLink: null as null | (() => Promise<void>) }));
vi.mock("@/lib/goals/service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/goals/service")>();
  return {
    ...mod,
    linkTaskGoal: async (...args: Parameters<typeof mod.linkTaskGoal>) => {
      const hook = hooks.beforeLink;
      hooks.beforeLink = null;
      if (hook) await hook();
      return mod.linkTaskGoal(...args);
    },
  };
});

const FIXTURE = readFileSync("tests/fixtures/content-import/package.json", "utf8");
type Raw = Record<string, unknown> & { tasks: Record<string, unknown>[]; goals: Record<string, unknown>[]; decisions: Record<string, unknown>[]; links: Record<string, unknown>[] };
const raw = () => JSON.parse(FIXTURE) as Raw;
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
const payloadOf = async (kind: string, key: string) => (await imported(kind, key))!.payload as Record<string, unknown>;
const taskByKey = async (key: string) => {
  const k = await imported("task", key);
  return k ? prisma.task.findUniqueOrThrow({ where: { id: k.entityId }, include: { coExecutors: { include: { person: true } }, links: true, transfers: true } }) : null;
};
const nextNumberSetting = async () => (await prisma.setting.findUnique({ where: { key: "tasks.nextNumber" } }))?.value ?? null;
const texts = (lines: { what: string; text: string }[]) => lines.map((n) => `${n.what}: ${n.text}`).join("\n");
const today = moscowToday();
const TASKS_CSV = "data/bord/zadachi-2026-10-05.csv";
const WEEKLY_CSV = "data/bord/weekly-ceo-2026-10-05.csv";

async function reset() {
  hooks.beforeLink = null;
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
  await prisma.team.deleteMany({ where: { id: { not: TOP_TEAM } } });
  await prisma.dictionaryItem.updateMany({ where: { kind: "TASK_SOURCE" }, data: { active: true } });
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
    expect({ errors: p.errors, warnings: p.warnings, duplicates: p.duplicates, withDuplicates: p.withDuplicates }).toEqual({ errors: [], warnings: [], duplicates: [], withDuplicates: false });
    expect(texts(p.notes)).toMatch(/ответственный «Иванов Пётр» не найден/);
    expect(texts(p.notes)).toMatch(/соисполнитель «Сидоров Никто» не найден/);
    // Узнают об открытых новых задачах: ответственные Головкин и Фатьянов и соисполнитель Сахибуллина («Все лидеры» и
    // закрытая задача Логиновой не в счёт)
    expect(p.notified).toBe(3);
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

    // Номера подряд из заранее взятых, лишний номер (задача человеку, которого нет) вернулся в настройку
    const first = res.applied.tasks[0]!;
    expect(res.applied.tasks).toEqual([first, first + 1, first + 2, first + 3]);
    expect(await nextNumberSetting()).toBe(first + 4);

    const open = (await taskByKey("task.test.open-1"))!;
    expect(open).toMatchObject({ status: "IN_PROGRESS", priority: "HIGH", createdById: me.id, teamId: TOP_TEAM, sourceCode: "meeting", sourceNote: "Тестовая встреча", whereNow: "Собраны данные по двум выдуманным партнёрам", outcome: "Сводка в одном файле - с выводами" });
    expect(open.sourceDate?.toISOString().slice(0, 10)).toBe("2026-10-13");
    expect(open.links.map((l) => l.url)).toEqual(["https://example.com/doc"]);

    // Задача из истории со сроком в прошлом и закрытая с итогом; дата закрытия историческая (срок), события «Мне» нет
    const done = (await taskByKey("task.test.done-1"))!;
    expect(done).toMatchObject({ status: "DONE", resolution: "Разбор готов, ссылка в тестовой папке" });
    expect(done.due.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(done.closedAt?.toISOString()).toBe("2026-09-30T09:00:00.000Z");
    expect(await prisma.inboxEvent.count({ where: { taskId: done.id } })).toBe(0);
    // Открытая задача: ответственный узнаёт о ней в «Мне»
    expect(await prisma.inboxEvent.count({ where: { taskId: open.id, kind: "TASK_ASSIGNED" } })).toBe(1);

    const all = (await taskByKey("task.test.all-1"))!;
    expect(all).toMatchObject({ ownerAll: true, ownerId: null, status: "CLARIFY", sourceDate: null });
    const co = (await taskByKey("task.test.co-1"))!;
    expect(co.coExecutors.map((c) => c.person.slug)).toEqual(["sakhibullina"]);
    expect(await imported("task", "task.test.missing-1")).toBeNull();

    // Цели: цель департамента и цель Ревы под ней; задачи привязаны
    const dept = await prisma.goal.findFirstOrThrow({ where: { code: "ТД-1" } });
    const reva = await prisma.goal.findFirstOrThrow({ where: { code: "ТР-1" }, include: { owner: true } });
    expect(dept).toMatchObject({ quarter: "2026-Q4", teamId: TOP_TEAM, metric: "Число тестовых запусков", target: "3", link: "https://example.com/board/test" });
    expect(reva).toMatchObject({ parentId: dept.id });
    expect(reva.owner?.slug).toBe("reva");
    expect((await prisma.task.findUniqueOrThrow({ where: { id: open.id } })).goalId).toBe(dept.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: co.id } })).goalId).toBe(reva.id);
    // Ключ связи хранит id задачи: перезаливка находит его по удалённой задаче
    expect((await imported("link", "link.test.1"))!.entityId).toBe(open.id);

    // Решения: без встречи, с датой, владельцем и задачами; отменённое с причиной
    const d1 = await prisma.decision.findFirstOrThrow({ where: { text: "Тестовые сводки ведём в одном файле" }, include: { tasks: true, owner: true } });
    expect(d1).toMatchObject({ meetingId: null, teamId: TOP_TEAM, status: "ACTIVE" });
    expect(d1.date.toISOString().slice(0, 10)).toBe("2026-10-13");
    expect(d1.owner?.slug).toBe("golovkin");
    expect(d1.tasks.map((t) => t.taskId).sort()).toEqual([open.id, done.id].sort());
    const d2 = await prisma.decision.findFirstOrThrow({ where: { text: "Выдуманный партнёр получает скидку" } });
    expect(d2).toMatchObject({ status: "CANCELLED", cancelReason: "Передумали на следующей тестовой встрече", teamId: TOP_TEAM });

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
    // Дубли с уже загруженным по ключу не путаются
    expect(preview.duplicates).toEqual([]);
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
    // Предпросмотр заранее говорит, какое поле загрузка не тронет
    expect(texts(preview.notes)).toMatch(new RegExp(`Задача ${open.number}: поле «Где сейчас» правили в ресурсе, загрузка его не тронет`));
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
    // База в ключе: «где сейчас» прежняя (из первой загрузки), а не текст ресурса и не текст пакета
    expect(await payloadOf("task", "task.test.open-1")).toMatchObject({ whereNow: "Собраны данные по двум выдуманным партнёрам", title: "Собрать тестовую сводку по всем выдуманным партнёрам", status: "done", due: "2026-12-22" });
    // Ещё раз тот же изменённый пакет: без изменений
    const again = await previewContentImport(await owner(), pkgOf(next));
    expect(again.tasks.update + again.goals.update + again.decisions.update).toBe(0);
  });

  it("три загрузки с правками в ресурсе между ними: правки ресурса и поля борда живут", async () => {
    const me = await prisma.person.findUniqueOrThrow({ where: { slug: "muradyan" } });
    // Цель из борда лидера с тем же номером: название и метрика борда, остальное пустое
    const board = await prisma.goal.create({ data: { quarter: "2026-Q4", code: "ТД-1", title: "Цель из борда", teamId: TOP_TEAM, ownerId: me.id, metric: "Метрика из борда", source: "leader-board:test" } });

    // Загрузка 1
    await applyContentImport(await owner(), pkgOf(raw()));
    const open = (await taskByKey("task.test.open-1"))!;
    const reva = await prisma.goal.findFirstOrThrow({ where: { code: "ТР-1" } });
    expect(await prisma.goal.findUniqueOrThrow({ where: { id: board.id } })).toMatchObject({ title: "Цель из борда", metric: "Метрика из борда", target: "3", base: "0" });

    // Правки в ресурсе
    await tasks.updateWhere(await personal("golovkin"), open.number, "Головкин написал своё");
    const d1 = await prisma.decision.findFirstOrThrow({ where: { text: "Тестовые сводки ведём в одном файле" } });
    await prisma.decision.update({ where: { id: d1.id }, data: { text: "Сводки ведём в одном файле, решили на встрече" } });
    await updateGoal(await owner(), reva.id, { target: "90%" });
    // Цель выше у цели Ревы сняли руками: следующие загрузки её не возвращают, пока пакет не поменяет цель выше
    await updateGoal(await owner(), reva.id, { parent: null });

    // Загрузка 2: пакет меняет и поля, которые правили в ресурсе, и поле борда
    const p2 = raw();
    p2.tasks[0]!.whereNow = "Пакет думает иначе";
    p2.tasks[0]!.outcome = "Сводка в одном файле с выводами и графиками";
    p2.decisions[0]!.text = "Тестовые сводки ведём в одном общем файле";
    p2.goals[0]!.metric = "Новая метрика пакета";
    p2.goals[0]!.target = "5";
    p2.goals[1]!.target = "200%";
    const preview2 = await previewContentImport(await owner(), pkgOf(p2));
    expect(texts(preview2.notes)).toMatch(/поле «Где сейчас» правили в ресурсе/);
    expect(texts(preview2.notes)).toMatch(/Решение «Тестовые сводки ведём в одном общем файле»: поле «Решение» правили в ресурсе/);
    expect(texts(preview2.notes)).toMatch(/Цель «Вымышленная цель продукта: собрать тестовую витрину»: поле «Целевое значение» правили в ресурсе/);
    await applyContentImport(await owner(), pkgOf(p2));
    expect((await taskByKey("task.test.open-1"))!).toMatchObject({ whereNow: "Головкин написал своё", outcome: "Сводка в одном файле с выводами и графиками" });
    expect((await prisma.decision.findUniqueOrThrow({ where: { id: d1.id } })).text).toBe("Сводки ведём в одном файле, решили на встрече");
    expect(await prisma.goal.findUniqueOrThrow({ where: { id: board.id } })).toMatchObject({ metric: "Метрика из борда", target: "5" });
    expect((await prisma.goal.findUniqueOrThrow({ where: { id: reva.id } })).target).toBe("90%");

    // Загрузка 3: те же поля пакет меняет ещё раз, плюс новые поля
    const p3 = JSON.parse(JSON.stringify(p2)) as Raw;
    p3.tasks[0]!.whereNow = "Пакет снова думает иначе";
    p3.tasks[0]!.title = "Собрать тестовую сводку по всем выдуманным партнёрам";
    p3.decisions[0]!.text = "Тестовые сводки ведём в одном общем файле с архивом";
    p3.goals[0]!.metric = "Третья метрика пакета";
    p3.goals[1]!.target = "300%";
    p3.goals[1]!.metric = "Готовность витрины и каталога";
    await applyContentImport(await owner(), pkgOf(p3));
    expect((await taskByKey("task.test.open-1"))!).toMatchObject({ whereNow: "Головкин написал своё", title: "Собрать тестовую сводку по всем выдуманным партнёрам" });
    expect((await prisma.decision.findUniqueOrThrow({ where: { id: d1.id } })).text).toBe("Сводки ведём в одном файле, решили на встрече");
    expect(await prisma.goal.findUniqueOrThrow({ where: { id: board.id } })).toMatchObject({ title: "Цель из борда", metric: "Метрика из борда", target: "5" });
    expect(await prisma.goal.findUniqueOrThrow({ where: { id: reva.id } })).toMatchObject({ target: "90%", metric: "Готовность витрины и каталога", parentId: null });
    // Загрузке у цели борда принадлежат только поля, которые она заполнила
    expect((await payloadOf("goal", "goal.test.dept-1")).owned).toEqual(["description", "base", "target", "link"]);
  });

  it("поля, которые загрузка не записала, не считаются записанными: итог при том же статусе, пустое «где сейчас», статус при правке итога", async () => {
    await applyContentImport(await owner(), pkgOf(raw()));
    const done = (await taskByKey("task.test.done-1"))!;
    const open = (await taskByKey("task.test.open-1"))!;
    const firstResolution = "Разбор готов, ссылка в тестовой папке";

    // Загрузка 2: у закрытой задачи поменялся только итог, у открытой «где сейчас» стало пустым
    const p2 = raw();
    p2.tasks[1]!.resolution = "Разбор готов, ссылка в общей папке";
    delete p2.tasks[0]!.whereNow;
    const preview = await previewContentImport(await owner(), pkgOf(p2));
    expect(texts(preview.notes)).toMatch(new RegExp(`Задача ${done.number}: итог в пакете другой, а статус тот же`));
    expect(texts(preview.notes)).toMatch(new RegExp(`Задача ${open.number}: «Где сейчас» в пакете пустое`));
    await applyContentImport(await owner(), pkgOf(p2));
    expect((await taskByKey("task.test.done-1"))!.resolution).toBe(firstResolution);
    expect((await taskByKey("task.test.open-1"))!.whereNow).toBe("Собраны данные по двум выдуманным партнёрам");
    expect(await payloadOf("task", "task.test.done-1")).toMatchObject({ status: "done", resolution: firstResolution });
    expect(await payloadOf("task", "task.test.open-1")).toMatchObject({ whereNow: "Собраны данные по двум выдуманным партнёрам" });

    // В ресурсе итог поправили (через смену статуса туда и обратно), потом пакет меняет статус: статус не трогается
    await tasks.changeStatus(await owner(), done.number, "partial", "Сделано наполовину");
    await tasks.changeStatus(await owner(), done.number, "done", "Готово, правили в ресурсе");
    const p3 = JSON.parse(JSON.stringify(p2)) as Raw;
    p3.tasks[1]!.status = "failed";
    const preview3 = await previewContentImport(await owner(), pkgOf(p3));
    expect(texts(preview3.notes)).toMatch(/итог правили в ресурсе: статус и итог из пакета загрузка не тронет/);
    await applyContentImport(await owner(), pkgOf(p3));
    expect((await taskByKey("task.test.done-1"))!).toMatchObject({ status: "DONE", resolution: "Готово, правили в ресурсе" });
    expect(await payloadOf("task", "task.test.done-1")).toMatchObject({ status: "done", resolution: firstResolution });
  });

  it("цель с тем же номером в команде уже есть: ключ привязывается к ней, заполняются только пустые поля", async () => {
    const me = await prisma.person.findUniqueOrThrow({ where: { slug: "muradyan" } });
    const existing = await prisma.goal.create({ data: { quarter: "2026-Q4", code: "ТД-1", title: "Цель из борда", teamId: TOP_TEAM, ownerId: me.id, metric: "Метрика из борда", source: "leader-board:test" } });
    const preview = await previewContentImport(await owner(), pkgOf(raw()));
    expect(preview.goals).toEqual({ add: 1, update: 1, skip: 0 });
    expect(texts(preview.notes)).toMatch(/ТД-1 уже есть в ресурсе: загрузка заполнит только пустые поля/);
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
    expect(texts(p.notes)).toMatch(/цель задачи поменяли в ресурсе после прошлой загрузки/);
    await applyContentImport(await owner(), pkgOf(next));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: all.id } })).goalId).toBe(dept.id);
  });

  it("ошибка правила посреди загрузки откатывает всё, взятые заранее номера возвращаются", async () => {
    const since = await lastLogId();
    const numbersBefore = await nextNumberSetting();
    // Правило службы, которого план не предвидел: связь задачи с целью отказывает
    hooks.beforeLink = async () => {
      throw new tasks.TaskRuleError("Цель снята: выберите другую");
    };
    await expectRule(applyContentImport(await owner(), pkgOf(raw())), /Загрузка не прошла, база не тронута\. Связь задачи \d+ с целью: Цель снята: выберите другую/);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.goal.count()).toBe(0);
    expect(await prisma.decision.count()).toBe(0);
    expect(await prisma.contentImportKey.count()).toBe(0);
    // Журнал тоже откатился: ни задач, ни записи об импорте
    expect(await prisma.auditLog.count({ where: { id: { gt: since } } })).toBe(0);
    expect(await nextNumberSetting()).toBe(numbersBefore ?? 52);
  });
});

describe("номера задач во время загрузки", () => {
  it("настройка номеров не заперта на всю загрузку: задача, поставленная в это время, проходит сразу", async () => {
    let locked: boolean | null = null;
    let during: number | null = null;
    hooks.beforeLink = async () => {
      try {
        await prisma.$queryRaw`SELECT "key" FROM "settings" WHERE "key" = 'tasks.nextNumber' FOR UPDATE NOWAIT`;
        locked = false;
      } catch {
        locked = true;
      }
      during = (await tasks.createTask(await tasks.actorFor("reva"), { title: "Задача, поставленная во время загрузки", outcome: "Проверка", owner: "reva", direction: "product", due: addDays(today, 10), source: "weekly" })).task.number;
    };
    const res = await applyContentImport(await owner(), pkgOf(raw()));
    expect(locked).toBe(false);
    expect(during).not.toBeNull();
    expect(res.applied.tasks).not.toContain(during);
    // Задача человека получила номер после взятых загрузкой
    expect(during!).toBeGreaterThan(Math.max(...res.applied.tasks));
  });
});

describe("сроки и даты из истории", () => {
  it("открытая задача со сроком в прошлом встаёт со сроком на сегодня и видна в предпросмотре; дата источника не подменяется сегодняшней", async () => {
    const past = addDays(today, -20);
    const p = raw();
    p.tasks[3]!.due = past;
    p.tasks[2]!.source = { kind: "meeting" };
    const preview = await previewContentImport(await owner(), pkgOf(p));
    expect(preview.tasks.add).toBe(4);
    expect(preview.warnings).toEqual([
      { what: "Задача «Сверить выдуманные комиссии»", text: `срок ${formatLong(past)} уже прошёл, а задача открыта: встанет со сроком на сегодня, ${formatLong(today)}. Поправьте срок в пакете или в ресурсе` },
    ]);
    await applyContentImport(await owner(), pkgOf(p));
    const co = (await taskByKey("task.test.co-1"))!;
    expect(co.due.toISOString().slice(0, 10)).toBe(today);
    expect(await payloadOf("task", "task.test.co-1")).toMatchObject({ due: today, dueRaw: past });
    // Встреча без даты: даты источника нет, в повестку как поручение прошлой встречи задача не попадёт
    expect((await taskByKey("task.test.all-1"))!).toMatchObject({ sourceCode: "meeting", sourceDate: null });

    // Повтор и правка другого поля: срок не трогается и о нём не пишется
    expect((await previewContentImport(await owner(), pkgOf(p))).tasks.update).toBe(0);
    p.tasks[3]!.title = "Сверить выдуманные комиссии по всем СК";
    const again = await previewContentImport(await owner(), pkgOf(p));
    expect(again.tasks.update).toBe(1);
    expect(texts(again.notes)).not.toMatch(/срок/);
    await applyContentImport(await owner(), pkgOf(p));
    expect((await taskByKey("task.test.co-1"))!.due.toISOString().slice(0, 10)).toBe(today);
  });

  it("служба задач: срок в прошлом только у задачи из истории, которую сразу закрывают", async () => {
    const actor = await owner();
    const input = { title: "Задача из истории", outcome: "Проверка", owner: "reva", direction: "product", due: addDays(today, -5), source: "meeting" as const };
    await expectRule(
      prisma.$transaction((tx) => tasks.createTaskIn(tx, actor, input, { history: { sourceDate: null, closed: false } })),
      /Срок не может быть в прошлом/,
    );
    const ok = await prisma.$transaction((tx) => tasks.createTaskIn(tx, actor, input, { history: { sourceDate: null, closed: true } }));
    expect(ok.task.due).toBe(addDays(today, -5));
    expect((await prisma.task.findUniqueOrThrow({ where: { number: ok.task.number } })).sourceDate).toBeNull();
  });
});

describe("что не загружается", () => {
  it("кадровые сведения и решение без команды: список ошибок предпросмотра, записи не грузятся, остальное грузится", async () => {
    const p = raw();
    p.tasks[0]!.whereNow = "Ждём решения по окладу аналитика";
    delete p.decisions[1]!.team;
    const preview = await previewContentImport(await owner(), pkgOf(p));
    expect(preview.errors).toEqual([
      { what: "Задача «Собрать тестовую сводку по выдуманным партнёрам»", text: "кадровые сведения («окладу» в поле «Где сейчас»): такие записи в ресурс не загружаются, уберите их из пакета" },
      { what: "Решение «Выдуманный партнёр получает скидку»", text: "нет команды: решение без команды не загружается, укажите команду в пакете" },
    ]);
    expect(preview.tasks).toEqual({ add: 3, update: 0, skip: 2 });
    expect(preview.decisions).toEqual({ add: 1, update: 0, skip: 1 });
    expect(preview.links).toEqual({ add: 1, update: 0, skip: 1 });
    expect(texts(preview.notes)).toMatch(/Связь link.test.1: задача «Собрать тестовую сводку по выдуманным партнёрам» не загружается: кадровые сведения/);
    await applyContentImport(await owner(), pkgOf(p));
    expect(await imported("task", "task.test.open-1")).toBeNull();
    expect(await prisma.task.count({ where: { whereNow: { contains: "оклад" } } })).toBe(0);
    expect(await prisma.decision.count({ where: { text: "Выдуманный партнёр получает скидку" } })).toBe(0);
    // Решение со ссылкой на непрошедшую задачу грузится без неё
    const d1 = await prisma.decision.findFirstOrThrow({ where: { text: "Тестовые сводки ведём в одном файле" }, include: { tasks: true } });
    expect(d1.tasks).toHaveLength(1);
  });

  it("вероятные дубли того, что уже есть в ресурсе, по умолчанию пропускаются, их можно включить", async () => {
    const me = await prisma.person.findUniqueOrThrow({ where: { slug: "muradyan" } });
    const twin = (await tasks.createTask(await owner(), { title: "Собрать тестовую сводку по выдуманным партнёрам", outcome: "Уже есть в ресурсе", owner: "golovkin", direction: "osago", due: addDays(today, 30), source: "weekly" })).task;
    await prisma.decision.create({ data: { teamId: TOP_TEAM, text: "Тестовые сводки ведём в одном файле.", date: dbDate("2026-10-13"), createdById: me.id } });
    const preview = await previewContentImport(await owner(), pkgOf(raw()));
    expect(preview.tasks).toEqual({ add: 3, update: 0, skip: 2 });
    expect(preview.decisions).toEqual({ add: 1, update: 0, skip: 1 });
    expect(preview.links).toEqual({ add: 1, update: 0, skip: 1 });
    expect(texts(preview.duplicates)).toBe(
      [
        `Задача «Собрать тестовую сводку по выдуманным партнёрам»: похожа на задачу ${twin.number} «Собрать тестовую сводку по выдуманным партнёрам»: тот же ответственный и похожее название, пропустится`,
        "Решение «Тестовые сводки ведём в одном файле»: похоже на решение команды за 13 октября «Тестовые сводки ведём в одном файле.», пропустится",
      ].join("\n"),
    );
    await applyContentImport(await owner(), pkgOf(raw()));
    expect(await imported("task", "task.test.open-1")).toBeNull();
    expect(await prisma.decision.count({ where: { text: { startsWith: "Тестовые сводки" } } })).toBe(1);

    // Владелец включил дубли: загружаются
    const withDuplicates = await previewContentImport(await owner(), pkgOf(raw()), { duplicates: true });
    expect(withDuplicates).toMatchObject({ withDuplicates: true, tasks: { add: 1 }, decisions: { add: 1 }, links: { add: 1 } });
    expect(texts(withDuplicates.duplicates)).toMatch(/загрузится, как вы выбрали/);
    await applyContentImport(await owner(), pkgOf(raw()), { duplicates: true });
    expect(await imported("task", "task.test.open-1")).not.toBeNull();
    expect(await prisma.decision.count({ where: { text: { startsWith: "Тестовые сводки" } } })).toBe(2);
  });

  it("удалённая в ресурсе цель не роняет загрузку: связь и цель выше пропускаются с заметкой", async () => {
    await applyContentImport(await owner(), pkgOf(raw()));
    const dept = await prisma.goal.findFirstOrThrow({ where: { code: "ТД-1" } });
    await prisma.goal.delete({ where: { id: dept.id } });
    const p = raw();
    p.goals[1]!.target = "50%";
    p.links[0]!.reason = "Новая причина связи";
    // Новая цель под удалённой целью
    p.goals.push({ key: "goal.test.new-1", quarter: "2026-Q4", team: "Топ-команда", code: "ТН-1", title: "Новая цель под удалённой", parent: { key: "goal.test.dept-1" } });
    const preview = await previewContentImport(await owner(), pkgOf(p));
    expect(texts(preview.notes)).toMatch(/Цель «Вымышленная цель департамента: запустить тестовый продукт»: ключ есть, цели в ресурсе нет/);
    expect(texts(preview.notes)).toMatch(/Связь link.test.1: цель «Вымышленная цель департамента: запустить тестовый продукт» не загружается/);
    expect(texts(preview.warnings)).toMatch(/Цель «Новая цель под удалённой»: цель выше не загружается: ключ есть, цели в ресурсе нет/);
    await applyContentImport(await owner(), pkgOf(p));
    // Цель Ревы обновилась; цель выше у неё пакет не менял, поэтому загрузка её не трогает (её сняло удаление)
    expect(await prisma.goal.findFirstOrThrow({ where: { code: "ТР-1" } })).toMatchObject({ target: "50%", parentId: null });
    expect(await prisma.goal.findFirstOrThrow({ where: { code: "ТН-1" } })).toMatchObject({ parentId: null });
    expect(await prisma.goal.count({ where: { code: "ТД-1" } })).toBe(0);
  });

  it("правила служб проверяет предпросмотр: скрытый источник, цель выше не своей команды и петля целей", async () => {
    const reva = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
    const child = await prisma.team.create({ data: { name: "Тестовая команда Ревы", kind: "CUSTOM", parentId: TOP_TEAM, leaderId: reva.id } });
    await prisma.goal.create({ data: { quarter: "2026-Q4", code: "КР-9", title: "Цель команды ниже", teamId: child.id } });
    await prisma.dictionaryItem.updateMany({ where: { kind: "TASK_SOURCE", code: "meeting" }, data: { active: false } });
    const p = raw();
    p.goals[0]!.parent = { code: "КР-9" };
    p.goals.push({ key: "goal.test.loop-a", quarter: "2026-Q4", team: "Топ-команда", code: "ТЛ-1", title: "Петля А", parent: { key: "goal.test.loop-b" } });
    p.goals.push({ key: "goal.test.loop-b", quarter: "2026-Q4", team: "Топ-команда", code: "ТЛ-2", title: "Петля Б", parent: { key: "goal.test.loop-a" } });
    const preview = await previewContentImport(await owner(), pkgOf(p));
    expect(preview.errors.map((e) => e.text)).toEqual(["источника «meeting» нет в справочнике или он скрыт", "источника «meeting» нет в справочнике или он скрыт"]);
    expect(texts(preview.warnings)).toMatch(/Цель «Вымышленная цель департамента: запустить тестовый продукт»: цель выше не своей команды и не команды выше/);
    expect(texts(preview.warnings)).toMatch(/Цель «Петля Б»: цель не может стоять ниже самой себя/);
    // Загрузка не падает: задачи со скрытым источником пропущены, цели встали без неподходящей цели выше
    const res = await applyContentImport(await owner(), pkgOf(p));
    expect(res.applied.tasks).toHaveLength(2);
    expect(await prisma.goal.findFirstOrThrow({ where: { code: "ТД-1" } })).toMatchObject({ parentId: null });
    const a = await prisma.goal.findFirstOrThrow({ where: { code: "ТЛ-1" } });
    const b = await prisma.goal.findFirstOrThrow({ where: { code: "ТЛ-2" } });
    expect(a.parentId).toBe(b.id);
    expect(b.parentId).toBeNull();
  });
});

describe("перезаливка из выгрузки", () => {
  it("ключи удалённых задач и их связей стираются: повторный импорт ставит задачи заново и возвращает связи решений", async () => {
    await applyContentImport(await owner(), pkgOf(raw()));
    await reloadFromBord(prisma, readFileSync(TASKS_CSV, "utf8"), readFileSync(WEEKLY_CSV, "utf8"), { batch: "bord-test-67", actor: { personId: null, name: "Тест", source: "SYSTEM" } });
    expect(await prisma.contentImportKey.count({ where: { kind: { in: ["task", "link"] } } })).toBe(0);
    expect(await prisma.contentImportKey.count({ where: { kind: { in: ["goal", "decision"] } } })).toBe(4);
    const preview = await previewContentImport(await owner(), pkgOf(raw()));
    expect(preview).toMatchObject({ tasks: { add: 4, update: 0, skip: 1 }, links: { add: 2, update: 0, skip: 0 }, decisions: { add: 0, update: 0, skip: 2 } });
    await applyContentImport(await owner(), pkgOf(raw()));
    const open = (await taskByKey("task.test.open-1"))!;
    const done = (await taskByKey("task.test.done-1"))!;
    const d1 = await prisma.decision.findFirstOrThrow({ where: { text: "Тестовые сводки ведём в одном файле" }, include: { tasks: true } });
    expect(d1.tasks.map((t) => t.taskId).sort()).toEqual([open.id, done.id].sort());
    expect((await prisma.task.findUniqueOrThrow({ where: { id: open.id } })).goalId).not.toBeNull();
  });
});
