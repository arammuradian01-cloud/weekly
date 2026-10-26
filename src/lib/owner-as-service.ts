// «Сменить профиль» у владельца на сервере (этап 71): кого можно выбрать, начало и конец входа в чужой профиль с записью
// в журнал. Сама cookie сессии пишется во входе и в действиях (src/lib/auth.ts, src/app/actions/owner-as.ts), правила
// и срок в src/lib/owner-as.ts.

import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import { TaskRuleError } from "./rule-error";
import { formatTime } from "./week";
import type { OwnerAsGrant } from "./session";
import { OWNER_AS_END_TEXTS, ownerAsStartError, ownerAsUntil, type OwnerAsEnd } from "./owner-as";
import type { ViewAsPerson } from "./view-as-service";
import type { LoginMethod, Role } from "@/generated/prisma/enums";

/** Кто входит: профиль владельца, запись устройства личного входа, как вошёл, идёт ли просмотр или уже такой вход */
export type OwnerAsOwner = {
  person: { id: string; slug: string; fullName: string; role: Role };
  sid: string | undefined;
  via: LoginMethod;
  viewing: boolean;
  inside: boolean;
  ip?: string | null;
};

function startCheck(owner: OwnerAsOwner) {
  return { personId: owner.person.id, role: owner.person.role, personal: !!owner.sid && owner.via !== "TEAM" && owner.via !== "OWNER_AS", byEmail: owner.via === "EMAIL", viewing: owner.viewing, inside: owner.inside };
}

/** Можно ли владельцу открыть выбор: те же правила, что у входа, без выбранного человека */
export function canOwnerAs(owner: OwnerAsOwner): boolean {
  return ownerAsStartError(startCheck(owner), { id: "", active: true, role: "LEADER" }) === null;
}

/**
 * Кого можно выбрать: все включённые люди структуры, кроме самого владельца и других владельцев, по алфавиту. Должность
 * и подразделение по структуре для поиска, кадровых полей нет
 */
export async function ownerAsPeople(owner: OwnerAsOwner): Promise<ViewAsPerson[]> {
  const error = ownerAsStartError(startCheck(owner), { id: "", active: true, role: "LEADER" });
  if (error) throw new TaskRuleError(error);
  const rows = await prisma.person.findMany({
    where: { active: true, role: { not: "OWNER" }, id: { not: owner.person.id } },
    select: { id: true, slug: true, fullName: true, position: true, unit: { select: { name: true } } },
    orderBy: [{ fullName: "asc" }],
  });
  return rows.map((p) => ({ id: p.id, slug: p.slug, fullName: p.fullName, position: p.position, unit: p.unit?.name ?? null }));
}

/** В чей профиль входят: правила входа. Ошибка правила текстом для человека */
export async function ownerAsTarget(owner: OwnerAsOwner, targetId: string): Promise<{ id: string; slug: string; fullName: string }> {
  const found = targetId ? await prisma.person.findUnique({ where: { id: String(targetId) }, select: { id: true, slug: true, fullName: true, active: true, role: true } }) : null;
  const error = ownerAsStartError(startCheck(owner), found);
  if (error) throw new TaskRuleError(error);
  return { id: found!.id, slug: found!.slug, fullName: found!.fullName };
}

/**
 * Начать вход (после ownerAsTarget): срок 12 часов и запись «ownerAs.start» в журнал от имени владельца, в чей профиль
 * он вошёл. Возвращает данные для подписанной cookie сессии. Запись идёт напрямую, без writeAudit, который глотает
 * ошибки: не записалось начало, и входа нет (ошибка уходит вызвавшему, сессию с ownerAs он не выдаёт)
 */
export async function beginOwnerAs(owner: OwnerAsOwner, target: { id: string; slug: string; fullName: string }, now = new Date()): Promise<OwnerAsGrant> {
  const until = ownerAsUntil(now.getTime());
  const id = randomUUID();
  await prisma.auditLog.create({
    data: {
      action: "ownerAs.start",
      actorId: owner.person.id,
      actorName: owner.person.fullName,
      source: "APP",
      entity: "person",
      entityId: target.slug,
      field: "Вход владельца в профиль",
      // Номер входа: по нему конец входа пишется один раз. Экран журнала его не показывает
      before: id,
      after: `${target.fullName}, до ${formatTime(new Date(until))}`,
      ip: owner.ip ?? null,
      via: owner.via,
    },
  });
  return { id, targetId: target.id, until };
}

/** Номера входов, конец которых уже записан этим процессом, и записи, которые идут сейчас */
const ENDED = new Map<string, OwnerAsEnd>();
const WRITING = new Map<string, Promise<void>>();

/**
 * Конец входа: запись «ownerAs.stop» в журнал от имени владельца с тем, в чей профиль он входил, и причиной в поле
 * записи (вернулся, выход, срок, человека выключили, роль, владельца выключили, вход завершён). Один раз на вход: если
 * конец этого входа уже записан, второй записи нет. Закончившийся вход видит каждый запрос: одновременные запросы этого
 * процесса ждут одну запись
 */
export async function endOwnerAs(owner: { id: string; fullName: string }, grant: Pick<OwnerAsGrant, "id" | "targetId">, reason: OwnerAsEnd, meta: { ip?: string | null; via?: LoginMethod | null } = {}): Promise<void> {
  if (ENDED.has(grant.id)) return;
  const running = WRITING.get(grant.id);
  if (running) return running;
  const write = recordEnd(owner, grant, reason, meta).finally(() => WRITING.delete(grant.id));
  WRITING.set(grant.id, write);
  return write;
}

async function recordEnd(owner: { id: string; fullName: string }, grant: Pick<OwnerAsGrant, "id" | "targetId">, reason: OwnerAsEnd, meta: { ip?: string | null; via?: LoginMethod | null }): Promise<void> {
  if (await ownerAsEndRecorded(owner.id, grant)) return;
  const target = await prisma.person.findUnique({ where: { id: grant.targetId }, select: { slug: true, fullName: true } });
  // Напрямую, без writeAudit: не записался конец, и ошибка уходит вызвавшему, сессия с ownerAs остаётся до повторной попытки
  await prisma.auditLog.create({
    data: {
      action: "ownerAs.stop",
      actorId: owner.id,
      actorName: owner.fullName,
      source: "APP",
      entity: "person",
      entityId: target?.slug ?? grant.targetId,
      field: OWNER_AS_END_TEXTS[reason],
      before: grant.id,
      after: target?.fullName ?? "человек удалён",
      ip: meta.ip ?? null,
      via: meta.via ?? null,
    },
  });
  ENDED.set(grant.id, reason);
}

/**
 * Записан ли уже конец этого входа, и с какой причиной. Записанный конец окончателен: если причина ушла (человека снова
 * включили), вход не продолжается, журналу и экрану не расходиться
 */
export async function ownerAsEndRecorded(ownerId: string, grant: Pick<OwnerAsGrant, "id">): Promise<OwnerAsEnd | null> {
  const known = ENDED.get(grant.id);
  if (known) return known;
  const row = await prisma.auditLog.findFirst({ where: { action: "ownerAs.stop", actorId: ownerId, entity: "person", before: { equals: grant.id } }, select: { field: true } });
  if (!row) return null;
  const reason = (Object.entries(OWNER_AS_END_TEXTS) as [OwnerAsEnd, string][]).find(([, text]) => text === row.field)?.[0] ?? "return";
  ENDED.set(grant.id, reason);
  return reason;
}
