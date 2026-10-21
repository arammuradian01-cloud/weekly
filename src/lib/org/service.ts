// Структура департамента и команды (этап 14): загрузка структуры из таблицы, правка команд и состава.
// Структуру (подразделения, должности, руководителей) и команды правит только владелец в режиме управления
// (решение 8 по умолчанию). Руководитель команды сам добавляет и убирает участников своей команды.
// Этап 53: структура всей компании. Корень «компания» над департаментами, руководитель компании генеральный директор.
// Руководитель собирает команду и из других веток: руководителю человека приходит уведомление.
// Каждая правка пишется в журнал: что было и что стало.

import { fillMissingLogins, lockPeopleNames, reservedLogins, takenNames } from "@/lib/login/logins";
import { primaryOwner, primaryOwnerSlug } from "@/lib/login/primary";
import { prisma } from "@/lib/db";
import type { Prisma, UnitKind } from "@/generated/prisma/client";
import { TaskRuleError, canSeeRow, type Actor } from "@/lib/tasks/service";
import { canManagePeople } from "@/lib/admin/service";
import { slugify, uniqueSlug } from "@/lib/translit";
import { TOP_TEAM, ancestorsOf, loadScope, loadTeamNodes, subtreeOf } from "./scope";
import { kindOfDepth, pathKey, plannedKey, planStructure, readStructureTable, type ExistingPerson, type StructurePlan } from "./import";
import { notify } from "@/lib/inbox/notify";
import { WEEKDAY_NAMES, isSlot, slotMoment, slotOf, slotText, type Slot } from "./rhythm";
import { getSetting } from "@/lib/settings";
import type { DeadlineSetting } from "@/lib/week";
import { deadlineOf, reportingKey } from "@/lib/weekly/weeks";

type Tx = Prisma.TransactionClient;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export const ROOT_UNIT_NAME = "Департамент страхования и инвестиций";
/** Корень структуры всей компании (этап 53) */
export const COMPANY_UNIT_NAME = "Сравни";
/** Команда генерального директора: команда руководителя компании */
export const COMPANY_TEAM_NAME = "Команда генерального директора";
export const UNIT_KIND_LABELS: Record<UnitKind, string> = {
  COMPANY: "Компания",
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

/**
 * Путь подразделения от корня загрузки, без самого корня: «Управление развития продуктов / Отдел ... / Сектор ...».
 * Корень: пустой путь. Подразделения не под корнем пути не получают: их загрузка не трогает.
 * rootId null: корня ещё нет (структура компании до первой загрузки), путь идёт от самого верхнего подразделения
 */
function unitPaths(units: UnitRow[], rootId: string | null): Map<string, string[]> {
  const byId = new Map(units.map((u) => [u.id, u]));
  const out = new Map<string, string[]>();
  for (const u of units) {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur: UnitRow | undefined = u;
    let reached = false;
    while (cur && !seen.has(cur.id)) {
      if (cur.id === rootId) {
        reached = true;
        break;
      }
      chain.unshift(cur.name);
      seen.add(cur.id);
      if (!cur.parentId) {
        reached = rootId === null;
        break;
      }
      cur = byId.get(cur.parentId);
    }
    if (reached) out.set(u.id, chain);
  }
  return out;
}

const findCompany = (tx: Tx) => tx.orgUnit.findFirst({ where: { kind: "COMPANY" }, orderBy: { createdAt: "asc" } });

/**
 * Департамент, в который грузится файл без колонки «Департамент»: департамент руководителя топ-команды, иначе первый
 * заведённый. Нет ни одного: заводим, под компанией, если она уже есть
 */
async function findDepartmentRoot(tx: Tx): Promise<UnitRow | null> {
  const top = await tx.team.findUnique({ where: { id: TOP_TEAM }, select: { leaderId: true } });
  const departments = await tx.orgUnit.findMany({ where: { kind: "DEPARTMENT" }, orderBy: [{ createdAt: "asc" }] });
  const live = departments.filter((d) => d.active);
  return live.find((d) => top?.leaderId && d.headId === top.leaderId) ?? live[0] ?? departments[0] ?? null;
}

async function departmentRoot(tx: Tx): Promise<UnitRow> {
  const found = await findDepartmentRoot(tx);
  if (found) return found;
  const owner = await primaryOwner(tx);
  const company = await findCompany(tx);
  return tx.orgUnit.create({ data: { name: ROOT_UNIT_NAME, kind: "DEPARTMENT", headId: owner?.id ?? null, parentId: company?.id ?? null } });
}

/**
 * Корень структуры компании (этап 53). Нет: заводим. Департамент, который был корнем раньше, встаёт под компанию
 * вместе со всеми подразделениями, людьми и командами
 */
async function companyRoot(tx: Tx, actor: Actor): Promise<UnitRow> {
  let company = await findCompany(tx);
  if (!company) {
    company = await tx.orgUnit.create({ data: { name: COMPANY_UNIT_NAME, kind: "COMPANY" } });
    await audit(tx, actor, "structure.unit.create", "unit", company.id, "Подразделение добавлено", null, `${UNIT_KIND_LABELS.COMPANY}: ${company.name}`);
  }
  const orphans = await tx.orgUnit.findMany({ where: { parentId: null, id: { not: company.id } } });
  for (const u of orphans) {
    await tx.orgUnit.update({ where: { id: u.id }, data: { parentId: company.id } });
    await audit(tx, actor, "structure.unit.update", "unit", u.id, `Подразделение выше: ${u.name}`, null, company.name);
  }
  return company;
}

/** Верх структуры для правки руками: компания, если она есть, иначе департамент */
async function rootUnit(tx: Tx): Promise<UnitRow> {
  return (await findCompany(tx)) ?? departmentRoot(tx);
}

/** Люди ресурса для плана. unitPath null: человек вне корня загрузки или без подразделения */
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
    unitPath: p.unitId && paths.has(p.unitId) ? pathKey(paths.get(p.unitId)!) : null,
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
  const { rows, problems, company } = readStructureTable(fileText);
  if (!rows.length && !problems.length) fail("В файле нет строк с людьми");
  // Предпросмотр базу не меняет: корня компании до первой загрузки ещё нет, тогда пути идут от самого верха
  const root = company ? await findCompany(tx) : await findDepartmentRoot(tx);
  const units = await tx.orgUnit.findMany();
  const paths = unitPaths(units, root?.id ?? null);
  const existing = units.filter((u) => u.active && u.id !== root?.id && paths.has(u.id)).map((u) => paths.get(u.id)!);
  return planStructure(rows, problems, existing, await existingPeople(tx, paths), company);
}

/** Предпросмотр загрузки: что добавится, изменится и уйдёт. В базе ничего не меняется */
export async function previewStructure(actor: Actor, fileText: string): Promise<StructurePlan> {
  requireOwner(actor);
  return prisma.$transaction((tx) => planFor(tx, fileText), { timeout: 30_000 });
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
      // Файл всей компании грузится от корня «компания», файл департамента только в свой департамент:
      // подразделения, вакансии и люди других департаментов такая загрузка не трогает
      const root = plan.company ? await companyRoot(tx, actor) : await departmentRoot(tx);
      const units = await tx.orgUnit.findMany();
      const paths = unitPaths(units, root.id);
      const inRoot = new Set(paths.keys());
      const byPath = new Map<string, string>();
      for (const u of units) if (u.id !== root.id && u.active && paths.has(u.id)) byPath.set(pathKey(paths.get(u.id)!), u.id);
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
          const created = await tx.orgUnit.create({ data: { name: path.at(-1)!, kind: kindOfDepth(path.length - 1, path.at(-1), plan.company), parentId, sortOrder } });
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
      await lockPeopleNames(tx);
      const all = await tx.person.findMany({ select: { id: true, slug: true, login: true, sortOrder: true, email: true, fullName: true } });
      // Чужие логины тоже заняты (этап 52): короткое имя нового человека не совпадёт с логином другого
      const taken = new Set([...takenNames(all), ...(await reservedLogins(tx))]);
      const primary = await primaryOwnerSlug(tx);
      let sortOrder = Math.max(0, ...all.map((p) => p.sortOrder));
      /** «file:строка» новых людей в их id после создания */
      const idOfKey = new Map<string, string>();
      const planned = [] as { id: string; head: boolean; unitId: string; managerKey: string | null; functionalKey: string | null; fullName: string }[];
      let added = 0;
      for (const p of plan.planned) {
        const unitId = await unitOf(p.path);
        let email = p.email && !all.some((x) => x.email === p.email && x.id !== p.id) ? p.email : null;
        let id = p.id;
        if (!id) {
          const slug = uniqueSlug(slugify(p.fullName.split(" ")[0] ?? p.fullName, 24), taken);
          taken.add(slug);
          sortOrder += 10;
          const unitName = p.path.at(-1) ?? root.name;
          const created = await tx.person.create({
            data: { slug, fullName: p.fullName, shortName: p.shortName, role: "EMPLOYEE", zone: unitName.slice(0, 120), defaultDirectionId: fallback!.id, sortOrder, active: true, position: p.position || null, unitId, email },
          });
          id = created.id;
          added += 1;
          await audit(tx, actor, "structure.person.create", "person", slug, "Сотрудник добавлен из структуры", null, [p.fullName, p.position, p.path.join(" / ")].filter(Boolean).join(", "));
        } else if (p.changes.length) {
          const before = all.find((x) => x.id === id);
          // Почту главного владельца файл не меняет, если грузит не он сам: по почте восстанавливают вход (этап 52)
          const keepPrimary = !!email && before?.slug === primary && actor.slug !== primary;
          if (keepPrimary) email = null;
          // Новая почта из файла: неподтверждённый адрес человека и ссылки на прежний адрес гаснут (этап 52)
          const newEmail = !!email && email !== before?.email;
          await tx.person.update({ where: { id }, data: { position: p.position || null, unitId, active: true, ...(email ? { email } : {}), ...(newEmail ? { pendingEmail: null } : {}) } });
          if (newEmail) await tx.loginLink.updateMany({ where: { personId: id, kind: { in: ["EMAIL", "STEP_UP", "EMAIL_CONFIRM"] }, usedAt: null, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date() } });
          const slug = all.find((x) => x.id === id)?.slug ?? id;
          await audit(tx, actor, "structure.person.update", "person", slug, "Структура: изменения", null, p.changes.join("; "));
        }
        idOfKey.set(plannedKey(p), id);
        planned.push({ id, head: p.head, unitId, managerKey: p.managerKey, functionalKey: p.functionalKey, fullName: p.fullName });
      }
      const resolve = (key: string | null) => (key ? (idOfKey.get(key) ?? key) : null);

      // Руководители подразделений по колонке «Руководит». У подразделений из файла без такой строки руководитель снимается.
      // Руководителя корня меняет только файл всей компании, и только строкой с «Руководит» без подразделения
      const headOfUnit = new Map(planned.filter((x) => x.head).map((x) => [x.unitId, x]));
      for (const unitId of used) {
        if (unitId === root.id && !(plan.company && headOfUnit.has(root.id))) continue;
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

      // Подразделения корня, которых нет в файле, выключаются. Люди и команды в них остаются
      for (const u of unitRows) {
        if (u.id === root.id || !inRoot.has(u.id) || !u.active || used.has(u.id)) continue;
        await tx.orgUnit.update({ where: { id: u.id }, data: { active: false } });
        await audit(tx, actor, "structure.unit.off", "unit", u.id, "Подразделение выключено: его нет в загруженной структуре", u.name, null);
      }

      // Вакансии: открытые в корне загрузки заменяются вакансиями из файла
      await tx.vacancy.updateMany({ where: { closedAt: null, unitId: { in: [...inRoot] } }, data: { closedAt: new Date() } });
      for (const v of plan.vacancies) await tx.vacancy.create({ data: { unitId: await unitOf(v.path), position: v.position } });

      const { teams, members } = await syncUnitTeams(tx, actor);
      // Новым людям сразу логины вида amuradyan (этап 52)
      await fillMissingLogins(tx);
      await audit(tx, actor, "structure.import", "structure", "import", "Структура загружена", null, `людей ${plan.planned.length}: новых ${added}, изменено ${plan.people.change.length}; подразделений новых ${unitsCreated}; вакансий ${plan.vacancies.length}`);
      return { units: unitsCreated, added, changed: plan.people.change.length, teams, members, vacancies: plan.vacancies.length };
    },
    // Структура всей компании: сотни людей и подразделений одной транзакцией
    { timeout: 180_000 },
  );
}

/**
 * Команды руководителей по структуре. У каждого, у кого есть прямые подчинённые, своя команда:
 * - руководитель подразделения: команда подразделения. Сменился руководитель подразделения: у той же команды
 *   меняется руководитель, новая команда не появляется, прежний руководитель теряет права на её задачи;
 * - остальные руководители (например, ведущий разработчик в отделе): команда по имени и должности;
 * - владелец: его команда топ-команда, а прямые подчинённые не из топ-команды попадают в команду «Прямые подчинённые»;
 * - руководитель компании (этап 53): команда генерального директора, на самом верху. Топ-команда встаёт под неё,
 *   команды руководителей департаментов тоже.
 * Участники по структуре (auto) пересчитываются: новые прямые подчинённые добавляются, ушедшие убираются.
 * Участники, добавленные руками, не трогаются. Команда, которую владелец выключил, заново не создаётся.
 * Команда выше пересчитывается, если владелец не ставил её руками
 */
export async function syncUnitTeams(tx: Tx, actor: Actor): Promise<{ teams: number; members: number }> {
  const top = await tx.team.findUnique({ where: { id: TOP_TEAM }, include: { members: { select: { personId: true } } } });
  const topIds = new Set([...(top?.leaderId ? [top.leaderId] : []), ...(top?.members.map((m) => m.personId) ?? [])]);
  const people = await tx.person.findMany({
    where: { active: true },
    select: { id: true, fullName: true, position: true, managerId: true, role: true, headOf: { where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, kind: true } } },
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
      const name = (headed.kind === "COMPANY" ? COMPANY_TEAM_NAME : headed.name).slice(0, 120);
      await tx.team.update({ where: { id: team.id }, data: { unitId: headed.id, name } });
      await audit(tx, actor, "team.update", "team", team.id, "Команда перешла на подразделение", team.name, name);
      team.unitId = headed.id;
      team.name = name;
    }
    if (team && team.leaderId !== m.id) {
      const before = team.leaderId ? people.find((p) => p.id === team!.leaderId)?.fullName ?? "другой человек" : "не назначен";
      await tx.team.update({ where: { id: team.id }, data: { leaderId: m.id } });
      await tx.teamMember.deleteMany({ where: { teamId: team.id, personId: m.id } });
      await audit(tx, actor, "team.update", "team", team.id, `Руководитель по структуре: ${team.name}`, before, m.fullName);
      team.leaderId = m.id;
    }
    if (!team) {
      const unitTeamName = headed?.kind === "COMPANY" ? COMPANY_TEAM_NAME : headed?.name;
      const name = (m.id === ownerId ? `Прямые подчинённые: ${m.fullName}` : (unitTeamName ?? (m.position ? `${m.fullName}, ${m.position}` : `Команда: ${m.fullName}`))).slice(0, 120);
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

  // Команда выше: команда руководителя руководителя, иначе топ-команда. Поставленную руками не трогаем.
  // Команда генерального директора стоит на самом верху (этап 53)
  const company = await tx.orgUnit.findFirst({ where: { kind: "COMPANY", active: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  const companyTeam = company ? teams.find((t) => t.active && t.unitId === company.id) : undefined;
  const nodes = await loadTeamNodes(tx);
  const teamOfLeader = new Map<string, string>();
  for (const t of teams) if (t.active && t.leaderId && !teamOfLeader.has(t.leaderId) && t.unitId) teamOfLeader.set(t.leaderId, t.id);
  for (const t of teams) if (t.active && t.leaderId && !teamOfLeader.has(t.leaderId)) teamOfLeader.set(t.leaderId, t.id);
  for (const t of teams) {
    if (!t.active || t.parentManual || !t.leaderId) continue;
    const managerId = people.find((p) => p.id === t.leaderId)?.managerId ?? null;
    // Команда «Прямые подчинённые» владельца остаётся под топ-командой, даже если сам владелец подчиняется генеральному
    let parentId: string | null = t.id === companyTeam?.id ? null : t.leaderId === ownerId ? TOP_TEAM : (managerId && managerId !== ownerId && teamOfLeader.get(managerId)) || TOP_TEAM;
    // Петля в дереве команд невозможна, но на всякий случай: команда не встаёт ниже самой себя
    if (parentId && subtreeOf(nodes, t.id).includes(parentId)) parentId = TOP_TEAM;
    if (parentId !== t.parentId && parentId !== t.id) {
      await tx.team.update({ where: { id: t.id }, data: { parentId } });
      const n = nodes.find((x) => x.id === t.id);
      if (n) n.parentId = parentId;
    }
  }
  // Топ-команда под командой генерального директора: туда её руководитель сдаёт свой weekly
  if (top && !top.parentManual) {
    const want = companyTeam?.id ?? null;
    if (want !== top.parentId && !(want && subtreeOf(nodes, TOP_TEAM).includes(want))) {
      await tx.team.update({ where: { id: TOP_TEAM }, data: { parentId: want } });
      const before = top.parentId ? (nodes.find((n) => n.id === top.parentId)?.name ?? "нет") : "нет";
      await audit(tx, actor, "team.update", "team", TOP_TEAM, `Команда выше: ${top.name}`, before, want ? (companyTeam?.name ?? null) : "нет");
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
 * Человек из ветки руководителя: прямой или непрямой подчинённый, или участник его команд ниже (кроме добавленных
 * из других веток). Остальных руководитель тоже может добавить в свою команду (этап 53), но они становятся
 * участниками из другой ветки, а их руководитель получает уведомление
 */
async function inBranch(tx: Tx, leaderId: string, personId: string): Promise<boolean> {
  const seen = new Set<string>();
  let cur = await tx.person.findUnique({ where: { id: personId }, select: { id: true, managerId: true } });
  while (cur?.managerId && !seen.has(cur.managerId)) {
    if (cur.managerId === leaderId) return true;
    seen.add(cur.managerId);
    cur = await tx.person.findUnique({ where: { id: cur.managerId }, select: { id: true, managerId: true } });
  }
  const nodes = await loadTeamNodes(tx);
  const led = nodes.filter((n) => n.leaderId === leaderId && n.id !== TOP_TEAM).flatMap((n) => subtreeOf(nodes, n.id));
  return nodes.some((n) => led.includes(n.id) && ((n.members.includes(personId) && !(n.external ?? []).includes(personId)) || n.leaderId === personId));
}

/** Общий логин team без режима управления: им пользуется вся топ-команда, поэтому командами через него не управляют */
const teamLogin = (actor: Actor) => actor.via === "TEAM" && !actor.management;

async function requireTeamEditor(tx: Tx, actor: Actor, teamId: string) {
  const team = await teamOrFail(tx, teamId);
  if (canManagePeople(actor)) return { team, owner: true };
  if (actor.role === "OBSERVER") fail("Наблюдатель команды не меняет");
  if (teamLogin(actor)) fail("Состав команды руководитель меняет, войдя лично, со своим логином и паролем");
  if (team.id !== TOP_TEAM && team.leaderId === actor.personId) return { team, owner: false };
  return fail("Состав команды меняют её руководитель и владелец в режиме управления");
}

/**
 * Участник в команду. Руководитель собирает свою команду из кого угодно (этап 53, решение Арама 21.10): например,
 * в команду страхования входят люди из других департаментов. Человек не из ветки руководителя команды становится
 * участником из другой ветки: его задачи вне этой команды руководитель не видит, а его собственный руководитель и он
 * сам получают уведомление в «Мне». Так руководитель человека всегда знает, в каких командах тот работает
 */
export async function addTeamMember(actor: Actor, teamId: string, slug: string, now = new Date()): Promise<{ external: boolean }> {
  return prisma.$transaction(async (tx) => {
    const { team } = await requireTeamEditor(tx, actor, teamId);
    const person = await personBySlug(tx, slug);
    if (!person.active) fail(`${person.fullName} выключен`);
    if (person.role === "OBSERVER") fail("Наблюдатель в командах не состоит");
    if (team.leaderId === person.id) fail(`${person.fullName} руководит этой командой`);
    const exists = await tx.teamMember.findUnique({ where: { teamId_personId: { teamId, personId: person.id } } });
    if (exists) fail(`${person.fullName} уже в команде`);
    // Ветка считается от руководителя команды, а не от того, кто добавляет: владелец тоже может собрать команду
    const external = team.leaderId ? !(await inBranch(tx, team.leaderId, person.id)) : false;
    await tx.teamMember.create({ data: { teamId, personId: person.id, addedById: actor.personId, external } });
    await audit(tx, actor, "team.member.add", "team", teamId, `Участник добавлен: ${team.name}`, null, external ? `${person.fullName} (из другой ветки)` : person.fullName);
    if (external) {
      const leaderName = team.leader?.fullName ?? "руководитель не назначен";
      const by = { personId: actor.personId, fullName: actor.fullName };
      await notify(tx, { kind: "TEAM", recipients: [person.id], actor: by, subject: `team:${teamId}`, text: `Вы в команде «${team.name}», руководитель ${leaderName}` }, now);
      if (person.managerId && person.managerId !== team.leaderId) {
        await notify(tx, { kind: "TEAM", recipients: [person.managerId], actor: by, subject: `team:${teamId}`, text: `${person.fullName} в команде «${team.name}», руководитель ${leaderName}` }, now);
      }
    }
    return { external };
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
    // Цель задачи берётся из её команды или команд выше (этап 17): в чужой ветке цель снимается
    const goal = task.goalId ? await tx.goal.findUnique({ where: { id: task.goalId }, select: { teamId: true, title: true } }) : null;
    const keepGoal = !goal || [teamId, ...ancestorsOf(nodes, teamId)].includes(goal.teamId);
    await tx.task.update({ where: { id: task.id }, data: { teamId, ...(keepGoal ? {} : { goalId: null }) } });
    await tx.auditLog.create({
      data: { action: "task.update", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "task", entityId: String(number), field: "Команда", before: from, after: target.name, ip: actor.ip ?? null, via: actor.via ?? null },
    });
    if (!keepGoal) {
      await tx.auditLog.create({
        data: { action: "task.update", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "task", entityId: String(number), field: "Цель", before: goal!.title, after: undefined, ip: actor.ip ?? null, via: actor.via ?? null },
      });
    }
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
    // Корень структуры (компания или департамент без компании) не двигается, не выключается и не меняет уровень.
    // Департамент под компанией (этап 53) правится как любое подразделение
    const root = !unit.parentId;
    const rootText = (what: string) => (unit.kind === "COMPANY" ? `Компания ${what}` : `Департамент ${what}`);
    if (input.kind !== undefined && input.kind !== unit.kind) {
      if (input.kind === "COMPANY" || unit.kind === "COMPANY") fail("Компания в структуре одна, она стоит на самом верху");
      if (root) fail("Корень структуры один: департамент");
      if ((unit.kind === "DEPARTMENT" || input.kind === "DEPARTMENT") && !(await findCompany(tx))) fail("Корень структуры один: департамент");
      data.kind = input.kind;
      log.push(["Уровень", UNIT_KIND_LABELS[unit.kind], UNIT_KIND_LABELS[input.kind]]);
    }
    if (input.parent !== undefined) {
      if (root) fail(rootText("стоит на самом верху"));
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
      if (root) fail(unit.kind === "COMPANY" ? "Компанию выключить нельзя" : "Департамент выключить нельзя");
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
  if (!(input.kind in UNIT_KIND_LABELS) || input.kind === "COMPANY") fail("Выберите уровень подразделения");
  return prisma.$transaction(async (tx) => {
    // Новый департамент бывает только под компанией (этап 53): без неё корень структуры один
    if (input.kind === "DEPARTMENT" && !(await findCompany(tx))) fail("Выберите уровень подразделения");
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
 * Кого можно добавить в команду. Владелец в режиме управления: все включённые люди, кроме наблюдателей. Руководитель
 * команды (этап 53): тоже все, но у людей не из его ветки отметка own: false, экран предупреждает об уведомлении
 */
export type MemberCandidate = { slug: string; fullName: string; position: string | null; unit: string | null; own?: boolean };

export async function memberCandidates(actor: Actor): Promise<MemberCandidate[]> {
  const people = await prisma.person.findMany({
    where: { active: true, role: { not: "OBSERVER" } },
    orderBy: [{ sortOrder: "asc" }, { fullName: "asc" }],
    select: { id: true, slug: true, fullName: true, position: true, managerId: true, unit: { select: { name: true, active: true } } },
  });
  const view = (p: (typeof people)[number], own?: boolean): MemberCandidate => ({ slug: p.slug, fullName: p.fullName, position: p.position, unit: p.unit?.active ? p.unit.name : null, ...(own === undefined ? {} : { own }) });
  if (canManagePeople(actor)) return people.map((p) => view(p));
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
  const inLed = new Set(nodes.filter((n) => led.has(n.id)).flatMap((n) => [...n.members.filter((id) => !(n.external ?? []).includes(id)), ...(n.leaderId ? [n.leaderId] : [])]));
  return people.filter((p) => p.id !== actor.personId).map((p) => view(p, underMe(p.id) || inLed.has(p.id)));
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
      if (teamLogin(actor)) fail("Ритм команды руководитель задаёт, войдя лично, со своим логином и паролем");
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
    // И не позже срока команды выше, если у неё свой срок: её руководитель сдаёт weekly с записями этой команды
    const parent = team.parentId && team.parentId !== TOP_TEAM ? await tx.team.findUnique({ where: { id: team.parentId } }) : null;
    const parentSlot = parent?.active ? slotOf(parent.deadlineWeek, parent.deadlineWeekday, parent.deadlineTime) : null;
    if (input.deadline && parentSlot && slotMoment(key, input.deadline).getTime() > slotMoment(key, parentSlot).getTime()) {
      fail(`Срок команды не позже срока команды выше «${parent!.name}» (${slotText(parentSlot)}): её руководитель должен успеть собрать weekly`);
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
