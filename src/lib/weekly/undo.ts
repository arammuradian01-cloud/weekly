// Отмена удаления записи weekly. Сервер отдаёт подписанный токен с полной копией записи.
// Подпись не даёт подделать восстановление чужой записи, срок жизни минута, на экране кнопка живёт 5 секунд.

import { createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecretFromEnv } from "@/lib/database-url";

export const ENTRY_UNDO_TTL_MS = 60_000;

/** Всё, что нужно, чтобы вернуть запись такой, какой она была. Даты строками, чтобы токен был обычным JSON */
export type EntrySnapshot = {
  id: string;
  weekId: string;
  authorId: string | null;
  directionId: string;
  blockId: string;
  typeId: string;
  what: string;
  details: string | null;
  impact: string | null;
  fact: string | null;
  next: string | null;
  help: string | null;
  links: unknown;
  ceo: boolean;
  sortOrder: number;
  importBatch: string | null;
  createdAt: string;
  /** Задачи, созданные из записи: при удалении связь обнуляется, при отмене возвращается */
  taskIds: string[];
};

type Payload = { snapshot: EntrySnapshot; by: string; exp: number };

function key(): string {
  const secret = sessionSecretFromEnv();
  if (!secret) throw new Error("Нет ключа подписи: задайте SESSION_SECRET или пароль базы");
  return createHmac("sha256", secret).update("weekly/entry-undo/v1").digest("base64url");
}

function sign(body: string): string {
  return createHmac("sha256", key()).update(body).digest("base64url");
}

export function issueEntryUndoToken(snapshot: EntrySnapshot, personId: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ snapshot, by: personId, exp: now + ENTRY_UNDO_TTL_MS } satisfies Payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** null: подпись не сходится, токен чужой или просрочен */
export function readEntryUndoToken(token: string, personId: string, now = Date.now()): EntrySnapshot | null {
  const [body, mac] = String(token ?? "").split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
  } catch {
    return null;
  }
  if (payload.by !== personId || payload.exp < now || !payload.snapshot?.id) return null;
  return payload.snapshot;
}
