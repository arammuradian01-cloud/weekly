// «Смотреть как» на сервере (этап 63): кого можно выбрать, начало и конец просмотра с записью в журнал. Сама cookie
// подписывается во входе (src/lib/auth.ts), правила и срок в src/lib/view-as.ts.

import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { writeAudit } from "./audit";
import { TaskRuleError } from "./rule-error";
import { formatTime } from "./week";
import type { ManagementGrant } from "./session";
import { VIEW_AS_END_TEXTS, viewAsStartError, viewAsUntil, type ViewAsEnd, type ViewAsToken } from "./view-as";
import type { LoginMethod, Role } from "@/generated/prisma/enums";

/** Строка выбора: ФИО, должность и подразделение по структуре. Кадровых полей нет */
export type ViewAsPerson = { id: string; slug: string; fullName: string; position: string | null; unit: string | null };

/** Кто начинает просмотр: профиль, запись устройства личного входа, режим управления, идёт ли уже просмотр */
export type ViewAsOwner = {
  person: { id: string; slug: string; fullName: string; role: Role };
  sid: string | undefined;
  via: LoginMethod;
  management: ManagementGrant | null;
  viewing: boolean;
  ip?: string | null;
};

function startCheck(owner: ViewAsOwner) {
  return {
    personId: owner.person.id,
    role: owner.person.role,
    personal: !!owner.sid && owner.via !== "TEAM",
    management: owner.management?.role ?? null,
    viewing: owner.viewing,
  };
}

/** Можно ли владельцу открыть выбор: те же правила, что у начала просмотра, без выбранного человека */
export function canViewAs(owner: ViewAsOwner): boolean {
  return viewAsStartError(startCheck(owner), { id: "", active: true }) === null;
}

/** Все включённые люди компании, кроме самого владельца, по алфавиту. Выбор открывает только владелец */
export async function viewAsPeople(owner: ViewAsOwner): Promise<ViewAsPerson[]> {
  const error = viewAsStartError(startCheck(owner), { id: "", active: true });
  if (error) throw new TaskRuleError(error);
  const rows = await prisma.person.findMany({
    where: { active: true, id: { not: owner.person.id } },
    select: { id: true, slug: true, fullName: true, position: true, unit: { select: { name: true } } },
    orderBy: [{ fullName: "asc" }],
  });
  return rows.map((p) => ({ id: p.id, slug: p.slug, fullName: p.fullName, position: p.position, unit: p.unit?.name ?? null }));
}

/** Кого начинают смотреть: правила начала просмотра. Ошибка правила текстом для человека */
export async function viewAsTarget(owner: ViewAsOwner, targetId: string): Promise<{ id: string; slug: string; fullName: string }> {
  const found = targetId ? await prisma.person.findUnique({ where: { id: String(targetId) }, select: { id: true, slug: true, fullName: true, active: true } }) : null;
  const error = viewAsStartError(startCheck(owner), found);
  if (error) throw new TaskRuleError(error);
  return { id: found!.id, slug: found!.slug, fullName: found!.fullName };
}

/**
 * Начать просмотр выбранного (после viewAsTarget): срок (2 часа, не дольше режима управления) и запись «viewAs.start»
 * в журнал с тем, кого смотрят. Возвращает данные для подписанной cookie
 */
export async function beginViewAs(owner: ViewAsOwner, target: { id: string; slug: string; fullName: string }, now = new Date()): Promise<ViewAsToken> {
  const until = viewAsUntil(now.getTime(), owner.management!.until);
  const id = randomUUID();
  await writeAudit({
    action: "viewAs.start",
    actorId: owner.person.id,
    actorName: owner.person.fullName,
    entity: "person",
    entityId: target.slug,
    field: "Смотреть как",
    // Номер просмотра: по нему конец просмотра пишется один раз. Экран журнала его не показывает
    before: id,
    after: `${target.fullName}, до ${formatTime(new Date(until))}`,
    ip: owner.ip ?? null,
    via: owner.via,
  });
  return { id, ownerId: owner.person.id, sid: owner.sid!, targetId: target.id, until, grant: owner.management!.until };
}

/**
 * Конец просмотра: запись «viewAs.stop» в журнал с тем, кого смотрели, и причиной в поле записи (кнопка, выход из
 * ресурса, вышел срок, режим управления, роль, человек выключен, вход завершён). Один раз на просмотр: если конец
 * этого просмотра уже записан, второй записи нет
 */
export async function endViewAs(owner: { id: string; fullName: string }, token: Pick<ViewAsToken, "id" | "targetId">, reason: ViewAsEnd, meta: { ip?: string | null; via?: LoginMethod | null } = {}): Promise<void> {
  const recorded = await prisma.auditLog.findFirst({ where: { action: "viewAs.stop", actorId: owner.id, before: { equals: token.id } }, select: { id: true } });
  if (recorded) return;
  const target = await prisma.person.findUnique({ where: { id: token.targetId }, select: { slug: true, fullName: true } });
  const entityId = target?.slug ?? token.targetId;
  await writeAudit({
    action: "viewAs.stop",
    actorId: owner.id,
    actorName: owner.fullName,
    entity: "person",
    entityId,
    field: VIEW_AS_END_TEXTS[reason],
    before: token.id,
    after: target?.fullName ?? "человек удалён",
    ip: meta.ip ?? null,
    via: meta.via ?? null,
  });
}
