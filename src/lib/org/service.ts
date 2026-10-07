// Структура департамента и команды (этап 14): загрузка структуры из таблицы, правка команд и состава.
// Структуру (подразделения, должности, руководителей) и команды правит только владелец в режиме управления
// (решение 8 по умолчанию). Руководитель команды сам добавляет и убирает участников своей команды из своей ветки.
// Каждая правка пишется в журнал: что было и что стало.

import { prisma } from "@/lib/db";
import type { Prisma, UnitKind } from "@/generated/prisma/client";
import { TaskRuleError, canSeeRow, type Actor } from "@/lib/tasks/service";
import { canManagePeople } from "@/lib/admin/service";
import { slugify, uniqueSlug } from "@/lib/translit";
import { normName } from "@/lib/bord/names";
import { TOP_TEAM, ancestorsOf, loadScope, loadTeamNodes, subtreeOf } from "./scope";
import { kindOfDepth, pathKey, plannedKey, planStructure, readStructureTable, type ExistingPerson, type StructurePlan } from "./import";
import { WEEKDAY_NAMES, isSlot, slotMoment, slotOf, slotText, type Slot } from "./rhythm";
import { getSetting } from "@/lib/settings";
import type { DeadlineSetting } from "@/lib/week";
import { deadlineOf, reportingKey } from "@/lib/weekly/weeks";

type Tx = Prisma.TransactionClient;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export const ROOT_UNIT_NAME = "Департамент страхования и инвестиций";
export const UNIT_KIND_LABELS: Record<UnitKind, string> = {
  DEPARTMENT: "Департамент",
  MANAGEMENT: "Управление",
  DIVISION: "Отдел",
  SECTOR: "Сектор",
  STREAM: "Направление",
  FUNCTION: "Функция",
  EXTERNAL: "Внешняя функция",
};
const LIMITS = { name: 120, position: 120, headNote: 200, file: 1_000_000 };

function requireOwner(actor: Actor) {
  if (!canManagePeople(actor)) fail("Структуру и команды меняет только владелец в режиме управления");
}

function text(value: string | null | undefined, max: number, emptyMessage: string, field: string): string {
  const v = (value ?? "").replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
  if (!v) fail(emptyMessage);
  if (v.length > max) fail(`${field} длиннее ${max} знаков`);
  return v;
}

async function audit(tx: Tx, actor: Actor, action: string, entity: string, entityId: string, field: string, before?: string | null, after?: string | null) {
  await tx.auditLog.create({
    data: {
      action,
      actorId: actor.personId,
      actorName: actor.fullName,
      source: "APP",
      entity,
      entityId,
      field,
      before: before ?? undefined,
      after: after ?? undefined,
      ip: actor.ip ?? null,
      via: actor.via ?? null,
    },
  });
}

// ---------- Подразделения ----------

type UnitRow = { id: string; name: string; kind: UnitKind; parentId: string | null; headId: string | null; active: boolean };

/** Путь подразделения без корня: «Управление развития продуктов / Отдел ... / Сектор ...». Корень: пустой путь */
function unitPaths(units: UnitRow[]): Map<string, string[]> {
  const byId = new Map(units.map((u) => [u.id, u]));
  const out = new Map<string, string[]>();
  for (const u of units) {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur: UnitRow | undefined = u;
    while (cur && !seen.has(cur.id) && cur.kind !== "DEPARTMENT") {
      chain.unshift(cur.name);
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    out.set(u.id, chain);
  }
  return out;
}

async function rootUnit(tx: Tx): Promise<UnitRow> {
  const found = await tx.orgUnit.findFirst({ where: { kind: "DEPARTMENT" }, orderBy: { createdAt: "asc" } });
  if (found) return found;
  const owner = await tx.person.findFirst({ where: { role: "OWNER", active: true }, orderBy: { sortOrder: "asc" } });
  return tx.orgUnit.create({ data: { name: ROOT_UNIT_NAME, kind: "DEPARTMENT", headId: owner?.id ?? null } });
}

async function existingPeople(tx: Tx, paths: Map<string, string[]>): Promise<ExistingPerson[]> {
  const people = await tx.person.findMany({
    include: { manager: { select: { fullName: true } }, functionalManager: { select: { fullName: true } } },
    orderBy: [{ sortOrder: "asc" }],
  });
  return people.map((p) => ({
    id: p.id,
    slug: p.slug,
    fullName: p.fullName,
    shortName: p.shortName,
    position: p.position,
    unitPath: p.unitId ? pathKey(paths.get(p.unitId) ?? []) : null,
    manager: p.manager?.fullName ?? null,
    managerId: p.managerId,
    functional: p.functionalManager?.fullName ?? null,
    functionalId: p.functionalManagerId,
    email: p.email,
    active: p.active,
  }));
}

async function planFor(tx: Tx, fileText: string): Promise<StructurePlan> {
  if (!fileText.trim()) fail("Выберите файл со структурой или вставьте ячейки из таблицы");
  if (fileText.length > LIMITS.file) fail("Файл больше 1 МБ: выгрузите только лист со структурой");
  const units = await tx.orgUnit.findMany({ where: { active: true } });
  const paths = unitPaths(units);
  const { rows, problems } = readStructureTable(fileText);
  if (!rows.length && !problems.length) fail("В файле нет строк с людьми");
  const existing = units.filter((u) => u.kind !== "DEPARTMENT").map((u) => paths.get(u.id) ?? []);
  return planStructure(rows, problems, existing, await existingPeople(tx, paths));
}

/** Предпросмотр загрузки: что добавится, изменится и уйдёт. В базе ничего не меняется */
export async function previewStructure(actor: Actor, fileText: string): Promise<StructurePlan> {
  requireOwner(actor);
  return prisma.$transaction((tx) => planFor(tx, fileText));
}

export type StructureResult = { units: number; added: number; changed: number; teams: number; members: number; vacancies: number };

/**
 * Загрузка структуры. Ничего не удаляется: подразделения, которых нет в файле, выключаются, людей, которых нет в файле,
 * ресурс не выключает (у них могут быть задачи), а только показывает владельцу. Команды руководителей подразделений
 * создаются сами, если их ещё нет; в существующие команды добавляются новые прямые подчинённые, ручной состав не трогается
 */
export async function applyStructure(actor: Actor, fileText: string): Promise<StructureResult> {
  requireOwner(actor);
  return prisma.$transaction(
    async (tx) => {
      const plan = await planFor(tx, fileText);
      if (plan.problems.length) fail(`Структуру не загрузить, база не тронута. Исправьте в файле: ${plan.problems.slice(0, 5).map((p) => `строка ${p.line}: ${p.text}`).join("; ")}`);
      const root = await rootUnit(tx);
      const units = await tx.orgUnit.findMany();
      const paths = unitPaths(units);
      const byPath = new Map<string, string>();
      for (const u of units) if (u.kind !== "DEPARTMENT" && u.active) byPath.set(pathKey(paths.get(u.id) ?? []), u.id);
      let unitsCreated = 0;
      // Подразделения из файла вместе со всеми подразделениями выше: остальные после загрузки выключаются
      const used = new Set<string>([root.id]);
      const unitOf = async (path: string[]): Promise<string> => {
        if (!path.length) return root.id;
        const key = pathKey(path);
        let id = byPath.get(key);
        if (!id) {
          const parentId = await unitOf(path.slice(0, -1));
          const sortOrder = (await tx.orgUnit.count({ where: { parentId } })) * 10 + 10;
          const created = await tx.orgUnit.create({ data: { name: path.at(-1)!, kind: kindOfDepth(path.length - 1, path.at(-1)), parentId, sortOrder } });
          byPath.set(key, created.id);
          unitsCreated += 1;
          await audit(tx, actor, "structure.unit.create", "unit", created.id, "Подразделение добавлено", null, path.join(" / "));
          id = created.id;
        } else {
          await unitOf(path.slice(0, -1));
        }
        used.add(id);
        return id;
      };

      // Люди: новые заводятся сотрудниками, у известных обновляются должность, подразделение и почта
      const fallback = await tx.dictionaryItem.findFirst({ where: { kind: "DIRECTION", code: "department" } });
      if (!fallback) fail("В справочнике нет направления «Департамент»: сначала запустите сид");
      const all = await tx.person.findMany({ select: { id: true, slug: true, sortOrder: true, email: true, fullName: true } });
      const taken = new Set([...all.map((p) => p.slug), "all", "system"]);
      let sortOrder = Math.max(0, ...all.map((p) => p.sortOrder));
      /** «file:строка» новых людей в их id после создания */
      const idOfKey = new Map<string, string>();
      const planned = [] as { id: string; head: boolean; unitId: string; managerKey: string | null; functionalKey: string | null; fullName: string }[];
      let added = 0;
      for (const p of plan.planned) {
        const unitId = await unitOf(p.path);
        const email = p.email && !all.some((x) => x.email === p.email && x.id !== p.id) ? p.email : null;
        let id = p.id;
        if (!id) {
          const slug = uniqueSlug(slugify(p.fullName.split(" ")[0] ?? p.fullName, 24), taken);
          taken.add(slug);
          sortOrder += 10;
          const unitName = p.path.at(-1) ?? ROOT_UNIT_NAME;
          const created = await tx.person.create({
            data: { slug, fullName: p.fullName, shortName: p.shortName, role: "EMPLOYEE", zone: unitName.slice(0, 120), defaultDirectionId: fallback!.id, sortOrder, active: true, position: p.position || null, unitId, email },
          });
          id = created.id;
          added += 1;
          await audit(tx, actor, "structure.person.create", "person", slug, "Сотрудник добавлен из структуры", null, [p.fullName, p.position, p.path.join(" / ")].filter(Boolean).join(", "));
        } else if (p.changes.length) {
          await tx.person.update({ where: { id }, data: { position: p.position || null, unitId, active: true, ...(email ? { email } : {}) } });
          const slug = all.find((x) => x.id === id)?.slug ?? id;
          await audit(tx, actor, "structure.person.update", "person", slug, "Структура: изменения", null, p.changes.join("; "));
        }
        idOfKey.set(plannedKey(p), id);
        planned.push({ id, head: p.head, unitId, managerKey: p.managerKey, functionalKey: p.functionalKey, fullName: p.fullName });
      }
      const resolve = (key: string | null) => (key ? (idOfKey.get(key) ?? key) : null);

      // Руководители подразделений по колонке «Руководит». У подразделений из файла без такой строки руководитель снимается
      const headOfUnit = new Map(planned.filter((x) => x.head).map((x) => [x.unitId, x]));
      for (const unitId of used) {
        if (unitId === root.id) continue;
        const unit = await tx.orgUnit.findUniqueOrThrow({ where: { id: unitId }, include: { head: true } });
        const head = headOfUnit.get(unitId);
        if ((head?.id ?? null) === unit.headId) continue;
        await tx.orgUnit.update({ where: { id: unit.id }, data: { headId: head?.id ?? null, ...(head ? { headNote: null } : {}) } });
        await audit(tx, actor, "structure.unit.head", "unit", unit.id, `Руководитель: ${unit.name}`, unit.head?.fullName ?? "не выделен", head?.fullName ?? "не выделен");
      }

      // Административные и функциональные руководители. Пусто: руководитель своего подразделения или подразделения выше
      const unitRows = await tx.orgUnit.findMany();
      const unitById = new Map(unitRows.map((u) => [u.id, u]));
      const headAbove = (unitId: string, self: string): string | null => {
        let cur = unitById.get(unitId);
        const seen = new Set<string>();
        while (cur && !seen.has(cur.id)) {
          seen.add(cur.id);
          if (cur.headId && cur.headId !== self) return cur.headId;
          cur = cur.parentId ? unitById.get(cur.parentId) : undefined;
        }
        return null;
      };
      for (const p of planned) {
        const managerId = p.managerKey ? resolve(p.managerKey) : headAbove(p.unitId, p.id);
        const functionalId = resolve(p.functionalKey);
        const current = await tx.person.findUniqueOrThrow({ where: { id: p.id }, select: { managerId: true, functionalManagerId: true } });
        const data: Prisma.PersonUncheckedUpdateInput = {};
        if (managerId !== current.managerId && managerId !== p.id) data.managerId = managerId;
        if (functionalId !== current.functionalManagerId && functionalId !== p.id) data.functionalManagerId = functionalId;
        if (Object.keys(data).length) await tx.person.update({ where: { id: p.id }, data });
      }
      // Руководитель, назначенный по подразделению, мог замкнуть петлю: тогда загрузка откатывается целиком
      const chain = await tx.person.findMany({ where: { active: true }, select: { id: true, fullName: true, managerId: true } });
      const managerOf = new Map(chain.map((x) => [x.id, x.managerId]));
      for (const x of chain) {
        const seen = new Set<string>([x.id]);
        let cur = x.managerId;
        while (cur) {
          if (seen.has(cur)) fail(`Структуру не загрузить, база не тронута: петля подчинения у ${x.fullName}. Проверьте колонки «Руководитель» и «Руководит»`);
          seen.add(cur);
          cur = managerOf.get(cur) ?? null;
        }
      }

      // Подразделения, которых нет в файле, выключаются. Люди и команды в них остаются
      for (const u of unitRows) {
        if (u.kind === "DEPARTMENT" || !u.active || used.has(u.id)) continue;
        await tx.orgUnit.update({ where: { id: u.id }, data: { active: false } });
        await audit(tx, actor, "structure.unit.off", "unit", u.id, "Подразделение выключено: его нет в загруженной структуре", u.name, null);
      }

      // Вакансии: открытые заменяются вакансиями из файла
      await tx.vacancy.updateMany({ where: { closedAt: null }, data: { closedAt: new Date() } });
      for (const v of plan.vacancies) await tx.vacancy.create({ data: { unitId: await unitOf(v.path), position: v.position } });

      const { teams, members } = await syncUnitTeams(tx, actor);
      await audit(tx, actor, "structure.import", "structure", "import", "Структура загружена", null, `людей ${plan.planned.length}: новых ${added}, изменено ${plan.people.change.length}; подразделений новых ${unitsCreated}; вакансий ${plan.vacancies.length}`);
      return { units: unitsCreated, added, changed: plan.people.change.length, teams, members, vacancies: plan.vacancies.length };
    },
    { timeout: 60_000 },
  );
}

/**
 * Команды руководителей по структуре. У каждого, у кого есть прямые подчинённые, своя команда:
 * - руководитель подразделения: команда подразделения. Сменился руководитель подразделения: у той же команды
 *   меняется руководитель, новая команда не появляется, прежний руководитель теряет права на её задачи;
 * - остальные руководители (например, ведущий разработчик в отделе): команда по имени и должности;
 * - владелец: его команда топ-команда, а прямые подчинённые не из топ-команды попадают в команду «Прямые подчинённые».
 * Участники по структуре (auto) пересчитываются: новые прямые подчинённые добавляются, ушедшие убираются.
 * Участники, добавленные руками, не трогаются. Команда, которую владелец выключил, заново не создаётся.
 * Команда выше пересчитывается, если владелец не ставил её руками
 */
export async function syncUnitTeams(tx: Tx, actor: Actor): Promise<{ teams: number; members: number }> {
  const top = await tx.team.findUnique({ where: { id: TOP_TEAM }, include: { members: { select: { personId: true } } } });
  const topIds = new Set([...(top?.leaderId ? [top.leaderId] : []), ...(top?.members.map((m) => m.personId) ?? [])]);
  const people = await tx.person.findMany({
    where: { active: true },
    select: { id: true, fullName: true, position: true, managerId: true, role: true, headOf: { where: { active: true, kind: { not: "DEPARTMENT" } }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } } },
    orderBy: [{ sortOrder: "asc" }, { fullName: "asc" }],
  });
  const reportsOf = new Map<string, string[]>();
  for (const p of people) {
    if (!p.managerId || p.role === "OBSERVER") continue;
    reportsOf.set(p.managerId, [...(reportsOf.get(p.managerId) ?? []), p.id]);
  }
  const ownerId = top?.leaderId ?? null;
  /** Кого держать в команде руководителя по структуре. У владельца: прямые подчинённые не из топ-команды */
  const desiredFor = (leaderId: string) => (reportsOf.get(leaderId) ?? []).filter((id) => id !== leaderId && (leaderId !== ownerId || !topIds.has(id)));

  const teams = await tx.team.findMany({ where: { kind: "UNIT" }, orderBy: [{ createdAt: "asc" }] });
  const activeUnits = new Set((await tx.orgUnit.findMany({ where: { active: true }, select: { id: true } })).map((u) => u.id));
  let createdTeams = 0;
  let addedMembers = 0;
  for (const m of people) {
    if (m.role === "OBSERVER") continue;
    const headed = m.id === ownerId ? null : (m.headOf[0] ?? null);
    // Без прямых подчинённых команду не заводим. Но у руководителя подразделения с уже заведённой командой
    // её переименование и смена руководителя всё равно отрабатывают
    if (!desiredFor(m.id).length && !(headed && teams.some((t) => t.unitId === headed.id || t.leaderId === m.id))) continue;
    let team =
      (headed && teams.find((t) => t.unitId === headed.id)) ||
      // Подразделение переименовали или перенесли: его прежняя команда переходит на новое подразделение
      (headed && teams.find((t) => t.leaderId === m.id && t.unitId && !activeUnits.has(t.unitId))) ||
      teams.find((t) => t.leaderId === m.id && !t.unitId) ||
      (headed ? undefined : teams.find((t) => t.leaderId === m.id));
    if (team && !team.active) continue;
    if (team && headed && team.unitId !== headed.id) {
      await tx.team.update({ where: { id: team.id }, data: { unitId: headed.id, name: headed.name.slice(0, 120) } });
      await audit(tx, actor, "team.update", "team", team.id, "Команда перешла на подразделение", team.name, headed.name);
      team.unitId = headed.id;
      team.name = headed.name;
    }
    if (team && team.leaderId !== m.id) {
      const before = team.leaderId ? people.find((p) => p.id === team!.leaderId)?.fullName ?? "другой человек" : "не назначен";
      await tx.team.update({ where: { id: team.id }, data: { leaderId: m.id } });
      await tx.teamMember.deleteMany({ where: { teamId: team.id, personId: m.id } });
      await audit(tx, actor, "team.update", "team", team.id, `Руководитель по структуре: ${team.name}`, before, m.fullName);
      team.leaderId = m.id;
    }
    if (!team) {
      const name = (m.id === ownerId ? `Прямые подчинённые: ${m.fullName}` : (headed?.name ?? (m.position ? `${m.fullName}, ${m.position}` : `Команда: ${m.fullName}`))).slice(0, 120);
      team = await tx.team.create({ data: { name, kind: "UNIT", leaderId: m.id, unitId: headed?.id ?? null, sortOrder: (teams.length + createdTeams + 1) * 10, parentId: m.id === ownerId ? TOP_TEAM : null } });
      teams.push(team);
      createdTeams += 1;
      await audit(tx, actor, "team.create", "team", team.id, "Команда создана по структуре", null, `${name}, руководитель ${m.fullName}`);
    }
  }

  // Участники по структуре во всех командах руководителей
  for (const t of teams) {
    if (!t.active || !t.leaderId) continue;
    const desired = new Set(desiredFor(t.leaderId));
    const current = await tx.teamMember.findMany({ where: { teamId: t.id } });
    const have = new Set(current.map((x) => x.personId));
    const fresh = [...desired].filter((id) => !have.has(id));
    if (fresh.length) {
      await tx.teamMember.createMany({ data: fresh.map((personId) => ({ teamId: t.id, personId, addedById: actor.personId, auto: true })), skipDuplicates: true });
      addedMembers += fresh.length;
    }
    const gone = current.filter((x) => x.auto && !desired.has(x.personId)).map((x) => x.personId);
    if (gone.length) await tx.teamMember.deleteMany({ where: { teamId: t.id, personId: { in: gone } } });
  }

  // Команда выше: команда руководителя руководителя, иначе топ-команда. Поставленную руками не трогаем
  const nodes = await loadTeamNodes(tx);
  const teamOfLeader = new Map<string, string>();
  for (const t of teams) if (t.active && t.leaderId && !teamOfLeader.has(t.leaderId) && t.unitId) teamOfLeader.set(t.leaderId, t.id);
  for (const t of teams) if (t.active && t.leaderId && !teamOfLeader.has(t.leaderId)) teamOfLeader.set(t.leaderId, t.id);
  for (const t of teams) {
    if (!t.active || t.parentManual || !t.leaderId) continue;
    const managerId = people.find((p) => p.id === t.leaderId)?.managerId ?? null;
    let parentId = (managerId && managerId !== ownerId && teamOfLeader.get(managerId)) || TOP_TEAM;
    // Петля в дереве команд невозможна, но на всякий случай: команда не встаёт ниже самой себя
    if (subtreeOf(nodes, t.id).includes(parentId)) parentId = TOP_TEAM;
    if (parentId !== t.parentId && parentId !== t.id) {
      await tx.team.update({ where: { id: t.id }, data: { parentId } });
      const n = nodes.find((x) => x.id === t.id);
      if (n) n.parentId = parentId;
    }
  }
  return { teams: createdTeams, members: addedMembers };
}

// ---------- Команды ----------

async function teamOrFail(tx: Tx, id: string) {
  return (await tx.team.findUnique({ where: { id }, include: { leader: true } })) ?? fail("Такой команды нет");
}

async function personBySlug(tx: Tx, slug: string) {
  return (await tx.person.findUnique({ where: { slug } })) ?? fail("Такого человека нет");
}

export type TeamInput = { name?: string; leader?: string | null; parent?: string | null; active?: boolean };

export async function createTeam(actor: Actor, input: TeamInput): Promise<{ id: string }> {
  requireOwner(actor);
  const name = text(input.name, LIMITS.name, "Напишите название команды", "Название");
  return prisma.$transaction(async (tx) => {
    const leader = input.leader ? await personBySlug(tx, input.leader) : null;
    if (leader && !leader.active) fail("Руководитель выключен");
    const parentId = input.parent ? (await teamOrFail(tx, input.parent)).id : TOP_TEAM;
    const count = await tx.team.count();
    const team = await tx.team.create({ data: { name, kind: "CUSTOM", leaderId: leader?.id ?? null, parentId, sortOrder: (count + 1) * 10 } });
    await audit(tx, actor, "team.create", "team", team.id, "Команда создана", null, `${name}${leader ? `, руководитель ${leader.fullName}` : ""}`);
    return { id: team.id };
  });
}

export async function updateTeam(actor: Actor, id: string, input: TeamInput): Promise<void> {
  requireOwner(actor);
  await prisma.$transaction(async (tx) => {
    const team = await teamOrFail(tx, id);
    const data: Prisma.TeamUncheckedUpdateInput = {};
    if (input.name !== undefined) {
      const name = text(input.name, LIMITS.name, "Напишите название команды", "Название");
      if (name !== team.name) {
        data.name = name;
        await audit(tx, actor, "team.update", "team", id, "Название команды", team.name, name);
      }
    }
    if (input.leader !== undefined) {
      const leader = input.leader ? await personBySlug(tx, input.leader) : null;
      if (id === TOP_TEAM && (!leader || leader.role !== "OWNER")) fail("Топ-командой руководит владелец ресурса");
      if (leader && !leader.active) fail("Руководитель выключен");
      if ((leader?.id ?? null) !== team.leaderId) {
        data.leaderId = leader?.id ?? null;
        // Новый руководитель не числится участником своей же команды
        if (leader) await tx.teamMember.deleteMany({ where: { teamId: id, personId: leader.id } });
        await audit(tx, actor, "team.update", "team", id, `Руководитель: ${team.name}`, team.leader?.fullName ?? "не назначен", leader?.fullName ?? "не назначен");
      }
    }
    if (input.parent !== undefined) {
      if (id === TOP_TEAM) fail("Топ-команда стоит на самом верху");
      const parentId = input.parent || TOP_TEAM;
      if (parentId !== team.parentId) {
        const nodes = await loadTeamNodes(tx);
        if (subtreeOf(nodes, id).includes(parentId)) fail("Команда не может стоять ниже своей же команды");
        const parent = await teamOrFail(tx, parentId);
        data.parentId = parentId;
        // Поставлено руками: загрузка структуры эту связь больше не пересчитывает
        data.parentManual = true;
        const before = team.parentId ? nodes.find((n) => n.id === team.parentId)?.name : "нет";
        await audit(tx, actor, "team.update", "team", id, `Команда выше: ${team.name}`, before ?? "нет", parent.name);
      }
    }
    if (input.active !== undefined && input.active !== team.active) {
      if (id === TOP_TEAM) fail("Топ-команду выключить нельзя");
      if (!input.active) {
        const open = await tx.task.count({ where: { teamId: id, status: { in: ["IN_PROGRESS", "CLARIFY", "PROPOSED"] }, archivedAt: null } });
        if (open) fail(`У команды ${open} открытых задач: сначала передайте их в другую команду или закройте`);
      }
      data.active = input.active;
      await audit(tx, actor, input.active ? "team.on" : "team.off", "team", id, `Команда ${input.active ? "включена" : "выключена"}: ${team.name}`, null, null);
    }
    if (!Object.keys(data).length) fail("Ничего не изменилось");
    await tx.team.update({ where: { id }, data });
  });
}

/**
 * Кого руководитель команды может добавить сам: людей из своей ветки структуры (прямые и непрямые подчинённые)
 * и участников команд ниже своих. Остальных добавляет владелец
 */
async function canLeaderAdd(tx: Tx, leaderId: string, personId: string): Promise<boolean> {
  const seen = new Set<string>();
  let cur = await tx.person.findUnique({ where: { id: personId }, select: { id: true, managerId: true } });
  while (cur?.managerId && !seen.has(cur.managerId)) {
    if (cur.managerId === leaderId) return true;
    seen.add(cur.managerId);
    cur = await tx.person.findUnique({ where: { id: cur.managerId }, select: { id: true, managerId: true } });
  }
  const nodes = await loadTeamNodes(tx);
  const led = nodes.filter((n) => n.leaderId === leaderId && n.id !== TOP_TEAM).flatMap((n) => subtreeOf(nodes, n.id));
  return nodes.some((n) => led.includes(n.id) && (n.members.includes(personId) || n.leaderId === personId));
}

/** Общий логин team без режима управления: им пользуется вся топ-команда, поэтому командами через него не управляют */
const teamLogin = (actor: Actor) => actor.via === "TEAM" && !actor.management;

async function requireTeamEditor(tx: Tx, actor: Actor, teamId: string) {
  const team = await teamOrFail(tx, teamId);
  if (canManagePeople(actor)) return { team, owner: true };
  if (actor.role === "OBSERVER") fail("Наблюдатель команды не меняет");
  if (teamLogin(actor)) fail("Состав команды руководитель меняет, войдя по личной ссылке");
  if (team.id !== TOP_TEAM && team.leaderId === actor.personId) return { team, owner: false };
  return fail("Состав команды меняют её руководитель и владелец в режиме управления");
}

export async function addTeamMember(actor: Actor, teamId: string, slug: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { team, owner } = await requireTeamEditor(tx, actor, teamId);
    const person = await personBySlug(tx, slug);
    if (!person.active) fail(`${person.fullName} выключен`);
    if (person.role === "OBSERVER") fail("Наблюдатель в командах не состоит");
    if (team.leaderId === person.id) fail(`${person.fullName} руководит этой командой`);
    if (!owner && !(await canLeaderAdd(tx, actor.personId, person.id))) fail(`${person.fullName} не из вашей ветки: попросите владельца добавить его`);
    const exists = await tx.teamMember.findUnique({ where: { teamId_personId: { teamId, personId: person.id } } });
    if (exists) fail(`${person.fullName} уже в команде`);
    await tx.teamMember.create({ data: { teamId, personId: person.id, addedById: actor.personId } });
    await audit(tx, actor, "team.member.add", "team", teamId, `Участник добавлен: ${team.name}`, null, person.fullName);
  });
}

export async function removeTeamMember(actor: Actor, teamId: string, slug: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { team } = await requireTeamEditor(tx, actor, teamId);
    const person = await personBySlug(tx, slug);
    const deleted = await tx.teamMember.deleteMany({ where: { teamId, personId: person.id } });
    if (!deleted.count) fail(`${person.fullName} не в этой команде`);
    // Задачи человека остаются в команде: их видит руководитель, ответственного меняют обычной правкой
    await audit(tx, actor, "team.member.remove", "team", teamId, `Участник убран: ${team.name}`, person.fullName, null);
  });
}

/** Перенести задачу в другую команду: владелец, администратор в режиме управления или руководитель обеих команд */
export async function moveTask(actor: Actor, number: number, teamId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "tasks" WHERE "number" = ${number} FOR UPDATE`;
    const task = await tx.task.findUnique({ where: { number }, include: { coExecutors: { select: { personId: true } } } });
    const scope = await loadScope(tx, { id: actor.personId, role: actor.role, limited: teamLogin(actor) });
    // Сначала права: чужой задаче и чужой команде ответ один и тот же, номер и команда не подтверждаются
    if (!task || !canSeeRow(scope, task, actor.personId)) return fail(`Задачи ${number} нет`);
    const leads = new Set(scope.leads);
    const allowed = actor.role !== "OBSERVER" && (actor.management !== null || (leads.has(task.teamId) && leads.has(teamId)));
    if (!allowed) fail("Задачу между командами переносит руководитель обеих команд или режим управления");
    if (task.archivedAt) fail(`Задача ${number} в архиве`);
    const target = await teamOrFail(tx, teamId);
    if (!target.active) fail("Команда выключена");
    if (task.teamId === teamId) fail("Задача уже в этой команде");
    if (task.ownerAll && teamId !== TOP_TEAM) fail("«Все лидеры» бывают только у задач топ-команды: сначала назначьте ответственного");
    const nodes = await loadTeamNodes(tx);
    const from = nodes.find((n) => n.id === task.teamId)?.name ?? task.teamId;
    await tx.task.update({ where: { id: task.id }, data: { teamId } });
    await tx.auditLog.create({
      data: { action: "task.update", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "task", entityId: String(number), field: "Команда", before: from, after: target.name, ip: actor.ip ?? null, via: actor.via ?? null },
    });
  });
}

// ---------- Люди в структуре ----------

export type PersonOrgInput = { position?: string | null; unit?: string | null; manager?: string | null; functional?: string | null };

export async function setPersonOrg(actor: Actor, slug: string, input: PersonOrgInput): Promise<void> {
  requireOwner(actor);
  await prisma.$transaction(async (tx) => {
    const p = await tx.person.findUnique({ where: { slug }, include: { unit: true, manager: true, functionalManager: true } });
    if (!p) fail("Такого человека нет");
    const person = p!;
    const data: Prisma.PersonUncheckedUpdateInput = {};
    const changes: [string, string | null, string | null][] = [];
    if (input.position !== undefined) {
      const position = (input.position ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS.position) || null;
      if (position !== person.position) {
        data.position = position;
        changes.push(["Должность", person.position, position]);
      }
    }
    if (input.unit !== undefined) {
      const unit = input.unit ? ((await tx.orgUnit.findUnique({ where: { id: input.unit } })) ?? fail("Такого подразделения нет")) : null;
      if ((unit?.id ?? null) !== person.unitId) {
        data.unitId = unit?.id ?? null;
        changes.push(["Подразделение", person.unit?.name ?? null, unit?.name ?? null]);
      }
    }
    for (const [key, field, label] of [
      ["manager", "managerId", "Руководитель"],
      ["functional", "functionalManagerId", "Функциональный руководитель"],
    ] as const) {
      const value = input[key];
      if (value === undefined) continue;
      const target = value ? await personBySlug(tx, value) : null;
      if (target?.id === person.id) fail("Человек не может быть руководителем самому себе");
      const current = key === "manager" ? person.manager : person.functionalManager;
      if ((target?.id ?? null) !== (current?.id ?? null)) {
        if (key === "manager" && target) {
          // Петля подчинения: руководитель не может подчиняться своему же подчинённому
          let cur: { id: string; managerId: string | null } | null = target;
          const seen = new Set<string>();
          while (cur?.managerId && !seen.has(cur.managerId)) {
            if (cur.managerId === person.id) fail(`${target.fullName} уже подчиняется ${person.fullName}`);
            seen.add(cur.managerId);
            cur = await tx.person.findUnique({ where: { id: cur.managerId }, select: { id: true, managerId: true } });
          }
        }
        data[field] = target?.id ?? null;
        changes.push([label, current?.fullName ?? null, target?.fullName ?? null]);
      }
    }
    if (!changes.length) fail("Ничего не изменилось");
    await tx.person.update({ where: { id: person.id }, data });
    for (const [field, before, after] of changes) await audit(tx, actor, "structure.person.update", "person", slug, field, before ?? "нет", after ?? "нет");
  });
}

export type UnitInput = { name?: string; kind?: UnitKind; parent?: string | null; head?: string | null; headNote?: string | null; active?: boolean };

export async function updateUnit(actor: Actor, id: string, input: UnitInput): Promise<void> {
  requireOwner(actor);
  await prisma.$transaction(async (tx) => {
    const unit = (await tx.orgUnit.findUnique({ where: { id }, include: { head: true } })) ?? fail("Такого подразделения нет");
    const data: Prisma.OrgUnitUncheckedUpdateInput = {};
    const log: [string, string | null, string | null][] = [];
    if (input.name !== undefined) {
      const name = text(input.name, LIMITS.name, "Напишите название подразделения", "Название");
      if (name !== unit.name) {
        data.name = name;
        log.push(["Название подразделения", unit.name, name]);
      }
    }
    if (input.kind !== undefined && input.kind !== unit.kind) {
      if (unit.kind === "DEPARTMENT" || input.kind === "DEPARTMENT") fail("Корень структуры один: департамент");
      data.kind = input.kind;
      log.push(["Уровень", UNIT_KIND_LABELS[unit.kind], UNIT_KIND_LABELS[input.kind]]);
    }
    if (input.parent !== undefined) {
      if (unit.kind === "DEPARTMENT") fail("Департамент стоит на самом верху");
      const parent = input.parent ? ((await tx.orgUnit.findUnique({ where: { id: input.parent } })) ?? fail("Такого подразделения нет")) : await rootUnit(tx);
      if (parent.id !== unit.parentId) {
        const all = await tx.orgUnit.findMany({ select: { id: true, parentId: true } });
        let cur: { id: string; parentId: string | null } | undefined = all.find((u) => u.id === parent.id);
        const seen = new Set<string>();
        while (cur && !seen.has(cur.id)) {
          if (cur.id === unit.id) fail("Подразделение не может стоять внутри самого себя");
          seen.add(cur.id);
          cur = cur.parentId ? all.find((u) => u.id === cur!.parentId) : undefined;
        }
        data.parentId = parent.id;
        log.push(["Подразделение выше", null, parent.name]);
      }
    }
    if (input.head !== undefined) {
      const head = input.head ? await personBySlug(tx, input.head) : null;
      if ((head?.id ?? null) !== unit.headId) {
        data.headId = head?.id ?? null;
        log.push([`Руководитель: ${unit.name}`, unit.head?.fullName ?? "не выделен", head?.fullName ?? "не выделен"]);
      }
    }
    if (input.headNote !== undefined) {
      const note = (input.headNote ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS.headNote) || null;
      if (note !== unit.headNote) {
        data.headNote = note;
        log.push(["Пометка о руководителе", unit.headNote, note]);
      }
    }
    if (input.active !== undefined && input.active !== unit.active) {
      if (unit.kind === "DEPARTMENT") fail("Департамент выключить нельзя");
      data.active = input.active;
      log.push([`Подразделение ${input.active ? "включено" : "выключено"}`, null, unit.name]);
    }
    if (!log.length) fail("Ничего не изменилось");
    await tx.orgUnit.update({ where: { id }, data });
    for (const [field, before, after] of log) await audit(tx, actor, "structure.unit.update", "unit", id, field, before, after);
  });
}

export async function createUnit(actor: Actor, input: { name: string; kind: UnitKind; parent?: string | null }): Promise<{ id: string }> {
  requireOwner(actor);
  const name = text(input.name, LIMITS.name, "Напишите название подразделения", "Название");
  if (!(input.kind in UNIT_KIND_LABELS) || input.kind === "DEPARTMENT") fail("Выберите уровень подразделения");
  return prisma.$transaction(async (tx) => {
    const parent = input.parent ? ((await tx.orgUnit.findUnique({ where: { id: input.parent } })) ?? fail("Такого подразделения нет")) : await rootUnit(tx);
    const count = await tx.orgUnit.count({ where: { parentId: parent.id } });
    const unit = await tx.orgUnit.create({ data: { name, kind: input.kind, parentId: parent.id, sortOrder: (count + 1) * 10 } });
    await audit(tx, actor, "structure.unit.create", "unit", unit.id, "Подразделение добавлено", null, `${UNIT_KIND_LABELS[input.kind]}: ${name}`);
    return { id: unit.id };
  });
}

/** Создать недостающие команды руководителей подразделений вручную, без загрузки файла */
export async function syncTeams(actor: Actor): Promise<{ teams: number; members: number }> {
  requireOwner(actor);
  return prisma.$transaction((tx) => syncUnitTeams(tx, actor));
}

export { ancestorsOf };

/**
 * Кого можно добавить в команду: владельцу в режиме управления все включённые люди, кроме наблюдателей;
 * руководителю: люди его ветки структуры и участники его команд ниже
 */
export async function memberCandidates(actor: Actor): Promise<{ slug: string; fullName: string; position: string | null }[]> {
  const people = await prisma.person.findMany({
    where: { active: true, role: { not: "OBSERVER" } },
    orderBy: [{ sortOrder: "asc" }, { fullName: "asc" }],
    select: { id: true, slug: true, fullName: true, position: true, managerId: true },
  });
  if (canManagePeople(actor)) return people.map(({ slug, fullName, position }) => ({ slug, fullName, position }));
  if (actor.role === "OBSERVER" || teamLogin(actor)) return [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const underMe = (id: string) => {
    const seen = new Set<string>();
    let cur = byId.get(id);
    while (cur?.managerId && !seen.has(cur.managerId)) {
      if (cur.managerId === actor.personId) return true;
      seen.add(cur.managerId);
      cur = byId.get(cur.managerId);
    }
    return false;
  };
  const nodes = await loadTeamNodes(prisma);
  const led = new Set(nodes.filter((n) => n.leaderId === actor.personId && n.id !== TOP_TEAM).flatMap((n) => subtreeOf(nodes, n.id)));
  const inLed = new Set(nodes.filter((n) => led.has(n.id)).flatMap((n) => [...n.members, ...(n.leaderId ? [n.leaderId] : [])]));
  return people.filter((p) => p.id !== actor.personId && (underMe(p.id) || inLed.has(p.id))).map(({ slug, fullName, position }) => ({ slug, fullName, position }));
}

// ---------- Ритм weekly команды (этап 15) ----------

export type RhythmInput = { deadline: Slot | null; meeting: Slot | null; specialists: boolean };

const describeSlot = (slot: Slot | null, fallback: string) => (slot ? slotText(slot) : fallback);

/**
 * Срок сдачи, встреча и кто сдаёт weekly в команде. Задаёт руководитель команды или руководитель выше, владелец
 * в режиме управления любой команде. Срок команды не позже срока департамента, встреча не раньше срока команды
 */
export async function setTeamRhythm(actor: Actor, teamId: string, input: RhythmInput): Promise<void> {
  if (teamId === TOP_TEAM) fail("Срок и встреча топ-команды это срок и встреча департамента: они в настройках недели");
  if (input.deadline !== null && !isSlot(input.deadline)) fail("Выберите неделю, день и время сдачи");
  if (input.meeting !== null && !isSlot(input.meeting)) fail("Выберите неделю, день и время встречи");
  await prisma.$transaction(async (tx) => {
    const team = await teamOrFail(tx, teamId);
    if (!team.active) fail("Команда выключена");
    if (!canManagePeople(actor)) {
      if (actor.role === "OBSERVER") fail("Наблюдатель команды не меняет");
      if (teamLogin(actor)) fail("Ритм команды руководитель задаёт, войдя по личной ссылке");
      const scope = await loadScope(tx, { id: actor.personId, role: actor.role });
      if (!scope.leads.includes(teamId)) fail("Ритм команды задают её руководитель, руководитель выше и владелец");
    }
    // Проверяем на отчётной неделе: сроки считаются одинаково для любой недели
    const setting = await getSetting<DeadlineSetting>("week.deadline", { weekday: 1, time: "18:00" });
    const key = reportingKey(new Date(), setting);
    const department = deadlineOf(key, setting);
    if (input.deadline && slotMoment(key, input.deadline).getTime() > department.getTime()) {
      fail(`Срок команды не позже срока департамента (${WEEKDAY_NAMES[setting.weekday - 1]} следующей недели, ${setting.time}): руководитель должен успеть собрать weekly команды`);
    }
    const ownDeadline = input.deadline ? slotMoment(key, input.deadline) : department;
    if (input.meeting && slotMoment(key, input.meeting).getTime() < ownDeadline.getTime()) fail("Встреча команды не раньше срока сдачи: на встрече разбирают сданные weekly");

    const before: RhythmInput = {
      deadline: slotOf(team.deadlineWeek, team.deadlineWeekday, team.deadlineTime),
      meeting: slotOf(team.meetingWeek, team.meetingWeekday, team.meetingTime),
      specialists: team.specialistsWeekly,
    };
    const same = (a: Slot | null, b: Slot | null) => JSON.stringify(a) === JSON.stringify(b);
    if (same(before.deadline, input.deadline) && same(before.meeting, input.meeting) && before.specialists === input.specialists) fail("Ничего не изменилось");
    await tx.team.update({
      where: { id: teamId },
      data: {
        deadlineWeek: input.deadline?.week ?? null,
        deadlineWeekday: input.deadline?.weekday ?? null,
        deadlineTime: input.deadline?.time ?? null,
        meetingWeek: input.meeting?.week ?? null,
        meetingWeekday: input.meeting?.weekday ?? null,
        meetingTime: input.meeting?.time ?? null,
        specialistsWeekly: input.specialists,
      },
    });
    if (!same(before.deadline, input.deadline)) {
      await audit(tx, actor, "team.rhythm", "team", teamId, `Срок weekly: ${team.name}`, describeSlot(before.deadline, "как у департамента"), describeSlot(input.deadline, "как у департамента"));
    }
    if (!same(before.meeting, input.meeting)) {
      await audit(tx, actor, "team.rhythm", "team", teamId, `Встреча команды: ${team.name}`, describeSlot(before.meeting, "как у департамента"), describeSlot(input.meeting, "как у департамента"));
    }
    if (before.specialists !== input.specialists) {
      await audit(tx, actor, "team.rhythm", "team", teamId, `Weekly специалистов: ${team.name}`, before.specialists ? "сдают" : "не сдают", input.specialists ? "сдают" : "не сдают");
    }
  });
}
