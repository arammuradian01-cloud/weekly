// Согласование и информирование (этап 54). Решение Арама 21.10: задача человеку из другого департамента проходит
// согласование его руководителя или руководитель о ней узнаёт, чтобы всегда понимать, чем занят его сотрудник.
// Где что включено, задаёт владелец в режиме управления: правило по умолчанию и отдельно для департаментов.
//
// Как устроено:
// - департамент человека: ближайшее подразделение уровня «департамент» над его местом в структуре; подразделение
//   прямо под компанией (клиентский сервис, HR) считается своим департаментом. Ответственный без места в структуре
//   правило не включает: непонятно, чей он. Автор без места в структуре или в выключенном подразделении считается
//   человеком из другого департамента;
// - правило выбирается по департаменту ответственного: принимающая сторона решает, как к ней приходят задачи;
// - не срабатывает, когда ставит руководитель ответственного по линии подчинения (выключенный руководитель в линии
//   её не рвёт), и когда ставят себе;
// - согласует административный руководитель ответственного, если он включён; иначе руководитель ближайшего
//   подразделения выше. Если согласовать должен тот же человек, кто ставит, согласование не нужно;
// - «Согласование»: задача приходит предложенной, принять её может только согласующий (или режим управления), сам
//   ответственный ждёт. «Информирование»: задача ставится как обычно, руководитель получает событие в «Мне».
// - структура поменялась (загрузка, человека выключили, сменили руководителя): согласующий у задач, которые ждут
//   решения или о которых руководитель проинформирован, пересчитывается (refreshApprovals).

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { notify, taskSubject } from "@/lib/inbox/notify";
import { APPROVAL_KEY, approvalSettingOf, type ApprovalMode, type ApprovalSetting } from "./approval-modes";

type Db = Prisma.TransactionClient | typeof prisma;

export { APPROVAL_KEY, APPROVAL_MODES, APPROVAL_MODE_LABELS, DEFAULT_APPROVAL, approvalSettingOf, type ApprovalMode, type ApprovalSetting } from "./approval-modes";

export async function loadApprovalSetting(db: Db = prisma): Promise<ApprovalSetting> {
  const row = await db.setting.findUnique({ where: { key: APPROVAL_KEY } });
  return approvalSettingOf(row?.value);
}

/** Все правила выключены: людей и структуру можно не грузить */
const allOff = (s: ApprovalSetting) => s.default === "off" && Object.values(s.departments).every((m) => m === "off");

type UnitLite = { id: string; kind: string; parentId: string | null; headId: string | null; name: string };
type PersonLite = { id: string; unitId: string | null; managerId: string | null; active: boolean };
type Ctx = { setting: ApprovalSetting; people: Map<string, PersonLite>; units: Map<string, UnitLite> };

/** Департамент подразделения: уровень «департамент» выше по дереву, иначе подразделение прямо под компанией */
export function departmentOf(units: Map<string, UnitLite>, unitId: string | null): UnitLite | null {
  let cur = unitId ? units.get(unitId) : undefined;
  const seen = new Set<string>();
  let underCompany: UnitLite | null = null;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.kind === "DEPARTMENT") return cur;
    if (cur.kind === "COMPANY") return underCompany ?? cur;
    const parent: UnitLite | undefined = cur.parentId ? units.get(cur.parentId) : undefined;
    if (parent?.kind === "COMPANY") underCompany = cur;
    if (!parent) return underCompany ?? cur;
    cur = parent;
  }
  return underCompany;
}

async function loadCtx(db: Db): Promise<Ctx> {
  const [setting, people, units] = await Promise.all([
    loadApprovalSetting(db),
    // Все люди, и выключенные: линия подчинения идёт и через выключенного руководителя
    db.person.findMany({ select: { id: true, unitId: true, managerId: true, active: true } }),
    db.orgUnit.findMany({ where: { active: true }, select: { id: true, kind: true, parentId: true, headId: true, name: true } }),
  ]);
  return { setting, people: new Map(people.map((p) => [p.id, p])), units: new Map(units.map((u) => [u.id, u])) };
}

// В одной транзакции люди и структура между проверками не меняются: разбор встречи на десятки задач или массовая
// смена ответственного грузят их один раз. Общий клиент не кешируем: между запросами структура меняется
const cache = new WeakMap<object, Promise<Ctx>>();
function ctxFor(db: Db): Promise<Ctx> {
  if (db === prisma) return loadCtx(db);
  let p = cache.get(db);
  if (!p) {
    p = loadCtx(db);
    cache.set(db, p);
  }
  return p;
}

/** Кто согласует задачи человека: включённый руководитель, иначе руководитель ближайшего подразделения выше */
function approverOf(ctx: Ctx, owner: PersonLite): string | null {
  const manager = owner.managerId ? ctx.people.get(owner.managerId) : undefined;
  if (manager?.active) return manager.id;
  const seen = new Set<string>();
  for (let cur = owner.unitId ? ctx.units.get(owner.unitId) : undefined; cur && !seen.has(cur.id); cur = cur.parentId ? ctx.units.get(cur.parentId) : undefined) {
    seen.add(cur.id);
    if (cur.headId && cur.headId !== owner.id && ctx.people.get(cur.headId)?.active) return cur.headId;
  }
  return null;
}

export type ApprovalRule = { mode: Exclude<ApprovalMode, "off">; approverId: string; department: string };

function ruleIn(ctx: Ctx, creatorId: string, ownerId: string, exempt: string[]): ApprovalRule | null {
  const owner = ctx.people.get(ownerId);
  if (!owner?.active || !owner.unitId) return null;
  // Руководитель по линии подчинения ставит своим людям без согласования, и тот, кто передаёт задачу, тоже
  const bosses = new Set([creatorId, ...exempt]);
  const seen = new Set<string>();
  for (let cur = owner.managerId; cur && !seen.has(cur); cur = ctx.people.get(cur)?.managerId ?? null) {
    if (bosses.has(cur)) return null;
    seen.add(cur);
  }
  const to = departmentOf(ctx.units, owner.unitId);
  if (!to) return null;
  const creator = ctx.people.get(creatorId);
  const from = creator?.unitId ? departmentOf(ctx.units, creator.unitId) : null;
  if (from && from.id === to.id) return null;
  const mode = ctx.setting.departments[to.id] ?? ctx.setting.default;
  if (mode === "off") return null;
  const approverId = approverOf(ctx, owner);
  if (!approverId || bosses.has(approverId) || approverId === ownerId) return null;
  return { mode, approverId, department: to.name };
}

/**
 * Нужно ли согласование или информирование для задачи автора creatorId человеку ownerId. exempt: кто ещё не требует
 * согласования, если он руководитель ответственного по линии (тот, кто передаёт задачу). null: правило не срабатывает
 */
export async function approvalRule(db: Db, creatorId: string, ownerId: string | null, exempt: string[] = []): Promise<ApprovalRule | null> {
  if (!ownerId || ownerId === creatorId || exempt.includes(ownerId)) return null;
  // Быстрый выход без загрузки людей: всё выключено
  if (!cache.has(db) && allOff(await loadApprovalSetting(db))) return null;
  const ctx = await ctxFor(db);
  if (allOff(ctx.setting)) return null;
  return ruleIn(ctx, creatorId, ownerId, exempt);
}

/** Департаменты для настройки: уровень «департамент» и подразделения прямо под компанией, по порядку дерева */
export async function approvalDepartments(db: Db = prisma): Promise<{ id: string; name: string }[]> {
  const units = await db.orgUnit.findMany({ where: { active: true }, select: { id: true, kind: true, parentId: true, name: true, sortOrder: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const company = units.find((u) => u.kind === "COMPANY");
  return units.filter((u) => u.kind === "DEPARTMENT" || (company && u.parentId === company.id)).map((u) => ({ id: u.id, name: u.name }));
}

/** События «Мне» о согласовании задачи у этого человека разобраны: решение принято или согласующий сменился */
export async function closeApprovalEvents(tx: Prisma.TransactionClient, taskId: string, recipientId: string | null | undefined, now = new Date()): Promise<void> {
  if (!recipientId) return;
  await tx.inboxEvent.updateMany({ where: { taskId, recipientId, kind: "APPROVAL", doneAt: null }, data: { doneAt: now } });
}

type Who = { personId: string; fullName: string };

/**
 * Структура поменялась: у задач, которые ждут согласования или о которых руководитель проинформирован, согласующий
 * пересчитывается. Новый согласующий получает событие в «Мне», у прежнего событие разобрано, смена в журнале задачи.
 * Правило больше не срабатывает (человек перешёл в департамент автора): задача ждёт обычного решения адресата.
 * Возвращает, у скольких задач что-то поменялось
 */
export async function refreshApprovals(tx: Prisma.TransactionClient, actor: Who, now = new Date()): Promise<number> {
  const rows = await tx.task.findMany({
    where: { approvalState: { in: ["PENDING", "INFORMED"] }, archivedAt: null, status: { notIn: ["DONE", "PARTIAL", "FAILED", "CANCELLED"] } },
    select: { id: true, number: true, ownerId: true, createdById: true, approverId: true, approvalState: true, approvalFromId: true },
  });
  if (!rows.length) return 0;
  // Свежие люди и структура: в этой же транзакции их только что поменяли
  const ctx = await loadCtx(tx);
  const names = new Map((await tx.person.findMany({ where: { id: { in: [...ctx.people.keys()] } }, select: { id: true, fullName: true } })).map((p) => [p.id, p.fullName]));
  let changed = 0;
  for (const row of rows) {
    const creatorId = row.createdById ?? row.approvalFromId ?? row.ownerId;
    const rule = row.ownerId && creatorId ? ruleIn(ctx, creatorId, row.ownerId, row.approvalFromId ? [row.approvalFromId] : []) : null;
    const approverId = rule?.approverId ?? null;
    if (approverId === row.approverId) continue;
    changed += 1;
    await closeApprovalEvents(tx, row.id, row.approverId, now);
    const data: Prisma.TaskUncheckedUpdateInput = approverId ? { approverId } : { approverId: null, approvalState: null, approvalFromId: null, approvalFromStatus: null };
    await tx.task.update({ where: { id: row.id }, data });
    if (approverId) {
      await tx.taskWatch.createMany({ data: [{ taskId: row.id, personId: approverId }], skipDuplicates: true });
      await notify(
        tx,
        {
          kind: "APPROVAL",
          recipients: [approverId],
          actor,
          subject: taskSubject(row.number),
          taskId: row.id,
          text: row.approvalState === "PENDING" ? "Теперь вы согласуете эту задачу своего сотрудника из другого департамента: согласуйте или отклоните" : "Ваш сотрудник работает над задачей из другого департамента: теперь вы её видите",
        },
        now,
      );
    }
    await tx.auditLog.create({
      data: {
        action: "task.approval",
        actorId: actor.personId,
        actorName: actor.fullName,
        source: "APP",
        entity: "task",
        entityId: String(row.number),
        field: "Согласующий",
        before: row.approverId ? (names.get(row.approverId) ?? "") : "нет",
        after: approverId ? (names.get(approverId) ?? "") : row.approvalState === "PENDING" ? "не нужен: задача ждёт решения ответственного" : "не нужен",
      },
    });
  }
  return changed;
}
