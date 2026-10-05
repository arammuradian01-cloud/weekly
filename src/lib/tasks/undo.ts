// Отмена последнего действия (раздел 7 ТЗ). Сервер отдаёт подписанный токен с тем, что нужно вернуть.
// Подпись не даёт подделать отмену чужой правки, срок жизни минута, на экране кнопка живёт 5 секунд.

import { createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecretFromEnv } from "@/lib/database-url";

export const UNDO_TTL_MS = 60_000;

/** Поля задачи, которые возвращает отмена. Даты строками, чтобы токен был обычным JSON */
export type TaskSnapshot = {
  title: string;
  outcome: string;
  directionId: string;
  sourceCode: string;
  sourceNote: string | null;
  status: string;
  resolution: string | null;
  closedAt: string | null;
  state: string | null;
  blockedBy: string | null;
  priority: string | null;
  whereNow: string;
  whereUpdatedAt: string;
  due: string;
  archivedAt: string | null;
};

export type UndoSpec =
  | { kind: "restore"; number: number; snapshot: TaskSnapshot; expectUpdatedAt: string; removeTransferId?: string; removeLinkId?: string }
  | { kind: "comment"; number: number; commentId: string }
  | { kind: "create"; number: number; expectUpdatedAt?: string };

type Payload = UndoSpec & { by: string; exp: number };

function key(): string {
  const secret = sessionSecretFromEnv();
  if (!secret) throw new Error("Нет ключа подписи: задайте SESSION_SECRET или пароль базы");
  return createHmac("sha256", secret).update("weekly/undo/v1").digest("base64url");
}

function sign(body: string): string {
  return createHmac("sha256", key()).update(body).digest("base64url");
}

export function issueUndoToken(spec: UndoSpec, personId: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...spec, by: personId, exp: now + UNDO_TTL_MS } satisfies Payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** null: подпись не сходится, токен чужой или просрочен */
export function readUndoToken(token: string, personId: string, now = Date.now()): UndoSpec | null {
  const [body, mac] = token.split(".");
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
  if (payload.by !== personId || payload.exp < now) return null;
  const { by: _by, exp: _exp, ...spec } = payload;
  return spec as UndoSpec;
}
