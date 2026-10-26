// Этап 73: weekly за прошлые недели (задним числом), «Отчёт руководителю» вместо отчёта CEO: получатель, архив
// отправленных, полученные, комментарии руководителя и их права, напоминание не сдавшим.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { actorFor, TaskRuleError, type Actor } from "@/lib/tasks/service";
import * as svc from "@/lib/weekly/service";
import { currentReportingKey, ensureWeek } from "@/lib/weekly/service";
import { shiftWeek } from "@/lib/weekly/weeks";
import { closedWeekText, sentReportsFor, submitWeeks } from "@/lib/weekly/submit-weeks";
import { remindNotSubmitted } from "@/lib/weekly/remind";
import { reopenWeekly } from "@/lib/weekly/promise-service";
import { addReportComment, canLeadReport, leaderReportVisible, receivedWeek, reportTeams, sentArchive, sentReportView } from "@/lib/leader-report/service";
import { canEditTop } from "@/lib/ceo/report";

const P = "t73";
const slug = (s: string) => `${P}-${s}`;
const personal = async (s: string, management: Actor["management"] = null): Promise<Actor> => ({ ...(await actorFor(slug(s), management)), via: "PASSWORD" });
const shared = async (s: string): Promise<Actor> => ({ ...(await actorFor(slug(s))), via: "TEAM" });
const person = (s: string) => prisma.person.findUniqueOrThrow({ where: { slug: slug(s) } });

const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

async function clean() {
  await prisma.leaderReportComment.deleteMany({ where: { author: { slug: { startsWith: P } } } });
  await prisma.inboxEvent.deleteMany({ where: { recipient: { slug: { startsWith: P } } } });
  await prisma.teamWeeklyReport.deleteMany({ where: { teamId: { startsWith: P } } });
  await prisma.team.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.weeklyEntry.deleteMany({ where: { author: { slug: { startsWith: P } } } });
  await prisma.weeklyReport.deleteMany({ where: { author: { slug: { startsWith: P } } } });
  await prisma.person.updateMany({ where: { slug: { startsWith: P } }, data: { managerId: null } });
  await prisma.person.deleteMany({ where: { slug: { startsWith: P } } });
}

let reporting: string;
let past: string;
/** Недели, которые тест закрыл: после теста открываем, база общая для всех файлов */
const closedHere: string[] = [];
async function closeWeek(key: string) {
  const row = await ensureWeek(prisma, key);
  await prisma.week.update({ where: { id: row.id }, data: { closedAt: new Date() } });
  closedHere.push(row.id);
  return row;
}
afterEach(async () => {
  if (closedHere.length) await prisma.week.updateMany({ where: { id: { in: closedHere.splice(0) } }, data: { closedAt: null } });
});

beforeEach(async () => {
  await clean();
  for (const s of ["boss", "leader", "member", "lazy", "outsider"]) {
    await prisma.person.create({ data: { slug: slug(s), fullName: `Тест73 ${s}`, shortName: s, role: "EMPLOYEE", zone: "Тест 73" } });
  }
  // Команда выше у начальника, команда ниже у руководителя: получатель отчёта команды ниже начальник
  await prisma.team.create({ data: { id: slug("up"), name: "Тест73 управление", kind: "CUSTOM", leaderId: (await person("boss")).id } });
  await prisma.team.create({
    data: {
      id: slug("team"),
      name: "Тест73 команда",
      kind: "CUSTOM",
      parentId: slug("up"),
      leaderId: (await person("leader")).id,
      specialistsWeekly: true,
      members: { create: [{ personId: (await person("member")).id }, { personId: (await person("lazy")).id }] },
    },
  });
  reporting = await currentReportingKey();
  past = shiftWeek(reporting, -2);
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

const entry = (week: string, what = "Запись за прошлую неделю"): svc.EntryInput => ({ week, direction: "osago", block: "product", type: "event", what });

/** Отправленный отчёт команды за неделю: снимок, получатель, правка после отправки по желанию */
async function sendTeamReport(week: string, opts: { editedAfter?: boolean } = {}) {
  const row = await ensureWeek(prisma, week);
  const leader = await person("leader");
  const boss = await person("boss");
  const sentAt = new Date(Date.now() - 60_000);
  const snapshot = [{ key: "products", title: "Продукты", hidden: false, note: null, lines: [{ product: "osago", text: "Отправленная строка", href: null, source: null }] }];
  return prisma.teamWeeklyReport.create({
    data: {
      teamId: slug("team"),
      weekId: row.id,
      blocks: opts.editedAfter ? [{ ...snapshot[0], lines: [{ product: "osago", text: "Правка после отправки", href: null, source: null }] }] : snapshot,
      sentSnapshot: snapshot,
      sentAt,
      sentById: leader.id,
      sentTo: [{ id: boss.id, name: boss.fullName }],
      updatedAt: opts.editedAfter ? new Date() : sentAt,
    },
  });
}

describe("weekly за прошлые недели", () => {
  it("прошлая открытая неделя сдаётся задним числом: сдан с опозданием и с отметкой, в ленте недели видно", async () => {
    const member = await personal("member");
    await svc.saveHeadline(member, past, "Итог прошлой недели");
    await svc.saveEntry(member, entry(past));
    const sent = await svc.submitWeekly(member, past);
    expect(sent).toMatchObject({ state: "late", retro: true });
    const view = await svc.getWeekView(past);
    expect(view.reports.find((r) => r.author === slug("member"))).toMatchObject({ state: "late", retro: true });
    // Вернули в черновик: отметка снимается, повторная сдача считает её заново
    await reopenWeekly(member, past);
    expect((await prisma.weeklyReport.findFirstOrThrow({ where: { author: { slug: slug("member") } } })).retro).toBe(false);
    const log = await prisma.auditLog.findFirst({ where: { action: "weekly.submit", entityId: `${past}/${slug("member")}` } });
    expect(log?.after).toBe("Сдан задним числом");
  });

  it("сдача за отчётную неделю задним числом не отмечается; за будущую неделю weekly не пишут", async () => {
    const member = await personal("member");
    await svc.saveHeadline(member, reporting, "Итог отчётной недели");
    await svc.saveEntry(member, entry(reporting));
    expect((await svc.submitWeekly(member, reporting)).retro).toBeUndefined();
    await expectRule(svc.saveEntry(member, entry(shiftWeek(reporting, 1))), /будущую неделю/);
  });

  it("закрытая неделя: несданный weekly дописывают и сдают задним числом, после сдачи правит только управление", async () => {
    const member = await personal("member");
    await closeWeek(past);
    const mine = await svc.getMyWeekly((await person("member")).id, past);
    expect(mine.week).toMatchObject({ closed: true, retroOpen: true });
    await svc.saveHeadline(member, past, "Догоняю закрытую неделю");
    const saved = await svc.saveEntry(member, entry(past, "Запись закрытой недели"));
    expect((await svc.submitWeekly(member, past)).retro).toBe(true);
    await expectRule(svc.saveEntry(member, { ...entry(past, "Ещё одна"), id: saved.id }), /закрыта/);
    await expectRule(reopenWeekly(member, past), /закрыта/);
    // Кто может открыть: подсказка про администратора
    expect(await closedWeekText((await person("member")).id, past)).toMatch(/владелец или администратор/);
    // Управление правит как раньше
    const owner = await actorFor("muradyan", "OWNER");
    await svc.saveEntry(owner, { ...entry(past, "Правка владельца"), id: saved.id });
  });

  it("неделя, закрытая командой: подсказка называет команду и её руководителя", async () => {
    const row = await ensureWeek(prisma, past);
    await prisma.teamWeekClose.create({ data: { teamId: slug("team"), weekId: row.id, closedById: (await person("leader")).id } });
    const member = await person("member");
    await prisma.weeklyReport.create({ data: { weekId: row.id, authorId: member.id, headline: "Сдан", state: "SUBMITTED", submittedAt: new Date() } });
    expect(await closedWeekText(member.id, past)).toMatch(/«Тест73 команда» \(Тест73 leader\)/);
  });

  it("переключатель недель: отчётная первой, у каждой состояние, закрытая неделя без своего weekly «закрыта»", async () => {
    const member = await person("member");
    await closeWeek(shiftWeek(reporting, -3));
    const draft = await ensureWeek(prisma, shiftWeek(reporting, -1));
    await prisma.weeklyReport.create({ data: { weekId: draft.id, authorId: member.id, state: "DRAFT" } });
    const weeks = await submitWeeks(member.id);
    expect(weeks[0]).toMatchObject({ key: reporting, reporting: true, state: "not-started" });
    expect(weeks.find((w) => w.key === shiftWeek(reporting, -1))?.state).toBe("draft");
    expect(weeks.find((w) => w.key === shiftWeek(reporting, -3))).toMatchObject({ state: "closed", closed: true });
    // Старая неделя из адреса попадает в список
    const old = shiftWeek(reporting, -20);
    expect((await submitWeeks(member.id, old)).some((w) => w.key === old)).toBe(true);
  });

  it("отчёт руководителю за неделю уже отправлен: предупреждение при сдаче называет команду", async () => {
    await sendTeamReport(past);
    const notes = await sentReportsFor((await person("member")).id, past);
    expect(notes).toEqual([expect.objectContaining({ team: "Тест73 команда", to: ["Тест73 boss"] })]);
    expect(await sentReportsFor((await person("outsider")).id, past)).toEqual([]);
  });
});

describe("отчёт руководителю", () => {
  it("кто ведёт отчёт: руководитель команды при личном входе, руководитель выше; участник и общий логин нет", async () => {
    expect(await canLeadReport(await personal("leader"), slug("team"))).toBe(true);
    expect(await canLeadReport(await personal("boss"), slug("team"))).toBe(true);
    expect(await canLeadReport(await personal("member"), slug("team"))).toBe(false);
    expect(await canLeadReport(await shared("leader"), slug("team"))).toBe(false);
    const teams = await reportTeams(await personal("boss"));
    expect(teams.map((t) => [t.id, t.note])).toEqual(expect.arrayContaining([[slug("up"), "вы руководитель"], [slug("team"), "команда ниже"]]));
    expect(await reportTeams(await shared("leader"))).toEqual([]);
  });

  it("отчёт команды страхования и инвестиций ведут её руководитель при личном входе и управление", async () => {
    const top = await prisma.team.findUniqueOrThrow({ where: { id: "top" }, select: { leaderId: true } });
    const leader = await prisma.person.findUniqueOrThrow({ where: { id: top.leaderId! } });
    expect(await canEditTop({ ...(await actorFor(leader.slug)), via: "PASSWORD" })).toBe(true);
    expect(await canEditTop({ ...(await actorFor(leader.slug)), via: "TEAM" })).toBe(false);
    expect(await canEditTop(await actorFor("golovkin", "ADMIN"))).toBe(true);
    expect(await canEditTop(await personal("member"))).toBe(false);
  });

  it("меню: руководитель, владелец и режим управления видят раздел; участник и общий логин без управления нет", async () => {
    expect(await leaderReportVisible(await personal("leader"))).toBe(true);
    expect(await leaderReportVisible(await personal("member"))).toBe(false);
    expect(await leaderReportVisible(await shared("leader"))).toBe(false);
    expect(await leaderReportVisible({ ...(await personal("outsider")), management: "ADMIN" })).toBe(true);
    expect(await leaderReportVisible(await actorFor("muradyan"))).toBe(true);
    // Получатель отчёта видит раздел, даже если своей команды у него нет
    await prisma.team.update({ where: { id: slug("up") }, data: { leaderId: null } });
    await prisma.person.update({ where: { slug: slug("leader") }, data: { managerId: (await person("outsider")).id } });
    expect(await leaderReportVisible(await personal("outsider"))).toBe(true);
  });

  it("отправленные: ровно отправленная версия с пометкой о правке после отправки; участник команды не видит", async () => {
    await sendTeamReport(past, { editedAfter: true });
    const leader = await personal("leader");
    const archive = await sentArchive(leader, slug("team"));
    expect(archive).toEqual([expect.objectContaining({ week: past, to: ["Тест73 boss"], editedAfter: true, comments: 0 })]);
    const view = (await sentReportView(leader, slug("team"), past))!;
    expect(JSON.stringify(view.blocks)).toContain("Отправленная строка");
    expect(JSON.stringify(view.blocks)).not.toContain("Правка после отправки");
    expect(view.editedAfter).toBe(true);
    await expectRule(sentArchive(await personal("member"), slug("team")), /видят/);
    await expectRule(sentReportView(await personal("member"), slug("team"), past), /не отправляли/);
  });

  it("полученные: у начальника команда ниже, отправила или нет; у постороннего пусто", async () => {
    const boss = await personal("boss");
    const before = await receivedWeek(boss, past);
    expect(before.items).toEqual([expect.objectContaining({ team: { id: slug("team"), name: "Тест73 команда" }, sentAt: null, expected: true })]);
    await sendTeamReport(past);
    const after = await receivedWeek(boss, past);
    expect(after.items[0]).toMatchObject({ leader: "Тест73 leader", sentBy: "Тест73 leader", expected: true });
    expect(after.items[0]!.sentAt).not.toBeNull();
    expect((await receivedWeek(await personal("outsider"), past)).items).toEqual([]);
    expect((await receivedWeek(await shared("boss"), past)).items).toEqual([]);
  });

  it("комментарии: получатель к отчёту и к строке, автор отвечает, события второй стороне, участник и администратор не видят", async () => {
    await sendTeamReport(past);
    const boss = await personal("boss");
    const leader = await personal("leader");
    const one = (await addReportComment(boss, { teamId: slug("team"), week: past, text: "Почему так мало?" }))!;
    expect(one.comments).toEqual([expect.objectContaining({ author: "Тест73 boss", side: "recipient", blockKey: null })]);
    const line = (await addReportComment(boss, { teamId: slug("team"), week: past, text: "Цифру добавь", blockKey: "products", lineText: "Отправленная строка" }))!;
    expect(line.comments?.find((c) => c.blockKey === "products")).toMatchObject({ lineText: "Отправленная строка", lineGone: false });
    await expectRule(addReportComment(boss, { teamId: slug("team"), week: past, text: "x", blockKey: "products", lineText: "Нет такой строки" }), /строки/);
    // Событие автору
    const toLeader = await prisma.inboxEvent.findMany({ where: { recipient: { slug: slug("leader") }, kind: "REPORT_COMMENT" } });
    expect(toLeader.map((e) => e.subject)).toContain(`report-comment:sent:${slug("team")}:${past}`);
    // Автор отвечает, но первым комментарий не начинает
    await expectRule(addReportComment(leader, { teamId: slug("team"), week: past, text: "Сам себе" }), /пишет тот, кому его отправили/);
    const reply = (await addReportComment(leader, { teamId: slug("team"), week: past, text: "Добавлю", parentId: one.comments![0]!.id }))!;
    expect(reply.comments?.filter((c) => c.parentId === one.comments![0]!.id)).toEqual([expect.objectContaining({ side: "author", text: "Добавлю" })]);
    const toBoss = await prisma.inboxEvent.findMany({ where: { recipient: { slug: slug("boss") }, kind: "REPORT_COMMENT" } });
    expect(toBoss.map((e) => e.subject)).toContain(`report-comment:received:${slug("team")}:${past}`);
    // Кто видит: автор и получатель видят, владелец в режиме управления видит, администратор архив видит, комментарии нет
    expect((await sentReportView(leader, slug("team"), past))!.comments).toHaveLength(3);
    expect((await sentReportView(await actorFor("muradyan", "OWNER"), slug("team"), past))!.comments).toHaveLength(3);
    expect((await sentReportView(await actorFor("golovkin", "ADMIN"), slug("team"), past))!.comments).toBeNull();
    await expectRule(sentReportView(await personal("member"), slug("team"), past), /не отправляли/);
    // Общий логин не комментирует, в журнале каждый комментарий
    await expectRule(addReportComment(await shared("boss"), { teamId: slug("team"), week: past, text: "x" }), /личном входе/);
    expect(await prisma.auditLog.count({ where: { action: "report.comment", entityId: `${slug("team")}/${past}` } })).toBe(3);
  });

  it("неотправленный отчёт не комментируют", async () => {
    await expectRule(addReportComment(await personal("boss"), { teamId: slug("team"), week: past, text: "x" }), /отправленный отчёт/);
  });
});

describe("напомнить не сдавшим", () => {
  it("руководитель напоминает тем, кто не сдал, повтор в течение шести часов не дублирует; участник не может", async () => {
    const leader = await personal("leader");
    const member = await personal("member");
    await svc.saveHeadline(member, reporting, "Сдаю вовремя");
    await svc.saveEntry(member, entry(reporting));
    await svc.submitWeekly(member, reporting);
    const r = await remindNotSubmitted(leader, slug("team"), reporting);
    expect(r).toEqual({ sent: 1, skipped: 0 });
    const events = await prisma.inboxEvent.findMany({ where: { kind: "WEEKLY_REMIND", recipient: { slug: { startsWith: P } } }, include: { recipient: true } });
    expect(events.map((e) => e.recipient.slug)).toEqual([slug("lazy")]);
    expect(await remindNotSubmitted(leader, slug("team"), reporting)).toEqual({ sent: 0, skipped: 1 });
    await expectRule(remindNotSubmitted(await personal("member"), slug("team"), reporting), /руководитель/);
    await expectRule(remindNotSubmitted(await shared("leader"), slug("team"), reporting), /личном входе/);
    await expectRule(remindNotSubmitted(leader, null, reporting), /режиме управления/);
  });
});
