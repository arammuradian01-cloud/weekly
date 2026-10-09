// Цели квартала из бордов лидеров на сервере (этап 31). Файл борда (.xlsx) читается в памяти и нигде не хранится:
// из него берутся только вкладки «Цели», из них только раздел квартала. Каждая цель становится личной целью
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
import { assignNumbers, codeBase, isGoalsTab, readLeaderBoard, titleKey, type Tab } from "./leader-board";
import { formatDate, formatNumber, unpackedSize } from "./xlsx-text";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

/** Файл борда не больше этого. Сервер принимает запрос до 10 МБ (proxyClientMaxBodySize), с запасом на форму */
export const LEADER_FILE_MAX = 9 * 1024 * 1024;
/** Распакованный файл не больше этого: защита от архива, который раздувается при распаковке */
const UNPACKED_MAX = 150 * 1024 * 1024;
/** Читаем не дальше этих строк и колонок вкладки: раздел квартала всегда в начале листа */
const MAX_ROWS = 3000;
const MAX_COLS = 60;
const QUARTER = /^\d{4}-Q[1-4]$/;

export type LeaderPerson = { tab: string; owner: string; person: string; team: string; goals: number };
export type LeaderPlan = Omit<GoalsPlan, "rows"> & { quarter: string; people: LeaderPerson[]; skipped: { tab: string; reason: string }[] };

/** Текст ячейки как на экране: формулы по результату, даты и проценты как в таблице. В объединённой ячейке текст
 *  у первой; ниже по той же колонке он повторяется (так направление видно у каждой цели), правее пусто */
function cellText(cell: ExcelJS.Cell): string {
  if (cell.isMerged && cell.master.address !== cell.address) return cell.master.col === cell.col ? cellText(cell.master) : "";
  const raw = cell.value as unknown;
  const value = raw && typeof raw === "object" && "result" in raw ? (raw as { result: unknown }).result : raw;
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "number") return formatNumber(value, cell.numFmt);
  return (cell.text ?? "").toString();
}

/** Вкладки .xlsx как таблицы текста. Ячейки читаются только у вкладок целей: листы с зарплатами и мотивацией
 *  остаются нетронутыми, у них только имя */
export async function tabsFromXlsx(data: ArrayBuffer): Promise<Tab[]> {
  if (data.byteLength > LEADER_FILE_MAX) fail("Файл больше 9 МБ: удалите из копии борда лишние вкладки и скачайте снова");
  const unpacked = unpackedSize(new Uint8Array(data));
  if (unpacked === null) fail(NOT_XLSX);
  if (unpacked! > UNPACKED_MAX) fail("Файл слишком большой после распаковки: удалите из копии борда лишние вкладки и скачайте снова");
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(data);
  } catch {
    fail(NOT_XLSX);
  }
  return book.worksheets.map((ws) => {
    if (!isGoalsTab(ws.name)) return { name: ws.name, grid: [] };
    const grid: string[][] = [];
    // Только строки и ячейки со значениями: пустой лист с одной ячейкой в миллионной строке не раздувает память
    ws.eachRow((row, n) => {
      if (n > MAX_ROWS) return;
      const cells: string[] = [];
      row.eachCell((cell, c) => {
        if (c <= MAX_COLS) cells[c - 1] = cellText(cell);
      });
      grid[n - 1] = Array.from(cells, (c) => c ?? "");
    });
    return { name: ws.name, grid: Array.from(grid, (r) => r ?? []) };
  });
}

const NOT_XLSX = "Файл не читается как .xlsx: скачайте борд из Google Таблиц через «Файл», «Скачать», «Microsoft Excel»";

/** Загружают владелец и администраторы в режиме управления. Проверка до чтения файла */
export function canLoadLeaderBoard(actor: Pick<Actor, "management" | "role">): boolean {
  return !!actor.management && actor.role !== "OBSERVER";
}

export const LEADER_MANAGE_ONLY = "Цели из бордов лидеров загружают владелец и администраторы в режиме управления";

function requireManage(actor: Actor) {
  if (!canLoadLeaderBoard(actor)) fail(LEADER_MANAGE_ONLY);
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

/** Код цели из борда: основа и номер, «РТ-1» или «Рева-2» */
const CODE = /^(.+)-(\d+)$/;

/** Основа кода похожа на основу этого человека: инициалы, фамилия, фамилия с инициалом, инициалы с цифрой */
function ownBases(fullName: string) {
  const first = codeBase(fullName, () => false);
  const words = fullName.trim().split(/\s+/);
  const surname = (words[0] ?? "").slice(0, 12);
  return (base: string) => base === first || base === surname || base === `${surname}${words[1]?.[0]?.toUpperCase() ?? ""}` || new RegExp(`^${first}\\d+$`).test(base);
}

/**
 * Что даст загрузка: по каждому человеку сколько целей и куда, что пропущено и почему, что новое и что изменится.
 * Цели человека, уже загруженные из борда, держат команду и основу кода: повторная загрузка находит их, даже если
 * человек сменил команду, выбрана другая команда по умолчанию или у одной из целей поменяли владельца
 */
async function buildPlan(actor: Actor, tabs: Tab[], opts: { team: string; quarter?: string | null }) {
  requireManage(actor);
  const quarter = opts.quarter && QUARTER.test(opts.quarter) ? opts.quarter : quarterOf(moscowToday());
  const parsed = readLeaderBoard(tabs, Number(quarter.slice(-1)), Number(quarter.slice(0, 4)));
  if (!parsed.length) fail("В файле нет вкладок, имя которых начинается с «Цели»");
  const nodes = await loadTeamNodes(prisma);
  const fallback = nodes.find((n) => n.id === opts.team && n.active) ?? fail("Выберите команду для людей, которые не состоят ни в одной команде");
  const people = await prisma.person.findMany({ where: { active: true, role: { not: "OBSERVER" } }, select: { id: true, fullName: true, shortName: true } });
  const index = new NameIndex(people);
  const existing = await prisma.goal.findMany({ where: { quarter }, select: { teamId: true, code: true, ownerId: true, source: true, title: true } });
  const fromBoard = (g: (typeof existing)[number]) => g.source.startsWith("leader-board:");

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
    // Прежние цели человека из борда этого квартала: их команда и основа кода. Групп несколько (у чужой цели сменили
    // владельца на этого человека): берём самую большую, при равенстве ту, где основа из его инициалов или фамилии
    const own = ownBases(person.fullName);
    const groupsOf = new Map<string, { teamId: string; base: string; size: number }>();
    for (const g of existing) {
      const base = g.code?.match(CODE)?.[1];
      if (g.ownerId !== person.id || !fromBoard(g) || !base || !nodes.some((n) => n.id === g.teamId && n.active)) continue;
      const key = `${g.teamId}/${base}`;
      groupsOf.set(key, { teamId: g.teamId, base, size: (groupsOf.get(key)?.size ?? 0) + 1 });
    }
    const score = (x: { base: string; size: number }) => x.size * 10 + (own(x.base) ? 5 : 0);
    const before = [...groupsOf.values()].sort((a, b) => score(b) - score(a))[0];
    const team = (before && nodes.find((n) => n.id === before.teamId)) || teamOf(nodes, person.id) || fallback;
    const takenByOther = (b: string) => taken.has(`${team.id}/${b}`) && taken.get(`${team.id}/${b}`) !== person.id;
    const clash = (b: string) => takenByOther(b) || existing.some((g) => g.teamId === team.id && g.code?.match(CODE)?.[1] === b && !(g.ownerId === person.id && fromBoard(g)));
    const base = before && !takenByOther(before.base) ? before.base : codeBase(person.fullName, clash);
    taken.set(`${team.id}/${base}`, person.id);
    const previous = new Map(
      existing
        .filter((g) => g.teamId === team.id && g.code?.match(CODE)?.[1] === base && fromBoard(g))
        .map((g) => [titleKey(g.title), Number(g.code!.match(CODE)![2])] as const),
    );
    const numbers = assignNumbers(t.goals, previous);
    const grid = [
      ["№", "Квартал", "Владелец", "Цель", "Описание", "База", "Целевое значение"],
      ...t.goals.map((g, i) => [`${base}-${numbers[i]}`, quarter, person.fullName, g.title, g.description, g.base, g.target]),
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
