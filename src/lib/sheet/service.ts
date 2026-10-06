// Действия владельца на странице «Синхронизация»: какая копия таблицы подключена, выгрузить, сверить, пересобрать.
// Только владелец в режиме управления (матрица прав, раздел 2 ТЗ). Каждое действие в журнале.

import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { Prisma } from "@/generated/prisma/client";
import { canManagePeople } from "@/lib/admin/service";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { connection, serviceEmail } from "./runner";
import { GoogleSheetsError } from "./google";
import { PROD_SHEET_ID, SheetBusyError, pushChanges, rebuild, reconcile, type PushResult, type ReconcileResult } from "./sync";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

function requireOwner(actor: Actor) {
  if (!canManagePeople(actor)) fail("Синхронизацией с таблицей управляет только владелец в режиме управления");
}

/** ID таблицы из ссылки или как есть. Пустая строка: отключить таблицу */
export function parseSpreadsheetId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(raw)?.[1];
  const id = fromUrl ?? raw;
  if (!/^[a-zA-Z0-9_-]{25,100}$/.test(id)) fail("Не похоже на ссылку на Google-таблицу. Скопируйте адрес копии из браузера целиком");
  if (id === PROD_SHEET_ID) fail("Это рабочий Bord. Ресурс в него не пишет, его ссылка нужна в разделе «Задачи из Bord». Здесь нужна таблица для просмотра");
  return id;
}

/** Ошибку Google показываем человеку словами: что не так и что сделать */
function googleMessage(error: unknown): string {
  if (error instanceof SheetBusyError) return error.message;
  if (error instanceof GoogleSheetsError) return error.message.split(". ")[0]!;
  return "Google не ответил. Попробуйте ещё раз через минуту";
}

async function connected() {
  const conn = await connection();
  if (!conn) fail(serviceEmail() ? "Сначала укажите ссылку на копию таблицы" : "Ключ служебного аккаунта Google не задан на сервере");
  return conn!;
}

/** Подключить копию таблицы или отключить. Сразу проверяем доступ служебного аккаунта */
export async function setSpreadsheet(actor: Actor, input: string): Promise<{ id: string | null; access: "ok" | "no-key" | string }> {
  requireOwner(actor);
  const id = parseSpreadsheetId(String(input ?? ""));
  if (id && id === (await getSetting<string | null>("bord.sourceId", null))) fail("Из этой таблицы ресурс забирает задачи и в неё не пишет. Здесь нужна отдельная таблица для просмотра");
  const before = await getSetting<string | null>("sheet.spreadsheetId", null);
  if (before !== id) {
    await prisma.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { key: "sheet.spreadsheetId" }, update: { value: id ?? Prisma.JsonNull }, create: { key: "sheet.spreadsheetId", value: id ?? Prisma.JsonNull } });
      await tx.auditLog.create({
        data: {
          action: "sync.settings",
          actorId: actor.personId,
          actorName: actor.fullName,
          source: "APP",
          entity: "sheet",
          entityId: "settings",
          field: "Таблица для выгрузки",
          before: before ?? "не подключена",
          after: id ?? "не подключена",
          ip: actor.ip,
        },
      });
    });
  }
  if (!id) return { id, access: "ok" };
  const conn = await connection();
  if (!conn) return { id, access: "no-key" };
  try {
    await conn.client.sheets();
    return { id, access: "ok" };
  } catch (error) {
    return { id, access: googleMessage(error) };
  }
}

export async function pushNow(actor: Actor): Promise<PushResult> {
  requireOwner(actor);
  const conn = await connected();
  try {
    return await pushChanges(conn.client, { serviceEmail: conn.serviceEmail, spreadsheetId: conn.spreadsheetId });
  } catch (error) {
    return fail(googleMessage(error));
  }
}

export async function reconcileNow(actor: Actor): Promise<ReconcileResult> {
  requireOwner(actor);
  const conn = await connected();
  try {
    return await reconcile(conn.client, { serviceEmail: conn.serviceEmail, spreadsheetId: conn.spreadsheetId });
  } catch (error) {
    return fail(googleMessage(error));
  }
}

export async function rebuildNow(actor: Actor): Promise<{ items: number }> {
  requireOwner(actor);
  const conn = await connected();
  try {
    return await rebuild(conn.client, { serviceEmail: conn.serviceEmail, spreadsheetId: conn.spreadsheetId, actor: { id: actor.personId, name: actor.fullName } });
  } catch (error) {
    return fail(googleMessage(error));
  }
}
