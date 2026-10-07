// Задачи на настоящей базе: импорт и сверка, номера, правила просрочки и переносов, матрица прав, журнал, отмена.
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { importBordTasks, reconcileBordTasks } from "@/lib/tasks/bord-import";
import * as svc from "@/lib/tasks/service";
import { isOverdue } from "@/lib/tasks/rules";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";

const CSV = readFileSync("data/bord/zadachi-2026-10-05.csv", "utf8");
const BATCH = "bord-2026-10-05";
const today = moscowToday();
const future = addDays(today, 10);

async function resetTasks() {
  await prisma.task.deleteMany();
  await prisma.setting.update({ where: { key: "tasks.nextNumber" }, data: { value: 52 } });
  await importBordTasks(prisma, CSV, { batch: BATCH });
}

const actors = {
  owner: () => svc.actorFor("muradyan", "OWNER"),
  ownerPlain: () => svc.actorFor("muradyan"),
  admin: () => svc.actorFor("golovkin", "ADMIN"),
  reva: () => svc.actorFor("reva"),
  fatyanov: () => svc.actorFor("fatyanov"),
  loginova: () => svc.actorFor("loginova"),
  observer: async (): Promise<svc.Actor> => ({ ...(await svc.actorFor("ceo")), role: "OBSERVER" }),
};

const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(svc.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

async function lastAudit(number: number) {
  return prisma.auditLog.findFirst({ where: { entity: "task", entityId: String(number) }, orderBy: { id: "desc" } });
}

beforeEach(resetTasks);
afterAll(() => prisma.$disconnect());

describe("импорт из таблицы и сверка (критерий приёмки этапа 3)", () => {
  it("51 задача, повторный запуск ничего не дублирует, сверка даёт 0 расхождений", async () => {
    expect(await prisma.task.count()).toBe(51);
    const again = await importBordTasks(prisma, CSV, { batch: BATCH });
    expect(again.created).toHaveLength(0);
    expect(again.skipped).toHaveLength(51);
    expect(again.nextNumber).toBe(52);
    const report = await reconcileBordTasks(prisma, CSV, "2026-10-04");
    expect(report.checked).toBe(51);
    expect(report.diffs).toEqual([]);
    expect(report.notInTable).toEqual([]);
  });

  it("«Перенесена» стала «В работе» с одним переносом без исходного срока, приоритет и состояние не заданы", async () => {
    for (const n of [8, 12, 24]) {
      const t = (await svc.getTask(n))!;
      expect(t.status).toBe("in-progress");
      expect(t.transfers).toEqual([{ from: null, to: t.due, by: null, reason: "Перенесена в таблице до запуска ресурса", at: null }]);
    }
    const t1 = (await svc.getTask(1))!;
    expect(t1.status).toBe("done");
    expect(t1.resolution).toBeTruthy();
    expect(t1.priority).toBe("unset");
    expect(t1.state).toBe("unset");
    expect(t1.createdBy).toBeNull();
  });

  it("сверка видит любое расхождение по полю", async () => {
    await prisma.task.update({ where: { number: 5 }, data: { title: "Другое название" } });
    const admin = await actors.admin();
    await svc.transferDue(admin, 7, future, "Ждём данных");
    const report = await reconcileBordTasks(prisma, CSV, "2026-10-04");
    const fields = report.diffs.map((d) => `${d.number}:${d.field}`).sort();
    expect(fields).toEqual(["5:Задача", "7:Срок", "7:Статус просроченности"].sort());
  });

  it("новые задачи ресурса сверку не ломают, а пропавшая из ресурса задача видна", async () => {
    await svc.createTask(await actors.admin(), { title: "Новая", outcome: "Результат", owner: "reva", direction: "product", due: future });
    await prisma.task.delete({ where: { number: 3 } });
    const report = await reconcileBordTasks(prisma, CSV, "2026-10-04");
    expect(report.newInResource).toEqual([52]);
    expect(report.diffs).toEqual([expect.objectContaining({ number: 3, resource: "нет в ресурсе" })]);
  });

  it("ошибка в выгрузке останавливает импорт целиком", async () => {
    await prisma.task.deleteMany();
    const broken = CSV.replace("Мурадян Арам,Отправить образец", "Неизвестный Человек,Отправить образец");
    await expect(importBordTasks(prisma, broken, { batch: BATCH })).rejects.toThrow(/Неизвестный Человек/);
    expect(await prisma.task.count()).toBe(0);
  });
});

describe("номера и постановка задач", () => {
  it("новые задачи начинаются с 52 и идут подряд, даже если ставят одновременно", async () => {
    const admin = await actors.admin();
    const input = { title: "Задача", outcome: "Результат", owner: "reva" as const, direction: "product", due: future };
    const results = await Promise.all([1, 2, 3, 4].map(() => svc.createTask(admin, input)));
    expect(results.map((r) => r.task.number).sort()).toEqual([52, 53, 54, 55]);
    const setting = await prisma.setting.findUnique({ where: { key: "tasks.nextNumber" } });
    expect(setting?.value).toBe(56);
  });

  it("лидер ставит задачу себе, другому только предлагает; предложенную принимает адресат или администратор (этап 21)", async () => {
    const reva = await actors.reva();
    const own = await svc.createTask(reva, { title: "Себе", outcome: "Готово", owner: "reva", direction: "product", due: future });
    expect(own.task.status).toBe("in-progress");
    expect(own.task.priority).toBe("medium");
    expect(own.task.state).toBe("on-track");
    const offer = await svc.createTask(reva, { title: "Логиновой", outcome: "Готово", owner: "loginova", direction: "red", due: future });
    expect(offer.task.status).toBe("proposed");
    // Посторонний лидер предложение не решает, адресат решает сам и в топ-команде
    await expectRule(svc.changeStatus(await actors.fatyanov(), offer.task.number, "in-progress"), /принимает адресат/);
    // Адресат только принимает или отклоняет: сразу закрыть предложенную задачу нельзя
    await expectRule(svc.changeStatus(await actors.loginova(), offer.task.number, "done", "Сделано"), /принять в работу или отклонить/);
    const ok = await svc.changeStatus(await actors.loginova(), offer.task.number, "in-progress");
    expect(ok.task.status).toBe("in-progress");
    expect((await lastAudit(offer.task.number))?.before).toBe("Предложена");
    // Режим управления решает за адресата
    const second = await svc.createTask(reva, { title: "Ещё Логиновой", outcome: "Готово", owner: "loginova", direction: "red", due: future });
    expect((await svc.changeStatus(await actors.admin(), second.task.number, "in-progress")).task.status).toBe("in-progress");
  });

  it("наблюдатель не ставит задач и не комментирует, лидер не ставит задачу в прошлое", async () => {
    const observer = await actors.observer();
    await expectRule(svc.createTask(observer, { title: "Нет", outcome: "Нет", owner: "reva", direction: "product", due: future }), /Наблюдатель/);
    await expectRule(svc.addComment(observer, 2, "Нет"), /Наблюдатель/);
    await expectRule(svc.createTask(await actors.reva(), { title: "Вчера", outcome: "Нет", owner: "reva", direction: "product", due: addDays(today, -1) }), /в прошлом/);
    await expectRule(svc.createTask(await actors.reva(), { title: "x".repeat(121), outcome: "Нет", owner: "reva", direction: "product", due: future }), /120/);
  });
});

describe("правила просрочки и переносов (раздел 4 ТЗ)", () => {
  it("перенос без причины и в прошлое невозможен, исходный срок и история переносов сохраняются", async () => {
    const fat = await actors.fatyanov();
    await expectRule(svc.transferDue(fat, 13, future, "  "), /Без причины/);
    const before = (await svc.getTask(13))!;
    // Вчера может совпасть с нынешним сроком задачи (срок 13-й задачи в выгрузке 06.10): тогда сработало бы «Выберите новый срок»
    const past = addDays(today, -1) === before.due ? addDays(today, -2) : addDays(today, -1);
    await expectRule(svc.transferDue(fat, 13, past, "Причина"), /в прошлом/);
    const r = await svc.transferDue(fat, 13, future, "Ждём ВСК");
    expect(r.task.due).toBe(future);
    expect(r.task.originalDue).toBe(before.due);
    expect(r.task.transfers).toEqual([expect.objectContaining({ from: before.due, to: future, by: "fatyanov", reason: "Ждём ВСК" })]);
    const a = await lastAudit(13);
    expect(a?.field).toBe("Срок");
    expect(String(a?.after)).toContain("Ждём ВСК");
  });

  it("второй перенос задачи, перенесённой в таблице: счётчик 2, первый перенос без исходного срока", async () => {
    const r = await svc.transferDue(await actors.fatyanov(), 12, future, "Ждём отчёт НСИС");
    expect(r.task.transfers.map((t) => t.from === null)).toEqual([true, false]);
  });

  it("просрочка: срок прошёл, статус «В работе» или «Требует уточнений»; закрытая и предложенная не просрочены", async () => {
    const t5 = (await svc.getTask(5))!; // срок 23.09, в работе
    expect(isOverdue(t5, "2026-10-04")).toBe(true);
    const clarify = await svc.changeStatus(await actors.reva(), 5, "clarify");
    expect(isOverdue(clarify.task, "2026-10-04")).toBe(true);
    const done = await svc.changeStatus(await actors.reva(), 5, "done", "Ссылка отправлена в чат");
    expect(isOverdue(done.task, "2026-10-04")).toBe(false);
  });

  it("«Выполнена» требует итог, «Не выполнена» и «Отменена» причину, база не даст закрыть без текста", async () => {
    const reva = await actors.reva();
    await expectRule(svc.changeStatus(reva, 7, "done"), /итог/);
    await expectRule(svc.changeStatus(reva, 7, "failed", " "), /причины/);
    await expectRule(svc.changeStatus(reva, 7, "proposed"), /только система/);
    const done = await svc.changeStatus(reva, 7, "done", "Результаты показали на weekly");
    expect(done.task.closedAt).toBe(today);
    expect(done.task.resolution).toBe("Результаты показали на weekly");
    const reopened = await svc.changeStatus(reva, 7, "in-progress");
    expect(reopened.task.closedAt).toBeUndefined();
    expect(reopened.task.resolution).toBeUndefined();
    await expect(prisma.task.update({ where: { number: 7 }, data: { status: "CANCELLED", resolution: null } })).rejects.toThrow();
  });

  it("«Заблокирована» только со ссылкой на задачу или человека (этап 21), закрытой задаче срок не переносят", async () => {
    const reva = await actors.reva();
    await expectRule(svc.changeState(reva, 9, "blocked"), /кого ждёт задача/);
    await expectRule(svc.changeState(reva, 9, "blocked", "Нет доступа к LRF, поможет Даша"), /кого ждёт задача/);
    const blocked = await svc.changeState(reva, 9, "blocked", "Нет доступа к LRF, поможет Даша", { waitTask: 13 });
    expect(blocked.task.blockedBy).toBe("Нет доступа к LRF, поможет Даша");
    const unblocked = await svc.changeState(reva, 9, "on-track");
    expect(unblocked.task.blockedBy).toBeUndefined();
    await svc.changeStatus(reva, 9, "cancelled", "Не нужно");
    await expectRule(svc.transferDue(reva, 9, future, "Причина"), /Закрытой задаче/);
  });
});

describe("матрица прав раздела 2 на сервере", () => {
  it("лидер меняет статус, состояние и срок только своей задачи", async () => {
    const reva = await actors.reva();
    await expectRule(svc.changeStatus(reva, 13, "clarify"), /Статус меняет/);
    await expectRule(svc.changeState(reva, 13, "at-risk", "Ждём данные"), /Состояние меняет/);
    await expectRule(svc.transferDue(reva, 13, future, "Причина"), /Срок переносит/);
    await expectRule(svc.updateWhere(reva, 13, "Текст"), /пишут ответственный и соисполнители/);
    expect((await svc.changeStatus(await actors.admin(), 13, "clarify")).task.status).toBe("clarify");
  });

  it("общую задачу «Все лидеры» ведёт любой лидер", async () => {
    const r = await svc.updateWhere(await actors.loginova(), 2, "Цели RED внесены");
    expect(r.task.where).toBe("Цели RED внесены");
    expect(r.task.whereUpdatedAt).toBe(today);
  });

  it("соисполнитель пишет «где сейчас», но статус не меняет", async () => {
    await svc.setCoExecutors(await actors.admin(), 13, ["reva"]);
    const reva = await actors.reva();
    expect((await svc.updateWhere(reva, 13, "Выгрузили объёмы")).task.where).toBe("Выгрузили объёмы");
    await expectRule(svc.changeStatus(reva, 13, "clarify"), /Статус меняет/);
  });

  it("приоритет: лидер только у поставленных им, у задач со встречи только режим управления", async () => {
    const reva = await actors.reva();
    await expectRule(svc.changePriority(reva, 7, "high"), /Приоритет меняет/);
    const own = await svc.createTask(reva, { title: "Моя", outcome: "Готово", owner: "reva", direction: "product", due: future });
    expect((await svc.changePriority(reva, own.task.number, "high")).task.priority).toBe("high");
    expect((await svc.changePriority(await actors.admin(), 7, "critical")).task.priority).toBe("critical");
    await expectRule(svc.changePriority(await actors.admin(), 7, "unset"), /Выберите приоритет/);
  });

  it("правка полей: тот, кто поставил, или режим управления; ответственного меняет только режим управления", async () => {
    const reva = await actors.reva();
    await expectRule(svc.editTask(reva, 7, { title: "Новое" }), /правит тот, кто её поставил/);
    const admin = await actors.admin();
    const edited = await svc.editTask(admin, 7, { title: "Итоги AB-теста согласия", direction: "osago" });
    expect(edited.task.title).toBe("Итоги AB-теста согласия");
    expect(edited.task.direction).toBe("osago");
    await expectRule(svc.assignOwner(reva, 7, "loginova"), /меняют владелец или администратор/);
    await svc.setCoExecutors(admin, 7, ["loginova"]);
    const moved = await svc.assignOwner(admin, 7, "loginova");
    expect(moved.task.owner).toBe("loginova");
    // Новый ответственный перестаёт быть своим соисполнителем
    expect(moved.task.coExecutors).toEqual([]);
  });

  it("в архив отправляет только владелец в режиме управления, архивную задачу правит только он", async () => {
    await expectRule(svc.archiveTask(await actors.admin(), 4), /только владелец/);
    await expectRule(svc.archiveTask(await actors.ownerPlain(), 4), /только владелец/);
    const r = await svc.archiveTask(await actors.owner(), 4);
    expect(r.task.archived).toBe(true);
    expect((await svc.listTasks()).some((t) => t.number === 4)).toBe(false);
    expect((await svc.listTasks({ archived: true })).some((t) => t.number === 4)).toBe(true);
    await expectRule(svc.updateWhere(await actors.admin(), 4, "Текст"), /в архиве/);
    expect((await svc.archiveTask(await actors.owner(), 4, false)).task.archived).toBe(false);
  });

  it("ссылки добавляют участники, адрес только http и https", async () => {
    const fat = await actors.fatyanov();
    await expectRule(svc.addLink(fat, 13, { url: "javascript:alert(1)" }), /https/);
    const r = await svc.addLink(fat, 13, { url: "https://example.com/vsk" });
    expect(r.task.links).toEqual([expect.objectContaining({ title: "example.com", url: "https://example.com/vsk" })]);
    await expectRule(svc.addLink(await actors.loginova(), 13, { url: "https://example.com/x" }), /участники задачи/);
    const removed = await svc.removeLink(fat, 13, r.task.links[0]!.id!);
    expect(removed.task.links).toEqual([]);
  });
});

describe("журнал и отмена", () => {
  it("каждая правка в журнале: кто, поле, было и стало; журнал нельзя исправить", async () => {
    const fat = await actors.fatyanov();
    await svc.updateWhere(fat, 13, "Встреча с ВСК 07.10");
    const a = await lastAudit(13);
    expect(a).toMatchObject({ action: "task.update", actorName: "Фатьянов Евгений", field: "Где сейчас", after: "Встреча с ВСК 07.10" });
    await expect(prisma.auditLog.update({ where: { id: a!.id }, data: { after: "подмена" } })).rejects.toThrow();
    const history = await svc.taskHistory(13);
    expect(history[0]).toMatchObject({ by: "fatyanov", field: "Где сейчас", after: "Встреча с ВСК 07.10" });
    expect(history.at(-1)).toMatchObject({ by: "system", field: "Задача перенесена из Insurance&Invest Bord" });
  });

  it("отмена возвращает задачу, если её никто не трогал после, и только тому, кто действовал", async () => {
    const fat = await actors.fatyanov();
    const r = await svc.transferDue(fat, 13, future, "Ждём ВСК");
    await expectRule(svc.undoChange(await actors.reva(), r.undo!), /прошло больше минуты/);
    const back = await svc.undoChange(fat, r.undo!);
    expect(back.task?.due).toBe("2026-10-06");
    expect(back.task?.transfers).toEqual([]);

    const s = await svc.changeStatus(fat, 13, "clarify");
    await svc.updateWhere(await actors.admin(), 13, "Админ поправил");
    await expectRule(svc.undoChange(fat, s.undo!), /уже изменили/);
  });

  it("отмена комментария и создания задачи, номер не переиспользуется", async () => {
    const reva = await actors.reva();
    const c = await svc.addComment(reva, 7, "Пришлю завтра");
    expect(c.task.comments).toHaveLength(1);
    expect((await svc.undoChange(reva, c.undo!)).task?.comments).toEqual([]);
    const created = await svc.createTask(reva, { title: "Ошибся", outcome: "Нет", owner: "reva", direction: "product", due: future });
    const undone = await svc.undoChange(reva, created.undo!);
    expect(undone.task).toBeNull();
    expect(await svc.getTask(created.task.number)).toBeNull();
    const next = await svc.createTask(reva, { title: "Верно", outcome: "Да", owner: "reva", direction: "product", due: future });
    expect(next.task.number).toBe(created.task.number + 1);
  });
});
