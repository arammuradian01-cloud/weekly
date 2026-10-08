// Этап 30: шкала готовности крупных инициатив. Кто заводит и кто ставит деление шкалы, заметка обязательна,
// события «Мне», история и журнал, закрытие и возврат, пункт повестки встречи команды ответственного.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as weekly from "@/lib/weekly/service";
import * as ini from "@/lib/initiatives/service";
import * as m from "@/lib/meeting/service";
import { TOP_TEAM } from "@/lib/org/scope";
import type { LoginMethod } from "@/generated/prisma/enums";

const as = async (slug: string, management: "OWNER" | "ADMIN" | null = null, via: LoginMethod = "PASSWORD"): Promise<tasks.Actor> => ({ ...(await tasks.actorFor(slug, management)), via });
const owner = () => as("muradyan", "OWNER");
const idOf = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const t0 = new Date("2026-10-08T09:00:00Z");
const later = (days: number) => new Date(t0.getTime() + days * 86_400_000);

async function clean() {
  await prisma.agendaItem.deleteMany({ where: { initiativeId: { not: null } } });
  await prisma.meeting.deleteMany();
  await prisma.initiative.deleteMany();
  await prisma.inboxEvent.deleteMany({ where: { kind: "INITIATIVE" } });
}

beforeAll(clean);
beforeEach(clean);
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("кто что может", () => {
  it("заводит владелец или администратор в режиме управления; лидер и общий логин нет", async () => {
    await expectRule(ini.createInitiative(await as("reva"), { title: "Подписка ОСАГО", owner: "reva" }), /режиме управления/);
    await expectRule(ini.createInitiative(await as("reva", null, "TEAM"), { title: "Подписка ОСАГО", owner: "reva" }), /режиме управления/);
    const { id, overLimit } = await ini.createInitiative(await owner(), { title: "  Подписка ОСАГО — в приложении ", why: "СК переводят розницу на подписку", owner: "reva", note: "" }, t0);
    expect(overLimit).toBe(false);
    const row = await prisma.initiative.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ title: "Подписка ОСАГО - в приложении", state: "SEARCHING", teamId: TOP_TEAM, ownerId: await idOf("reva"), note: "" });
    await ini.createInitiative(await as("golovkin", "ADMIN"), { title: "Скоринг в выдаче", owner: "loginova" }, t0);
    // Ответственный обязателен, наблюдатель не может отвечать
    await expectRule(ini.createInitiative(await owner(), { title: "Без ответственного", owner: "" }), /ответственного/);
    await prisma.person.update({ where: { slug: "ceo" }, data: { active: true } });
    await expectRule(ini.createInitiative(await owner(), { title: "Наблюдателю", owner: "ceo" }), /Наблюдатель/);
    await prisma.person.update({ where: { slug: "ceo" }, data: { active: false } });
    await expectRule(ini.createInitiative(await owner(), { title: "   ", owner: "reva" }), /одной мыслью/);
  });

  it("деление ставит ответственный, с заметкой; посторонний лидер нет; режим управления может за него", async () => {
    const { id } = await ini.createInitiative(await owner(), { title: "Подписка ОСАГО", owner: "reva" }, t0);
    await expectRule(ini.setInitiativeState(await as("loginova"), id, "doing", "Делаем"), /ответственный/);
    await expectRule(ini.setInitiativeState(await as("reva"), id, "doing", "   "), /что делаем и когда первый результат/);
    await expectRule(ini.setInitiativeState(await as("reva"), id, "searching", "Ищем"), /уже в делении/);
    await expectRule(ini.setInitiativeState(await as("reva"), id, "ready", "Ищем"), /Такого деления/);
    await ini.setInitiativeState(await as("reva"), id, "doing", "Делаем пилот с Альфой, первый результат в ноябре", later(3));
    let row = await prisma.initiative.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ state: "DOING", note: "Делаем пилот с Альфой, первый результат в ноябре" });
    expect(row.stateSince.toISOString()).toBe(later(3).toISOString());
    // Владелец в режиме управления возвращает в поиск за ответственного
    await ini.setInitiativeState(await owner(), id, "searching", "Пилот остановлен, ищем другой путь", later(5));
    row = await prisma.initiative.findUniqueOrThrow({ where: { id } });
    expect(row.state).toBe("SEARCHING");
    // Заметку без смены деления
    await ini.updateInitiativeNote(await as("reva"), id, "Сравниваем два варианта", later(6));
    const changes = await prisma.initiativeChange.findMany({ where: { initiativeId: id }, orderBy: { at: "asc" } });
    expect(changes.map((c) => [c.kind, c.fromState, c.toState])).toEqual([
      ["create", null, "SEARCHING"],
      ["state", "SEARCHING", "DOING"],
      ["state", "DOING", "SEARCHING"],
      ["note", null, null],
    ]);
  });

  it("события «Мне»: ответственному при назначении, заведшему при смене деления; журнал без лишнего", async () => {
    const { id } = await ini.createInitiative(await owner(), { title: "Подписка ОСАГО", owner: "reva" }, t0);
    const revaEvents = await prisma.inboxEvent.findMany({ where: { recipientId: await idOf("reva"), kind: "INITIATIVE" } });
    expect(revaEvents.map((e) => [e.subject, e.text])).toEqual([[`initiative:${id}`, "Вы ответственный за инициативу «Подписка ОСАГО»"]]);
    await ini.setInitiativeState(await as("reva"), id, "doing", "Делаем пилот", later(1));
    const aram = await prisma.inboxEvent.findMany({ where: { recipientId: await idOf("muradyan"), kind: "INITIATIVE" } });
    expect(aram.map((e) => e.text)).toEqual(["Инициатива «Подписка ОСАГО»: уже делаем"]);
    // Смена ответственного: событие новому
    await ini.editInitiative(await owner(), id, { title: "Подписка ОСАГО", owner: "loginova" }, later(2));
    const lg = await prisma.inboxEvent.findMany({ where: { recipientId: await idOf("loginova"), kind: "INITIATIVE" } });
    expect(lg).toHaveLength(1);
    const audit = await prisma.auditLog.findMany({ where: { entity: "initiative", entityId: id }, orderBy: { at: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["initiative.create", "initiative.state", "initiative.edit"]);
  });

  it("закрыть и вернуть: только режим управления, с итогом; закрытую не меняют", async () => {
    const { id } = await ini.createInitiative(await owner(), { title: "Скоринг в выдаче", owner: "reva" }, t0);
    await expectRule(ini.closeInitiative(await as("reva"), id, "done", "Готово"), /режиме управления/);
    await expectRule(ini.closeInitiative(await owner(), id, "done", ""), /итог/);
    await ini.closeInitiative(await owner(), id, "dropped", "Не окупается при текущей конверсии", later(1));
    await expectRule(ini.setInitiativeState(await as("reva"), id, "doing", "Делаем"), /закрыта/);
    await expectRule(ini.closeInitiative(await owner(), id, "done", "Ещё раз"), /уже закрыта/);
    let page = await ini.listInitiatives(await as("reva"), later(2));
    expect(page.active).toHaveLength(0);
    expect(page.closed[0]).toMatchObject({ result: "dropped", resultNote: "Не окупается при текущей конверсии", canUpdate: false });
    await ini.reopenInitiative(await owner(), id, later(3));
    page = await ini.listInitiatives(await as("reva"), later(3));
    expect(page.active[0]).toMatchObject({ id, canUpdate: true, result: null });
    expect(page.canManage).toBe(false);
    expect(page.people).toEqual([]);
  });
});

describe("метки и повестка", () => {
  it("долго ищем и без новостей видны на странице; такие инициативы встают в повестку встречи команды ответственного", async () => {
    const { id: long } = await ini.createInitiative(await owner(), { title: "Подписка ОСАГО", owner: "reva" }, t0);
    const { id: fresh } = await ini.createInitiative(await owner(), { title: "Скоринг в выдаче", owner: "loginova" }, t0);
    const { id: stale } = await ini.createInitiative(await owner(), { title: "Пролонгация", owner: "fatyanov" }, t0);
    const now = new Date();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
    await prisma.initiative.update({ where: { id: long }, data: { stateSince: daysAgo(40), noteAt: daysAgo(3), note: "Не ясно, кто из СК готов" } });
    await prisma.initiative.update({ where: { id: fresh }, data: { stateSince: daysAgo(5), noteAt: daysAgo(5) } });
    await prisma.initiative.update({ where: { id: stale }, data: { state: "DOING", stateSince: daysAgo(60), noteAt: daysAgo(20) } });

    const page = await ini.listInitiatives(await owner(), now);
    const byId = new Map(page.active.map((i) => [i.id, i]));
    expect(byId.get(long)!.flags).toMatchObject({ longSearch: true, stale: false, searchDays: 40 });
    expect(byId.get(fresh)!.flags).toMatchObject({ longSearch: false, stale: false });
    expect(byId.get(stale)!.flags).toMatchObject({ longSearch: false, stale: true, staleDays: 20 });

    const key = await weekly.currentReportingKey();
    const view = await m.buildAgenda(await owner(), TOP_TEAM, key);
    const items = view.items.filter((i) => i.kind === "initiative");
    expect(items.map((i) => i.title).sort()).toEqual([
      "Инициатива «Подписка ОСАГО» ищет, как сделать, уже 5 недель. Что мешает начать?",
      "Инициатива «Пролонгация» без новостей 20 дн. Где она сейчас?",
    ]);
    expect(items.find((i) => i.initiative?.id === long)!.initiative).toMatchObject({ state: "searching", note: "Не ясно, кто из СК готов" });
    // Повторная сборка не дублирует; ответственный обновил заметку: пункт остаётся, заметка свежая
    await ini.updateInitiativeNote(await as("fatyanov"), stale, "Запуск в ноябре");
    const again = await m.buildAgenda(await owner(), TOP_TEAM, key);
    const after = again.items.filter((i) => i.kind === "initiative");
    expect(after.filter((i) => i.initiative?.id === long)).toHaveLength(1);
    // Пункт без новостей больше не актуален и ещё не обсуждался: уходит при пересборке
    expect(after.some((i) => i.initiative?.id === stale)).toBe(false);
  });

  it("предупреждение, когда открытых инициатив больше 15", async () => {
    let last = { id: "", overLimit: false };
    for (let i = 1; i <= 16; i++) last = await ini.createInitiative(await owner(), { title: `Инициатива ${i}`, owner: "reva" }, t0);
    expect(last.overLimit).toBe(true);
  });
});
