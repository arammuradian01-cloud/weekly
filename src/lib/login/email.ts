// Рабочая почта человека (этап 52). Решение Арама 21.10: после первого входа человек указывает корпоративную почту,
// дальше входит по почте или логину и восстанавливает пароль через почту.
//
// Как устроено:
// - почту человек указывает сам в профиле или на экране после первого входа; пока он не открыл ссылку из письма,
//   адрес лежит неподтверждённым и для входа не годится. Иначе любой мог бы вписать себе чужой адрес и получать
//   ссылки для входа на него;
// - адрес только из разрешённых доменов (настройка auth.email.domains, по умолчанию sravni.ru): ресурс для сотрудников;
// - ссылка подтверждения действует сутки и открывается один раз, на любом устройстве: письмо читают и с телефона;
// - адрес, который задал владелец в списке людей, считается подтверждённым сразу.

import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { formatTime } from "@/lib/week";
import { mailConfigured, sendMail } from "@/lib/mail";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { createLinkTx, linkUrl, normalizeEmail, takeLinkTx } from "./service";

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

/** Домен разрешён: точное совпадение или поддомен (mail.sravni.ru подходит к sravni.ru) */
export function domainAllowed(email: string, domains: string[]): boolean {
  const domain = email.split("@")[1] ?? "";
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Человек указывает рабочую почту: адрес сохраняется неподтверждённым, на него уходит ссылка. Только при личном
 * входе: по общему логину можно выбрать чужой профиль
 */
export async function requestEmailBinding(actor: Actor, emailInput: string, baseUrl: string, now = new Date()): Promise<{ email: string }> {
  if (actor.via === "TEAM") fail("Почту указывают при личном входе: по общему логину можно выбрать чужой профиль");
  if (!mailConfigured()) fail("Почта ресурса ещё не настроена, подтвердить адрес нечем. Адрес может вписать владелец в списке людей");
  const email = normalizeEmail(emailInput);
  if (!email) return fail("Введите рабочую почту");
  const domains = await allowedEmailDomains();
  if (!domainAllowed(email, domains)) fail(`Нужна рабочая почта: адрес на ${domains.map((d) => `@${d}`).join(" или ")}`);
  const mail = await prisma.$transaction(async (tx) => {
    const person = await tx.person.findUniqueOrThrow({ where: { id: actor.personId } });
    if (person.email === email) fail("Это уже ваша подтверждённая почта");
    const taken = await tx.person.findFirst({ where: { email, id: { not: person.id } }, select: { id: true } });
    // Чей адрес, не говорим: по ответу не узнать, кто есть в ресурсе
    if (taken) fail("Этот адрес нельзя указать: он уже привязан в ресурсе. Если это ваш адрес, напишите владельцу ресурса");
    const sent = await tx.loginLink.count({ where: { personId: person.id, kind: "EMAIL_CONFIRM", createdAt: { gte: new Date(now.getTime() - EMAIL_CONFIRM_TTL_MS) } } });
    if (sent >= EMAIL_CONFIRMS_PER_DAY) fail("Слишком много писем подтверждения за сутки. Попробуйте завтра или попросите владельца вписать адрес");
    await tx.person.update({ where: { id: person.id }, data: { pendingEmail: email } });
    const link = await createLinkTx(tx, "EMAIL_CONFIRM", person.id, EMAIL_CONFIRM_TTL_MS, now, person.id);
    await tx.auditLog.create({
      data: { action: "auth.email.request", actorId: person.id, actorName: person.fullName, entity: "person", entityId: person.slug, field: "Почта на подтверждении", after: email, ip: actor.ip ?? null, via: actor.via ?? null },
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
  await sendMail(mail).catch((error) => {
    console.error("Письмо подтверждения не отправилось", error);
    fail("Письмо не отправилось: почтовый сервер не ответил. Попробуйте ещё раз через минуту");
  });
  return { email };
}

/** Человек передумал: неподтверждённый адрес и ссылки на него гаснут */
export async function cancelEmailBinding(actor: Actor, now = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.person.update({ where: { id: actor.personId }, data: { pendingEmail: null } });
    await tx.loginLink.updateMany({ where: { personId: actor.personId, kind: "EMAIL_CONFIRM", usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
  });
}

export type EmailConfirm = { ok: true; fullName: string; email: string } | { ok: false; error: string };

/**
 * Подтверждение по ссылке из письма. Ссылка тратится в той же транзакции, что и запись адреса. Адрес мог за сутки
 * занять другой человек (его вписал владелец): тогда подтверждения нет
 */
export async function confirmEmail(token: string, ip: string | null, now = new Date()): Promise<EmailConfirm> {
  if (!token) return { ok: false, error: "Ссылка не найдена: проверьте, что она скопирована целиком" };
  try {
    return await prisma.$transaction(async (tx) => {
      const link = await takeLinkTx(tx, token, ["EMAIL_CONFIRM"], ip, now);
      if (!link) fail("Ссылка не подходит: она уже использована, устарела или скопирована не целиком. Укажите почту в профиле ещё раз");
      const person = link!.person;
      const email = person.pendingEmail;
      if (!email) fail("Адрес уже не ждёт подтверждения: его отменили в профиле. Укажите почту ещё раз");
      const taken = await tx.person.findFirst({ where: { email, id: { not: person.id } }, select: { id: true } });
      if (taken) fail("Этот адрес уже привязан в ресурсе к другому человеку. Напишите владельцу ресурса");
      await tx.person.update({ where: { id: person.id }, data: { email, pendingEmail: null } });
      // Ссылки, ушедшие на прежний адрес, больше не работают
      await tx.loginLink.updateMany({ where: { personId: person.id, kind: { in: ["EMAIL", "STEP_UP", "EMAIL_CONFIRM"] }, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
      await tx.auditLog.create({
        data: { action: "auth.email.confirm", actorId: person.id, actorName: person.fullName, entity: "person", entityId: person.slug, field: "Почта", before: person.email ?? undefined, after: email ?? undefined, ip, via: "EMAIL" },
      });
      return { ok: true as const, fullName: person.fullName, email: email! };
    });
  } catch (error) {
    if (error instanceof TaskRuleError) return { ok: false, error: error.message };
    throw error;
  }
}
