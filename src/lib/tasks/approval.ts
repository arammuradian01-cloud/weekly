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
import { taskSubject } from "@/lib/inbox/notify";
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
type PersonLite = { id: string; fullName: string; unitId: string | null; managerId: string | null; active: boolean };
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
    db.person.findMany({ select: { id: true, fullName: true, unitId: true, managerId: true, active: true } }),
    db.orgUnit.findMany({ where: { active: true }, select: { id: true, kind: true, parentId: true, headId: true, name: true } }),
  ]);
  return { setting, people: new Map(people.map((p) => [p.id, p])), units: new Map(units.map((u) => [u.id, u])) };
}

// В одной транзакции люди и структура между проверками не меняются: разбор встречи на десятки задач или массовая
// смена ответственного грузят их один раз. Общий клиент не кешируем: между запросами структура меняется
const cache = new WeakMap<object, Promise<Ctx>>();

/** Структуру поменяли внутри транзакции: следующая проверка правила в ней читает людей и подразделения заново */
export function forgetApprovalCtx(db: Db): void {
  cache.delete(db);
}

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
 * Структура поменялась: у задач, которые ждут согласования, согласованы или о которых руководитель проинформирован,
 * согласующий пересчитывается по автору задачи для правила. Новый согласующий получает событие в «Мне», у прежнего
 * события разобраны, смена в журнале задачи. Правило больше не срабатывает (человек перешёл в департамент автора):
 * отметка снимается, задача на согласовании ждёт обычного решения адресата. Передачу, которая ждала решения, а новый
 * ответственный выключен, возвращаем прежнему ответственному. Автор неизвестен: задачу не трогаем.
 * Изменения пишутся пачками: выключение руководителя с сотнями задач укладывается в транзакцию.
 * Возвращает, у скольких задач что-то поменялось
 */
export async function refreshApprovals(tx: Prisma.TransactionClient, actor: Who, now = new Date()): Promise<number> {
  forgetApprovalCtx(tx);
  const rows = await tx.task.findMany({
    where: { approvalState: { in: ["PENDING", "INFORMED", "APPROVED"] }, archivedAt: null, status: { notIn: ["DONE", "PARTIAL", "FAILED", "CANCELLED"] } },
    select: { id: true, number: true, ownerId: true, approvalAuthorId: true, createdById: true, approverId: true, approvalState: true, approvalFromId: true, approvalFromStatus: true, approvalFromAll: true },
  });
  if (!rows.length) return 0;
  const ctx = await loadCtx(tx);
  const nameOf = (id: string | null | undefined) => (id ? (ctx.people.get(id)?.fullName ?? "") : "");
  const moves = new Map<string, { from: string | null; to: string; rows: typeof rows }>();
  const cleared: typeof rows = [];
  const reverted: typeof rows = [];
  for (const row of rows) {
    // Передача ждала решения, а нового ответственного выключили: задача возвращается тому, у кого была
    if (row.approvalState === "PENDING" && row.approvalFromStatus && row.ownerId && !ctx.people.get(row.ownerId)?.active) {
      reverted.push(row);
      continue;
    }
    // Автор для правила: сохранённый, у задач до этого поля тот, кто поставил. Задача из Bord без автора не трогается
    const author = row.approvalAuthorId ?? row.createdById;
    if (!author || !row.ownerId) continue;
    const rule = ruleIn(ctx, author, row.ownerId, []);
    const approverId = rule?.approverId ?? null;
    if (approverId === row.approverId) continue;
    if (!approverId) {
      cleared.push(row);
      continue;
    }
    const key = `${row.approverId ?? ""}|${approverId}`;
    const group = moves.get(key) ?? { from: row.approverId, to: approverId, rows: [] };
    group.rows.push(row);
    moves.set(key, group);
  }
  const audit: Prisma.AuditLogCreateManyInput[] = [];
  const line = (number: number, field: string, before: string, after: string): Prisma.AuditLogCreateManyInput => ({
    action: "task.approval",
    actorId: actor.personId,
    actorName: actor.fullName,
    source: "APP",
    entity: "task",
    entityId: String(number),
    field,
    before,
    after,
  });
  const events: Prisma.InboxEventCreateManyInput[] = [];
  const event = (recipientId: string, row: { id: string; number: number }, text: string): Prisma.InboxEventCreateManyInput => ({
    recipientId,
    kind: "APPROVAL",
    actorId: actor.personId,
    actorName: actor.fullName,
    subject: taskSubject(row.number),
    taskId: row.id,
    text,
    createdAt: now,
  });
  // Новый согласующий: условие на прежнего, чтобы одновременное решение по задаче не перетёрлось
  for (const g of moves.values()) {
    const ids = g.rows.map((r) => r.id);
    const done = await tx.task.updateMany({ where: { id: { in: ids }, approverId: g.from }, data: { approverId: g.to } });
    if (!done.count) continue;
    await tx.inboxEvent.updateMany({ where: { taskId: { in: ids }, kind: "APPROVAL", doneAt: null, NOT: { recipientId: g.to } }, data: { doneAt: now } });
    await tx.taskWatch.createMany({ data: ids.map((taskId) => ({ taskId, personId: g.to })), skipDuplicates: true });
    for (const r of g.rows) {
      events.push(
        event(
          g.to,
          r,
          r.approvalState === "PENDING"
            ? "Теперь вы согласуете задачу из другого департамента для вашего сотрудника: согласуйте или отклоните"
            : "Задача из другого департамента для вашего сотрудника: теперь вы её видите, решать ничего не нужно",
        ),
      );
      audit.push(line(r.number, "Согласующий", g.from ? nameOf(g.from) : "нет", nameOf(g.to)));
    }
  }
  if (cleared.length) {
    const ids = cleared.map((r) => r.id);
    await tx.task.updateMany({ where: { id: { in: ids } }, data: { approverId: null, approvalState: null, approvalFromId: null, approvalFromStatus: null, approvalFromAll: false } });
    await tx.inboxEvent.updateMany({ where: { taskId: { in: ids }, kind: "APPROVAL", doneAt: null }, data: { doneAt: now } });
    for (const r of cleared) audit.push(line(r.number, "Согласующий", nameOf(r.approverId) || "нет", r.approvalState === "PENDING" ? "не нужен: задача ждёт решения ответственного" : "не нужен"));
  }
  for (const r of reverted) {
    const back = r.approvalFromStatus ?? "IN_PROGRESS";
    await tx.task.update({
      where: { id: r.id },
      data: { ownerId: r.approvalFromId, ownerAll: r.approvalFromAll, status: back, approverId: null, approvalState: null, approvalFromId: null, approvalFromStatus: null, approvalFromAll: false },
    });
    if (r.approvalFromId) await tx.taskCoExecutor.deleteMany({ where: { taskId: r.id, personId: r.approvalFromId } });
    await tx.inboxEvent.updateMany({ where: { taskId: r.id, kind: "APPROVAL", doneAt: null }, data: { doneAt: now } });
    if (r.approvalFromId && ctx.people.get(r.approvalFromId)?.active) events.push({ ...event(r.approvalFromId, r, "Нового ответственного выключили, пока передача ждала согласования: задача снова у вас"), kind: "TASK_ASSIGNED" });
    audit.push(line(r.number, "Ответственный", nameOf(r.ownerId), r.approvalFromAll ? "Все лидеры" : nameOf(r.approvalFromId) || "нет"));
    audit.push(line(r.number, "Согласование", "Ждёт согласования передачи", "Передача отменена: нового ответственного выключили"));
  }
  // События только включённым людям и не самому автору правки, как в notify
  const live = events.filter((e) => e.recipientId !== actor.personId && ctx.people.get(e.recipientId)?.active);
  if (live.length) await tx.inboxEvent.createMany({ data: live });
  if (audit.length) await tx.auditLog.createMany({ data: audit });
  forgetApprovalCtx(tx);
  return [...moves.values()].reduce((n, g) => n + g.rows.length, 0) + cleared.length + reverted.length;
}
