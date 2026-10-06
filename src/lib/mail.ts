// Отправка писем (этап 9): ссылки для входа и подтверждения режима управления.
// Почтовый сервер задаётся переменными SMTP_URL (например smtps://логин:пароль@smtp.example.ru:465) и MAIL_FROM.
// Пока их нет, письма не уходят, а личные ссылки выдаёт владелец в настройках.
// В письме только кто, что и ссылка: содержимое ресурса видно только после входа.
//
// MAIL_TRANSPORT=log пишет письма строками JSON в файл MAIL_LOG_FILE вместо отправки: для разработки и автотестов.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import nodemailer from "nodemailer";

export type Mail = { to: string; subject: string; text: string };
type Transport = (mail: Mail) => Promise<void>;

let override: Transport | null = null;

/** Подмена отправки в тестах базы */
export function setMailTransport(transport: Transport | null): void {
  override = transport;
}

function logFile(): string {
  return process.env.MAIL_LOG_FILE ?? ".local/mail.log";
}

export function mailConfigured(env: Record<string, string | undefined> = process.env): boolean {
  if (override) return true;
  if (env.MAIL_TRANSPORT === "log") return true;
  return Boolean(env.SMTP_URL && env.MAIL_FROM);
}

export async function sendMail(mail: Mail): Promise<void> {
  if (override) return override(mail);
  if (process.env.MAIL_TRANSPORT === "log") {
    const file = logFile();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...mail })}\n`);
    return;
  }
  if (!process.env.SMTP_URL || !process.env.MAIL_FROM) throw new Error("Почта не настроена: задайте SMTP_URL и MAIL_FROM");
  const transport = nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({ from: process.env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text });
}
