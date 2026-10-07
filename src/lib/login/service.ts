// Личные входы (этап 9, модуль М1 плана Weekly 2.0).
//
// Вход по одноразовой ссылке. Ссылку выдаёт владелец в настройках («Ссылка для входа», живёт 3 дня) или ресурс
// присылает на корпоративную почту (живёт 15 минут), если почта настроена. Ссылка открывает экран с кнопкой «Войти»:
// почтовые сканеры и мессенджеры открывают ссылки сами, поэтому вход случается только по нажатию, не по открытию.
// После входа на устройстве живёт запись DeviceSession на 30 дней: она видна в профиле и завершается «выйти везде».
//
// Общий логин team с выбором профиля работает, пока владелец не выключит его в настройках (переходный период).
// Модуль без server-only: его использует и команда npm run login-link на сервере.

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { formatDay, formatTime, moscowDate } from "@/lib/week";
import { mailConfigured, sendMail, type Mail } from "@/lib/mail";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import type { LinkKind, LoginMethod } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export const INVITE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
export const EMAIL_TTL_MS = 15 * 60 * 1000;
export const STEP_UP_TTL_MS = 15 * 60 * 1000;
export const DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Как часто обновлять «последний раз» у устройства: не чаще раза в 5 минут */
const TOUCH_MS = 5 * 60 * 1000;
/** Запросов ссылки на почту с одного адреса за 15 минут */
export const EMAIL_REQUESTS_PER_IP = 5;
/** Писем одному человеку за 15 минут */
export const EMAIL_LINKS_PER_PERSON = 3;
const WINDOW_MS = 15 * 60 * 1000;

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function until(at: Date): string {
  return `${formatDay(moscowDate(at))} ${formatTime(at)}`;
}

/** Ссылка вида https://адрес/login/link?t=... Адрес ресурса из APP_URL или из запроса */
export function linkUrl(base: string, token: string, path = "/login/link"): string {
  return `${base.replace(/\/+$/, "")}${path}?t=${encodeURIComponent(token)}`;
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail("Почта указана с ошибкой: нужен адрес вида name@sravni.ru");
  return v;
}

// Переходный период: общий логин team

export type TeamLogin = "on" | "off";

export async function getTeamLogin(): Promise<TeamLogin> {
  return (await getSetting<string>("auth.teamLogin", "on")) === "off" ? "off" : "on";
}

/**
 * Владелец выключает общий логин после переходной недели. Выключить можно, только войдя самому по личной ссылке:
 * иначе после переключения в ресурс не войти никому
 */
export async function saveTeamLogin(actor: Actor, mode: TeamLogin): Promise<TeamLogin> {
  if (actor.management !== "OWNER" || actor.role === "OBSERVER") fail("Способ входа меняет только владелец в режиме управления");
  if (mode !== "on" && mode !== "off") fail("Выберите способ входа из списка");
  const before = await getTeamLogin();
  if (before === mode) return mode;
  if (mode === "off" && actor.via === "TEAM") fail("Сначала войдите сами лично, со своим логином и паролем: после выключения общего логина войти по нему не сможет никто, и вы тоже");
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({ where: { key: "auth.teamLogin" }, update: { value: mode }, create: { key: "auth.teamLogin", value: mode } });
    // Новое поколение общего логина: если его потом включат обратно, старые сессии не оживут
    if (mode === "off") {
      const epoch = await tx.setting.findUnique({ where: { key: "auth.epoch" } });
      const next = (typeof epoch?.value === "number" ? epoch.value : 1) + 1;
      await tx.setting.upsert({ where: { key: "auth.epoch" }, update: { value: next }, create: { key: "auth.epoch", value: next } });
    }
    await tx.auditLog.create({
      data: {
        action: "auth.team-login",
        actorId: actor.personId,
        actorName: actor.fullName,
        entity: "settings",
        entityId: "auth.teamLogin",
        field: "Общий логин team",
        before: before === "on" ? "работает" : "выключен",
        after: mode === "on" ? "работает" : "выключен",
        ip: actor.ip ?? null,
        via: actor.via ?? null,
      },
    });
  });
  return mode;
}

// Ссылки

type Tx = Prisma.TransactionClient;

/** Замок на время транзакции: параллельные запросы по одному ключу идут по очереди, ограничения не обходятся */
async function lock(tx: Tx, key: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
}

async function createLinkTx(tx: Tx, kind: LinkKind, personId: string, ttlMs: number, now: Date, createdById: string | null, deviceId: string | null = null) {
  await lock(tx, `login-link:${personId}`);
  const token = newToken();
  const expiresAt = new Date(now.getTime() + ttlMs);
  // Действует одна свежая ссылка каждого вида: новая гасит прежние неиспользованные
  await tx.loginLink.updateMany({ where: { personId, kind, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
  await tx.loginLink.create({ data: { tokenHash: hashToken(token), kind, personId, createdById, deviceId, expiresAt, createdAt: now } });
  return { token, expiresAt };
}

/** Владелец выдаёт человеку ссылку для входа: показывается один раз, отправляется лично */
export async function issueInvite(actor: Actor, slug: string, now = new Date()): Promise<{ token: string; expiresAt: Date; fullName: string }> {
  if (actor.management !== "OWNER" || actor.role === "OBSERVER") fail("Ссылку для входа выдаёт только владелец в режиме управления");
  const person = await prisma.person.findUnique({ where: { slug } });
  if (!person) fail("Человек не найден");
  if (!person!.active) fail("Человек выключен: сначала включите его в списке");
  const link = await prisma.$transaction(async (tx) => {
    const created = await createLinkTx(tx, "INVITE", person!.id, INVITE_TTL_MS, now, actor.personId);
    await tx.auditLog.create({
      data: {
        action: "auth.invite",
        actorId: actor.personId,
        actorName: actor.fullName,
        entity: "person",
        entityId: person!.slug,
        field: person!.fullName,
        after: `действует до ${until(created.expiresAt)}`,
        ip: actor.ip ?? null,
        via: actor.via ?? null,
      },
    });
    return created;
  });
  return { ...link, fullName: person!.fullName };
}

export type LinkStatus = "ok" | "used" | "expired" | "unknown" | "inactive";

/** Что за ссылка, без её использования: для экрана «Войти как ...». login и hasPassword нужны экрану задания пароля */
export async function peekLink(token: string, now = new Date()): Promise<{ status: LinkStatus; kind?: LinkKind; fullName?: string; login?: string; hasPassword?: boolean }> {
  if (!token) return { status: "unknown" };
  const link = await prisma.loginLink.findUnique({ where: { tokenHash: hashToken(token) }, include: { person: true } });
  if (!link) return { status: "unknown" };
  const base = { kind: link.kind, fullName: link.person.fullName, login: link.person.slug, hasPassword: !!link.person.passwordHash };
  if (link.usedAt) return { status: "used", ...base };
  if (link.expiresAt <= now) return { status: "expired", ...base };
  if (!link.person.active) return { status: "inactive", ...base };
  return { status: "ok", ...base };
}

/** Почему ссылку не взять: текст для человека */
async function linkProblem(token: string, now: Date): Promise<never> {
  const { status } = await peekLink(token, now);
  if (status === "used") fail("Ссылка уже использована. Попросите новую");
  if (status === "expired") fail("Срок ссылки истёк. Попросите новую");
  if (status === "inactive") fail("Этот человек выключен в списке команды");
  return fail("Ссылка не найдена: проверьте, что она скопирована целиком");
}

/** Ссылку можно использовать один раз: условие в самом UPDATE, две вкладки одновременно не войдут обе */
async function takeLinkTx(tx: Tx, token: string, kinds: LinkKind[], ip: string | null, now: Date) {
  const tokenHash = hashToken(token);
  const taken = await tx.loginLink.updateMany({
    where: { tokenHash, kind: { in: kinds }, usedAt: null, expiresAt: { gt: now }, person: { active: true } },
    data: { usedAt: now, usedIp: ip },
  });
  if (taken.count !== 1) return null;
  return tx.loginLink.findUniqueOrThrow({ where: { tokenHash }, include: { person: true } });
}

export type DeviceInfo = { ip: string | null; userAgent: string | null };

/**
 * Вход по ссылке: ссылка тратится и устройство появляется в одной транзакции, сбой не сжигает ссылку.
 * replaces: прежняя запись устройства в этом браузере, она завершается
 */
export async function consumeLoginLink(token: string, device: DeviceInfo, now = new Date(), replaces: string | null = null) {
  const result = await prisma.$transaction(async (tx) => {
    const link = await takeLinkTx(tx, token, ["INVITE", "EMAIL"], device.ip, now);
    if (!link) return null;
    const method: LoginMethod = link.kind === "INVITE" ? "INVITE" : "EMAIL";
    if (replaces) await tx.deviceSession.updateMany({ where: { id: replaces, revokedAt: null }, data: { revokedAt: now, revokedBy: "replaced" } });
    const session = await tx.deviceSession.create({
      data: {
        personId: link.personId,
        method,
        ip: device.ip,
        userAgent: device.userAgent?.slice(0, 400) ?? null,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + DEVICE_TTL_MS),
      },
    });
    await tx.auditLog.create({
      data: { action: "auth.login", actorId: link.person.id, actorName: link.person.fullName, entity: "person", entityId: link.person.slug, ip: device.ip, via: method },
    });
    return { session, person: link.person, method };
  });
  return result ?? linkProblem(token, now);
}

// Почта

export type EmailRequest = { ok: true } | { ok: false; error: string };

/** Письмо уходит в фоне: ответ и его время не зависят от того, есть ли адрес в списке и как работает почтовый сервер */
function deliver(mail: Mail): void {
  void sendMail(mail).catch((error) => console.error("Письмо не отправилось", mail.subject, error));
}

/**
 * Запрос ссылки на почту. Ответ одинаковый, есть адрес в списке команды или нет: по ответу не узнать, кто в команде.
 * Ограничения: 5 запросов с одного адреса и 3 письма одному человеку за 15 минут, параллельные запросы их не обходят
 */
export async function requestEmailLink(emailInput: string, ctx: { ip: string; baseUrl: string }, now = new Date()): Promise<EmailRequest> {
  if (!mailConfigured()) return { ok: false, error: "Почта для входа ещё не настроена. Личную ссылку выдаёт владелец ресурса" };
  let email: string | null;
  try {
    email = normalizeEmail(emailInput);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  if (!email) return { ok: false, error: "Введите рабочую почту" };

  const since = new Date(now.getTime() - WINDOW_MS);
  const result = await prisma.$transaction(async (tx) => {
    await lock(tx, `email-ip:${ctx.ip}`);
    const fromIp = await tx.loginAttempt.count({ where: { ip: ctx.ip, kind: "LINK", at: { gte: since } } });
    if (fromIp >= EMAIL_REQUESTS_PER_IP) return { limited: true as const };
    const person = await tx.person.findFirst({ where: { email, active: true } });
    await tx.loginAttempt.create({ data: { ip: ctx.ip, kind: "LINK", ok: Boolean(person), at: now } });
    if (!person) return { limited: false as const, mail: null };
    await lock(tx, `login-link:${person.id}`);
    const recent = await tx.loginLink.count({ where: { personId: person.id, kind: "EMAIL", createdAt: { gte: since } } });
    if (recent >= EMAIL_LINKS_PER_PERSON) return { limited: false as const, mail: null };
    const link = await createLinkTx(tx, "EMAIL", person.id, EMAIL_TTL_MS, now, null);
    await tx.auditLog.create({
      data: { action: "auth.email-link", actorId: person.id, actorName: person.fullName, entity: "person", entityId: person.slug, ip: ctx.ip },
    });
    return {
      limited: false as const,
      mail: {
        to: email!,
        subject: "Вход в Weekly",
        text: [
          `${person.fullName}, ссылка для входа в Weekly:`,
          linkUrl(ctx.baseUrl, link.token),
          "",
          `Ссылка действует 15 минут, до ${formatTime(link.expiresAt)} по Москве, и открывает вход один раз.`,
          "Если вы не запрашивали вход, просто удалите письмо.",
        ].join("\n"),
      },
    };
  });
  if (result.limited) return { ok: false, error: "Слишком много запросов. Попробуйте через 15 минут или попросите ссылку у владельца" };
  if (result.mail) deliver(result.mail);
  return { ok: true };
}

// Подтверждение режима управления по почте

/**
 * Администратор просит ссылку подтверждения на свою почту вместо пароля управления. Ссылка привязана к устройству,
 * с которого её запросили. Владелец включает режим только паролем: доступ к одной почте не должен давать права владельца
 */
export async function requestStepUp(actor: Actor, deviceId: string | null, baseUrl: string, now = new Date()): Promise<{ email: string }> {
  if (actor.role === "OWNER") fail("Владелец включает режим управления паролем владельца");
  if (actor.role !== "ADMIN") fail("Режим управления доступен только владельцу и администраторам");
  if (!actor.via || actor.via === "TEAM" || !deviceId) fail("Подтверждение по почте работает при личном входе. Войдите по своей ссылке или введите пароль управления");
  if (!mailConfigured()) fail("Почта не настроена: введите пароль управления");
  const person = await prisma.person.findUniqueOrThrow({ where: { id: actor.personId } });
  if (!person.email) fail("У вас в профиле нет почты: её добавляет владелец в настройках");
  const link = await prisma.$transaction(async (tx) => {
    await lock(tx, `login-link:${person.id}`);
    const recent = await tx.loginLink.count({ where: { personId: person.id, kind: "STEP_UP", createdAt: { gte: new Date(now.getTime() - WINDOW_MS) } } });
    if (recent >= EMAIL_LINKS_PER_PERSON) fail("Письмо уже отправлено несколько раз. Проверьте почту или попробуйте через 15 минут");
    return createLinkTx(tx, "STEP_UP", person.id, STEP_UP_TTL_MS, now, person.id, deviceId);
  });
  await sendMail({
    to: person.email!,
    subject: "Подтверждение режима управления Weekly",
    text: [
      `${person.fullName}, чтобы включить режим управления, откройте ссылку на том же устройстве:`,
      linkUrl(baseUrl, link.token, "/manage/confirm"),
      "",
      `Ссылка действует 15 минут, до ${formatTime(link.expiresAt)} по Москве. Режим управления будет включён на 12 часов.`,
      "Если это были не вы, сообщите владельцу ресурса.",
    ].join("\n"),
  });
  return { email: person.email! };
}

/** Ссылка подтверждения работает только у того же человека, на том же устройстве и только при личном входе */
export async function consumeStepUp(token: string, actor: Actor, deviceId: string | null, now = new Date()): Promise<void> {
  if (!actor.via || actor.via === "TEAM" || !deviceId) fail("Подтверждение по почте работает при личном входе");
  const link = await prisma.loginLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (link && link.kind === "STEP_UP" && link.personId !== actor.personId) fail("Эта ссылка выдана другому человеку");
  if (link && link.kind === "STEP_UP" && link.deviceId !== deviceId) fail("Откройте ссылку на том устройстве, с которого её запросили");
  const taken = await prisma.$transaction((tx) => takeLinkTx(tx, token, ["STEP_UP"], actor.ip ?? null, now));
  if (!taken) await linkProblem(token, now);
}

// Устройства

export type DeviceView = { id: string; method: LoginMethod; userAgent: string | null; ip: string | null; createdAt: string; lastSeenAt: string };

/** Действующая запись устройства с человеком или null */
export async function loadDevice(sid: string, now = new Date()) {
  const device = await prisma.deviceSession.findUnique({ where: { id: sid }, include: { person: true } });
  if (!device || device.revokedAt || device.expiresAt <= now) return null;
  return device;
}

/** Скользящий срок: кто заходит, тот не вылетает через 30 дней. Неактивное 30 дней устройство гаснет само */
export async function touchDevice(sid: string, lastSeenAt: Date, now = new Date()): Promise<void> {
  if (now.getTime() - lastSeenAt.getTime() < TOUCH_MS) return;
  await prisma.deviceSession.updateMany({ where: { id: sid, revokedAt: null }, data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + DEVICE_TTL_MS) } });
}

export async function listDevices(personId: string, now = new Date()): Promise<DeviceView[]> {
  const rows = await prisma.deviceSession.findMany({
    where: { personId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { lastSeenAt: "desc" },
  });
  return rows.map((d) => ({ id: d.id, method: d.method, userAgent: d.userAgent, ip: d.ip, createdAt: d.createdAt.toISOString(), lastSeenAt: d.lastSeenAt.toISOString() }));
}

/** Человек завершает вход на одном своём устройстве */
export async function revokeDevice(actor: Actor, id: string, now = new Date()): Promise<void> {
  if (actor.via === "TEAM") fail("Своими устройствами управляют при личном входе");
  const device = await prisma.deviceSession.findUnique({ where: { id } });
  if (!device || device.personId !== actor.personId) fail("Устройство не найдено");
  if (device!.revokedAt) return;
  await prisma.deviceSession.update({ where: { id }, data: { revokedAt: now, revokedBy: "self" } });
  await prisma.auditLog.create({
    data: { action: "auth.device.revoke", actorId: actor.personId, actorName: actor.fullName, entity: "person", entityId: actor.slug, ip: actor.ip ?? null, via: actor.via ?? null },
  });
}

/** «Выйти везде»: свои устройства или, для владельца, все устройства человека */
export async function revokeAllDevices(actor: Actor, slug: string, now = new Date()): Promise<number> {
  const person = await prisma.person.findUnique({ where: { slug } });
  if (!person) fail("Человек не найден");
  const own = person!.id === actor.personId;
  if (!own && (actor.management !== "OWNER" || actor.role === "OBSERVER")) fail("Чужие входы завершает только владелец в режиме управления");
  // По общему логину любой может выбрать чужое имя: завершать «свои» личные входы так нельзя
  if (own && actor.via === "TEAM") fail("Своими устройствами управляют при личном входе");
  const result = await prisma.deviceSession.updateMany({
    where: { personId: person!.id, revokedAt: null, expiresAt: { gt: now } },
    data: { revokedAt: now, revokedBy: own ? "self" : "owner" },
  });
  // Неиспользованные ссылки тоже гаснут: «выйти везде» на случай утечки ссылки или потери телефона
  await prisma.loginLink.updateMany({ where: { personId: person!.id, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
  await prisma.auditLog.create({
    data: {
      action: "auth.device.revoke-all",
      actorId: actor.personId,
      actorName: actor.fullName,
      entity: "person",
      entityId: person!.slug,
      field: person!.fullName,
      after: `завершено входов: ${result.count}`,
      ip: actor.ip ?? null,
      via: actor.via ?? null,
    },
  });
  return result.count;
}

/** Сколько у каждого человека действующих личных входов и когда он заходил последний раз: для списка людей */
export async function deviceSummary(now = new Date()): Promise<Map<string, { devices: number; lastSeenAt: string | null }>> {
  const rows = await prisma.deviceSession.groupBy({
    by: ["personId"],
    where: { revokedAt: null, expiresAt: { gt: now } },
    _count: { _all: true },
    _max: { lastSeenAt: true },
  });
  return new Map(rows.map((r) => [r.personId, { devices: r._count._all, lastSeenAt: r._max.lastSeenAt?.toISOString() ?? null }]));
}

/** Выключение человека завершает его входы и гасит ссылки (вызывается из настроек людей) */
export async function revokeOnDeactivate(tx: { deviceSession: typeof prisma.deviceSession; loginLink: typeof prisma.loginLink }, personId: string, now = new Date()) {
  await tx.deviceSession.updateMany({ where: { personId, revokedAt: null }, data: { revokedAt: now, revokedBy: "deactivate" } });
  await tx.loginLink.updateMany({ where: { personId, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
}
