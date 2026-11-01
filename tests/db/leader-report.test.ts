// Этап 73+81: раздел «Отчёт руководителю» на настоящей базе. Вкладка «Отправленные» показывает ровно отправленную
// версию, вкладка «Полученные» - то, что отправили мне (экран этапа 73а), и weekly моих сотрудников. Комментарий к
// полученному отчёту пишет получатель, отвечают обе стороны; участники команды переписку не видят. Права проверяются
// на сервере, а не только в интерфейсе.
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

let key: WeekKey;
let teamId: string;

async function clean() {
  await prisma.leaderReportComment.deleteMany();
  await prisma.teamWeeklyReport.deleteMany();
  await prisma.teamWeeklyTemplate.deleteMany();
  await prisma.inboxEvent.deleteMany({ where: { subject: { startsWith: "report-comment:" } } });
  await prisma.inboxEvent.deleteMany({ where: { subject: { startsWith: "team-report:" } } });
  await prisma.auditLog.deleteMany({ where: { action: "weekly.report.comment" } });
  await prisma.weeklyEntry.deleteMany({ where: { importBatch: "t7381" } });
  await prisma.teamMember.deleteMany({ where: { team: { name: { startsWith: "Тест 73" } } } });
  await prisma.team.updateMany({ where: { name: { startsWith: "Тест 73" } }, data: { parentId: null } });
  await prisma.team.deleteMany({ where: { name: { startsWith: "Тест 73" } } });
  await prisma.person.update({ where: { slug: "reva" }, data: { managerId: null } });
}

beforeAll(async () => {
  key = await weekly.currentReportingKey();
});
beforeEach(async () => {
  await clean();
  // Команда Ревы без команды выше: отчёт уходит его руководителю по структуре (Фатьянов)
  const t = await prisma.team.create({ data: { name: "Тест 73 продуктовая команда", kind: "CUSTOM", leaderId: await id("reva"), specialistsWeekly: true } });
  teamId = t.id;
  await prisma.teamMember.createMany({ data: [{ teamId, personId: await id("cheychenets") }, { teamId, personId: await id("afanasyev") }] });
  await prisma.person.update({ where: { slug: "reva" }, data: { managerId: await id("fatyanov") } });
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

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
    // Получатель раздел видит, даже если сам командой не руководит
    const fatyanov = await leaderReportScope(await personal("fatyanov"));
    expect(fatyanov.allowed).toBe(true);
    expect(await canSeeLeaderReport(await personal("cheychenets"))).toBe(false);
    // Общий логин даже в режиме управления раздел не открывает: по нему выбирают чужой профиль
    expect(await canSeeLeaderReport(await shared("muradyan"))).toBe(false);
    expect(await canSeeLeaderReport({ ...(await shared("muradyan")), management: "OWNER" })).toBe(false);
    await expectRule(leaderReportView(await shared("muradyan")), /при личном входе/);
    await expectRule(leaderReportView(await personal("cheychenets")), /при личном входе/);
  });
});

describe("вкладки «Отправленные» и «Полученные»", () => {
  it("автор видит отправленную версию, получатель её же, посторонний ничего", async () => {
    await sendReport();
    const mine = await sentReportsOf(await personal("reva"), [key]);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ teamId, kind: "team", by: "Рева Тарас", editedAfter: false });
    expect(mine[0]!.to.map((t) => t.name)).toEqual(["Фатьянов Евгений"]);
    expect(mine[0]!.blocks.find((b) => b.key === "risks")!.lines.map((l) => l.text)).toEqual(["Ставки падают, спрос ниже"]);
    const got = await receivedReportsOf(await personal("fatyanov"), [key]);
    expect(got.map((r) => r.teamId)).toEqual([teamId]);
    // Участник команды не автор и не получатель
    expect(await sentReportsOf(await personal("cheychenets"), [key])).toEqual([]);
    expect(await receivedReportsOf(await personal("cheychenets"), [key])).toEqual([]);
    // Общий логин не видит ни отправленного, ни полученного
    expect(await sentReportsOf(await shared("reva"), [key])).toEqual([]);
    expect(await receivedReportsOf(await shared("fatyanov"), [key])).toEqual([]);
  });

  it("вкладка по умолчанию: руководителю «Отправленные», только получателю «Полученные»", async () => {
    await sendReport();
    expect((await leaderReportView(await personal("reva"))).tab).toBe("sent");
    expect((await leaderReportView(await personal("fatyanov"))).tab).toBe("received");
    // Вкладка из адреса сильнее
    expect((await leaderReportView(await personal("fatyanov"), { tab: "sent" })).tab).toBe("sent");
    const weeks = await reportWeeksOf(await personal("fatyanov"));
    expect(weeks.weeks.map((w) => w.key)).toContain(key);
    expect(weeks).toMatchObject({ hasReceived: true, hasSent: false });
  });

  it("«Полученные» показывают сданные weekly сотрудников и не отдают содержимое черновиков", async () => {
    await sendReport();
    const author = await personal("cheychenets");
    await weekly.saveHeadline(author, key, "Витрина вкладов запущена");
    await weekly.submitWeekly(author, key);
    const draft = await personal("afanasyev");
    await weekly.saveHeadline(draft, key, "Секретный черновик 7381");
    const view = await leaderReportView(await personal("reva"), { tab: "received", team: teamId });
    const row = view.people.find((p) => p.author === "cheychenets");
    expect(row).toMatchObject({ name: "Чейченец Евгений", headline: "Витрина вкладов запущена" });
    const hidden = view.people.find((p) => p.author === "afanasyev");
    expect(hidden).toMatchObject({ state: "draft", headline: "" });
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
    const fatyanov = await personal("fatyanov");
    const reva = await personal("reva");
    const after = await addReportComment(fatyanov, { teamId, week: key }, "Поправьте вывод по вкладам");
    expect(after.comments).toHaveLength(1);
    expect(after.comments[0]).toMatchObject({ author: "Фатьянов Евгений", mine: true, text: "Поправьте вывод по вкладам", blockKey: null });
    // Автор отчёта получил событие во вкладку «Отправленные»
    const revaInbox = await listInbox(reva.personId);
    expect(revaInbox.items.find((i) => i.subject === commentSubject("sent", teamId, key))).toMatchObject({
      kind: "REPORT_COMMENT",
      text: expect.stringMatching(/Фатьянов Евгений написал к отчёту команды «Тест 73 продуктовая команда» за неделю \d+/),
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
    const bossInbox = await listInbox(fatyanov.personId);
    expect(bossInbox.items.find((i) => i.subject === commentSubject("received", teamId, key))).toMatchObject({ kind: "REPORT_COMMENT" });

    // Автор не начинает обсуждение сам, участник команды не пишет и не читает
    await expectRule(addReportComment(reva, { teamId, week: key }, "Своё замечание"), /оставляет тот, кому его отправили/);
    const member = await personal("cheychenets");
    await expectRule(addReportComment(member, { teamId, week: key }, "Чужое замечание"), /оставляет тот, кому его отправили/);
    await expectRule(addReportComment(member, { teamId, week: key, parentId }, "Чужой ответ"), /Ответить в ветке/);
    const seen = await reportComments(member, (await sentReportsOf(await personal("muradyan", "OWNER"), [key])).find((r) => r.teamId === teamId)!);
    expect(seen).toMatchObject({ access: { sees: false, canStart: false, canReply: false }, comments: [] });
    // Владелец в режиме управления переписку читает, но не пишет
    const owner = await personal("muradyan", "OWNER");
    const ownerReport = (await sentReportsOf(owner, [key])).find((r) => r.teamId === teamId)!;
    expect((await reportComments(owner, ownerReport)).access).toEqual({ sees: true, canStart: false, canReply: false });
    await expectRule(addReportComment(owner, { teamId, week: key }, "Замечание владельца"), /оставляет тот, кому его отправили/);
    // Общий логин комментарии не пишет
    await expectRule(addReportComment(await shared("fatyanov"), { teamId, week: key }, "С общего логина"), /при личном входе/);
  });

  it("комментарий к строке берёт текст строки из отправленной версии; пустой и длинный текст не проходят", async () => {
    await sendReport();
    const fatyanov = await personal("fatyanov");
    const view = await receivedReportsOf(fatyanov, [key]);
    const risks = view[0]!.blocks.findIndex((b) => b.key === "risks");
    expect(risks).toBeGreaterThanOrEqual(0);
    const after = await addReportComment(fatyanov, { teamId, week: key, blockKey: "risks", lineIndex: 0 }, "Эту строку уточните");
    expect(after.comments[0]).toMatchObject({ blockKey: "risks", lineText: "Ставки падают, спрос ниже", linePresent: true });
    // Строки с таким номером нет: отказ, текст строки с экрана не принимаем
    await expectRule(addReportComment(fatyanov, { teamId, week: key, blockKey: "risks", lineIndex: 9 }, "Нет такой строки"), /строки в отправленном отчёте нет/);
    await expectRule(addReportComment(fatyanov, { teamId, week: key }, "   "), /Напишите комментарий/);
    await expectRule(addReportComment(fatyanov, { teamId, week: key }, "я".repeat(1001)), /длиннее 1000 знаков/);
    // Неделя без отправленного отчёта: комментировать нечего
    await expectRule(addReportComment(fatyanov, { teamId, week: "2026-01-05" }, "Замечание"), /отчёт этой команды не отправляли/);
  });

  it("строку убрали при повторной отправке: комментарий остаётся цитатой", async () => {
    await sendReport();
    const fatyanov = await personal("fatyanov");
    await addReportComment(fatyanov, { teamId, week: key, blockKey: "risks", lineIndex: 0 }, "Эту строку уточните");
    const reva = await personal("reva");
    const current = await team.teamReportView(reva, teamId, key, { current: true });
    const without = current.blocks.map((b) => (b.key === "risks" ? { ...b, lines: [] } : b));
    await team.sendTeamReport(reva, teamId, key, without, current.updatedAt);
    const again = await receivedReportsOf(fatyanov, [key]);
    const comments = await reportComments(fatyanov, again[0]!);
    expect(comments.comments[0]).toMatchObject({ lineText: "Ставки падают, спрос ниже", linePresent: false });
  });
});
