import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { actorFor, type Actor } from "@/lib/tasks/service";
import { currentReportingKey, ensureWeek } from "@/lib/weekly/service";
import { teamInboxScope, teamInboxView, weeklyReaders } from "@/lib/weekly/team-inbox";
import { teamReportView } from "@/lib/weekly-blocks/team";
import { shiftWeek } from "@/lib/weekly/weeks";
import { dbDate } from "@/lib/tasks/dates";

const prefix = "test-inbox-73a";
const personal = async (slug: string): Promise<Actor> => ({ ...await actorFor(`${prefix}-${slug}`), via: "PASSWORD" });
const person = (slug: string) => prisma.person.findUniqueOrThrow({ where: { slug: `${prefix}-${slug}` } });
const clean = async () => {
  await prisma.ceoReport.deleteMany({ where: { updatedBy: { slug: { startsWith: prefix } } } });
  await prisma.team.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.weeklyReport.deleteMany({ where: { author: { slug: { startsWith: prefix } } } });
  await prisma.person.deleteMany({ where: { slug: { startsWith: prefix } } });
};
beforeEach(async () => {
  await clean();
  for (const slug of ["leader", "member", "draft", "other", "sender"]) {
    await prisma.person.create({ data: { slug: `${prefix}-${slug}`, fullName: `Тест ${slug}`, shortName: slug, role: "EMPLOYEE", zone: "Тест 73а" } });
  }
  await prisma.team.create({ data: { id: `${prefix}-team`, name: "Тест входящих", kind: "CUSTOM", leaderId: (await person("leader")).id, specialistsWeekly: true, members: { create: [{ personId: (await person("member")).id }, { personId: (await person("draft")).id }] } } });
  await prisma.team.create({ data: { id: `${prefix}-other`, name: "Чужая команда", kind: "CUSTOM", leaderId: (await person("other")).id } });
});
afterAll(async () => { await clean(); await prisma.$disconnect(); });

describe("Отчёт по моей команде", () => {
  it("руководитель определяется по команде, участнику и общему логину входящие закрыты, чужую команду нельзя выбрать адресом", async () => {
    const leader = await personal("leader");
    expect((await teamInboxScope(leader)).allowed).toBe(true);
    expect((await teamInboxScope(await personal("member"))).allowed).toBe(false);
    expect((await teamInboxScope({ ...leader, via: "TEAM", management: "OWNER" })).allowed).toBe(false);
    await expect(teamInboxView(await personal("member"))).rejects.toThrow(/при личном входе/);
    await expect(teamInboxView(leader, undefined, `${prefix}-other`)).rejects.toThrow(/недоступны/);
    expect(await weeklyReaders((await person("member")).id)).toContainEqual({ team: "Тест входящих", leader: "Тест leader" });
  });

  it("показывает сданный weekly и статус черновика без его содержимого; пустая отчётная неделя не подменяется прошлой", async () => {
    const key = await currentReportingKey();
    const old = shiftWeek(key, -1);
    const week = await ensureWeek(prisma, old);
    const member = await person("member");
    const draft = await person("draft");
    await prisma.weeklyReport.createMany({ data: [
      { weekId: week.id, authorId: member.id, headline: "Сданный итог", state: "SUBMITTED", submittedAt: new Date() },
      { weekId: week.id, authorId: draft.id, headline: "Личный черновик", thanks: "Черновая благодарность", state: "DRAFT" },
    ] });
    const now = await teamInboxView(await personal("leader"));
    expect(now.key).toBe(key);
    expect(now.reports.every((r) => r.state === "not-started")).toBe(true);
    const previous = await teamInboxView(await personal("leader"), old);
    expect(previous.reports.find((r) => r.author === member.slug)).toMatchObject({ headline: "Сданный итог", state: "submitted" });
    expect(previous.reports.find((r) => r.author === draft.slug)).toMatchObject({ headline: "", state: "draft", entries: [] });
    expect(JSON.stringify(previous)).not.toContain("Черновая благодарность");
  });

  it("входящие сводные отчёты отбираются по сохранённому получателю; ему открывается отправленный снимок, а не свежий черновик", async () => {
    const key = await currentReportingKey();
    const week = await ensureWeek(prisma, key);
    const leader = await personal("leader");
    const sender = await person("sender");
    const sent = [{ key: "risks", title: "Риски", lines: [{ text: "Отправленный риск" }] }];
    await prisma.teamWeeklyReport.create({ data: { teamId: `${prefix}-other`, weekId: week.id, blocks: [{ key: "risks", title: "Риски", lines: [{ text: "Новая правка" }] }], sentSnapshot: sent, sentAt: new Date(Date.now() - 10000), sentById: sender.id, sentTo: [{ id: leader.personId, name: leader.fullName }] } });
    const view = await teamInboxView(leader, key);
    expect(view.received).toHaveLength(1);
    expect(view.received[0]).toMatchObject({ team: { name: "Чужая команда" }, by: "Тест sender", editedAfter: true });
    expect((await teamInboxView(await personal("other"), key)).received).toEqual([]);
    const read = await teamReportView(leader, `${prefix}-other`, key);
    expect(read.mode).toBe("sent");
    expect(JSON.stringify(read.sent?.blocks)).toContain("Отправленный риск");
    expect(JSON.stringify(read.sent?.blocks)).not.toContain("Новая правка");
  });

  it("получатель отчёта CEO читает снимок даже в режиме управления; давняя неделя находится за пределами последних 30 отчётов", async () => {
    const leader = await personal("leader");
    const key = await currentReportingKey();
    const old = shiftWeek(key, -40);
    for (let i = 0; i <= 40; i++) {
      const week = await ensureWeek(prisma, shiftWeek(key, -i));
      await prisma.ceoReport.upsert({ where: { weekId: week.id }, create: { weekId: week.id }, update: {} });
      await prisma.ceoReport.update({ where: { weekId: week.id }, data: { main: "Новый черновик", updatedById: leader.personId, sentAt: dbDate(key), sentTo: [{ id: leader.personId, name: leader.fullName }], sentSnapshot: { main: "Отправленный итог CEO", risks: "", next: "", meetings: [] } } });
    }
    const view = await teamInboxView({ ...leader, management: "OWNER" }, old);
    expect(view.ceo?.current).toMatchObject({ key: old, sections: { main: "Отправленный итог CEO" } });
    expect((await teamInboxView(await personal("other"), old)).ceo).toBeNull();
  });
});
