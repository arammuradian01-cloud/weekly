// Цели квартала из бордов лидеров на сервере (этап 31). Файл борда (.xlsx) читается в памяти и нигде не хранится:
// из него берутся только вкладки «Цели …», из них только раздел квартала. Каждая цель становится личной целью
// человека: владелец по шапке вкладки, команда та, которой он руководит, иначе та, где он участник.
// Загрузка повторяемая: цель находится по кварталу, команде и коду «РТ-1», правки в борде обновляют её.

import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { moscowToday } from "@/lib/tasks/dates";
import { ancestorsOf, loadTeamNodes, type TeamNode } from "@/lib/org/scope";
import { NameIndex, normName } from "@/lib/bord/names";
import { matchPerson } from "@/lib/org/import";
import { applyPlan, planGoals, type GoalsPlan } from "./service";
import { quarterLabel, quarterOf } from "./parse";
import { personCode, readLeaderBoard, type Tab } from "./leader-board";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

/** Файл борда не больше этого */
export const LEADER_FILE_MAX = 15 * 1024 * 1024;
const QUARTER = /^\d{4}-Q[1-4]$/;

export type LeaderPerson = { tab: string; owner: string; person: string; team: string; goals: number };
export type LeaderPlan = Omit<GoalsPlan, "rows"> & { quarter: string; people: LeaderPerson[]; skipped: { tab: string; reason: string }[] };

/** Вкладки .xlsx как таблицы текста. Читаются все листы, отбор вкладок целей дальше */
export async function tabsFromXlsx(data: ArrayBuffer): Promise<Tab[]> {
  if (data.byteLength > LEADER_FILE_MAX) fail("Файл больше 15 МБ");
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(data);
  } catch {
    fail("Файл не читается как .xlsx: скачайте борд из Google Таблиц через «Файл», «Скачать», «Microsoft Excel»");
  }
  return book.worksheets.map((ws) => {
    const grid: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        // Текст ячейки как на экране: формулы, ссылки и форматированный текст тоже
        cells[c - 1] = (cell.text ?? "").toString();
      });
      grid[n - 1] = Array.from(cells, (c) => c ?? "");
    });
    return { name: ws.name, grid: Array.from(grid, (r) => r ?? []) };
  });
}

function requireManage(actor: Actor) {
  if (!actor.management || actor.role === "OBSERVER") fail("Цели из бордов лидеров загружают владелец и администраторы в режиме управления");
}

/** Человек по имени из шапки: «Рева Тарас» и «Тарас Рева», «Влад Головкин» и «Головкин Владислав» */
function findPerson(index: NameIndex, people: { id: string; fullName: string; shortName: string }[], name: string) {
  const direct = matchPerson(index, people, name);
  if (direct.person) return direct;
  const w = name.trim().split(/\s+/);
  if (w.length === 2) {
    const reversed = matchPerson(index, people, `${w[1]} ${w[0]}`);
    if (reversed.person) return reversed;
    return { ambiguous: direct.ambiguous || reversed.ambiguous };
  }
  return direct;
}

/** Команда человека: та, которой руководит (ближе к верху дерева), иначе та, где он участник */
function teamOf(nodes: TeamNode[], personId: string): TeamNode | null {
  const active = nodes.filter((n) => n.active);
  const depth = (n: TeamNode) => ancestorsOf(nodes, n.id).length;
  const led = active.filter((n) => n.leaderId === personId).sort((a, b) => depth(a) - depth(b));
  if (led[0]) return led[0];
  return active.find((n) => n.members.includes(personId)) ?? null;
}

/** Что даст загрузка: по каждому человеку сколько целей и куда, что пропущено и почему, что новое и что изменится */
async function buildPlan(actor: Actor, tabs: Tab[], opts: { team: string; quarter?: string | null }) {
  requireManage(actor);
  const quarter = opts.quarter && QUARTER.test(opts.quarter) ? opts.quarter : quarterOf(moscowToday());
  const qn = Number(quarter.slice(-1));
  const parsed = readLeaderBoard(tabs, qn);
  if (!parsed.length) fail("В файле нет вкладок, имя которых начинается с «Цели»");
  const nodes = await loadTeamNodes(prisma);
  if (!nodes.some((n) => n.id === opts.team && n.active)) fail("Выберите команду для людей, которые не состоят ни в одной команде");
  const people = await prisma.person.findMany({ where: { active: true, role: { not: "OBSERVER" } }, select: { id: true, fullName: true, shortName: true } });
  const index = new NameIndex(people);
  const existing = await prisma.goal.findMany({ where: { quarter }, select: { teamId: true, code: true, ownerId: true } });

  const skipped: LeaderPlan["skipped"] = [];
  const groups: { tab: string; owner: string; person: (typeof people)[number]; team: TeamNode; grid: string[][] }[] = [];
  const taken = new Map<string, string>(); // команда/основа кода -> человек
  for (const t of parsed) {
    if (t.skip || !t.owner) {
      skipped.push({ tab: t.tab, reason: t.skip ?? "В шапке вкладки не указан владелец" });
      continue;
    }
    const hit = findPerson(index, people, t.owner);
    if (!hit.person) {
      skipped.push({ tab: t.tab, reason: `Владелец «${t.owner}» ${hit.ambiguous ? "похож на нескольких людей ресурса" : "не найден среди людей ресурса"}` });
      continue;
    }
    const person = hit.person;
    if (groups.some((g) => g.person.id === person.id)) {
      skipped.push({ tab: t.tab, reason: `${person.fullName}: цели уже взяты из другой вкладки, проверьте шапку` });
      continue;
    }
    const team = teamOf(nodes, person.id) ?? nodes.find((n) => n.id === opts.team)!;
    // Основа кода: инициалы. Совпали с другим человеком той же команды: фамилия
    let base = personCode(person.fullName, 0).slice(0, -2);
    const clash = (b: string) =>
      (taken.has(`${team.id}/${b}`) && taken.get(`${team.id}/${b}`) !== person.id) ||
      existing.some((g) => g.teamId === team.id && g.code?.startsWith(`${b}-`) && g.ownerId && g.ownerId !== person.id);
    if (clash(base)) base = person.fullName.trim().split(/\s+/)[0]!;
    taken.set(`${team.id}/${base}`, person.id);
    const grid = [
      ["№", "Квартал", "Владелец", "Цель", "Описание", "База", "Целевое значение"],
      ...t.goals.map((g) => [`${base}-${g.number}`, quarter, person.fullName, g.title, g.description, g.base, g.target]),
    ];
    groups.push({ tab: t.tab, owner: t.owner, person, team, grid });
  }

  const plan: LeaderPlan & { rows: GoalsPlan["rows"] } = { quarter, add: [], change: [], same: 0, problems: [], rows: [], people: [], skipped };
  for (const g of groups) {
    const part = await planGoals(actor, g.grid, { team: g.team.id, quarter });
    plan.add.push(...part.add);
    plan.change.push(...part.change);
    plan.same += part.same;
    // Строка в проблеме: вкладка и номер цели, а не строка служебной таблицы
    plan.problems.push(...part.problems.map((p) => ({ line: p.line, text: `«${g.tab}», ${g.grid[p.line - 1]?.[0] ?? "цель"}: ${p.text}` })));
    plan.rows.push(...part.rows);
    plan.people.push({ tab: g.tab, owner: g.owner, person: g.person.fullName, team: g.team.name, goals: g.grid.length - 1 });
  }
  return plan;
}

export async function previewLeaderBoard(actor: Actor, tabs: Tab[], opts: { team: string; quarter?: string | null }): Promise<LeaderPlan> {
  const { rows: _rows, ...plan } = await buildPlan(actor, tabs, opts);
  return plan;
}

export async function applyLeaderBoard(actor: Actor, tabs: Tab[], opts: { team: string; quarter?: string | null; file?: string }) {
  const plan = await buildPlan(actor, tabs, opts);
  if (plan.problems.length) fail(`Цели не загрузить, база не тронута. Исправьте: ${plan.problems.slice(0, 5).map((p) => p.text).join("; ")}`);
  if (!plan.rows.length) fail(`В файле нет целей за ${quarterLabel(plan.quarter)}, которые можно загрузить`);
  const name = normName(opts.file ?? "").slice(0, 60) || "файл";
  return { ...(await applyPlan(actor, plan, `leader-board:${name}`)), people: plan.people.length, skipped: plan.skipped.length };
}
