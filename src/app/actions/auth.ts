"use server";

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
  clearSession,
  readSession,
  requestIp,
  requireContext,
  requireSignedIn,
  writeSession,
} from "@/lib/auth";
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
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
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
  await writeSession({ epoch });
  await writeAudit({ action: "login.success", ip });
  redirect("/choose");
}

export async function chooseProfile(formData: FormData): Promise<void> {
  const session = await requireSignedIn();
  const personId = String(formData.get("personId") ?? "");
  const person = await prisma.person.findFirst({ where: { id: personId, active: true } });
  if (!person) redirect("/choose");
  await writeSession({ epoch: session.epoch, personId: person.id });
  await writeAudit({
    action: "profile.choose",
    actorId: person.id,
    actorName: person.fullName,
    ip: await requestIp(),
  });
  redirect("/");
}

export async function enterManagement(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireContext();
  const ip = await requestIp();
  const actor = { actorId: ctx.person.id, actorName: ctx.person.fullName, ip };
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
  });
  redirect("/");
}

export async function logout(): Promise<void> {
  const session = await readSession();
  const person = session?.personId
    ? await prisma.person.findUnique({ where: { id: session.personId } })
    : null;
  await writeAudit({
    action: "logout",
    actorId: person?.id,
    actorName: person?.fullName,
    ip: await requestIp(),
  });
  await clearSession();
  redirect("/login");
}
