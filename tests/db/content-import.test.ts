// Этап 67: импорт наполнения на настоящей базе. Права (владелец при личном входе в режиме управления), предпросмотр
// ничего не пишет, загрузка одной транзакцией через службы задач и целей, повтор того же пакета ничего не дублирует,
// обновление записи с тем же ключом не трогает поля, которые правили в ресурсе (и после нескольких загрузок), цель из
// борда с тем же номером находится и её поля борда не перезаписываются (с replace цель приводится к пакету), сроки и
// даты закрытия из истории, номера задач берутся заранее и не держат настройку номеров, кадровые сведения и решения
// без команды не грузятся, вероятные дубли пропускаются, удалённая и снятая цель и правила служб не роняют загрузку,
// перезаливка из выгрузки чистит ключи удалённых задач, задача ресурса подхватывается по номеру (adopt) вместе с
// кадровым фильтром, дублями и сроком по умолчанию, ошибка откатывает всё. Пакет синтетический: tests/fixtures/content-import
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import { parsePackage, type ContentPackage } from "@/lib/content-import/package";
import { applyContentImport, previewContentImport } from "@/lib/content-import/service";
import { overdueAt } from "@/lib/analytics/rules";
import { updateGoal } from "@/lib/goals/service";
import { reloadFromBord } from "@/lib/admin/reload";
import { TOP_TEAM } from "@/lib/org/scope";
import { dbDate, moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";

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
    expect(texts(preview.notes)).toMatch(new RegExp(`Задача ${done.number}: итог поменялся только в пакете, а статус тот же`));
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

    // Срок перенесли в ресурсе, пакет меняет срок: срок не трогается, и в ключе обе базы срока прежние
    await tasks.transferDue(await owner(), open.number, "2026-12-20", "Перенесли на встрече");
    const p4 = JSON.parse(JSON.stringify(p3)) as Raw;
    p4.tasks[0]!.due = "2026-12-22";
    await applyContentImport(await owner(), pkgOf(p4));
    expect((await taskByKey("task.test.open-1"))!.due.toISOString().slice(0, 10)).toBe("2026-12-20");
    expect(await payloadOf("task", "task.test.open-1")).toMatchObject({ due: "2026-12-15", dueRaw: "2026-12-15" });
  });

  it("цель с тем же номером в команде уже есть: ключ привязывается к ней, заполняются только пустые поля", async () => {
    const me = await prisma.person.findUniqueOrThrow({ where: { slug: "muradyan" } });
    const existing = await prisma.goal.create({ data: { quarter: "2026-Q4", code: "ТД-1", title: "Цель из борда", teamId: TOP_TEAM, ownerId: me.id, metric: "Метрика из борда", source: "leader-board:test" } });
    const preview = await previewContentImport(await owner(), pkgOf(raw()));
    expect(preview.goals).toEqual({ add: 1, update: 1, skip: 0 });
    expect(preview.notes.find((n) => n.what === "Цель ТД-1")?.text).toBe("уже есть в ресурсе: загрузка заполнит только пустые поля");
    expect(texts(preview.notes)).toMatch(/Цель ТД-1: уже есть в ресурсе: загрузка заполнит только пустые поля/);
    await applyContentImport(await owner(), pkgOf(raw()));
    expect(await prisma.goal.count({ where: { code: "ТД-1" } })).toBe(1);
    const g = await prisma.goal.findUniqueOrThrow({ where: { id: existing.id } });
    expect(g).toMatchObject({ title: "Цель из борда", metric: "Метрика из борда", target: "3", base: "0", link: "https://example.com/board/test" });
    expect((await imported("goal", "goal.test.dept-1"))!.entityId).toBe(existing.id);
  });

  it("две цели пакета с одним номером в той же команде и квартале: вторая в ошибках, загрузка не падает", async () => {
    const p = raw();
    p.goals.push({ key: "goal.test.dept-copy", quarter: "2026-Q4", team: "top", code: "ТД-1", title: "Вторая цель с тем же номером" });
    // Тот же номер в другом квартале: не повтор
    p.goals.push({ key: "goal.test.dept-q1", quarter: "2027-Q1", team: "Топ-команда", code: "ТД-1", title: "Цель с тем же номером в следующем квартале" });
    const preview = await previewContentImport(await owner(), pkgOf(p));
    expect(preview.goals).toEqual({ add: 3, update: 0, skip: 1 });
    expect(preview.errors).toEqual([{ what: "Цель «Вторая цель с тем же номером»", text: "номер ТД-1 уже у другой цели пакета в той же команде и квартале: оставьте одну" }]);
    const res = await applyContentImport(await owner(), pkgOf(p));
    expect(res.applied.goals).toBe(3);
    expect(await prisma.goal.count({ where: { code: "ТД-1", quarter: "2026-Q4" } })).toBe(1);
    expect(await imported("goal", "goal.test.dept-copy")).toBeNull();
    // Повтор того же пакета: цель с ключом и вторая цель с её номером, по-прежнему одна ошибка
    expect((await previewContentImport(await owner(), pkgOf(p))).errors).toHaveLength(1);
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

  it("петля целей в пакете видна в предпросмотре и не ломает загрузку", async () => {
    const bad = raw();
    bad.goals[0]!.parent = { key: "goal.test.reva-1" };
    const p = await previewContentImport(await owner(), pkgOf(bad));
    // Петлю замыкает цель, которая в пакете идёт позже (цель Ревы): она и грузится без цели выше, как в правилах служб
    expect(texts(p.warnings)).toMatch(/Цель «Вымышленная цель продукта: собрать тестовую витрину»: цель не может стоять ниже самой себя/);
    await applyContentImport(await owner(), pkgOf(bad));
    const dept = await prisma.goal.findFirstOrThrow({ where: { code: "ТД-1" } });
    const reva = await prisma.goal.findFirstOrThrow({ where: { code: "ТР-1" } });
    expect(dept.parentId).toBe(reva.id);
    expect(reva.parentId).toBeNull();
  });

  it("ошибка посреди загрузки откатывает всё: база остаётся как была", async () => {
    const since = await lastLogId();
    // Ошибка базы на втором решении, уже после задач и целей: имитация сбоя триггером
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_fail_decision() RETURNS trigger AS $$ BEGIN IF NEW.text = 'Выдуманный партнёр получает скидку' THEN RAISE EXCEPTION 'тестовый сбой'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER test_fail_decision BEFORE INSERT ON decisions FOR EACH ROW EXECUTE FUNCTION test_fail_decision()`);
    try {
      await expect(applyContentImport(await owner(), pkgOf(raw()))).rejects.toThrow(/тестовый сбой/);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_fail_decision ON decisions`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_fail_decision()`);
    }
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.goal.count()).toBe(0);
    expect(await prisma.decision.count()).toBe(0);
    expect(await prisma.contentImportKey.count()).toBe(0);
    // Журнал тоже откатился: ни задач, ни записи об импорте
    expect(await prisma.auditLog.count({ where: { id: { gt: since } } })).toBe(0);
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

  it("история: только итог поменялся, поля, которые загрузка не меняет, снятая цель, выключенный ответственный", async () => {
    await applyContentImport(await owner(), pkgOf(raw()));
    const next = raw();
    next.tasks[1]!.resolution = "Другой итог";
    next.tasks[0]!.priority = "low";
    next.tasks[0]!.owner = "Рева Тарас";
    const p = await previewContentImport(await owner(), pkgOf(next));
    const text = p.notes.map((n) => n.text).join("\n");
    expect(text).toMatch(/итог поменялся только в пакете/);
    expect(text).toMatch(/поле «Ответственный» из пакета загрузка не меняет/);
    expect(text).toMatch(/поле «Приоритет» из пакета загрузка не меняет/);
    expect(p.tasks).toEqual({ add: 0, update: 0, skip: 5 });

    // Ответственного выключили после загрузки: его задача находится по ключу, а не теряется
    await prisma.person.update({ where: { slug: "golovkin" }, data: { active: false } });
    try {
      const again = await previewContentImport(await owner(), pkgOf(raw()));
      expect(again.tasks).toEqual({ add: 0, update: 0, skip: 5 });
      expect(again.notes.map((n) => n.text).join("\n")).not.toMatch(/Головкин/);
    } finally {
      await prisma.person.update({ where: { slug: "golovkin" }, data: { active: true } });
    }

    // Снятая цель: новая связь пропускается ещё в предпросмотре
    await prisma.goal.updateMany({ where: { code: "ТР-1" }, data: { result: "DROPPED" } });
    const all = (await taskByKey("task.test.all-1"))!;
    const withLink = raw();
    withLink.links.push({ key: "link.test.dropped", task: { number: all.number }, goal: { code: "ТР-1" } });
    const p2 = await previewContentImport(await owner(), pkgOf(withLink));
    expect(p2.notes.find((n) => n.what === "Связь link.test.dropped")?.text).toBe("цель снята в ресурсе");
  });
});

describe("номера задач во время загрузки", () => {
  it("номера новых задач выделяются заранее: пока идёт загрузка, задачи ставят как обычно", async () => {
    const [res, other] = await Promise.all([applyContentImport(await owner(), pkgOf(raw())), (async () => {
      await new Promise((r) => setTimeout(r, 30));
      return tasks.createTask(await personal("golovkin", "ADMIN"), { title: "Обычная задача во время загрузки", outcome: "Поставлена", owner: "golovkin", direction: "osago", due: "2026-12-30" });
    })()]);
    const numbers = [...res.applied.tasks, other.task.number];
    expect(new Set(numbers).size).toBe(5);
  });

  it("настройка номеров не заперта на всю загрузку: задача, поставленная в это время, проходит сразу", async () => {
    let locked: boolean | null = null;
    let during: number | null = null;
    let reservedEnd: unknown = null;
    hooks.beforeLink = async () => {
      reservedEnd = await nextNumberSetting();
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
    // Взято столько номеров, сколько новых задач по плану (4), а не задач в пакете (5)
    expect(reservedEnd).toBe(res.applied.tasks[0]! + 4);
    expect(during).not.toBeNull();
    expect(res.applied.tasks).not.toContain(during);
    // Задача человека получила номер после взятых загрузкой
    expect(during!).toBeGreaterThan(Math.max(...res.applied.tasks));
  });
});

describe("сроки и даты из истории", () => {
  it("открытая задача со сроком в прошлом встаёт со сроком через две недели или выбранным, исходный срок из пакета остаётся; дата источника не подменяется сегодняшней", async () => {
    const past = addDays(today, -20);
    const later = addDays(today, 14);
    const p = raw();
    p.tasks[3]!.due = past;
    p.tasks[2]!.source = { kind: "meeting" };
    const preview = await previewContentImport(await owner(), pkgOf(p));
    expect(preview.tasks.add).toBe(4);
    expect(preview.staleDue).toBe(later);
    expect(preview.staleTasks).toEqual([{ key: "task.test.co-1", title: "Сверить выдуманные комиссии", due: past }]);
    expect(preview.warnings).toEqual([]);
    // Срок в прошлом для таких задач владелец выбрать не может
    await expectRule(previewContentImport(await owner(), pkgOf(p), { staleDue: addDays(today, -1) }), /Срок для задач без актуального срока: дата не раньше сегодняшней/);
    // Выбранная владельцем дата уходит в загрузку
    const chosen = addDays(today, 30);
    expect((await previewContentImport(await owner(), pkgOf(p), { staleDue: chosen })).staleDue).toBe(chosen);
    await applyContentImport(await owner(), pkgOf(p), { staleDue: chosen });
    const co = (await taskByKey("task.test.co-1"))!;
    expect(co.due.toISOString().slice(0, 10)).toBe(chosen);
    expect(co.originalDue?.toISOString().slice(0, 10)).toBe(past);
    expect(co.transfers).toEqual([]);
    expect(await payloadOf("task", "task.test.co-1")).toMatchObject({ due: chosen, dueRaw: past });
    // Аналитика: на конец недели загрузки задача не просрочена
    const endOfWeek = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    expect(overdueAt({ status: co.status, due: chosen, createdAt: co.createdAt, closedAt: co.closedAt, archivedAt: null, transfers: [] }, endOfWeek, addDays(today, 7))).toBe(false);
    // Встреча без даты: даты источника нет, в повестку как поручение прошлой встречи задача не попадёт
    expect((await taskByKey("task.test.all-1"))!).toMatchObject({ sourceCode: "meeting", sourceDate: null });
    // Задача с актуальным сроком: исходный срок тот же, что срок
    const open = (await taskByKey("task.test.open-1"))!;
    expect(open.originalDue?.toISOString().slice(0, 10)).toBe("2026-12-15");

    // Повтор и правка другого поля: срок не трогается и о нём не пишется
    expect((await previewContentImport(await owner(), pkgOf(p))).tasks.update).toBe(0);
    p.tasks[3]!.title = "Сверить выдуманные комиссии по всем СК";
    const again = await previewContentImport(await owner(), pkgOf(p));
    expect(again.tasks.update).toBe(1);
    expect(again.staleTasks).toEqual([]);
    expect(texts(again.notes)).not.toMatch(/срок/);
    await applyContentImport(await owner(), pkgOf(p));
    expect((await taskByKey("task.test.co-1"))!.due.toISOString().slice(0, 10)).toBe(chosen);
  });

  it("без выбора срок для задач без актуального срока: сегодня плюс 14 дней", async () => {
    const p = raw();
    p.tasks[0]!.due = addDays(today, -3);
    await applyContentImport(await owner(), pkgOf(p));
    expect((await taskByKey("task.test.open-1"))!.due.toISOString().slice(0, 10)).toBe(addDays(today, 14));
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

  it("вероятные дубли того, что уже есть в ресурсе, по умолчанию пропускаются, их можно включить по одному или все", async () => {
    const me = await prisma.person.findUniqueOrThrow({ where: { slug: "muradyan" } });
    const twin = (await tasks.createTask(await owner(), { title: "Собрать тестовую сводку по выдуманным партнёрам", outcome: "Уже есть в ресурсе", owner: "golovkin", direction: "osago", due: "2026-12-10", source: "weekly" })).task;
    // Не дубли: в названии другое число; срок дальше трёх недель
    await tasks.createTask(await owner(), { title: "Сверить выдуманные комиссии за 2025", outcome: "Прошлый год", owner: "fatyanov", direction: "kasko", due: "2026-11-30", source: "weekly" });
    await tasks.createTask(await owner(), { title: "Подготовить выдуманный разбор тарифов", outcome: "Другая волна", owner: "loginova", direction: "red", due: "2026-12-30", source: "weekly" });
    await prisma.decision.create({ data: { teamId: TOP_TEAM, text: "Тестовые сводки ведём в одном файле.", date: dbDate("2026-10-13"), createdById: me.id } });
    // Не дубль: другое число в тексте решения за ту же дату
    await prisma.decision.create({ data: { teamId: TOP_TEAM, text: "Выдуманный партнёр получает скидку 10%", date: dbDate("2026-09-22"), createdById: me.id } });
    const preview = await previewContentImport(await owner(), pkgOf(raw()));
    expect(preview.tasks).toEqual({ add: 3, update: 0, skip: 2 });
    expect(preview.decisions).toEqual({ add: 1, update: 0, skip: 1 });
    expect(preview.links).toEqual({ add: 1, update: 0, skip: 1 });
    expect(preview.duplicates).toEqual([
      {
        id: "task/task.test.open-1",
        what: "Задача «Собрать тестовую сводку по выдуманным партнёрам»",
        text: `похожа на задачу ${twin.number} «Собрать тестовую сводку по выдуманным партнёрам»: тот же ответственный, похожее название и близкий срок, пропустится`,
        on: false,
      },
      { id: "decision/decision.test.1", what: "Решение «Тестовые сводки ведём в одном файле»", text: "похоже на решение команды за 13 октября «Тестовые сводки ведём в одном файле.», пропустится", on: false },
    ]);

    // Владелец выбрал только задачу: она загружается, решение-дубль пропускается
    const picked = await previewContentImport(await owner(), pkgOf(raw()), { duplicateKeys: ["task/task.test.open-1"] });
    expect(picked).toMatchObject({ tasks: { add: 4 }, decisions: { add: 1, skip: 1 }, withDuplicates: false });
    expect(picked.duplicates.map((d) => [d.id, d.on])).toEqual([
      ["task/task.test.open-1", true],
      ["decision/decision.test.1", false],
    ]);
    await applyContentImport(await owner(), pkgOf(raw()), { duplicateKeys: ["task/task.test.open-1"] });
    expect(await imported("task", "task.test.open-1")).not.toBeNull();
    expect(await prisma.decision.count({ where: { text: { startsWith: "Тестовые сводки" } } })).toBe(1);

    // Потом «Загрузить все дубли»: оставшееся решение загружается
    const all = await previewContentImport(await owner(), pkgOf(raw()), { duplicates: true });
    expect(all).toMatchObject({ withDuplicates: true, decisions: { add: 1 } });
    expect(all.duplicates).toEqual([expect.objectContaining({ id: "decision/decision.test.1", on: true, text: expect.stringMatching(/загрузится, как вы выбрали$/) })]);
    await applyContentImport(await owner(), pkgOf(raw()), { duplicates: true });
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

describe("подхват задач ресурса и цели из бордов", () => {
  it("задача, поставленная в ресурсе до импорта, подхватывается по номеру: статус, где сейчас и срок как в пакете", async () => {
    const me = await owner();
    const made = await tasks.createTask(me, { title: "Старая задача из Bord", outcome: "Как было", owner: "reva", direction: "product", due: "2026-12-01" });
    const closed = await tasks.createTask(me, { title: "Уже закрытая в ресурсе", outcome: "Как было", owner: "reva", direction: "product", due: "2026-12-01" });
    await tasks.changeStatus(me, closed.task.number, "done", "Закрыли руками");
    const pkg = raw();
    pkg.tasks = [
      { key: "task.test.adopt-1", title: "Старая задача из Bord", outcome: "Как было", owner: "Рева Тарас", direction: "product", due: "2026-12-10", status: "done", resolution: "Выполнена по рабочему Bord", closedAt: "2026-10-13", whereNow: "13.10: сделано", adopt: { number: made.task.number, title: "Старая задача из Bord" } },
      { key: "task.test.adopt-2", title: "Уже закрытая в ресурсе", outcome: "Как было", owner: "Рева Тарас", direction: "product", due: "2026-12-01", status: "in-progress", adopt: { number: closed.task.number, title: "Уже закрытая в ресурсе" } },
      { key: "task.test.adopt-3", title: "Чужая", outcome: "Нет", owner: "Рева Тарас", direction: "product", due: "2026-12-01", adopt: { number: made.task.number + 100, title: "Чужая" } },
    ];
    pkg.decisions = [];
    pkg.links = [];
    const before = await prisma.task.count();
    const p = await previewContentImport(me, pkgOf(pkg));
    expect(p.tasks).toEqual({ add: 0, update: 1, skip: 2 });
    expect(p.notes.map((n) => n.text).join("\n")).toMatch(/задача закрыта в ресурсе, загрузка её не открывает/);
    expect(p.notes.map((n) => n.text).join("\n")).toMatch(/задачи \d+ нет в ресурсе/);
    await applyContentImport(me, pkgOf(pkg));
    expect(await prisma.task.count()).toBe(before);
    const t = await prisma.task.findUniqueOrThrow({ where: { number: made.task.number }, include: { transfers: true } });
    expect(t).toMatchObject({ status: "DONE", resolution: "Выполнена по рабочему Bord", whereNow: "13.10: сделано" });
    expect(t.due.toISOString().slice(0, 10)).toBe("2026-12-10");
    expect(t.closedAt?.toISOString().slice(0, 10)).toBe("2026-10-13");
    expect((await prisma.task.findUniqueOrThrow({ where: { number: closed.task.number } })).status).toBe("DONE");
    expect((await imported("task", "task.test.adopt-1"))!.entityId).toBe(t.id);
    // Повтор: ничего не меняется
    const again = await previewContentImport(me, pkgOf(pkg));
    expect(again.tasks.update + again.tasks.add).toBe(0);
  });

  it("цель из борда с тем же номером приводится к пакету целиком, новая цель из борда помечается как цель борда", async () => {
    const me = await prisma.person.findUniqueOrThrow({ where: { slug: "muradyan" } });
    const reva = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
    await prisma.goal.create({ data: { quarter: "2026-Q4", code: "РТ-3", title: "Старое название", target: "10%", teamId: TOP_TEAM, ownerId: reva.id, source: "leader-board:test" } });
    void me;
    const pkg = raw();
    pkg.goals = [
      { key: "goal.test.rt-3", quarter: "2026-Q4", team: "Топ-команда", owner: "Рева Тарас", code: "РТ-3", title: "Клиентов с 2+ продуктами не ниже 15%", target: "15% в декабре", replace: true, source: "leader-board:Цели CPO" },
      { key: "goal.test.rt-10", quarter: "2026-Q4", team: "Топ-команда", owner: "Рева Тарас", code: "РТ-10", title: "Новая цель борда", source: "leader-board:Цели CPO" },
    ];
    pkg.tasks = [];
    pkg.decisions = [];
    pkg.links = [];
    const p = await previewContentImport(await owner(), pkgOf(pkg));
    expect(p.goals).toEqual({ add: 1, update: 1, skip: 0 });
    await applyContentImport(await owner(), pkgOf(pkg));
    expect(await prisma.goal.findFirstOrThrow({ where: { code: "РТ-3" } })).toMatchObject({ title: "Клиентов с 2+ продуктами не ниже 15%", target: "15% в декабре", source: "leader-board:test" });
    expect(await prisma.goal.findFirstOrThrow({ where: { code: "РТ-10" } })).toMatchObject({ source: "leader-board:Цели CPO", ownerId: reva.id });
  });

  // ---------- Стыки подхвата и replace с кадровым фильтром, дублями, сроком по умолчанию и повтором номера ----------

  it("подхват по номеру и кадровый фильтр: запись с кадровыми сведениями в ошибках, задача ресурса не тронута", async () => {
    const me = await owner();
    const hr = (await tasks.createTask(me, { title: "Сверить выдуманные комиссии партнёра", outcome: "Как было", owner: "reva", direction: "product", due: "2026-12-01" })).task;
    const ok = (await tasks.createTask(me, { title: "Обновить выдуманный прайс", outcome: "Как было", owner: "reva", direction: "product", due: "2026-12-01" })).task;
    const pkg = raw();
    pkg.tasks = [
      { key: "task.test.adopt-hr", title: "Сверить выдуманные комиссии партнёра", outcome: "Как было", owner: "Рева Тарас", direction: "product", due: "2026-12-05", whereNow: "Ждём решения по окладу аналитика", adopt: { number: hr.number, title: "Сверить выдуманные комиссии партнёра" } },
      { key: "task.test.adopt-ok", title: "Обновить выдуманный прайс", outcome: "Как было", owner: "Рева Тарас", direction: "product", due: "2026-12-01", status: "done", resolution: "Премия по полису пересчитана", adopt: { number: ok.number, title: "Обновить выдуманный прайс" } },
    ];
    pkg.decisions = [];
    pkg.links = [];
    const p = await previewContentImport(me, pkgOf(pkg));
    expect(p.errors).toEqual([{ what: "Задача «Сверить выдуманные комиссии партнёра»", text: "кадровые сведения («окладу» в поле «Где сейчас»): такие записи в ресурс не загружаются, уберите их из пакета" }]);
    // Страховая премия в итоге не кадровое: вторая задача подхватывается и закрывается
    expect(p.tasks).toEqual({ add: 0, update: 1, skip: 1 });
    await applyContentImport(me, pkgOf(pkg));
    const untouched = await prisma.task.findUniqueOrThrow({ where: { number: hr.number }, include: { transfers: true } });
    expect(untouched.whereNow).toBe("");
    expect(untouched.due.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(untouched.transfers).toEqual([]);
    expect(await imported("task", "task.test.adopt-hr")).toBeNull();
    expect(await prisma.task.findUniqueOrThrow({ where: { number: ok.number } })).toMatchObject({ status: "DONE", resolution: "Премия по полису пересчитана" });
    expect((await imported("task", "task.test.adopt-ok"))!.entityId).toBe((await prisma.task.findUniqueOrThrow({ where: { number: ok.number } })).id);
  });

  it("подхват по номеру не дубль своей задачи; новая запись, похожая на подхваченную задачу, дубль", async () => {
    const me = await owner();
    const made = (await tasks.createTask(me, { title: "Собрать выдуманные тарифы партнёров", outcome: "Как было", owner: "reva", direction: "product", due: "2026-12-01" })).task;
    const before = await prisma.task.count();
    const pkg = raw();
    pkg.tasks = [
      { key: "task.test.adopt-twin", title: "Собрать выдуманные тарифы партнёров", outcome: "Сводка", owner: "Рева Тарас", direction: "product", due: "2026-12-03", whereNow: "Собрали тарифы трёх партнёров", adopt: { number: made.number, title: "Собрать выдуманные тарифы партнёров" } },
      { key: "task.test.twin-copy", title: "Собрать выдуманные тарифы партнёров", outcome: "Копия", owner: "Рева Тарас", direction: "product", due: "2026-12-03" },
    ];
    pkg.decisions = [];
    pkg.links = [];
    const p = await previewContentImport(me, pkgOf(pkg));
    expect(p.tasks).toEqual({ add: 0, update: 1, skip: 1 });
    expect(p.duplicates.map((d) => [d.id, d.on])).toEqual([["task/task.test.twin-copy", false]]);
    expect(p.duplicates[0]!.text).toMatch(new RegExp(`похожа на задачу ${made.number} `));
    await applyContentImport(me, pkgOf(pkg));
    expect(await prisma.task.count()).toBe(before);
    const t = await prisma.task.findUniqueOrThrow({ where: { number: made.number }, include: { transfers: true } });
    expect(t).toMatchObject({ whereNow: "Собрали тарифы трёх партнёров", outcome: "Как было" });
    expect(t.due.toISOString().slice(0, 10)).toBe("2026-12-03");
    expect(t.transfers.map((x) => x.reason)).toEqual(["Срок обновлён из пакета наполнения"]);
    expect(await imported("task", "task.test.twin-copy")).toBeNull();

    // Владелец отметил копию: она встаёт новой задачей, подхваченная задача уже без изменений
    const picked = await previewContentImport(me, pkgOf(pkg), { duplicateKeys: ["task/task.test.twin-copy"] });
    expect(picked.tasks).toEqual({ add: 1, update: 0, skip: 1 });
    expect(picked.duplicates.map((d) => [d.id, d.on])).toEqual([["task/task.test.twin-copy", true]]);
    const res = await applyContentImport(me, pkgOf(pkg), { duplicateKeys: ["task/task.test.twin-copy"] });
    expect(res.applied.tasks).toHaveLength(1);
    expect(await prisma.task.count()).toBe(before + 1);
  });

  it("подхват и срок в прошлом: срок по умолчанию не ставится, свой срок задачи остаётся, будущий срок из пакета переносится потом", async () => {
    const me = await owner();
    const ownDue = addDays(today, 30);
    const own = (await tasks.createTask(me, { title: "Обновить выдуманный прайс", outcome: "Как было", owner: "reva", direction: "product", due: ownDue })).task;
    const late = (await tasks.createTask(me, { title: "Сверить выдуманные акты", outcome: "Как было", owner: "reva", direction: "product", due: addDays(today, 5) })).task;
    // В ресурсе срок уже прошёл
    await prisma.task.update({ where: { number: late.number }, data: { due: dbDate(addDays(today, -10)) } });
    const pkg = raw();
    pkg.tasks = [
      { key: "task.test.adopt-own", title: "Обновить выдуманный прайс", outcome: "Как было", owner: "Рева Тарас", direction: "product", due: addDays(today, -20), whereNow: "Ждём выдуманного партнёра", adopt: { number: own.number, title: "Обновить выдуманный прайс" } },
      { key: "task.test.adopt-late", title: "Сверить выдуманные акты", outcome: "Как было", owner: "Рева Тарас", direction: "product", due: addDays(today, -15), adopt: { number: late.number, title: "Сверить выдуманные акты" } },
      { key: "task.test.new-stale", title: "Новая выдуманная задача без актуального срока", outcome: "Сделано", owner: "Рева Тарас", direction: "product", due: addDays(today, -5) },
    ];
    pkg.decisions = [];
    pkg.links = [];
    const p = await previewContentImport(me, pkgOf(pkg));
    // В списке задач без актуального срока только новая задача
    expect(p.staleTasks).toEqual([{ key: "task.test.new-stale", title: "Новая выдуманная задача без актуального срока", due: addDays(today, -5) }]);
    expect(p.tasks).toEqual({ add: 1, update: 1, skip: 1 });
    expect(p.notes.filter((n) => /срок .* не перенесён: задача закрыта или срок уже прошёл/.test(n.text)).map((n) => n.what)).toEqual([`Задача ${own.number}`, `Задача ${late.number}`]);
    await applyContentImport(me, pkgOf(pkg));
    const a = await prisma.task.findUniqueOrThrow({ where: { number: own.number }, include: { transfers: true } });
    expect(a.due.toISOString().slice(0, 10)).toBe(ownDue);
    expect(a.transfers).toEqual([]);
    expect(a.whereNow).toBe("Ждём выдуманного партнёра");
    expect((await prisma.task.findUniqueOrThrow({ where: { number: late.number } })).due.toISOString().slice(0, 10)).toBe(addDays(today, -10));
    expect((await taskByKey("task.test.new-stale"))!.due.toISOString().slice(0, 10)).toBe(addDays(today, 14));
    expect((await imported("task", "task.test.adopt-late"))!.entityId).toBe((await prisma.task.findUniqueOrThrow({ where: { number: late.number } })).id);

    // Следующий пакет даёт подхваченной задаче будущий срок: срок переносится, как у своей задачи
    const later = addDays(today, 60);
    pkg.tasks[0]!.due = later;
    const next = await previewContentImport(me, pkgOf(pkg));
    expect(next.tasks).toEqual({ add: 0, update: 1, skip: 2 });
    // Источник, ссылки и подхват в ключе лежат как jsonb с другим порядком полей: это не правка пакета
    expect(texts(next.notes)).not.toMatch(/из пакета загрузка не меняет/);
    await applyContentImport(me, pkgOf(pkg));
    const moved = await prisma.task.findUniqueOrThrow({ where: { number: own.number }, include: { transfers: true } });
    expect(moved.due.toISOString().slice(0, 10)).toBe(later);
    expect(moved.transfers.map((x) => x.reason)).toEqual(["Срок обновлён из пакета наполнения"]);
  });

  it("подхваченная задача на следующих загрузках: название ведут в ресурсе, закрытую в ресурсе загрузка не открывает", async () => {
    const me = await owner();
    const made = (await tasks.createTask(me, { title: "Выдуманная задача ресурса", outcome: "Как было", owner: "reva", direction: "product", due: "2026-12-01" })).task;
    await tasks.changeStatus(me, made.number, "done", "Закрыли руками");
    const pkg = raw();
    pkg.tasks = [{ key: "task.test.adopt-closed", title: "Выдуманная задача ресурса", outcome: "Как было", owner: "Рева Тарас", direction: "product", due: "2026-12-01", status: "in-progress", adopt: { number: made.number, title: "Выдуманная задача ресурса" } }];
    pkg.decisions = [];
    pkg.links = [];
    await applyContentImport(me, pkgOf(pkg));
    expect((await payloadOf("task", "task.test.adopt-closed")).owned).toEqual(["whereNow", "due"]);
    // Пакет меняет название, статус и «Где сейчас»: меняется только «Где сейчас»
    pkg.tasks[0]!.title = "Выдуманная задача из пакета";
    pkg.tasks[0]!.status = "clarify";
    pkg.tasks[0]!.whereNow = "Уточняем у выдуманного партнёра";
    const p = await previewContentImport(me, pkgOf(pkg));
    expect(p.tasks).toEqual({ add: 0, update: 1, skip: 0 });
    await applyContentImport(me, pkgOf(pkg));
    expect(await prisma.task.findUniqueOrThrow({ where: { number: made.number } })).toMatchObject({ title: "Выдуманная задача ресурса", status: "DONE", resolution: "Закрыли руками", whereNow: "Уточняем у выдуманного партнёра" });
  });

  it("replace цели и повтор номера цели: вторая цель с тем же номером в ошибках, первая приводится к пакету", async () => {
    const reva = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
    const board = await prisma.goal.create({ data: { quarter: "2026-Q4", code: "РТ-3", title: "Старое название", target: "10%", teamId: TOP_TEAM, ownerId: reva.id, source: "leader-board:test" } });
    const pkg = raw();
    pkg.goals = [
      { key: "goal.test.rt-3", quarter: "2026-Q4", team: "Топ-команда", owner: "Рева Тарас", code: "РТ-3", title: "Новое название из борда", target: "15%", replace: true, source: "leader-board:Цели CPO" },
      { key: "goal.test.rt-3-copy", quarter: "2026-Q4", team: "top", code: "РТ-3", title: "Вторая цель с тем же номером", replace: true },
    ];
    pkg.tasks = [];
    pkg.decisions = [];
    pkg.links = [];
    const p = await previewContentImport(await owner(), pkgOf(pkg));
    expect(p.goals).toEqual({ add: 0, update: 1, skip: 1 });
    expect(p.errors).toEqual([{ what: "Цель «Вторая цель с тем же номером»", text: "номер РТ-3 уже у другой цели пакета в той же команде и квартале: оставьте одну" }]);
    expect(p.notes.find((n) => n.what === "Цель РТ-3")?.text).toBe("уже есть в ресурсе: загрузка приведёт к пакету 2 поля");
    await applyContentImport(await owner(), pkgOf(pkg));
    expect(await prisma.goal.count({ where: { code: "РТ-3" } })).toBe(1);
    expect(await prisma.goal.findUniqueOrThrow({ where: { id: board.id } })).toMatchObject({ title: "Новое название из борда", target: "15%", source: "leader-board:test" });
    expect((await imported("goal", "goal.test.rt-3"))!.entityId).toBe(board.id);
    expect(await imported("goal", "goal.test.rt-3-copy")).toBeNull();
    // Повтор: цель с ключом без изменений, вторая по-прежнему в ошибках
    const again = await previewContentImport(await owner(), pkgOf(pkg));
    expect(again.goals).toEqual({ add: 0, update: 0, skip: 2 });
    expect(again.errors).toHaveLength(1);
  });

  it("цель борда: сначала только пустые поля, потом replace приводит её к пакету, дальше правки ресурса живут", async () => {
    const reva = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
    const board = await prisma.goal.create({ data: { quarter: "2026-Q4", code: "РТ-4", title: "Название из борда", metric: "Метрика борда", teamId: TOP_TEAM, ownerId: reva.id, source: "leader-board:test" } });
    const pkg = raw();
    pkg.goals = [{ key: "goal.test.rt-4", quarter: "2026-Q4", team: "Топ-команда", owner: "Рева Тарас", code: "РТ-4", title: "Название из пакета", metric: "Метрика пакета", target: "20%" }];
    pkg.tasks = [];
    pkg.decisions = [];
    pkg.links = [];
    await applyContentImport(await owner(), pkgOf(pkg));
    expect(await prisma.goal.findUniqueOrThrow({ where: { id: board.id } })).toMatchObject({ title: "Название из борда", metric: "Метрика борда", target: "20%" });
    expect((await payloadOf("goal", "goal.test.rt-4")).owned).toEqual(["target"]);

    pkg.goals[0]!.replace = true;
    const p = await previewContentImport(await owner(), pkgOf(pkg));
    expect(p.goals).toEqual({ add: 0, update: 1, skip: 0 });
    expect(texts(p.notes)).toMatch(/цель приводится к пакету целиком \(replace\)/);
    await applyContentImport(await owner(), pkgOf(pkg));
    expect(await prisma.goal.findUniqueOrThrow({ where: { id: board.id } })).toMatchObject({ title: "Название из пакета", metric: "Метрика пакета", target: "20%", source: "leader-board:test" });
    expect((await payloadOf("goal", "goal.test.rt-4")).owned).toBeUndefined();

    // Целевое поправили в ресурсе: следующий пакет меняет целевое и метрику, загрузка меняет только метрику
    await updateGoal(await owner(), board.id, { target: "25%" });
    pkg.goals[0]!.target = "30%";
    pkg.goals[0]!.metric = "Новая метрика пакета";
    await applyContentImport(await owner(), pkgOf(pkg));
    expect(await prisma.goal.findUniqueOrThrow({ where: { id: board.id } })).toMatchObject({ metric: "Новая метрика пакета", target: "25%" });
  });
});
