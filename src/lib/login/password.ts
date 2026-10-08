// Личные логины и пароли (этап 20а). Решение Арама 07.10: до входа по корпоративной почте у каждого свой логин
// и пароль.
//
// Как это устроено:
// - логин: короткое имя человека в ресурсе (как в адресах, например reva) или его рабочая почта;
// - пароль задаёт сам человек: владелец выдаёт ему личную ссылку, по ней человек придумывает пароль и сразу входит.
//   Пароль не проходит ни через владельца, ни через переписку. Забыл пароль: владелец выдаёт новую ссылку;
// - владелец может сбросить пароль: старый перестаёт работать, все входы человека завершаются;
// - подбор ограничен: 5 неверных попыток к одному логину закрывают его на 15 минут, с одного адреса не больше
//   30 неверных попыток за 15 минут (офис ходит через один адрес, поэтому этот порог выше). Попытка записывается
//   под замком до сверки пароля, поэтому пачка параллельных запросов пороги не обходит;
// - ответ на неверный логин и на неверный пароль одинаковый, блокировка тоже: незнакомый логин закрывается так же,
//   как настоящий. По ответам не узнать, кто есть в ресурсе.
// После входа на устройстве живёт та же запись DeviceSession на 30 дней, что и при входе по ссылке.

import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { computeLockState, historySince, LOCK_MS } from "@/lib/rate-limit";
import { formatTime } from "@/lib/week";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import type { Person, Prisma } from "@/generated/prisma/client";
import { DEVICE_TTL_MS, INVITE_TTL_MS, hashToken, newToken, type DeviceInfo } from "./service";
import { ATTEMPT_TX, BUSY_ERROR, advisoryLock, markAttemptOk, serialAll } from "./attempts";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export const PERSONAL_MIN_LENGTH = 10;
/** bcrypt учитывает только первые 72 байта: это 72 латинских буквы или 36 русских. Длиннее не принимаем, чтобы хвост пароля не пропадал молча */
export const PERSONAL_MAX_BYTES = 72;
/** Неверных попыток к одному логину до блокировки */
export const PERSON_MAX_FAILURES = 5;
/** Неверных попыток с одного адреса до блокировки: офис ходит через один адрес */
export const IP_MAX_FAILURES = 30;

const COMMON = ["password", "qwerty", "йцукен", "sravni", "weekly", "1q2w3e", "parol", "пароль", "admin", "123qwe"];

/** Логин человека: короткое имя в ресурсе. Его же показываем на экране задания пароля и в профиле */
export function loginOf(person: Pick<Person, "slug">): string {
  return person.slug;
}

/** Проверка нового личного пароля. null: подходит */
export function validatePersonalPassword(password: string, person: Pick<Person, "slug" | "fullName" | "email">): string | null {
  if (password.length < PERSONAL_MIN_LENGTH) return `Пароль должен быть не короче ${PERSONAL_MIN_LENGTH} символов`;
  if (Buffer.byteLength(password, "utf8") > PERSONAL_MAX_BYTES) return "Пароль слишком длинный: не больше 72 латинских букв или 36 русских";
  if (password.trim() !== password) return "Пароль не должен начинаться или заканчиваться пробелом";
  if (/^\d+$/.test(password)) return "Пароль только из цифр слишком простой: добавьте буквы";
  if (/^(.)\1+$/.test(password)) return "Слишком простой пароль";
  const low = password.toLowerCase().replace(/ё/g, "е");
  if (COMMON.some((w) => low.includes(w)) && low.length < 16) return "Слишком простой пароль: не берите слова вроде password, qwerty, sravni";
  const parts = [person.slug, person.email?.split("@")[0] ?? "", ...person.fullName.split(/\s+/)]
    .map((x) => x.toLowerCase().replace(/ё/g, "е"))
    .filter((x) => x.length >= 4);
  if (parts.some((x) => low.includes(x))) return "Пароль не должен содержать ваш логин, имя или фамилию";
  return null;
}

/** Человек по логину: короткое имя или рабочая почта, регистр не важен */
async function personByLogin(login: string) {
  const value = login.trim().toLowerCase();
  if (!value || value.length > 120) return null;
  return prisma.person.findFirst({ where: value.includes("@") ? { email: value } : { slug: value } });
}

type Tx = Prisma.TransactionClient;

const lock = advisoryLock;

/**
 * Ключ счётчика попыток. У известного человека один на короткое имя и почту, у незнакомого логина свой:
 * незнакомый логин закрывается после 5 попыток так же, как настоящий
 */
function attemptKey(person: Pick<Person, "id"> | null, login: string): string {
  return person ? `person:${person.id}` : `login:${login.trim().toLowerCase().slice(0, 120)}`;
}

async function attemptsTx(tx: Tx, where: { ip?: string; login?: string }, now: Date) {
  return tx.loginAttempt.findMany({ where: { kind: "PERSONAL", ...where, at: { gte: historySince(now) } }, select: { at: true, ok: true, blocked: true }, orderBy: { at: "asc" } });
}

type Reserved = { ok: true; attemptId: bigint } | { ok: false; scope: "ip" | "login"; until: Date };

/**
 * Проверка блокировок и запись попытки до сверки пароля, под замками адреса и логина: параллельные запросы видят
 * друг друга и не обходят пороги. Попытка пишется неверной, после верного пароля отмечается успешной (markOk).
 * Счёт адреса обнуляет только время: удачный вход одного человека не списывает чужие неверные попытки с того же адреса
 */
async function reserveAttempt(ip: string, key: string, personId: string | null, now: Date): Promise<Reserved> {
  const ipKey = `password-ip:${ip}`;
  const loginKey = `password-login:${key}`;
  // Сначала очередь в процессе, потом транзакция: ждущие запросы не держат соединения базы (этап 29)
  return serialAll([ipKey, loginKey], () => prisma.$transaction(async (tx): Promise<Reserved> => {
    await lock(tx, ipKey);
    await lock(tx, loginKey);
    const byIp = computeLockState(
      (await attemptsTx(tx, { ip }, now)).filter((a) => !a.blocked && !a.ok),
      now,
      IP_MAX_FAILURES,
    );
    if (byIp.locked && byIp.lockedUntil) {
      await tx.loginAttempt.create({ data: { ip, kind: "PERSONAL", ok: false, blocked: true, login: key, personId, at: now } });
      return { ok: false, scope: "ip", until: byIp.lockedUntil };
    }
    const byLogin = computeLockState(
      (await attemptsTx(tx, { login: key }, now)).filter((a) => !a.blocked),
      now,
      PERSON_MAX_FAILURES,
    );
    if (byLogin.locked && byLogin.lockedUntil) {
      await tx.loginAttempt.create({ data: { ip, kind: "PERSONAL", ok: false, blocked: true, login: key, personId, at: now } });
      return { ok: false, scope: "login", until: byLogin.lockedUntil };
    }
    const row = await tx.loginAttempt.create({ data: { ip, kind: "PERSONAL", ok: false, login: key, personId, at: now }, select: { id: true } });
    return { ok: true, attemptId: row.id };
  }, ATTEMPT_TX));
}

const markOk = markAttemptOk;

export type PasswordLogin = { ok: true; sessionId: string; personId: string } | { ok: false; error: string };

/**
 * Вход по логину и паролю. Запись устройства создаётся только при верном пароле. Неверный логин и неверный пароль
 * дают один и тот же ответ за одно и то же время: пароль сверяется и для несуществующего человека
 */
export async function loginWithPassword(login: string, password: string, device: DeviceInfo, now = new Date(), replaces: string | null = null): Promise<PasswordLogin> {
  const ip = device.ip ?? "unknown";
  const person = await personByLogin(login);
  let reserved: Reserved;
  try {
    reserved = await reserveAttempt(ip, attemptKey(person, login), person?.id ?? null, now);
  } catch (error) {
    // База не ответила вовремя: пароль не сверяется, ответ одинаковый для любого логина
    console.error("Попытка входа не записана", error);
    return { ok: false, error: BUSY_ERROR };
  }
  if (!reserved.ok) {
    return {
      ok: false,
      error:
        reserved.scope === "ip"
          ? `Слишком много неверных попыток с этого адреса. Вход откроется в ${formatTime(reserved.until)}`
          : `Слишком много неверных попыток к этому логину. Вход откроется в ${formatTime(reserved.until)}`,
    };
  }
  const usable = person?.active ? person : null;
  const ok = await verifyPassword(password, usable?.passwordHash ?? null);
  if (!ok || !usable) {
    await prisma.auditLog.create({ data: { action: "auth.password.fail", entity: "person", entityId: person?.slug ?? null, ip, via: "PASSWORD", source: "APP" } });
    return { ok: false, error: "Неверный логин или пароль" };
  }
  const session = await prisma.$transaction(async (tx) => {
    await markOk(tx, reserved.attemptId);
    if (replaces) await tx.deviceSession.updateMany({ where: { id: replaces, revokedAt: null }, data: { revokedAt: now, revokedBy: "replaced" } });
    const created = await tx.deviceSession.create({
      data: {
        personId: usable.id,
        method: "PASSWORD",
        ip: device.ip,
        userAgent: device.userAgent?.slice(0, 400) ?? null,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + DEVICE_TTL_MS),
      },
    });
    await tx.auditLog.create({ data: { action: "auth.login", actorId: usable.id, actorName: usable.fullName, entity: "person", entityId: usable.slug, ip: device.ip, via: "PASSWORD" } });
    return created;
  });
  return { ok: true, sessionId: session.id, personId: usable.id };
}

/** Неиспользованные ссылки входа человека гаснут: после нового пароля по старой ссылке не войти и пароль не заменить */
function expireLinks(tx: Tx, personId: string, now: Date) {
  return tx.loginLink.updateMany({ where: { personId, kind: { in: ["INVITE", "EMAIL"] }, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
}

export { LOCK_MS };

/**
 * Пароль по личной ссылке: человек открыл ссылку от владельца (или из письма), придумал пароль и сразу вошёл.
 * Ссылка тратится, пароль сохраняется и устройство появляется в одной транзакции. Если пароль уже был (забыл,
 * владелец сбросил), прежние входы человека завершаются
 */
export async function setPasswordByLink(token: string, password: string, repeat: string, device: DeviceInfo, now = new Date(), replaces: string | null = null) {
  if (password !== repeat) fail("Пароли не совпадают");
  const link = await prisma.loginLink.findUnique({ where: { tokenHash: hashToken(token) }, include: { person: true } });
  if (!link || link.kind === "STEP_UP") fail("Ссылка не найдена: проверьте, что она скопирована целиком");
  const problem = validatePersonalPassword(password, link!.person);
  if (problem) fail(problem);
  const hash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    const taken = await tx.loginLink.updateMany({
      where: { id: link!.id, usedAt: null, expiresAt: { gt: now }, person: { active: true } },
      data: { usedAt: now, usedIp: device.ip },
    });
    if (taken.count !== 1) {
      // Причину смотрим заново: параллельная вкладка могла потратить ссылку после первого чтения
      const fresh = await tx.loginLink.findUnique({ where: { id: link!.id }, include: { person: true } });
      if (!fresh || fresh.usedAt) fail("Ссылка уже использована. Попросите новую у владельца ресурса");
      if (fresh!.expiresAt <= now) fail("Срок ссылки истёк. Попросите новую у владельца ресурса");
      fail("Этот человек выключен в списке команды");
    }
    const person = await tx.person.findUniqueOrThrow({ where: { id: link!.personId } });
    const reset = !!person.passwordHash;
    await tx.person.update({ where: { id: person.id }, data: { passwordHash: hash, passwordSetAt: now } });
    await expireLinks(tx, person.id, now);
    if (reset) await tx.deviceSession.updateMany({ where: { personId: person.id, revokedAt: null }, data: { revokedAt: now, revokedBy: "password" } });
    if (replaces) await tx.deviceSession.updateMany({ where: { id: replaces, revokedAt: null }, data: { revokedAt: now, revokedBy: "replaced" } });
    const session = await tx.deviceSession.create({
      data: {
        personId: person.id,
        method: link!.kind === "INVITE" ? "INVITE" : "EMAIL",
        ip: device.ip,
        userAgent: device.userAgent?.slice(0, 400) ?? null,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + DEVICE_TTL_MS),
      },
    });
    await tx.auditLog.createMany({
      data: [
        { action: "auth.password.set", actorId: person.id, actorName: person.fullName, entity: "person", entityId: person.slug, field: reset ? "Пароль заменён по ссылке" : "Пароль задан", ip: device.ip, via: session.method },
        { action: "auth.login", actorId: person.id, actorName: person.fullName, entity: "person", entityId: person.slug, ip: device.ip, via: session.method },
      ],
    });
    return { session, person };
  });
}

/**
 * Смена пароля в профиле: только при личном входе. Если пароль уже есть, нужен текущий. Остальные входы человека
 * завершаются, текущее устройство остаётся
 */
export async function changePassword(actor: Actor, deviceId: string | null, current: string, next: string, repeat: string, now = new Date()): Promise<void> {
  if (actor.via === "TEAM" || !deviceId) fail("Пароль меняют при личном входе: по общему логину можно выбрать чужой профиль");
  if (next !== repeat) fail("Новые пароли не совпадают");
  const person = await prisma.person.findUniqueOrThrow({ where: { id: actor.personId } });
  if (person.passwordHash) {
    // Текущий пароль сверяется с тем же счётчиком, что и вход: из открытого чужого профиля его не подобрать
    const reserved = await reserveAttempt(actor.ip ?? "unknown", attemptKey(person, person.slug), person.id, now);
    if (!reserved.ok) fail(`Слишком много неверных попыток. Попробуйте снова в ${formatTime(reserved.until)}`);
    if (!(await verifyPassword(current, person.passwordHash))) fail("Текущий пароль неверный");
    if (reserved.ok) await markOk(prisma, reserved.attemptId);
  }
  const problem = validatePersonalPassword(next, person);
  if (problem) fail(problem);
  const hash = await hashPassword(next);
  await prisma.$transaction(async (tx) => {
    await tx.person.update({ where: { id: person.id }, data: { passwordHash: hash, passwordSetAt: now } });
    await tx.deviceSession.updateMany({ where: { personId: person.id, revokedAt: null, id: { not: deviceId! } }, data: { revokedAt: now, revokedBy: "password" } });
    await expireLinks(tx, person.id, now);
    await tx.auditLog.create({
      data: { action: "auth.password.set", actorId: person.id, actorName: person.fullName, entity: "person", entityId: person.slug, field: person.passwordHash ? "Пароль изменён" : "Пароль задан", ip: actor.ip ?? null, via: actor.via ?? null },
    });
  });
}

function ownerOnly(actor: Actor) {
  if (actor.management !== "OWNER" || actor.role === "OBSERVER") fail("Это делает только владелец в режиме управления");
}

/** Владелец сбрасывает пароль: старый перестаёт работать, все входы и неиспользованные ссылки человека гаснут */
export async function resetPassword(actor: Actor, slug: string, now = new Date()): Promise<void> {
  ownerOnly(actor);
  const person = await prisma.person.findUnique({ where: { slug: String(slug) } });
  if (!person) return fail("Человек не найден");
  if (person.id === actor.personId) fail("Свой пароль меняйте в профиле: сброс завершил бы и ваш вход");
  await prisma.$transaction(async (tx) => {
    await tx.person.update({ where: { id: person.id }, data: { passwordHash: null, passwordSetAt: null } });
    await tx.deviceSession.updateMany({ where: { personId: person.id, revokedAt: null }, data: { revokedAt: now, revokedBy: "owner" } });
    await tx.loginLink.updateMany({ where: { personId: person.id, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
    await tx.auditLog.create({
      data: { action: "auth.password.reset", actorId: actor.personId, actorName: actor.fullName, entity: "person", entityId: person.slug, field: person.fullName, after: "пароль сброшен, входы завершены", ip: actor.ip ?? null, via: actor.via ?? null },
    });
  });
}

export type BulkInvite = { slug: string; fullName: string; login: string; token: string; expiresAt: Date };

/**
 * Ссылки всем, кто ещё не задал пароль: включённые люди, кроме наблюдателей и самого владельца. Каждая ссылка
 * показывается один раз; прежние неиспользованные ссылки этих людей гаснут
 */
export async function issueInvitesForAll(actor: Actor, now = new Date()): Promise<BulkInvite[]> {
  ownerOnly(actor);
  const people = await prisma.person.findMany({
    where: { active: true, role: { not: "OBSERVER" }, passwordHash: null, id: { not: actor.personId } },
    orderBy: [{ sortOrder: "asc" }, { fullName: "asc" }],
  });
  if (!people.length) return [];
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  const out: BulkInvite[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.loginLink.updateMany({ where: { personId: { in: people.map((p) => p.id) }, kind: "INVITE", usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
    for (const p of people) {
      const token = newToken();
      await tx.loginLink.create({ data: { tokenHash: hashToken(token), kind: "INVITE", personId: p.id, createdById: actor.personId, expiresAt, createdAt: now } });
      out.push({ slug: p.slug, fullName: p.fullName, login: loginOf(p), token, expiresAt });
    }
    await tx.auditLog.create({
      data: { action: "auth.invite.bulk", actorId: actor.personId, actorName: actor.fullName, entity: "person", field: "Ссылки всем без пароля", after: `выдано ссылок: ${people.length}`, ip: actor.ip ?? null, via: actor.via ?? null },
    });
  }, { timeout: 30_000 });
  return out;
}

export type PasswordStats = { withPassword: number; total: number; invitable: number };

/** Сколько человек задали пароль и скольким уйдут «Ссылки всем без пароля» (кроме самого владельца): для настроек */
export async function passwordStats(ownerId: string): Promise<PasswordStats> {
  const base = { active: true, role: { not: "OBSERVER" as const } };
  const [withPassword, total, invitable] = await Promise.all([
    prisma.person.count({ where: { ...base, passwordHash: { not: null } } }),
    prisma.person.count({ where: base }),
    prisma.person.count({ where: { ...base, passwordHash: null, id: { not: ownerId } } }),
  ]);
  return { withPassword, total, invitable };
}
