// Этап 31: цели Q4 из бордов лидеров. Файл .xlsx читается в памяти, берутся только вкладки целей; цели становятся
// личными целями владельцев в их командах; повторная загрузка обновляет, а не дублирует; задачу человека можно
// привязать к его личной цели. Данные выдуманы, формат как в настоящих бордах.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as goals from "@/lib/goals/service";
import { applyLeaderBoard, previewLeaderBoard, tabsFromXlsx } from "@/lib/goals/leader-board-service";
import { TOP_TEAM } from "@/lib/org/scope";
import { dbDate, moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import type { Tab } from "@/lib/goals/leader-board";

const owner = async () => ({ ...(await tasks.actorFor("muradyan", "OWNER")), via: "PASSWORD" as const });
const as = async (slug: string, management: "OWNER" | "ADMIN" | null = null) => ({ ...(await tasks.actorFor(slug, management)), via: "PASSWORD" as const });
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const Q = "2026-Q4";
const header = ["№", "Направление", "Запланировано на 4Q", "Артефакт/описание", "Start", "Целевые"];
const board = (revaTitle = "Подписка ОСАГО запущена и имеет P&L"): Tab[] => [
  // Вкладка с зарплатами: не читается совсем
  { name: "INS CPO_новая", grid: [["Сотрудник", "Заработная плата"], ["Рева Тарас", "р.999 999"]] },
  { name: "Цели CPO", grid: [["", "", "CPO - Рева Тарас"], header, ["1", "Product", revaTitle, "Проблема: рынок идёт в короткие полисы", "", "P&L к 15.12"], ["2", "Data", "Скоринг на проде", "", "", "до 15.12"]] },
  { name: "Цели RED Bus", grid: [["Логинова Светлана"], header, ["1", "", "Средний чек ипотеки вырос на 15%", "", "", "15%"]] },
  { name: "Цели Insurance (Головкин)", grid: [["Влад Головкин"], ["", "4 Q 2026", "", "Запланировано", "Артефакт/описание", "Итог", "Целевые"], ["1", "Дебиторка", "", "Дебиторка не выше 40%", "", "", "просрочка 0"]] },
  { name: "Цели Telemarketing Unit", grid: [["На кого???"], header, ["1", "", "Цель без владельца"]] },
  { name: "Цели Fincore", grid: [["Неизвестный Человек"], header, ["1", "", "Месяц закрывается за 5 дней"]] },
];

let revaTeam: string;
let directionId: string;

async function clean() {
  await prisma.task.deleteMany({ where: { number: { gte: 8800, lt: 8900 } } });
  await prisma.goal.deleteMany({ where: { quarter: Q } });
}

beforeAll(async () => {
  await clean();
  const created = await org.createTeam(await owner(), { name: "Тест: команда Ревы для целей", leader: "reva" });
  revaTeam = created.id;
  directionId = (await prisma.dictionaryItem.findFirstOrThrow({ where: { code: "department" } })).id;
});
afterAll(async () => {
  await clean();
  await prisma.teamMember.deleteMany({ where: { teamId: revaTeam } });
  await prisma.team.deleteMany({ where: { id: revaTeam } });
  await prisma.$disconnect();
});

describe("загрузка из борда лидера", () => {
  it("загружают только режим управления", async () => {
    await expectRule(previewLeaderBoard(await as("reva"), board(), { team: TOP_TEAM, quarter: Q }), /режиме управления/);
    await expectRule(applyLeaderBoard(await as("reva"), board(), { team: TOP_TEAM, quarter: Q }), /режиме управления/);
  });

  it("проверка: по каждому человеку сколько целей и куда, что не взято и почему; зарплаты в план не попадают", async () => {
    const plan = await previewLeaderBoard(await owner(), board(), { team: TOP_TEAM, quarter: Q });
    expect(plan.problems).toEqual([]);
    expect(plan.people.map((p) => [p.person, p.team, p.goals])).toEqual([
      ["Рева Тарас", "Тест: команда Ревы для целей", 2],
      ["Логинова Светлана", "Топ-команда", 1],
      ["Головкин Владислав", "Топ-команда", 1],
    ]);
    expect(plan.skipped.map((s) => s.tab)).toEqual(["Цели Telemarketing Unit", "Цели Fincore"]);
    expect(plan.skipped[1]!.reason).toMatch(/не найден среди людей ресурса/);
    expect(plan.add.map((a) => `${a.code}. ${a.title}`)).toEqual(["РТ-1. Подписка ОСАГО запущена и имеет P&L", "РТ-2. Скоринг на проде", "ЛС-1. Средний чек ипотеки вырос на 15%", "ГВ-1. Дебиторка не выше 40%"]);
    expect(JSON.stringify(plan)).not.toMatch(/999 999|Заработная/);
    // Проверка ничего не пишет
    expect(await prisma.goal.count({ where: { quarter: Q } })).toBe(0);
  });

  it("загрузка: личные цели владельцев в их командах; повторная загрузка обновляет, а не дублирует", async () => {
    const first = await applyLeaderBoard(await owner(), board(), { team: TOP_TEAM, quarter: Q, file: "Борд лидера INS CPO" });
    expect(first).toMatchObject({ added: 4, changed: 0, people: 3, skipped: 2 });
    const reva = await prisma.goal.findFirstOrThrow({ where: { quarter: Q, code: "РТ-1" }, include: { owner: true } });
    expect(reva).toMatchObject({ teamId: revaTeam, target: "P&L к 15.12", source: "leader-board:борд лидера ins cpo" });
    expect(reva.owner?.slug).toBe("reva");
    expect(reva.description).toBe("Направление: Product.\nПроблема: рынок идёт в короткие полисы");
    // В борде поправили название: та же цель обновилась
    const again = await applyLeaderBoard(await owner(), board("Подписка ОСАГО с Альфой запущена и имеет P&L"), { team: TOP_TEAM, quarter: Q });
    expect(again).toMatchObject({ added: 0, changed: 1 });
    expect(await prisma.goal.count({ where: { quarter: Q } })).toBe(4);
    expect((await prisma.goal.findFirstOrThrow({ where: { quarter: Q, code: "РТ-1" } })).title).toBe("Подписка ОСАГО с Альфой запущена и имеет P&L");
  });

  it("файл .xlsx: читаются листы как на экране, лист с зарплатами в план не попадает", async () => {
    const book = new ExcelJS.Workbook();
    for (const t of board()) {
      const ws = book.addWorksheet(t.name.slice(0, 31));
      for (const row of t.grid) ws.addRow(row);
    }
    const buffer = (await book.xlsx.writeBuffer()) as ArrayBuffer;
    const tabs = await tabsFromXlsx(buffer);
    expect(tabs.map((t) => t.name)).toContain("Цели CPO");
    expect(tabs.find((t) => t.name === "Цели CPO")!.grid[0]![2]).toBe("CPO - Рева Тарас");
    const plan = await previewLeaderBoard(await owner(), tabs, { team: TOP_TEAM, quarter: Q });
    expect(plan.people).toHaveLength(3);
    expect(JSON.stringify(plan)).not.toMatch(/999 999/);
    await expectRule(tabsFromXlsx(new TextEncoder().encode("это не xlsx").buffer as ArrayBuffer), /не читается как \.xlsx/);
  });
});

describe("задача и личная цель", () => {
  it("задачу человека можно привязать к его личной цели Q4; к чужой личной цели нельзя", async () => {
    const reva = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
    const today = moscowToday();
    const task = await prisma.task.create({
      data: { number: 8801, title: "Договор подписки с Альфой", outcome: "Подписан", directionId, ownerId: reva.id, due: dbDate(addDays(today, 10)), whereUpdatedAt: dbDate(today), teamId: TOP_TEAM },
    });
    // Цели в квартале срока задачи: так тест не зависит от сегодняшней даты
    const due = addDays(today, 10);
    const q = `${due.slice(0, 4)}-Q${Math.floor((Number(due.slice(5, 7)) - 1) / 3) + 1}`;
    await applyLeaderBoard(await owner(), board(), { team: TOP_TEAM, quarter: q });
    const revaGoal = await prisma.goal.findFirstOrThrow({ where: { quarter: q, code: "РТ-1" } });
    const lsGoal = await prisma.goal.findFirstOrThrow({ where: { quarter: q, code: "ЛС-1" } });
    const options = await goals.goalOptions({ personId: reva.id, role: "LEADER" }, task.number);
    expect(options[0]).toMatchObject({ id: revaGoal.id });
    expect(options[0]!.label).toMatch(/личная цель Рева Тарас: РТ-1\. Подписка ОСАГО/);
    expect(options.some((o) => o.id === lsGoal.id)).toBe(false);
    expect(await goals.linkTaskGoal(await as("reva"), task.number, revaGoal.id)).toEqual({ goal: revaGoal.title });
    await expectRule(goals.linkTaskGoal(await as("reva"), task.number, lsGoal.id), /личной цели её ответственного/);
    // Метка цели в списке задач: код отдельно от названия
    const listed = (await tasks.listTasks()).find((t) => t.number === task.number)!;
    expect(listed.goal).toEqual({ id: revaGoal.id, title: `РТ-1. ${revaGoal.title}`, code: "РТ-1" });
    // Личная цель в той же команде, где задача: всё равно подписана как личная и стоит первой
    const loginova = await prisma.person.findUniqueOrThrow({ where: { slug: "loginova" } });
    const other = await prisma.task.create({
      data: { number: 8802, title: "Ипотека: средний чек", outcome: "План", directionId, ownerId: loginova.id, due: dbDate(addDays(today, 10)), whereUpdatedAt: dbDate(today), teamId: TOP_TEAM },
    });
    const own = await goals.goalOptions({ personId: loginova.id, role: "LEADER" }, other.number);
    expect(own[0]!.label).toMatch(/личная цель Логинова Светлана: ЛС-1\. Средний чек/);
    expect(own.some((o) => o.id === revaGoal.id)).toBe(false);
    await prisma.task.deleteMany({ where: { number: { in: [task.number, other.number] } } });
    await prisma.goal.deleteMany({ where: { quarter: q } });
  });
});
