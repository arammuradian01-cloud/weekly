// Этап 33: факт цели с историей. Кто вписывает, проверка числа и единиц по целевому значению, прогресс к целевому,
// свежесть факта, журнал
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as goals from "@/lib/goals/service";
import { TOP_TEAM } from "@/lib/org/scope";
import { quarterOf } from "@/lib/goals/parse";
import { moscowToday } from "@/lib/tasks/dates";

const Q = quarterOf(moscowToday());
const owner = () => svc.actorFor("muradyan", "OWNER");
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(svc.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const who = (a: svc.Actor) => ({ personId: a.personId, role: a.role, management: a.management });
const node = async (id: string) => (await goals.goalsView(who(await owner()), { quarter: Q })).goals.find((g) => g.id === id)!;

const ids: Record<string, string> = {};

beforeAll(async () => {
  await prisma.goal.deleteMany();
});
beforeEach(async () => {
  await prisma.goal.deleteMany();
  const o = await owner();
  ids.margin = (await goals.createGoal(o, { quarter: Q, code: "RT-1", title: "Маржа ОСАГО", base: "120", target: "150", team: TOP_TEAM, owner: "reva" })).id;
  ids.cr = (await goals.createGoal(o, { quarter: Q, code: "RT-2", title: "Конверсия расчёта", base: "20%", target: "24%", team: TOP_TEAM, owner: "reva" })).id;
  ids.text = (await goals.createGoal(o, { quarter: Q, code: "RT-3", title: "Скоринг на проде", target: "Скоринг на проде к 15.12", team: TOP_TEAM, owner: "reva" })).id;
});
afterAll(async () => {
  await prisma.goal.deleteMany();
  await prisma.$disconnect();
});

describe("факт цели", () => {
  it("владелец вписывает факт: прогресс к целевому, история и журнал", async () => {
    const reva = await svc.actorFor("reva");
    expect((await node(ids.margin)).factStale).toBe(true);
    expect((await node(ids.margin)).numeric).toBeNull();
    const first = await goals.setGoalFact(reva, ids.margin, { value: "135", note: "За сентябрь по LRF" });
    expect(first).toMatchObject({ value: "135", note: "За сентябрь по LRF", by: "Рева Тарас" });
    await goals.setGoalFact(reva, ids.margin, { value: "141" });
    const g = await node(ids.margin);
    expect(g.fact?.value).toBe("141");
    expect(g.facts.map((f) => f.value)).toEqual(["141", "135"]);
    expect(g.numeric?.share).toBeCloseTo(0.7, 9);
    expect(g.factStale).toBe(false);
    expect(g.measurable).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { action: "goal.fact", entityId: ids.margin }, orderBy: { at: "desc" } });
    expect(audit).toMatchObject({ field: "Факт", before: "135", after: "141" });
    const stored = await prisma.goalFact.findFirst({ where: { goalId: ids.margin }, orderBy: { at: "desc" } });
    expect(stored?.number).toBe(141);
  });

  it("кто может: владелец цели и руководитель команды, остальные и наблюдатель нет", async () => {
    await expectRule(goals.setGoalFact(await svc.actorFor("loginova"), ids.margin, { value: "140" }), /владелец и руководитель команды/);
    await expectRule(goals.setGoalFact(await svc.actorFor("ceo"), ids.margin, { value: "140" }), /владелец и руководитель команды/);
    await goals.setGoalFact(await owner(), ids.margin, { value: "140" });
    await expectRule(goals.setGoalFact(await owner(), "нет-такой", { value: "140" }), /Цели уже нет/);
  });

  it("числовое целевое: факт числом и в тех же единицах; повтор не пишется", async () => {
    const reva = await svc.actorFor("reva");
    await expectRule(goals.setGoalFact(reva, ids.margin, { value: "почти готово" }), /впишите факт числом/);
    await expectRule(goals.setGoalFact(reva, ids.cr, { value: "22" }), /тоже в процентах/);
    await expectRule(goals.setGoalFact(reva, ids.margin, { value: "140%" }), /без знака процента/);
    await expectRule(goals.setGoalFact(reva, ids.margin, { value: "   " }), /Впишите факт/);
    await expectRule(goals.setGoalFact(reva, ids.margin, { value: "1".repeat(121) }), /не длиннее 120/);
    await goals.setGoalFact(reva, ids.cr, { value: "22,5%" });
    await expectRule(goals.setGoalFact(reva, ids.cr, { value: "22,5%" }), /уже вписан/);
    // Тот же факт с новым комментарием пишется: человек объясняет цифру
    await goals.setGoalFact(reva, ids.cr, { value: "22,5%", note: "Пересчитали без отказного трафика" });
    expect((await node(ids.cr)).numeric?.share).toBeCloseTo(0.625, 9);
  });

  it("общий логин: факт только в режиме управления; наблюдатель-владелец не видит кнопку", async () => {
    const team = { ...(await svc.actorFor("reva")), via: "TEAM" as const };
    await expectRule(goals.setGoalFact(team, ids.margin, { value: "140" }), /при личном входе/);
    await goals.setGoalFact({ ...(await owner()), via: "TEAM" }, ids.margin, { value: "140" });
    const limited = await goals.goalsView({ ...who(await svc.actorFor("reva")), limited: true }, { quarter: Q });
    const g = limited.goals.find((x) => x.id === ids.margin)!;
    expect(g.canMark).toBe(true);
    expect(g.canFact).toBe(false);
    // Наблюдатель, даже если цель на нём, не отмечает и не вписывает
    await prisma.goal.update({ where: { id: ids.text }, data: { ownerId: (await prisma.person.findUniqueOrThrow({ where: { slug: "ceo" } })).id } });
    const obs = await goals.goalsView(who(await svc.actorFor("ceo")), { quarter: Q });
    expect(obs.goals.find((x) => x.id === ids.text)).toMatchObject({ canMark: false, canFact: false });
  });

  it("единицы и сдвиг: «141 млн» к целевому «150», «+2 п.п.» от базы, расхождение в тысячу раз", async () => {
    const reva = await svc.actorFor("reva");
    await goals.setGoalFact(reva, ids.margin, { value: "141 млн" });
    expect((await node(ids.margin)).numeric?.share).toBeCloseTo(0.7, 9);
    await expectRule(goals.setGoalFact(reva, ids.margin, { value: "141 000 000 000" }), /больше чем в 1000 раз/);
    await goals.updateGoal(await owner(), ids.cr, { base: "13%", target: "+2 п.п." });
    await goals.setGoalFact(reva, ids.cr, { value: "15%" });
    expect((await node(ids.cr)).numeric?.share).toBeCloseTo(1, 9);
  });

  it("тот же факт позже подтверждает цифру и снимает «без свежего факта»", async () => {
    const reva = await svc.actorFor("reva");
    await goals.setGoalFact(reva, ids.margin, { value: "141" });
    await prisma.goalFact.updateMany({ where: { goalId: ids.margin }, data: { at: new Date(Date.now() - 15 * 86_400_000) } });
    expect((await node(ids.margin)).factStale).toBe(true);
    await goals.setGoalFact(reva, ids.margin, { value: "141" });
    const g = await node(ids.margin);
    expect(g.factStale).toBe(false);
    expect(g.facts.map((f) => f.value)).toEqual(["141", "141"]);
  });

  it("текстовая цель: факт текстом, без процента и без требования свежести", async () => {
    const reva = await svc.actorFor("reva");
    let g = await node(ids.text);
    expect(g.measurable).toBe(false);
    expect(g.factStale).toBe(false);
    await goals.setGoalFact(reva, ids.text, { value: "На тесте у 10% трафика" });
    g = await node(ids.text);
    expect(g.fact?.value).toBe("На тесте у 10% трафика");
    expect(g.numeric).toBeNull();
  });

  it("факт старше двух недель снова требует обновления; итог квартала снимает требование", async () => {
    const reva = await svc.actorFor("reva");
    await goals.setGoalFact(reva, ids.margin, { value: "141" });
    await prisma.goalFact.updateMany({ where: { goalId: ids.margin }, data: { at: new Date(Date.now() - 20 * 86_400_000) } });
    expect((await node(ids.margin)).factStale).toBe(true);
    await goals.updateGoal(await owner(), ids.margin, { result: "ACHIEVED" });
    expect((await node(ids.margin)).factStale).toBe(false);
  });

  it("новое целевое меняет требования к факту и прогресс", async () => {
    const reva = await svc.actorFor("reva");
    await goals.setGoalFact(reva, ids.margin, { value: "141" });
    await goals.updateGoal(await owner(), ids.margin, { target: "160" });
    expect((await node(ids.margin)).numeric?.share).toBeCloseTo(0.525, 9);
    await goals.updateGoal(await owner(), ids.margin, { target: "Выход на окупаемость" });
    const g = await node(ids.margin);
    expect(g.numeric).toBeNull();
    expect(g.measurable).toBe(false);
    // Цель с фактом сервис не удаляет: история не должна пропасть. Если цель удалить напрямую, факты уходят с ней
    await expectRule(goals.deleteGoal(await owner(), ids.margin), /вписан факт: удалить нельзя/);
    await prisma.goal.delete({ where: { id: ids.margin } });
    expect(await prisma.goalFact.count({ where: { goalId: ids.margin } })).toBe(0);
  });
});
