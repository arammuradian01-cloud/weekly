// Этап 73+81: раздел «Отчёт руководителю» на настоящей базе. Вкладка «Отправленные» показывает ровно отправленную
// версию, вкладка «Полученные» - то, что отправили мне (экран этапа 73а), и weekly моих сотрудников. Комментарий к
// полученному отчёту пишет получатель, отвечают обе стороны; участники команды переписку не видят. Права проверяются
// на сервере, а не только в интерфейсе.
//
// Получатель и участник здесь свои люди, а не из стартового списка: их команды и подчинение не зависят от того, что
// оставили после себя соседние файлы тестов на той же базе.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as weekly from "@/lib/weekly/service";
import * as team from "@/lib/weekly-blocks/team";
import { listInbox } from "@/lib/inbox/service";
import { addReportComment, reportComments } from "@/lib/leader-report/comments";
import { canSeeLeaderReport, leaderReportScope, leaderReportView } from "@/lib/leader-report/service";
import { receivedReportsOf, reportWeeksOf, sentReportsOf } from "@/lib/leader-report/reports";
import { commentSubject } from "@/lib/leader-report/rules";
import { NUMBERS_HIDDEN_TEXT } from "@/lib/weekly-blocks/types";
import { dbDate } from "@/lib/tasks/dates";
import type { WeekKey } from "@/domain/types";

const personal = async (slug: string, management: tasks.Actor["management"] = null): Promise<tasks.Actor> => ({ ...(await tasks.actorFor(slug, management)), via: "PASSWORD" });
const shared = async (slug: string): Promise<tasks.Actor> => ({ ...(await tasks.actorFor(slug)), via: "TEAM" });
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const id = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;

const TEMPLATE = [
  { key: "products", title: "Продукты" },
  { key: "risks", title: "Риски" },
];
const BOSS = "Руководитель Тест";
const MEMBER = "Участник Тест";
/** Свои люди теста: их команды, подчинение и доступ к цифрам не зависят от соседних файлов на той же базе */
const TEST_PEOPLE = ["t7381-boss", "t7381-member", "t7381-lead", "t7381-low"];
/** Строка с цифрами в блоке «Неделя к неделе»: такие строки видит только зритель с доступом к цифрам (этап 57) */
const FIGURES_LINE = "ОСАГО: заявок 12 345, рост 7%";

let key: WeekKey;
let teamId: string;

async function clean() {
  await prisma.leaderReportComment.deleteMany();
  await prisma.teamWeeklyReport.deleteMany();
  await prisma.teamWeeklyTemplate.deleteMany();
  await prisma.inboxEvent.deleteMany({ where: { subject: { startsWith: "report-comment:" } } });
  await prisma.inboxEvent.deleteMany({ where: { subject: { startsWith: "team-report:" } } });
  // Журнал изменений чистить нельзя (триггер базы): свежую запись находим по action и порядку, а не чистым столом
  await prisma.weeklyEntry.deleteMany({ where: { importBatch: "t7381" } });
  // Weekly участников за отчётную неделю: их мог оставить соседний файл тестов, а здесь weekly сдаётся заново
  await prisma.weeklyReport.deleteMany({ where: { author: { slug: { in: ["cheychenets", "afanasyev"] } }, week: { start: dbDate(key) } } });
  await prisma.teamMember.deleteMany({ where: { team: { name: { startsWith: "Тест 73" } } } });
  await prisma.team.updateMany({ where: { name: { startsWith: "Тест 73" } }, data: { parentId: null } });
  await prisma.team.deleteMany({ where: { name: { startsWith: "Тест 73" } } });
  await prisma.person.update({ where: { slug: "reva" }, data: { managerId: null } });
  await prisma.teamMember.deleteMany({ where: { person: { slug: { in: TEST_PEOPLE } } } });
  await prisma.weeklyReport.deleteMany({ where: { author: { slug: { in: TEST_PEOPLE } } } });
  await prisma.person.deleteMany({ where: { slug: { in: TEST_PEOPLE } } });
}

beforeAll(async () => {
  key = await weekly.currentReportingKey();
});
beforeEach(async () => {
  await clean();
  // Получатель отчёта: руководитель Ревы по структуре. Своей команды у него нет, раздел ему открывают сами отчёты
  const boss = await prisma.person.create({ data: { slug: "t7381-boss", fullName: BOSS, shortName: "Тест", role: "LEADER", zone: "Тест 73", active: true } });
  const t = await prisma.team.create({ data: { name: "Тест 73 продуктовая команда", kind: "CUSTOM", leaderId: await id("reva"), specialistsWeekly: true } });
  teamId = t.id;
  await prisma.teamMember.createMany({ data: [{ teamId, personId: await id("cheychenets") }, { teamId, personId: await id("afanasyev") }] });
  await prisma.person.update({ where: { slug: "reva" }, data: { managerId: boss.id } });
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

/** Участник команды и больше нигде: у него точно нет своей команды и ему ничего не отправляли */
async function memberPerson() {
  const person = await prisma.person.create({ data: { slug: "t7381-member", fullName: MEMBER, shortName: "Тест", role: "LEADER", zone: "Тест 73", active: true } });
  await prisma.teamMember.create({ data: { teamId, personId: person.id } });
  return person;
}

/**
 * Человек вне топ-команды и подразделений: цифр он не видит совсем (numbersLevel = none). Люди стартового списка в
 * топ-команде, и у них все цифры, поэтому для проверки границы этапа 57 нужен свой
 */
const noFiguresPerson = (slug: string, fullName: string) =>
  prisma.person.create({ data: { slug, fullName, shortName: "Тест", role: "LEADER", zone: "Тест 73", active: true } });

/**
 * Отчёт со строкой цифр, уже отправленный: снимок пишем прямо в базу. Проверяется чтение переписки по уровню зрителя,
 * а не отправка этапа 66 - её проверяет tests/db/team-blocks.test.ts
 */
async function sendFiguresReport(leaderId: string, recipient: { id: string; name: string }) {
  const t = await prisma.team.create({ data: { name: "Тест 73 цифры", kind: "CUSTOM", leaderId, specialistsWeekly: true } });
  const week = await weekly.ensureWeek(prisma, key);
  // Блок «Неделя к неделе» целиком про цифры: каждая его строка видна только с доступом к цифрам
  const blocks = [{ key: "wow", title: "Неделя к неделе", hidden: false, note: null, lines: [{ product: "deposits", text: FIGURES_LINE, href: null, source: null }] }];
  await prisma.teamWeeklyReport.create({
    data: { teamId: t.id, weekId: week.id, blocks, updatedById: leaderId, sentAt: new Date(), sentById: leaderId, sentTo: [recipient], sentSnapshot: blocks },
  });
  return t.id;
}

/** Отчёт команды собран и отправлен руководителю: так выглядит вход в раздел у обеих сторон */
async function sendReport() {
  const reva = await personal("reva");
  await team.saveTeamTemplate(reva, teamId, TEMPLATE);
  const week = await weekly.ensureWeek(prisma, key);
  const dict = (kind: "DIRECTION" | "WEEKLY_BLOCK" | "ENTRY_TYPE", code: string) => prisma.dictionaryItem.findFirstOrThrow({ where: { kind, code } });
  const [deposits, block, result] = await Promise.all([dict("DIRECTION", "deposits"), dict("WEEKLY_BLOCK", "key-changes"), dict("ENTRY_TYPE", "result")]);
  await prisma.weeklyEntry.create({
    data: { weekId: week.id, authorId: await id("cheychenets"), directionId: deposits.id, blockId: block.id, typeId: result.id, what: "Запустили витрину вкладов", importBatch: "t7381" },
  });
  const view = await team.teamReportView(reva, teamId, key);
  const edited = view.blocks.map((b) => (b.key === "risks" ? { ...b, lines: [{ product: "deposits", text: "Ставки падают, спрос ниже", href: null, source: null }] } : b));
  const saved = await team.saveTeamReport(reva, teamId, key, edited, view.updatedAt);
  await team.sendTeamReport(reva, teamId, key, saved.blocks, saved.updatedAt);
}

describe("кому открыт раздел", () => {
  it("руководителю команды, получателю и владельцу; участнику и общему логину нет", async () => {
    await sendReport();
    expect((await leaderReportScope(await personal("reva"))).canLead).toBe(true);
    expect(await canSeeLeaderReport(await personal("reva"))).toBe(true);
    // Получатель раздел видит, хотя сам командой не руководит
    expect(await leaderReportScope(await personal("t7381-boss"))).toMatchObject({ allowed: true, canLead: false });
    // Участник команды: ни своей команды, ни отправленных ему отчётов
    await memberPerson();
    const member = await personal("t7381-member");
    expect(await canSeeLeaderReport(member)).toBe(false);
    await expectRule(leaderReportView(member), /при личном входе/);
    // Общий логин даже в режиме управления раздел не открывает: по нему выбирают чужой профиль
    expect(await canSeeLeaderReport(await shared("muradyan"))).toBe(false);
    expect(await canSeeLeaderReport({ ...(await shared("muradyan")), management: "OWNER" })).toBe(false);
    await expectRule(leaderReportView(await shared("muradyan")), /при личном входе/);
  });
});

describe("вкладки «Отправленные» и «Полученные»", () => {
  it("автор видит отправленную версию, получатель её же, посторонний ничего", async () => {
    await sendReport();
    const mine = await sentReportsOf(await personal("reva"), [key]);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ teamId, kind: "team", by: "Рева Тарас", editedAfter: false });
    expect(mine[0]!.to.map((t) => t.name)).toEqual([BOSS]);
    expect(mine[0]!.blocks.find((b) => b.key === "risks")!.lines.map((l) => l.text)).toEqual(["Ставки падают, спрос ниже"]);
    expect((await receivedReportsOf(await personal("t7381-boss"), [key])).map((r) => r.teamId)).toEqual([teamId]);
    // Участник команды не автор и не получатель
    await memberPerson();
    expect(await sentReportsOf(await personal("t7381-member"), [key])).toEqual([]);
    expect(await receivedReportsOf(await personal("t7381-member"), [key])).toEqual([]);
    // Общий логин не видит ни отправленного, ни полученного
    expect(await sentReportsOf(await shared("reva"), [key])).toEqual([]);
    expect(await receivedReportsOf(await shared("t7381-boss"), [key])).toEqual([]);
  });

  it("вкладка по умолчанию: руководителю «Отправленные», только получателю «Полученные»", async () => {
    await sendReport();
    expect((await leaderReportView(await personal("reva"))).tab).toBe("sent");
    expect((await leaderReportView(await personal("t7381-boss"))).tab).toBe("received");
    // Вкладка из адреса сильнее
    expect((await leaderReportView(await personal("t7381-boss"), { tab: "sent" })).tab).toBe("sent");
    const weeks = await reportWeeksOf(await personal("t7381-boss"));
    expect(weeks.weeks.map((w) => w.key)).toContain(key);
    expect(weeks).toMatchObject({ hasReceived: true, hasSent: false });
  });

  it("«Полученные» показывают сданные weekly сотрудников и не отдают содержимое черновиков", async () => {
    await sendReport();
    const author = await personal("cheychenets");
    await weekly.saveHeadline(author, key, "Витрина вкладов запущена");
    await weekly.submitWeekly(author, key);
    await weekly.saveHeadline(await personal("afanasyev"), key, "Секретный черновик 7381");
    const view = await leaderReportView(await personal("reva"), { tab: "received", team: teamId });
    expect(view.people.find((p) => p.author === "cheychenets")).toMatchObject({ name: "Чейченец Евгений", headline: "Витрина вкладов запущена" });
    expect(view.people.find((p) => p.author === "afanasyev")).toMatchObject({ state: "draft", headline: "" });
    expect(JSON.stringify(view)).not.toMatch("Секретный черновик 7381");
    expect(view.expected.submitted).toBeGreaterThanOrEqual(1);
    // Чужая команда в адресе: отказ
    const other = await prisma.team.create({ data: { name: "Тест 73 чужая", kind: "CUSTOM", leaderId: await id("golovkin") } });
    await expectRule(leaderReportView(await personal("reva"), { tab: "received", team: other.id }), /недоступны/);
  });
});

describe("комментарий руководителя к отчёту", () => {
  it("пишет получатель, отвечают обе стороны, событие уходит второй стороне, запись в журнале", async () => {
    await sendReport();
    const boss = await personal("t7381-boss");
    const reva = await personal("reva");
    const after = await addReportComment(boss, { teamId, week: key }, "Поправьте вывод по вкладам");
    expect(after.comments).toHaveLength(1);
    expect(after.comments[0]).toMatchObject({ author: BOSS, mine: true, text: "Поправьте вывод по вкладам", blockKey: null });
    // Автор отчёта получил событие во вкладку «Отправленные»
    expect((await listInbox(reva.personId)).items.find((i) => i.subject === commentSubject("sent", teamId, key))).toMatchObject({
      kind: "REPORT_COMMENT",
      text: expect.stringMatching(/Руководитель Тест написал к отчёту команды «Тест 73 продуктовая команда» за неделю \d+/),
    });
    expect(await prisma.auditLog.findFirst({ where: { action: "weekly.report.comment" }, orderBy: { id: "desc" } })).toMatchObject({
      entity: "leader-report",
      entityId: `${teamId}/${key}`,
      after: "Поправьте вывод по вкладам",
    });

    // Автор отвечает в ветке: событие уходит получателю во вкладку «Полученные»
    const parentId = after.comments[0]!.id;
    const replied = await addReportComment(reva, { teamId, week: key, parentId }, "Поправил, отправлю ещё раз");
    expect(replied.comments[0]!.replies.map((r) => r.text)).toEqual(["Поправил, отправлю ещё раз"]);
    expect((await listInbox(boss.personId)).items.find((i) => i.subject === commentSubject("received", teamId, key))).toMatchObject({ kind: "REPORT_COMMENT" });

    // Автор не начинает обсуждение сам, участник команды не пишет и не читает
    await expectRule(addReportComment(reva, { teamId, week: key }, "Своё замечание"), /Обсуждение этого отчёта вам недоступно/);
    await memberPerson();
    const member = await personal("t7381-member");
    await expectRule(addReportComment(member, { teamId, week: key }, "Чужое замечание"), /Обсуждение этого отчёта вам недоступно/);
    await expectRule(addReportComment(member, { teamId, week: key, parentId }, "Чужой ответ"), /Обсуждение этого отчёта вам недоступно/);
    // Владелец в режиме управления переписку читает, но не пишет; участник не читает совсем
    const owner = await personal("muradyan", "OWNER");
    const report = (await sentReportsOf(owner, [key])).find((r) => r.teamId === teamId)!;
    expect(await reportComments(member, report)).toMatchObject({ access: { sees: false, canStart: false, canReply: false }, comments: [] });
    expect((await reportComments(owner, report)).access).toEqual({ sees: true, canStart: false, canReply: false });
    await expectRule(addReportComment(owner, { teamId, week: key }, "Замечание владельца"), /Обсуждение этого отчёта вам недоступно/);
    // Общий логин комментарии не пишет
    await expectRule(addReportComment(await shared("t7381-boss"), { teamId, week: key }, "С общего логина"), /при личном входе/);
  });

  it("отказ одинаковый, есть отчёт за неделю или нет: по ответу не узнать, кто и когда отправлял", async () => {
    await sendReport();
    await memberPerson();
    const member = await personal("t7381-member");
    const sentWeek = addReportComment(member, { teamId, week: key }, "Замечание");
    const emptyWeek = addReportComment(member, { teamId, week: "2026-01-05" }, "Замечание");
    await expectRule(sentWeek, /Обсуждение этого отчёта вам недоступно/);
    await expectRule(emptyWeek, /Обсуждение этого отчёта вам недоступно/);
    // И получателю отчёта за неделю без отправки отвечают тем же текстом
    await expectRule(addReportComment(await personal("t7381-boss"), { teamId, week: "2026-01-05" }, "Замечание"), /Обсуждение этого отчёта вам недоступно/);
  });

  it("наблюдателю комментарии закрыты, даже если отчёт отправили ему", async () => {
    await sendReport();
    await prisma.person.update({ where: { slug: "t7381-boss" }, data: { role: "OBSERVER" } });
    await expectRule(addReportComment(await personal("t7381-boss"), { teamId, week: key }, "Замечание наблюдателя"), /Наблюдатель/);
  });

  it("комментарий к строке берёт текст строки из отправленной версии; пустой и длинный текст не проходят", async () => {
    await sendReport();
    const boss = await personal("t7381-boss");
    const after = await addReportComment(boss, { teamId, week: key, blockKey: "risks", lineIndex: 0 }, "Эту строку уточните");
    expect(after.comments[0]).toMatchObject({ blockKey: "risks", lineText: "Ставки падают, спрос ниже", linePresent: true });
    // Строки с таким номером нет: отказ, текст строки с экрана не принимаем
    await expectRule(addReportComment(boss, { teamId, week: key, blockKey: "risks", lineIndex: 9 }, "Нет такой строки"), /строки в отправленном отчёте нет/);
    await expectRule(addReportComment(boss, { teamId, week: key }, "   "), /Напишите комментарий/);
    await expectRule(addReportComment(boss, { teamId, week: key }, "я".repeat(1001)), /длиннее 1000 знаков/);
  });

  it("строку убрали при повторной отправке: цитата пропадает, остаётся подпись блока", async () => {
    await sendReport();
    const boss = await personal("t7381-boss");
    await addReportComment(boss, { teamId, week: key, blockKey: "risks", lineIndex: 0 }, "Эту строку уточните");
    const reva = await personal("reva");
    const current = await team.teamReportView(reva, teamId, key, { current: true });
    const without = current.blocks.map((b) => (b.key === "risks" ? { ...b, lines: [] } : b));
    await team.sendTeamReport(reva, teamId, key, without, current.updatedAt);
    const again = await receivedReportsOf(boss, [key]);
    expect((await reportComments(boss, again[0]!)).comments[0]).toMatchObject({ blockKey: "risks", blockTitle: "Риски", lineText: null, linePresent: false });
    // В базе цитата осталась: она нужна для истории
    expect((await prisma.leaderReportComment.findFirstOrThrow({ where: { teamId } })).lineText).toBe("Ставки падают, спрос ниже");
  });
});

describe("цитата строки и уровень доступа к цифрам (этап 57)", () => {
  it("автор отчёта без доступа к цифрам не получает цитату строки с цифрами", async () => {
    // Отчёт идёт вверх: автор цифр не видит, получатель видит. Цитата не должна вернуть цифры вниз
    const lead = await noFiguresPerson("t7381-lead", "Безцифров Тест");
    const reva = await personal("reva");
    const tid = await sendFiguresReport(lead.id, { id: reva.personId, name: "Рева Тарас" });

    // Получателю цифры открыты: он видит строку и комментирует её
    const got = (await receivedReportsOf(reva, [key])).find((r) => r.teamId === tid)!;
    expect(got.blocks.find((b) => b.key === "wow")!.lines.map((l) => l.text)).toEqual([FIGURES_LINE]);
    const after = await addReportComment(reva, { teamId: tid, week: key, blockKey: "wow", lineIndex: 0 }, "Уточните рост");
    expect(after.comments[0]).toMatchObject({ lineText: FIGURES_LINE, linePresent: true });

    // Автор отчёта цифр не видит: ни строки в своём отчёте, ни цитаты в переписке
    const author = await personal("t7381-lead");
    const own = (await sentReportsOf(author, [key])).find((r) => r.teamId === tid)!;
    expect(own.blocks.find((b) => b.key === "wow")!.lines.map((l) => l.text)).toEqual([NUMBERS_HIDDEN_TEXT]);
    const seen = await reportComments(author, own);
    expect(seen.access.sees).toBe(true);
    expect(seen.comments[0]).toMatchObject({ text: "Уточните рост", lineText: null, blockTitle: "Неделя к неделе", linePresent: false });
    expect(JSON.stringify(seen)).not.toMatch("12 345");
    // В базе цитата осталась: она нужна для истории, наружу её отдаёт только уровень доступа читателя
    expect((await prisma.leaderReportComment.findFirstOrThrow({ where: { teamId: tid } })).lineText).toBe(FIGURES_LINE);
  });

  it("строку вместо закрытых цифр комментировать нельзя", async () => {
    // Получателю цифры закрыты: вместо строки он видит пометку, и это не строка отчёта
    const low = await noFiguresPerson("t7381-low", "Получатель без цифр");
    const tid = await sendFiguresReport(await id("reva"), { id: low.id, name: "Получатель без цифр" });
    const actor = await personal("t7381-low");
    const got = (await receivedReportsOf(actor, [key])).find((r) => r.teamId === tid)!;
    expect(got.blocks.find((b) => b.key === "wow")!.lines.map((l) => l.text)).toEqual([NUMBERS_HIDDEN_TEXT]);
    await expectRule(addReportComment(actor, { teamId: tid, week: key, blockKey: "wow", lineIndex: 0 }, "Замечание"), /не строка отчёта/);
    // К отчёту целиком он написать может: закрыты цифры, а не обсуждение
    expect((await addReportComment(actor, { teamId: tid, week: key }, "Пришлите цифры отдельно")).comments).toHaveLength(1);
  });
});
