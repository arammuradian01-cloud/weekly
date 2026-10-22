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
import { NUMBERS_HIDDEN_TEXT, type ReportBlock } from "@/lib/weekly-blocks/types";
import { NUMBERS_ACCESS_KEY } from "@/lib/plan/access";
import { planMonthOfWeek } from "@/lib/plan/brief";
import { quarterOf } from "@/lib/goals/parse";
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
  await prisma.goal.deleteMany({ where: { code: { startsWith: "T66T" } } });
  await prisma.teamMember.deleteMany({ where: { team: { name: { startsWith: "Тест 66" } } } });
  await prisma.team.updateMany({ where: { name: { startsWith: "Тест 66" } }, data: { parentId: null } });
  await prisma.team.deleteMany({ where: { name: { startsWith: "Тест 66" } } });
  await prisma.person.update({ where: { slug: "reva" }, data: { managerId: null } });
  await prisma.person.update({ where: { slug: "golovkin" }, data: { active: true } });
  await prisma.setting.deleteMany({ where: { key: NUMBERS_ACCESS_KEY } });
  await prisma.planLine.deleteMany({ where: { product: "osago", value: { in: [66041200, 66040000] } } });
  await prisma.person.deleteMany({ where: { slug: "t66-none" } });
}

/** Человек вне топ-команды и департамента: доступа к цифрам у него нет */
const noNumbersPerson = () => prisma.person.create({ data: { slug: "t66-none", fullName: "Безцифров Тест", shortName: "Тест", role: "LEADER", zone: "Тест 66", active: true } });

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

describe("отчёт команды: правки по проверке", () => {
  // Сохранённый отчёт с цифрами: неделя и месяц поправлены руками (не пересобираются), хаб и партнёры только со всеми цифрами
  const NUMBERED: ReportBlock[] = [
    { key: "wow", title: "Неделя к неделе", hidden: false, note: null, edited: true, lines: [{ product: "deposits", text: "Вклады: заявок 1 200, рост 5%", href: "/forecast?tab=week", source: "Цифры недели" }] },
    {
      key: "month",
      title: "Месяц",
      hidden: false,
      note: null,
      edited: true,
      lines: [
        { product: "deposits", text: "Депозиты: выручка 12,5 млн при бюджете 13 млн", href: "/forecast?month=2026-10", source: "Прогноз, октябрь 2026" },
        { product: "osago", text: "ОСАГО по СК: факт 25 400", href: "/forecast?month=2026-10", source: "Хаб: ОСАГО по СК" },
      ],
    },
    { key: "products", title: "Продукты", hidden: false, note: null, lines: [{ product: "deposits", text: "Запустили новый оффер по вкладам", href: null, source: null }] },
    {
      key: "partners",
      title: "Партнёрский канал",
      hidden: false,
      note: null,
      lines: [
        { product: "partners", text: "Подключили банк", href: null, source: null },
        { product: "partners", text: "Партнёрский канал: выручка 50 млн", href: "/forecast?tab=partners&month=2026-10", source: "Прогноз: партнёры, октябрь 2026" },
      ],
    },
  ];
  const NUMBERED_TEMPLATE = NUMBERED.map((b) => ({ key: b.key, title: b.title }));
  const secret = /1 200|12,5 млн|25 400|50 млн/;

  it("получатель без доступа к цифрам видит вместо них строку, только отправленную версию и только при личном входе", async () => {
    const none = await noNumbersPerson();
    await prisma.person.update({ where: { slug: "reva" }, data: { managerId: none.id } });
    await team.saveTeamTemplate(await personal("reva"), teamId, NUMBERED_TEMPLATE);
    const reva = await personal("reva");
    // У руководителя все цифры: видит их и отправляет
    const view = await team.teamReportView(reva, teamId, key);
    const saved = await team.saveTeamReport(reva, teamId, key, NUMBERED, view.updatedAt);
    expect(JSON.stringify(saved.blocks)).toMatch(/25 400/);
    expect(saved.recipients).toEqual(["Безцифров Тест"]);
    await team.sendTeamReport(reva, teamId, key, saved.blocks, saved.updatedAt);

    const reader = await personal("t66-none");
    const seen = await team.teamReportView(reader, teamId, key);
    // Получатель не руководит командой: автосборки нет, в данных страницы только отправленная версия
    expect(seen).toMatchObject({ canEdit: false, canSend: false, blocks: [], auto: [], recipients: [] });
    expect(seen.sent!.blocks.map((b) => b.lines.map((l) => l.text))).toEqual([[NUMBERS_HIDDEN_TEXT], [NUMBERS_HIDDEN_TEXT], ["Запустили новый оффер по вкладам"], ["Подключили банк", NUMBERS_HIDDEN_TEXT]]);
    expect(JSON.stringify(seen)).not.toMatch(secret);
    // Основные цифры: неделя и итог месяца видны, хаб и партнёры нет
    await prisma.setting.create({ data: { key: NUMBERS_ACCESS_KEY, value: { full: { units: null, people: [] }, summary: { topManagement: false, units: [], people: ["t66-none"] } } } });
    const summary = await team.teamReportView(reader, teamId, key);
    expect(summary.sent!.blocks.map((b) => b.lines.map((l) => l.text))).toEqual([["Вклады: заявок 1 200, рост 5%"], ["Депозиты: выручка 12,5 млн при бюджете 13 млн"], ["Запустили новый оффер по вкладам"], ["Подключили банк"]]);
    // Под общим логином получатель отчёт не открывает: можно выбрать чужой профиль
    await expectRule(team.teamReportView({ ...reader, via: "TEAM" }, teamId, key), /не видите|видят руководитель команды/);
  });

  it("руководитель без доступа к цифрам правит отчёт: цифр не видит, но сохранение их не стирает", async () => {
    const none = await noNumbersPerson();
    const parent = await prisma.team.create({ data: { name: "Тест 66 управление без цифр", kind: "CUSTOM", leaderId: none.id } });
    await prisma.team.update({ where: { id: teamId }, data: { parentId: parent.id } });
    await team.saveTeamTemplate(await personal("reva"), teamId, NUMBERED_TEMPLATE);
    const first = await team.saveTeamReport(await personal("reva"), teamId, key, NUMBERED, null);
    const lead = await personal("t66-none");
    const view = await team.teamReportView(lead, teamId, key);
    expect(view.canEdit).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(secret);
    expect(view.blocks.find((b) => b.key === "partners")!.lines.map((l) => l.text)).toEqual(["Подключили банк", NUMBERS_HIDDEN_TEXT]);
    // Правит текст партнёрки и сохраняет то, что видит (со строкой вместо цифр)
    const edited = view.blocks.map((b) => (b.key === "partners" ? { ...b, lines: [{ product: "partners", text: "Подключили два банка", href: null, source: null }, ...b.lines.slice(1)] } : b));
    await team.saveTeamReport(lead, teamId, key, edited, first.updatedAt);
    const row = await prisma.teamWeeklyReport.findFirstOrThrow({ where: { teamId } });
    const stored = JSON.stringify(row.blocks);
    expect(stored).toMatch(/Подключили два банка/);
    expect(stored).toMatch(/50 млн/);
    expect(stored).toMatch(/25 400/);
    expect(stored).not.toMatch(new RegExp(NUMBERS_HIDDEN_TEXT));
  });

  it("кому уходит отчёт: команда выше выключена или её руководитель выключен, тогда руководитель по структуре; себе не уходит", async () => {
    const parent = await prisma.team.create({ data: { name: "Тест 66 управление", kind: "CUSTOM", leaderId: await id("golovkin") } });
    await prisma.team.update({ where: { id: teamId }, data: { parentId: parent.id } });
    await team.saveTeamTemplate(await personal("reva"), teamId, TEMPLATE);
    expect((await team.teamReportView(await personal("reva"), teamId, key)).recipients).toEqual(["Головкин Владислав"]);
    // Руководитель выше сам ведёт отчёт команды ниже: себе не отправляет, отчёт уходит руководителю по структуре
    expect((await team.teamReportView(await personal("golovkin"), teamId, key)).recipients).toEqual(["Фатьянов Евгений"]);
    // Команда выше выключена
    await prisma.team.update({ where: { id: parent.id }, data: { active: false } });
    expect((await team.teamReportView(await personal("reva"), teamId, key)).recipients).toEqual(["Фатьянов Евгений"]);
    await prisma.team.update({ where: { id: parent.id }, data: { active: true } });
    // Руководитель команды выше выключен
    await prisma.person.update({ where: { slug: "golovkin" }, data: { active: false } });
    expect((await team.teamReportView(await personal("reva"), teamId, key)).recipients).toEqual(["Фатьянов Евгений"]);
    await prisma.person.update({ where: { slug: "golovkin" }, data: { active: true } });
    // Руководителя по структуре нет: отправить некому, подсказка вместо кнопки
    await prisma.person.update({ where: { slug: "reva" }, data: { managerId: null } });
    await prisma.team.update({ where: { id: parent.id }, data: { active: false } });
    expect(await team.teamReportView(await personal("reva"), teamId, key)).toMatchObject({ recipients: [], canSend: false, sendHint: expect.stringMatching(/^Не найден руководитель/) });
  });

  it("шаблон поменяли: сохранённый отчёт по новому шаблону, новые блоки на месте, убранные скрыты со строками", async () => {
    await team.saveTeamTemplate(await personal("reva"), teamId, TEMPLATE);
    await seedWeek();
    const reva = await personal("reva");
    const view = await team.teamReportView(reva, teamId, key);
    await team.saveTeamReport(reva, teamId, key, view.blocks, null);
    await team.saveTeamTemplate(reva, teamId, [{ key: "news", title: "Новости рынка и команды" }, ...TEMPLATE.filter((b) => b.key !== "c:hire0001")]);
    const after = await team.teamReportView(reva, teamId, key);
    expect(after.blocks.map((b) => [b.key, b.hidden])).toEqual([
      ["news", false],
      ["products", false],
      ["risks", false],
      ["plan", false],
      ["c:hire0001", true],
    ]);
    expect(pairs(after.blocks, "c:hire0001")).toEqual([["deposits", "Закрыли вакансию аналитика"]]);
  });

  it("задачи и цели: команды и её людей, но не топ-команды и не внешних участников", async () => {
    await team.saveTeamTemplate(await personal("reva"), teamId, TEMPLATE);
    const loginova = await id("loginova");
    await prisma.teamMember.create({ data: { teamId, personId: loginova, external: true } });
    const deposits = await prisma.dictionaryItem.findFirstOrThrow({ where: { kind: "DIRECTION", code: "deposits" } });
    const cheychenets = await id("cheychenets");
    const due = dbDate(addDays(key, 9));
    const base = { outcome: "Результат", directionId: deposits.id, due, whereUpdatedAt: dbDate(key) };
    await prisma.task.createMany({
      data: [
        { ...base, number: 66111, title: "Задача команды", teamId, ownerId: cheychenets },
        { ...base, number: 66112, title: "Задача топ-команды у участника", teamId: "top", ownerId: cheychenets },
        { ...base, number: 66113, title: "Задача внешнего участника в топ-команде", teamId: "top", ownerId: loginova },
      ],
    });
    const quarter = quarterOf(addDays(key, 3));
    await prisma.goal.createMany({
      data: [
        { quarter, code: "T66T-1", title: "Цель команды", teamId, atRisk: true, riskNote: "Отстаём" },
        { quarter, code: "T66T-2", title: "Цель топ-команды у участника", teamId: "top", ownerId: cheychenets, atRisk: true },
      ],
    });
    const view = await team.teamReportView(await personal("reva"), teamId, key);
    const plan = pairs(view.blocks, "plan").map(([, t]) => t);
    expect(plan.some((t) => t!.startsWith("Задача команды"))).toBe(true);
    expect(plan.some((t) => /топ-команды|внешнего участника/.test(t!))).toBe(false);
    const risks = pairs(view.blocks, "risks").map(([, t]) => t);
    expect(risks).toContain("Цель T66T-1 в риске: Цель команды. Отстаём");
    expect(risks.some((t) => /T66T-2/.test(t!))).toBe(false);
  });

  it("команда вне страхования не получает чужие продукты и итог выручки: только продукты команды или ничего", async () => {
    const month = planMonthOfWeek(key);
    await prisma.planLine.createMany({
      data: [
        { month, version: "LBE", product: "osago", metric: "units", value: 66041200 },
        { month, version: "BUDGET", product: "osago", metric: "units", value: 66040000 },
      ],
    });
    // Команда, где у людей только «Департамент» (так их заводит загрузка структуры)
    const outside = await prisma.team.create({ data: { name: "Тест 66 вне страхования", kind: "CUSTOM", leaderId: await id("muradyan") } });
    const owner = await personal("muradyan", "OWNER");
    await team.saveTeamTemplate(owner, outside.id, [{ key: "wow", title: "Неделя к неделе" }, { key: "month", title: "Месяц" }]);
    const view = await team.teamReportView(owner, outside.id, key);
    for (const k of ["wow", "month"]) expect(view.blocks.find((b) => b.key === k)).toMatchObject({ lines: [], note: "Цифр по продуктам команды нет: у людей команды не задано направление продукта" });
    // Команда вкладов и партнёрки: ОСАГО и итог департамента в её отчёт не попадают
    await team.saveTeamTemplate(await personal("reva"), teamId, [{ key: "month", title: "Месяц" }]);
    const own = await team.teamReportView(await personal("reva"), teamId, key);
    expect(JSON.stringify(own.blocks)).not.toMatch(/ОСАГО|Итого по продуктам/);
  });

  it("запись не встаёт в блок цифр и в блок чужого шаблона: такой блок не сохраняется, запись раскладывается по смыслу", async () => {
    await team.saveTeamTemplate(await personal("reva"), teamId, [{ key: "wow", title: "Неделя к неделе" }, ...TEMPLATE]);
    const author = await personal("cheychenets");
    const wow = await weekly.saveEntry(author, { week: key, direction: "deposits", block: "key-changes", type: "result", what: "Запись в блок цифр", section: "wow" });
    expect(wow.section).toBeUndefined();
    const foreign = await weekly.saveEntry(author, { week: key, direction: "deposits", block: "key-changes", type: "result", what: "Запись в чужой блок", section: "c:zzzz9999" });
    expect(foreign.section).toBeUndefined();
    const own = await weekly.saveEntry(author, { week: key, direction: "deposits", block: "key-changes", type: "result", what: "Запись в свой блок", section: "c:hire0001" });
    expect(own.section).toBe("c:hire0001");
    await prisma.weeklyEntry.updateMany({ where: { id: { in: [wow.id, foreign.id, own.id] } }, data: { importBatch: "t66team" } });
    const view = await team.teamReportView(await personal("reva"), teamId, key);
    expect(pairs(view.blocks, "products")).toContainEqual(["deposits", "Запись в блок цифр"]);
    expect(pairs(view.blocks, "wow").map(([, t]) => t)).not.toContain("Запись в блок цифр");
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
