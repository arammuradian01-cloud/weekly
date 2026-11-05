// Этап 73+81: weekly за прошлые недели на настоящей базе. Переключатель недель показывает состояние каждой недели,
// прошлую открытую неделю автор ещё сдаёт (сервер разрешал это и раньше), закрытую неделю, как раньше, правят только
// владелец и администраторы. Отправленный отчёт руководителю за ту неделю даёт предупреждение при сдаче.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as weekly from "@/lib/weekly/service";
import { closedWeekText, earliestWeek, sentReportsFor, submitWeeks } from "@/lib/weekly/submit-weeks";
import { SUBMIT_WEEKS, canEditWeekly, submitWeekOf } from "@/lib/weekly/rules";
import { isWeekKey, shiftWeek } from "@/lib/weekly/weeks";
import { dbDate } from "@/lib/tasks/dates";
import type { PersonSlug, WeekKey } from "@/domain/types";

const personal = async (slug: string, management: tasks.Actor["management"] = null): Promise<tasks.Actor> => ({ ...(await tasks.actorFor(slug, management)), via: "PASSWORD" });
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const id = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;

let reporting: WeekKey;
let past: WeekKey;

/** Человек вне остальных команд: закрытие одной команды закрывает неделю только ему */
const soloPerson = () => prisma.person.create({ data: { slug: "t7381-solo", fullName: "Одиночка Тест", shortName: "Тест", role: "LEADER", zone: "Тест 7381", active: true } });

async function clean() {
  await prisma.weeklyEntry.deleteMany({ where: { importBatch: "t7381past" } });
  await prisma.weeklyReport.deleteMany({ where: { author: { slug: "cheychenets" }, week: { start: { in: [dbDate(reporting), dbDate(past)] } } } });
  // Закрытия недель мог оставить соседний файл тестов на той же базе: обе недели начинаются открытыми
  await prisma.teamWeekClose.deleteMany({ where: { week: { start: { in: [dbDate(reporting), dbDate(past)] } } } });
  await prisma.ceoReport.deleteMany({ where: { week: { start: dbDate(past) } } });
  await prisma.week.updateMany({ where: { start: { in: [dbDate(reporting), dbDate(past)] } }, data: { closedAt: null } });
  await prisma.teamMember.deleteMany({ where: { team: { name: { startsWith: "Тест 7381" } } } });
  await prisma.team.deleteMany({ where: { name: { startsWith: "Тест 7381" } } });
  await prisma.teamMember.deleteMany({ where: { person: { slug: "t7381-solo" } } });
  await prisma.person.deleteMany({ where: { slug: "t7381-solo" } });
}

beforeAll(async () => {
  reporting = await weekly.currentReportingKey();
  past = shiftWeek(reporting, -1);
});
beforeEach(async () => {
  await clean();
  await weekly.ensureWeek(prisma, reporting);
  await weekly.ensureWeek(prisma, past);
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("переключатель недель на экране сдачи", () => {
  it("отчётная и прошлые недели со своим состоянием; выбранная неделя старше списка попадает в список", async () => {
    const author = await personal("cheychenets");
    const weeks = await submitWeeks(author.personId);
    expect(weeks).toHaveLength(SUBMIT_WEEKS);
    expect(weeks[0]).toMatchObject({ key: reporting, reporting: true });
    expect(weeks[1]).toMatchObject({ key: past, reporting: false });
    // Недели без строки в базе ресурс не вёл: они открыты и пусты, строки для них не создаются
    expect(weeks.every((w) => typeof w.number === "number" && w.number > 0)).toBe(true);
    const old = shiftWeek(reporting, -20);
    const rows = await prisma.week.count({ where: { start: dbDate(old) } });
    const withOld = await submitWeeks(author.personId, old);
    expect(withOld).toHaveLength(SUBMIT_WEEKS + 1);
    expect(withOld.at(-1)).toMatchObject({ key: old });
    // Строки недель переключатель не создаёт: неделя без строки открыта и пуста
    expect(await prisma.week.count({ where: { start: dbDate(old) } })).toBe(rows);
  });

  it("дальше самой старой недели ресурса не листаем: недель, которых не было, не создаём", async () => {
    const earliest = await earliestWeek();
    expect(earliest).toBeTruthy();
    // Неделя `past` создана в beforeEach, значит самая старая неделя не позже неё
    expect(earliest! <= past).toBe(true);
    // Недели раньше самой старой в базе нет, и просьба о ней заменяется ею: строка недели на чтении не заводится
    expect(await prisma.week.count({ where: { start: { lt: dbDate(earliest!) } } })).toBe(0);
    expect(submitWeekOf(shiftWeek(earliest!, -10), reporting, isWeekKey, earliest)).toMatchObject({ key: earliest!, tooOld: true });
  });

  it("состояние недели: черновик, сдан, закрыта", async () => {
    const author = await personal("cheychenets");
    const week = await weekly.ensureWeek(prisma, past);
    const dict = (kind: "DIRECTION" | "WEEKLY_BLOCK" | "ENTRY_TYPE", code: string) => prisma.dictionaryItem.findFirstOrThrow({ where: { kind, code } });
    const [deposits, block, result] = await Promise.all([dict("DIRECTION", "deposits"), dict("WEEKLY_BLOCK", "key-changes"), dict("ENTRY_TYPE", "result")]);
    await prisma.weeklyEntry.create({
      data: { weekId: week.id, authorId: author.personId, directionId: deposits.id, blockId: block.id, typeId: result.id, what: "Итог прошлой недели", importBatch: "t7381past" },
    });
    await weekly.saveHeadline(author, past, "Итоги прошлой недели");
    expect((await submitWeeks(author.personId)).find((w) => w.key === past)).toMatchObject({ state: "draft" });

    // Прошлая открытая неделя: автор ещё сдаёт её сам. Срок прошёл, значит «Сдан с опозданием»
    const done = await weekly.submitWeekly(author, past);
    expect(done.state).toBe("late");
    const after = (await submitWeeks(author.personId)).find((w) => w.key === past);
    expect(after).toMatchObject({ state: "late", closed: false });
    expect(after!.submittedAt).toBeTruthy();

    // Неделя закрыта департаментом: состояние сданного остаётся, подсказка говорит, кто её откроет
    await weekly.setWeekClosed(await personal("muradyan", "OWNER"), past, true);
    expect((await submitWeeks(author.personId)).find((w) => w.key === past)).toMatchObject({ state: "late", closed: true });
    const hint = await closedWeekText(author.personId, past);
    expect(hint).toContain("закрыта после встречи");
    expect(await closedWeekText(author.personId, reporting)).toBeNull();
  });

  it("закрытая неделя остаётся только для владельца и администраторов: права не менялись", async () => {
    const author = await personal("cheychenets");
    await weekly.setWeekClosed(await personal("muradyan", "OWNER"), past, true);
    const mine = await weekly.getMyWeekly(author.personId, past);
    expect(mine.week.closed).toBe(true);
    const viewer = { slug: author.slug as PersonSlug, management: null, observer: false };
    expect(canEditWeekly(mine.week, reporting, viewer, author.slug as PersonSlug)).toBe(false);
    expect(canEditWeekly(mine.week, reporting, { ...viewer, management: "OWNER" }, author.slug as PersonSlug)).toBe(true);
    await expectRule(weekly.saveHeadline(author, past, "Допишу задним числом"), /закрыта/);
    // За будущую неделю weekly не пишут
    await expectRule(weekly.saveHeadline(author, shiftWeek(reporting, 1), "Будущее"), /будущую неделю/);
  });

  it("неделю закрыл руководитель команды: подсказка называет команду и его", async () => {
    // Человек только в этой команде: топ-команда закрывается вместе с неделей департамента, и её участник от закрытия
    // одной команды weekly не теряет (closedFor)
    const solo = await soloPerson();
    const t = await prisma.team.create({ data: { name: "Тест 7381 команда", kind: "CUSTOM", leaderId: await id("reva"), specialistsWeekly: true } });
    await prisma.teamMember.create({ data: { teamId: t.id, personId: solo.id } });
    await weekly.setTeamWeekClosed(await personal("reva"), t.id, past, true);
    const hint = await closedWeekText(solo.id, past);
    expect(hint).toContain("Тест 7381 команда");
    expect(hint).toContain("Рева Тарас");
    expect((await submitWeeks(solo.id)).find((w) => w.key === past)).toMatchObject({ closed: true, state: "closed" });
  });
});

describe("отчёт руководителю за ту неделю уже отправлен", () => {
  it("предупреждение считается по командам человека", async () => {
    const solo = await soloPerson();
    expect(await sentReportsFor(solo.id, past)).toEqual([]);
    const week = await weekly.ensureWeek(prisma, past);
    await prisma.ceoReport.create({
      data: {
        weekId: week.id,
        main: "Итог",
        risks: "",
        next: "",
        sentAt: new Date(),
        sentById: await id("muradyan"),
        sentTo: [{ id: await id("ceo"), name: "CEO" }],
        sentSnapshot: { main: "Итог", risks: "", next: "", meetings: [], blocks: null },
      },
    });
    // Человек в топ-команде: отчёт CEO за ту неделю уже ушёл, и записи в отправленную версию сами не войдут
    await prisma.teamMember.create({ data: { teamId: "top", personId: solo.id } });
    const list = await sentReportsFor(solo.id, past);
    expect(list).toHaveLength(1);
    expect(list[0]!.to).toEqual(["CEO"]);
  });
});
