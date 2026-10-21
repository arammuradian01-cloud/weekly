// Этап 62: рынок КАСКО и ОСАГО на настоящей базе. Кто видит раздел (владелец и люди из списка, только при личном
// входе), настройка в журнале и устаревшие люди, загрузка пакета владельцем с заменой прежнего одной транзакцией,
// данные для окна, пункт повестки на первой встрече месяца у выбранных команд без дублей. Пакет синтетический:
// tests/fixtures/market/bundle.json
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as m from "@/lib/meeting/service";
import { canSeeMarket, loadMarketMeeting, marketSettingsView, saveMarketSettings, MARKET_ACCESS_KEY, MARKET_MEETING_KEY } from "@/lib/market/access";
import { marketMeta, marketPayload, uploadMarketBundle, etagMatches } from "@/lib/market/service";
import { parseBundle, type MarketBundleInput } from "@/lib/market/bundle";
import { TOP_TEAM } from "@/lib/org/scope";
import type { WeekKey } from "@/domain/types";

const FIXTURE = readFileSync("tests/fixtures/market/bundle.json", "utf8");
const bundle = (): MarketBundleInput => parseBundle(FIXTURE);
const personal = async (slug: string, management: "OWNER" | "ADMIN" | null = null): Promise<tasks.Actor> => ({ ...(await tasks.actorFor(slug, management)), via: "PASSWORD" });
const team = async (slug: string, management: "OWNER" | "ADMIN" | null = null): Promise<tasks.Actor> => ({ ...(await tasks.actorFor(slug, management)), via: "TEAM" });
const sees = async (a: tasks.Actor) => canSeeMarket({ personId: a.personId, via: a.via });
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
// Недели со встречами 6 и 13 октября 2026 (встреча во вторник следующей недели): первая встреча октября и вторая
const FIRST: WeekKey = "2026-09-28" as WeekKey;
const SECOND: WeekKey = "2026-10-05" as WeekKey;
let revaTeam: string;
/** Журнал только дописывается: записи теста ищутся после последней записи до него */
const lastLogId = async () => (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);

async function reset() {
  await prisma.decision.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.marketDataset.deleteMany();
  await prisma.marketBundle.deleteMany();
  await prisma.setting.deleteMany({ where: { key: { in: [MARKET_ACCESS_KEY, MARKET_MEETING_KEY] } } });
  await prisma.person.updateMany({ where: { slug: { in: ["reva", "loginova"] } }, data: { active: true } });
  await prisma.setting.upsert({ where: { key: "week.meeting" }, update: { value: { weekday: 2 } }, create: { key: "week.meeting", value: { weekday: 2 } } });
}

beforeAll(async () => {
  const created = await org.createTeam(await personal("muradyan", "OWNER"), { name: "Тест рынка: команда Ревы", leader: "reva" });
  revaTeam = created.id;
  await org.addTeamMember(await personal("muradyan", "OWNER"), revaTeam, "loginova");
});
beforeEach(reset);
afterAll(async () => {
  await reset();
  await prisma.team.deleteMany({ where: { id: revaTeam } });
  await prisma.$disconnect();
});

describe("доступ к разделу", () => {
  it("владелец при личном входе видит, по общему логину нет; остальные только из списка", async () => {
    expect(await sees(await personal("muradyan"))).toBe(true);
    expect(await sees(await team("muradyan", "OWNER"))).toBe(false);
    expect(await sees(await personal("golovkin", "ADMIN"))).toBe(false);
    expect(await sees(await personal("reva"))).toBe(false);

    const view = await saveMarketSettings(await personal("muradyan", "OWNER"), { people: ["reva", "nobody"], teamIds: [TOP_TEAM, revaTeam, "nope"] });
    expect(view.people).toEqual(["reva"]);
    expect(view.teamIds.sort()).toEqual([TOP_TEAM, revaTeam].sort());
    expect(await sees(await personal("reva"))).toBe(true);
    expect(await sees(await team("reva"))).toBe(false);
    expect(await sees(await personal("loginova"))).toBe(false);
    // Выключенный человек раздел не видит, в настройке он считается устаревшим
    await prisma.person.update({ where: { slug: "reva" }, data: { active: false } });
    expect(await sees(await personal("reva"))).toBe(false);
    const stale = await marketSettingsView();
    expect(stale.stale).toEqual({ people: 1, teams: 0 });
    expect(stale.people).toEqual([]);
  });

  it("настройку ведёт владелец в режиме управления, правка в журнале было и стало", async () => {
    const since = await lastLogId();
    await expectRule(saveMarketSettings(await personal("muradyan"), { people: ["reva"], teamIds: [] }), /владелец в режиме управления/);
    await expectRule(saveMarketSettings(await personal("golovkin", "ADMIN"), { people: ["reva"], teamIds: [] }), /владелец в режиме управления/);
    // По умолчанию разбор у топ-команды
    expect(await loadMarketMeeting()).toEqual({ teamIds: [TOP_TEAM] });
    const owner = await personal("muradyan", "OWNER");
    await saveMarketSettings(owner, { people: ["reva"], teamIds: [TOP_TEAM] });
    const log = await prisma.auditLog.findMany({ where: { id: { gt: since }, action: { in: ["settings.marketAccess", "settings.marketMeeting"] } }, orderBy: { id: "asc" } });
    // Команды не поменялись (топ-команда была по умолчанию), люди поменялись
    expect(log.map((l) => l.action)).toEqual(["settings.marketAccess"]);
    expect(log[0]).toMatchObject({ before: "только владельцы", via: "PASSWORD", actorName: "Мурадян Арам" });
    expect(String(log[0]!.after)).toContain("Рева");
    await saveMarketSettings(owner, { people: ["reva"], teamIds: [] });
    const meetingLog = await prisma.auditLog.findFirst({ where: { id: { gt: since }, action: "settings.marketMeeting" } });
    expect(meetingLog).toMatchObject({ before: "Топ-команда", after: "ни у кого", via: "PASSWORD" });
    expect(await loadMarketMeeting()).toEqual({ teamIds: [] });
  });
});

describe("пакет рынка", () => {
  it("загружает владелец при личном входе; человек со списка и общий логин нет", async () => {
    await prisma.setting.create({ data: { key: MARKET_ACCESS_KEY, value: { people: ["reva"] } } });
    await expectRule(uploadMarketBundle(await personal("reva"), bundle(), 100), /загружает владелец при личном входе/);
    await expectRule(uploadMarketBundle(await team("muradyan", "OWNER"), bundle(), 100), /загружает владелец при личном входе/);
    await expectRule(uploadMarketBundle(await personal("golovkin", "ADMIN"), bundle(), 100), /загружает владелец/);
    expect(await marketMeta()).toBeNull();
  });

  it("новый пакет целиком заменяет прежний одной транзакцией, версия растёт, в журнале только счёт наборов и строк", async () => {
    const owner = await personal("muradyan");
    const since = await lastLogId();
    const first = await uploadMarketBundle(owner, bundle(), 4673, new Date("2026-10-02T07:00:00Z"));
    expect(first).toMatchObject({ version: 1, datasetsCount: 2, rowsTotal: 6, uploadedBy: "Мурадян Арам", uploadedAt: "2026-10-02T07:00:00.000Z" });
    const payload = await marketPayload();
    expect(Object.keys(payload!.files).sort()).toEqual(["app.js", "d3.min.js", "index.html"]);
    expect(payload!.datasets.k_demo).toEqual([
      { region: "Север", cnt: 10, prem: 1.5 },
      { region: "Юг", cnt: 20, prem: 2.5 },
      { region: "Запад", cnt: 12, prem: 2 },
    ]);
    expect(payload!.etag).toBe(first.etag);
    expect(etagMatches(`W/${first.etag}`, first.etag)).toBe(true);

    // Второй пакет: набор o_demo ушёл, k_demo заменён, появился новый
    const next = bundle();
    delete next.datasets.o_demo;
    next.datasets.k_demo = { title: "Другие договоры", description: "", rows: [{ region: "Восток", cnt: 1, prem: 0.1 }] };
    next.datasets.k_new = { title: "Новый набор", description: "", rows: [{ a: 1 }, { a: 2 }] };
    next.datasetsCount = 2;
    next.rowsTotal = 3;
    const second = await uploadMarketBundle(owner, next, 900);
    expect(second.version).toBe(2);
    expect(second.etag).not.toBe(first.etag);
    expect(etagMatches(first.etag, second.etag)).toBe(false);
    const sets = await prisma.marketDataset.findMany({ orderBy: { name: "asc" }, select: { name: true, rowCount: true, title: true } });
    expect(sets).toEqual([
      { name: "k_demo", rowCount: 1, title: "Другие договоры" },
      { name: "k_new", rowCount: 2, title: "Новый набор" },
    ]);
    const log = await prisma.auditLog.findMany({ where: { id: { gt: since }, action: "market.upload" }, orderBy: { id: "asc" } });
    expect(log.map((l) => [l.before, l.after, l.via])).toEqual([
      [null, "Наборов 2, строк 6, файлов кода 3", "PASSWORD"],
      ["Наборов 2, строк 6", "Наборов 2, строк 3, файлов кода 3", "PASSWORD"],
    ]);
    // Цифры в журнал не попадают
    expect(log.map((l) => `${l.field} ${String(l.before)} ${String(l.after)}`).join(" ")).not.toContain("Восток");
  });
});

describe("разбор рынка на встрече", () => {
  const titles = (v: { items: { kind: string; title: string }[] }) => v.items.filter((i) => i.kind === "market").map((i) => i.title);

  it("без пакета пункта нет; с пакетом первая встреча месяца у топ-команды начинается с рынка, пересборка без дублей", async () => {
    const owner = await personal("muradyan", "OWNER");
    let view = await m.buildAgenda(owner, TOP_TEAM, FIRST);
    expect(view.date).toBe("2026-10-06");
    expect(titles(view)).toEqual([]);

    await uploadMarketBundle(await personal("muradyan"), bundle(), 100, new Date("2026-10-02T07:00:00Z"));
    view = await m.buildAgenda(owner, TOP_TEAM, FIRST);
    expect(view.items[0]).toMatchObject({ kind: "market", title: "Рынок КАСКО и ОСАГО: итоги сентября", note: "Данные рынка от 2 октября.", auto: true });
    view = await m.buildAgenda(owner, TOP_TEAM, FIRST);
    expect(titles(view)).toEqual(["Рынок КАСКО и ОСАГО: итоги сентября"]);
    expect(view.items[0]!.kind).toBe("market");
    expect(await prisma.agendaItem.count({ where: { kind: "MARKET" } })).toBe(1);
    // Живой режим начинается с рынка
    view = await m.startMeeting(owner, view.id);
    expect(view.currentItemId).toBe(view.items[0]!.id);

    // Вторая встреча октября: раньше в этом месяце встреча уже была
    const second = await m.buildAgenda(owner, TOP_TEAM, SECOND);
    expect(second.date).toBe("2026-10-13");
    expect(titles(second)).toEqual([]);
    // Команда не из настройки: пункта нет и на её первой встрече
    const other = await m.buildAgenda(await personal("reva"), revaTeam, FIRST);
    expect(titles(other)).toEqual([]);
  });

  it("убранный ведущим пункт не возвращается, пункт встаёт первым и в уже собранной повестке", async () => {
    const owner = await personal("muradyan", "OWNER");
    // Повестка собрана до загрузки пакета: пункт рынка встаёт первым при пересборке
    let view = await m.buildAgenda(owner, TOP_TEAM, FIRST);
    expect(view.items.length).toBeGreaterThan(1);
    await uploadMarketBundle(await personal("muradyan"), bundle(), 100);
    view = await m.buildAgenda(owner, TOP_TEAM, FIRST);
    expect(view.items[0]!.kind).toBe("market");
    view = await m.removeAgendaItem(owner, view.id, view.items[0]!.id);
    view = await m.buildAgenda(owner, TOP_TEAM, FIRST);
    expect(titles(view)).toEqual([]);
  });

  it("у выбранной команды пункт на её первой встрече месяца; кнопку рынка видят только те, кому раздел открыт", async () => {
    const owner = await personal("muradyan", "OWNER");
    await uploadMarketBundle(await personal("muradyan"), bundle(), 100, new Date("2026-09-20T10:00:00Z"));
    await saveMarketSettings(owner, { people: ["reva"], teamIds: [revaTeam] });
    const top = await m.buildAgenda(owner, TOP_TEAM, FIRST);
    expect(titles(top)).toEqual([]);
    const view = await m.buildAgenda(await personal("reva"), revaTeam, FIRST);
    expect(view.items[0]).toMatchObject({ kind: "market", note: "Свежий пакет рынка в этом месяце ещё не загружали: данные от 20 сентября." });
    expect(view.canOpenMarket).toBe(true);
    expect((await m.getMeeting(await personal("loginova"), revaTeam, FIRST))?.canOpenMarket).toBe(false);
    // Владелец по общему логину даже в режиме управления раздела не видит
    expect((await m.getMeeting(await team("muradyan", "OWNER"), revaTeam, FIRST))?.canOpenMarket).toBe(false);
    expect((await m.getMeeting(await personal("muradyan"), revaTeam, FIRST))?.canOpenMarket).toBe(true);
  });
});
