"use server";

import { topTeamOnly } from "@/lib/org/people";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getEpochs, getSetting } from "@/lib/settings";
import { PASSWORD_SETTING_KEYS, verifyPassword } from "@/lib/passwords";
import { computeLockState, historySince, LOCK_MS } from "@/lib/rate-limit";
import { managementPasswordKind } from "@/lib/roles";
import { MANAGEMENT_TTL_MS } from "@/lib/session";
import { formatTime } from "@/lib/week";
import {
  baseUrl,
  clearSession,
  readSession,
  requestIp,
  requestUserAgent,
  requireContext,
  requireSignedIn,
  writeSession,
} from "@/lib/auth";
import { currentActor } from "@/lib/action-runner";
import { consumeLoginLink, consumeStepUp, getTeamLogin, requestEmailLink, requestStepUp } from "@/lib/login/service";
import { TaskRuleError } from "@/lib/tasks/service";
import type { AttemptKind } from "@/generated/prisma/enums";

export type FormState = { error?: string } | null;

async function lockStateFor(ip: string, kind: AttemptKind, now: Date) {
  const attempts = await prisma.loginAttempt.findMany({
    where: { ip, kind, at: { gte: historySince(now) } },
    select: { at: true, ok: true, blocked: true },
    orderBy: { at: "asc" },
  });
  return computeLockState(
    attempts.filter((a) => !a.blocked).map((a) => ({ at: a.at, ok: a.ok })),
    now,
  );
}

function failureMessage(remainingBefore: number, now: Date, wrongWhat: string): string {
  const left = remainingBefore - 1;
  if (left > 0) return `${wrongWhat}. Осталось попыток: ${left}`;
  return `${wrongWhat}. Вход закрыт на 15 минут, до ${formatTime(new Date(now.getTime() + LOCK_MS))}`;
}

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "/";
  // Обратная косая черта браузер читает как прямую: «/\\evil.com» уводит на чужой сайт
  return next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  if ((await getTeamLogin()) === "off") return { error: "Общий логин выключен. Войдите по личной ссылке" };
  const ip = await requestIp();
  const now = new Date();
  const lock = await lockStateFor(ip, "TEAM", now);
  if (lock.locked && lock.lockedUntil) {
    await prisma.loginAttempt.create({ data: { ip, kind: "TEAM", ok: false, blocked: true } });
    await writeAudit({ action: "login.blocked", ip });
    return { error: `Слишком много неверных попыток. Вход откроется в ${formatTime(lock.lockedUntil)}` };
  }

  const loginValue = String(formData.get("login") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const expectedLogin = (await getSetting<string>("auth.team.login", "team")).toLowerCase();
  const hash = await getSetting<string | null>(PASSWORD_SETTING_KEYS.team, null);

  if (!hash) {
    await writeAudit({ action: "login.no-password", ip });
    return { error: "Пароль входа ещё не задан. Владелец задаёт его на странице первичной настройки или командой npm run password -- team" };
  }

  const passwordOk = await verifyPassword(password, hash);
  const ok = passwordOk && loginValue === expectedLogin;
  await prisma.loginAttempt.create({ data: { ip, kind: "TEAM", ok } });

  if (!ok) {
    await writeAudit({ action: "login.fail", ip });
    return { error: failureMessage(lock.remaining, now, "Неверный логин или пароль") };
  }

  const { epoch } = await getEpochs();
  await writeSession({ epoch, via: "TEAM" });
  await writeAudit({ action: "login.success", ip, via: "TEAM" });
  redirect("/choose");
}

export async function chooseProfile(formData: FormData): Promise<void> {
  const session = await requireSignedIn();
  const personId = String(formData.get("personId") ?? "");
  const person = await prisma.person.findFirst({ where: { id: personId, active: true, ...topTeamOnly } });
  if (!person) redirect("/choose");
  await writeSession({ epoch: session.epoch, personId: person.id, via: "TEAM" });
  await writeAudit({
    action: "profile.choose",
    actorId: person.id,
    actorName: person.fullName,
    ip: await requestIp(),
    via: "TEAM",
  });
  redirect("/");
}

export async function enterManagement(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireContext();
  const ip = await requestIp();
  const actor = { actorId: ctx.person.id, actorName: ctx.person.fullName, ip, via: ctx.via };
  if (!ctx.managementRole) {
    return { error: "Режим управления доступен только владельцу и администраторам" };
  }

  const now = new Date();
  const lock = await lockStateFor(ip, "MANAGEMENT", now);
  if (lock.locked && lock.lockedUntil) {
    await prisma.loginAttempt.create({ data: { ip, kind: "MANAGEMENT", ok: false, blocked: true } });
    await writeAudit({ action: "management.blocked", ...actor });
    return { error: `Слишком много неверных попыток. Попробовать снова можно в ${formatTime(lock.lockedUntil)}` };
  }

  const kind = managementPasswordKind(ctx.managementRole);
  const hash = await getSetting<string | null>(PASSWORD_SETTING_KEYS[kind], null);
  if (!hash) {
    return { error: `Пароль режима управления ещё не задан. Владелец задаёт его командой npm run password -- ${kind}` };
  }

  const ok = await verifyPassword(String(formData.get("password") ?? ""), hash);
  await prisma.loginAttempt.create({ data: { ip, kind: "MANAGEMENT", ok } });
  if (!ok) {
    await writeAudit({ action: "management.fail", ...actor });
    return { error: failureMessage(lock.remaining, now, "Неверный пароль") };
  }

  const { managementEpoch } = await getEpochs();
  await writeSession({
    ...ctx.session,
    management: { role: ctx.managementRole, until: now.getTime() + MANAGEMENT_TTL_MS, epoch: managementEpoch },
  });
  await writeAudit({ action: "management.enter", ...actor, after: { role: ctx.managementRole } });
  redirect(safeNext(formData.get("next")));
}

export async function exitManagement(): Promise<void> {
  const ctx = await requireContext();
  const { management: _dropped, ...rest } = ctx.session;
  await writeSession(rest);
  await writeAudit({
    action: "management.exit",
    actorId: ctx.person.id,
    actorName: ctx.person.fullName,
    ip: await requestIp(),
    via: ctx.via,
  });
  redirect("/");
}

export async function logout(): Promise<void> {
  const session = await readSession();
  const person = session?.personId
    ? await prisma.person.findUnique({ where: { id: session.personId } })
    : null;
  // Личный вход завершается и в базе: cookie с этого устройства больше не откроет ресурс
  if (session?.sid) {
    await prisma.deviceSession.updateMany({ where: { id: session.sid, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: "self" } });
  }
  await writeAudit({
    action: "logout",
    actorId: person?.id,
    actorName: person?.fullName,
    ip: await requestIp(),
    via: session?.sid ? (session.via ?? null) : session ? "TEAM" : null,
  });
  await clearSession();
  redirect("/login");
}

function ruleError(error: unknown): string | null {
  return error instanceof TaskRuleError ? error.message : null;
}

/** Кнопка «Войти» на экране ссылки: ссылка тратится только здесь, не при открытии */
export async function consumeLinkAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  let target: string;
  try {
    // Прежний личный вход в этом браузере завершается, чтобы не висел 30 дней
    const previous = (await readSession())?.sid ?? null;
    const { session, person, method } = await consumeLoginLink(token, { ip: await requestIp(), userAgent: await requestUserAgent() }, new Date(), previous);
    const { epoch } = await getEpochs();
    await writeSession({ epoch, personId: person.id, sid: session.id, via: method });
    target = "/";
  } catch (error) {
    const message = ruleError(error);
    if (!message) {
      console.error("Вход по ссылке: не прошло", error);
      return { error: "Не получилось войти. Обновите страницу и попробуйте ещё раз" };
    }
    return { error: message };
  }
  redirect(target);
}

export type EmailFormState = { error?: string; sent?: boolean } | null;

/** «Прислать ссылку на почту» на экране входа */
export async function requestEmailLinkAction(_prev: EmailFormState, formData: FormData): Promise<EmailFormState> {
  try {
    const result = await requestEmailLink(String(formData.get("email") ?? ""), { ip: await requestIp(), baseUrl: await baseUrl() });
    return result.ok ? { sent: true } : { error: result.error };
  } catch (error) {
    console.error("Ссылка на почту: не прошло", error);
    return { error: "Письмо не отправилось. Попробуйте позже или попросите ссылку у владельца" };
  }
}

/** Режим управления по ссылке на почту вместо пароля */
export async function requestStepUpAction(_prev: EmailFormState): Promise<EmailFormState> {
  try {
    const ctx = await requireContext();
    await requestStepUp(await currentActor(), ctx.deviceId, await baseUrl());
    return { sent: true };
  } catch (error) {
    const message = ruleError(error);
    if (message) return { error: message };
    console.error("Подтверждение по почте: не прошло", error);
    return { error: "Письмо не отправилось. Введите пароль управления" };
  }
}

/** Ссылка подтверждения из письма: включает режим управления на 12 часов */
export async function confirmStepUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireContext();
  if (!ctx.managementRole) return { error: "Режим управления доступен только владельцу и администраторам" };
  try {
    await consumeStepUp(String(formData.get("token") ?? ""), await currentActor(), ctx.deviceId);
  } catch (error) {
    const message = ruleError(error);
    if (!message) {
      console.error("Подтверждение по почте: не прошло", error);
      return { error: "Не получилось подтвердить. Попробуйте ещё раз" };
    }
    return { error: message };
  }
  const now = Date.now();
  const { managementEpoch } = await getEpochs();
  await writeSession({ ...ctx.session, management: { role: ctx.managementRole, until: now + MANAGEMENT_TTL_MS, epoch: managementEpoch } });
  await writeAudit({ action: "management.enter", actorId: ctx.person.id, actorName: ctx.person.fullName, ip: await requestIp(), via: ctx.via, after: { role: ctx.managementRole, by: "email" } });
  redirect(safeNext(formData.get("next")));
}
