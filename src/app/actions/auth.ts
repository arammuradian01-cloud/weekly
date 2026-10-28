"use server";

import { teamChoosableWhere } from "@/lib/org/people";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getEpochs, getSetting } from "@/lib/settings";
import { PASSWORD_SETTING_KEYS, verifyPassword } from "@/lib/passwords";
import { LOCK_MS } from "@/lib/rate-limit";
import { BUSY_ERROR, markAttemptOk, reserveIpAttempt } from "@/lib/login/attempts";
import { checkManagementPassword, managementPasswordCurrent } from "@/lib/login/management-password";
import { MANAGEMENT_TEAM_REFUSAL } from "@/lib/roles";
import { MANAGEMENT_TTL_MS } from "@/lib/session";
import { formatTime } from "@/lib/week";
import {
  baseUrl,
  clearSession,
  closeOwnerAs,
  closeViewAs,
  readSession,
  requestIp,
  requestUserAgent,
  requireContext,
  requireSignedIn,
  writeSession,
  type AppContext,
} from "@/lib/auth";
import { actorOf } from "@/lib/action-runner";
import { VIEW_AS_DENIED } from "@/lib/view-as";
import { OWNER_AS_ENDED, OWNER_AS_TEXTS } from "@/lib/owner-as";
import { consumeLoginLink, consumeStepUp, getTeamLogin, requestEmailLink, requestStepUp } from "@/lib/login/service";
import { loginWithPassword, setPasswordByLink } from "@/lib/login/password";
import { confirmEmail } from "@/lib/login/email";
import { TaskRuleError } from "@/lib/tasks/service";

export type FormState = { error?: string } | null;

/** Запись попытки под замком. База не ответила вовремя: null, пароль не сверяется */
async function reserveOrBusy(ip: string, kind: "TEAM" | "MANAGEMENT", now: Date) {
  try {
    return await reserveIpAttempt(ip, kind, now);
  } catch (error) {
    console.error("Попытка входа не записана", error);
    return null;
  }
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
  const loginValue = String(formData.get("login") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const expectedLogin = (await getSetting<string>("auth.team.login", "team")).toLowerCase();
  // Этап 20а: всё, что не общий логин, это личный логин человека
  if (loginValue !== expectedLogin) return personalLogin(loginValue, password);
  if ((await getTeamLogin()) === "off") return { error: "Общий логин выключен. Войдите со своим логином и паролем" };
  const ip = await requestIp();
  const now = new Date();
  const hash = await getSetting<string | null>(PASSWORD_SETTING_KEYS.team, null);

  if (!hash) {
    await writeAudit({ action: "login.no-password", ip });
    return { error: "Пароль входа ещё не задан. Владелец задаёт его на странице первичной настройки или командой npm run password -- team" };
  }

  // Попытка записывается до сверки пароля, под замком: пачка параллельных запросов не обходит порог (этап 29).
  // Пока идёт сверка верного пароля, его попытка числится неверной. Соседний запрос из той же пачки может на это время
  // увидеть «вход закрыт», после отметки об успехе счёт обнуляется. Это безопасно: ошибаемся в сторону блокировки
  const reserved = await reserveOrBusy(ip, "TEAM", now);
  if (!reserved) return { error: BUSY_ERROR };
  if (!reserved.ok) {
    await writeAudit({ action: "login.blocked", ip });
    return { error: `Слишком много неверных попыток. Вход откроется в ${formatTime(reserved.until)}` };
  }

  const ok = await verifyPassword(password, hash);
  if (!ok) {
    await writeAudit({ action: "login.fail", ip });
    return { error: failureMessage(reserved.remaining, now, "Неверный логин или пароль") };
  }
  await markAttemptOk(prisma, reserved.attemptId);

  // Личный вход, который был в этом браузере, заменяется общим: завершаем его и в базе, как при смене личного входа.
  // Иначе запись устройства жила бы ещё 30 дней, и уведомления прежнего человека приходили бы в этот браузер (этап 26)
  // Просмотр «Смотреть как» прежнего входа в этом браузере закрывается с записью в журнал (этап 63)
  await closeViewAs("login");
  // Вход владельца в чужой профиль (этап 71) прежнего входа в этом браузере тоже заканчивается с записью в журнал
  await closeOwnerAs("session");
  const previous = (await readSession())?.sid ?? null;
  if (previous) await prisma.deviceSession.updateMany({ where: { id: previous, revokedAt: null }, data: { revokedAt: now, revokedBy: "replaced" } });
  const { epoch } = await getEpochs();
  await writeSession({ epoch, via: "TEAM" });
  await writeAudit({ action: "login.success", ip, via: "TEAM" });
  redirect("/choose");
}

/** Личный логин и пароль (этап 20а): запись устройства на 30 дней, как при входе по ссылке */
async function personalLogin(loginValue: string, password: string): Promise<FormState> {
  if (!loginValue || !password) return { error: "Введите логин и пароль" };
  const previous = (await readSession())?.sid ?? null;
  const result = await loginWithPassword(loginValue, password, { ip: await requestIp(), userAgent: await requestUserAgent() }, new Date(), previous);
  if (!result.ok) return { error: result.error };
  // Просмотр «Смотреть как» и вход владельца в чужой профиль прежнего входа в этом браузере закрываются с записью в
  // журнал (этапы 63 и 71)
  await closeViewAs("login");
  await closeOwnerAs("session");
  const { epoch } = await getEpochs();
  await writeSession({ epoch, personId: result.personId, sid: result.sessionId, via: "PASSWORD" });
  redirect("/");
}

export async function chooseProfile(formData: FormData): Promise<void> {
  const session = await requireSignedIn();
  const personId = String(formData.get("personId") ?? "");
  // Этап 71 (поправка 23.10): все включённые люди структуры без личного пароля, владелец и администратор без пароля тоже.
  // Режима управления и прав владельца или администратора такой вход не даёт. Тем же условием строится список на экране,
  // но решает сервер: подставить в форму номер человека с личным паролем или выключенного не выйдет
  const person = personId ? await prisma.person.findFirst({ where: { id: personId, ...teamChoosableWhere } }) : null;
  if (!person) redirect("/choose?denied=1");
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

/**
 * Режим управления (этап 63): во время просмотра «Смотреть как» отказ ответом. После того как просмотр закончился
 * сам, включить и выключить режим можно из любой вкладки, иначе владелец застрял бы; при этом закончившийся просмотр
 * закрывается (конец уже в журнале, cookie снимается)
 */
async function managementContext(): Promise<{ ctx: AppContext; error?: undefined } | { ctx?: undefined; error: string }> {
  const ctx = await requireContext();
  if (ctx.viewAs) return { error: VIEW_AS_DENIED };
  // Этап 71: во время входа владельца в чужой профиль режим управления не включается (ни паролем, ни ссылкой на почту),
  // после конца входа сначала возврат в свой профиль
  if (ctx.ownerAs) return { error: OWNER_AS_TEXTS.management };
  if (ctx.ownerAsEnded) return { error: OWNER_AS_ENDED };
  // Этап 71: режим управления только при личном входе. По общему логину можно выбрать владельца или администратора без
  // личного пароля: ни пароль управления, ни ссылка на почту такому входу режим не включают
  if (ctx.via === "TEAM") return { error: MANAGEMENT_TEAM_REFUSAL };
  return { ctx };
}

/** Отказ сверки пароля управления, который не означает неверный пароль: права изменились, пароль не задан, очередь занята */
function notPasswordFailure(message: string): boolean {
  return message === BUSY_ERROR || message.startsWith("Права изменились") || message.includes("ещё не задан");
}

export async function enterManagement(_prev: FormState, formData: FormData): Promise<FormState> {
  const { ctx, error } = await managementContext();
  if (!ctx) return { error };
  const ip = await requestIp();
  const actor = { actorId: ctx.person.id, actorName: ctx.person.fullName, ip, via: ctx.via };
  if (!ctx.managementRole) {
    return { error: "Режим управления доступен только владельцу и администраторам" };
  }

  const now = new Date();
  let credential: string;
  try {
    credential = await checkManagementPassword(actorOf(ctx, ip), ctx.deviceId, String(formData.get("password") ?? ""), now);
  } catch (error) {
    const message = ruleError(error);
    if (!message) throw error;
    // В журнал неверный пароль и блокировку. «Права изменились», «пароль ещё не задан» и занятая очередь попыток не
    // попытка подбора: записи «Неверный пароль режима управления» для них нет
    if (message.startsWith("Слишком много")) await writeAudit({ action: "management.blocked", ...actor });
    else if (!notPasswordFailure(message)) await writeAudit({ action: "management.fail", ...actor });
    return { error: message };
  }
  // Сверка пароля могла занять время: не выдаём управление после смены роли, режима или завершения устройства.
  const fresh = await managementContext();
  if (!fresh.ctx) return { error: fresh.error };
  const nextCtx = fresh.ctx;
  const proposed = { role: ctx.managementRole, until: now.getTime() + MANAGEMENT_TTL_MS, epoch: 0, credential };
  if (nextCtx.person.id !== ctx.person.id || nextCtx.deviceId !== ctx.deviceId || nextCtx.managementRole !== ctx.managementRole ||
      !(await managementPasswordCurrent(proposed, nextCtx.person, !!nextCtx.deviceId && nextCtx.via !== "TEAM"))) {
    return { error: "Условия входа изменились. Обновите страницу и включите управление заново" };
  }

  if (ctx.viewAsEnded) await closeViewAs("stop");
  const { managementEpoch } = await getEpochs();
  await writeSession({
    ...ctx.session,
    management: { ...proposed, epoch: managementEpoch },
  });
  await writeAudit({ action: "management.enter", ...actor, after: { role: ctx.managementRole } });
  redirect(safeNext(formData.get("next")));
}

export async function exitManagement(): Promise<{ error: string } | void> {
  const { ctx, error } = await managementContext();
  if (!ctx) return { error };
  if (ctx.viewAsEnded) await closeViewAs("stop");
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
  // Выход во время «Смотреть как» (этап 63): просмотр заканчивается, в журнале кого смотрели. Если он закончился сам
  // и конец уже записан, второй записи нет. До завершения устройства: иначе причиной стал бы «вход завершён»
  await closeViewAs("logout");
  // Выход во время входа владельца в чужой профиль (этап 71): в журнале конец входа «выход из ресурса»
  await closeOwnerAs("logout");
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
    // Без пароля входят только по ссылке из письма: по ссылке от владельца человек сначала задаёт пароль
    const { session, person, method } = await consumeLoginLink(token, { ip: await requestIp(), userAgent: await requestUserAgent() }, new Date(), previous, ["EMAIL"]);
    await closeViewAs("login");
    await closeOwnerAs("session");
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

/** Экран личной ссылки (этап 20а): человек придумывает пароль и сразу входит */
export async function setPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  let target = "/";
  try {
    const previous = (await readSession())?.sid ?? null;
    const { session, person } = await setPasswordByLink(
      token,
      String(formData.get("password") ?? ""),
      String(formData.get("repeat") ?? ""),
      { ip: await requestIp(), userAgent: await requestUserAgent() },
      new Date(),
      previous,
    );
    await closeViewAs("login");
    await closeOwnerAs("session");
    const { epoch } = await getEpochs();
    await writeSession({ epoch, personId: person.id, sid: session.id, via: session.method === "INVITE" ? "INVITE" : "EMAIL" });
    // Первый вход (этап 52): если рабочей почты ещё нет, ресурс предлагает её указать
    if (!person.email) target = "/welcome?new=1";
  } catch (error) {
    const message = ruleError(error);
    if (!message) {
      console.error("Пароль по ссылке: не прошло", error);
      return { error: "Не получилось сохранить пароль. Обновите страницу и попробуйте ещё раз" };
    }
    return { error: message };
  }
  redirect(target);
}

export type ConfirmState = { error?: string; email?: string } | null;

/** Кнопка «Подтвердить почту» на экране ссылки из письма (этап 52): ссылка тратится только здесь, не при открытии */
export async function confirmEmailAction(_prev: ConfirmState, formData: FormData): Promise<ConfirmState> {
  try {
    const result = await confirmEmail(String(formData.get("token") ?? ""), await requestIp());
    return result.ok ? { email: result.email } : { error: result.error };
  } catch (error) {
    console.error("Подтверждение почты: не прошло", error);
    return { error: "Не получилось подтвердить адрес. Обновите страницу и попробуйте ещё раз" };
  }
}

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
    const { ctx, error } = await managementContext();
    if (!ctx) return { error };
    await requestStepUp(actorOf(ctx, await requestIp()), ctx.deviceId, await baseUrl());
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
  const { ctx, error: denied } = await managementContext();
  if (!ctx) return { error: denied };
  if (!ctx.managementRole) return { error: "Режим управления доступен только владельцу и администраторам" };
  try {
    await consumeStepUp(String(formData.get("token") ?? ""), actorOf(ctx, await requestIp()), ctx.deviceId);
  } catch (error) {
    const message = ruleError(error);
    if (!message) {
      console.error("Подтверждение по почте: не прошло", error);
      return { error: "Не получилось подтвердить. Попробуйте ещё раз" };
    }
    return { error: message };
  }
  const fresh = await managementContext();
  if (!fresh.ctx) return { error: fresh.error };
  if (fresh.ctx.person.id !== ctx.person.id || fresh.ctx.deviceId !== ctx.deviceId || fresh.ctx.managementRole !== "ADMIN") {
    return { error: "Условия входа изменились. Обновите страницу" };
  }
  const now = Date.now();
  if (ctx.viewAsEnded) await closeViewAs("stop");
  const { managementEpoch } = await getEpochs();
  await writeSession({ ...ctx.session, management: { role: ctx.managementRole, until: now + MANAGEMENT_TTL_MS, epoch: managementEpoch } });
  await writeAudit({ action: "management.enter", actorId: ctx.person.id, actorName: ctx.person.fullName, ip: await requestIp(), via: ctx.via, after: { role: ctx.managementRole, by: "email" } });
  redirect(safeNext(formData.get("next")));
}
