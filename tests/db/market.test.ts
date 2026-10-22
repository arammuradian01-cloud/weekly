// Этап 62: рынок КАСКО и ОСАГО на настоящей базе. Кто видит раздел (этап 72: общий логин любым профилем; при личном
// входе владелец, в том числе новый, и люди из списка), настройка в журнале и устаревшие люди, сохранение одного
// списка без другого, события рынка в журнале только тем, кому раздел открыт, загрузка
// пакета владельцем с заменой прежнего одной транзакцией, данные для окна и готовый ответ в памяти по версии пакета,
// пункт повестки на первой встрече месяца у выбранных команд без дублей, подпись пункта при показе и только тем, у
// кого доступ, без неё в протоколе. Пакет синтетический: tests/fixtures/market/bundle.json
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as m from "@/lib/meeting/service";
import { canSeeMarket, canSeeMarketEvents, loadMarketAccess, loadMarketMeeting, marketSettingsView, saveMarketSettings, MARKET_ACCESS_KEY, MARKET_MEETING_KEY } from "@/lib/market/access";
import * as admin from "@/lib/admin/service";
import { marketDataBody, marketMeta, marketPayload, resetMarketBodyCache, uploadMarketBundle } from "@/lib/market/service";
import { journalEvents } from "@/lib/journal";
import { buildExport } from "@/lib/admin/export";
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
  // Этап 72: проверка роли владельца возвращает Головкину роль администратора
  await prisma.person.updateMany({ where: { slug: "golovkin" }, data: { role: "ADMIN" } });
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
  it("личный вход: владелец видит, остальные только из списка; общий логин видит любым профилем (этап 72)", async () => {
    expect(await sees(await personal("muradyan"))).toBe(true);
    expect(await sees(await personal("golovkin", "ADMIN"))).toBe(false);
    expect(await sees(await personal("reva"))).toBe(false);
    // Общий логин: раздел открыт всем выбранным профилям, список не нужен
    for (const slug of ["muradyan", "golovkin", "reva", "loginova", "fatyanov"]) expect(await sees(await team(slug)), slug).toBe(true);
    expect(await sees(await team("muradyan", "OWNER"))).toBe(true);

    const view = await saveMarketSettings(await personal("muradyan", "OWNER"), { people: ["reva", "nobody"], teamIds: [TOP_TEAM, revaTeam, "nope"] });
    expect(view.people).toEqual(["reva"]);
    expect(view.teamIds.sort()).toEqual([TOP_TEAM, revaTeam].sort());
    expect(await sees(await personal("reva"))).toBe(true);
    expect(await sees(await team("reva"))).toBe(true);
    expect(await sees(await personal("loginova"))).toBe(false);
    expect(await sees(await team("loginova"))).toBe(true);
    // Выключенный человек раздел не видит ни лично, ни по общему логину, в настройке он считается устаревшим
    await prisma.person.update({ where: { slug: "reva" }, data: { active: false } });
    expect(await sees(await personal("reva"))).toBe(false);
    expect(await canSeeMarket({ personId: (await personal("reva")).personId, via: "TEAM" })).toBe(false);
    const stale = await marketSettingsView();
    expect(stale.stale).toEqual({ people: 1, teams: 0 });
    expect(stale.people).toEqual([]);
  });

  it("роль владельца даёт доступ сразу без списка, снятая роль закрывает раздел тому, кого нет в списке", async () => {
    const owner = await personal("muradyan", "OWNER");
    const golovkin = (await personal("golovkin")).personId;
    expect(await canSeeMarket({ personId: golovkin, via: "PASSWORD" })).toBe(false);
    const before = await marketSettingsView();
    try {
      await admin.updatePerson(owner, "golovkin", { role: "OWNER" });
      // Тот же вход, роль перечитывается из базы: раздел открыт сразу, список не тронут
      expect(await canSeeMarket({ personId: golovkin, via: "PASSWORD" })).toBe(true);
      expect(await canSeeMarketEvents({ personId: golovkin, via: "PASSWORD" })).toBe(true);
      expect(await loadMarketAccess()).toEqual({ people: [] });
      const asOwner = await marketSettingsView();
      expect(asOwner.owners).toBe(before.owners + 1);
      expect(asOwner.count).toBe(before.count + 1);
      await admin.updatePerson(owner, "golovkin", { role: "ADMIN" });
      expect(await canSeeMarket({ personId: golovkin, via: "PASSWORD" })).toBe(false);
      expect((await marketSettingsView()).count).toBe(before.count);
      // В списке: после снятия роли раздел остаётся открыт
      await saveMarketSettings(owner, { people: ["golovkin"] });
      await admin.updatePerson(owner, "golovkin", { role: "OWNER" });
      await admin.updatePerson(owner, "golovkin", { role: "ADMIN" });
      expect(await canSeeMarket({ personId: golovkin, via: "PASSWORD" })).toBe(true);
    } finally {
      await prisma.person.updateMany({ where: { slug: "golovkin" }, data: { role: "ADMIN" } });
    }
  });

  it("сохраняется только переданный список: люди без команд и команды без людей (этап 72)", async () => {
    const owner = await personal("muradyan", "OWNER");
    await saveMarketSettings(owner, { people: ["reva"], teamIds: [revaTeam] });
    const since = await lastLogId();
    // «Сохранить доступ»: только люди, команды разбора не трогаются
    let view = await saveMarketSettings(owner, { people: ["reva", "loginova"] });
    expect(view.people.sort()).toEqual(["loginova", "reva"]);
    expect(view.teamIds).toEqual([revaTeam]);
    expect(view.count).toBe(view.owners + 2);
    // «Сохранить разбор»: только команды, люди не трогаются
    view = await saveMarketSettings(owner, { teamIds: [TOP_TEAM] });
    expect(view.people.sort()).toEqual(["loginova", "reva"]);
    expect(view.teamIds).toEqual([TOP_TEAM]);
    const log = await prisma.auditLog.findMany({ where: { id: { gt: since }, action: { in: ["settings.marketAccess", "settings.marketMeeting"] } }, orderBy: { id: "asc" } });
    expect(log.map((l) => l.action)).toEqual(["settings.marketAccess", "settings.marketMeeting"]);
    // Пустой запрос ничего не меняет и в журнал не пишет
    const quiet = await lastLogId();
    view = await saveMarketSettings(owner, {});
    expect(view.people.sort()).toEqual(["loginova", "reva"]);
    expect(view.teamIds).toEqual([TOP_TEAM]);
    expect(await prisma.auditLog.count({ where: { id: { gt: quiet }, action: { startsWith: "settings.market" } } })).toBe(0);
    // Пустой список людей это «только владельцы», а не «без изменений»
    view = await saveMarketSettings(owner, { people: [] });
    expect(view.people).toEqual([]);
    expect(view.count).toBe(view.owners);
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
    expect(meetingLog).toMatchObject({ before: "Команда страхования и инвестиций", after: "ни у кого", via: "PASSWORD" });
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
    expect(payload!.stamp).toBe(first.stamp);

    // Второй пакет: набор o_demo ушёл, k_demo заменён, появился новый
    const next = bundle();
    delete next.datasets.o_demo;
    next.datasets.k_demo = { title: "Другие договоры", description: "", rows: [{ region: "Восток", cnt: 1, prem: 0.1 }] };
    next.datasets.k_new = { title: "Новый набор", description: "", rows: [{ a: 1 }, { a: 2 }] };
    next.datasetsCount = 2;
    next.rowsTotal = 3;
    const second = await uploadMarketBundle(owner, next, 900);
    expect(second.version).toBe(2);
    expect(second.stamp).not.toBe(first.stamp);
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

describe("готовый ответ с данными", () => {
  const parse = (b: { body: string } | null) => JSON.parse(b!.body) as { ok: boolean; version: number; files: Record<string, string>; datasets: Record<string, unknown[]> };

  it("держится в памяти по версии пакета; версия в базе другая или новый пакет: собирается заново", async () => {
    const owner = await personal("muradyan");
    expect(await marketDataBody()).toBeNull();
    await uploadMarketBundle(owner, bundle(), 100, new Date("2026-10-02T07:00:00Z"));
    const first = await marketDataBody();
    expect(parse(first)).toMatchObject({ ok: true, version: 1 });
    expect(Object.keys(parse(first).files).sort()).toEqual(["app.js", "d3.min.js", "index.html"]);
    expect(parse(first).datasets.k_demo).toHaveLength(3);

    // Строки поменялись в базе мимо загрузки, версия та же: ответ из памяти, наборы не перечитываются
    await prisma.marketDataset.update({ where: { name: "k_demo" }, data: { rows: [{ region: "Тест", cnt: 1, prem: 1 }] } });
    const cached = await marketDataBody();
    expect(cached!.body).toBe(first!.body);
    expect(cached!.stamp).toBe(first!.stamp);

    // Пакет сменился мимо этого процесса: версия в базе другая, ответ собирается заново
    await prisma.marketBundle.update({ where: { id: "current" }, data: { version: 7 } });
    const other = await marketDataBody();
    expect(parse(other).version).toBe(7);
    expect(parse(other).datasets.k_demo).toEqual([{ region: "Тест", cnt: 1, prem: 1 }]);

    // Сброс памяти: следующий запрос читает базу
    await prisma.marketDataset.update({ where: { name: "k_demo" }, data: { rows: [{ region: "Сброс", cnt: 2, prem: 2 }] } });
    resetMarketBodyCache();
    expect(parse(await marketDataBody()).datasets.k_demo).toEqual([{ region: "Сброс", cnt: 2, prem: 2 }]);

    // Загрузка нового пакета сбрасывает память сама
    const next = bundle();
    next.datasets.k_demo = { title: "Новые", description: "", rows: [{ region: "Восток", cnt: 5, prem: 0.5 }] };
    await uploadMarketBundle(owner, next, 100);
    const fresh = parse(await marketDataBody());
    expect(fresh.version).toBe(8);
    expect(fresh.datasets.k_demo).toEqual([{ region: "Восток", cnt: 5, prem: 0.5 }]);

    // Одновременные запросы при пустой памяти получают один и тот же ответ
    resetMarketBodyCache();
    const [a, b] = await Promise.all([marketDataBody(), marketDataBody()]);
    expect(a).toBe(b);

    // Пакета больше нет: и ответа нет
    await prisma.marketDataset.deleteMany();
    await prisma.marketBundle.deleteMany();
    expect(await marketDataBody()).toBeNull();
  });
});

describe("события рынка в журнале", () => {
  it("администратор без доступа к рынку не видит загрузку пакета и список людей ни в журнале, ни в выгрузке; тем, кому раздел открыт, всё видно", async () => {
    await uploadMarketBundle(await personal("muradyan"), bundle(), 100);
    await saveMarketSettings(await personal("muradyan", "OWNER"), { people: ["reva"], teamIds: [revaTeam] });
    // Кому события рынка видны (этап 72 права журнала не меняет): по правилу личного входа, общий логин их не видит,
    // хотя сам раздел ему открыт
    const events = async (a: tasks.Actor) => canSeeMarketEvents({ personId: a.personId, via: a.via });
    expect(await events(await personal("muradyan", "OWNER"))).toBe(true);
    expect(await events(await personal("reva"))).toBe(true);
    expect(await events(await personal("golovkin", "ADMIN"))).toBe(false);
    expect(await events(await team("muradyan", "OWNER"))).toBe(false);
    expect(await sees(await team("muradyan", "OWNER"))).toBe(true);
    // Соседние события: без объекта и настройка без ключа. Они видны всем, кто видит журнал (журнал только
    // дописывается, записи остаются)
    await prisma.auditLog.createMany({
      data: [
        { action: "test.marketJournal", actorName: "Проверка", field: "Событие без объекта" },
        { action: "settings.testMarketJournal", actorName: "Проверка", entity: "settings", field: "Настройка без ключа" },
        { action: "settings.testMarketJournal", actorName: "Проверка", entity: "settings", entityId: "week.meeting", field: "Ритм недели" },
      ],
    });
    const days = 1;
    const hidden = await journalEvents({ days, limit: 5000 });
    const shown = await journalEvents({ days, limit: 5000, market: true });
    const market = (p: typeof hidden) => p.events.filter((e) => e.object.startsWith("Рынок КАСКО и ОСАГО"));
    expect(market(hidden)).toEqual([]);
    expect(hidden.events.map((e) => `${e.before ?? ""} ${e.after ?? ""}`).join(" ")).not.toContain("Наборов");
    expect(market(shown).map((e) => e.field)).toEqual(expect.arrayContaining(["Пакет рынка КАСКО и ОСАГО", "Рынок: люди с доступом", "Рынок: разбор на первой встрече месяца"]));
    // Общее число подходящих считается так же: скрытые события не видны и в счёте
    const marketCount = await prisma.auditLog.count({ where: { at: { gte: new Date(Date.now() - 86_400_000) }, OR: [{ action: { startsWith: "market." } }, { action: { startsWith: "settings.market" } }] } });
    expect(marketCount).toBeGreaterThanOrEqual(3);
    expect(shown.total - hidden.total).toBe(marketCount);
    for (const field of ["Событие без объекта", "Настройка без ключа", "Ритм недели"]) {
      expect(hidden.events.some((e) => e.field === field || (field === "Событие без объекта" && e.object === "test.marketJournal")), field).toBe(true);
    }
    // Выгрузка в Excel: тот же фильтр по тому, кто выгружает
    const ExcelJS = (await import("exceljs")).default;
    const sheetText = async (market: boolean) => {
      const { buffer, summary } = await buildExport({ market });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      const rows: string[] = [];
      wb.getWorksheet("Журнал")!.eachRow((r) => rows.push((r.values as unknown[]).map((v) => String(v ?? "")).join(" | ")));
      return { rows, summary };
    };
    const plain = await sheetText(false);
    const full = await sheetText(true);
    const marketRow = /Пакет рынка КАСКО и ОСАГО|Рынок: люди с доступом|Рынок: разбор на первой встрече|market\.access|market\.meeting|Наборов \d/;
    expect(plain.rows.filter((r) => marketRow.test(r))).toEqual([]);
    expect(full.rows.filter((r) => marketRow.test(r)).length).toBeGreaterThanOrEqual(3);
    expect(plain.rows.some((r) => r.includes("Настройка без ключа"))).toBe(true);
    const allMarket = await prisma.auditLog.count({ where: { OR: [{ action: { startsWith: "market." } }, { action: { startsWith: "settings.market" } }] } });
    expect(full.summary.audit - plain.summary.audit).toBe(allMarket);
    expect((await buildExport()).summary.audit).toBe(plain.summary.audit);

    // Фильтр по типу «Настройки» тоже без событий рынка
    expect(market(await journalEvents({ days, kind: "settings", limit: 5000 }))).toEqual([]);
    expect(market(await journalEvents({ days, kind: "settings", limit: 5000, market: true })).length).toBeGreaterThanOrEqual(2);
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
    // Подпись не хранится: её считает экран при показе
    expect((await prisma.agendaItem.findFirstOrThrow({ where: { kind: "MARKET" } })).note).toBeNull();
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

  it("у выбранной команды пункт на её первой встрече месяца; кнопку рынка и подпись видят только те, кому раздел открыт", async () => {
    const owner = await personal("muradyan", "OWNER");
    await uploadMarketBundle(await personal("muradyan"), bundle(), 100, new Date("2026-09-20T10:00:00Z"));
    await saveMarketSettings(owner, { people: ["reva"], teamIds: [revaTeam] });
    const top = await m.buildAgenda(owner, TOP_TEAM, FIRST);
    expect(titles(top)).toEqual([]);
    const view = await m.buildAgenda(await personal("reva"), revaTeam, FIRST);
    expect(view.items[0]).toMatchObject({ kind: "market", note: "Свежий пакет рынка в этом месяце ещё не загружали: данные от 20 сентября." });
    expect(view.canOpenMarket).toBe(true);
    // Без доступа: пункт есть, ни кнопки, ни подписи
    const loginova = await m.getMeeting(await personal("loginova"), revaTeam, FIRST);
    expect(loginova?.canOpenMarket).toBe(false);
    expect(loginova?.items[0]).toMatchObject({ kind: "market", title: "Рынок КАСКО и ОСАГО: итоги сентября" });
    expect(loginova?.items[0]).not.toHaveProperty("note");
    // Этап 72: по общему логину раздел открыт, кнопка и подпись есть даже у тех, кого нет в списке. Логинова по
    // общему логину видит встречи топ-команды: разбор включается и там
    expect((await m.getMeeting(await team("muradyan", "OWNER"), revaTeam, FIRST))?.canOpenMarket).toBe(true);
    await saveMarketSettings(owner, { teamIds: [revaTeam, TOP_TEAM] });
    expect(titles(await m.buildAgenda(owner, TOP_TEAM, FIRST))).toEqual(["Рынок КАСКО и ОСАГО: итоги сентября"]);
    const teamLoginova = await m.getMeeting(await team("loginova"), TOP_TEAM, FIRST);
    expect(teamLoginova?.canOpenMarket).toBe(true);
    expect(teamLoginova?.items[0]).toMatchObject({ kind: "market", note: "Свежий пакет рынка в этом месяце ещё не загружали: данные от 20 сентября." });
    expect((await m.getMeeting(await personal("loginova"), TOP_TEAM, FIRST))?.canOpenMarket).toBe(false);
    expect((await m.getMeeting(await personal("muradyan"), revaTeam, FIRST))?.canOpenMarket).toBe(true);

    // Загрузили свежий пакет: подпись уже новая без пересборки повестки
    await uploadMarketBundle(await personal("muradyan"), bundle(), 100, new Date("2026-10-03T09:00:00Z"));
    expect((await m.getMeeting(await personal("reva"), revaTeam, FIRST))?.items[0]).toMatchObject({ kind: "market", note: "Данные рынка от 3 октября." });
  });

  it("подпись пункта рынка в протокол письма не попадает, хранимая заметка у пункта рынка не показывается", async () => {
    const owner = await personal("muradyan", "OWNER");
    await uploadMarketBundle(await personal("muradyan"), bundle(), 100, new Date("2026-10-02T07:00:00Z"));
    let view = await m.buildAgenda(owner, TOP_TEAM, FIRST);
    expect(view.items[0]).toMatchObject({ kind: "market", note: "Данные рынка от 2 октября." });
    // Заметка, записанная в базу раньше (прежняя сборка), не показывается и уходит при пересборке
    await prisma.agendaItem.updateMany({ where: { kind: "MARKET" }, data: { note: "Старая подпись" } });
    expect((await m.getMeeting(await personal("loginova"), TOP_TEAM, FIRST))?.items[0]).not.toHaveProperty("note");
    view = await m.buildAgenda(owner, TOP_TEAM, FIRST);
    expect(view.items[0]!.note).toBe("Данные рынка от 2 октября.");
    expect((await prisma.agendaItem.findFirstOrThrow({ where: { kind: "MARKET" } })).note).toBeNull();
    view = await m.startMeeting(owner, view.id);
    view = await m.closeMeeting(owner, view.id);
    expect(view.protocol).toBeTruthy();
    expect(view.protocol).not.toMatch(/Данные рынка|Свежий пакет|Старая подпись/);
  });
});
