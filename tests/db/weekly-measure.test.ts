// Этап 87: замер живых данных перед пересборкой экрана «Сдать weekly» на настоящей базе. Команда только читает:
// недели и записи периода, шаблоны блоков команд, человек в двух командах с разными шаблонами и выборка миграции по
// правилу entryBlockKey. Проверяется и то, из-за чего владелец может выборку не утвердить: запись переезжает в блок,
// которого нет в шаблоне её команды, и запись, сданную по забытому блоку, правило раскладывает по смыслу.
// Отдельная проверка: после замера в базе ничего не изменилось.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as weekly from "@/lib/weekly/service";
import * as team from "@/lib/weekly-blocks/team";
import { collect, measure } from "@/lib/weekly-measure/collect";
import { fieldShares, movePart, multiTeamPart, survey, type MeasureEntry } from "@/lib/weekly-measure/survey";
import { surveyText } from "@/lib/weekly-measure/text";
import { shiftWeek } from "@/lib/weekly/weeks";
import type { WeekKey } from "@/domain/types";

const BATCH = "t87measure";
const TEAM_A = "Тест 87 команда вкладов";
const TEAM_B = "Тест 87 без шаблона";
const TEMPLATE = [
  { key: "products", title: "Продукты" },
  { key: "c:hire0001", title: "Найм и команда" },
  { key: "risks", title: "Риски" },
  { key: "plan", title: "План на неделю" },
];
/** Запись длиннее предела строки отчёта: 600 знаков */
const LONG = `${"Переписали расчёт тарифа и выкатили его на весь трафик ".repeat(14)}и закончили`;

const id = async (slug: string) => (await prisma.person.findUniqueOrThrow({ where: { slug } })).id;
const personal = async (slug: string): Promise<tasks.Actor> => ({ ...(await tasks.actorFor(slug)), via: "PASSWORD" });

let key: WeekKey;
let prev: WeekKey;
let teamA: string;
let teamB: string;
let ids: string[] = [];

async function clean() {
  await prisma.weeklyEntry.deleteMany({ where: { importBatch: BATCH } });
  await prisma.teamMember.deleteMany({ where: { team: { name: { startsWith: "Тест 87" } } } });
  await prisma.teamWeeklyTemplate.deleteMany({ where: { team: { name: { startsWith: "Тест 87" } } } });
  await prisma.team.deleteMany({ where: { name: { startsWith: "Тест 87" } } });
}

beforeAll(async () => {
  key = await weekly.currentReportingKey();
  prev = shiftWeek(key, -1);
});

beforeEach(async () => {
  await clean();
  // Команда без шаблона идёт в списке первой (sortOrder): по правилу человек получает шаблон не первой команды,
  // а первой, где шаблон задан
  const b = await prisma.team.create({ data: { name: TEAM_B, kind: "CUSTOM", leaderId: await id("golovkin"), specialistsWeekly: true, sortOrder: 1 } });
  const a = await prisma.team.create({ data: { name: TEAM_A, kind: "CUSTOM", leaderId: await id("reva"), specialistsWeekly: true, sortOrder: 2 } });
  teamA = a.id;
  teamB = b.id;
  const [cheychenets, afanasyev, reva] = [await id("cheychenets"), await id("afanasyev"), await id("reva")];
  await prisma.teamMember.createMany({
    data: [
      { teamId: teamA, personId: cheychenets },
      { teamId: teamA, personId: afanasyev },
      { teamId: teamB, personId: cheychenets },
    ],
  });
  await team.saveTeamTemplate(await personal("reva"), teamA, TEMPLATE);

  const week = await weekly.ensureWeek(prisma, key);
  const weekPrev = await weekly.ensureWeek(prisma, prev);
  const dict = (kind: "DIRECTION" | "WEEKLY_BLOCK" | "ENTRY_TYPE", code: string) => prisma.dictionaryItem.findFirstOrThrow({ where: { kind, code } });
  const [deposits, partners, changes, risksBlock, result, risk] = await Promise.all([
    dict("DIRECTION", "deposits"),
    dict("DIRECTION", "partners"),
    dict("WEEKLY_BLOCK", "key-changes"),
    dict("WEEKLY_BLOCK", "risks"),
    dict("ENTRY_TYPE", "result"),
    dict("ENTRY_TYPE", "risk"),
  ]);
  const base = { directionId: deposits.id, blockId: changes.id, typeId: result.id, importBatch: BATCH };
  await prisma.weeklyEntry.createMany({
    data: [
      // Сдана по своему блоку шаблона: переезжает в него же
      { ...base, weekId: week.id, authorId: cheychenets, section: "c:hire0001", what: "Закрыли вакансию аналитика", impact: "Команда выйдет на план быстрее", fact: "2 оффера", links: [{ title: "Воронка найма", url: "https://example.test/hiring" }] },
      // Сдана по блоку, которого в шаблоне уже нет: блок теряется
      { ...base, weekId: week.id, authorId: cheychenets, section: "c:ghost001", what: LONG },
      // Риск партнёрки: по смыслу в «Риски»
      { ...base, weekId: week.id, authorId: afanasyev, directionId: partners.id, blockId: risksBlock.id, typeId: risk.id, what: "Агрегатор сдвигает интеграцию", next: "Собрать встречу с партнёром" },
      // Руководитель команды: weekly от него не ждёт ни одна команда, шаблона у него нет
      { ...base, weekId: week.id, authorId: reva, what: "Собрал план на квартал" },
      // Прошлая неделя: в период попадает, в выборку миграции за одну неделю нет
      { ...base, weekId: weekPrev.id, authorId: afanasyev, what: "Выкатили витрину вкладов" },
    ],
  });
  ids = (await prisma.weeklyEntry.findMany({ where: { importBatch: BATCH }, select: { id: true } })).map((r) => r.id);
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

const mineOf = (entries: MeasureEntry[]): MeasureEntry[] => entries.filter((e) => ids.includes(e.id));

describe("замер живых данных (этап 87)", () => {
  it("читает недели, записи и поля: то же, что видит форма записи", async () => {
    const input = await collect();
    expect(input.weeks.map((w) => w.key)).toContain(key);
    expect(input.weeks.find((w) => w.key === key)?.current).toBe(true);
    expect(input.weeks.map((w) => w.key)).toContain(prev);
    const mine = mineOf(input.entries);
    expect(mine).toHaveLength(5);
    const hire = mine.find((e) => e.section === "c:hire0001")!;
    expect(hire).toMatchObject({ authorName: "Чейченец Евгений", blockLabel: "Ключевые изменения", direction: "deposits", type: "result", links: 1 });
    expect(hire.impact).toBe("Команда выйдет на план быстрее");
    const share = (list: MeasureEntry[], field: string) => fieldShares(list).find((f) => f.key === field)!;
    expect(share(mine, "impact").filled).toBe(1);
    expect(share(mine, "fact").filled).toBe(1);
    expect(share(mine, "next").filled).toBe(1);
    expect(share(mine, "help").filled).toBe(0);
    expect(share(mine, "link").filled).toBe(1);
  });

  it("шаблоны блоков команд: сколько команд завели и какие свои блоки", async () => {
    const input = await collect();
    const a = input.teams.find((t) => t.id === teamA)!;
    const b = input.teams.find((t) => t.id === teamB)!;
    expect(a.template?.map((x) => x.key)).toEqual(["products", "c:hire0001", "risks", "plan"]);
    expect(b.template).toBeNull();
    const part = survey(input).templates;
    expect(part.rows.find((r) => r.team === TEAM_A)).toMatchObject({ blocks: 4, custom: ["Найм и команда"], noProducts: false, onlyFigures: false });
    expect(part.rows.some((r) => r.team === TEAM_B)).toBe(false);
  });

  it("обрезка строки отчёта на 600 знаках: длинная запись не влезает", async () => {
    const input = await collect();
    const part = survey({ ...input, entries: mineOf(input.entries) }).cut;
    expect(part.checked).toBe(5);
    expect(part.cut).toBe(1);
    expect(part.examples[0]!.before).toBeGreaterThan(600);
    expect(part.examples[0]!.after).toBeLessThanOrEqual(600);
  });

  it("человек в двух командах: получает шаблон первой команды, где шаблон задан, а не первой команды", async () => {
    const input = await collect();
    const cheychenets = await id("cheychenets");
    const author = input.authors.find((a) => a.personId === cheychenets)!;
    // В списке команда без шаблона первая, но правило приложения берёт команду с шаблоном
    expect(author.order).toEqual([teamB, teamA]);
    expect(author.templateTeamId).toBe(teamA);
    expect(author.showing).toEqual([teamB, teamA]);
    const person = multiTeamPart(input).people.find((p) => p.name === "Чейченец Евгений")!;
    expect(person).toMatchObject({ winner: TEAM_A, notFirst: true });
    expect(person.teams).toEqual([
      { name: TEAM_B, blocks: null },
      { name: TEAM_A, blocks: 4 },
    ]);
    // Руководитель команды: weekly от него не ждёт ни одна команда, шаблона у него нет
    const leader = input.authors.find((a) => a.name === "Рева Тарас")!;
    expect(leader.order).toEqual([]);
    expect(leader.templateTeamId).toBeNull();
  });

  it("выборка миграции: блок шаблона сохраняется, забытый блок теряется, запись едет в блок, которого в шаблоне команды нет", async () => {
    const input = await collect();
    const part = movePart({ ...input, entries: mineOf(input.entries) });
    // Выборка за четыре недели: все пять записей, включая запись прошлой недели
    expect(part.entries).toBe(5);
    expect(part.targets.map((t) => t.toTitle).sort()).toEqual(["Найм и команда", "Продукты", "Риски"].sort());
    expect(part.byReason.section).toBe(1);

    const ghost = part.problems.find((p) => p.start.startsWith("Переписали расчёт тарифа"))!;
    expect(ghost.flags).toContain("stale-section");
    expect(ghost.toTitle).toBe("Продукты");

    // У руководителя шаблона нет: запись переезжает в блок, которого в шаблоне его команды нет
    const leader = part.problems.find((p) => p.author === "Рева Тарас")!;
    expect(leader.flags).toContain("outside-template");
    expect(leader.team).toBeNull();
    expect(leader.perTeam).toEqual([{ team: TEAM_A, toTitle: "Продукты", inTemplate: true }]);

    // Человек в двух командах: в отчёте второй команды та же запись окажется в другом блоке
    const split = part.problems.find((p) => p.toTitle === "Найм и команда")!;
    expect(split.flags).toContain("split-teams");
    expect(split.perTeam).toEqual([
      { team: TEAM_B, toTitle: "Продукты", inTemplate: false },
      { team: TEAM_A, toTitle: "Найм и команда", inTemplate: true },
    ]);

    // Выборка за одну неделю: запись прошлой недели в неё не попадает
    const one = movePart({ ...input, recent: 1, entries: mineOf(input.entries) });
    expect(one.weeks).toEqual([key]);
    expect(one.entries).toBe(4);
  });

  it("замер ничего не пишет в базу и печатает человеческий текст", async () => {
    const counts = async () => ({
      entries: await prisma.weeklyEntry.count(),
      weeks: await prisma.week.count(),
      teams: await prisma.team.count(),
      members: await prisma.teamMember.count(),
      templates: await prisma.teamWeeklyTemplate.count(),
      reports: await prisma.teamWeeklyReport.count(),
      audit: await prisma.auditLog.count(),
      people: await prisma.person.count(),
      settings: await prisma.setting.count(),
    });
    const before = await counts();
    const template = await prisma.teamWeeklyTemplate.findUniqueOrThrow({ where: { teamId: teamA } });
    const s = await measure();
    expect(await counts()).toEqual(before);
    expect((await prisma.teamWeeklyTemplate.findUniqueOrThrow({ where: { teamId: teamA } })).updatedAt.getTime()).toBe(template.updatedAt.getTime());
    const text = surveyText(s);
    expect(text).toContain("Только чтение: в базу ничего не записано.");
    expect(text).toContain("1. Сколько записей сдают за неделю и какие поля заполняют");
    expect(text).toContain(TEAM_A);
    expect(text).toContain("5. Выборка миграции");
    expect(text).toContain("правило взяло следующую");
  });
});
