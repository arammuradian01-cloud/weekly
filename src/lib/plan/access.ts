// Кто видит цифры прогноза и денег (этап 57). Решения Арама 21.10: приложение для всей компании, раздел «Прогноз»
// видят все, цифры пока ведёт департамент страхования и инвестиций. Уровень видимости настраивается, весь
// топ-менеджмент видит основные цифры, генеральный директор видит все.
//
// Два уровня:
// - «Все цифры»: прогноз месяца по драйверам, партнёры, сравнение версий, цифры недели, прогноз лидеров, выгрузка.
//   Всегда: владельцы и администраторы, режим управления, топ-команда, генеральный директор (руководитель компании),
//   команды продуктов и партнёрского канала из «Прогноза» (без цифр они не ведут прогноз). Плюс департаменты и люди
//   из настройки. Пока владелец её не сохранил, это департамент руководителя топ-команды.
// - «Основные цифры»: итог месяца по продуктам против бюджета и LBE и цифры недели, без драйверов и корректировок.
//   По умолчанию топ-менеджмент: руководители департаментов и подразделений прямо под компанией. Плюс департаменты и
//   люди из настройки.
// Остальным раздел пишет, что прогноз их направления появится позже.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { TOP_TEAM } from "@/lib/org/scope";
import { departmentOf } from "@/lib/tasks/approval";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { PRODUCTS } from "@/lib/plan/spec";
import { PARTNER_DEFAULT_OWNERS, PARTNER_OWNER_CODE } from "@/lib/plan/partners";
import type { PlanBrief } from "@/lib/plan/brief";
import { auditVia } from "@/lib/audit";

type Db = Prisma.TransactionClient | typeof prisma;
type Who = { personId: string; role: string; management?: string | null; slug?: string };

/**
 * Человек, которого видно: личный вход. По общему логину можно выбрать чужой профиль, а с этапа 71 и режима управления
 * у него нет, поэтому прежнее исключение «общий логин в режиме владельца» убрано. Так решаются корректировка и выгрузка
 * прогноза и показ выручки и КВ по СК (этап 58)
 */
export const personalLogin = (actor: Pick<Actor, "role" | "via" | "management">): boolean => actor.role !== "OBSERVER" && actor.via !== "TEAM";

export type NumbersLevel = "full" | "summary" | "none";
export const NUMBERS_ACCESS_KEY = "numbers.access";

/** Настройка видимости. full.units null: по умолчанию, департамент руководителя топ-команды */
export type NumbersAccess = {
  full: { units: string[] | null; people: string[] };
  summary: { topManagement: boolean; units: string[]; people: string[] };
};
export const DEFAULT_NUMBERS_ACCESS: NumbersAccess = { full: { units: null, people: [] }, summary: { topManagement: true, units: [], people: [] } };

export const NUMBERS_CLOSED_TEXT = "Прогноз и цифры сейчас ведёт департамент страхования и инвестиций. Прогнозы других продуктов появятся здесь позже, каждый для своей команды.";
export const NUMBERS_SUMMARY_TEXT = "Вам видны основные цифры: итог месяца по продуктам и цифры недели. Драйверы, корректировки и партнёров ведут команды продуктов.";

const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && !!x))].slice(0, 500) : []);

export function numbersAccessOf(value: unknown): NumbersAccess {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const full = raw.full && typeof raw.full === "object" ? (raw.full as Record<string, unknown>) : {};
  const summary = raw.summary && typeof raw.summary === "object" ? (raw.summary as Record<string, unknown>) : {};
  return {
    full: { units: Array.isArray(full.units) ? strings(full.units) : null, people: strings(full.people) },
    summary: { topManagement: typeof summary.topManagement === "boolean" ? summary.topManagement : true, units: strings(summary.units), people: strings(summary.people) },
  };
}

export async function loadNumbersAccess(db: Db = prisma): Promise<NumbersAccess> {
  const row = await db.setting.findUnique({ where: { key: NUMBERS_ACCESS_KEY } });
  return numbersAccessOf(row?.value);
}

type UnitRow = { id: string; kind: string; parentId: string | null; headId: string | null; name: string; active: boolean };
type Ctx = {
  access: NumbersAccess;
  units: Map<string, UnitRow>;
  topIds: Set<string>;
  ceoId: string | null;
  owners: Set<string>;
  fullUnits: Set<string>;
};

/** Слаги команд продуктов и партнёрского канала: как в «Прогнозе», с умолчаниями, пока владелец не задал команды */
async function ownerSlugs(db: Db): Promise<Set<string>> {
  const row = await db.setting.findUnique({ where: { key: "plan.owners" } });
  const saved = row?.value && typeof row.value === "object" ? (row.value as Record<string, unknown>) : {};
  const out = new Set<string>();
  for (const spec of [...PRODUCTS.map((p) => ({ code: p.code, owners: p.owners })), { code: PARTNER_OWNER_CODE, owners: PARTNER_DEFAULT_OWNERS }]) {
    const list = Array.isArray(saved[spec.code]) ? strings(saved[spec.code]) : spec.owners;
    for (const s of list) out.add(s);
  }
  return out;
}

async function loadCtx(db: Db): Promise<Ctx> {
  const [access, unitRows, top, owners] = await Promise.all([
    loadNumbersAccess(db),
    db.orgUnit.findMany({ where: { active: true }, select: { id: true, kind: true, parentId: true, headId: true, name: true, active: true } }),
    db.team.findUnique({ where: { id: TOP_TEAM }, select: { leaderId: true, members: { select: { personId: true } } } }),
    ownerSlugs(db),
  ]);
  const units = new Map(unitRows.map((u) => [u.id, u]));
  const topIds = new Set([...(top?.leaderId ? [top.leaderId] : []), ...(top?.members.map((m) => m.personId) ?? [])]);
  const company = unitRows.find((u) => u.kind === "COMPANY") ?? null;
  return { access, units, topIds, ceoId: company?.headId ?? null, owners, fullUnits: new Set(access.full.units ?? (await defaultFullUnits(db, units, top?.leaderId ?? null))) };
}

/** По умолчанию все цифры у департамента руководителя топ-команды: подразделение, которым он руководит, иначе его департамент */
async function defaultFullUnits(db: Db, units: Map<string, UnitRow>, leaderId: string | null): Promise<string[]> {
  if (!leaderId) return [];
  const headed = [...units.values()].find((u) => u.headId === leaderId && u.kind === "DEPARTMENT");
  if (headed) return [headed.id];
  const leader = await db.person.findUnique({ where: { id: leaderId }, select: { unitId: true } });
  const dep = departmentOf(units, leader?.unitId ?? null);
  return dep && dep.kind !== "COMPANY" ? [dep.id] : [];
}

/** Подразделение человека лежит в одной из веток */
function within(units: Map<string, UnitRow>, unitId: string | null, roots: Set<string>): boolean {
  if (!roots.size || !unitId) return false;
  const seen = new Set<string>();
  for (let cur = units.get(unitId); cur && !seen.has(cur.id); cur = cur.parentId ? units.get(cur.parentId) : undefined) {
    if (roots.has(cur.id)) return true;
    seen.add(cur.id);
  }
  return false;
}

/** Топ-менеджмент: руководители департаментов и подразделений прямо под компанией */
function isTopManager(units: Map<string, UnitRow>, personId: string): boolean {
  for (const u of units.values()) {
    if (u.headId !== personId) continue;
    if (u.kind === "COMPANY" || u.kind === "DEPARTMENT") return true;
    const parent = u.parentId ? units.get(u.parentId) : undefined;
    if (parent?.kind === "COMPANY") return true;
  }
  return false;
}

function levelIn(ctx: Ctx, p: { id: string; slug: string; role: string; unitId: string | null }, management?: string | null): NumbersLevel {
  if (management || p.role === "OWNER" || p.role === "ADMIN") return "full";
  if (ctx.topIds.has(p.id) || ctx.ceoId === p.id || ctx.owners.has(p.slug) || ctx.access.full.people.includes(p.slug)) return "full";
  if (within(ctx.units, p.unitId, ctx.fullUnits)) return "full";
  if (ctx.access.summary.topManagement && isTopManager(ctx.units, p.id)) return "summary";
  if (ctx.access.summary.people.includes(p.slug) || within(ctx.units, p.unitId, new Set(ctx.access.summary.units))) return "summary";
  return "none";
}

export async function numbersLevel(who: Who, db: Db = prisma): Promise<NumbersLevel> {
  if (who.management || who.role === "OWNER" || who.role === "ADMIN") return "full";
  const [ctx, person] = await Promise.all([loadCtx(db), db.person.findUnique({ where: { id: who.personId }, select: { id: true, slug: true, role: true, unitId: true, active: true } })]);
  if (!person?.active) return "none";
  return levelIn(ctx, person, who.management);
}

/** Все цифры: действия прогноза, выгрузка, вкладки с драйверами и партнёрами */
export async function canSeeNumbers(who: Who, db: Db = prisma): Promise<boolean> {
  return (await numbersLevel(who, db)) === "full";
}

/** Обёртка серверных действий прогноза: без нужного уровня действие отказывает, даже если его вызвали в обход экрана */
export async function withNumbers<T>(actor: Actor, fn: () => Promise<T> | T, need: Exclude<NumbersLevel, "none"> = "full"): Promise<T> {
  const level = await numbersLevel(actor);
  if (level === "none" || (need === "full" && level !== "full")) throw new TaskRuleError(level === "summary" ? NUMBERS_SUMMARY_TEXT : NUMBERS_CLOSED_TEXT);
  return fn();
}

/**
 * Итог месяца для уровня «основные цифры»: без корректировок драйверов и партнёров (кто, что и почему поправил).
 * Режется на сервере: объект целиком уходит в данные страницы, спрятать списки в компоненте мало
 */
export function summaryBrief<T extends PlanBrief | null>(brief: T): T {
  if (!brief) return brief;
  return { ...brief, reasons: [], partnerReasons: [], partnersMore: 0 };
}

/** Итог месяца по уровню: все цифры как есть, основные без корректировок, иначе ничего */
export function briefFor(level: NumbersLevel, brief: PlanBrief | null): PlanBrief | null {
  return level === "full" ? brief : level === "summary" ? summaryBrief(brief) : null;
}

// ---------- Настройка (владелец в режиме управления) ----------

export type NumbersAccessView = {
  access: NumbersAccess & { full: { units: string[]; people: string[] } };
  departments: { id: string; name: string }[];
  people: { slug: string; name: string; hint: string | null }[];
  counts: { full: number; summary: number };
  /** Департаменты и люди из настройки, которых больше нет в структуре: их цифры молча закрылись бы */
  stale: number;
};

/** Департаменты для выбора: уровень «департамент» и подразделения прямо под компанией */
function departmentsOf(units: UnitRow[]): { id: string; name: string }[] {
  const company = units.find((u) => u.kind === "COMPANY");
  return units.filter((u) => u.kind === "DEPARTMENT" || (company && u.parentId === company.id)).map((u) => ({ id: u.id, name: u.name }));
}

export async function numbersAccessView(db: Db = prisma): Promise<NumbersAccessView> {
  const ctx = await loadCtx(db);
  const [people, unitRows] = await Promise.all([
    db.person.findMany({ where: { active: true }, select: { id: true, slug: true, role: true, unitId: true, fullName: true, position: true }, orderBy: { fullName: "asc" } }),
    db.orgUnit.findMany({ where: { active: true }, select: { id: true, kind: true, parentId: true, headId: true, name: true, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const counts = { full: 0, summary: 0 };
  for (const p of people) {
    const level = levelIn(ctx, p);
    if (level !== "none") counts[level] += 1;
  }
  const departments = departmentsOf(unitRows);
  const knownUnits = new Set(departments.map((d) => d.id));
  const knownPeople = new Set(people.map((p) => p.slug));
  const units = [...(ctx.access.full.units ?? []), ...ctx.access.summary.units];
  const slugs = [...ctx.access.full.people, ...ctx.access.summary.people];
  const stale = units.filter((id) => !knownUnits.has(id)).length + slugs.filter((s) => !knownPeople.has(s)).length;
  return {
    // В форме только то, что есть в структуре: при сохранении устаревшие ссылки уходят
    access: {
      full: { units: [...ctx.fullUnits].filter((id) => knownUnits.has(id)), people: ctx.access.full.people.filter((s) => knownPeople.has(s)) },
      summary: { ...ctx.access.summary, units: ctx.access.summary.units.filter((id) => knownUnits.has(id)), people: ctx.access.summary.people.filter((s) => knownPeople.has(s)) },
    },
    departments,
    people: people.map((p) => ({ slug: p.slug, name: p.fullName, hint: p.position })),
    counts,
    stale,
  };
}

export async function saveNumbersAccess(actor: Actor, input: { full: { units: string[]; people: string[] }; summary: { topManagement: boolean; units: string[]; people: string[] } }): Promise<NumbersAccessView> {
  if (actor.management !== "OWNER" || actor.role === "OBSERVER") throw new TaskRuleError("Доступ к цифрам настраивает владелец в режиме управления");
  const units = await prisma.orgUnit.findMany({ where: { active: true }, select: { id: true, kind: true, parentId: true, headId: true, name: true, active: true } });
  const known = new Map(departmentsOf(units).map((d) => [d.id, d.name]));
  const people = new Map((await prisma.person.findMany({ where: { active: true }, select: { slug: true, fullName: true } })).map((p) => [p.slug, p.fullName]));
  const unitsOf = (v: unknown) => strings(v).filter((id) => known.has(id));
  const peopleOf = (v: unknown) => strings(v).filter((s) => people.has(s));
  const next: NumbersAccess = {
    full: { units: unitsOf(input?.full?.units), people: peopleOf(input?.full?.people) },
    summary: { topManagement: input?.summary?.topManagement !== false, units: unitsOf(input?.summary?.units), people: peopleOf(input?.summary?.people) },
  };
  await prisma.$transaction(async (tx) => {
    const before = await loadNumbersAccess(tx);
    await tx.setting.upsert({ where: { key: NUMBERS_ACCESS_KEY }, update: { value: next }, create: { key: NUMBERS_ACCESS_KEY, value: next } });
    const names = (ids: string[] | null, map: Map<string, string>) => (ids === null ? "по умолчанию" : ids.map((id) => map.get(id) ?? id).join(", ") || "никого");
    const lines: [string, string, string][] = [
      ["Все цифры: департаменты", names(before.full.units, known), names(next.full.units, known)],
      ["Все цифры: люди", names(before.full.people, people), names(next.full.people, people)],
      ["Основные цифры: топ-менеджмент", before.summary.topManagement ? "да" : "нет", next.summary.topManagement ? "да" : "нет"],
      ["Основные цифры: департаменты", names(before.summary.units, known), names(next.summary.units, known)],
      ["Основные цифры: люди", names(before.summary.people, people), names(next.summary.people, people)],
    ];
    for (const [field, from, to] of lines) {
      if (from === to) continue;
      await tx.auditLog.create({
        data: { action: "settings.numbersAccess", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "settings", entityId: NUMBERS_ACCESS_KEY, field: `Доступ к цифрам: ${field}`, before: from.slice(0, 1000), after: to.slice(0, 1000), ip: actor.ip ?? null, ...auditVia(actor) },
      });
    }
  });
  return numbersAccessView();
}
