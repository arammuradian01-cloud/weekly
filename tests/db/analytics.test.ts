// Этап 27 (модуль М12): аналитика руководителя и отчёт CEO 2.0. Кто видит панель, weekly по неделям, задачи по неделям
// с просрочкой на конец прошлой недели, просьбы в рабочих часах, цели, карточки лидеров, скорость панели; встречи недели,
// решения недели и защита отчёта от затирания чужих правок.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as weekly from "@/lib/weekly/service";
import { TOP_TEAM } from "@/lib/org/scope";
import { teamAnalytics } from "@/lib/analytics/service";
import { lastWeeks } from "@/lib/analytics/rules";
import { dbDate, moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import { shiftWeek, weekKeyOf } from "@/lib/weekly/weeks";
import { quarterOf } from "@/lib/goals/parse";
import type { WeekKey } from "@/domain/types";

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

const owner = () => tasks.actorFor("muradyan", "OWNER");
const person = (start: string) => prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } });
const teamOf = (leaderStart: string) => prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: leaderStart } } } });
const subject = async (start: string, limited = false) => {
  const p = await person(start);
  return { id: p.id, role: p.role, limited };
};
/** Момент по Москве */
const msk = (day: string, time = "12:00") => new Date(`${day}T${time}:00+03:00`);

async function clean() {
  await prisma.decisionTask.deleteMany();
  await prisma.decision.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.ceoReport.deleteMany();
  await prisma.helpRequest.deleteMany();
  await prisma.taskWatch.deleteMany();
  await prisma.task.deleteMany();
  await prisma.inboxEvent.deleteMany();
  await prisma.absence.deleteMany();
  await prisma.weeklyEntry.deleteMany();
  await prisma.weeklyReport.deleteMany();
  await prisma.teamMember.deleteMany({ where: { teamId: { not: TOP_TEAM } } });
  await prisma.goal.deleteMany();
  await prisma.team.deleteMany({ where: { id: { not: TOP_TEAM } } });
  await prisma.person.updateMany({ data: { unitId: null, managerId: null, functionalManagerId: null, position: null } });
  await prisma.person.deleteMany({ where: { role: "EMPLOYEE" } });
  await prisma.vacancy.deleteMany();
  await prisma.orgUnit.deleteMany({ where: { kind: { not: "DEPARTMENT" } } });
  await prisma.orgUnit.deleteMany();
}

let today: string;
let reporting: WeekKey;
let W: WeekKey[];
let C: WeekKey[];
let number = 9000;
let directionId: string;

async function task(teamId: string, over: Record<string, unknown> = {}) {
  return prisma.task.create({
    data: {
      number: ++number,
      title: `Задача ${number}`,
      outcome: "Результат",
      directionId,
      due: dbDate(addDays(today, 10)),
      whereUpdatedAt: dbDate(today),
      teamId,
      createdAt: msk(C[0], "09:00"),
      // Закрытая задача без итога не проходит проверку базы
      ...(over.status && over.status !== "PROPOSED" && over.status !== "IN_PROGRESS" && over.status !== "CLARIFY" ? { resolution: "Итог" } : {}),
      ...over,
    },
  });
}

beforeAll(async () => {
  await clean();
  await org.applyStructure(await owner(), STRUCTURE);
  // Людей будто завели давно: иначе прошлые недели не в счёт
  await prisma.person.updateMany({ data: { createdAt: new Date("2026-01-01T00:00:00Z") } });
  today = moscowToday();
  reporting = await weekly.currentReportingKey();
  W = lastWeeks(reporting);
  C = lastWeeks(weekKeyOf(today));
  directionId = (await prisma.dictionaryItem.findFirstOrThrow({ where: { code: "department" } })).id;
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("кто видит аналитику", () => {
  it("владелец: любая команда, по умолчанию топ-команда; руководитель: своя и ниже; участник и общий вход: нет", async () => {
    const cpo = await teamOf("Рева");
    const sector = await teamOf("Антонов");
    const top = await teamAnalytics(await subject("Мурадян"), null);
    expect(top?.team.id).toBe(TOP_TEAM);
    expect(top?.options.map((o) => o.id)).toEqual(expect.arrayContaining([TOP_TEAM, cpo.id, sector.id]));

    // Руководитель управления не открывает топ-команду: показывается своя
    const reva = await teamAnalytics(await subject("Рева"), TOP_TEAM);
    expect(reva?.team.id).toBe(cpo.id);
    expect(reva?.options.map((o) => o.id)).not.toContain(TOP_TEAM);
    expect(reva?.path.find((p) => p.id === TOP_TEAM)?.link).toBe(false);

    // Руководитель сектора не открывает управление выше
    expect((await teamAnalytics(await subject("Антонов"), cpo.id))?.team.id).toBe(sector.id);
    expect(await teamAnalytics(await subject("Иванова"), null)).toBeNull();
    expect(await teamAnalytics(await subject("Мурадян", true), null)).toBeNull();
  });

  it("карточки лидеров: руководители команд уровнем ниже, в порядке структуры, без самого руководителя", async () => {
    const cpo = await teamOf("Рева");
    const a = (await teamAnalytics(await subject("Мурадян"), cpo.id))!;
    const below = await prisma.team.findMany({ where: { parentId: cpo.id }, orderBy: { sortOrder: "asc" }, include: { leader: true } });
    expect(a.leaders.map((c) => c.leader?.fullName)).toEqual(below.map((t) => t.leader!.fullName));
    expect(a.leaders.map((c) => c.leader?.fullName).sort()).toEqual(["Антонов Дмитрий", "Токов Никита"]);
    const top = (await teamAnalytics(await subject("Мурадян"), TOP_TEAM))!;
    expect(top.leaders.map((c) => c.leader?.fullName)).toContain("Рева Тарас");
    expect(top.leaders.find((c) => c.leader?.fullName === "Рева Тарас")?.teams[0].below).toBe(true);
  });
});

describe("weekly по неделям", () => {
  it("вовремя, с опозданием, не сдали и отпуск по отчётным неделям; в карточке свой weekly лидера", async () => {
    const antonov = await person("Антонов");
    const tokov = await person("Токов");
    const report = async (key: WeekKey, authorId: string, state: "SUBMITTED" | "LATE") => {
      const w = await weekly.ensureWeek(prisma, key);
      await prisma.weeklyReport.create({ data: { weekId: w.id, authorId, state, submittedAt: new Date() } });
    };
    await report(W[6], antonov.id, "SUBMITTED");
    await report(W[6], tokov.id, "LATE");
    await report(W[5], antonov.id, "SUBMITTED");
    await report(W[4], antonov.id, "SUBMITTED");
    await prisma.absence.create({ data: { personId: tokov.id, weekId: (await weekly.ensureWeek(prisma, W[4])).id } });

    const cpo = await teamOf("Рева");
    const a = (await teamAnalytics(await subject("Мурадян"), cpo.id))!;
    expect(a.weekly.map((w) => w.key)).toEqual(W);
    expect(a.weekly[7].current).toBe(true);
    // Ждём weekly от двух руководителей команд ниже: специалисты сектора и аналитики не сдают
    expect(a.weekly[6]).toMatchObject({ expected: 2, onTime: 1, late: 1, missing: 0, onTimeShare: 50, submittedShare: 100 });
    expect(a.weekly[5]).toMatchObject({ expected: 2, onTime: 1, late: 0, missing: 1, onTimeShare: 50, submittedShare: 50 });
    expect(a.weekly[4]).toMatchObject({ expected: 1, onTime: 1, absent: 1, onTimeShare: 100 });
    expect(a.weekly[0]).toMatchObject({ expected: 2, onTime: 0, missing: 2, onTimeShare: 0 });

    const card = a.leaders.find((c) => c.leader?.fullName === "Токов Никита")!;
    expect(card.weekly.cells.slice(4, 7).map((c) => c.cell)).toEqual(["absent", "missing", "late"]);
    expect(card.weekly.onTime).toBe(0);
    expect(card.weekly.optional).toBe(false);
    const ant = a.leaders.find((c) => c.leader?.fullName === "Антонов Дмитрий")!;
    expect(ant.weekly.onTime).toBe(3);
    // Человека завели позже: прошлые недели за него не в счёт
    await prisma.person.update({ where: { id: tokov.id }, data: { createdAt: new Date() } });
    const later = (await teamAnalytics(await subject("Мурадян"), cpo.id))!;
    expect(later.weekly[6]).toMatchObject({ expected: 1, onTime: 1, late: 0 });
    expect(later.leaders.find((c) => c.leader?.fullName === "Токов Никита")!.weekly.cells[6].cell).toBe("none");
    await prisma.person.update({ where: { id: tokov.id }, data: { createdAt: new Date("2026-01-01T00:00:00Z") } });
  });
});

describe("задачи, просьбы и цели", () => {
  it("закрыто и переносы по неделям, просрочка на конец прошлой недели по переносам срока, что сейчас", async () => {
    const sector = await teamOf("Антонов");
    const alisa = await person("Чемоданова");
    const prevSunday = addDays(C[6], 6);
    // Просрочена и тогда, и сейчас
    await task(sector.id, { ownerId: alisa.id, due: dbDate(addDays(prevSunday, -1)) });
    // Срок перенесли в понедельник этой недели: на конец прошлой недели была просрочена, сейчас нет
    const moved = await task(sector.id, { ownerId: alisa.id });
    await prisma.taskTransfer.create({ data: { taskId: moved.id, fromDue: dbDate(addDays(prevSunday, -2)), toDue: dbDate(addDays(today, 10)), reason: "Ждём данные", at: msk(C[7], "00:01") } });
    // Закрыта на этой неделе и на прошлой; отменённая не считается закрытой
    await task(sector.id, { ownerId: alisa.id, status: "DONE", closedAt: new Date(Date.now() - 60_000) });
    await task(sector.id, { ownerId: alisa.id, status: "PARTIAL", closedAt: msk(addDays(C[6], 2)) });
    await task(sector.id, { ownerId: alisa.id, status: "CANCELLED", closedAt: msk(addDays(C[6], 2)), due: dbDate(addDays(prevSunday, -5)) });
    // Предложенная с прошедшим сроком в просрочку не идёт
    await task(sector.id, { ownerId: alisa.id, status: "PROPOSED", due: dbDate(addDays(today, -3)) });
    // Заблокирована и давно без обновлений
    await task(sector.id, { ownerId: alisa.id, state: "BLOCKED", blockedBy: "Ждём доступ к данным", whereUpdatedAt: dbDate(addDays(today, -30)) });
    // Закрыта задолго до окна: в выборку не попадает вовсе
    await task(sector.id, { ownerId: alisa.id, status: "DONE", closedAt: msk(addDays(C[0], -30)), createdAt: msk(addDays(C[0], -40)) });

    const cpo = await teamOf("Рева");
    const a = (await teamAnalytics(await subject("Мурадян"), cpo.id))!;
    expect(a.now).toEqual({ open: 3, overdue: 1, stale: 1, blocked: 1, clarify: 0, proposed: 1 });
    expect(a.tasks.map((t) => t.key)).toEqual(C);
    expect(a.tasks[7]).toMatchObject({ current: true, closed: 1, transfers: 1, overdue: 1 });
    expect(a.tasks[6]).toMatchObject({ current: false, closed: 1, transfers: 0, overdue: 2 });
    const ant = a.leaders.find((c) => c.leader?.fullName === "Антонов Дмитрий")!;
    expect(ant).toMatchObject({ closed: 2, transfers: 1, now: { open: 3, overdue: 1, stale: 1, blocked: 1 } });
    expect(ant.overdue.slice(6)).toEqual([2, 1]);
    const tok = a.leaders.find((c) => c.leader?.fullName === "Токов Никита")!;
    expect(tok).toMatchObject({ closed: 0, transfers: 0, now: { open: 0, overdue: 0 } });
  });

  it("просьбы к людям команды: медиана в рабочих часах, ждут ответа и просроченные", async () => {
    const reva = await person("Рева");
    const ivanova = await person("Иванова");
    // Четверг 19:00, ответ в пятницу 10:00: час вечером и час утром
    await prisma.helpRequest.create({
      data: { authorId: reva.id, addresseeId: ivanova.id, text: "Выгрузить воронку", due: dbDate(addDays(today, 5)), status: "ACCEPTED", acceptedDue: dbDate(addDays(today, 5)), createdAt: msk(addDays(C[6], 3), "19:00"), answeredAt: msk(addDays(C[6], 4), "10:00") },
    });
    await prisma.helpRequest.create({ data: { authorId: reva.id, addresseeId: ivanova.id, text: "Посчитать конверсию", due: dbDate(addDays(today, -1)), createdAt: msk(C[7], "00:30") } });
    const cpo = await teamOf("Рева");
    const a = (await teamAnalytics(await subject("Мурадян"), cpo.id))!;
    expect(a.requests).toEqual({ waiting: 1, accepted: 1, overdue: 1, medianHours: 2, answered: 1 });
    expect(a.tasks[6]).toMatchObject({ answerHours: 2, answered: 1 });
    expect(a.leaders.find((c) => c.leader?.fullName === "Токов Никита")!.requests).toMatchObject({ waiting: 1, medianHours: 2 });
    expect(a.leaders.find((c) => c.leader?.fullName === "Антонов Дмитрий")!.requests).toMatchObject({ waiting: 0, medianHours: null });
  });

  it("цели квартала: в риске по отметке владельца, достигнутые отдельно", async () => {
    const sector = await teamOf("Антонов");
    const quarter = quarterOf(today);
    await prisma.goal.create({ data: { quarter, title: "Доля онлайн-продаж", teamId: sector.id, atRisk: true, riskNote: "Нет данных" } });
    await prisma.goal.create({ data: { quarter, title: "Новый калькулятор", teamId: sector.id, result: "ACHIEVED" } });
    await prisma.goal.create({ data: { quarter, title: "Без риска", teamId: sector.id } });
    await prisma.goal.create({ data: { quarter: "2020-Q1", title: "Старый квартал", teamId: sector.id } });
    const cpo = await teamOf("Рева");
    const a = (await teamAnalytics(await subject("Мурадян"), cpo.id))!;
    expect(a.goals).toMatchObject({ quarter, total: 3, onTrack: 1, atRisk: 1, achieved: 1 });
    expect(a.leaders.find((c) => c.leader?.fullName === "Антонов Дмитрий")!.goals).toMatchObject({ total: 3, atRisk: 1 });
  });

  it("панель считается быстрее 2 секунд на объёме больше департамента", async () => {
    const analytics = await teamOf("Токов");
    const rows = Array.from({ length: 3000 }, (_, i) => ({
      number: 20000 + i,
      title: `Нагрузка ${i}`,
      outcome: "Результат",
      directionId,
      due: dbDate(addDays(today, (i % 40) - 20)),
      whereUpdatedAt: dbDate(addDays(today, -(i % 30))),
      teamId: analytics.id,
      status: (i % 5 === 0 ? "DONE" : "IN_PROGRESS") as "DONE" | "IN_PROGRESS",
      closedAt: i % 5 === 0 ? msk(C[i % 8], "10:00") : null,
      resolution: i % 5 === 0 ? "Сделано" : null,
      createdAt: msk(C[0], "09:00"),
    }));
    await prisma.task.createMany({ data: rows });
    const ids = await prisma.task.findMany({ where: { number: { gte: 20000, lt: 20600 } }, select: { id: true } });
    await prisma.taskTransfer.createMany({ data: ids.map((t, i) => ({ taskId: t.id, fromDue: dbDate(addDays(today, -25)), toDue: dbDate(addDays(today, 5)), reason: "Нагрузка", at: msk(C[i % 7], "11:00") })) });
    const me = await subject("Мурадян");
    await teamAnalytics(me, TOP_TEAM);
    const started = performance.now();
    const a = (await teamAnalytics(me, TOP_TEAM))!;
    const took = performance.now() - started;
    expect(a.now.open).toBeGreaterThan(2000);
    expect(took).toBeLessThan(2000);
    await prisma.task.deleteMany({ where: { number: { gte: 20000 } } });
  });
});

describe("отчёт CEO 2.0", () => {
  it("мои встречи недели сохраняются, без них при сохранении остаются прежние, в журнале было и стало", async () => {
    const me = await owner();
    const key = shiftWeek(reporting, -1);
    const first = await weekly.saveCeoReport(me, key, { main: "Главное", risks: "", next: "" }, [{ title: "С партнёрами — ноябрь", text: "Обсуждали условия. Договорились о скидке." }, { title: "", text: "" }], null);
    expect(first.meetings).toEqual([{ title: "С партнёрами - ноябрь", text: "Обсуждали условия. Договорились о скидке." }]);
    // Старый экран без встреч: встречи не теряются
    const second = await weekly.saveCeoReport(me, key, { main: "Главное 2", risks: "", next: "" });
    expect(second.meetings).toHaveLength(1);
    expect((await weekly.getCeoReport(key)).meetings[0].title).toBe("С партнёрами - ноябрь");
    const log = await prisma.auditLog.findMany({ where: { entity: "ceo-report", entityId: key }, orderBy: { at: "asc" } });
    expect(log.map((l) => l.field)).toContain("Отчёт CEO, мои встречи недели");
  });

  it("сохранение поверх чужого: ошибка, а не тихая перезапись", async () => {
    const me = await owner();
    const key = shiftWeek(reporting, -2);
    const a = await weekly.saveCeoReport(me, key, { main: "Первый экран", risks: "", next: "" }, [], null);
    // Второй экран открыл отчёт до первого сохранения
    await expect(weekly.saveCeoReport(me, key, { main: "Второй экран", risks: "", next: "" }, [], null)).rejects.toThrow(/уже сохранён с другого устройства/);
    const b = await weekly.saveCeoReport(me, key, { main: "Первый экран, правка", risks: "", next: "" }, [], a.updatedAt);
    expect(b.sections?.main).toBe("Первый экран, правка");
    await expect(weekly.saveCeoReport(me, key, { main: "Устаревший", risks: "", next: "" }, [], a.updatedAt)).rejects.toThrow(/уже сохранён/);
    expect((await weekly.getCeoReport(key)).sections?.main).toBe("Первый экран, правка");
  });

  it("решения недели: топ-команда, встреча этой недели или без встречи до дня встречи; отменённые и чужие команды нет", async () => {
    const key = shiftWeek(reporting, -1);
    const w = await weekly.ensureWeek(prisma, key);
    const next = await weekly.ensureWeek(prisma, shiftWeek(key, 1));
    const cpo = await teamOf("Рева");
    const reva = await person("Рева");
    const meeting = await prisma.meeting.create({ data: { weekId: w.id, teamId: TOP_TEAM, date: w.meetingDate } });
    const nextMeeting = await prisma.meeting.create({ data: { weekId: next.id, teamId: TOP_TEAM, date: next.meetingDate } });
    const d = (text: string, over: Record<string, unknown>) => prisma.decision.create({ data: { text, teamId: TOP_TEAM, date: dbDate(addDays(key, 2)), ...over } });
    await d("На встрече недели", { meetingId: meeting.id, date: w.meetingDate, ownerId: reva.id });
    await d("Без встречи в среду", {});
    await d("Отменённое", { status: "CANCELLED", cancelReason: "Передумали", cancelledAt: new Date() });
    await d("Другая команда", { teamId: cpo.id });
    await d("Встреча следующей недели", { meetingId: nextMeeting.id, date: next.meetingDate });
    await d("Без встречи до начала недели", { date: dbDate(addDays(key, -1)) });
    const list = await weekly.ceoDecisions(key);
    expect(list.map((x) => x.text).sort()).toEqual(["Без встречи в среду", "На встрече недели"]);
    expect(list.find((x) => x.text === "На встрече недели")?.owner).toBe("Рева Тарас");
  });
});
