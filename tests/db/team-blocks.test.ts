// Этап 66: смысловые блоки weekly команды на настоящей базе. Шаблон блоков задаёт руководитель команды (руководитель выше,
// режим управления), участник сдаёт записи по блокам шаблона, руководитель видит отчёт команды по блокам, сохраняет его
// (конфликт двух устройств, журнал) и отправляет своему руководителю: событие в «Мне», получатель видит отправленную
// версию. У команды страхования и инвестиций шаблона нет: её отчёт это отчёт CEO. Переименование топ-команды
// повторяемой миграцией: только прежнее имя, ручное не трогается.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as weekly from "@/lib/weekly/service";
import * as team from "@/lib/weekly-blocks/team";
import { listInbox } from "@/lib/inbox/service";
import { dbDate } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import type { ReportBlock } from "@/lib/weekly-blocks/types";
import type { WeekKey } from "@/domain/types";
import { readFileSync } from "node:fs";
import { topTeamName } from "@/lib/org/top-name";
import { planGoals } from "@/lib/goals/service";

const personal = async (slug: string, management: tasks.Actor["management"] = null): Promise<tasks.Actor> => ({ ...(await tasks.actorFor(slug, management)), via: "PASSWORD" });
const shared = async (slug: string): Promise<tasks.Actor> => ({ ...(await tasks.actorFor(slug)), via: "TEAM" });
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const id = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;
const pairs = (blocks: ReportBlock[], key: string) => blocks.find((b) => b.key === key)?.lines.map((l) => [l.product, l.text]) ?? [];

let key: WeekKey;
let teamId: string;

async function clean() {
  await prisma.teamWeeklyReport.deleteMany();
  await prisma.teamWeeklyTemplate.deleteMany();
  await prisma.inboxEvent.deleteMany({ where: { subject: { startsWith: "team-report:" } } });
  await prisma.task.deleteMany({ where: { number: { gte: 66100, lt: 66200 } } });
  await prisma.weeklyEntry.deleteMany({ where: { importBatch: "t66team" } });
  await prisma.teamMember.deleteMany({ where: { team: { name: { startsWith: "Тест 66" } } } });
  await prisma.team.deleteMany({ where: { name: { startsWith: "Тест 66" } } });
  await prisma.person.update({ where: { slug: "reva" }, data: { managerId: null } });
}

beforeAll(async () => {
  key = await weekly.currentReportingKey();
});
beforeEach(async () => {
  await clean();
  // Команда Ревы без команды выше: weekly руководитель отправляет своему руководителю по структуре (Фатьянов)
  const t = await prisma.team.create({ data: { name: "Тест 66 продуктовая команда", kind: "CUSTOM", leaderId: await id("reva"), specialistsWeekly: true } });
  teamId = t.id;
  await prisma.teamMember.createMany({ data: [{ teamId, personId: await id("cheychenets") }, { teamId, personId: await id("afanasyev") }] });
  await prisma.person.update({ where: { slug: "reva" }, data: { managerId: await id("fatyanov") } });
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

const TEMPLATE = [
  { key: "products", title: "Продукты" },
  { key: "c:hire0001", title: "Найм и команда" },
  { key: "risks", title: "Риски" },
  { key: "plan", title: "План на неделю" },
];

describe("шаблон блоков команды", () => {
  it("задаёт руководитель команды при личном входе или режим управления; участник и общий логин нет; у топ-команды шаблона нет; журнал", async () => {
    await expectRule(team.saveTeamTemplate(await personal("cheychenets"), teamId, TEMPLATE), /руководитель команды/);
    await expectRule(team.saveTeamTemplate(await shared("reva"), teamId, TEMPLATE), /не видите|руководитель команды/);
    await expectRule(team.saveTeamTemplate(await personal("muradyan", "OWNER"), "top", TEMPLATE), /это отчёт CEO/);
    const view = await team.saveTeamTemplate(await personal("reva"), teamId, [...TEMPLATE, { key: "products" }, { key: "hack", title: "x" }]);
    expect(view.blocks).toEqual(TEMPLATE);
    expect(view.canEdit).toBe(true);
    expect((await team.teamTemplateView(await personal("cheychenets"), teamId)).canEdit).toBe(false);
    expect(await prisma.auditLog.findFirst({ where: { action: "team.weekly.template", entityId: teamId }, orderBy: { id: "desc" } })).toMatchObject({ after: "Продукты, Найм и команда, Риски, План на неделю" });
    // Режим управления тоже задаёт; пустой список убирает шаблон: weekly как раньше
    await team.saveTeamTemplate(await personal("golovkin", "ADMIN"), teamId, []);
    expect(await team.teamTemplate(teamId)).toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: "team.weekly.template", entityId: teamId }, orderBy: { id: "desc" } })).toMatchObject({ after: "Шаблон убран: weekly как раньше" });
  });

  it("участник сдаёт weekly по блокам шаблона: шаблон его команды, запись помнит блок; без шаблона как раньше", async () => {
    expect(await team.templateForAuthor(await id("cheychenets"))).toBeNull();
    await team.saveTeamTemplate(await personal("reva"), teamId, TEMPLATE);
    expect(await team.templateForAuthor(await id("cheychenets"))).toMatchObject({ teamId, teamName: "Тест 66 продуктовая команда", blocks: TEMPLATE });
    expect(await team.templateForAuthor(await id("loginova"))).toBeNull();
    const author = await personal("cheychenets");
    const saved = await weekly.saveEntry(author, { week: key, direction: "deposits", block: "team", type: "event", what: "Закрыли вакансию аналитика", section: "c:hire0001" });
    expect(saved.section).toBe("c:hire0001");
    // Непонятный блок не сохраняется; правка без блока его не трогает
    const bad = await weekly.saveEntry(author, { week: key, direction: "deposits", block: "key-changes", type: "result", what: "Запись со странным блоком", section: "drop table" });
    expect(bad.section).toBeUndefined();
    const edited = await weekly.saveEntry(author, { id: saved.id, week: key, direction: "deposits", block: "team", type: "event", what: "Закрыли вакансию аналитика данных" });
    expect(edited.section).toBe("c:hire0001");
    await prisma.weeklyEntry.updateMany({ where: { id: { in: [saved.id, bad.id] } }, data: { importBatch: "t66team" } });
  });
});

async function seedWeek() {
  const week = await weekly.ensureWeek(prisma, key);
  const dict = (kind: "DIRECTION" | "WEEKLY_BLOCK" | "ENTRY_TYPE", code: string) => prisma.dictionaryItem.findFirstOrThrow({ where: { kind, code } });
  const [deposits, partners, block, result, risk] = await Promise.all([dict("DIRECTION", "deposits"), dict("DIRECTION", "partners"), dict("WEEKLY_BLOCK", "key-changes"), dict("ENTRY_TYPE", "result"), dict("ENTRY_TYPE", "risk")]);
  const cheychenets = await id("cheychenets");
  const afanasyev = await id("afanasyev");
  await prisma.weeklyEntry.createMany({
    data: [
      { weekId: week.id, authorId: cheychenets, directionId: deposits.id, blockId: block.id, typeId: result.id, what: "Запустили новый оффер по вкладам", importBatch: "t66team" },
      { weekId: week.id, authorId: cheychenets, directionId: deposits.id, blockId: block.id, typeId: result.id, what: "Закрыли вакансию аналитика", section: "c:hire0001", importBatch: "t66team" },
      { weekId: week.id, authorId: afanasyev, directionId: partners.id, blockId: block.id, typeId: risk.id, what: "Агрегатор сдвигает интеграцию", importBatch: "t66team" },
    ],
  });
  await prisma.task.create({ data: { number: 66101, title: "Обновить витрину вкладов", outcome: "Витрина обновлена", directionId: deposits.id, due: dbDate(addDays(key, 9)), whereUpdatedAt: dbDate(key), teamId, ownerId: cheychenets } });
}

describe("отчёт команды по блокам", () => {
  it("руководитель видит отчёт, собранный по шаблону: записи по блоку шаблона и по смыслу, задачи команды; участник не видит", async () => {
    await team.saveTeamTemplate(await personal("reva"), teamId, TEMPLATE);
    await seedWeek();
    await expectRule(team.teamReportView(await personal("cheychenets"), teamId, key), /руководитель команды/);
    const view = await team.teamReportView(await personal("reva"), teamId, key);
    expect(view).toMatchObject({ template: TEMPLATE, saved: false, canEdit: true, canSend: true, recipients: ["Фатьянов Евгений"], sent: null });
    expect(view.blocks.map((b) => b.key)).toEqual(["products", "c:hire0001", "risks", "plan"]);
    // В общей тестовой базе у этих людей могут быть записи из других файлов: проверяем свои строки, а не весь блок
    expect(pairs(view.blocks, "products")).toContainEqual(["deposits", "Запустили новый оффер по вкладам"]);
    expect(pairs(view.blocks, "products")).not.toContainEqual(["deposits", "Закрыли вакансию аналитика"]);
    expect(pairs(view.blocks, "c:hire0001")).toEqual([["deposits", "Закрыли вакансию аналитика"]]);
    expect(pairs(view.blocks, "risks")).toContainEqual(["partners", "Агрегатор сдвигает интеграцию"]);
    expect(pairs(view.blocks, "plan").map(([, text]) => text)).toContainEqual(expect.stringMatching(/^Обновить витрину вкладов, срок \d\d\.\d\d$/));
    // Без шаблона отчёта нет: weekly команды как раньше
    await team.saveTeamTemplate(await personal("reva"), teamId, []);
    expect(await team.teamReportView(await personal("reva"), teamId, key)).toMatchObject({ template: null, blocks: [], canEdit: false, sendHint: "Сначала задайте блоки weekly команды" });
    await expectRule(team.teamReportView(await personal("muradyan", "OWNER"), "top", key), /это отчёт CEO/);
  });

  it("сохранение: конфликт двух устройств, журнал; отправка своему руководителю: событие в «Мне», получатель видит отправленную версию", async () => {
    await team.saveTeamTemplate(await personal("reva"), teamId, TEMPLATE);
    await seedWeek();
    const reva = await personal("reva");
    const view = await team.teamReportView(reva, teamId, key);
    const edited = view.blocks.map((b) => (b.key === "risks" ? { ...b, lines: [...b.lines, { product: "deposits", text: "Ставки падают — спрос на вклады ниже", href: null, source: null }] } : b));
    const saved = await team.saveTeamReport(reva, teamId, key, edited, null);
    expect(saved.saved).toBe(true);
    expect(pairs(saved.blocks, "risks")).toContainEqual(["deposits", "Ставки падают - спрос на вклады ниже"]);
    await expectRule(team.saveTeamReport(reva, teamId, key, edited, null), /уже сохранён с другого устройства/);
    expect(await prisma.auditLog.findFirst({ where: { action: "team.weekly.report", entityId: teamId }, orderBy: { id: "desc" } })).toMatchObject({ field: expect.stringMatching(/^Weekly команды «Тест 66 продуктовая команда», неделя \d+$/) });

    await expectRule(team.sendTeamReport(await shared("reva"), teamId, key, edited, saved.updatedAt), /не видите|при личном входе|руководитель команды/);
    await expectRule(team.sendTeamReport(reva, teamId, key, edited.map((b) => ({ ...b, hidden: true })), saved.updatedAt), /пустой/);
    const sent = await team.sendTeamReport(reva, teamId, key, edited, saved.updatedAt);
    expect(sent.sent).toMatchObject({ by: "Рева Тарас", to: ["Фатьянов Евгений"], editedAfter: false });
    const fatyanov = await personal("fatyanov");
    const inbox = await listInbox(fatyanov.personId);
    expect(inbox.items.find((i) => i.subject === `team-report:${teamId}:${key}`)).toMatchObject({ kind: "MEETING", text: expect.stringMatching(/Рева Тарас отправил weekly команды «Тест 66 продуктовая команда» за неделю \d+/) });
    expect(await prisma.auditLog.findFirst({ where: { action: "team.weekly.send", entityId: teamId }, orderBy: { id: "desc" } })).toMatchObject({ after: "Отправлен в приложении: Фатьянов Евгений" });

    // Получатель не руководит командой: видит отправленную версию только для чтения
    const seen = await team.teamReportView(fatyanov, teamId, key);
    expect(seen).toMatchObject({ canEdit: false, canSend: false });
    expect(pairs(seen.sent!.blocks, "risks")).toContainEqual(["deposits", "Ставки падают - спрос на вклады ниже"]);
    await expectRule(team.saveTeamReport(fatyanov, teamId, key, edited, sent.updatedAt), /не видите|руководитель команды/);
    // Правка после отправки: честная отметка
    await team.saveTeamReport(reva, teamId, key, edited.map((b) => (b.key === "plan" ? { ...b, lines: [] } : b)), sent.updatedAt);
    expect((await team.teamReportView(fatyanov, teamId, key)).sent?.editedAfter).toBe(true);
    // Посторонний не видит
    await expectRule(team.teamReportView(await personal("loginova"), teamId, key), /не видите/);
  });

  it("команда под командой выше: отчёт уходит руководителю команды выше", async () => {
    const parent = await prisma.team.create({ data: { name: "Тест 66 управление", kind: "CUSTOM", leaderId: await id("golovkin") } });
    await prisma.team.update({ where: { id: teamId }, data: { parentId: parent.id } });
    await team.saveTeamTemplate(await personal("reva"), teamId, TEMPLATE);
    await seedWeek();
    const view = await team.teamReportView(await personal("reva"), teamId, key);
    expect(view.recipients).toEqual(["Головкин Владислав"]);
    // Руководитель выше ведёт отчёт команды ниже
    expect((await team.teamReportView(await personal("golovkin"), teamId, key)).canEdit).toBe(true);
  });
});

describe("переименование топ-команды (этап 66)", () => {
  const sql = readFileSync("prisma/migrations/20261022160620_top_team_name/migration.sql", "utf8");
  const nameOf = async () => (await prisma.team.findUniqueOrThrow({ where: { id: "top" } })).name;

  it("после миграций топ-команда называется «Команда страхования и инвестиций»; тексты берут имя из базы", async () => {
    expect(await nameOf()).toBe("Команда страхования и инвестиций");
    expect(await topTeamName()).toBe("Команда страхования и инвестиций");
    await expectRule(weekly.setTeamWeekClosed(await personal("reva"), "top", key, true), /Неделю команды «Команда страхования и инвестиций» закрывают/);
  });

  it("повторяемая миграция переименовывает только прежнее имя, ручное имя не трогает", async () => {
    expect(sql.trimStart().startsWith("-- повторяемая")).toBe(true);
    try {
      await prisma.team.update({ where: { id: "top" }, data: { name: "Топ-команда" } });
      await prisma.$executeRawUnsafe(sql);
      expect(await nameOf()).toBe("Команда страхования и инвестиций");
      // Второй прогон ничего не меняет
      await prisma.$executeRawUnsafe(sql);
      expect(await nameOf()).toBe("Команда страхования и инвестиций");
      // Владелец назвал команду сам: миграция её не трогает, тексты берут его имя
      await prisma.team.update({ where: { id: "top" }, data: { name: "Команда Арама" } });
      await prisma.$executeRawUnsafe(sql);
      expect(await nameOf()).toBe("Команда Арама");
      expect(await topTeamName()).toBe("Команда Арама");
      // Старые файлы целей с прежним именем по-прежнему узнают команду
      const plan = await planGoals(await personal("muradyan", "OWNER"), "ID\tКоманда\tВладелец\tЦель\nT66\tТоп-команда\tМурадян Арам\tПроверка прежнего имени", { team: "top" });
      expect(plan.problems).toEqual([]);
      expect(plan.add.map((a) => a.code)).toEqual(["T66"]);
    } finally {
      await prisma.team.update({ where: { id: "top" }, data: { name: "Команда страхования и инвестиций" } });
    }
  });
});
