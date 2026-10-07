// Реакции (этап 20): «Принято», «Вопрос», «Обсудить на встрече», «Спасибо». Повторное нажатие снимает реакцию.
// «Обсудить на встрече» требует вопрос: он попадает в повестку встречи, пока его не отметят «обсуждено».

import type { Prisma } from "@/generated/prisma/client";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import type { ReactionCode } from "@/domain/types";
import { DISCUSS_LIMITS, REACTION_KIND, isReactionCode } from "./common";

type Tx = Prisma.TransactionClient;

export type ReactionTarget = { entryId: string } | { entryCommentId: string } | { taskCommentId: string };

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export type ReactionChange = { on: boolean; id: string | null; kind: ReactionCode; question: string | null; was: { question: string | null; createdAt: Date } | null };

/** Поставить или снять реакцию. Для «Обсудить на встрече» новый вопрос заменяет прежний и снова ставит пункт в повестку */
export async function applyReaction(tx: Tx, actor: Actor, target: ReactionTarget, code: unknown, question?: string | null): Promise<ReactionChange> {
  if (actor.role === "OBSERVER") fail("Наблюдатель только читает");
  if (!isReactionCode(code)) return fail("Такой реакции нет");
  const kind = REACTION_KIND[code];
  const existing = await tx.reaction.findFirst({ where: { personId: actor.personId, kind, ...target } });
  const was = existing ? { question: existing.question, createdAt: existing.createdAt } : null;
  if (kind === "DISCUSS") {
    const q = (question ?? "").replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
    if (q.length > DISCUSS_LIMITS.question) fail(`Вопрос: не длиннее ${DISCUSS_LIMITS.question} знаков`);
    if (!q) {
      if (existing) {
        await tx.reaction.delete({ where: { id: existing.id } });
        return { on: false, id: null, kind: code, question: null, was };
      }
      return fail("Сформулируйте вопрос: он попадёт в повестку встречи");
    }
    if (existing) {
      const row = await tx.reaction.update({ where: { id: existing.id }, data: { question: q, discussedAt: null, discussedById: null } });
      return { on: true, id: row.id, kind: code, question: q, was };
    }
    const row = await tx.reaction.create({ data: { kind, personId: actor.personId, question: q, ...target } });
    return { on: true, id: row.id, kind: code, question: q, was };
  }
  if (existing) {
    await tx.reaction.delete({ where: { id: existing.id } });
    return { on: false, id: null, kind: code, question: null, was };
  }
  const row = await tx.reaction.create({ data: { kind, personId: actor.personId, ...target } });
  return { on: true, id: row.id, kind: code, question: null, was };
}

/**
 * Реакцию сняли: событие о ней у автора убираем, если он его ещё не видел. Так случайное нажатие не оставляет следа в «Мне»
 */
export async function dropReactionEvent(
  tx: Tx,
  actor: Actor,
  target: { entryId?: string; entryCommentId?: string | null; commentId?: string; taskId?: string },
  since: Date,
): Promise<void> {
  await tx.inboxEvent.deleteMany({
    where: { kind: "REACTION", actorId: actor.personId, seenAt: null, doneAt: null, createdAt: { gte: since }, ...target },
  });
}
