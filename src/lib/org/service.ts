// Структура департамента и команды (этап 14): загрузка структуры из таблицы, правка команд и состава.
// Структуру (подразделения, должности, руководителей) и команды правит только владелец в режиме управления
// (решение 8 по умолчанию). Руководитель команды сам добавляет и убирает участников своей команды.
// Этап 53: структура всей компании. Корень «компания» над департаментами, руководитель компании генеральный директор.
// Руководитель собирает команду и из других веток: руководителю человека приходит уведомление.
// Каждая правка пишется в журнал: что было и что стало.

import { fillMissingLogins, lockPeopleNames, reservedLogins, takenNames } from "@/lib/login/logins";
import { refreshApprovals } from "@/lib/tasks/approval";
import { primaryOwner, primaryOwnerSlug } from "@/lib/login/primary";
import { prisma } from "@/lib/db";
import type { Prisma, UnitKind } from "@/generated/prisma/client";
import { TaskRuleError, canSeeRow, type Actor } from "@/lib/tasks/service";
import { canManagePeople } from "@/lib/admin/service";
import { slugify, uniqueSlug } from "@/lib/translit";
import { TOP_TEAM, ancestorsOf, loadScope, loadTeamNodes, subtreeOf } from "./scope";
import { decideMode, kindOfDepth, pathKey, plannedKey, planStructure, readStructureTable, type ExistingPerson, type LoadMode, type StructurePlan } from "./import";
import { normName } from "@/lib/bord/names";
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
async function existingPeople(tx: Tx, paths: Map<string, string[]>, offUnits: Set<string> = new Set()): Promise<ExistingPerson[]> {
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
    // В выключенном подразделении: путь с пометкой, он не совпадёт ни с одним путём файла и человек переедет
    unitPath: p.unitId && paths.has(p.unitId) ? `${offUnits.has(p.unitId) ? "#выключено:" : ""}${pathKey(paths.get(p.unitId)!)}` : null,
    manager: p.manager?.fullName ?? null,
    managerId: p.managerId,
    functional: p.functionalManager?.fullName ?? null,
    functionalId: p.functionalManagerId,
    email: p.email,
    active: p.active,
  }));
}

type Load = { plan: StructurePlan; mode: LoadMode; root: UnitRow | null };

/**
 * План загрузки и корень. Вся компания: корень «компания» (до первой загрузки его ещё нет, пути идут от самого
 * верха). Один департамент в колонке: этот департамент. Без колонки: департамент руководителя топ-команды, а если
 * понять нельзя, загрузка не идёт. Предпросмотр базу не меняет
 */
async function resolveLoad(tx: Tx, fileText: string): Promise<Load> {
  if (!fileText.trim()) fail("Выберите файл со структурой или вставьте ячейки из таблицы");
  if (fileText.length > LIMITS.file) fail("Файл больше 1 МБ: выгрузите только лист со структурой");
  const table = readStructureTable(fileText);
  if (!table.rows.length && !table.problems.length) fail("В файле нет строк с людьми");
  const { mode, rows, problems } = decideMode(table);
  const units = await tx.orgUnit.findMany();
  let root: UnitRow | null = null;
  if (mode.kind === "company") root = await findCompany(tx);
  else if (mode.kind === "department") {
    root = units.find((u) => u.active && u.kind === "DEPARTMENT" && normName(u.name) === normName(mode.name)) ?? null;
    if (!root) problems.push({ line: 2, text: `Департамента «${mode.name}» нет в структуре: загрузите файл всей компании или проверьте название` });
  } else {
    root = await findDepartmentRoot(tx);
    const company = units.find((u) => u.kind === "COMPANY");
    const top = await tx.team.findUnique({ where: { id: TOP_TEAM }, select: { leaderId: true } });
    const departments = units.filter((u) => u.active && u.kind === "DEPARTMENT");
    if (company && departments.length > 1 && !departments.some((d) => top?.leaderId && d.headId === top.leaderId)) {
      problems.push({ line: 1, text: "Непонятно, в какой департамент грузить файл: добавьте колонку «Департамент»" });
    }
  }
  const paths = unitPaths(units, root?.id ?? null);
  const off = new Set(units.filter((u) => !u.active).map((u) => u.id));
  const existing = units.filter((u) => u.active && u.id !== root?.id && paths.has(u.id)).map((u) => paths.get(u.id)!);
  const plan = planStructure(rows, problems, existing, await existingPeople(tx, paths, off), mode.kind === "company");
  plan.root = mode.kind === "company" ? (root?.name ?? COMPANY_UNIT_NAME) : (root?.name ?? (mode.kind === "department" ? mode.name : ROOT_UNIT_NAME));
  return { plan, mode, root };
}

async function planFor(tx: Tx, fileText: string): Promise<StructurePlan> {
  return (await resolveLoad(tx, fileText)).plan;
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
      // Две загрузки одновременно не заводят две компании и не перебивают друг друга
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('structure-load'))::text`;
      const load = await resolveLoad(tx, fileText);
      const plan = load.plan;
      if (plan.problems.length) fail(`Структуру не загрузить, база не тронута. Исправьте в файле: ${plan.problems.slice(0, 5).map((p) => `строка ${p.line}: ${p.text}`).join("; ")}`);
      // Файл всей компании грузится от корня «компания», файл департамента только в свой департамент:
      // подразделения, вакансии и люди других департаментов такая загрузка не трогает
      const root = load.mode.kind === "company" ? await companyRoot(tx, actor) : (load.root ?? (await departmentRoot(tx)));
      const units = await tx.orgUnit.findMany();
      const paths = unitPaths(units, root.id);
      const inRoot = new Set(paths.keys());
      const byPath = new Map<string, string>();
      const offByPath = new Map<string, string>();
      for (const u of units) {
        if (u.id === root.id || !paths.has(u.id)) continue;
        if (u.active) byPath.set(pathKey(paths.get(u.id)!), u.id);
        else if (!offByPath.has(pathKey(paths.get(u.id)!))) offByPath.set(pathKey(paths.get(u.id)!), u.id);
      }
      let unitsCreated = 0;
      // Подразделения из файла вместе со всеми подразделениями выше: остальные после загрузки выключаются
      const used = new Set<string>([root.id]);
      const unitOf = async (path: string[]): Promise<string> => {
        if (!path.length) return root.id;
        const key = pathKey(path);
        let id = byPath.get(key);
        // Выключенное подразделение с тем же путём снова в файле: оно включается, второе с тем же именем не заводится
        const off = !id ? offByPath.get(key) : undefined;
        if (off) {
          await unitOf(path.slice(0, -1));
          await tx.orgUnit.update({ where: { id: off }, data: { active: true } });
          await audit(tx, actor, "structure.unit.on", "unit", off, "Подразделение снова в структуре", null, path.join(" / "));
          byPath.set(key, off);
          offByPath.delete(key);
          id = off;
        } else if (!id) {
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
      // Сменились руководители и подразделения: согласующие задач пересчитываются (этап 54)
      await refreshApprovals(tx, actor);
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
  const unitRows = await tx.orgUnit.findMany({ where: { active: true }, select: { id: true, parentId: true } });
  const activeUnits = new Set(unitRows.map((u) => u.id));
  // Руководитель нескольких подразделений получает команду самого верхнего из них: департамента, а не своего управления
  const parentOf = new Map(unitRows.map((u) => [u.id, u.parentId]));
  const depthOf = (id: string) => {
    let d = 0;
    const seen = new Set<string>();
    for (let cur = parentOf.get(id); cur && !seen.has(cur); cur = parentOf.get(cur) ?? null) {
      seen.add(cur);
      d += 1;
    }
    return d;
  };
  let createdTeams = 0;
  let addedMembers = 0;
  for (const m of people) {
    if (m.role === "OBSERVER") continue;
    const headed = m.id === ownerId ? null : ([...m.headOf].sort((a, b) => depthOf(a.id) - depthOf(b.id))[0] ?? null);
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
  // Команде без команды выше место под командой генерального директора, а без неё на самом верху. Топ-команда тут
  // только для структуры одного департамента: финансы и маркетинг под командой Арама не встают
  const fallback: string | null = company ? (companyTeam?.id ?? null) : TOP_TEAM;
  const nodes = await loadTeamNodes(tx);
  const teamOfLeader = new Map<string, string>();
  for (const t of teams) if (t.active && t.leaderId && !teamOfLeader.has(t.leaderId) && t.unitId) teamOfLeader.set(t.leaderId, t.id);
  for (const t of teams) if (t.active && t.leaderId && !teamOfLeader.has(t.leaderId)) teamOfLeader.set(t.leaderId, t.id);
  for (const t of teams) {
    if (!t.active || t.parentManual || !t.leaderId) continue;
    const managerId = people.find((p) => p.id === t.leaderId)?.managerId ?? null;
    // Команда «Прямые подчинённые» владельца остаётся под топ-командой, даже если сам владелец подчиняется генеральному
    let parentId: string | null =
      t.id === companyTeam?.id ? null : t.leaderId === ownerId || managerId === ownerId ? TOP_TEAM : (managerId && teamOfLeader.get(managerId)) || fallback;
    // Петля в дереве команд невозможна, но на всякий случай: команда не встаёт ниже самой себя
    if (parentId && subtreeOf(nodes, t.id).includes(parentId)) parentId = fallback === t.id ? null : fallback;
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
  await recomputeExternal(tx);
  return { teams: createdTeams, members: addedMembers };
}

/**
 * Пометка «из другой ветки» пересчитывается после загрузки структуры и смены руководителя команды: человек мог
 * перейти в другую ветку, у команды мог появиться руководитель. Свой: подчиняется руководителю команды по линии
 */
export async function recomputeExternal(tx: Tx): Promise<number> {
  const [people, teams] = await Promise.all([
    tx.person.findMany({ where: { active: true }, select: { id: true, managerId: true } }),
    tx.team.findMany({ where: { active: true, leaderId: { not: null } }, select: { id: true, leaderId: true, members: { select: { personId: true, auto: true, external: true } } } }),
  ]);
  const managerOf = new Map(people.map((p) => [p.id, p.managerId]));
  const under = (personId: string, leaderId: string) => {
    const seen = new Set<string>();
    for (let cur = managerOf.get(personId) ?? null; cur && !seen.has(cur); cur = managerOf.get(cur) ?? null) {
      if (cur === leaderId) return true;
      seen.add(cur);
    }
    return false;
  };
  let changed = 0;
  for (const t of teams) {
    for (const m of t.members) {
      const external = m.auto ? false : !under(m.personId, t.leaderId!);
      if (external === m.external) continue;
      await tx.teamMember.update({ where: { teamId_personId: { teamId: t.id, personId: m.personId } }, data: { external } });
      changed += 1;
    }
  }
  return changed;
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
      if (id === TOP_TEAM) fail("Команду выше у топ-команды задаёт структура: при структуре компании это команда генерального директора");
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
    // Новый руководитель: кто в команде из другой ветки, считается заново (этап 53)
    if (data.leaderId !== undefined) await recomputeExternal(tx);
  });
}

/**
 * Человек из ветки руководителя: прямой или непрямой подчинённый по линии подчинения. Остальных руководитель тоже
 * может позвать в свою команду (этап 53): они входят с согласия своего руководителя как участники из другой ветки.
 * Тот же признак пересчитывает recomputeExternal
 */
async function inBranch(tx: Tx, leaderId: string, personId: string): Promise<boolean> {
  const seen = new Set<string>();
  let cur = await tx.person.findUnique({ where: { id: personId }, select: { id: true, managerId: true } });
  while (cur?.managerId && !seen.has(cur.managerId)) {
    if (cur.managerId === leaderId) return true;
    seen.add(cur.managerId);
    cur = await tx.person.findUnique({ where: { id: cur.managerId }, select: { id: true, managerId: true } });
  }
  return false;
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

/** Кто соглашается отдать человека в команду другой ветки: его руководитель, нет его: руководитель его подразделения выше */
async function joinApprover(tx: Tx, person: { id: string; managerId: string | null; unitId: string | null }): Promise<{ id: string; fullName: string } | null> {
  if (person.managerId) {
    const m = await tx.person.findUnique({ where: { id: person.managerId }, select: { id: true, fullName: true, active: true } });
    if (m?.active) return { id: m.id, fullName: m.fullName };
  }
  const units = await tx.orgUnit.findMany({ where: { active: true }, select: { id: true, parentId: true, headId: true } });
  const byId = new Map(units.map((u) => [u.id, u]));
  const seen = new Set<string>();
  for (let cur = person.unitId ? byId.get(person.unitId) : undefined; cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    seen.add(cur.id);
    if (cur.headId && cur.headId !== person.id) {
      const h = await tx.person.findUnique({ where: { id: cur.headId }, select: { id: true, fullName: true, active: true } });
      if (h?.active) return { id: h.id, fullName: h.fullName };
    }
  }
  return null;
}

/** Событие «Мне» о составе команды: отдельная строка на человека, повтор за сутки не шлётся */
async function teamEvent(tx: Tx, actor: Actor, recipient: string | null | undefined, subject: string, text: string, now: Date) {
  if (!recipient || recipient === actor.personId) return;
  const recent = await tx.inboxEvent.count({ where: { recipientId: recipient, subject, kind: "TEAM", createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } });
  if (recent) return;
  await notify(tx, { kind: "TEAM", recipients: [recipient], actor: { personId: actor.personId, fullName: actor.fullName }, subject, text }, now);
}

export type AddMemberResult = { added: boolean; external: boolean; pendingWith?: string };

/**
 * Участник в команду (этап 53, решение Арама 21.10: команду собирают из людей любых веток, например в команду
 * страхования входят люди других департаментов). Человек из ветки руководителя команды входит сразу. Человек из другой
 * ветки входит, когда согласится его руководитель: участник команды видит weekly и задачи коллег, а они его, так что
 * без согласия руководитель открыл бы себе чужую работу. Владелец в режиме управления добавляет сразу, руководитель
 * человека получает уведомление. Задачи участника из другой ветки вне этой команды руководителю не видны
 */
export async function addTeamMember(actor: Actor, teamId: string, slug: string, now = new Date()): Promise<AddMemberResult> {
  return prisma.$transaction(async (tx) => {
    const { team, owner } = await requireTeamEditor(tx, actor, teamId);
    const person = await personBySlug(tx, slug);
    if (!person.active) fail(`${person.fullName} выключен`);
    if (person.role === "OBSERVER") fail("Наблюдатель в командах не состоит");
    if (team.leaderId === person.id) fail(`${person.fullName} руководит этой командой`);
    const exists = await tx.teamMember.findUnique({ where: { teamId_personId: { teamId, personId: person.id } } });
    if (exists) fail(`${person.fullName} уже в команде`);
    const waiting = await tx.teamJoinRequest.findFirst({ where: { teamId, personId: person.id, status: "PENDING" }, include: { approver: { select: { fullName: true } } } });
    if (waiting) fail(`${person.fullName} уже ждёт согласия руководителя: ${waiting.approver.fullName}`);
    // Ветка считается от руководителя команды, а не от того, кто добавляет
    const external = team.leaderId ? !(await inBranch(tx, team.leaderId, person.id)) : false;
    const leaderName = team.leader?.fullName ?? "руководитель не назначен";
    if (!external || owner) {
      await tx.teamMember.create({ data: { teamId, personId: person.id, addedById: actor.personId, external } });
      await audit(tx, actor, "team.member.add", "team", teamId, `Участник добавлен: ${team.name}`, null, external ? `${person.fullName} (из другой ветки)` : person.fullName);
      if (external) {
        const subject = `team:${teamId}:${person.id}`;
        await teamEvent(tx, actor, person.id, subject, `Вы в команде «${team.name}», руководитель ${leaderName}`, now);
        const approver = await joinApprover(tx, person);
        if (approver && approver.id !== team.leaderId) await teamEvent(tx, actor, approver.id, subject, `${person.fullName} в команде «${team.name}», руководитель ${leaderName}`, now);
      }
      return { added: true, external };
    }
    const approver = await joinApprover(tx, person);
    if (!approver) fail(`У ${person.fullName} в структуре нет руководителя, согласовать некому: попросите владельца ресурса добавить его`);
    if (approver!.id === actor.personId) {
      // Добавляет сам руководитель человека: его согласие уже есть
      await tx.teamMember.create({ data: { teamId, personId: person.id, addedById: actor.personId, external } });
      await audit(tx, actor, "team.member.add", "team", teamId, `Участник добавлен: ${team.name}`, null, `${person.fullName} (из другой ветки)`);
      return { added: true, external };
    }
    const request = await tx.teamJoinRequest.create({ data: { teamId, personId: person.id, requestedById: actor.personId, approverId: approver!.id, createdAt: now } });
    await audit(tx, actor, "team.join.request", "team", teamId, `Запрос в команду: ${team.name}`, null, `${person.fullName}, согласует ${approver!.fullName}`);
    await notify(
      tx,
      { kind: "TEAM", recipients: [approver!.id], actor: { personId: actor.personId, fullName: actor.fullName }, subject: `join:${request.id}`, text: `Просят добавить вашего сотрудника ${person.fullName} в команду «${team.name}», руководитель ${leaderName}: согласуйте или откажите` },
      now,
    );
    return { added: false, external: true, pendingWith: approver!.fullName };
  });
}

export type JoinRequestView = { id: string; team: { id: string; name: string }; person: { slug: string; fullName: string; position: string | null }; requestedBy: string | null; approver: string; createdAt: string };

/** Запросы в команды: которые ждут моего согласия и которые ждут согласия по моим командам */
export async function joinRequestsFor(actor: Actor): Promise<{ toApprove: JoinRequestView[]; waiting: JoinRequestView[] }> {
  const rows = await prisma.teamJoinRequest.findMany({
    where: { status: "PENDING", OR: [{ approverId: actor.personId }, { team: { leaderId: actor.personId } }, ...(canManagePeople(actor) ? [{}] : [])] },
    include: { team: { select: { id: true, name: true } }, person: { select: { slug: true, fullName: true, position: true } }, requestedBy: { select: { fullName: true } }, approver: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: "asc" },
  });
  const view = (r: (typeof rows)[number]): JoinRequestView => ({ id: r.id, team: r.team, person: r.person, requestedBy: r.requestedBy?.fullName ?? null, approver: r.approver.fullName, createdAt: r.createdAt.toISOString() });
  return { toApprove: rows.filter((r) => r.approverId === actor.personId).map(view), waiting: rows.map(view) };
}

/** Согласие или отказ руководителя человека. Решает он сам или владелец в режиме управления */
export async function decideJoinRequest(actor: Actor, id: string, approve: boolean, now = new Date()): Promise<void> {
  if (teamLogin(actor)) fail("Решение по запросу принимают, войдя лично");
  await prisma.$transaction(async (tx) => {
    const r = await tx.teamJoinRequest.findUnique({ where: { id }, include: { team: { include: { leader: { select: { fullName: true } } } }, person: true } });
    if (!r || r.status !== "PENDING") return fail("Запроса уже нет: его решили или отменили");
    if (r.approverId !== actor.personId && !canManagePeople(actor)) fail("Решает руководитель человека или владелец в режиме управления");
    const taken = await tx.teamJoinRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: approve ? "APPROVED" : "DECLINED", decidedAt: now } });
    if (taken.count !== 1) fail("Запроса уже нет: его решили или отменили");
    const subject = `team:${r.teamId}:${r.personId}`;
    if (approve) {
      if (!r.person.active) fail(`${r.person.fullName} выключен`);
      await tx.teamMember.createMany({ data: [{ teamId: r.teamId, personId: r.personId, addedById: r.requestedById, external: true }], skipDuplicates: true });
      await audit(tx, actor, "team.member.add", "team", r.teamId, `Участник добавлен: ${r.team.name}`, null, `${r.person.fullName} (из другой ветки, согласовал ${actor.fullName})`);
      await teamEvent(tx, actor, r.personId, subject, `Вы в команде «${r.team.name}», руководитель ${r.team.leader?.fullName ?? "не назначен"}`, now);
      await teamEvent(tx, actor, r.requestedById, subject, `${r.person.fullName} в команде «${r.team.name}»: руководитель согласовал`, now);
    } else {
      await audit(tx, actor, "team.join.decline", "team", r.teamId, `Запрос в команду отклонён: ${r.team.name}`, r.person.fullName, null);
      await teamEvent(tx, actor, r.requestedById, subject, `${r.person.fullName} не добавлен в команду «${r.team.name}»: руководитель отказал`, now);
    }
  });
}

/** Запрос отменяет тот, кто просил, руководитель команды или владелец */
export async function cancelJoinRequest(actor: Actor, id: string, now = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const r = await tx.teamJoinRequest.findUnique({ where: { id }, include: { team: true, person: { select: { fullName: true } } } });
    if (!r || r.status !== "PENDING") return fail("Запроса уже нет: его решили или отменили");
    if (r.requestedById !== actor.personId && r.team.leaderId !== actor.personId && !canManagePeople(actor)) fail("Запрос отменяет тот, кто просил, или владелец");
    await tx.teamJoinRequest.update({ where: { id }, data: { status: "CANCELLED", decidedAt: now } });
    await audit(tx, actor, "team.join.cancel", "team", r.teamId, `Запрос в команду отменён: ${r.team.name}`, r.person.fullName, null);
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
    await refreshApprovals(tx, actor);
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
    await refreshApprovals(tx, actor);
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
  return prisma.$transaction((tx) => syncUnitTeams(tx, actor), { timeout: 60_000 });
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
  return people.filter((p) => p.id !== actor.personId).map((p) => view(p, underMe(p.id)));
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
    // Команда генерального директора стоит над топ-командой: её срок позже срока департамента, ограничения сверху нет
    const companyUnit = team.unitId ? await tx.orgUnit.findUnique({ where: { id: team.unitId }, select: { kind: true } }) : null;
    const isCompany = companyUnit?.kind === "COMPANY";
    if (!isCompany && input.deadline && slotMoment(key, input.deadline).getTime() > department.getTime()) {
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
