// Этап 24 (модуль М9): чтение недельного отчёта в имитации, выбор цифр, цифры за неделю; прогноз лидера с историей,
// переносом строк, причиной отклонения, правами и видимостью.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as weekly from "@/lib/weekly/service";
import * as org from "@/lib/org/service";
import * as numbers from "@/lib/numbers/service";
import * as fc from "@/lib/forecast/service";
import { TOP_TEAM } from "@/lib/org/scope";
import { shiftWeek } from "@/lib/weekly/weeks";
import type { WeekKey } from "@/domain/types";

const actor = {
  owner: () => tasks.actorFor("muradyan", "OWNER"),
  ownerPlain: () => tasks.actorFor("muradyan"),
  reva: () => tasks.actorFor("reva"),
  loginova: () => tasks.actorFor("loginova"),
  team: async (): Promise<tasks.Actor> => ({ ...(await tasks.actorFor("reva")), via: "TEAM" }),
};
const id = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

let key: WeekKey;
let revaTeam: string;
let employee: string;
const FAKE_LINK = "https://docs.google.com/spreadsheets/d/1o1IlcrQD6ZguW2_X1kZOdT-nFM0jKHihh38VfDYbcMg/edit";

beforeAll(async () => {
  process.env.SHEET_FAKE = "1";
  key = await weekly.currentReportingKey();
  const created = await org.createTeam(await actor.owner(), { name: "Тест: прогноз", leader: "reva" });
  revaTeam = created.id;
  const p = await prisma.person.create({ data: { slug: "fc-emp", fullName: "Прогнозов Сотрудник", shortName: "Сотрудник", role: "EMPLOYEE", zone: "" } });
  employee = p.id;
  await org.addTeamMember(await actor.owner(), revaTeam, "fc-emp");
});

beforeEach(async () => {
  await prisma.forecast.deleteMany();
  await prisma.numbersRow.deleteMany();
  await prisma.setting.deleteMany({ where: { key: { startsWith: "numbers." } } });
  await prisma.weeklyReport.deleteMany();
  await prisma.teamWeekClose.deleteMany();
  await prisma.week.updateMany({ data: { closedAt: null, closedById: null } });
});
afterAll(async () => {
  await prisma.forecast.deleteMany();
  await prisma.numbersRow.deleteMany();
  await prisma.setting.deleteMany({ where: { key: { startsWith: "numbers." } } });
  await prisma.team.deleteMany({ where: { id: revaTeam } });
  await prisma.person.delete({ where: { id: employee } });
  delete process.env.SHEET_FAKE;
  await prisma.$disconnect();
});

describe("цифры недели", () => {
  it("владелец подключает отчёт, он читается сразу, строки ищутся, цифры выбираются и показываются с изменением", async () => {
    const owner = await actor.owner();
    await expectRule(numbers.setNumbersSource(await actor.reva(), FAKE_LINK), /владелец/);
    await expectRule(numbers.setNumbersSource(owner, "не ссылка"), /ссылку/);
    const res = await numbers.setNumbersSource(owner, FAKE_LINK);
    expect(res.access).toBe("ok");
    const status = await numbers.numbersStatus();
    expect(status.connected).toBe(true);
    expect(status.state.ok).toBe(true);
    expect(status.state.rows).toBeGreaterThan(5);
    expect(status.state.latestWeek).toBe("2026-10-05");

    const found = await numbers.searchReportRows(owner, "osago");
    expect(found.length).toBeGreaterThan(3);
    const traffic = found.find((r) => r.key === "TRAFFIC|TOTAL||OSAGO|OSAGO")!;
    expect(traffic.latest).toBe(512000);
    expect(traffic.unit).toBe("count");
    const revenue = found.find((r) => r.key === "REVENUE||||OSAGO")!;
    expect(revenue.unit).toBe("mln");

    await expectRule(numbers.setMetrics(owner, [{ key: "нет такой", label: "x", unit: "count" }]), /нет строки/);
    await expectRule(numbers.setMetrics(owner, [{ key: traffic.key, label: " ", unit: "count" }]), /подпись/);
    const saved = await numbers.setMetrics(owner, [
      { key: traffic.key, label: "Трафик ОСАГО", unit: "count" },
      { key: revenue.key, label: "Выручка ОСАГО", unit: "mln" },
      { key: "||||CR, %: WAU ---> TA", label: "Конверсия в целевое", unit: "pct" },
    ]);
    expect(saved).toHaveLength(3);

    const wn = await numbers.weekNumbers("2026-10-05" as WeekKey);
    expect(wn.ready).toBe(true);
    expect(wn.figures.map((f) => [f.label, f.text, f.delta])).toEqual([
      ["Трафик ОСАГО", "512 000", "+1,5%"],
      ["Выручка ОСАГО", "110,2 млн", "+1,6%"],
      ["Конверсия в целевое", "19%", "+0 п.п."],
    ]);
    expect(wn.figures[0]!.history.map((h) => h.value)).toEqual([465286, 476536, 504337, 512000]);
    // Неделя, которой в отчёте нет: честно «нет цифр»
    const empty = await numbers.weekNumbers("2026-11-02" as WeekKey);
    expect(empty.ready).toBe(false);
    expect(numbers.numbersText(empty)[0]).toMatch(/ещё нет/);
    expect(numbers.numbersText(wn)[0]).toBe("- Трафик ОСАГО: 512 000 (+1,5% к прошлой неделе)");

    // Журнал: подключение и состав
    const log = await prisma.auditLog.findMany({ where: { action: "sync.numbers" }, orderBy: { id: "desc" }, take: 2 });
    expect(log.map((l) => l.field).sort()).toEqual(["Недельный отчёт для цифр недели", "Цифры недели: состав"]);

    // Чтение по расписанию: сразу после чтения не пора, через час пора; сбой Google не ломает снимок
    expect(await numbers.numbersDue(new Date())).toBe(false);
    expect(await numbers.numbersDue(new Date(Date.now() + 61 * 60_000))).toBe(true);
    await prisma.setting.upsert({ where: { key: "numbers.imitationDown" }, update: { value: true }, create: { key: "numbers.imitationDown", value: true } });
    await expectRule(numbers.pullNumbersNow(owner), /имитация/);
    expect((await numbers.numbersState()).ok).toBe(false);
    expect(await prisma.numbersRow.count()).toBeGreaterThan(5);
    expect((await numbers.weekNumbers("2026-10-05" as WeekKey)).ready).toBe(true);
    await prisma.setting.update({ where: { key: "numbers.imitationDown" }, data: { value: false } });

    // Выключение чистит снимок
    await numbers.setNumbersSource(owner, "");
    expect(await prisma.numbersRow.count()).toBe(0);
    expect((await numbers.weekNumbers("2026-10-05" as WeekKey)).connected).toBe(false);
  });
});

describe("прогноз до конца месяца", () => {
  const line = (patch: Partial<fc.ForecastLineInput> = {}): fc.ForecastLineInput => ({ direction: "osago", metric: "revenue", month: key.slice(0, 7), budget: 468, forecast: 440, reason: "conversion", comment: "Апрув у двух СК ниже", ...patch });

  it("лидер ставит прогноз, причина обязательна при отклонении, история и отклонение от прошлого считаются, строки переносятся на следующую неделю", async () => {
    const reva = await actor.reva();
    const prevKey = shiftWeek(key, -1);
    // Прошлая неделя
    const first = await fc.saveForecast(reva, prevKey, [line({ forecast: 450 }), line({ metric: "sales", budget: 540000, forecast: 520000, reason: "traffic" })]);
    expect(first.lines).toHaveLength(2);
    expect(first.lines[0]!.previous).toBeNull();
    expect(first.lines[0]!.toBudgetPct).toBeCloseTo(-3.85, 1);

    // Эта неделя: строки прошлой подставляются как черновик
    const mine = await fc.myForecast(reva, key);
    expect(mine.lines).toEqual([]);
    expect(mine.carry.map((c) => [c.metric, c.forecast, c.previous?.forecast])).toEqual([
      ["revenue", 450, 450],
      ["sales", 520000, 520000],
    ]);

    await expectRule(fc.saveForecast(reva, key, [line({ reason: null })]), /причину/);
    await expectRule(fc.saveForecast(reva, key, [line({ forecast: -5 })]), /отрицательным/);
    await expectRule(fc.saveForecast(reva, key, [line({ month: "2027-09" })]), /три месяца/);
    await expectRule(fc.saveForecast(reva, key, [line({ direction: "нет" })]), /направление/);
    await expectRule(fc.saveForecast(reva, key, [line(), line()]), /дважды/);
    // Прогноз в бюджете: причина не нужна
    const flat = await fc.saveForecast(reva, key, [line({ forecast: 468, reason: null, comment: null })]);
    expect(flat.lines[0]!.reason).toBeNull();

    const saved = await fc.saveForecast(reva, key, [line(), line({ metric: "sales", budget: 540000, forecast: 500000, reason: "traffic", comment: null })]);
    expect(saved.lines).toHaveLength(2);
    const rev = saved.lines.find((l) => l.metric === "revenue")!;
    expect(rev.previous).toMatchObject({ week: prevKey, forecast: 450 });
    expect(rev.toPreviousPct).toBeCloseTo(-2.22, 1);
    expect(rev.reasonLabel).toBe("Конверсия");
    expect(rev.team).toBe(TOP_TEAM);
    expect(saved.carry).toEqual([]);

    // Убрали строку: она исчезает из этой недели, прошлая неделя не тронута
    const one = await fc.saveForecast(reva, key, [line()]);
    expect(one.lines).toHaveLength(1);
    expect(await prisma.forecast.count()).toBe(3);

    // Сводка по аудитории топ-команды и история
    const top = (await prisma.teamMember.findMany({ where: { teamId: TOP_TEAM }, select: { personId: true } })).map((m) => m.personId);
    const summary = await fc.forecastSummary(key, { personIds: [...top, await id("muradyan")] });
    expect(summary.lines).toHaveLength(1);
    expect(summary.groups[0]!.label).toBe("ОСАГО");
    const text = fc.forecastText(summary);
    expect(text[0]).toContain("ОСАГО, выручка");
    expect(text[0]).toContain("бюджет 468 млн (-6%)");
    expect(text[0]).toContain("прошлый прогноз 450 млн");
    const history = await fc.forecastHistory({ personIds: [await id("reva")] }, key, 4);
    expect(history.weeks.map((w) => w.key)).toEqual([shiftWeek(key, -3), shiftWeek(key, -2), prevKey, key]);
    const revRow = history.rows.find((r) => r.metric === "revenue")!;
    expect(revRow.values).toEqual([null, null, 450, 440]);
    expect(revRow.budget).toBe(468);

    // Журнал
    const log = await prisma.auditLog.findMany({ where: { action: "weekly.forecast" } });
    expect(log.length).toBeGreaterThanOrEqual(3);
    expect(log.at(-1)!.after).toContain("ОСАГО, Выручка");
  });

  it("права: наблюдатель и закрытая неделя не правят, управление правит; сотрудник вне топ-команды пишет в свою команду", async () => {
    const reva = await actor.reva();
    const observer = await prisma.person.findFirst({ where: { role: "OBSERVER", active: true } });
    if (observer) await expectRule(fc.saveForecast(await tasks.actorFor(observer.slug), key, [line()]), /Наблюдатель/);
    await expectRule(fc.saveForecast(reva, shiftWeek(key, 1), [line()]), /будущую/);
    // Закрытая неделя
    await weekly.setWeekClosed(await actor.owner(), shiftWeek(key, -2), true);
    await expectRule(fc.saveForecast(reva, shiftWeek(key, -2), [line()]), /закрыта/);
    const byOwner = await fc.saveForecast(await actor.owner(), shiftWeek(key, -2), [line()]);
    expect(byOwner.lines).toHaveLength(1);
    expect((await fc.myForecast(reva, shiftWeek(key, -2))).closed).toBe(true);
    await weekly.setWeekClosed(await actor.owner(), shiftWeek(key, -2), false);
    // Сотрудник команды Ревы: прогноз в её команду, виден аудитории этой команды, а не топ-команде
    const emp = await tasks.actorFor("fc-emp");
    const saved = await fc.saveForecast(emp, key, [line({ direction: "kasko", budget: null, reason: null, comment: null })]);
    expect(saved.lines[0]!.team).toBe(revaTeam);
    const topSummary = await fc.forecastSummary(key, { personIds: [await id("muradyan"), await id("reva")] });
    expect(topSummary.lines).toEqual([]);
    const teamSummary = await fc.forecastSummary(key, { personIds: [employee] });
    expect(teamSummary.lines).toHaveLength(1);
  });
});
