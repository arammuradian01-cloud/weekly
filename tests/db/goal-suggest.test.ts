// Этап 55: цель подтягивается к задаче по тексту. Подбор для новой задачи, проверка цели при постановке, порядок целей
// в карточке. Структура: сектор Антонова под управлением Ревы, рядом продуктовая аналитика Токова.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as goals from "@/lib/goals/service";
import { TOP_TEAM } from "@/lib/org/scope";
import { quarterOf } from "@/lib/goals/parse";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";

const STRUCTURE = [
  ["ФИО", "Должность", "Управление", "Отдел", "Сектор", "Руководитель", "Руководит"],
  ["Рева Тарас", "CPO", "Управление развития продуктов", "", "", "Мурадян Арам", "да"],
  ["Антонов Дмитрий", "PO OSAGO", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "Рева Тарас", "да"],
  ["Чемоданова Алиса", "Product Designer", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "", ""],
  ["Токов Никита", "Team Lead", "Управление развития продуктов", "Продуктовая аналитика", "", "Рева Тарас", "да"],
  ["Иванова Мария", "Аналитик", "Управление развития продуктов", "Продуктовая аналитика", "", "", ""],
]
  .map((r) => r.join("\t"))
  .join("\n");

const Q = quarterOf(moscowToday());
const NEXT_Q = Q.endsWith("Q4") ? `${Number(Q.slice(0, 4)) + 1}-Q1` : `${Q.slice(0, 5)}Q${Number(Q.slice(6)) + 1}`;
const future = addDays(moscowToday(), 10);
const owner = () => svc.actorFor("muradyan", "OWNER");
const slugOf = async (start: string) => (await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } })).slug;
const actor = async (start: string) => svc.actorFor(await slugOf(start));
const teamOf = async (leaderStart: string) => prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: leaderStart } } } });
const who = (a: svc.Actor) => ({ personId: a.personId, role: a.role, management: a.management });
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(svc.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

async function clean() {
  await prisma.task.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.inboxEvent.deleteMany();
  await prisma.teamMember.deleteMany({ where: { teamId: { not: TOP_TEAM } } });
  await prisma.team.deleteMany({ where: { id: { not: TOP_TEAM } } });
  await prisma.person.updateMany({ data: { unitId: null, managerId: null, functionalManagerId: null, position: null } });
  await prisma.person.deleteMany({ where: { role: "EMPLOYEE" } });
  await prisma.vacancy.deleteMany();
  for (let i = 0; i < 6 && (await prisma.orgUnit.count()); i++) await prisma.orgUnit.deleteMany({ where: { children: { none: {} } } });
}

const ids: Record<string, string> = {};

beforeAll(async () => {
  await clean();
  await org.applyStructure(await owner(), STRUCTURE);
  const revaTeam = await teamOf("Рева");
  const sector = await teamOf("Антонов");
  const analytics = await teamOf("Токов");
  const o = await owner();
  ids.d1 = (await goals.createGoal(o, { quarter: Q, code: "D1", title: "Маржа департамента 150 млн", metric: "Маржа, млн", team: TOP_TEAM })).id;
  ids.p1 = (await goals.createGoal(o, { quarter: Q, code: "P1", title: "Конверсия расчёта в покупку 24%", team: revaTeam.id, parent: ids.d1 })).id;
  ids.s1 = (await goals.createGoal(o, { quarter: Q, code: "S1", title: "Новая форма расчёта ОСАГО на всём трафике", team: sector.id, parent: ids.p1 })).id;
  ids.s2 = (await goals.createGoal(o, { quarter: Q, code: "S2", title: "Партнёрская витрина КАСКО у банков", team: sector.id, parent: ids.p1 })).id;
  ids.a1 = (await goals.createGoal(o, { quarter: Q, code: "A1", title: "Витрина воронки ОСАГО для продукта", team: analytics.id, parent: ids.p1 })).id;
  ids.next = (await goals.createGoal(o, { quarter: NEXT_Q, code: "S9", title: "Форма расчёта КАСКО", team: sector.id })).id;
  // Личная цель Алисы из борда лидера в её секторе: подходит только её задачам
  const alisa = await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: "Чемоданова" } } });
  ids.personal = (await prisma.goal.create({ data: { quarter: Q, code: "АЧ-1", title: "Дизайн-система форм расчёта", teamId: sector.id, ownerId: alisa.id, source: "leader-board:Алиса" } })).id;
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("подбор цели для новой задачи", () => {
  it("лучшая цель по тексту подставляется, подходящие первыми, чужая ветка и другой квартал не предлагаются", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    const r = await goals.suggestGoals(who(antonov), { team: sector.id, due: future, title: "Выкатить новую форму расчёта ОСАГО", outcome: "Форма работает на всём трафике", owner: antonov.slug });
    expect(r.best).toBe(ids.s1);
    expect(r.options[0]).toMatchObject({ id: ids.s1, suggested: true, title: "S1. Новая форма расчёта ОСАГО на всём трафике" });
    expect(r.options[0]!.context).toMatch(/Сектор автострахования/);
    const offered = r.options.map((o) => o.id);
    expect(offered).toEqual(expect.arrayContaining([ids.d1, ids.p1, ids.s1, ids.s2]));
    // Цель соседней команды и цель следующего квартала при сроке в этом квартале не предлагаются, личная цель Алисы тоже
    expect(offered).not.toContain(ids.a1);
    expect(offered).not.toContain(ids.next);
    expect(offered).not.toContain(ids.personal);
  });

  it("номер цели в тексте подбирает её сразу, общий текст ничего не подставляет", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    const byCode = await goals.suggestGoals(who(antonov), { team: sector.id, due: future, title: "Отчёт по D1 за октябрь", outcome: "Цифры у Арама", owner: antonov.slug });
    expect(byCode.best).toBe(ids.d1);
    const vague = await goals.suggestGoals(who(antonov), { team: sector.id, due: future, title: "Согласовать отпуска на декабрь", outcome: "График у всех", owner: antonov.slug });
    expect(vague.best).toBeNull();
    expect(vague.options.some((o) => o.suggested)).toBe(false);
    // Пустая форма: все цели, ничего не подставлено
    const empty = await goals.suggestGoals(who(antonov), { team: sector.id, due: future, title: "", outcome: "" });
    expect(empty.best).toBeNull();
    expect(empty.options.length).toBe(4);
  });

  it("личная цель ответственного из этой команды предлагается, человек из другой команды не открывает свои цели", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    const alisa = await slugOf("Чемоданова");
    const own = await goals.suggestGoals(who(antonov), { team: sector.id, due: future, title: "Компоненты дизайн-системы для форм", outcome: "Библиотека в Figma", owner: alisa });
    expect(own.best).toBe(ids.personal);
    expect(own.options[0]!.context).toMatch(/личная цель Чемоданова Алиса/);
    // Иванова не в секторе: её как ответственного в форме сектора не выбрать, и её цели здесь не нужны
    const stranger = await goals.suggestGoals(who(antonov), { team: sector.id, due: future, title: "Компоненты дизайн-системы", outcome: "", owner: await slugOf("Иванова") });
    expect(stranger.options.some((o) => o.id === ids.personal)).toBe(false);
  });

  it("в чужую команду подбора нет; срок в следующем квартале добавляет его цели", async () => {
    const sector = await teamOf("Антонов");
    const tokov = await actor("Токов");
    expect(await goals.suggestGoals(who(tokov), { team: sector.id, due: future, title: "Новая форма расчёта ОСАГО", outcome: "" })).toEqual({ options: [], best: null });
    const antonov = await actor("Антонов");
    const nextDue = `${NEXT_Q.slice(0, 4)}-${String((Number(NEXT_Q.slice(6)) - 1) * 3 + 1).padStart(2, "0")}-15`;
    const later = await goals.suggestGoals(who(antonov), { team: sector.id, due: nextDue, title: "Форма расчёта КАСКО", outcome: "", owner: antonov.slug });
    expect(later.options.map((o) => o.id)).toContain(ids.next);
    // Неверный срок не ломает подбор: берётся сегодняшний квартал
    const bad = await goals.suggestGoals(who(antonov), { team: sector.id, due: "завтра", title: "", outcome: "" });
    expect(bad.options.map((o) => o.id)).not.toContain(ids.next);
  });
});

describe("ложные подстановки после проверки кода", () => {
  it("цифровой номер цели не совпадает с процентом и датой, одно общее слово не подставляет цель, наблюдателю пусто", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    const ten = (await goals.createGoal(await owner(), { quarter: Q, code: "10", title: "Лендинг калькулятора ОСАГО", team: sector.id })).id;
    const percent = await goals.suggestGoals(who(antonov), { team: sector.id, due: future, title: "Поднять конверсию на 10% к 12 ноября", outcome: "", owner: antonov.slug });
    expect(percent.best).toBeNull();
    expect((await goals.suggestGoals(who(antonov), { team: sector.id, due: future, title: "По цели 10: тексты", outcome: "", owner: antonov.slug })).best).toBe(ten);
    // «КАСКО» есть только в одной цели, но одно слово цель не подставляет: она лишь первая в списке
    const one = await goals.suggestGoals(who(antonov), { team: sector.id, due: future, title: "Интеграция с Ингосстрахом по КАСКО", outcome: "", owner: antonov.slug });
    expect(one.best).toBeNull();
    expect(one.options[0]).toMatchObject({ id: ids.s2, suggested: true });
    const observer = await prisma.person.findFirst({ where: { role: "OBSERVER" } });
    if (observer) expect(await goals.suggestGoals({ personId: observer.id, role: "OBSERVER" }, { team: sector.id, due: future, title: "Новая форма расчёта ОСАГО", outcome: "" })).toEqual({ options: [], best: null });
    await prisma.goal.delete({ where: { id: ten } });
  });
});

describe("цель при постановке задачи", () => {
  it("задача встаёт с целью, цель в журнале; чужая, снятая, другого квартала и несуществующая цель не проходят", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    const base = { outcome: "Результат", owner: antonov.slug, direction: "department", due: future, team: sector.id };
    const { task } = await svc.createTask(antonov, { ...base, title: "Новая форма расчёта на 50% трафика", goal: ids.s1 });
    expect(task.goal?.id).toBe(ids.s1);
    // Журнал не чистится между файлами тестов, а номера задач начинаются заново: берём последнюю строку создания
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entity: "task", entityId: String(task.number), action: "task.create" }, orderBy: { id: "desc" } });
    expect(audit.after).toMatch(/Цель: S1\. Новая форма расчёта ОСАГО/);
    // Без цели как раньше
    expect((await svc.createTask(antonov, { ...base, title: "Без цели" })).task.goal ?? null).toBeNull();
    await expectRule(svc.createTask(antonov, { ...base, title: "Чужая ветка", goal: ids.a1 }), /своей команды или команды выше/);
    await expectRule(svc.createTask(antonov, { ...base, title: "Чужая личная", goal: ids.personal }), /личной цели её ответственного/);
    await expectRule(svc.createTask(antonov, { ...base, title: "Следующий квартал", goal: ids.next }), /другого квартала/);
    await expectRule(svc.createTask(antonov, { ...base, title: "Нет такой", goal: "nope" }), /Такой цели нет/);
    await prisma.goal.update({ where: { id: ids.s2 }, data: { result: "DROPPED" } });
    await expectRule(svc.createTask(antonov, { ...base, title: "Снятая цель", goal: ids.s2 }), /Цель снята/);
    await prisma.goal.update({ where: { id: ids.s2 }, data: { result: "IN_PROGRESS" } });
    // Личная цель Алисы проходит, когда ответственная она
    const forAlisa = await svc.createTask(antonov, { ...base, owner: await slugOf("Чемоданова"), title: "Компоненты форм", goal: ids.personal });
    expect(forAlisa.task.goal?.id).toBe(ids.personal);
    // Ничего лишнего не создалось
    expect(await prisma.task.count({ where: { title: { in: ["Чужая ветка", "Чужая личная", "Следующий квартал", "Нет такой", "Снятая цель"] } } })).toBe(0);
  });

  it("в карточке подходящие по тексту цели первыми и отмечены", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    const { task } = await svc.createTask(antonov, { title: "Договор с банком о витрине КАСКО", outcome: "Подписан с двумя банками", owner: antonov.slug, direction: "department", due: future, team: sector.id });
    const options = await goals.goalOptions(who(antonov), task.number);
    expect(options[0]).toMatchObject({ id: ids.s2, suggested: true });
    expect(options.filter((o) => !o.suggested).every((o) => o.score < 0.2)).toBe(true);
    // Подписи для старых мест остаются: квартал, команда, номер и название
    expect(options[0]!.label).toMatch(/Сектор автострахования: S2\. Партнёрская витрина КАСКО у банков/);
  });
});
