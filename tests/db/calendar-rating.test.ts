// Этап 29: календарь сроков по личной ссылке и анонимная оценка встреч раз в месяц.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as cal from "@/lib/calendar/service";
import * as rating from "@/lib/meeting-rating/service";
import * as oo from "@/lib/one-on-one/service";
import * as login from "@/lib/login/service";
import * as pw from "@/lib/login/password";
import { TOP_TEAM } from "@/lib/org/scope";
import { dbDate, moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import { hashToken } from "@/lib/login/service";
import type { LoginMethod } from "@/generated/prisma/enums";
import { GET as calendarRoute } from "@/app/api/calendar/[file]/route";

const fetchCalendar = (file: string) => calendarRoute(new Request(`http://localhost:3000/api/calendar/${file}`), { params: Promise.resolve({ file }) });

const as = async (slug: string, via: LoginMethod = "PASSWORD", management: "OWNER" | "ADMIN" | null = null): Promise<tasks.Actor> => ({ ...(await tasks.actorFor(slug, management)), via });
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const subject = (id: string, role: "OWNER" | "ADMIN" | "LEADER", limited = false) => ({ id, role, limited });
const idOf = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;

let number = 7700;
let directionId: string;
const SECRET = "Переговоры с секретным партнёром";

async function clean() {
  await prisma.calendarFeed.deleteMany();
  await prisma.meetingRatingVote.deleteMany();
  await prisma.meetingRatingBox.deleteMany();
  await prisma.oneOnOnePair.deleteMany();
  await prisma.task.deleteMany({ where: { number: { gt: 7700, lt: 7800 } } });
}

beforeAll(async () => {
  await clean();
  directionId = (await prisma.dictionaryItem.findFirstOrThrow({ where: { code: "department" } })).id;
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("календарь сроков", () => {
  beforeEach(clean);

  it("ссылку создают только при личном входе и не наблюдатели; в базе только отпечаток", async () => {
    await expectRule(cal.createFeed(await as("reva", "TEAM"), false), /при личном входе/);
    await expectRule(cal.createFeed(await as("reva", "TEAM", "OWNER"), false), /при личном входе/);
    const { token } = await cal.createFeed(await as("reva"), false);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await prisma.calendarFeed.findUniqueOrThrow({ where: { personId: await idOf("reva") } });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(cal.feedUrl("https://weekly.example/", token)).toBe(`https://weekly.example/api/calendar/${token}.ics`);
    // Наблюдатель: у него нет своих сроков
    await prisma.person.update({ where: { slug: "ceo" }, data: { active: true } });
    await expectRule(cal.createFeed(await as("ceo"), false), /наблюдател/);
    await prisma.person.update({ where: { slug: "ceo" }, data: { active: false } });
  });

  it("файл: сроки своих задач без названий, срок weekly и встречи; с названиями появляется название задачи и имя", async () => {
    const reva = await idOf("reva");
    const today = moscowToday();
    const t = await prisma.task.create({
      data: { number: ++number, title: SECRET, outcome: "Договор", directionId, due: dbDate(addDays(today, 5)), whereUpdatedAt: dbDate(today), teamId: TOP_TEAM, ownerId: reva },
    });
    // Чужая и закрытая задачи в календарь не попадают
    await prisma.task.create({ data: { number: ++number, title: "Чужая задача", outcome: "-", directionId, due: dbDate(today), whereUpdatedAt: dbDate(today), teamId: TOP_TEAM, ownerId: await idOf("loginova") } });
    await prisma.task.create({
      data: { number: ++number, title: "Закрытая", outcome: "-", directionId, due: dbDate(today), whereUpdatedAt: dbDate(today), teamId: TOP_TEAM, ownerId: reva, status: "DONE", resolution: "Готово" },
    });
    // Встреча один на один с руководителем
    await oo.scheduleMeeting(await as("muradyan", "PASSWORD", "OWNER"), "reva", addDays(today, 2));
    const pair = await prisma.oneOnOnePair.findFirstOrThrow({ where: { reportId: reva } });

    const ics = await cal.calendarFile(reva, false, "https://weekly.example");
    const flat = ics.replace(/\r\n /g, "");
    expect(flat).toContain(`SUMMARY:Срок задачи №${t.number}`);
    expect(flat).toContain(`URL:https://weekly.example/tasks/${t.number}`);
    expect(flat).not.toContain("секретным");
    expect(flat).not.toContain("Чужая задача");
    expect(flat).not.toContain(`№${number}`);
    expect(flat).toContain("SUMMARY:Встреча один на один");
    expect(flat).toContain(`URL:https://weekly.example/one-on-one?pair=${pair.id}`);
    expect(flat).not.toContain("Мурадян");
    expect(flat).toMatch(/SUMMARY:Срок weekly\\, неделя \d+/);
    // Топ-команда без названий тоже просто «команда»: по календарю не видно, кто в неё входит
    expect(flat).toMatch(/SUMMARY:Встреча команды\\, неделя \d+/);
    expect(flat).not.toContain("топ-команд");

    const titled = (await cal.calendarFile(reva, true, "https://weekly.example")).replace(/\r\n /g, "");
    expect(titled).toContain(`SUMMARY:№${t.number} ${SECRET}`);
    expect(titled).toContain("SUMMARY:Один на один: Мурадян");
  });

  it("ссылка по токену: новая заменяет старую, отключение гасит; названия включаются без новой ссылки", async () => {
    const reva = await as("reva");
    const first = await cal.createFeed(reva, false);
    expect(await cal.feedByToken(first.token)).toMatchObject({ personId: reva.personId, withTitles: false });
    const second = await cal.createFeed(reva, false);
    expect(await cal.feedByToken(first.token)).toBeNull();
    expect(await cal.feedByToken(second.token)).not.toBeNull();
    await cal.setFeedTitles(reva, true);
    expect((await cal.feedByToken(second.token))?.withTitles).toBe(true);
    expect((await cal.feedFor(reva.personId)).withTitles).toBe(true);
    await cal.revokeFeed(reva);
    expect(await cal.feedByToken(second.token)).toBeNull();
    await expectRule(cal.setFeedTitles(reva, false), /ещё нет/);
    // Мусор вместо токена: сразу нет, без запроса в базу по странной строке
    expect(await cal.feedByToken("../../etc/passwd")).toBeNull();
    expect(await cal.feedByToken("")).toBeNull();
  });

  it("отметка «календарь забирал данные» пишется не чаще раза в 15 минут", async () => {
    const reva = await as("reva");
    const { token } = await cal.createFeed(reva, false);
    const t0 = new Date("2026-10-08T10:00:00Z");
    await cal.feedByToken(token, t0);
    await cal.feedByToken(token, new Date(t0.getTime() + 5 * 60_000));
    expect((await cal.feedFor(reva.personId)).lastUsedAt).toBe(t0.toISOString());
    const later = new Date(t0.getTime() + 16 * 60_000);
    await cal.feedByToken(token, later);
    expect((await cal.feedFor(reva.personId)).lastUsedAt).toBe(later.toISOString());
  });

  it("ссылка гаснет: сброс пароля владельцем, «выйти везде», выключение человека", async () => {
    const owner = await as("muradyan", "PASSWORD", "OWNER");
    const reva = await as("reva");
    let { token } = await cal.createFeed(reva, false);
    await pw.resetPassword(owner, "reva");
    expect(await cal.feedByToken(token)).toBeNull();

    ({ token } = await cal.createFeed(reva, false));
    await login.revokeAllDevices(reva, "reva");
    expect(await cal.feedByToken(token)).toBeNull();

    ({ token } = await cal.createFeed(reva, false));
    await prisma.$transaction((tx) => login.revokeOnDeactivate(tx, reva.personId));
    expect(await cal.feedByToken(token)).toBeNull();

    // Смена своего пароля: прежний пароль мог кто-то узнать и создать ссылку
    ({ token } = await cal.createFeed(reva, false));
    await pw.changePassword(reva, "это-устройство", "", "Летний отпуск 2026!", "Летний отпуск 2026!");
    expect(await cal.feedByToken(token)).toBeNull();
    await prisma.person.update({ where: { slug: "reva" }, data: { passwordHash: null, passwordSetAt: null } });

    // Выключенный человек: ссылка не отдаёт календарь, даже если запись осталась
    ({ token } = await cal.createFeed(reva, false));
    await prisma.person.update({ where: { slug: "reva" }, data: { active: false } });
    expect(await cal.feedByToken(token)).toBeNull();
    await prisma.person.update({ where: { slug: "reva" }, data: { active: true } });
  });
});

describe("адрес календаря без входа", () => {
  beforeEach(clean);

  it("верная ссылка: файл календаря, ответ не кэшируется; отключённая и неверная: одинаковый 404", async () => {
    const { token } = await cal.createFeed(await as("reva"), false);
    const ok = await fetchCalendar(`${token}.ics`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await ok.text()).startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);

    const wrong = await fetchCalendar(`${"A".repeat(43)}.ics`);
    await cal.revokeFeed(await as("reva"));
    const revoked = await fetchCalendar(`${token}.ics`);
    expect(wrong.status).toBe(404);
    expect(revoked.status).toBe(404);
    expect(await wrong.text()).toBe(await revoked.text());
    expect(revoked.headers.get("cache-control")).toBe("no-store");
  });

  it("перебор неверных ссылок с одного адреса упирается в лимит, верная ссылка при этом работает", async () => {
    const { token } = await cal.createFeed(await as("loginova"), false);
    const codes: number[] = [];
    for (let i = 0; i < 35; i++) codes.push((await fetchCalendar(`${String(i).padStart(43, "B")}.ics`)).status);
    // Сначала 404, после лимита на адрес только 429. Часть неверных попыток с этого адреса была в прошлом тесте
    const first429 = codes.indexOf(429);
    expect(first429).toBeGreaterThan(20);
    expect(codes.slice(0, first429).every((c) => c === 404)).toBe(true);
    expect(codes.slice(first429).every((c) => c === 429)).toBe(true);
    expect((await fetchCalendar(`${token}.ics`)).status).toBe(200);
  });
});

describe("анонимная оценка встреч", () => {
  const oct20 = new Date("2026-10-20T09:00:00Z");
  const nov08 = new Date("2026-11-08T09:00:00Z");
  beforeEach(clean);

  it("отвечают участники команды при личном входе, один раз за месяц; руководитель и общий логин нет", async () => {
    const mine = await rating.myRatings(await as("loginova"), oct20);
    expect(mine.locked).toBeNull();
    expect(mine.months.map((m) => m.month)).toEqual(["2026-10"]);
    expect(mine.months[0].teams.map((t) => t.id)).toContain(TOP_TEAM);
    expect(mine.months[0].teams.find((t) => t.id === TOP_TEAM)).toMatchObject({ voted: false, leaderName: expect.stringMatching(/^Мурадян/) });
    expect((await rating.myRatings(await as("loginova", "TEAM"), oct20)).locked).toMatch(/при личном входе/);

    await rating.submitRating(await as("loginova"), { teamId: TOP_TEAM, month: "2026-10", score: 4, remove: "Длинные отчёты — по кругу" }, oct20);
    await expectRule(rating.submitRating(await as("loginova"), { teamId: TOP_TEAM, month: "2026-10", score: 5 }, oct20), /уже ответили/);
    expect((await rating.myRatings(await as("loginova"), oct20)).months[0].teams.find((t) => t.id === TOP_TEAM)!.voted).toBe(true);

    await expectRule(rating.submitRating(await as("muradyan", "PASSWORD", "OWNER"), { teamId: TOP_TEAM, month: "2026-10", score: 5 }, oct20), /кроме руководителя/);
    await expectRule(rating.submitRating(await as("reva", "TEAM"), { teamId: TOP_TEAM, month: "2026-10", score: 5 }, oct20), /при личном входе/);
    await expectRule(rating.submitRating(await as("reva"), { teamId: TOP_TEAM, month: "2026-09", score: 5 }, oct20), /закрыта/);
    await expectRule(rating.submitRating(await as("reva"), { teamId: TOP_TEAM, month: "2026-10", score: 6 }, oct20), /от 1 до 5/);
    await expectRule(rating.submitRating(await as("reva"), { teamId: "нет-такой", month: "2026-10", score: 3 }, oct20), /участники/);
    // Ошибки не записали ответ: строка «кто ответил» одна, в урне один ответ
    expect(await prisma.meetingRatingVote.count()).toBe(1);
    expect((await prisma.meetingRatingBox.findUniqueOrThrow({ where: { teamId_month: { teamId: TOP_TEAM, month: "2026-10" } } })).counts).toEqual([0, 0, 0, 1, 0]);
  });

  it("две вкладки отправляют ответ одновременно: учтён один, вторая узнаёт, что ответ уже есть", async () => {
    const reva = await as("reva");
    const results = await Promise.allSettled([
      rating.submitRating(reva, { teamId: TOP_TEAM, month: "2026-10", score: 5, remove: "первая вкладка" }, oct20),
      rating.submitRating(reva, { teamId: TOP_TEAM, month: "2026-10", score: 1, remove: "вторая вкладка" }, oct20),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/уже ответили/);
    const box = await prisma.meetingRatingBox.findUniqueOrThrow({ where: { teamId_month: { teamId: TOP_TEAM, month: "2026-10" } } });
    expect(box.counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(box.remove).toHaveLength(1);
  });

  it("разные люди отвечают одновременно: урна не теряет ни одного ответа", async () => {
    const people = ["reva", "loginova", "fatyanov", "sakhibullina", "afanasyev"];
    await Promise.all(people.map(async (slug, i) => rating.submitRating(await as(slug), { teamId: TOP_TEAM, month: "2026-10", score: (i % 5) + 1, remove: `текст ${i}` }, oct20)));
    const box = await prisma.meetingRatingBox.findUniqueOrThrow({ where: { teamId_month: { teamId: TOP_TEAM, month: "2026-10" } } });
    expect(box.counts).toEqual([1, 1, 1, 1, 1]);
    expect([...box.remove].sort()).toEqual(people.map((_, i) => `текст ${i}`).sort());
    expect(await prisma.meetingRatingVote.count()).toBe(5);
  });

  it("в базе ответ не связан с человеком: отдельных ответов нет, только урна с суммами; связать по служебным полям нельзя", async () => {
    for (const [slug, score] of [
      ["reva", 2],
      ["loginova", 4],
      ["fatyanov", 4],
    ] as const) {
      await rating.submitRating(await as(slug), { teamId: TOP_TEAM, month: "2026-10", score, remove: `мнение ${slug}` }, oct20);
    }
    const boxes = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM meeting_rating_boxes`;
    expect(boxes).toHaveLength(1);
    expect(Object.keys(boxes[0]).sort()).toEqual(["counts", "month", "remove", "teamId"]);
    expect(boxes[0].counts).toEqual([0, 1, 0, 2, 0]);
    const [vote] = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM meeting_rating_votes`;
    expect(Object.keys(vote).sort()).toEqual(["id", "month", "personId", "teamId"]);
    expect(String(vote.id)).toMatch(/^[0-9a-f-]{36}$/);
    // Служебный номер транзакции у урны совпадает только с последним ответившим, а в урне сумма всех ответов
    const linked = await prisma.$queryRaw<{ personId: string }[]>`SELECT v."personId" FROM meeting_rating_votes v JOIN meeting_rating_boxes b ON b.xmin = v.xmin`;
    expect(linked.length).toBeLessThanOrEqual(1);
    // И журнал не знает, кто и как ответил
    expect(await prisma.auditLog.count({ where: { action: { contains: "rating" } } })).toBe(0);
  });

  it("итог: пока опрос идёт, только число ответов; после закрытия средняя и комментарии от трёх ответов", async () => {
    const owner = subject(await idOf("muradyan"), "OWNER");
    for (const [slug, score, remove] of [
      ["reva", 4, "статусы по кругу"],
      ["loginova", 5, ""],
      ["fatyanov", 3, "длинные отчёты"],
    ] as const) {
      await rating.submitRating(await as(slug), { teamId: TOP_TEAM, month: "2026-10", score, remove }, oct20);
    }
    const during = (await rating.ratingResults(owner, TOP_TEAM, oct20))!;
    // Участники топ-команды без руководителя: включённые и не наблюдатели. Другие файлы тестов меняют состав
    const top = await prisma.team.findUniqueOrThrow({ where: { id: TOP_TEAM }, include: { members: { include: { person: true } } } });
    const expected = top.members.filter((m) => m.personId !== top.leaderId && m.person.active && m.person.role !== "OBSERVER").length;
    expect(during.raters).toBe(expected);
    const octNow = during.months.find((m) => m.month === "2026-10")!;
    expect(octNow).toMatchObject({ open: true, answered: 3, summary: null, closesLabel: "7 ноября" });

    // 7 ноября опрос ещё открыт, 8-го итог виден
    expect((await rating.ratingResults(owner, TOP_TEAM, new Date("2026-11-07T09:00:00Z")))!.months.find((m) => m.month === "2026-10")!.summary).toBeNull();
    const after = (await rating.ratingResults(owner, TOP_TEAM, nov08))!;
    const oct = after.months.find((m) => m.month === "2026-10")!;
    expect(oct.open).toBe(false);
    expect(oct.summary).toEqual({ answered: 3, hidden: false, average: 4, counts: [0, 0, 1, 1, 1], remove: ["длинные отчёты", "статусы по кругу"] });
    // В ноябре идёт новый опрос, в нём пока пусто
    expect(after.months[0]).toMatchObject({ month: "2026-11", open: true, answered: 0 });
  });

  it("двух ответов мало: итог скрыт; видят руководитель команды и руководство, участники нет", async () => {
    await rating.submitRating(await as("reva"), { teamId: TOP_TEAM, month: "2026-10", score: 1, remove: "всё" }, oct20);
    await rating.submitRating(await as("loginova"), { teamId: TOP_TEAM, month: "2026-10", score: 5, remove: "" }, oct20);
    const owner = subject(await idOf("muradyan"), "OWNER");
    const oct = (await rating.ratingResults(owner, TOP_TEAM, nov08))!.months.find((m) => m.month === "2026-10")!;
    expect(oct.summary).toEqual({ answered: 2, hidden: true, average: null, counts: null, remove: [] });
    expect(await rating.ratingResults(subject(await idOf("reva"), "LEADER"), TOP_TEAM, nov08)).toBeNull();
    expect(await rating.ratingResults(subject(await idOf("muradyan"), "OWNER", true), TOP_TEAM, nov08)).toBeNull();
    expect(await rating.ratingResults(subject(await idOf("golovkin"), "ADMIN"), TOP_TEAM, nov08)).not.toBeNull();
  });

  it("кто сам ответил и смотрит итог, видит его от четырёх ответов: по своему ответу не угадать два чужих", async () => {
    for (const slug of ["golovkin", "reva", "loginova"]) await rating.submitRating(await as(slug), { teamId: TOP_TEAM, month: "2026-10", score: 4, remove: `от ${slug}` }, oct20);
    const admin = (await rating.ratingResults(subject(await idOf("golovkin"), "ADMIN"), TOP_TEAM, nov08))!.months.find((m) => m.month === "2026-10")!;
    expect(admin).toMatchObject({ answered: 3, selfVoted: true, summary: { hidden: true, remove: [] } });
    const owner = (await rating.ratingResults(subject(await idOf("muradyan"), "OWNER"), TOP_TEAM, nov08))!.months.find((m) => m.month === "2026-10")!;
    expect(owner).toMatchObject({ answered: 3, selfVoted: false, summary: { hidden: false, average: 4 } });
    await rating.submitRating(await as("fatyanov"), { teamId: TOP_TEAM, month: "2026-10", score: 2 }, oct20);
    const again = (await rating.ratingResults(subject(await idOf("golovkin"), "ADMIN"), TOP_TEAM, nov08))!.months.find((m) => m.month === "2026-10")!;
    expect(again.summary).toMatchObject({ hidden: false, answered: 4, average: 3.5 });
  });

  it("напоминание на главной: в конце месяца, пока не ответили; в середине месяца нет", async () => {
    const loginova = await as("loginova");
    expect(await rating.ratingPrompt(loginova, oct20)).toEqual({ label: "октябрь 2026", closesLabel: "7 ноября", teams: 1 });
    expect(await rating.ratingPrompt(loginova, new Date("2026-10-12T09:00:00Z"))).toBeNull();
    // В первые дни ноября напоминают про октябрь
    expect((await rating.ratingPrompt(loginova, new Date("2026-11-03T09:00:00Z")))?.label).toBe("октябрь 2026");
    await rating.submitRating(loginova, { teamId: TOP_TEAM, month: "2026-10", score: 4 }, oct20);
    expect(await rating.ratingPrompt(loginova, oct20)).toBeNull();
    expect(await rating.ratingPrompt(await as("loginova", "TEAM"), oct20)).toBeNull();
  });
});
