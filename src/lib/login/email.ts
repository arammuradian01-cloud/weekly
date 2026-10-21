// Рабочая почта человека (этап 52). Решение Арама 21.10: после первого входа человек указывает корпоративную почту,
// дальше входит по почте или логину и восстанавливает пароль через почту.
//
// Как устроено:
// - почту человек указывает сам в профиле или на экране после первого входа; пока он не открыл ссылку из письма,
//   адрес лежит неподтверждённым и для входа не годится. Иначе любой мог бы вписать себе чужой адрес и получать
//   ссылки для входа на него;
// - адрес только из разрешённых доменов (настройка auth.email.domains, по умолчанию sravni.ru), точное совпадение:
//   поддомен, где почтой может управлять подрядчик, подходит, только если его перечислили в настройке;
// - ссылка подтверждения действует сутки и открывается один раз, на любом устройстве: письмо читают и с телефона.
//   Подтверждается адрес, на который ушла ссылка, а не тот, что лежит у человека сейчас;
// - по почте восстанавливают пароль, поэтому смена почты весит как смена пароля: нужен текущий пароль, владельцы и
//   администраторы меняют почту только в режиме управления (по ней приходит подтверждение режима), прежний адрес
//   получает письмо о смене. Смена пароля, «выйти везде» и выключение снимают неподтверждённый адрес;
// - адрес, который задал владелец в списке людей, считается подтверждённым сразу.

import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { formatTime } from "@/lib/week";
import { mailConfigured, sendMail } from "@/lib/mail";
import { Prisma } from "@/generated/prisma/client";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { advisoryLock } from "./attempts";
import { checkCurrentPassword } from "./password";
import { createLinkTx, linkUrl, maskEmail, normalizeEmail, takeLinkTx } from "./service";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export const EMAIL_CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;
export const EMAIL_DOMAINS_KEY = "auth.email.domains";
export const DEFAULT_EMAIL_DOMAINS = ["sravni.ru"];
/** Писем подтверждения одному человеку за сутки: защита от рассылки с ресурса на чужие адреса */
export const EMAIL_CONFIRMS_PER_DAY = 5;

export async function allowedEmailDomains(): Promise<string[]> {
  const list = await getSetting<string[] | null>(EMAIL_DOMAINS_KEY, null);
  const clean = (Array.isArray(list) ? list : DEFAULT_EMAIL_DOMAINS).map((d) => String(d).trim().toLowerCase()).filter(Boolean);
  return clean.length ? clean : DEFAULT_EMAIL_DOMAINS;
}

/** Домен разрешён: только точное совпадение. Поддомен (mail.sravni.ru) нужно перечислить в настройке отдельно */
export function domainAllowed(email: string, domains: string[]): boolean {
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const domain = parts[1]!.toLowerCase();
  return domains.some((d) => domain === d.toLowerCase());
}

/**
 * Человек указывает рабочую почту: адрес сохраняется неподтверждённым, на него уходит ссылка. Только при личном
 * входе: по общему логину можно выбрать чужой профиль. Если пароль уже задан, нужен текущий пароль
 */
export async function requestEmailBinding(actor: Actor, emailInput: string, currentPassword: string, baseUrl: string, now = new Date()): Promise<{ email: string }> {
  if (actor.via === "TEAM") fail("Почту указывают при личном входе: по общему логину можно выбрать чужой профиль");
  // По почте администратор подтверждает режим управления: из чужой открытой сессии почту так не подменить
  if ((actor.role === "OWNER" || actor.role === "ADMIN") && !actor.management) fail("Владельцы и администраторы указывают почту в режиме управления: по ней подтверждается режим");
  if (!mailConfigured()) fail("Почта ресурса ещё не настроена, подтвердить адрес нечем. Адрес может вписать владелец в списке людей");
  const email = normalizeEmail(emailInput);
  if (!email) return fail("Введите рабочую почту");
  const domains = await allowedEmailDomains();
  if (!domainAllowed(email, domains)) fail(`Нужна рабочая почта: адрес на ${domains.map((d) => `@${d}`).join(" или ")}`);
  const me = await prisma.person.findUniqueOrThrow({ where: { id: actor.personId } });
  if (me.email === email) fail("Это уже ваша подтверждённая почта");
  // По почте восстанавливают пароль: смена почты весит как смена пароля
  await checkCurrentPassword(actor, me, currentPassword, now);
  const mail = await prisma.$transaction(async (tx) => {
    // Сначала замок человека, потом счёт писем: параллельные запросы не обходят лимит
    await advisoryLock(tx, `login-link:${me.id}`);
    const person = await tx.person.findUniqueOrThrow({ where: { id: me.id } });
    // Считаются и отправленные письма, и попытки с занятым адресом: перебирать адреса так же нельзя, как слать письма
    const sent = await tx.loginAttempt.count({ where: { kind: "EMAIL_BIND", personId: person.id, at: { gte: new Date(now.getTime() - EMAIL_CONFIRM_TTL_MS) } } });
    if (sent >= EMAIL_CONFIRMS_PER_DAY) fail("Слишком много писем подтверждения за сутки. Попробуйте завтра или попросите владельца вписать адрес");
    await tx.loginAttempt.create({ data: { kind: "EMAIL_BIND", ip: actor.ip ?? "unknown", ok: false, personId: person.id, at: now } });
    const taken = await tx.person.findFirst({ where: { email, id: { not: person.id } }, select: { id: true } });
    // Чей адрес, не говорим: по ответу не узнать, кто есть в ресурсе. Проверка после счётчика
    if (taken) {
      await tx.auditLog.create({
        data: { action: "auth.email.taken", at: now, actorId: person.id, actorName: person.fullName, entity: "person", entityId: person.slug, field: "Почта уже привязана к другому человеку", ip: actor.ip ?? null, via: actor.via ?? null },
      });
      return null;
    }
    await tx.person.update({ where: { id: person.id }, data: { pendingEmail: email } });
    const link = await createLinkTx(tx, "EMAIL_CONFIRM", person.id, EMAIL_CONFIRM_TTL_MS, now, person.id, null, email);
    await tx.auditLog.create({
      data: { action: "auth.email.request", at: now, actorId: person.id, actorName: person.fullName, entity: "person", entityId: person.slug, field: "Почта на подтверждении", after: email, ip: actor.ip ?? null, via: actor.via ?? null },
    });
    return {
      to: email,
      subject: "Подтвердите почту для Weekly",
      text: [
        `${person.fullName}, вы указали этот адрес как рабочую почту в Weekly.`,
        "Подтвердите его по ссылке:",
        linkUrl(baseUrl, link.token, "/login/confirm-email"),
        "",
        `Ссылка действует сутки, до ${formatTime(link.expiresAt)} по Москве. После подтверждения по этой почте можно входить и восстанавливать пароль.`,
        "Если вы не указывали адрес, просто удалите письмо.",
      ].join("\n"),
    };
  });
  if (!mail) return fail("Этот адрес нельзя указать: он уже привязан в ресурсе. Если это ваш адрес, напишите владельцу ресурса");
  await sendMail(mail).catch((error) => {
    console.error("Письмо подтверждения не отправилось", error);
    fail("Письмо не отправилось: почтовый сервер не ответил. Попробуйте ещё раз через минуту");
  });
  return { email };
}

/** Человек передумал: неподтверждённый адрес и ссылки на него гаснут. Только при личном входе, с записью в журнал */
export async function cancelEmailBinding(actor: Actor, now = new Date()): Promise<void> {
  if (actor.via === "TEAM") fail("Почту меняют при личном входе: по общему логину можно выбрать чужой профиль");
  await prisma.$transaction(async (tx) => {
    const person = await tx.person.findUniqueOrThrow({ where: { id: actor.personId } });
    if (!person.pendingEmail) fail("Адрес уже не ждёт подтверждения");
    await tx.person.update({ where: { id: person.id }, data: { pendingEmail: null } });
    await tx.loginLink.updateMany({ where: { personId: person.id, kind: "EMAIL_CONFIRM", usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
    await tx.auditLog.create({
      data: { action: "auth.email.cancel", actorId: person.id, actorName: person.fullName, entity: "person", entityId: person.slug, field: "Почта на подтверждении", before: person.pendingEmail ?? undefined, ip: actor.ip ?? null, via: actor.via ?? null },
    });
  });
}

export type EmailConfirm = { ok: true; fullName: string; email: string } | { ok: false; error: string };

/**
 * Подтверждение по ссылке из письма. Ссылка тратится в той же транзакции, что и запись адреса. Подтверждается адрес,
 * на который ушла ссылка, и только пока человек ждёт именно его. Адрес мог за сутки занять другой человек (его вписал
 * владелец): тогда подтверждения нет. Прежний адрес получает письмо о смене
 */
export async function confirmEmail(token: string, ip: string | null, now = new Date()): Promise<EmailConfirm> {
  if (!token) return { ok: false, error: "Ссылка не найдена: проверьте, что она скопирована целиком" };
  try {
    const done = await prisma.$transaction(async (tx) => {
      const link = await takeLinkTx(tx, token, ["EMAIL_CONFIRM"], ip, now);
      if (!link) fail("Ссылка не подходит: она уже использована, устарела или скопирована не целиком. Укажите почту в профиле ещё раз");
      const person = link!.person;
      const email = link!.target;
      if (!email || person.pendingEmail !== email) fail("Этот адрес уже не ждёт подтверждения: его отменили или заменили. Укажите почту в профиле ещё раз");
      const taken = await tx.person.findFirst({ where: { email, id: { not: person.id } }, select: { id: true } });
      if (taken) fail("Этот адрес уже привязан в ресурсе к другому человеку. Напишите владельцу ресурса");
      await tx.person.update({ where: { id: person.id }, data: { email, pendingEmail: null } });
      // Ссылки, ушедшие на прежний адрес, больше не работают
      await tx.loginLink.updateMany({ where: { personId: person.id, kind: { in: ["EMAIL", "STEP_UP", "EMAIL_CONFIRM"] }, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
      await tx.auditLog.create({
        data: { action: "auth.email.confirm", actorId: person.id, actorName: person.fullName, entity: "person", entityId: person.slug, field: "Почта", before: person.email ?? undefined, after: email ?? undefined, ip, via: "EMAIL" },
      });
      return { fullName: person.fullName, email: email!, previous: person.email && person.email !== email ? person.email : null };
    });
    // Прежний адрес узнаёт о смене: если это были не вы, есть кому сказать
    if (done.previous) {
      await sendMail({
        to: done.previous,
        subject: "Почта для входа в Weekly изменена",
        text: [
          `${done.fullName}, почта для входа в Weekly изменена на ${maskEmail(done.email)}.`,
          "Если это сделали не вы, сразу сообщите владельцу ресурса: он завершит все входы и вернёт адрес.",
        ].join("\n"),
      }).catch((error) => console.error("Письмо о смене почты не отправилось", error));
    }
    return { ok: true, fullName: done.fullName, email: done.email };
  } catch (error) {
    if (error instanceof TaskRuleError) return { ok: false, error: error.message };
    // Два человека подтверждают один адрес одновременно: второй получает понятный ответ, а не общую ошибку
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      return { ok: false, error: "Этот адрес только что привязали к другому человеку. Напишите владельцу ресурса" };
    }
    throw error;
  }
}
