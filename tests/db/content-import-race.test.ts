// Этап 67: импорт наполнения и правки ресурса во время загрузки. Загрузка запирает строки задач, целей и решений пакета
// до расчёта плана: правка такой задачи в ресурсе ждёт конца загрузки и потом проходит (не теряется), встречное
// закрытие задачи не роняет загрузку. Шаги службы задач подменены: перед записью загрузки тест начинает правку
// сотрудника своим соединением и проверяет, что она ждёт. Пакет синтетический: tests/fixtures/content-import
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ beforeWhere: null as null | (() => Promise<void>), beforeStatus: null as null | (() => Promise<void>) }));
vi.mock("@/lib/tasks/service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tasks/service")>();
  return {
    ...mod,
    // Хук только у шага внутри транзакции загрузки (у него есть клиент транзакции)
    updateWhere: async (...args: Parameters<typeof mod.updateWhere>) => {
      const hook = args[3] ? hooks.beforeWhere : null;
      if (hook) hooks.beforeWhere = null;
      if (hook) await hook();
      return mod.updateWhere(...args);
    },
    changeStatus: async (...args: Parameters<typeof mod.changeStatus>) => {
      const hook = args[4] ? hooks.beforeStatus : null;
      if (hook) hooks.beforeStatus = null;
      if (hook) await hook();
      return mod.changeStatus(...args);
    },
  };
});

import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import { parsePackage, type ContentPackage } from "@/lib/content-import/package";
import { applyContentImport } from "@/lib/content-import/service";
import { TOP_TEAM } from "@/lib/org/scope";

const FIXTURE = readFileSync("tests/fixtures/content-import/package.json", "utf8");
type Raw = Record<string, unknown> & { tasks: Record<string, unknown>[]; goals: Record<string, unknown>[]; decisions: Record<string, unknown>[]; links: Record<string, unknown>[] };
const raw = () => JSON.parse(FIXTURE) as Raw;
const pkgOf = (value: unknown): ContentPackage => {
  const { pkg, problems } = parsePackage(JSON.stringify(value));
  expect(problems).toEqual([]);
  return pkg;
};
const owner = async (): Promise<tasks.Actor> => ({ ...(await tasks.actorFor("muradyan", "OWNER")), via: "PASSWORD" });
const taskByKey = async (key: string) => {
  const k = await prisma.contentImportKey.findUniqueOrThrow({ where: { kind_key: { kind: "task", key } } });
  return prisma.task.findUniqueOrThrow({ where: { id: k.entityId } });
};
/** Правка сотрудника своим соединением: обещание и признак, что она уже закончилась */
const meanwhile = <T>(run: () => Promise<T>) => {
  const state = { settled: false };
  const promise = run().finally(() => {
    state.settled = true;
  });
  promise.catch(() => undefined);
  return { promise, state };
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function reset() {
  hooks.beforeWhere = null;
  hooks.beforeStatus = null;
  await prisma.contentImportKey.deleteMany();
  await prisma.decisionTask.deleteMany();
  await prisma.decision.deleteMany();
  await prisma.inboxEvent.deleteMany();
  await prisma.task.updateMany({ data: { goalId: null } });
  await prisma.taskTransfer.deleteMany();
  await prisma.taskLink.deleteMany();
  await prisma.taskCoExecutor.deleteMany();
  await prisma.task.deleteMany();
  await prisma.goal.updateMany({ data: { parentId: null } });
  await prisma.goal.deleteMany();
  await prisma.team.deleteMany({ where: { id: { not: TOP_TEAM } } });
}

beforeEach(reset);
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

describe("правки ресурса во время загрузки", () => {
  it("«Где сейчас», которое сотрудник пишет во время загрузки, ждёт её конца и остаётся в задаче", async () => {
    const me = await owner();
    const p1 = raw();
    p1.goals = [];
    p1.links = [];
    p1.decisions = [];
    p1.tasks = [p1.tasks[0]!];
    await applyContentImport(me, pkgOf(p1));
    const t = await taskByKey("task.test.open-1");
    const p2 = JSON.parse(JSON.stringify(p1)) as Raw;
    p2.tasks[0]!.whereNow = "Пакет: новое";
    const box: { edit?: ReturnType<typeof meanwhile> } = {};
    hooks.beforeWhere = async () => {
      box.edit = meanwhile(async () => tasks.updateWhere(await tasks.actorFor("golovkin"), t.number, "Сотрудник: свежая правка"));
      await pause(400);
      // Строка задачи заперта загрузкой: правка сотрудника ещё ждёт
      expect(box.edit.state.settled).toBe(false);
    };
    await applyContentImport(me, pkgOf(p2));
    await box.edit!.promise;
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).whereNow).toBe("Сотрудник: свежая правка");
  });

  it("сотрудник закрывает задачу во время загрузки: загрузка проходит, его закрытие ждёт и видит закрытую задачу", async () => {
    const me = await owner();
    const p1 = raw();
    p1.goals = [];
    p1.links = [];
    p1.decisions = [];
    await applyContentImport(me, pkgOf(p1));
    const t = await taskByKey("task.test.open-1");
    const p2 = JSON.parse(JSON.stringify(p1)) as Raw;
    p2.tasks[0]!.status = "done";
    p2.tasks[0]!.resolution = "Готово по пакету";
    p2.tasks.push({ key: "task.test.race-new", title: "Новая выдуманная задача рядом", outcome: "Сделано", owner: "Рева Тарас", direction: "product", due: "2026-12-01" });
    const box: { close?: ReturnType<typeof meanwhile> } = {};
    hooks.beforeStatus = async () => {
      box.close = meanwhile(async () => tasks.changeStatus(await tasks.actorFor("golovkin"), t.number, "done", "Закрыл сам"));
      await pause(400);
      expect(box.close.state.settled).toBe(false);
    };
    const res = await applyContentImport(me, pkgOf(p2));
    expect(res.applied.tasks).toHaveLength(1);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ status: "DONE", resolution: "Готово по пакету" });
    // Закрытие сотрудника прошло после загрузки и увидело, что задача уже закрыта
    await expect(box.close!.promise).rejects.toThrow(/Статус уже такой/);
  });
});
