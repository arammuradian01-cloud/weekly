// [Codex] Источник пароля управления задаётся отдельно каждому владельцу. По умолчанию прежний общий пароль.
import { randomUUID } from "node:crypto";
import type { Person } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { PASSWORD_SETTING_KEYS, verifyPassword } from "@/lib/passwords";
import { managementPasswordKind, managementRoleFor } from "@/lib/roles";
import type { ManagementGrant } from "@/lib/session";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { formatTime } from "@/lib/week";
import { checkCurrentPassword } from "./password";
import { BUSY_ERROR, markAttemptOk, reserveIpAttempt } from "./attempts";
import { LOCK_MS } from "@/lib/rate-limit";

export type ManagementPasswordMode = "shared" | "personal";
/** broken: настройка в базе повреждена. Управления у такого владельца нет, пока оператор не задаст режим заново */
export type ManagementPasswordPolicy = { mode: ManagementPasswordMode; version: string; broken?: true };
const DEFAULT: ManagementPasswordPolicy = { mode: "shared", version: "default" };
export const POLICY_BROKEN = "Настройка пароля управления повреждена. Обратитесь к владельцу сервера";
const policyKey = (id: string) => `auth.management.person.${id}`;
const fail = (message: string): never => { throw new TaskRuleError(message); };

/**
 * Политика из настройки. Повреждённая настройка не роняет каждую страницу ошибкой 500 (политику читает каждый запрос
 * владельца в режиме управления): безопасный режим по умолчанию, личный пароль без общего и без действующих grant,
 * то есть управления нет, пока режим не задан заново командой npm run management-password. Ошибка в журнал сервера
 */
function readPolicy(value: unknown, key = ""): ManagementPasswordPolicy {
  if (value == null) return DEFAULT;
  const p = value as Partial<ManagementPasswordPolicy>;
  if ((p.mode !== "shared" && p.mode !== "personal") || typeof p.version !== "string" || !p.version) {
    console.error("Настройка пароля управления повреждена, управление владельца закрыто до новой настройки", key);
    return { mode: "personal", version: "broken", broken: true };
  }
  return { mode: p.mode, version: p.version };
}

export async function managementPasswordPolicy(person: Pick<Person, "id" | "role">): Promise<ManagementPasswordPolicy> {
  return person.role === "OWNER" ? readPolicy(await getSetting<unknown>(policyKey(person.id), null), policyKey(person.id)) : DEFAULT;
}

// В cookie только несекретные версии: ни пароль, ни хэш в неё не попадают.
export function managementCredential(person: Pick<Person, "passwordSetAt">, policy: ManagementPasswordPolicy): string {
  return `${policy.mode}/${policy.version}/${policy.mode === "personal" ? person.passwordSetAt?.toISOString() ?? "missing" : ""}`;
}

/** Проверяется при каждом запросе, включая «Смотреть как». Смена режима или личного пароля гасит прежнее управление. */
export async function managementPasswordCurrent(grant: ManagementGrant, person: Person, personal: boolean): Promise<boolean> {
  if (!person.active || managementRoleFor(person.role) !== grant.role) return false;
  const policy = await managementPasswordPolicy(person);
  if (policy.broken) return false;
  if (policy.mode === "personal" && (!personal || !person.passwordHash || !person.passwordSetAt)) return false;
  // Cookie, выданные прежней версией приложения, работают только при неизменённом общем режиме.
  if (grant.credential === undefined) return policy.mode === "shared" && policy.version === "default";
  return grant.credential === managementCredential(person, policy);
}

/** Выбран ровно один источник. PERSONAL никогда не переходит к общему паролю, даже если личный сброшен. */
export async function checkManagementPassword(actor: Actor, deviceId: string | null, password: string, now = new Date()): Promise<string> {
  const person = await prisma.person.findUnique({ where: { id: actor.personId } });
  if (!person?.active || !managementRoleFor(person.role) || person.role !== actor.role) return fail("Права изменились. Обновите страницу");
  const policy = await managementPasswordPolicy(person);
  if (policy.broken) return fail(POLICY_BROKEN);
  if (policy.mode === "personal") {
    if (!deviceId || !actor.via || actor.via === "TEAM") return fail("Войдите со своим личным логином и паролем, затем включите управление");
    const device = await prisma.deviceSession.findUnique({ where: { id: deviceId } });
    if (!device || device.personId !== person.id || device.revokedAt || device.expiresAt <= now) return fail("Личный вход завершён. Войдите заново");
    if (!person.passwordHash || !person.passwordSetAt) return fail("Личный пароль ещё не задан. Сначала установите его по ссылке для входа");
    // Общий с личным входом лимит по человеку и IP; отсутствие хэша проверено выше.
    await checkCurrentPassword(actor, person, password, now);
  } else {
    const kind = managementPasswordKind(managementRoleFor(person.role)!);
    const hash = await getSetting<string | null>(PASSWORD_SETTING_KEYS[kind], null);
    if (!hash) return fail(`Пароль режима управления ещё не задан. Владелец задаёт его командой npm run password -- ${kind}`);
    const reserved = await reserveIpAttempt(actor.ip ?? "unknown", "MANAGEMENT", now).catch(() => null);
    if (!reserved) return fail(BUSY_ERROR);
    if (!reserved.ok) return fail(`Слишком много неверных попыток. Попробовать снова можно в ${formatTime(reserved.until)}`);
    if (!(await verifyPassword(password, hash))) {
      const left = reserved.remaining - 1;
      return fail(left > 0 ? `Неверный пароль. Осталось попыток: ${left}` : `Неверный пароль. Вход закрыт на 15 минут, до ${formatTime(new Date(now.getTime() + LOCK_MS))}`);
    }
    await markAttemptOk(prisma, reserved.attemptId);
  }
  return managementCredential(person, policy);
}

/** Служебная настройка без чтения/копирования паролей. Только явная команда оператора; автоматической активации нет. */
export async function setManagementPasswordMode(slug: string, mode: ManagementPasswordMode) {
  if (mode !== "personal" && mode !== "shared") return fail("Режим: personal или shared");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM people WHERE slug = ${slug} FOR UPDATE`;
    const person = await tx.person.findUnique({ where: { slug } });
    if (!person?.active || person.role !== "OWNER") return fail("Нужен включённый владелец");
    if (mode === "personal" && (!person.passwordHash || !person.passwordSetAt)) return fail("У владельца ещё нет личного пароля");
    const key = policyKey(person.id);
    const before = readPolicy((await tx.setting.findUnique({ where: { key } }))?.value, key);
    // Повреждённую настройку команда перезаписывает: так оператор возвращает владельцу управление
    if (before.mode === mode && !before.broken) return { fullName: person.fullName, mode, changed: false };
    const after: ManagementPasswordPolicy = { mode, version: randomUUID() };
    await tx.setting.upsert({ where: { key }, create: { key, value: after }, update: { value: after } });
    await tx.auditLog.create({ data: { source: "SYSTEM", action: "management.password-mode", entity: "person", entityId: person.slug, field: person.fullName, before: before.broken ? "повреждена" : before.mode, after: mode } });
    return { fullName: person.fullName, mode, changed: true };
  });
}
