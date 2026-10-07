// Этап 15: weekly команд. Ритм команды, кто сдаёт weekly, свой срок и опоздание, «наверх» через два уровня,
// закрытие недели командой, светофор сдачи на странице «Структура», отчёт CEO с записями снизу.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as weekly from "@/lib/weekly/service";
import { loadTeamNodes, TOP_TEAM } from "@/lib/org/scope";
import { expectedOf, leadersOf, slotMoment } from "@/lib/org/rhythm";
import { structureView } from "@/lib/org/view";
import { buildCeoSections } from "@/lib/weekly/rules";

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

const owner = () => svc.actorFor("muradyan", "OWNER");
const slugOf = async (start: string) => (await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } })).slug;
const actor = async (start: string) => svc.actorFor(await slugOf(start));
const teamOf = async (leaderStart: string) => prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: leaderStart } } } });
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(svc.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const entry = (week: string, what: string) => ({ week, direction: "osago", block: "product", type: "result", what });

let week: string;

async function clean() {
  await prisma.weeklyPromotion.deleteMany();
  await prisma.teamWeekClose.deleteMany();
  await prisma.task.deleteMany();
  await prisma.absence.deleteMany();
  await prisma.weeklyEntry.deleteMany({ where: { OR: [{ author: { role: "EMPLOYEE" } }, { author: { slug: "reva" } }] } });
  await prisma.weeklyReport.deleteMany({ where: { OR: [{ author: { role: "EMPLOYEE" } }, { author: { slug: "reva" } }] } });
  await prisma.week.updateMany({ data: { closedAt: null, closedById: null } });
  await prisma.teamMember.deleteMany({ where: { teamId: { not: TOP_TEAM } } });
  await prisma.team.deleteMany({ where: { id: { not: TOP_TEAM } } });
  await prisma.person.updateMany({ data: { unitId: null, managerId: null, functionalManagerId: null, position: null } });
  await prisma.inboxEvent.deleteMany();
  await prisma.person.deleteMany({ where: { role: "EMPLOYEE" } });
  await prisma.vacancy.deleteMany();
  await prisma.orgUnit.deleteMany({ where: { kind: { not: "DEPARTMENT" } } });
  await prisma.orgUnit.deleteMany();
}

beforeAll(async () => {
  await clean();
  await org.applyStructure(await owner(), STRUCTURE);
  week = await weekly.currentReportingKey();
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("ритм команды", () => {
  it("руководитель задаёт срок, встречу и weekly специалистов своей команды; чужой руководитель нет; топ-команда в настройках недели", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    await org.setTeamRhythm(antonov, sector.id, { deadline: { week: 0, weekday: 5, time: "16:00" }, meeting: { week: 1, weekday: 1, time: "10:00" }, specialists: true });
    const saved = await prisma.team.findUniqueOrThrow({ where: { id: sector.id } });
    expect([saved.deadlineWeek, saved.deadlineWeekday, saved.deadlineTime, saved.specialistsWeekly]).toEqual([0, 5, "16:00", true]);
    const logs = await prisma.auditLog.findMany({ where: { action: "team.rhythm", entityId: sector.id } });
    expect(logs.map((l) => l.field)).toEqual([`Срок weekly: ${sector.name}`, `Встреча команды: ${sector.name}`, `Weekly специалистов: ${sector.name}`]);
    await expectRule(org.setTeamRhythm(await actor("Токов"), sector.id, { deadline: null, meeting: null, specialists: false }), /руководитель/);
    await expectRule(org.setTeamRhythm(antonov, TOP_TEAM, { deadline: null, meeting: null, specialists: false }), /настройках недели/);
    await expectRule(org.setTeamRhythm(antonov, sector.id, { deadline: { week: 1, weekday: 3, time: "12:00" }, meeting: null, specialists: true }), /не позже срока департамента/);
    await expectRule(org.setTeamRhythm(antonov, sector.id, { deadline: { week: 0, weekday: 5, time: "16:00" }, meeting: { week: 0, weekday: 4, time: "10:00" }, specialists: true }), /не раньше срока сдачи/);
    await expectRule(org.setTeamRhythm(antonov, sector.id, { deadline: { week: 0, weekday: 5, time: "16:00" }, meeting: { week: 1, weekday: 1, time: "10:00" }, specialists: true }), /Ничего не изменилось/);
  });

  it("кто сдаёт: в команде Ревы руководители Антонов и Токов, в секторе специалист Алиса, руководитель сектора сдаёт выше", async () => {
    const nodes = await loadTeamNodes(prisma);
    const leaders = leadersOf(nodes);
    const ids = async (...names: string[]) => Promise.all(names.map(async (n) => (await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: n } } })).id));
    const reva = nodes.find((n) => n.name === "Управление развития продуктов")!;
    expect(expectedOf(reva, leaders).sort()).toEqual((await ids("Антонов", "Токов")).sort());
    const sector = nodes.find((n) => n.name === "Сектор автострахования")!;
    expect(expectedOf(sector, leaders)).toEqual(await ids("Чемоданова"));
    const analytics = nodes.find((n) => n.name === "Продуктовая аналитика")!;
    expect(expectedOf(analytics, leaders)).toEqual([]);
  });
});

describe("свой срок и опоздание", () => {
  it("специалист сектора сдаёт после пятничного срока команды: с опозданием; руководитель сектора в тот же момент вовремя", async () => {
    const alisa = await actor("Чемоданова");
    const antonov = await actor("Антонов");
    const mine = await weekly.getMyWeekly(alisa.personId, week);
    const friday = slotMoment(week, { week: 0, weekday: 5, time: "16:00" });
    expect(mine.week.deadline).toBe(friday.toISOString());
    expect(mine.expectedIn.map((t) => t.name)).toEqual(["Сектор автострахования"]);
    const after = new Date(friday.getTime() + 60 * 60 * 1000);
    await weekly.saveHeadline(alisa, week, "Макет формы расчёта готов");
    await weekly.saveEntry(alisa, entry(week, "Согласовали макет формы расчёта ОСАГО"));
    expect((await weekly.submitWeekly(alisa, week, after)).state).toBe("late");
    // Антонов сдаёт в команду Ревы со сроком департамента
    expect((await weekly.getMyWeekly(antonov.personId, week)).week.deadline).not.toBe(friday.toISOString());
    expect((await weekly.getMyWeekly(antonov.personId, week)).expectedIn.map((t) => t.name)).toEqual(["Управление развития продуктов"]);
    // У специалиста аналитики weekly не ждут
    expect((await weekly.getMyWeekly((await actor("Иванова")).personId, week)).expectedIn).toEqual([]);
  });

  it("лента команды: в полосе сдачи свой срок человека", async () => {
    const sector = await teamOf("Антонов");
    const alisa = await prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: "Чемоданова" } } });
    const view = await weekly.getWeekView(week, new Date(), { personIds: [alisa.id], shared: false, teamIds: [sector.id] });
    expect(view.reports[0]!.deadline).toBe(slotMoment(week, { week: 0, weekday: 5, time: "16:00" }).toISOString());
    expect(view.week.deadline).toBe(view.reports[0]!.deadline);
  });
});

describe("наверх", () => {
  it("запись сектора доходит до топ-команды через два уровня, с автором и фразами руководителей", async () => {
    const alisa = await actor("Чемоданова");
    const antonov = await actor("Антонов");
    const reva = await svc.actorFor("reva");
    const tokov = await actor("Токов");
    const e = (await prisma.weeklyEntry.findFirstOrThrow({ where: { author: { slug: alisa.slug }, what: { startsWith: "Согласовали макет" } } })).id;

    await expectRule(weekly.promoteEntry(alisa, e), /и так в вашем weekly/);
    await expectRule(weekly.promoteEntry(tokov, e), /людей своей команды/);
    await expectRule(weekly.promoteEntry(reva, e), /людей своей команды/);
    const first = await weekly.promoteEntry(antonov, e, "Форма выйдет в релиз 20 октября");
    expect(first.promoted).toEqual([{ by: antonov.slug, note: "Форма выйдет в релиз 20 октября" }]);
    await expectRule(weekly.promoteEntry(antonov, e, "Форма выйдет в релиз 20 октября"), /уже в вашем weekly/);

    // Лента команды Ревы: авторы Антонов и Токов, запись Алисы видна через Антонова
    const revaTeam = await teamOf("Рева");
    const members = (await prisma.teamMember.findMany({ where: { teamId: revaTeam.id } })).map((m) => m.personId);
    const revaFeed = await weekly.getWeekView(week, new Date(), { personIds: members, authorIds: members, shared: false, teamIds: [revaTeam.id] });
    expect(revaFeed.entries.some((x) => x.id === e)).toBe(true);
    expect(revaFeed.authors).not.toContain(alisa.slug);

    // Теперь Рева поднимает её в топ-команду: запись уже поднял человек его команды
    const second = await weekly.promoteEntry(reva, e);
    expect(second.promoted?.map((p) => p.by)).toEqual([antonov.slug, "reva"]);
    const top = await prisma.team.findUniqueOrThrow({ where: { id: TOP_TEAM }, include: { members: true } });
    const topIds = [top.leaderId!, ...top.members.map((m) => m.personId)];
    const topFeed = await weekly.getWeekView(week, new Date(), { personIds: topIds, authorIds: topIds, shared: true, teamIds: [TOP_TEAM] });
    const inTop = topFeed.entries.find((x) => x.id === e)!;
    expect(inTop.author).toBe(alisa.slug);

    // Отчёт CEO: отмеченная запись снизу подписана автором и цепочкой
    await weekly.setCeoFlag(await owner(), e, true);
    const ceo = await weekly.getWeekView(week, new Date(), { personIds: topIds, authorIds: topIds, shared: true, ceo: true, teamIds: [TOP_TEAM] });
    const sections = buildCeoSections(ceo.entries, (s) => s ?? "все");
    expect(sections.main).toContain(`(${alisa.slug}, через ${antonov.slug}, reva)`);

    // Weekly Антонова: запись в «Из команды», сдать можно и без своих записей
    const mine = await weekly.getMyWeekly(antonov.personId, week);
    expect(mine.promoted.map((x) => x.id)).toEqual([e]);
    await weekly.saveHeadline(antonov, week, "Форма расчёта готова к релизу");
    expect((await weekly.submitWeekly(antonov, week)).state).toMatch(/submitted|late/);

    // Снять может сам руководитель, за другого только управление
    await expectRule(weekly.unpromoteEntry(tokov, e, antonov.slug), /только владелец/);
    const after = await weekly.unpromoteEntry(reva, e);
    expect(after.promoted?.map((p) => p.by)).toEqual([antonov.slug]);
    expect(await prisma.auditLog.count({ where: { action: "weekly.entry.promote", entityId: e } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "weekly.entry.unpromote", entityId: e } })).toBe(1);
  });

  it("фраза руководителя не уходит автору записи, отмена удаления возвращает отметки «наверх»", async () => {
    const alisa = await actor("Чемоданова");
    const antonov = await actor("Антонов");
    const e = (await prisma.weeklyEntry.findFirstOrThrow({ where: { author: { slug: alisa.slug }, what: { startsWith: "Согласовали макет" } } })).id;
    const mine = await weekly.getMyWeekly(alisa.personId, week);
    expect(mine.entries.find((x) => x.id === e)!.promoted).toEqual([{ by: antonov.slug }]);
    const sector = await teamOf("Антонов");
    const feed = await weekly.getWeekView(week, new Date(), { personIds: [alisa.personId], authorIds: [alisa.personId], shared: false, teamIds: [sector.id] });
    expect(feed.entries.find((x) => x.id === e)!.promoted).toEqual([{ by: antonov.slug }]);
    const snapshot = await weekly.deleteEntry(alisa, e);
    expect(await prisma.weeklyPromotion.count({ where: { entryId: e } })).toBe(0);
    await weekly.restoreEntry(alisa, snapshot);
    expect((await prisma.weeklyPromotion.findMany({ where: { entryId: e } })).map((x) => x.note)).toEqual(["Форма выйдет в релиз 20 октября"]);
  });

  it("с общего логина наверх не поднимают и не убирают", async () => {
    const antonov = await actor("Антонов");
    const e = (await prisma.weeklyEntry.findFirstOrThrow({ where: { author: { fullName: { startsWith: "Чемоданова" } } } })).id;
    await expectRule(weekly.promoteEntry({ ...antonov, via: "TEAM" }, e), /личной ссылке/);
    await expectRule(weekly.unpromoteEntry({ ...antonov, via: "TEAM" }, e), /личной ссылке/);
  });

  it("специалист, от кого weekly не ждут, в ленте команды сдаёт по желанию", async () => {
    const analytics = await teamOf("Токов");
    const ivanova = await actor("Иванова");
    const view = await weekly.getWeekView(week, new Date(), { personIds: [], authorIds: [ivanova.personId], shared: false, teamIds: [analytics.id] });
    expect(view.reports.find((r) => r.author === ivanova.slug)?.optional).toBe(true);
  });
});

describe("неделя команды", () => {
  it("руководитель закрывает неделю сектора: специалист больше не правит, сам руководитель правит свой weekly", async () => {
    const sector = await teamOf("Антонов");
    const antonov = await actor("Антонов");
    const alisa = await actor("Чемоданова");
    await expectRule(weekly.setTeamWeekClosed(await actor("Токов"), sector.id, week, true), /руководитель/);
    await expectRule(weekly.setTeamWeekClosed(antonov, TOP_TEAM, week, true), /топ-команды/);
    await weekly.setTeamWeekClosed(antonov, sector.id, week, true);
    await expectRule(weekly.saveEntry(alisa, entry(week, "Ещё одна запись после встречи")), /закрыта/);
    expect((await weekly.getMyWeekly(alisa.personId, week)).week.closed).toBe(true);
    // Антонов сдаёт в команду Ревы: её неделя открыта
    expect((await weekly.saveEntry(antonov, entry(week, "Запуск формы расчёта"))).author).toBe(antonov.slug);
    // Владелец и администраторы правят и в закрытой неделе
    expect((await weekly.saveEntry({ ...(await owner()) }, { ...entry(week, "Правка владельца"), id: (await prisma.weeklyEntry.findFirstOrThrow({ where: { author: { slug: alisa.slug } } })).id })).what).toBe("Правка владельца");
    const view = await weekly.getWeekView(week, new Date(), { personIds: [alisa.personId], shared: false, teamIds: [sector.id] });
    expect(view.week.closed).toBe(true);
    await expectRule(weekly.setTeamWeekClosed(antonov, sector.id, week, true), /уже закрыта/);
    await weekly.setTeamWeekClosed(await actor("Рева"), sector.id, week, false);
    expect((await weekly.getMyWeekly(alisa.personId, week)).week.closed).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: { in: ["weekly.team.close", "weekly.team.open"] }, entityId: `${sector.id}/${week}` } })).toBe(2);
  });
});

describe("страница «Структура»", () => {
  it("светофор сдачи и просрочки по командам за отчётную неделю", async () => {
    const view = await structureView({ id: (await owner()).personId, role: "OWNER" });
    const sector = view.teams.find((t) => t.name === "Сектор автострахования")!;
    expect(sector.weekly).toMatchObject({ expected: 1, submitted: 0, late: 1, absent: 0, closed: false });
    expect(sector.rhythm.specialists).toBe(true);
    const revaTeam = view.teams.find((t) => t.name === "Управление развития продуктов")!;
    expect(revaTeam.weekly.expected).toBe(2);
    expect(revaTeam.weekly.submitted + revaTeam.weekly.late).toBe(1);
    const analytics = view.teams.find((t) => t.name === "Продуктовая аналитика")!;
    expect(analytics.weekly.expected).toBe(0);
  });
});

describe("срок команды выше", () => {
  it("срок команды не позже своего срока команды выше", async () => {
    const revaTeam = await teamOf("Рева");
    const sector = await teamOf("Антонов");
    const reva = await svc.actorFor("reva");
    await org.setTeamRhythm(reva, revaTeam.id, { deadline: { week: 0, weekday: 4, time: "12:00" }, meeting: null, specialists: false });
    await expectRule(
      org.setTeamRhythm(await actor("Антонов"), sector.id, { deadline: { week: 0, weekday: 5, time: "16:00" }, meeting: null, specialists: true }),
      /не позже срока команды выше «Управление развития продуктов»/,
    );
    await org.setTeamRhythm(await actor("Антонов"), sector.id, { deadline: { week: 0, weekday: 3, time: "18:00" }, meeting: null, specialists: true });
    await org.setTeamRhythm(reva, revaTeam.id, { deadline: null, meeting: null, specialists: false });
  });
});
