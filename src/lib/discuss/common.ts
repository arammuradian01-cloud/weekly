// Общее для обсуждений (этап 20): реакции, правка комментариев, люди для упоминаний.
// Модуль не зависит от сервисов задач и weekly: его используют оба.

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { ReactionKind } from "@/generated/prisma/enums";
import type { Comment, PersonSlug, ReactionCode, ReactionView } from "@/domain/types";
import { moscowIso, moscowTime } from "@/lib/tasks/dates";
import { findMentions, type MentionPerson } from "./mentions";

type Db = PrismaClient | Prisma.TransactionClient;

/** Свой комментарий можно править 15 минут */
export const EDIT_WINDOW_MS = 15 * 60_000;
export const DISCUSS_LIMITS = { comment: 2000, question: 300 };

export const REACTION_CODE: Record<ReactionKind, ReactionCode> = { ACCEPTED: "accepted", QUESTION: "question", DISCUSS: "discuss", THANKS: "thanks" };
export const REACTION_KIND: Record<ReactionCode, ReactionKind> = { accepted: "ACCEPTED", question: "QUESTION", discuss: "DISCUSS", thanks: "THANKS" };
export const REACTION_LABEL: Record<ReactionCode, string> = { accepted: "Принято", question: "Вопрос", discuss: "Обсудить на встрече", thanks: "Спасибо" };

export function isReactionCode(value: unknown): value is ReactionCode {
  return typeof value === "string" && value in REACTION_KIND;
}

export const reactionInclude = { person: { select: { slug: true } } } satisfies Prisma.ReactionInclude;
type ReactionRow = Prisma.ReactionGetPayload<{ include: typeof reactionInclude }>;

export function reactionDto(r: ReactionRow): ReactionView {
  return {
    id: r.id,
    kind: REACTION_CODE[r.kind],
    by: r.person.slug as PersonSlug,
    ...(r.question ? { question: r.question } : {}),
    ...(r.kind === "DISCUSS" ? { discussed: r.discussedAt !== null } : {}),
  };
}

/** Комментарий для экрана: дата и время по Москве, момент для окна правки, пометка «изменено» */
export function commentDto(c: { id: string; text: string; at: Date; editedAt: Date | null; author: { slug: string }; reactions?: ReactionRow[] }): Comment {
  return {
    id: c.id,
    author: c.author.slug as PersonSlug,
    text: c.text,
    at: moscowIso(c.at),
    time: moscowTime(c.at),
    moment: c.at.toISOString(),
    ...(c.editedAt ? { edited: true } : {}),
    ...(c.reactions?.length ? { reactions: c.reactions.map(reactionDto) } : {}),
  };
}

/** Можно ли ещё править комментарий: 15 минут с момента, когда его написали */
export function editable(at: Date, now = new Date()): boolean {
  return now.getTime() - at.getTime() <= EDIT_WINDOW_MS;
}

/** Люди, которых можно упомянуть: все включённые */
export async function mentionPeople(db: Db): Promise<MentionPerson[]> {
  return db.person.findMany({ where: { active: true }, select: { id: true, fullName: true, shortName: true } });
}

/** Кого упомянули в текстах. Сам себя человек не упоминает */
export async function mentionsIn(db: Db, texts: (string | null | undefined)[], authorId: string): Promise<string[]> {
  const joined = texts.filter(Boolean).join("\n");
  if (!joined.includes("@")) return [];
  return findMentions(joined, await mentionPeople(db)).filter((id) => id !== authorId);
}

export async function namesOf(db: Db, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const people = await db.person.findMany({ where: { id: { in: ids } }, select: { fullName: true } });
  return people.map((p) => p.fullName);
}
