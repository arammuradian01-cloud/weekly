// Запись событий «Мне» (этап 11). Отдельный модуль без зависимостей от сервиса задач: его вызывает сам сервис задач.

import type { InboxKind, Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

/** Длина цитаты комментария в событии */
const QUOTE = 120;

export const taskSubject = (number: number) => `task:${number}`;
export const entrySubject = (id: string) => `entry:${id}`;

export type InboxInput = {
  kind: InboxKind;
  recipients: (string | null | undefined)[];
  actor: { personId: string; fullName: string };
  subject: string;
  text: string;
  taskId?: string | null;
  commentId?: string | null;
  /** Запись weekly и комментарий к ней (этап 20) */
  entryId?: string | null;
  entryCommentId?: string | null;
  /** Реакция, о которой событие: снятая реакция убирает событие */
  reactionId?: string | null;
  /** Просьба (этап 21): предмет request:<номер> */
  requestId?: string | null;
};

/** Событие адресатам: без самого автора, без повторов, только включённым людям */
export async function notify(tx: Tx, input: InboxInput, now = new Date()): Promise<number> {
  const ids = [...new Set(input.recipients.filter((id): id is string => !!id && id !== input.actor.personId))];
  if (!ids.length) return 0;
  const active = await tx.person.findMany({ where: { id: { in: ids }, active: true }, select: { id: true } });
  if (!active.length) return 0;
  await tx.inboxEvent.createMany({
    data: active.map((p) => ({
      recipientId: p.id,
      kind: input.kind,
      actorId: input.actor.personId,
      actorName: input.actor.fullName,
      subject: input.subject,
      taskId: input.taskId ?? null,
      commentId: input.commentId ?? null,
      entryId: input.entryId ?? null,
      entryCommentId: input.entryCommentId ?? null,
      reactionId: input.reactionId ?? null,
      requestId: input.requestId ?? null,
      text: input.text,
      createdAt: now,
    })),
  });
  return active.length;
}

export function quote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > QUOTE ? `${flat.slice(0, QUOTE - 1).trimEnd()}…` : flat;
}

