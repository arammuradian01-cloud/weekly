// Действия владельца на странице «Синхронизация» для забора задач из рабочего Bord: какой Bord читать, забрать сейчас.
// Только владелец в режиме управления, как и зеркало. Подключение и отключение в журнале.

import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { Prisma } from "@/generated/prisma/client";
import { canManagePeople } from "@/lib/admin/service";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { GoogleSheetsError, serviceAccountFromEnv } from "@/lib/sheet/google";
import { PULL_EVERY_MS, PULL_RETRY_MS, bordConnection, serviceEmail } from "@/lib/sheet/runner";
import { BORD_TAB } from "./parse";
import { pullState, runPull, type PullReport, type PullState } from "./pull";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

function requireOwner(actor: Actor) {
  if (!canManagePeople(actor)) fail("Забором задач из Bord управляет только владелец в режиме управления");
}

/** ID таблицы из ссылки или как есть. Пустая строка: выключить забор */
export function parseBordSource(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const id = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(raw)?.[1] ?? raw;
  if (!/^[a-zA-Z0-9_-]{25,100}$/.test(id)) fail("Не похоже на ссылку на Google-таблицу. Скопируйте адрес Bord из браузера целиком");
  return id;
}

/** Ошибку Google показываем словами: что не так и что сделать */
function accessMessage(error: unknown): string {
  if (error instanceof GoogleSheetsError) {
    if (/нет нужной вкладки/.test(error.message)) return `В таблице нет вкладки «${BORD_TAB}»: проверьте, что это ссылка на Bord`;
    return error.message.split(". ")[0]!;
  }
  return "Google не ответил. Попробуйте ещё раз через минуту";
}

/** Подключить Bord для забора или выключить забор. Доступ служебного аккаунта проверяется сразу */
export async function setBordSource(actor: Actor, input: string): Promise<{ id: string | null; access: "ok" | "no-key" | string }> {
  requireOwner(actor);
  const id = parseBordSource(String(input ?? ""));
  const mirror = await getSetting<string | null>("sheet.spreadsheetId", null);
  if (id && id === mirror) fail("Это таблица для просмотра: её заполняет ресурс. Здесь нужна ссылка на рабочий Bord");
  const before = await getSetting<string | null>("bord.sourceId", null);
  if (before !== id) {
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { key: "bord.sourceId" }, update: { value: id ?? Prisma.JsonNull }, create: { key: "bord.sourceId", value: id ?? Prisma.JsonNull } });
      // Другой Bord: прошлые значения полей к нему не относятся, первый забор возьмёт из него всё
      if (before && id) await tx.setting.deleteMany({ where: { key: { in: ["bord.snapshot", "bord.pull"] } } });
      await tx.auditLog.create({
        data: {
          action: "sync.bord",
          actorId: actor.personId,
          actorName: actor.fullName,
          source: "APP",
          entity: "sheet",
          entityId: "bord",
          field: "Bord для забора задач",
          before: before ?? "забор выключен",
          after: id ?? "забор выключен",
          ip: actor.ip,
          via: actor.via ?? null,
        },
      });
    });
  }
  if (!id) return { id, access: "ok" };
  const conn = await bordConnection();
  if (!conn) return { id, access: "no-key" };
  try {
    await conn.reader.getValues(`'${BORD_TAB}'!A1:I2`);
    return { id, access: "ok" };
  } catch (error) {
    return { id, access: accessMessage(error) };
  }
}

/** «Забрать сейчас»: забор вне расписания, ошибка показывается сразу */
export async function pullBordNow(actor: Actor): Promise<PullReport> {
  requireOwner(actor);
  const conn = await bordConnection();
  if (!conn) fail(serviceEmail() ? "Сначала вставьте ссылку на Bord" : "Ключ служебного аккаунта Google не задан на сервере");
  const result = await runPull(conn!.reader, "manual", { sourceId: conn!.sourceId });
  if (!result) return fail("Забор уже идёт в другом процессе сервера. Попробуйте через минуту");
  if (result.error) return fail(result.error);
  return result.report!;
}

export type BordStatus = {
  sourceId: string | null;
  connected: boolean;
  hasKey: boolean;
  serviceEmail: string | null;
  state: PullState;
  /** Когда следующий забор, ISO. null: забор выключен */
  nextAt: string | null;
};

/** Всё про забор для страницы «Синхронизация» */
export async function bordStatus(now = new Date()): Promise<BordStatus> {
  const [sourceId, state, conn] = await Promise.all([getSetting<string | null>("bord.sourceId", null), pullState(), bordConnection()]);
  const wait = state.ok === false ? PULL_RETRY_MS : PULL_EVERY_MS;
  const nextAt = !conn ? null : state.lastAttemptAt ? new Date(Math.max(now.getTime(), new Date(state.lastAttemptAt).getTime() + wait)).toISOString() : now.toISOString();
  return {
    sourceId,
    connected: conn !== null,
    hasKey: process.env.SHEET_FAKE === "1" || serviceAccountFromEnv() !== null,
    serviceEmail: serviceEmail(),
    state,
    nextAt,
  };
}
